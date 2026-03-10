import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Meeting, MeetingDocument } from '../../database/models/meeting.model';
import { AlertRecord, AlertDocument } from '../../database/models/alert.model';
import { Portfolio, PortfolioDocument } from '../../database/models/portfolio.model';
import { Transaction, TransactionDocument } from '../../database/models/transaction.model';
import { Client, ClientDocument } from '../../database/models/client.model';
import { CacheService } from '../cache/cache.service';

import {
  BriefingData,
  MeetingsToday,
  PendingTasks,
  ActiveAlerts,
  PortfolioSummary,
  RevenueYTD,
  MeetingItem,
  TaskItem,
  AlertItem,
  ClientMover,
  RankedBriefingData,
  RankedBriefingItem,
  BriefingItemPriority,
} from './dto/briefing.dto';

/** Briefing cache TTL — 5 minutes (data is time-sensitive). */
const BRIEFING_CACHE_TTL = 300;

/** Number of top movers to include in portfolio summary. */
const TOP_MOVERS_COUNT = 3;

/**
 * BriefingService aggregates all data needed for the RM morning briefing.
 *
 * All five data sections are fetched in parallel via Promise.all to meet the
 * <500 ms latency requirement. Results are cached in Redis for 5 minutes.
 *
 * Data sources:
 *  - meetings_today   → meetings collection (rm_id + scheduled_date match)
 *  - pending_tasks    → rm_interactions with type='follow_up' fallback via
 *                       client collection last_interaction heuristic; returns
 *                       empty if no dedicated tasks collection exists
 *  - active_alerts    → alerts collection (status='PENDING' or 'NEW')
 *  - portfolio_summary→ portfolios collection (summary.total_aum + pnl_pct)
 *  - revenue_ytd      → transactions collection aggregate (brokerage YTD sum)
 */
@Injectable()
export class BriefingService {
  private readonly logger = new Logger(BriefingService.name);

