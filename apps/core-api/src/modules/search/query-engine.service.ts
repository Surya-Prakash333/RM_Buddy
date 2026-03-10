import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';

import { Client, ClientDocument } from '../../database/models/client.model';
import { AlertRecord, AlertDocument } from '../../database/models/alert.model';
import { Meeting, MeetingDocument } from '../../database/models/meeting.model';

import {
  QueryIntent,
  ParsedQuery,
  QueryFilter,
  QueryResult,
} from './query-engine.dto';

// ---------------------------------------------------------------------------
// Date range helper
// ---------------------------------------------------------------------------

/**
 * Returns a { start, end } date range for the given natural-language period.
 */
export function getDateFilter(period: string): { start: Date; end: Date } {
  const now = new Date();
  const startOfDay = (d: Date): Date => {
    const s = new Date(d);
    s.setHours(0, 0, 0, 0);
    return s;
  };
  const endOfDay = (d: Date): Date => {
    const e = new Date(d);
    e.setHours(23, 59, 59, 999);
    return e;
  };

  const normalized = period.trim().toLowerCase();

  if (normalized === 'today') {
    return { start: startOfDay(now), end: endOfDay(now) };
  }

  if (normalized === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return { start: startOfDay(tomorrow), end: endOfDay(tomorrow) };
  }

  // this week — Monday to Sunday
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: startOfDay(monday), end: endOfDay(sunday) };
}

// ---------------------------------------------------------------------------
// Mongo operator builder
// ---------------------------------------------------------------------------

type MongoOperand =
  | unknown
  | { $gt: unknown }
  | { $lt: unknown }
  | { $gte: unknown }
  | { $lte: unknown }
  | { $in: unknown[] }
  | { $regex: string; $options: string }
  | { $gte: Date; $lte: Date };

function buildMongoOperator(operator: QueryFilter['operator'], value: unknown): MongoOperand {
  switch (operator) {
    case 'eq':
      return value;
    case 'gt':
      return { $gt: value };
    case 'lt':
      return { $lt: value };
    case 'gte': {
      // If value is an object with start/end (date range), expand it
      const v = value as { start?: Date; end?: Date };
      if (v && typeof v === 'object' && 'start' in v && 'end' in v) {
        return { $gte: v.start, $lte: v.end } as { $gte: Date; $lte: Date };
      }
      return { $gte: value };
    }
    case 'lte':
      return { $lte: value };
    case 'in':
      return { $in: value as unknown[] };
    case 'regex':
      return { $regex: String(value), $options: 'i' };
    default:
      return value;
  }
}

function buildMongoFilter(filters: QueryFilter[]): FilterQuery<unknown> {
  const mongo: Record<string, MongoOperand> = {};
  for (const f of filters) {
    if (f.field === 'rm_id') {
      // rm_id is always an equality filter
      mongo['rm_id'] = f.value;
    } else {
      mongo[f.field] = buildMongoOperator(f.operator, f.value);
    }
  }
  return mongo as FilterQuery<unknown>;
}

// ---------------------------------------------------------------------------
// QueryEngineService
// ---------------------------------------------------------------------------

@Injectable()
export class QueryEngineService {
  private readonly logger = new Logger(QueryEngineService.name);

  // -------------------------------------------------------------------------
  // Pattern registry
  // -------------------------------------------------------------------------

