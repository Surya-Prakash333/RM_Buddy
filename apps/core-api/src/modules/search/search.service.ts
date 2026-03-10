import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Client, ClientDocument } from '../../database/models/client.model';
import { AlertRecord, AlertDocument } from '../../database/models/alert.model';
import { Meeting, MeetingDocument } from '../../database/models/meeting.model';
import { Portfolio, PortfolioDocument } from '../../database/models/portfolio.model';
import { REDIS_CLIENT } from '../cache/cache.service';

// ---------------------------------------------------------------------------
// Extended Redis interface for hash operations
// ---------------------------------------------------------------------------

/**
 * Extended Redis interface that includes hash and expiry operations needed
 * for lookup map management. The real ioredis client satisfies this at runtime.
 */
export interface IRedisHashClient {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<'OK' | unknown>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  ping(): Promise<string>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, ...fieldValues: string[]): Promise<number | unknown>;
  expire(key: string, seconds: number): Promise<number | unknown>;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SearchQuery {
  rm_id: string;
  query: string;
  collections?: ('clients' | 'portfolios' | 'alerts' | 'meetings')[];
  limit?: number;
}

export interface ClientSearchHit {
  client_id: string;
  client_name: string;
  tier: string;
  total_aum: number;
  last_interaction: string;
  score: number;
}

export interface AlertSearchHit {
  alert_id: string;
  title: string;
  message: string;
  client_name: string;
  severity: string;
  status: string;
  score: number;
}

export interface MeetingSearchHit {
  meeting_id: string;
  client_name: string;
  agenda: string;
  notes: string;
  scheduled_date: string;
  score: number;
}

export interface SearchResult {
  clients: ClientSearchHit[];
  alerts: AlertSearchHit[];
  meetings: MeetingSearchHit[];
  total: number;
  took_ms: number;
}

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

const LOOKUP_KEY = (rmId: string): string => `lookup:rm:${rmId}:clients`;
const LOOKUP_PAN_KEY = (rmId: string): string => `lookup:rm:${rmId}:clients:pan`;
const LOOKUP_TTL = 3600; // seconds

