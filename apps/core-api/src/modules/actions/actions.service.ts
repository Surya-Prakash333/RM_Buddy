import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Pipeline, PipelineDocument } from '../../database/models/pipeline.model';
import { Portfolio, PortfolioDocument } from '../../database/models/portfolio.model';
import { Client, ClientDocument } from '../../database/models/client.model';
import { Meeting, MeetingDocument } from '../../database/models/meeting.model';
import { CacheService } from '../cache/cache.service';
import {
  DailyActionsData,
  DailyActionsSummary,
  PipelineAgingItem,
  ProposalPendingItem,
  FollowUpItem,
  IdleCashItem,
  ActionPriority,
  ScoredAction,
  ScoredActionPriority,
  RankedActionsData,
} from './dto/actions.dto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Redis TTL for per-RM daily-actions cache (15 minutes). */
const ACTIONS_CACHE_TTL_SECONDS = 900;

/** Pipeline deals stuck longer than this threshold are flagged. */
const PIPELINE_AGING_THRESHOLD_DAYS = 7;

/** Proposals awaiting client response longer than this are flagged. */
const PROPOSAL_PENDING_THRESHOLD_DAYS = 5;

/** Include follow-ups overdue up to this many days back. */
const FOLLOWUP_OVERDUE_DAYS_BACK = 7;

/** Minimum cash percentage to flag an idle-cash client. */
const IDLE_CASH_PCT_THRESHOLD = 15;

/** Minimum cash balance (₹) to flag an idle-cash client. */
const IDLE_CASH_BALANCE_THRESHOLD = 50_000;

/** Minimum days since last investment to flag an idle-cash client. */
const IDLE_CASH_DAYS_THRESHOLD = 30;

// ---------------------------------------------------------------------------
// Tier → Priority helpers
// ---------------------------------------------------------------------------

const HIGH_TIERS = new Set(['DIAMOND', 'PLATINUM', 'ULTRA_HNI']);
const MEDIUM_TIERS = new Set(['GOLD', 'HNI']);

function tierToPriority(tier: string, amount = 0): ActionPriority {
  const t = (tier ?? '').toUpperCase();
  if (HIGH_TIERS.has(t)) return 'HIGH';
  if (MEDIUM_TIERS.has(t) && amount >= 1_000_000) return 'HIGH';
  if (MEDIUM_TIERS.has(t)) return 'MEDIUM';
  return 'LOW';
}