  private readonly PATTERNS: Array<{
    regex: RegExp;
    intent: QueryIntent;
    extract: (match: RegExpMatchArray) => Partial<ParsedQuery>;
  }> = [
    // COUNT patterns
    {
      regex: /how many (diamond|platinum|gold|silver)?\s*clients/i,
      intent: 'COUNT',
      extract: (m) => ({
        collection: 'clients' as const,
        aggregation: 'count' as const,
        filters: m[1]
          ? [{ field: 'tier', operator: 'eq' as const, value: m[1].toUpperCase() }]
          : [],
      }),
    },
    // FILTER_LIST — tier-based
    {
      regex: /(show|list|give me)\s*(my\s*)?(diamond|platinum|gold|silver)\s*clients/i,
      intent: 'FILTER_LIST',
      extract: (m) => ({
        collection: 'clients' as const,
        filters: [{ field: 'tier', operator: 'eq' as const, value: m[3].toUpperCase() }],
        limit: 20,
      }),
    },
    // AGGREGATE_SUM — total AUM
    {
      regex: /total\s*(aum|assets|portfolio)/i,
      intent: 'AGGREGATE_SUM',
      extract: () => ({
        collection: 'clients' as const,
        aggregation: 'sum' as const,
        field: 'total_aum',
        filters: [],
      }),
    },
    // AGGREGATE_SUM — revenue YTD
    {
      regex: /total\s*revenue|revenue\s*(ytd|this\s*year)/i,
      intent: 'AGGREGATE_SUM',
      extract: () => ({
        collection: 'clients' as const,
        aggregation: 'sum' as const,
        field: 'total_revenue_ytd',
        filters: [],
      }),
    },
    // ALERT_QUERY — pending/active/new alerts
    {
      regex: /(pending|active|new)\s*alerts?/i,
      intent: 'ALERT_QUERY',
      extract: (m) => ({
        collection: 'alerts' as const,
        filters: [
          {
            field: 'status',
            operator: 'eq' as const,
            value:
              m[1].toUpperCase() === 'ACTIVE' ? 'PENDING' : m[1].toUpperCase(),
          },
        ],
        sort: { field: 'createdAt', direction: 'desc' as const },
        limit: 10,
      }),
    },
    // TIME_FILTER — meetings today/tomorrow/this week
    {
      regex: /meetings?\s*(today|tomorrow|this\s*week)/i,
      intent: 'TIME_FILTER',
      extract: (m) => ({
        collection: 'meetings' as const,
        filters: [
          {
            field: 'scheduled_date',
            operator: 'gte' as const,
            value: getDateFilter(m[1]),
          },
        ],
        sort: { field: 'scheduled_time', direction: 'asc' as const },
      }),
    },
    // Idle cash / high cash clients
    {
      regex: /idle\s*cash|clients?\s*with\s*(?:high\s*)?cash/i,
      intent: 'FILTER_LIST',
      extract: () => ({
        collection: 'clients' as const,
        filters: [{ field: 'cash_pct', operator: 'gt' as const, value: 15 }],
      }),
    },
    // FIND_CLIENT — by name (broad catch; keep last)
    {
      regex: /(?:tell me about|show|find|search for)\s+(.+)/i,
      intent: 'FIND_CLIENT',
      extract: (m) => ({
        collection: 'clients' as const,
        filters: [{ field: 'client_name', operator: 'regex' as const, value: m[1].trim() }],
        limit: 1,
      }),
    },
  ];

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor(
    @InjectModel(Client.name) private readonly clientModel: Model<ClientDocument>,
    @InjectModel(AlertRecord.name) private readonly alertModel: Model<AlertDocument>,
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
  ) {}

  // -------------------------------------------------------------------------
  // Public: parseQuery
  // -------------------------------------------------------------------------

  /**
   * Parses a natural-language query into a structured ParsedQuery.
   * Always appends an rm_id equality filter so every query is RM-scoped.
   */
  parseQuery(query: string, rmId: string): ParsedQuery {
    for (const pattern of this.PATTERNS) {
      const match = query.match(pattern.regex);
      if (match) {
        const partial = pattern.extract(match);
        const baseFilters: QueryFilter[] = partial.filters ?? [];
        const rmFilter: QueryFilter = { field: 'rm_id', operator: 'eq', value: rmId };
        return {
          original: query,
          intent: pattern.intent,
          collection: partial.collection ?? 'clients',
          filters: [...baseFilters, rmFilter],
          ...(partial.aggregation !== undefined && { aggregation: partial.aggregation }),
          ...(partial.field !== undefined && { field: partial.field }),
          ...(partial.limit !== undefined && { limit: partial.limit }),
          ...(partial.sort !== undefined && { sort: partial.sort }),
        } as ParsedQuery;
      }
    }

    // UNKNOWN — still scope to rm_id
    return {
      original: query,
      intent: 'UNKNOWN',
      collection: 'clients',
      filters: [{ field: 'rm_id', operator: 'eq', value: rmId }],
    };
  }

  // -------------------------------------------------------------------------
  // Public: executeQuery
  // -------------------------------------------------------------------------

