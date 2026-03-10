import { Injectable, Logger, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';

import { AlertRecord, AlertDocument } from '../../database/models/alert.model';
import { Portfolio, PortfolioDocument } from '../../database/models/portfolio.model';
import { Transaction, TransactionDocument } from '../../database/models/transaction.model';
import { PaginatedResult } from '../../database/repositories/base.repository';
import { CacheService, CACHE_KEYS } from '../cache/cache.service';
import { KafkaService } from '../kafka/kafka.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AlertQueryDto } from './dto/alert-query.dto';
import { AlertEngineService } from './alert-engine.service';
import {
  IDLE_CASH_RULE,
  evaluateIdleCash,
  buildIdleCashMessage,
} from './rules/idle-cash.rule';
import {
  MATURITY_PROCEEDS_RULE,
  evaluateMaturityProceeds,
  buildMaturityProceedsMessage,
} from './rules/maturity-proceeds.rule';

/** Shape used by AlertEngineService to request alert creation. */
export interface CreateAlertDto {
  alert_type: string;
  rm_id: string;
  client_id: string;
  client_name: string;
  client_tier: string;
  severity: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  action_suggestion: string;
  rule_id: string;
  priority: number;
}

/** Alert cache TTL in seconds (5 minutes). */
const ALERT_CACHE_TTL_SECONDS = 300;

/** Kafka topic for newly generated alerts. */
const TOPIC_ALERTS_GENERATED = 'alerts.generated';

/**
 * AlertsService handles CRUD operations on alerts plus Kafka publishing.
 *
 * Read pattern : Redis (5-min TTL) → MongoDB fallback.
 * Write pattern: MongoDB first, then invalidate cache.
 *
 * Ownership rule: an RM can only mutate alerts where alert.rm_id === their own rm_id.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectModel(AlertRecord.name)
    private readonly alertModel: Model<AlertDocument>,
    @InjectModel(Portfolio.name)
    private readonly portfolioModel: Model<PortfolioDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly cache: CacheService,
    private readonly kafka: KafkaService,
    @Inject(forwardRef(() => AlertEngineService))
    private readonly alertEngine: AlertEngineService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Return a paginated list of alerts for the given RM.
   * Optional filters: status, alert_type, severity.
   * Results are cached per RM for 5 minutes.
   */
  async getAlertsForRM(
    rmId: string,
    query: AlertQueryDto,
  ): Promise<PaginatedResult<AlertRecord>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const cacheKey = CACHE_KEYS.rmAlertList(rmId);

    // For filtered/paginated queries we skip the top-level cache and query
    // MongoDB directly so we never return stale subsets. The cache is used
    // only for the unfiltered RM alert list warming.
    const filter: Record<string, unknown> = { rm_id: rmId };
    if (query.status) filter['status'] = query.status;
    if (query.alert_type) filter['alert_type'] = query.alert_type;
    if (query.severity) filter['severity'] = query.severity;

    const [items, total] = await Promise.all([
      this.alertModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.alertModel.countDocuments(filter).exec(),
    ]);

    const totalPages = Math.ceil(total / limit);

    this.logger.debug(
      `getAlertsForRM rm=${rmId} total=${total} page=${page} limit=${limit}`,
    );

    // Warm the unfiltered cache in background (fire-and-forget) so subsequent
    // unfiltered calls hit Redis.
    void this.cache.set(cacheKey, items, ALERT_CACHE_TTL_SECONDS).catch(() => {
      /* non-critical */
    });

    return {
      items: items as unknown as AlertRecord[],
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
    };
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Mark an alert as ACKNOWLEDGED.
   * Throws ALERT_NOT_FOUND (404) or ALERT_OWNERSHIP_DENIED (403) on violations.
   */
  async acknowledgeAlert(alertId: string, rmId: string): Promise<AlertRecord> {
    const alert = await this.findAndVerifyOwnership(alertId, rmId);

    const updated = await this.alertModel
      .findOneAndUpdate(
        { alert_id: alertId },
        { $set: { status: 'ACKNOWLEDGED', acknowledged_at: new Date() } },
        { new: true, lean: true },
      )
      .exec();

    if (!updated) {
      throw new BusinessException(
        'ALERT_UPDATE_FAILED',
        `Failed to update alert ${alertId}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    await this.cache.invalidate(CACHE_KEYS.rmAlertList(alert.rm_id));
    this.logger.log(`Alert ${alertId} acknowledged by RM ${rmId}`);

    return updated as unknown as AlertRecord;
  }

  /**
   * Mark an alert as ACTED_ON.
   * Throws ALERT_NOT_FOUND (404) or ALERT_OWNERSHIP_DENIED (403) on violations.
   */
  async actOnAlert(alertId: string, rmId: string): Promise<AlertRecord> {
    const alert = await this.findAndVerifyOwnership(alertId, rmId);

    const updated = await this.alertModel
      .findOneAndUpdate(
        { alert_id: alertId },
        { $set: { status: 'ACTED_ON', acted_at: new Date() } },
        { new: true, lean: true },
      )
      .exec();

    if (!updated) {
      throw new BusinessException(
        'ALERT_UPDATE_FAILED',
        `Failed to update alert ${alertId}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    await this.cache.invalidate(CACHE_KEYS.rmAlertList(alert.rm_id));
    this.logger.log(`Alert ${alertId} acted on by RM ${rmId}`);

    return updated as unknown as AlertRecord;
  }

  /**
   * Persist a new alert to MongoDB.
   * Called exclusively by AlertEngineService — not exposed via HTTP directly.
   */
  async createAlert(data: CreateAlertDto): Promise<AlertRecord> {
    const doc = new this.alertModel({
      alert_id: randomUUID(),
      alert_type: data.alert_type,
      rm_id: data.rm_id,
      client_id: data.client_id,
      client_name: data.client_name,
      client_tier: data.client_tier,
      severity: data.severity,
      status: 'NEW',
      title: data.title,
      message: data.message,
      data: data.data,
      action_suggestion: data.action_suggestion,
      rule_id: data.rule_id,
      delivered_at: new Date(),
      expires_at: this.computeExpiry(data.severity),
    });

    const saved = await doc.save();
    this.logger.debug(
      `Alert created: ${saved.alert_id} type=${data.alert_type} rm=${data.rm_id}`,
    );
    return saved.toObject() as AlertRecord;
  }

  /**
   * Publish an alert to the alerts.generated Kafka topic.
   * The rm_id is used as the partition key for consumer affinity.
   */
  async publishAlert(alert: AlertRecord): Promise<void> {
    await this.kafka.publish(TOPIC_ALERTS_GENERATED, alert.rm_id, {
      alert_id: alert.alert_id,
      alert_type: alert.alert_type,
      rm_id: alert.rm_id,
      client_id: alert.client_id,
      severity: alert.severity,
      title: alert.title,
      status: alert.status,
    });
    this.logger.debug(
      `Alert ${alert.alert_id} published to ${TOPIC_ALERTS_GENERATED}`,
    );
  }

  // ---------------------------------------------------------------------------
  // S2 alert rule evaluators
  // ---------------------------------------------------------------------------

  /**
   * Evaluate the Idle Cash rule (S2-F21) for all clients under `rmId`.
   *
   * Identifies clients whose cash_pct > 30% AND cash_balance > ₹1L AND have
   * had no executed transaction in the last 30 days, then persists alerts
   * (subject to 7-day Redis cooldown per client).
   *
   * @returns Alerts that were created (cooldown-filtered).
   */
  async evaluateIdleCashAlerts(rmId: string): Promise<AlertRecord[]> {
    this.logger.log(`Evaluating idle cash alerts for RM ${rmId}`);

    const candidates = await evaluateIdleCash(
      this.portfolioModel,
      this.transactionModel,
      rmId,
    );

    const alertCandidates = candidates.map((c) => ({
      client_id: c.client_id,
      client_name: c.client_name,
      client_tier: c.client_tier,
      rm_id: rmId,
      data: {
        cash_balance: c.cash_balance,
        cash_pct: c.cash_pct,
        days_idle: c.days_idle,
        amount: c.cash_balance, // used by computePriority for P2/P3 boundary
      },
      title: `Idle Cash Opportunity: ${c.client_name}`,
      message: buildIdleCashMessage(c),
      action_suggestion:
        'Review client portfolio for uninvested cash and suggest suitable SIP, liquid fund, or FD options aligned to their risk profile.',
    }));

    const created = await this.alertEngine.evaluateRule(IDLE_CASH_RULE, alertCandidates);

    this.logger.log(
      `Idle cash evaluation complete for RM ${rmId}: ${candidates.length} candidates → ${created.length} alerts`,
    );

    return created;
  }

  /**
   * Evaluate the Maturity Proceeds rule (S2-F22) for all clients under `rmId`.
   *
   * Identifies portfolio holdings with a maturity_date in the next 7 days and
   * current_value >= ₹50K, then persists alerts (subject to 2-day Redis
   * cooldown per client).
   *
   * @returns Alerts that were created (cooldown-filtered).
   */
  async evaluateMaturityAlerts(rmId: string): Promise<AlertRecord[]> {
    this.logger.log(`Evaluating maturity proceeds alerts for RM ${rmId}`);

    const candidates = await evaluateMaturityProceeds(this.portfolioModel, rmId);

    const alertCandidates = candidates.map((c) => ({
      client_id: c.client_id,
      client_name: c.client_name,
      client_tier: c.client_tier,
      rm_id: rmId,
      data: {
        instrument_name: c.instrument_name,
        maturity_date: c.maturity_date,
        maturity_amount: c.maturity_amount,
        days_until_maturity: c.days_until_maturity,
      },
      title: `Maturity Alert: ${c.instrument_name} (${c.client_name})`,
      message: buildMaturityProceedsMessage(c),
      action_suggestion:
        'Contact the client before the maturity date to discuss reinvestment options (FD renewal, debt MF, bonds) aligned to their risk profile.',
    }));

    const created = await this.alertEngine.evaluateRule(MATURITY_PROCEEDS_RULE, alertCandidates);

    this.logger.log(
      `Maturity evaluation complete for RM ${rmId}: ${candidates.length} candidates → ${created.length} alerts`,
    );

    return created;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Load alert by alert_id and verify the requesting RM owns it.
   * Throws typed BusinessExceptions so callers never receive raw Mongo docs
   * before ownership is confirmed.
   */
  private async findAndVerifyOwnership(
    alertId: string,
    rmId: string,
  ): Promise<AlertRecord> {
    const alert = await this.alertModel
      .findOne({ alert_id: alertId })
      .lean()
      .exec();

    if (!alert) {
      throw new BusinessException(
        'ALERT_NOT_FOUND',
        `Alert ${alertId} not found`,
        HttpStatus.NOT_FOUND,
        { alert_id: alertId },
      );
    }

    if ((alert as unknown as AlertRecord).rm_id !== rmId) {
      throw new BusinessException(
        'ALERT_OWNERSHIP_DENIED',
        'You do not have permission to modify this alert',
        HttpStatus.FORBIDDEN,
        { alert_id: alertId },
      );
    }

    return alert as unknown as AlertRecord;
  }

  /**
   * Compute alert expiry based on severity.
   * Critical/high alerts expire in 24h; others in 7 days.
   */
  private computeExpiry(severity: string): Date {
    const hours = severity === 'critical' || severity === 'high' ? 24 : 168;
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + hours);
    return expiry;
  }
}