function priorityOrder(p: ActionPriority): number {
  return p === 'HIGH' ? 0 : p === 'MEDIUM' ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Raw document shapes returned from MongoDB aggregations
// ---------------------------------------------------------------------------

interface PipelineAggRow {
  pipeline_id: string;
  client_id: string;
  client_name: string;
  client_tier: string;
  amount: number;
  asset_class: string;
  sub_product: string;
  status: string;
  last_updated: Date;
}

interface IdleCashAggRow {
  client_id: string;
  client_name: string;
  client_tier: string;
  cash_balance: number;
  cash_pct: number;
  last_interaction: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * ActionsService aggregates four data sources into a single DailyActionsData
 * payload used by the Daily Actions card on the RM Buddy front-end.
 *
 * Sources:
 *   1. Pipeline (stagnant deals)
 *   2. Pipeline with status=PROPOSAL_SENT (pending proposals)
 *   3. Meetings with type=follow_up (follow-ups due)
 *   4. Portfolios with high cash balance (idle cash)
 *
 * Results are cached in Redis for 15 minutes per RM per date.
 */
@Injectable()
export class ActionsService {
  private readonly logger = new Logger(ActionsService.name);

  constructor(
    @InjectModel(Pipeline.name) private readonly pipelineModel: Model<PipelineDocument>,
    @InjectModel(Portfolio.name) private readonly portfolioModel: Model<PortfolioDocument>,
    @InjectModel(Client.name) private readonly clientModel: Model<ClientDocument>,
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    private readonly cacheService: CacheService,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async getActionsData(rmId: string, date: string): Promise<DailyActionsData> {
    const cacheKey = `actions:${rmId}:${date}`;

    const cached = await this.cacheService.readThrough<DailyActionsData>(
      cacheKey,
      async () => this.fetchActionsFromDB(rmId, date),
      ACTIONS_CACHE_TTL_SECONDS,
    );

    if (cached) return cached;

    // Defensive: readThrough should never return null when fetchFn succeeds.
    return this.fetchActionsFromDB(rmId, date);
  }

  async getActionsSummary(rmId: string): Promise<DailyActionsSummary> {
    const today = new Date().toISOString().split('T')[0];
    const data = await this.getActionsData(rmId, today);
    return {
      total_actions: data.total_actions,
      pipeline_count: data.pipeline_aging.count,
      proposals_count: data.proposals_pending.count,
      followups_count: data.follow_ups_due.count,
      idle_cash_count: data.idle_cash_clients.count,
    };
  }

  /**
   * Fetches raw actions data then scores, ranks, and caches the result.
   * Cache TTL: 15 minutes (900 seconds).
   */
  async getRankedActions(rmId: string, date: string): Promise<RankedActionsData> {
    const cacheKey = `actions:ranked:${rmId}:${date}`;
    const cached = await this.cacheService.get<RankedActionsData>(cacheKey);
    if (cached) return cached;

    const rawData = await this.getActionsData(rmId, date);
    const ranked = this.scoreAndRankActions(rmId, rawData);
    await this.cacheService.set(cacheKey, ranked, 900);
    return ranked;
  }

  /**
   * Converts all 4 action sources into scored, ranked ScoredAction items.
   * Sorting is descending by priority_score.
   */
  scoreAndRankActions(rmId: string, data: DailyActionsData): RankedActionsData {
    const all: ScoredAction[] = [];

    // Source 1: Pipeline aging
    for (const item of data.pipeline_aging.items) {
      const score = this.computePriorityScore(item, 'pipeline');
      all.push({
        action_id: `pipeline-${item.pipeline_id}`,
        source: 'pipeline',
        client_name: item.client_name,
        client_tier: item.client_tier,
        title: `Pipeline Follow-up: ${item.product}`,
        description: item.action_needed,
        amount: item.deal_amount,
        days_pending: item.days_in_stage,
        priority_score: score,
        priority: this.mapToPriority(score),
      });
    }

    // Source 2: Proposals pending
    for (const item of data.proposals_pending.items) {
      const score = this.computePriorityScore(item, 'proposal');
      all.push({
        action_id: `proposal-${item.proposal_id}`,
        source: 'proposal',
        client_name: item.client_name,
        client_tier: item.client_tier,
        title: `Proposal Pending: ${item.proposed_product}`,
        description: item.action_needed,
        amount: item.proposal_amount,
        days_pending: item.days_pending,
        due_date: item.submitted_date,
        priority_score: score,
        priority: this.mapToPriority(score),
      });
    }

    // Source 3: Follow-ups due
    for (const item of data.follow_ups_due.items) {
      const score = this.computePriorityScore(item, 'followup');
      all.push({
        action_id: `followup-${item.followup_id}`,
        source: 'followup',
        client_name: item.client_name,
        client_tier: item.client_tier,
        title: `Follow-up: ${item.client_name}`,
        description: item.action_needed,
        days_pending: item.days_overdue,
        due_date: item.due_date,
        priority_score: score,
        priority: this.mapToPriority(score),
      });
    }

    // Source 4: Idle cash clients
    for (const item of data.idle_cash_clients.items) {
      const score = this.computePriorityScore(item, 'idle_cash');
      all.push({
        action_id: `idle_cash-${item.client_id}`,
        source: 'idle_cash',
        client_id: item.client_id,
        client_name: item.client_name,
        client_tier: item.client_tier,
        title: `Idle Cash: ${item.client_name}`,
        description: item.action_needed,
        amount: item.cash_balance,
        days_pending: item.days_idle,
        priority_score: score,
        priority: this.mapToPriority(score),
      });
    }

    // Sort by priority_score descending
    all.sort((a, b) => b.priority_score - a.priority_score);

    return {
      rm_id: rmId,
      date: data.date,
      top_actions: all.slice(0, 10),
      all_actions: all,
      total_count: all.length,
      p1_count: all.filter((a) => a.priority === 'P1_CRITICAL').length,
      p2_count: all.filter((a) => a.priority === 'P2_HIGH').length,
      summary_by_source: {
        pipeline: data.pipeline_aging.count,
        proposal: data.proposals_pending.count,
        followup: data.follow_ups_due.count,
        idle_cash: data.idle_cash_clients.count,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Core aggregation
  // -------------------------------------------------------------------------

  private async fetchActionsFromDB(rmId: string, date: string): Promise<DailyActionsData> {
    const [pipelineItems, proposalItems, followupItems, idleCashItems] = await Promise.all([
      this.fetchPipelineAging(rmId),
      this.fetchPendingProposals(rmId, date),
      this.fetchFollowUpsDue(rmId, date),
      this.fetchIdleCashClients(rmId),
    ]);

    const overdue = followupItems.filter((f) => f.days_overdue > 0).length;

    const result: DailyActionsData = {
      rm_id: rmId,
      date,
      total_actions:
        pipelineItems.length + proposalItems.length + followupItems.length + idleCashItems.length,

      pipeline_aging: {
        count: pipelineItems.length,
        items: pipelineItems,
      },

      proposals_pending: {
        count: proposalItems.length,
        items: proposalItems,
      },

      follow_ups_due: {
        count: followupItems.length,
        overdue,
        items: followupItems,
      },

      idle_cash_clients: {
        count: idleCashItems.length,
        total_idle_amount: idleCashItems.reduce((sum, c) => sum + c.cash_balance, 0),
        items: idleCashItems,
      },

      cached_at: new Date().toISOString(),
    };

    this.logger.debug(
      `fetchActionsFromDB rm=${rmId} date=${date} ` +
        `pipeline=${pipelineItems.length} proposals=${proposalItems.length} ` +
        `followups=${followupItems.length} idleCash=${idleCashItems.length}`,
    );

    return result;
  }

  // -------------------------------------------------------------------------
  // Source 1: Pipeline aging
  // -------------------------------------------------------------------------

  async fetchPipelineAging(rmId: string): Promise<PipelineAgingItem[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PIPELINE_AGING_THRESHOLD_DAYS);

    // Exclude proposals (handled by source 2) and closed/lost deals.
    const rows = await this.pipelineModel.aggregate<PipelineAggRow>([
      {
        $match: {
          rm_id: rmId,
          status: { $nin: ['PROPOSAL_SENT', 'CLOSED_WON', 'CLOSED_LOST', 'LOST'] },
          last_updated: { $lt: cutoff },
        },
      },
      {
        $lookup: {
          from: 'clients',
          localField: 'client_id',
          foreignField: 'client_id',
          as: 'clientDoc',
        },
      },
      { $unwind: { path: '$clientDoc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          pipeline_id: 1,
          client_id: 1,
          client_name: { $ifNull: ['$client_name', '$clientDoc.client_name', 'Unknown'] },
          client_tier: { $ifNull: ['$clientDoc.tier', 'SILVER'] },
          amount: 1,
          asset_class: 1,
          sub_product: 1,
          status: 1,
          last_updated: 1,
        },
      },
      { $sort: { amount: -1 } },
      { $limit: 20 },
    ]).exec();

    const now = Date.now();

    const items: PipelineAgingItem[] = rows.map((row) => {
      const daysInStage = Math.floor(
        (now - new Date(row.last_updated).getTime()) / (1000 * 60 * 60 * 24),
      );
      const product = [row.asset_class, row.sub_product].filter(Boolean).join(' — ');
      const priority = tierToPriority(row.client_tier, row.amount);
      const amtFormatted = this.formatAmount(row.amount);

      return {
        pipeline_id: row.pipeline_id,
        client_name: row.client_name,
        client_tier: row.client_tier,
        deal_amount: row.amount,
        product,
        stage: row.status,
        days_in_stage: daysInStage,
        priority,
        action_needed: `Follow up — stuck ${daysInStage} days in ${row.status} stage (${amtFormatted})`,
      };
    });

    return this.sortByPriorityThenAmount(items, (i) => i.priority, (i) => i.deal_amount);
  }

  // -------------------------------------------------------------------------
  // Source 2: Proposals pending client approval
  // -------------------------------------------------------------------------

  async fetchPendingProposals(rmId: string, _date: string): Promise<ProposalPendingItem[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PROPOSAL_PENDING_THRESHOLD_DAYS);

    const rows = await this.pipelineModel.aggregate<PipelineAggRow>([
      {
        $match: {
          rm_id: rmId,
          status: 'PROPOSAL_SENT',
          last_updated: { $lt: cutoff },
        },
      },
      {
        $lookup: {
          from: 'clients',
          localField: 'client_id',
          foreignField: 'client_id',
          as: 'clientDoc',
        },
      },
      { $unwind: { path: '$clientDoc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          pipeline_id: 1,
          client_id: 1,
          client_name: { $ifNull: ['$client_name', '$clientDoc.client_name', 'Unknown'] },
          client_tier: { $ifNull: ['$clientDoc.tier', 'SILVER'] },
          amount: 1,
          asset_class: 1,
          sub_product: 1,
          status: 1,
          last_updated: 1,
        },
      },
      { $sort: { amount: -1 } },
      { $limit: 20 },
    ]).exec();

    const now = Date.now();

    const items: ProposalPendingItem[] = rows.map((row) => {
      const daysPending = Math.floor(
        (now - new Date(row.last_updated).getTime()) / (1000 * 60 * 60 * 24),
      );
      const product = [row.asset_class, row.sub_product].filter(Boolean).join(' — ');
      const amtFormatted = this.formatAmount(row.amount);

      return {
        proposal_id: row.pipeline_id,
        client_name: row.client_name,
        client_tier: row.client_tier,
        proposal_amount: row.amount,
        proposed_product: product,
        submitted_date: new Date(row.last_updated).toISOString().split('T')[0],
        days_pending: daysPending,
        action_needed: `Follow up on ${amtFormatted} ${product} proposal — ${daysPending} days pending`,
      };
    });

    // Sort: HIGH-tier first, then by days_pending descending
    const tiered = items.map((i) => ({
      ...i,
      _priority: tierToPriority(i.client_tier, i.proposal_amount),
    }));
    tiered.sort(
      (a, b) =>
        priorityOrder(a._priority) - priorityOrder(b._priority) ||
        b.days_pending - a.days_pending,
    );
    return tiered.map(({ _priority: _p, ...rest }) => rest);
  }

  // -------------------------------------------------------------------------
  // Source 3: Follow-ups due today + overdue + tomorrow
  // -------------------------------------------------------------------------

  async fetchFollowUpsDue(rmId: string, date: string): Promise<FollowUpItem[]> {
    const today = new Date(`${date}T00:00:00.000Z`);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pastCutoff = new Date(today);
    pastCutoff.setDate(pastCutoff.getDate() - FOLLOWUP_OVERDUE_DAYS_BACK);
    // Include through end of tomorrow
    const futureCutoff = new Date(tomorrow);
    futureCutoff.setDate(futureCutoff.getDate() + 1);

    // Use Meeting model: meeting_type = 'follow_up' and status != 'COMPLETED'
    type MeetingAggRow = {
      meeting_id: string;
      client_name: string;
      client_tier: string;
      scheduled_date: Date;
      agenda: string;
      priority: string;
    };

    const rows = await this.meetingModel.aggregate<MeetingAggRow>([
      {
        $match: {
          rm_id: rmId,
          meeting_type: { $in: ['follow_up', 'FOLLOW_UP', 'followup'] },
          status: { $nin: ['COMPLETED', 'CANCELLED', 'completed', 'cancelled'] },
          scheduled_date: { $gte: pastCutoff, $lt: futureCutoff },
        },
      },
      {
        $project: {
          _id: 0,
          meeting_id: 1,
          client_name: 1,
          client_tier: 1,
          scheduled_date: 1,
          agenda: 1,
          priority: 1,
        },
      },
      { $sort: { scheduled_date: 1 } },
      { $limit: 20 },
    ]).exec();

    const todayMs = today.getTime();

    const items: FollowUpItem[] = rows.map((row) => {
      const dueDateMs = new Date(row.scheduled_date).getTime();
      const daysOverdue = Math.floor((todayMs - dueDateMs) / (1000 * 60 * 60 * 24));
      const dueDateStr = new Date(row.scheduled_date).toISOString().split('T')[0];
      const description = row.agenda || 'Scheduled follow-up';
      let action_needed: string;
      if (daysOverdue > 0) {
        action_needed = `Overdue follow-up with ${row.client_name} — ${daysOverdue} day(s) past due`;
      } else if (daysOverdue === 0) {
        action_needed = `Follow up with ${row.client_name} today — ${description}`;
      } else {
        action_needed = `Upcoming follow-up with ${row.client_name} tomorrow — ${description}`;
      }

      return {
        followup_id: row.meeting_id,
        client_name: row.client_name,
        client_tier: row.client_tier ?? 'SILVER',
        due_date: dueDateStr,
        days_overdue: daysOverdue,
        description,
        action_needed,
      };
    });

    // Sort: overdue first (highest days_overdue), then HIGH priority tier
    items.sort((a, b) => {
      const overdueA = a.days_overdue > 0 ? 1 : 0;
      const overdueB = b.days_overdue > 0 ? 1 : 0;
      if (overdueB !== overdueA) return overdueB - overdueA;
      return (
        priorityOrder(tierToPriority(a.client_tier)) -
        priorityOrder(tierToPriority(b.client_tier)) ||
        b.days_overdue - a.days_overdue
      );
    });

    return items;
  }

  // -------------------------------------------------------------------------
  // Source 4: Idle cash clients
  // -------------------------------------------------------------------------

  async fetchIdleCashClients(rmId: string): Promise<IdleCashItem[]> {
    const idleCutoff = new Date();
    idleCutoff.setDate(idleCutoff.getDate() - IDLE_CASH_DAYS_THRESHOLD);

    const rows = await this.portfolioModel.aggregate<IdleCashAggRow>([
      {
        $match: {
          rm_id: rmId,
          'summary.cash_pct': { $gt: IDLE_CASH_PCT_THRESHOLD },
          'summary.cash_balance': { $gt: IDLE_CASH_BALANCE_THRESHOLD },
        },
      },
      {
        $lookup: {
          from: 'clients',
          localField: 'client_id',
          foreignField: 'client_id',
          as: 'clientDoc',
        },
      },
      { $unwind: '$clientDoc' },
      {
        $match: {
          'clientDoc.last_interaction': { $lt: idleCutoff },
        },
      },
      {
        $project: {
          _id: 0,
          client_id: 1,
          client_name: '$clientDoc.client_name',
          client_tier: '$clientDoc.tier',
          cash_balance: '$summary.cash_balance',
          cash_pct: '$summary.cash_pct',
          last_interaction: '$clientDoc.last_interaction',
        },
      },
      { $sort: { cash_balance: -1 } },
      { $limit: 10 },
    ]).exec();

    const now = Date.now();

    const items: IdleCashItem[] = rows.map((row) => {
      const daysIdle = Math.floor(
        (now - new Date(row.last_interaction).getTime()) / (1000 * 60 * 60 * 24),
      );
      const amtFormatted = this.formatAmount(row.cash_balance);
      const cashPctStr = row.cash_pct.toFixed(1);

      return {
        client_id: row.client_id,
        client_name: row.client_name,
        client_tier: row.client_tier ?? 'SILVER',
        cash_balance: row.cash_balance,
        cash_pct: row.cash_pct,
        days_idle: daysIdle,
        action_needed: `${amtFormatted} idle cash (${cashPctStr}% of portfolio) — suggest SIP or liquid fund`,
      };
    });

    return this.sortByPriorityThenAmount(items, (i) => tierToPriority(i.client_tier, i.cash_balance), (i) => i.cash_balance);
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /**
   * Computes a composite priority score (0-1000) for an action item.
   *
   * Formula:
   *   score = (tierWeight × 0.4 + urgency × 0.35 + amountFactor × 0.25) × 1000
   *
   * - tierWeight: 0.5 (SILVER) → 1.0 (DIAMOND / ULTRA_HNI)
   * - urgency:    days_in_stage / days_pending / days_overdue / days_idle capped at 30 days
   * - amountFactor: deal / proposal / cash amount capped at ₹50L (5 000 000)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private computePriorityScore(item: any, _source: string): number {
    const tierWeight: Record<string, number> = {
      DIAMOND: 1.0,
      ULTRA_HNI: 1.0,
      PLATINUM: 0.85,
      GOLD: 0.7,
      HNI: 0.7,
      SILVER: 0.5,
    };

    const tier = tierWeight[item['client_tier'] as string] ?? 0.6;

    const days =
      (item['days_in_stage'] as number | undefined) ??
      (item['days_pending'] as number | undefined) ??
      (item['days_overdue'] as number | undefined) ??
      (item['days_idle'] as number | undefined) ??
      0;
    const urgency = Math.min(days / 30, 1.0);

    const amount =
      (item['deal_amount'] as number | undefined) ??
      (item['proposal_amount'] as number | undefined) ??
      (item['cash_balance'] as number | undefined) ??
      0;
    const amountFactor = Math.min(amount / 5_000_000, 1.0);

    return Math.round((tier * 0.4 + urgency * 0.35 + amountFactor * 0.25) * 1000);
  }

  /**
   * Maps a numeric score (0-1000) to a four-tier ScoredActionPriority.
   *
   * ≥ 800 → P1_CRITICAL
   * ≥ 600 → P2_HIGH
   * ≥ 400 → P3_MEDIUM
   *  else → P4_LOW
   */
  private mapToPriority(score: number): ScoredActionPriority {
    if (score >= 800) return 'P1_CRITICAL';
    if (score >= 600) return 'P2_HIGH';
    if (score >= 400) return 'P3_MEDIUM';
    return 'P4_LOW';
  }

  private sortByPriorityThenAmount<T>(
    items: T[],
    getPriority: (item: T) => ActionPriority,
    getAmount: (item: T) => number,
  ): T[] {
    return [...items].sort(
      (a, b) =>
        priorityOrder(getPriority(a)) - priorityOrder(getPriority(b)) ||
        getAmount(b) - getAmount(a),
    );
  }

  /** Format a numeric amount into a human-readable ₹ string. */
  private formatAmount(amount: number): string {
    if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)}Cr`;
    if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)}L`;
    if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(0)}K`;
    return `₹${amount}`;
  }
}