// ---------------------------------------------------------------------------
// SearchService
// ---------------------------------------------------------------------------

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @InjectModel(Client.name) private readonly clientModel: Model<ClientDocument>,
    @InjectModel(AlertRecord.name) private readonly alertModel: Model<AlertDocument>,
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    @InjectModel(Portfolio.name) private readonly portfolioModel: Model<PortfolioDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: IRedisHashClient,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Full-text search across clients, alerts, and meetings simultaneously.
   * Uses MongoDB $text operator backed by text indexes.
   */
  async searchAll(query: SearchQuery): Promise<SearchResult> {
    const start = Date.now();
    const { rm_id, query: q, collections, limit = 10 } = query;
    const effectiveCollections = collections ?? ['clients', 'alerts', 'meetings'];

    const searches: Promise<unknown>[] = [];

    const wantClients = effectiveCollections.includes('clients');
    const wantAlerts = effectiveCollections.includes('alerts');
    const wantMeetings = effectiveCollections.includes('meetings');

    searches.push(
      wantClients ? this.searchClients(rm_id, q, limit) : Promise.resolve([]),
      wantAlerts ? this.searchAlerts(rm_id, q, limit) : Promise.resolve([]),
      wantMeetings ? this.searchMeetings(rm_id, q, limit) : Promise.resolve([]),
    );

    const [clients, alerts, meetings] = (await Promise.all(searches)) as [
      ClientSearchHit[],
      AlertSearchHit[],
      MeetingSearchHit[],
    ];

    const total = clients.length + alerts.length + meetings.length;
    const took_ms = Date.now() - start;

    this.logger.log(`searchAll rm_id=${rm_id} q="${q}" total=${total} took=${took_ms}ms`);

    return { clients, alerts, meetings, total, took_ms };
  }

  /**
   * Ultra-fast client name lookup (<200ms).
   * Strategy:
   *   1. Redis HGET (lookup map) — O(1), sub-millisecond
   *   2. MongoDB $text search fallback
   *   3. MongoDB regex fallback
   *   4. Update Redis on miss
   */
  async findClientByName(rmId: string, name: string): Promise<ClientSearchHit | null> {
    const normalized = name.toLowerCase().trim();

    // 1. Redis lookup
    const redisKey = LOOKUP_KEY(rmId);
    try {
      const clientId = await this.redis.hget(redisKey, normalized);
      if (clientId) {
        this.logger.debug(`Redis HIT lookup:rm:${rmId}:clients -> ${clientId}`);
        const client = await this.clientModel
          .findOne({ client_id: clientId, rm_id: rmId })
          .lean()
          .exec();
        if (client) {
          return this.toClientHit(client, 1.0);
        }
      }
    } catch (err) {
      this.logger.warn(`Redis lookup failed: ${(err as Error).message}`);
    }

    // 2. MongoDB $text search
    let best: ClientSearchHit | null = null;
    try {
      const textResults = await this.clientModel
        .find(
          { $text: { $search: name }, rm_id: rmId },
          { score: { $meta: 'textScore' } },
        )
        .sort({ score: { $meta: 'textScore' } })
        .limit(5)
        .lean()
        .exec();

      if (textResults.length > 0) {
        best = this.toClientHit(textResults[0], (textResults[0] as Record<string, unknown>)['score'] as number ?? 1.0);
      }
    } catch (err) {
      this.logger.warn(`MongoDB $text search failed: ${(err as Error).message}`);
    }

    // 3. Regex fallback if $text yielded nothing
    if (!best) {
      try {
        const regexResult = await this.clientModel
          .findOne({ client_name: { $regex: name, $options: 'i' }, rm_id: rmId })
          .lean()
          .exec();
        if (regexResult) {
          best = this.toClientHit(regexResult, 0.8);
        }
      } catch (err) {
        this.logger.warn(`MongoDB regex search failed: ${(err as Error).message}`);
      }
    }

    // 4. Fuzzy fallback across known client names
    if (!best) {
      best = await this.fuzzyClientFallback(rmId, name);
    }

    // 5. Update Redis lookup map on miss
    if (best) {
      await this.updateLookupEntry(rmId, best.client_name, best.client_id);
    }

    return best;
  }

  /**
   * Build/rebuild Redis HASH lookup maps for all of an RM's clients.
   * Key: lookup:rm:{rmId}:clients  HASH field=lowercase_name value=client_id
   * Key: lookup:rm:{rmId}:clients:pan  HASH field=pan value=client_id
   */
  async buildLookupMaps(rmId: string): Promise<void> {
    this.logger.log(`Building lookup maps for rm_id=${rmId}`);

    const clients = await this.clientModel
      .find({ rm_id: rmId }, { client_id: 1, client_name: 1, pan: 1 })
      .lean()
      .exec();

    if (clients.length === 0) {
      this.logger.warn(`No clients found for rm_id=${rmId}`);
      return;
    }

    const nameKey = LOOKUP_KEY(rmId);
    const panKey = LOOKUP_PAN_KEY(rmId);

    // Build field-value pairs for HSET
    const nameFields: string[] = [];
    const panFields: string[] = [];

    for (const c of clients) {
      const name = (c.client_name ?? '').toLowerCase().trim();
      if (name) {
        nameFields.push(name, c.client_id);
      }
      if (c.pan) {
        panFields.push(c.pan.toLowerCase().trim(), c.client_id);
      }
    }

    try {
      if (nameFields.length > 0) {
        await this.redis.hset(nameKey, ...nameFields);
        await this.redis.expire(nameKey, LOOKUP_TTL);
      }
      if (panFields.length > 0) {
        await this.redis.hset(panKey, ...panFields);
        await this.redis.expire(panKey, LOOKUP_TTL);
      }
      this.logger.log(`Lookup maps built for rm_id=${rmId}: ${clients.length} clients`);
    } catch (err) {
      this.logger.error(`Failed to build lookup maps for rm_id=${rmId}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Compute fuzzy similarity between two strings.
   * Returns a score 0–1.
   */
  fuzzyScore(query: string, candidate: string): number {
    const q = query.toLowerCase();
    const c = candidate.toLowerCase();
    if (c.includes(q) || q.includes(c)) return 0.95;
    const qChars = new Set(q.split(''));
    const cChars = new Set(c.split(''));
    const common = [...qChars].filter((ch) => cChars.has(ch)).length;
    return common / Math.max(qChars.size, cChars.size);
  }

  /**
   * Filter candidates to those scoring >= 0.7 similarity with the query.
   */
  fuzzyFilter(query: string, candidates: string[]): string[] {
    return candidates.filter((c) => this.fuzzyScore(query, c) >= 0.7);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async searchClients(
    rmId: string,
    q: string,
    limit: number,
  ): Promise<ClientSearchHit[]> {
    try {
      const results = await this.clientModel
        .find(
          { $text: { $search: q }, rm_id: rmId },
          { score: { $meta: 'textScore' } },
        )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean()
        .exec();

      return results.map((r) =>
        this.toClientHit(r, (r as Record<string, unknown>)['score'] as number ?? 1.0),
      );
    } catch (err) {
      this.logger.warn(`searchClients failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async searchAlerts(
    rmId: string,
    q: string,
    limit: number,
  ): Promise<AlertSearchHit[]> {
    try {
      const results = await this.alertModel
        .find(
          { $text: { $search: q }, rm_id: rmId },
          { score: { $meta: 'textScore' } },
        )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean()
        .exec();

      return results.map((r) => ({
        alert_id: r.alert_id,
        title: r.title,
        message: r.message,
        client_name: r.client_name,
        severity: r.severity,
        status: r.status,
        score: (r as Record<string, unknown>)['score'] as number ?? 1.0,
      }));
    } catch (err) {
      this.logger.warn(`searchAlerts failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async searchMeetings(
    rmId: string,
    q: string,
    limit: number,
  ): Promise<MeetingSearchHit[]> {
    try {
      const results = await this.meetingModel
        .find(
          { $text: { $search: q }, rm_id: rmId },
          { score: { $meta: 'textScore' } },
        )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean()
        .exec();

      return results.map((r) => ({
        meeting_id: r.meeting_id,
        client_name: r.client_name,
        agenda: r.agenda ?? '',
        notes: r.notes ?? '',
        scheduled_date: r.scheduled_date ? new Date(r.scheduled_date).toISOString() : '',
        score: (r as Record<string, unknown>)['score'] as number ?? 1.0,
      }));
    } catch (err) {
      this.logger.warn(`searchMeetings failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async fuzzyClientFallback(rmId: string, name: string): Promise<ClientSearchHit | null> {
    try {
      const candidates = await this.clientModel
        .find({ rm_id: rmId }, { client_id: 1, client_name: 1, tier: 1, total_aum: 1, last_interaction: 1 })
        .limit(200)
        .lean()
        .exec();

      let best: { hit: ClientSearchHit; score: number } | null = null;
      for (const c of candidates) {
        const score = this.fuzzyScore(name, c.client_name ?? '');
        if (score >= 0.7 && (!best || score > best.score)) {
          best = { hit: this.toClientHit(c, score), score };
        }
      }
      return best ? best.hit : null;
    } catch (err) {
      this.logger.warn(`fuzzyClientFallback failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async updateLookupEntry(rmId: string, clientName: string, clientId: string): Promise<void> {
    try {
      const key = LOOKUP_KEY(rmId);
      const field = clientName.toLowerCase().trim();
      await this.redis.hset(key, field, clientId);
      await this.redis.expire(key, LOOKUP_TTL);
    } catch (err) {
      this.logger.warn(`updateLookupEntry failed: ${(err as Error).message}`);
    }
  }

  private toClientHit(client: Record<string, unknown>, score: number): ClientSearchHit {
    return {
      client_id: client['client_id'] as string,
      client_name: client['client_name'] as string,
      tier: client['tier'] as string,
      total_aum: client['total_aum'] as number,
      last_interaction: client['last_interaction']
        ? new Date(client['last_interaction'] as string).toISOString()
        : '',
      score,
    };
  }
}