  /**
   * Executes a ParsedQuery against MongoDB and returns a formatted QueryResult.
   */
  async executeQuery(parsed: ParsedQuery, rmId: string): Promise<QueryResult> {
    this.logger.log(
      `executeQuery intent=${parsed.intent} collection=${parsed.collection} rm_id=${rmId}`,
    );

    try {
      switch (parsed.intent) {
        case 'COUNT':
          return await this.executeCount(parsed);

        case 'AGGREGATE_SUM':
          return await this.executeAggregateSum(parsed);

        case 'AGGREGATE_AVG':
          return await this.executeAggregateAvg(parsed);

        case 'FILTER_LIST':
          return await this.executeFilterList(parsed);

        case 'FIND_CLIENT':
          return await this.executeFindClient(parsed);

        case 'ALERT_QUERY':
          return await this.executeAlertQuery(parsed);

        case 'TIME_FILTER':
          return await this.executeTimeFilter(parsed);

        default:
          return {
            intent: 'UNKNOWN',
            data: null,
            formatted_answer:
              "I'm not sure how to answer that. Try asking about clients, AUM, alerts, or meetings.",
            widgets_hint: 'METRIC_CARD',
          };
      }
    } catch (err) {
      this.logger.error(`executeQuery failed: ${(err as Error).message}`);
      return {
        intent: parsed.intent,
        data: null,
        formatted_answer: 'Sorry, I encountered an error processing your query.',
        widgets_hint: 'METRIC_CARD',
      };
    }
  }

  // -------------------------------------------------------------------------
  // Private: intent executors
  // -------------------------------------------------------------------------

  private async executeCount(parsed: ParsedQuery): Promise<QueryResult> {
    const mongoFilter = buildMongoFilter(parsed.filters);
    const count = await this.clientModel.countDocuments(mongoFilter as FilterQuery<ClientDocument>);

    // Build a readable label from the tier filter (if any)
    const tierFilter = parsed.filters.find((f) => f.field === 'tier');
    const label = tierFilter ? `${String(tierFilter.value)} ` : '';

    return {
      intent: 'COUNT',
      data: { count },
      count,
      formatted_answer: `You have ${count} ${label}client${count !== 1 ? 's' : ''}.`,
      widgets_hint: 'METRIC_CARD',
    };
  }

  private async executeAggregateSum(parsed: ParsedQuery): Promise<QueryResult> {
    const field = parsed.field ?? 'total_aum';
    const mongoFilter = buildMongoFilter(parsed.filters);

    const pipeline = [
      { $match: mongoFilter },
      { $group: { _id: null, total: { $sum: `$${field}` } } },
    ];

    const result = await this.clientModel.aggregate(pipeline).exec();
    const total: number = result.length > 0 ? (result[0] as { total: number }).total : 0;

    const label = field === 'total_aum' ? 'AUM' : 'Revenue YTD';
    const formattedValue = this.formatIndian(total);

    return {
      intent: 'AGGREGATE_SUM',
      data: { total, field },
      formatted_answer: `Your total ${label} is ${formattedValue}.`,
      widgets_hint: 'METRIC_CARD',
    };
  }

  private async executeAggregateAvg(parsed: ParsedQuery): Promise<QueryResult> {
    const field = parsed.field ?? 'total_aum';
    const mongoFilter = buildMongoFilter(parsed.filters);

    const pipeline = [
      { $match: mongoFilter },
      { $group: { _id: null, average: { $avg: `$${field}` } } },
    ];

    const result = await this.clientModel.aggregate(pipeline).exec();
    const average: number = result.length > 0 ? (result[0] as { average: number }).average : 0;
    const formattedValue = this.formatIndian(average);

    return {
      intent: 'AGGREGATE_AVG',
      data: { average, field },
      formatted_answer: `Average ${field.replace(/_/g, ' ')} is ${formattedValue}.`,
      widgets_hint: 'METRIC_CARD',
    };
  }

  private async executeFilterList(parsed: ParsedQuery): Promise<QueryResult> {
    const mongoFilter = buildMongoFilter(parsed.filters);
    const limit = parsed.limit ?? 20;

    let query = this.clientModel
      .find(mongoFilter as FilterQuery<ClientDocument>)
      .limit(limit)
      .lean();

    if (parsed.sort) {
      const sortDir = parsed.sort.direction === 'asc' ? 1 : -1;
      query = query.sort({ [parsed.sort.field]: sortDir });
    }

    const clients = await query.exec();
    const count = clients.length;

    // Build label from tier filter if present
    const tierFilter = parsed.filters.find((f) => f.field === 'tier');
    const label = tierFilter ? `${String(tierFilter.value)} ` : '';

    return {
      intent: 'FILTER_LIST',
      data: clients,
      count,
      formatted_answer: `Here are your ${count} ${label}clients:`,
      widgets_hint: 'TABLE',
    };
  }

