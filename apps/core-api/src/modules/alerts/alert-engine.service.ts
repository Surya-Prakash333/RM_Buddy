import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AlertRecord, AlertDocument } from '../../database/models/alert.model';
import { Client, ClientDocument } from '../../database/models/client.model';
import { CacheService, CACHE_KEYS } from '../cache/cache.service';
import { AlertsService } from './alerts.service';

// ---------------------------------------------------------------------------
// Public interfaces — consumed by S2 alert rule implementations
// ---------------------------------------------------------------------------

/**
 * Describes a single alert rule.  Rules are either loaded from MongoDB
 * (alert_rules collection) or provided inline by callers.
 */
export interface AlertRule {
  rule_id: string;
  alert_type: string;
  name: string;
  /** Rule-specific evaluation thresholds / config. */
  conditions: Record<string, unknown>;
  /**
   * Minimum hours that must elapse before re-generating the same alert
   * for the same client.  Enforced via Redis cooldown key.
   */
  cooldown_hours: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  channels: Array<'IN_APP' | 'VOICE'>;
}

/**
 * A client that has been identified as meeting the conditions for an alert.
 * The AlertEngineService converts candidates into persisted AlertRecords.
 */
export interface AlertCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  rm_id: string;
  /** Rule-specific payload stored on the alert for downstream rendering. */
  data: Record<string, unknown>;
  title: string;
  message: string;
  action_suggestion: string;
}

// ---------------------------------------------------------------------------
// Priority constants
// ---------------------------------------------------------------------------

/**
 * Numeric priority scores for alert routing / UI ordering.
 * Lower number = higher urgency.
 */
const PRIORITY_MAP: Record<string, number> = {
  P1: 1, // CRITICAL
  P2: 2, // HIGH
  P3: 3, // MEDIUM
  P4: 4, // LOW
};

/**
 * Alert types that always escalate to P1 regardless of rule severity.
 */
const P1_TYPES = new Set(['asset_risk', 'compliance']);

/**
 * Alert types that map to P2 when severity is 'high'.
 */
const P2_TYPES = new Set(['maturity', 'engagement_drop', 'idle_cash']);

/**
 * Cooldown Redis key pattern: cooldown:{ruleId}:{clientId}
 */
const cooldownKey = (ruleId: string, clientId: string): string =>
  `cooldown:${ruleId}:${clientId}`;

// ---------------------------------------------------------------------------
// Proof-of-concept rule definitions
// ---------------------------------------------------------------------------

const POC_RULES: AlertRule[] = [
  {
    rule_id: 'rule-birthday-001',
    alert_type: 'birthday',
    name: 'Client Birthday (3-day advance)',
    conditions: { days_ahead: 3 },
    cooldown_hours: 168, // 7 days — fire once per birthday season
    severity: 'medium',
    channels: ['IN_APP'],
  },
  {
    rule_id: 'rule-idle-cash-001',
    alert_type: 'idle_cash',
    name: 'Idle Cash >₹1L for 30+ days',
    conditions: { min_cash_balance: 100_000, idle_days: 30 },
    cooldown_hours: 72,
    severity: 'high',
    channels: ['IN_APP', 'VOICE'],
  },
  {
    rule_id: 'rule-dormant-001',
    alert_type: 'dormant_client',
    name: 'Dormant Client >90 days',
    conditions: { inactive_days: 90 },
    cooldown_hours: 168,
    severity: 'medium',
    channels: ['IN_APP'],
  },
];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * AlertEngineService is the core reusable evaluation framework.
 *
 * Every alert type in S2 will call evaluateRule() with a rule definition and
 * a list of candidate clients. The engine handles:
 *   1. Redis cooldown checks (skip already-cooled-down clients)
 *   2. MongoDB alert persistence via AlertsService
 *   3. Redis cooldown registration after alert creation
 *   4. Kafka publishing via AlertsService
 *   5. RM alert cache invalidation
 */
@Injectable()
export class AlertEngineService {
  private readonly logger = new Logger(AlertEngineService.name);