  constructor(
    @InjectModel(Meeting.name)
    private readonly meetingModel: Model<MeetingDocument>,

    @InjectModel(AlertRecord.name)
    private readonly alertModel: Model<AlertDocument>,

    @InjectModel(Portfolio.name)
    private readonly portfolioModel: Model<PortfolioDocument>,

    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,

    @InjectModel(Client.name)
    private readonly clientModel: Model<ClientDocument>,

    private readonly cacheService: CacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Return the full morning briefing for an RM on a given date.
   * Checks Redis first; on miss, fetches all 5 sections in parallel.
   *
   * @param rmId  The RM's unique identifier (from X-RM-Identity header).
   * @param date  ISO date string YYYY-MM-DD.
   */
  async getBriefingData(rmId: string, date: string): Promise<BriefingData> {
    const cacheKey = `briefing:${rmId}:${date}`;

    const cached = await this.cacheService.get<BriefingData>(cacheKey);
    if (cached) {
      this.logger.debug(`Briefing cache HIT: ${cacheKey}`);
      return cached;
    }

    this.logger.debug(`Briefing cache MISS: ${cacheKey} — fetching all sections`);

    // Fetch all sections in parallel to satisfy the <500 ms SLA.
    const [meetings, tasks, alerts, portfolio, revenue] = await Promise.all([
      this.fetchMeetingsToday(rmId, date),
      this.fetchPendingTasks(rmId, date),
      this.fetchActiveAlerts(rmId),
      this.fetchPortfolioSummary(rmId),
      this.fetchRevenueYTD(rmId, date),
    ]);

    const briefing: BriefingData = {
      rm_id: rmId,
      date,
      generated_at: new Date().toISOString(),
      meetings_today: meetings,
      pending_tasks: tasks,
      active_alerts: alerts,
      portfolio_summary: portfolio,
      revenue_ytd: revenue,
    };

    await this.cacheService.set(cacheKey, briefing, BRIEFING_CACHE_TTL);

    return briefing;
  }

  // ---------------------------------------------------------------------------
  // Section fetchers (private)
  // ---------------------------------------------------------------------------

  /**
   * Fetch meetings scheduled for the given date, sorted ascending by time.
   */
  async fetchMeetingsToday(rmId: string, date: string): Promise<MeetingsToday> {
    try {
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(`${date}T23:59:59.999Z`);

      const docs = await this.meetingModel
        .find({
          rm_id: rmId,
          scheduled_date: { $gte: dayStart, $lte: dayEnd },
        })
        .lean()
        .exec();

      // Sort by scheduled_time ascending (HH:MM string sort works correctly)
      const sorted = (docs as unknown as Meeting[]).sort((a, b) =>
        (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? ''),
      );

      const items: MeetingItem[] = sorted.map((m) => ({
        meeting_id: m.meeting_id,
        client_name: m.client_name ?? '',
        client_tier: m.client_tier ?? '',
        time: m.scheduled_time ?? '',
        duration_min: m.duration_minutes ?? 0,
        agenda: m.agenda ?? '',
        location: m.location ?? '',
      }));

      return { count: items.length, items };
    } catch (err) {
      this.logger.error(`fetchMeetingsToday error rm=${rmId}: ${(err as Error).message}`);
      return { count: 0, items: [] };
    }
  }

  /**
   * Fetch pending follow-up tasks for the RM.
   *
   * Strategy: query clients where last_interaction is old and return a
   * synthetic task list. If a dedicated tasks/rm_interactions collection
   * exists it would be queried here; for now we use the client model as
   * the source of follow-up signals and mark items past `date` as overdue.
   *
   * Returns empty section (count: 0) gracefully if no data found.
   */
  async fetchPendingTasks(rmId: string, date: string): Promise<PendingTasks> {
    try {
      // Derive pending follow-up tasks from clients with stale last_interaction.
      // Clients not interacted with in the last 30 days surface as pending tasks.
      const thirtyDaysAgo = new Date(date);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const clients = await this.clientModel
        .find({
          rm_id: rmId,
          last_interaction: { $lte: thirtyDaysAgo },
        })
        .lean()
        .exec();

      const today = new Date(date);

      const items: TaskItem[] = (clients as unknown as Client[]).map((c, idx) => {
        const dueDate = new Date(c.last_interaction ?? today);
        dueDate.setDate(dueDate.getDate() + 30);
        const dueDateStr = dueDate.toISOString().split('T')[0];
        const isOverdue = dueDate < today;

        // Determine priority based on client tier
        let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
        if (c.tier === 'ULTRA_HNI' || c.tier === 'HNI') {
          priority = 'HIGH';
        } else if (c.tier === 'AFFLUENT') {
          priority = 'MEDIUM';
        }

        return {
          task_id: `task-followup-${c.client_id ?? idx}`,
          client_name: c.client_name ?? '',
          description: `Follow up with client — no interaction in 30+ days`,
          due_date: dueDateStr,
          is_overdue: isOverdue,
          priority,
        };
      });

      const overdue = items.filter((t) => t.is_overdue).length;

      return { count: items.length, overdue, items };
    } catch (err) {
      this.logger.error(`fetchPendingTasks error rm=${rmId}: ${(err as Error).message}`);
      return { count: 0, overdue: 0, items: [] };
    }
  }

  /**
   * Fetch active (PENDING/NEW) alerts for the RM.
   * Counts critical and high severity alerts separately.
   */
  async fetchActiveAlerts(rmId: string): Promise<ActiveAlerts> {
    try {
      const docs = await this.alertModel
        .find({
          rm_id: rmId,
          status: { $in: ['PENDING', 'NEW'] },
        })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      const records = docs as unknown as (AlertRecord & { createdAt?: Date })[];

      const items: AlertItem[] = records.map((a) => ({
        alert_id: a.alert_id,
        alert_type: a.alert_type,
        client_name: a.client_name ?? '',
        severity: a.severity,
        title: a.title,
        created_at: (a.createdAt ?? new Date()).toISOString(),
      }));

      const critical = items.filter((i) => i.severity === 'critical').length;
      const high = items.filter((i) => i.severity === 'high').length;

      return { count: items.length, critical, high, items };
    } catch (err) {
      this.logger.error(`fetchActiveAlerts error rm=${rmId}: ${(err as Error).message}`);
      return { count: 0, critical: 0, high: 0, items: [] };
    }
  }

  /**
   * Fetch portfolio summary: total AUM across all RM clients, plus top 3
   * gainers and losers ranked by pnl_pct from the holdings array.
   *
   * aum_change_today is estimated as sum of (pnl across all holdings) —
   * actual intraday delta is not stored separately.
   */
  async fetchPortfolioSummary(rmId: string): Promise<PortfolioSummary> {
    try {
      const docs = await this.portfolioModel
        .find({ rm_id: rmId })
        .lean()
        .exec();

      const portfolios = docs as unknown as Portfolio[];

      let totalAum = 0;
      let aumChangeToday = 0;

      // Build per-client AUM + aggregate pnl across all holdings
      const clientMovers: ClientMover[] = [];

      for (const p of portfolios) {
        const aum = p.summary?.total_aum ?? 0;
        totalAum += aum;

        // Sum pnl across holdings as a proxy for today's change
        const totalPnl = (p.holdings ?? []).reduce((sum, h) => sum + (h.pnl ?? 0), 0);
        aumChangeToday += totalPnl;

        // Overall portfolio pnl_pct for ranking (avg pnl_pct of holdings)
        const holdings = p.holdings ?? [];
        const avgPnlPct =
          holdings.length > 0
            ? holdings.reduce((sum, h) => sum + (h.pnl_pct ?? 0), 0) / holdings.length
            : 0;

        clientMovers.push({
          client_id: p.client_id,
          client_name: '', // will be enriched below if needed; kept lightweight
          change_pct: Math.round(avgPnlPct * 100) / 100,
        });
      }

      // Sort to find top gainers and losers
      const sorted = [...clientMovers].sort((a, b) => b.change_pct - a.change_pct);
      const topGainers = sorted.slice(0, TOP_MOVERS_COUNT).filter((c) => c.change_pct > 0);
      const topLosers = sorted
        .slice(-TOP_MOVERS_COUNT)
        .filter((c) => c.change_pct < 0)
        .reverse(); // worst loss first

      // Enrich with client names in a single query
      const allClientIds = [...topGainers, ...topLosers].map((c) => c.client_id);
      if (allClientIds.length > 0) {
        const clients = await this.clientModel
          .find({ client_id: { $in: allClientIds } })
          .select('client_id client_name')
          .lean()
          .exec();

        const nameMap = new Map(
          (clients as unknown as Client[]).map((c) => [c.client_id, c.client_name]),
        );

        for (const mover of [...topGainers, ...topLosers]) {
          mover.client_name = nameMap.get(mover.client_id) ?? '';
        }
      }

      return {
        total_aum: Math.round(totalAum),
        aum_change_today: Math.round(aumChangeToday),
        top_gainers: topGainers,
        top_losers: topLosers,
      };
    } catch (err) {
      this.logger.error(`fetchPortfolioSummary error rm=${rmId}: ${(err as Error).message}`);
      return { total_aum: 0, aum_change_today: 0, top_gainers: [], top_losers: [] };
    }
  }

  // ---------------------------------------------------------------------------
  // Logic layer — ranking & idempotency (S2-F1-L2-Logic)
  // ---------------------------------------------------------------------------

  /**
   * Return a ranked briefing idempotently.
   *
   * Same briefing_id and ranked result is returned for the same rmId+date
   * combination. The ranked result is cached with a 24-hour TTL so repeated
   * intraday calls are cheap and deterministic.
   *
   * @param rmId  The RM's unique identifier.
   * @param date  ISO date string YYYY-MM-DD.
   */
  async getIdempotentBriefing(rmId: string, date: string): Promise<RankedBriefingData> {
    const briefingId = `${rmId}-${date}`;
    const idempotencyKey = `briefing:ranked:${rmId}:${date}`;

    const cached = await this.cacheService.get<RankedBriefingData>(idempotencyKey);
    if (cached) {
      this.logger.debug(`Ranked briefing cache HIT: ${idempotencyKey}`);
      return { ...cached, briefing_id: briefingId };
    }

    this.logger.debug(`Ranked briefing cache MISS: ${idempotencyKey} — generating`);

    const rawData = await this.getBriefingData(rmId, date);
    const ranked = this.rankBriefingData(rawData);
    ranked.briefing_id = briefingId;

    // Cache with 24-hour TTL — briefing is fixed for the day.
    await this.cacheService.set(idempotencyKey, ranked, 86400);

    return ranked;
  }

  /**
   * Convert all items from all 5 sections into a flat ranked list.
   *
   * Each item receives an urgency_score (0-100), an importance_score (0-100),
   * and a combined_score = Math.round(urgency × importance / 100).
   * The list is sorted descending by combined_score.
   *
   * @param data  Raw briefing data from getBriefingData.
   */
  rankBriefingData(data: BriefingData): RankedBriefingData {
    const items: RankedBriefingItem[] = [];

    // 1. Alerts
    for (const alert of data.active_alerts.items) {
      const urgency = this.computeAlertUrgency(alert);
      const importance = this.computeImportance(alert as unknown as Record<string, unknown>);
      const combined = Math.round((urgency * importance) / 100);
      const priority = this.scoreToPriority(combined);

      items.push({
        item_type: 'ALERT',
        priority,
        urgency_score: urgency,
        importance_score: importance,
        combined_score: combined,
        title: alert.title,
        subtitle: `${alert.alert_type} — ${alert.severity.toUpperCase()}`,
        client_name: alert.client_name || undefined,
        action: 'Review and respond to alert',
        source_data: alert as unknown as Record<string, unknown>,
      });
    }

    // 2. Meetings
    for (const meeting of data.meetings_today.items) {
      const urgency = this.computeMeetingUrgency(meeting);
      const importance = this.computeImportance(meeting as unknown as Record<string, unknown>);
      const combined = Math.round((urgency * importance) / 100);
      const priority = this.scoreToPriority(combined);

      items.push({
        item_type: 'MEETING',
        priority,
        urgency_score: urgency,
        importance_score: importance,
        combined_score: combined,
        title: `Meeting with ${meeting.client_name}`,
        subtitle: `${meeting.time} — ${meeting.agenda}`,
        client_name: meeting.client_name || undefined,
        due_at: meeting.time,
        action: 'Prepare and attend meeting',
        source_data: meeting as unknown as Record<string, unknown>,
      });
    }

    // 3. Tasks
    for (const task of data.pending_tasks.items) {
      const urgency = this.computeTaskUrgency(task);
      const importance = this.computeImportance(task as unknown as Record<string, unknown>);
      const combined = Math.round((urgency * importance) / 100);
      const priority = this.scoreToPriority(combined);

      items.push({
        item_type: 'TASK',
        priority,
        urgency_score: urgency,
        importance_score: importance,
        combined_score: combined,
        title: task.description,
        subtitle: `Due: ${task.due_date}${task.is_overdue ? ' (OVERDUE)' : ''}`,
        client_name: task.client_name || undefined,
        due_at: task.due_date,
        action: task.is_overdue ? 'Immediately follow up — task is overdue' : 'Follow up with client',
        source_data: task as unknown as Record<string, unknown>,
      });
    }

    // 4. Portfolio movers → PORTFOLIO_ALERT items for significant losers
    for (const loser of data.portfolio_summary.top_losers) {
      const urgency = 50; // portfolio movers are medium urgency by default
      const importance = this.computeImportance(loser as unknown as Record<string, unknown>);
      const combined = Math.round((urgency * importance) / 100);
      const priority = this.scoreToPriority(combined);

      items.push({
        item_type: 'PORTFOLIO_ALERT',
        priority,
        urgency_score: urgency,
        importance_score: importance,
        combined_score: combined,
        title: `Portfolio decline: ${loser.client_name || loser.client_id}`,
        subtitle: `Change: ${loser.change_pct}%`,
        client_id: loser.client_id || undefined,
        client_name: loser.client_name || undefined,
        action: 'Review portfolio and consider rebalancing',
        source_data: loser as unknown as Record<string, unknown>,
      });
    }

    // Sort descending by combined_score
    items.sort((a, b) => b.combined_score - a.combined_score);

    const top5 = items.slice(0, 5);

    return {
      ...data,
      briefing_id: `${data.rm_id}-${data.date}`, // will be overwritten by caller if needed
      ranked_items: items,
      top_priorities: top5,
    };
  }

  // ---------------------------------------------------------------------------
  // Scoring helpers (private)
  // ---------------------------------------------------------------------------

  /** Compute urgency score (0-100) for an alert based on its severity. */
  private computeAlertUrgency(alert: AlertItem): number {
    const severityMap: Record<string, number> = {
      CRITICAL: 100,
      critical: 100,
      HIGH: 80,
      high: 80,
      MEDIUM: 50,
      medium: 50,
      LOW: 30,
      low: 30,
    };
    return severityMap[alert.severity] ?? 50;
  }

  /** Compute urgency score (0-100) for a meeting based on how soon it starts. */
  private computeMeetingUrgency(meeting: MeetingItem): number {
    const hours = this.hoursUntilMeeting(meeting.time);
    if (hours <= 2) return 90;
    if (hours <= 4) return 70;
    return 50;
  }

  /** Compute urgency score (0-100) for a task. Overdue tasks get max urgency. */
  private computeTaskUrgency(task: TaskItem): number {
    return task.is_overdue ? 100 : 60;
  }

  /**
   * Compute importance score (0-100) based on client tier and monetary amount.
   *
   * Formula:
   *   tierWeight  = DIAMOND→1.0, PLATINUM→0.85, GOLD→0.7, SILVER→0.5, else 0.6
   *   amountScore = min(amount / 1_000_000, 1.0)   (caps at 10L = 1.0)
   *   importance  = round((tierWeight * 0.6 + amountScore * 0.4) * 100)
   */
  computeImportance(item: Record<string, unknown>): number {
    const tierMap: Record<string, number> = {
      DIAMOND: 1.0,
      PLATINUM: 0.85,
      GOLD: 0.7,
      SILVER: 0.5,
    };
    const tier = (item['client_tier'] as string | undefined) ?? '';
    const tierWeight = tierMap[tier] ?? 0.6;

    const amount =
      (item['total_aum'] as number | undefined) ??
      (item['cash_balance'] as number | undefined) ??
      (item['proposal_amount'] as number | undefined) ??
      0;
    const amountScore = Math.min(amount / 1_000_000, 1.0);

    return Math.round((tierWeight * 0.6 + amountScore * 0.4) * 100);
  }

  /**
   * Parse a HH:MM time string and return how many hours remain until that time
   * from the current moment. Returns 0 if the time has already passed today.
   */
  hoursUntilMeeting(time: string): number {
    const [hourStr, minuteStr] = time.split(':');
    const meetingHour = parseInt(hourStr ?? '0', 10);
    const meetingMinute = parseInt(minuteStr ?? '0', 10);

    const now = new Date();
    const meetingMinutesFromMidnight = meetingHour * 60 + meetingMinute;
    const nowMinutesFromMidnight = now.getHours() * 60 + now.getMinutes();

    const diffMinutes = meetingMinutesFromMidnight - nowMinutesFromMidnight;
    return diffMinutes > 0 ? diffMinutes / 60 : 0;
  }

  /** Map a combined_score (0-100) to a BriefingItemPriority label. */
  private scoreToPriority(score: number): BriefingItemPriority {
    if (score >= 75) return 'CRITICAL';
    if (score >= 50) return 'HIGH';
    if (score >= 25) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Fetch revenue YTD by aggregating brokerage from executed transactions
   * from Jan 1 of the current year through the given date.
   *
   * target and vs_last_year default to 0 if no reference data exists.
   */
  async fetchRevenueYTD(rmId: string, date: string): Promise<RevenueYTD> {
    try {
      const year = date.split('-')[0];
      const ytdStart = `${year}-01-01`;

      // YTD aggregate
      const ytdResult = await this.transactionModel
        .aggregate([
          {
            $match: {
              rm_id: rmId,
              txn_date: {
                $gte: new Date(ytdStart),
                $lte: new Date(date),
              },
              status: 'Executed',
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$brokerage' },
            },
          },
        ])
        .exec();

      const amount = ytdResult[0]?.total ?? 0;

      // Prior year aggregate (same date range, year-1) for YoY comparison
      const priorYearStart = `${Number(year) - 1}-01-01`;
      const priorYearEnd = `${Number(year) - 1}-${date.slice(5)}`; // same MM-DD

      const priorResult = await this.transactionModel
        .aggregate([
          {
            $match: {
              rm_id: rmId,
              txn_date: {
                $gte: new Date(priorYearStart),
                $lte: new Date(priorYearEnd),
              },
              status: 'Executed',
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$brokerage' },
            },
          },
        ])
        .exec();

      const priorAmount = priorResult[0]?.total ?? 0;
      const vsLastYear = priorAmount > 0 ? Math.round(((amount - priorAmount) / priorAmount) * 10000) / 100 : 0;

      // No target data stored — default to 0
      const target = 0;
      const achievementPct = target > 0 ? Math.round((amount / target) * 10000) / 100 : 0;

      return {
        amount: Math.round(amount),
        target,
        achievement_pct: achievementPct,
        vs_last_year: vsLastYear,
      };
    } catch (err) {
      this.logger.error(`fetchRevenueYTD error rm=${rmId}: ${(err as Error).message}`);
      return { amount: 0, target: 0, achievement_pct: 0, vs_last_year: 0 };
    }
  }
}