  private async executeFindClient(parsed: ParsedQuery): Promise<QueryResult> {
    const mongoFilter = buildMongoFilter(parsed.filters);

    const client = await this.clientModel
      .findOne(mongoFilter as FilterQuery<ClientDocument>)
      .lean()
      .exec();

    if (!client) {
      const nameFilter = parsed.filters.find((f) => f.field === 'client_name');
      const searchTerm = nameFilter ? String(nameFilter.value) : 'client';
      return {
        intent: 'FIND_CLIENT',
        data: null,
        formatted_answer: `No client found matching "${searchTerm}".`,
        widgets_hint: 'CLIENT_SUMMARY',
      };
    }

    const lastInteraction = client.last_interaction
      ? this.daysAgo(new Date(client.last_interaction))
      : null;

    const lastInteractionStr = lastInteraction !== null
      ? lastInteraction === 0
        ? 'today'
        : `${lastInteraction} day${lastInteraction !== 1 ? 's' : ''} ago`
      : 'unknown';

    const aumStr = this.formatIndian(client.total_aum ?? 0);

    return {
      intent: 'FIND_CLIENT',
      data: client,
      formatted_answer: `${client.client_name} (${client.tier}) — AUM ${aumStr}, last interaction ${lastInteractionStr}.`,
      widgets_hint: 'CLIENT_SUMMARY',
    };
  }

  private async executeAlertQuery(parsed: ParsedQuery): Promise<QueryResult> {
    const mongoFilter = buildMongoFilter(parsed.filters);
    const limit = parsed.limit ?? 10;

    const alerts = await this.alertModel
      .find(mongoFilter as FilterQuery<AlertDocument>)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    const count = alerts.length;

    // Count by severity
    const highCount = alerts.filter((a) => a.severity?.toUpperCase() === 'HIGH').length;
    const medCount = alerts.filter((a) => a.severity?.toUpperCase() === 'MEDIUM').length;
    const lowCount = alerts.filter((a) => a.severity?.toUpperCase() === 'LOW').length;

    const statusFilter = parsed.filters.find((f) => f.field === 'status');
    const statusLabel = statusFilter ? String(statusFilter.value).toLowerCase() : 'pending';

    const severityParts: string[] = [];
    if (highCount > 0) severityParts.push(`${highCount} HIGH`);
    if (medCount > 0) severityParts.push(`${medCount} MEDIUM`);
    if (lowCount > 0) severityParts.push(`${lowCount} LOW`);
    const severityStr = severityParts.length > 0 ? ` (${severityParts.join(', ')})` : '';

    return {
      intent: 'ALERT_QUERY',
      data: alerts,
      count,
      formatted_answer: `You have ${count} ${statusLabel} alert${count !== 1 ? 's' : ''}${severityStr}.`,
      widgets_hint: 'ALERT_CARD',
    };
  }

  private async executeTimeFilter(parsed: ParsedQuery): Promise<QueryResult> {
    const mongoFilter = buildMongoFilter(parsed.filters);
    const limit = parsed.limit ?? 50;

    const meetings = await this.meetingModel
      .find(mongoFilter as FilterQuery<MeetingDocument>)
      .sort({ scheduled_date: 1, scheduled_time: 1 })
      .limit(limit)
      .lean()
      .exec();

    const count = meetings.length;

    // Determine period label from original query
    const dateFilter = parsed.filters.find((f) => f.field === 'scheduled_date');
    let periodLabel = 'upcoming';
    if (dateFilter) {
      const original = parsed.original.toLowerCase();
      if (/today/.test(original)) periodLabel = 'today';
      else if (/tomorrow/.test(original)) periodLabel = 'tomorrow';
      else if (/this\s*week/.test(original)) periodLabel = 'this week';
    }

    return {
      intent: 'TIME_FILTER',
      data: meetings,
      count,
      formatted_answer: `You have ${count} meeting${count !== 1 ? 's' : ''} ${periodLabel}.`,
      widgets_hint: 'MEETING_LIST',
    };
  }

  // -------------------------------------------------------------------------
  // Private: formatting helpers
  // -------------------------------------------------------------------------

  private formatIndian(amount: number): string {
    if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)} Cr`;
    if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)} L`;
    if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(0)}K`;
    return `₹${amount.toLocaleString('en-IN')}`;
  }

  private daysAgo(date: Date): number {
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.floor((now.getTime() - date.getTime()) / msPerDay);
  }
}