  constructor(
    @InjectModel(AlertRecord.name)
    private readonly alertModel: Model<AlertDocument>,
    @InjectModel(Client.name)
    private readonly clientModel: Model<ClientDocument>,
    private readonly cache: CacheService,
    @Inject(forwardRef(() => AlertsService))
    private readonly alertsService: AlertsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Core evaluation method
  // ---------------------------------------------------------------------------

  /**
   * Evaluate a rule against a list of candidate clients and generate alerts.
   *
   * Steps per candidate:
   *  a. Check Redis cooldown key — skip if present.
   *  b. Compute priority score.
   *  c. Persist alert in MongoDB via AlertsService.createAlert().
   *  d. Set Redis cooldown key with rule.cooldown_hours TTL.
   *  e. Publish to Kafka alerts.generated.
   *
   * After all candidates are processed, invalidate the RM alert cache for
   * any RM that had at least one new alert generated.
   *
   * @returns Array of AlertRecord documents that were created.
   */
  async evaluateRule(
    rule: AlertRule,
    candidates: AlertCandidate[],
  ): Promise<AlertRecord[]> {
    if (candidates.length === 0) {
      this.logger.debug(`Rule ${rule.rule_id}: no candidates, skipping`);
      return [];
    }

    const created: AlertRecord[] = [];
    const affectedRmIds = new Set<string>();

    for (const candidate of candidates) {
      const ckKey = cooldownKey(rule.rule_id, candidate.client_id);

      // (a) Cooldown check
      const onCooldown = await this.cache.get<boolean>(ckKey);
      if (onCooldown) {
        this.logger.debug(
          `Cooldown active — skipping ${candidate.client_id} for rule ${rule.rule_id}`,
        );
        continue;
      }

      // (b) Priority score
      const priority = this.computePriority(rule.alert_type, rule.severity, candidate.data);

      // (c) Persist alert
      let alert: AlertRecord;
      try {
        alert = await this.alertsService.createAlert({
          alert_type: rule.alert_type,
          rm_id: candidate.rm_id,
          client_id: candidate.client_id,
          client_name: candidate.client_name,
          client_tier: candidate.client_tier,
          severity: rule.severity,
          title: candidate.title,
          message: candidate.message,
          data: { ...candidate.data, priority },
          action_suggestion: candidate.action_suggestion,
          rule_id: rule.rule_id,
          priority,
        });
      } catch (err) {
        this.logger.error(
          `Failed to create alert for client ${candidate.client_id} rule ${rule.rule_id}: ${(err as Error).message}`,
        );
        continue;
      }

      // (d) Set cooldown in Redis
      const cooldownTtlSeconds = rule.cooldown_hours * 3600;
      await this.cache.set(ckKey, true, cooldownTtlSeconds);

      // (e) Publish to Kafka
      try {
        await this.alertsService.publishAlert(alert);
      } catch (err) {
        // Non-fatal — alert is already persisted; log and continue
        this.logger.warn(
          `Kafka publish failed for alert ${alert.alert_id}: ${(err as Error).message}`,
        );
      }

      created.push(alert);
      affectedRmIds.add(candidate.rm_id);
    }

    // Invalidate RM alert caches for every RM that received a new alert
    await Promise.all(
      [...affectedRmIds].map((rmId) =>
        this.cache.invalidate(CACHE_KEYS.rmAlertList(rmId)),
      ),
    );

    this.logger.log(
      `Rule ${rule.rule_id} evaluated: ${candidates.length} candidates → ${created.length} alerts created`,
    );

    return created;
  }

  // ---------------------------------------------------------------------------
  // Priority computation
  // ---------------------------------------------------------------------------

  /**
   * Compute P1–P4 numeric priority for an alert.
   *
   * Logic:
   *  P1 (1) — alert_type in {asset_risk, compliance}  OR  severity === 'critical'
   *  P2 (2) — severity === 'high'  OR  alert_type in {maturity, engagement_drop}
   *           OR  (alert_type === 'idle_cash' AND data.amount > ₹10L)
   *  P3 (3) — severity === 'medium'  OR  alert_type in {birthday, cross_sell, portfolio_drift}
   *  P4 (4) — everything else
   */
  computePriority(
    alertType: string,
    severity: string,
    data: Record<string, unknown>,
  ): number {
    // P1: safety-critical types always win
    if (P1_TYPES.has(alertType) || severity === 'critical') {
      return PRIORITY_MAP['P1'];
    }

    // P2: high-severity types + idle cash above ₹10L threshold
    if (severity === 'high' || P2_TYPES.has(alertType)) {
      // idle_cash with amount ≤ ₹10L drops to P3
      if (
        alertType === 'idle_cash' &&
        typeof data['amount'] === 'number' &&
        data['amount'] <= 10_00_000 // ₹10L in paise/rupees
      ) {
        return PRIORITY_MAP['P3'];
      }
      return PRIORITY_MAP['P2'];
    }

    // P3: medium severity
    if (severity === 'medium') {
      return PRIORITY_MAP['P3'];
    }

    // P4: low / unknown
    return PRIORITY_MAP['P4'];
  }

  // ---------------------------------------------------------------------------
  // Proof-of-concept evaluation entry point
  // ---------------------------------------------------------------------------

  /**
   * Evaluate three PoC rules (birthday, idle_cash, dormant_client) for an RM.
   * Called from AlertsController.evaluateAlerts() for manual testing.
   *
   * @returns Summary of rules evaluated and total alerts generated.
   */
  async evaluateProofOfConcept(
    rmId: string,
  ): Promise<{ evaluated: string[]; generated: number }> {
    const evaluated: string[] = [];
    let generated = 0;

    for (const rule of POC_RULES) {
      let candidates: AlertCandidate[] = [];

      try {
        switch (rule.alert_type) {
          case 'birthday':
            candidates = await this.evaluateBirthdayRule(rmId, rule);
            break;
          case 'idle_cash':
            candidates = await this.evaluateIdleCashRule(rmId, rule);
            break;
          case 'dormant_client':
            candidates = await this.evaluateDormantClientRule(rmId, rule);
            break;
          default:
            this.logger.warn(`Unknown PoC rule type: ${rule.alert_type}`);
        }
      } catch (err) {
        this.logger.error(
          `Error evaluating rule ${rule.rule_id}: ${(err as Error).message}`,
        );
        continue;
      }

      const alerts = await this.evaluateRule(rule, candidates);
      evaluated.push(rule.rule_id);
      generated += alerts.length;
    }

    return { evaluated, generated };
  }

  // ---------------------------------------------------------------------------
  // Private rule evaluators
  // ---------------------------------------------------------------------------

  /**
   * BIRTHDAY rule: clients with a birthday within the next 3 days.
   *
   * We compare month+day only (year-agnostic) using a date-range query
   * that wraps around the year boundary if needed.
   */
  private async evaluateBirthdayRule(
    rmId: string,
    rule: AlertRule,
  ): Promise<AlertCandidate[]> {
    const daysAhead = (rule.conditions['days_ahead'] as number | undefined) ?? 3;

    const today = new Date();
    const windowEnd = new Date();
    windowEnd.setDate(today.getDate() + daysAhead);

    // Fetch all clients for this RM who have a dob set
    const clients = await this.clientModel
      .find({ rm_id: rmId, dob: { $exists: true, $ne: null } })
      .lean()
      .exec();

    const candidates: AlertCandidate[] = [];

    for (const client of clients) {
      if (!client.dob) continue;

      const dob = new Date(client.dob);
      // Construct this year's birthday
      const birthdayThisYear = new Date(
        today.getFullYear(),
        dob.getMonth(),
        dob.getDate(),
      );

      // If birthday already passed this year, check next year
      const birthday =
        birthdayThisYear < today
          ? new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate())
          : birthdayThisYear;

      const daysUntil = Math.ceil(
        (birthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysUntil >= 0 && daysUntil <= daysAhead) {
        candidates.push({
          client_id: client.client_id,
          client_name: client.client_name,
          client_tier: client.tier ?? 'STANDARD',
          rm_id: rmId,
          data: {
            dob: client.dob,
            days_until_birthday: daysUntil,
            birthday_date: birthday.toISOString(),
          },
          title: `Birthday: ${client.client_name}`,
          message: `${client.client_name}'s birthday is ${
            daysUntil === 0 ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`
          }. Consider sending a personalised greeting.`,
          action_suggestion:
            'Send a personalised birthday message or schedule a call to strengthen the client relationship.',
        });
      }
    }

    this.logger.debug(
      `Birthday rule: found ${candidates.length} candidates for RM ${rmId}`,
    );
    return candidates;
  }

  /**
   * IDLE_CASH rule: clients with cash_balance > ₹1L that has been idle for
   * more than 30 days (proxy: last_interaction older than threshold).
   *
   * In production this would join portfolio.summary.cash_balance; here we
   * use last_interaction as a stand-in since portfolio data may not be seeded.
   */
  private async evaluateIdleCashRule(
    rmId: string,
    rule: AlertRule,
  ): Promise<AlertCandidate[]> {
    const minBalance = (rule.conditions['min_cash_balance'] as number | undefined) ?? 100_000;
    const idleDays = (rule.conditions['idle_days'] as number | undefined) ?? 30;

    const idleThreshold = new Date();
    idleThreshold.setDate(idleThreshold.getDate() - idleDays);

    // Query clients whose last interaction is older than the idle threshold
    // and whose AUM suggests they likely hold significant cash.
    // AUM > ₹10L as a proxy for having a meaningful cash position.
    const clients = await this.clientModel
      .find({
        rm_id: rmId,
        last_interaction: { $lt: idleThreshold },
        total_aum: { $gte: minBalance },
      })
      .lean()
      .exec();

    const candidates: AlertCandidate[] = clients.map((client) => {
      // Approximate cash balance as 10% of AUM for PoC purposes
      const estimatedCash = Math.round((client.total_aum ?? 0) * 0.1);
      return {
        client_id: client.client_id,
        client_name: client.client_name,
        client_tier: client.tier ?? 'STANDARD',
        rm_id: rmId,
        data: {
          estimated_cash_balance: estimatedCash,
          idle_since: client.last_interaction,
          total_aum: client.total_aum,
          amount: estimatedCash,
        },
        title: `Idle Cash Opportunity: ${client.client_name}`,
        message: `${client.client_name} may have approximately ₹${this.formatIndian(estimatedCash)} in idle cash with no interaction for over ${idleDays} days.`,
        action_suggestion:
          'Review client portfolio for uninvested cash and suggest suitable debt/liquid fund options aligned to their risk profile.',
      };
    });

    this.logger.debug(
      `Idle cash rule: found ${candidates.length} candidates for RM ${rmId}`,
    );
    return candidates;
  }

  /**
   * DORMANT_CLIENT rule: clients with no interaction recorded in the last 90 days.
   */
  private async evaluateDormantClientRule(
    rmId: string,
    rule: AlertRule,
  ): Promise<AlertCandidate[]> {
    const inactiveDays = (rule.conditions['inactive_days'] as number | undefined) ?? 90;

    const dormancyThreshold = new Date();
    dormancyThreshold.setDate(dormancyThreshold.getDate() - inactiveDays);

    const clients = await this.clientModel
      .find({
        rm_id: rmId,
        last_interaction: { $lt: dormancyThreshold },
      })
      .lean()
      .exec();

    const candidates: AlertCandidate[] = clients.map((client) => {
      const lastInteraction = client.last_interaction
        ? new Date(client.last_interaction)
        : null;

      const daysDormant = lastInteraction
        ? Math.floor(
            (Date.now() - lastInteraction.getTime()) / (1000 * 60 * 60 * 24),
          )
        : inactiveDays;

      return {
        client_id: client.client_id,
        client_name: client.client_name,
        client_tier: client.tier ?? 'STANDARD',
        rm_id: rmId,
        data: {
          last_interaction: client.last_interaction,
          days_dormant: daysDormant,
          total_aum: client.total_aum,
        },
        title: `Dormant Client: ${client.client_name}`,
        message: `${client.client_name} has not been contacted in ${daysDormant} days. Last interaction: ${lastInteraction ? lastInteraction.toDateString() : 'unknown'}.`,
        action_suggestion:
          'Schedule a proactive re-engagement call. Review portfolio performance and upcoming maturities before the call.',
      };
    });

    this.logger.debug(
      `Dormant client rule: found ${candidates.length} candidates for RM ${rmId}`,
    );
    return candidates;
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Format a number in Indian numbering system (lakhs/crores).
   * e.g. 1500000 → "15,00,000"
   */
  private formatIndian(amount: number): string {
    return amount.toLocaleString('en-IN');
  }
}
