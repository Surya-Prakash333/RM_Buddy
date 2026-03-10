import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { RMSession, RMSessionDocument } from '../../database/models/rm-session.model';
import { AuditTrail, AuditDocument } from '../../database/models/audit.model';
import { CacheService } from '../cache/cache.service';
import { EngagementData, EngagementTrendPoint } from './dto/engagement.dto';

/** Cache TTL — 30 minutes. */
const ENGAGEMENT_CACHE_TTL = 1800;

/** Weights for the consistency score sub-components. */
const WEIGHTS = {
  login_regularity: 0.4,
  session_depth: 0.3,
  crm_usage: 0.3,
} as const;

/**
 * EngagementService computes engagement metrics for a given RM.
 *
 * Data sources:
 *  - `rm_sessions`  (RMSession model) — login timestamps, session duration
 *  - `audit_trail`  (AuditTrail model) — CRM action counts, pages visited
 *
 * Read pattern: Redis (30-min TTL) → MongoDB aggregation fallback.
 * Graceful degradation: when collections are empty, returns 0-valued fields
 * with `is_estimated: true`.
 */
@Injectable()
export class EngagementService {
  private readonly logger = new Logger(EngagementService.name);

  constructor(
    @InjectModel(RMSession.name)
    private readonly sessionModel: Model<RMSessionDocument>,

    @InjectModel(AuditTrail.name)
    private readonly auditModel: Model<AuditDocument>,

    private readonly cache: CacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Return the full engagement snapshot for `rmId` over `period`.
   * `period` must be a YYYY-MM string (e.g. "2024-01").  Defaults to the
   * current calendar month when omitted.
   *
   * Result is cached under `engagement:{rmId}:{period}` for 30 minutes.
   */
  async getEngagementData(rmId: string, period: string): Promise<EngagementData> {
    const resolvedPeriod = this.resolvePeriod(period);
    const cacheKey = `engagement:${rmId}:${resolvedPeriod}`;

    return this.cache.readThrough<EngagementData>(
      cacheKey,
      () => this.computeEngagementData(rmId, resolvedPeriod),
      ENGAGEMENT_CACHE_TTL,
    ).then(data => data ?? this.emptyEngagementData(rmId, resolvedPeriod));
  }

  /**
   * Return an array of daily consistency snapshots for the last `days` calendar
   * days (including today).  Not cached — data is relatively cheap to compute
   * and changes frequently throughout the day.
   */
  async getEngagementTrend(rmId: string, days: number): Promise<EngagementTrendPoint[]> {
    const today = new Date();
    const points: EngagementTrendPoint[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = this.toDateString(date);

      const point = await this.computeDailyPoint(rmId, date, dateStr);
      points.push(point);
    }

    return points;
  }

  // ---------------------------------------------------------------------------
  // Core computation
  // ---------------------------------------------------------------------------

  private async computeEngagementData(rmId: string, period: string): Promise<EngagementData> {
    const { start, end, workingDays } = this.periodBoundaries(period);

    const [sessionStats, auditStats, previousScore] = await Promise.all([
      this.aggregateSessionStats(rmId, start, end),
      this.aggregateAuditStats(rmId, start, end),
      this.computePreviousPeriodScore(rmId, period),
    ]);

    const isEstimated = sessionStats.total_sessions === 0 && auditStats.crm_actions_total === 0;

    const loginRegularity = workingDays > 0
      ? Math.min(sessionStats.login_days / workingDays, 1) * 100
      : 0;

    const sessionDepth = Math.min(sessionStats.avg_session_duration_min / 60, 1) * 100;

    const crmUsage = Math.min(auditStats.avg_daily_crm_actions / 20, 1) * 100;

    const consistency_score = this.computeScore(loginRegularity, sessionDepth, crmUsage);

    const consistency_trend = this.classifyTrend(consistency_score, previousScore);

    const data: EngagementData = {
      rm_id: rmId,
      period,
      login_days: sessionStats.login_days,
      total_sessions: sessionStats.total_sessions,
      avg_session_duration_min: sessionStats.avg_session_duration_min,
      longest_session_min: sessionStats.longest_session_min,
      login_streak_days: sessionStats.login_streak_days,
      last_login_at: sessionStats.last_login_at,
      crm_actions_total: auditStats.crm_actions_total,
      avg_daily_crm_actions: auditStats.avg_daily_crm_actions,
      pages_visited: auditStats.pages_visited,
      consistency_score,
      consistency_trend,
      is_estimated: isEstimated,
    };

    this.logger.debug(
      `Computed engagement data rm=${rmId} period=${period} score=${consistency_score}`,
    );

    return data;
  }

  // ---------------------------------------------------------------------------
  // Session aggregation
  // ---------------------------------------------------------------------------

  private async aggregateSessionStats(
    rmId: string,
    start: Date,
    end: Date,
  ): Promise<{
    login_days: number;
    total_sessions: number;
    avg_session_duration_min: number;
    longest_session_min: number;
    login_streak_days: number;
    last_login_at: string;
  }> {
    try {
      const sessions = await this.sessionModel
        .find({
          rm_id: rmId,
          createdAt: { $gte: start, $lte: end },
        })
        .lean()
        .exec();

      if (sessions.length === 0) {
        return {
          login_days: 0,
          total_sessions: 0,
          avg_session_duration_min: 0,
          longest_session_min: 0,
          login_streak_days: 0,
          last_login_at: '',
        };
      }

      // Unique calendar days
      const daySet = new Set<string>();
      let totalDurationMin = 0;
      let longestMin = 0;
      let latestCreatedAt: Date | null = null;

      for (const s of sessions) {
        const created = (s as any).createdAt as Date | undefined;
        const lastActive = s.last_active as Date | undefined;

        if (created) {
          daySet.add(this.toDateString(created));
          if (!latestCreatedAt || created > latestCreatedAt) {
            latestCreatedAt = created;
          }

          // Session duration = last_active - created (fall back to 0 if missing)
          if (lastActive && lastActive > created) {
            const durationMin = (lastActive.getTime() - created.getTime()) / 60_000;
            totalDurationMin += durationMin;
            if (durationMin > longestMin) longestMin = durationMin;
          }
        }
      }

      const total_sessions = sessions.length;
      const login_days = daySet.size;
      const avg_session_duration_min =
        total_sessions > 0 ? Math.round((totalDurationMin / total_sessions) * 10) / 10 : 0;
      const longest_session_min = Math.round(longestMin * 10) / 10;
      const last_login_at = latestCreatedAt ? latestCreatedAt.toISOString() : '';

      // Compute current consecutive login streak (counting backwards from today)
      const login_streak_days = this.computeStreak(Array.from(daySet));

      return {
        login_days,
        total_sessions,
        avg_session_duration_min,
        longest_session_min,
        login_streak_days,
        last_login_at,
      };
    } catch (err) {
      this.logger.error(`Session aggregation failed for rm=${rmId}: ${(err as Error).message}`);
      return {
        login_days: 0,
        total_sessions: 0,
        avg_session_duration_min: 0,
        longest_session_min: 0,
        login_streak_days: 0,
        last_login_at: '',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Audit aggregation
  // ---------------------------------------------------------------------------

  private async aggregateAuditStats(
    rmId: string,
    start: Date,
    end: Date,
  ): Promise<{
    crm_actions_total: number;
    avg_daily_crm_actions: number;
    pages_visited: Record<string, number>;
  }> {
    try {
      const audits = await this.auditModel
        .find({
          rm_id: rmId,
          createdAt: { $gte: start, $lte: end },
        })
        .lean()
        .exec();

      if (audits.length === 0) {
        return { crm_actions_total: 0, avg_daily_crm_actions: 0, pages_visited: {} };
      }

      const crm_actions_total = audits.length;
      const pages_visited: Record<string, number> = {};

      // Count by resource_type as a proxy for "page" — fall back to action name
      for (const a of audits) {
        const page = a.resource_type || a.action || 'unknown';
        pages_visited[page] = (pages_visited[page] ?? 0) + 1;
      }

      // Number of distinct calendar days with audit records
      const auditDaySet = new Set<string>();
      for (const a of audits) {
        const created = (a as any).createdAt as Date | undefined;
        if (created) auditDaySet.add(this.toDateString(created));
      }

      const activeDays = auditDaySet.size || 1;
      const avg_daily_crm_actions =
        Math.round((crm_actions_total / activeDays) * 10) / 10;

      return { crm_actions_total, avg_daily_crm_actions, pages_visited };
    } catch (err) {
      this.logger.error(`Audit aggregation failed for rm=${rmId}: ${(err as Error).message}`);
      return { crm_actions_total: 0, avg_daily_crm_actions: 0, pages_visited: {} };
    }
  }

  // ---------------------------------------------------------------------------
  // Daily trend point
  // ---------------------------------------------------------------------------

  private async computeDailyPoint(
    rmId: string,
    date: Date,
    dateStr: string,
  ): Promise<EngagementTrendPoint> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    try {
      const [sessions, audits] = await Promise.all([
        this.sessionModel
          .find({ rm_id: rmId, createdAt: { $gte: start, $lte: end } })
          .lean()
          .exec(),
        this.auditModel
          .find({ rm_id: rmId, createdAt: { $gte: start, $lte: end } })
          .lean()
          .exec(),
      ]);

      const session_count = sessions.length;
      const crm_actions = audits.length;

      // Compute avg session duration for this day
      let totalDurationMin = 0;
      for (const s of sessions) {
        const created = (s as any).createdAt as Date | undefined;
        const lastActive = s.last_active as Date | undefined;
        if (created && lastActive && lastActive > created) {
          totalDurationMin += (lastActive.getTime() - created.getTime()) / 60_000;
        }
      }

      const avgDuration = session_count > 0 ? totalDurationMin / session_count : 0;

      const loginRegularity = session_count > 0 ? 100 : 0;
      const sessionDepth = Math.min(avgDuration / 60, 1) * 100;
      const crmUsage = Math.min(crm_actions / 20, 1) * 100;

      const daily_score = this.computeScore(loginRegularity, sessionDepth, crmUsage);

      return {
        date: dateStr,
        login: session_count > 0,
        session_count,
        crm_actions,
        daily_score,
      };
    } catch (err) {
      this.logger.warn(`Daily point computation failed for rm=${rmId} date=${dateStr}: ${(err as Error).message}`);
      return { date: dateStr, login: false, session_count: 0, crm_actions: 0, daily_score: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Scoring helpers
  // ---------------------------------------------------------------------------

  /**
   * Compute weighted consistency score (0-100).
   */
  computeScore(loginRegularity: number, sessionDepth: number, crmUsage: number): number {
    const raw =
      loginRegularity * WEIGHTS.login_regularity +
      sessionDepth * WEIGHTS.session_depth +
      crmUsage * WEIGHTS.crm_usage;
    return Math.round(Math.min(Math.max(raw, 0), 100) * 10) / 10;
  }

  /**
   * Classify trend by comparing current score against the previous period's score.
   * diff > 5  → 'improving'
   * diff < -5 → 'declining'
   * otherwise → 'stable'
   */
  classifyTrend(
    currentScore: number,
    previousScore: number,
  ): 'improving' | 'stable' | 'declining' {
    const diff = currentScore - previousScore;
    if (diff > 5) return 'improving';
    if (diff < -5) return 'declining';
    return 'stable';
  }

  // ---------------------------------------------------------------------------
  // Previous-period score
  // ---------------------------------------------------------------------------

  /**
   * Return the consistency score for the period immediately before `period`.
   * Used to classify trend.  Returns 0 when no data is available.
   */
  private async computePreviousPeriodScore(rmId: string, period: string): Promise<number> {
    const previousPeriod = this.subtractMonth(period);
    const { start, end, workingDays } = this.periodBoundaries(previousPeriod);

    const [sessionStats, auditStats] = await Promise.all([
      this.aggregateSessionStats(rmId, start, end),
      this.aggregateAuditStats(rmId, start, end),
    ]);

    const loginRegularity = workingDays > 0
      ? Math.min(sessionStats.login_days / workingDays, 1) * 100
      : 0;
    const sessionDepth = Math.min(sessionStats.avg_session_duration_min / 60, 1) * 100;
    const crmUsage = Math.min(auditStats.avg_daily_crm_actions / 20, 1) * 100;

    return this.computeScore(loginRegularity, sessionDepth, crmUsage);
  }

  // ---------------------------------------------------------------------------
  // Date/period utilities
  // ---------------------------------------------------------------------------

  private resolvePeriod(period: string | undefined): string {
    if (period && /^\d{4}-\d{2}$/.test(period)) return period;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private periodBoundaries(period: string): { start: Date; end: Date; workingDays: number } {
    const [year, month] = period.split('-').map(Number) as [number, number];
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999); // last day of month
    const workingDays = this.countWorkingDays(start, end);
    return { start, end, workingDays };
  }

  /** Count Mon–Fri days in [start, end] inclusive. */
  private countWorkingDays(start: Date, end: Date): number {
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const day = cur.getDay();
      if (day !== 0 && day !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  private subtractMonth(period: string): string {
    const [year, month] = period.split('-').map(Number) as [number, number];
    const d = new Date(year, month - 2, 1); // month-2 because month is 1-based
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private toDateString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Compute the current consecutive login streak (days) counting backwards from today.
   * Expects an array of unique YYYY-MM-DD strings.
   */
  private computeStreak(dayStrings: string[]): number {
    if (dayStrings.length === 0) return 0;

    const dateSet = new Set(dayStrings);
    let streak = 0;
    const cursor = new Date();

    while (true) {
      const key = this.toDateString(cursor);
      if (dateSet.has(key)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }

  // ---------------------------------------------------------------------------
  // Fallback
  // ---------------------------------------------------------------------------

  private emptyEngagementData(rmId: string, period: string): EngagementData {
    return {
      rm_id: rmId,
      period,
      login_days: 0,
      total_sessions: 0,
      avg_session_duration_min: 0,
      longest_session_min: 0,
      login_streak_days: 0,
      last_login_at: '',
      crm_actions_total: 0,
      avg_daily_crm_actions: 0,
      pages_visited: {},
      consistency_score: 0,
      consistency_trend: 'stable',
      is_estimated: true,
    };
  }
}
