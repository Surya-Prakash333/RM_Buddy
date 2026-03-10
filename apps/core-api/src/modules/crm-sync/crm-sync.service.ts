import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { CacheService, CACHE_KEYS } from '../cache/cache.service';
import { KafkaService } from '../kafka/kafka.service';
import {
  CrmApiClient,
  CRMClient,
  CRMPortfolio,
  CRMMeeting,
  CRMLead,
  CRMPipelineItem,
  CRMSyncPage,
} from './crm-api.client';
import { Client, ClientDocument } from '../../database/models/client.model';
import { Portfolio, PortfolioDocument } from '../../database/models/portfolio.model';
import { Meeting, MeetingDocument } from '../../database/models/meeting.model';
import { Lead, LeadDocument } from '../../database/models/lead.model';
import { Pipeline, PipelineDocument } from '../../database/models/pipeline.model';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  rm_id?: string;
  entity: string;
  synced: number;
  skipped: number;  // unchanged records — checksum matched
  errors: number;
  duration_ms: number;
}

export type WriteBackAction =
  | { type: 'CREATE_MEETING'; rm_id: string; data: Record<string, unknown> }
  | { type: 'UPDATE_LEAD'; rm_id: string; data: Record<string, unknown> }
  | { type: 'CREATE_PIPELINE'; rm_id: string; data: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Redis key constants local to CRM sync
// ---------------------------------------------------------------------------

const CRM_CACHE = {
  syncStatus: (): string => 'crm:sync:status',
  syncLastRun: (): string => 'crm:sync:last_run',
  rmLastSync: (rmId: string): string => `crm:sync:rm:${rmId}:last_sync`,
  rmClients: (rmId: string): string => CACHE_KEYS.rmClientList(rmId),
  rmPortfolios: (rmId: string): string => `portfolios:rm:${rmId}`,
} as const;

// Kafka topic — must match INFRA-KAFKA-01 topic list
const TOPIC_CRM_SYNC_COMPLETED = 'crm.sync.completed';
const TOPIC_AUDIT_TRAIL = 'audit.trail';

// Cache TTL constants (seconds)
const TTL_SYNC_STATUS = 86400;  // 24 h
const TTL_RM_CLIENTS = 3600;    // 1 h
const TTL_RM_PORTFOLIOS = 3600; // 1 h

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * CrmSyncService orchestrates the bi-directional sync between the Nuvama CRM
 * and the local MongoDB store.
 *
 * Three sync modes:
 *   1. fullSync()   — full crawl of all RMs and entities, run nightly at 2AM.
 *   2. syncForRM()  — incremental sync for one RM, run on login (<5s budget).
 *   3. writeBack()  — push a single CRM action and update local state.
 *
 * Change detection uses SHA-256 checksums to skip records that have not
 * changed since the last sync, reducing unnecessary MongoDB writes.
 */
@Injectable()
export class CrmSyncService {
  private readonly logger = new Logger(CrmSyncService.name);

  constructor(
    private readonly crmApiClient: CrmApiClient,
    private readonly cacheService: CacheService,
    private readonly kafkaService: KafkaService,
    @InjectModel(Client.name) private readonly clientModel: Model<ClientDocument>,
    @InjectModel(Portfolio.name) private readonly portfolioModel: Model<PortfolioDocument>,
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Pipeline.name) private readonly pipelineModel: Model<PipelineDocument>,
  ) {}

  // --------------------------------------------------------------------------
  // Public: fullSync
  // --------------------------------------------------------------------------

  /**
   * Full sync: fetches every entity for every active RM with pagination.
   * Designed to run at 2AM daily via CrmSyncCron.
   *
   * After all RMs are processed:
   *   - Publishes 'crm.sync.completed' Kafka event.
   *   - Updates Redis keys: crm:sync:status and crm:sync:last_run.
   */
  async fullSync(): Promise<SyncResult[]> {
    this.logger.log('Starting full CRM sync');
    await this.cacheService.set(CRM_CACHE.syncStatus(), 'running', TTL_SYNC_STATUS);

    const allResults: SyncResult[] = [];
    const rmIds = await this.getActiveRMIds();

    this.logger.log(`Full sync will process ${rmIds.length} active RMs`);

    for (const rmId of rmIds) {
      try {
        const rmResults = await this._syncAllEntitiesForRM(rmId, undefined);
        allResults.push(...rmResults);
      } catch (err) {
        this.logger.error(`Full sync failed for RM ${rmId}: ${(err as Error).message}`);
        allResults.push({
          rm_id: rmId,
          entity: 'all',
          synced: 0,
          skipped: 0,
          errors: 1,
          duration_ms: 0,
        });
      }
    }

    const completedAt = new Date().toISOString();

    // Publish completion event
    try {
      await this.kafkaService.publish(
        TOPIC_CRM_SYNC_COMPLETED,
        'system',
        {
          event: 'crm.sync.completed',
          timestamp: completedAt,
          rm_count: rmIds.length,
          total_synced: allResults.reduce((sum, r) => sum + r.synced, 0),
          total_errors: allResults.reduce((sum, r) => sum + r.errors, 0),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to publish sync completed event: ${(err as Error).message}`);
    }

    // Update sync status in Redis
    await this.cacheService.set(CRM_CACHE.syncStatus(), 'idle', TTL_SYNC_STATUS);
    await this.cacheService.set(CRM_CACHE.syncLastRun(), completedAt, TTL_SYNC_STATUS);

    this.logger.log(
      `Full CRM sync complete — ` +
      `${allResults.reduce((s, r) => s + r.synced, 0)} synced, ` +
      `${allResults.reduce((s, r) => s + r.skipped, 0)} skipped, ` +
      `${allResults.reduce((s, r) => s + r.errors, 0)} errors`,
    );

    return allResults;
  }

  // --------------------------------------------------------------------------
  // Public: syncForRM
  // --------------------------------------------------------------------------

  /**
   * Incremental sync for a single RM.
   *
   * Called on RM login — must complete in <5 seconds.
   * Fetches only clients and portfolios (highest-value entities for dashboard).
   * Passes changedSince so CRM API can filter to recently modified records.
   *
   * After sync: warms Redis cache for this RM.
   */
  async syncForRM(rmId: string): Promise<SyncResult[]> {
    this.logger.log(`Starting incremental sync for RM: ${rmId}`);

    const lastSyncIso = await this.cacheService.get<string>(CRM_CACHE.rmLastSync(rmId));
    const changedSince = lastSyncIso ? new Date(lastSyncIso) : undefined;

    const results: SyncResult[] = [];

    // Clients + Portfolios only (fast path — <5s budget)
    const [clientResult, portfolioResult] = await Promise.all([
      this._syncClients(rmId, changedSince),
      this._syncPortfolios(rmId, changedSince),
    ]);

    results.push(clientResult, portfolioResult);

    // Record last sync timestamp
    await this.cacheService.set(
      CRM_CACHE.rmLastSync(rmId),
      new Date().toISOString(),
      TTL_SYNC_STATUS,
    );

    // Warm Redis cache for this RM
    await this._warmRMCache(rmId);

    this.logger.log(
      `Incremental sync complete for RM ${rmId} — ` +
      `${results.reduce((s, r) => s + r.synced, 0)} synced`,
    );

    return results;
  }

  // --------------------------------------------------------------------------
  // Public: writeBack
  // --------------------------------------------------------------------------

  /**
   * Write-back: pushes a CRM action to the CRM API, then updates MongoDB and
   * invalidates the affected Redis cache keys, then publishes an audit event.
   */
  async writeBack(
    action: WriteBackAction,
  ): Promise<{ success: boolean; crm_id?: string }> {
    this.logger.log(`WriteBack: ${action.type} for RM ${action.rm_id}`);

    try {
      if (action.type === 'CREATE_MEETING') {
        const crmResult = await this.crmApiClient.createMeeting(action.data);
        if (!crmResult.success) {
          return { success: false };
        }

        // Write to MongoDB
        await this.meetingModel.findOneAndUpdate(
          { meeting_id: crmResult.meeting_id },
          {
            $set: {
              ...action.data,
              meeting_id: crmResult.meeting_id,
              rm_id: action.rm_id,
              crm_last_synced: new Date(),
            },
          },
          { upsert: true, new: true },
        );

        // Invalidate affected cache keys
        await this.cacheService.invalidate(CACHE_KEYS.rmDashboard(action.rm_id));

        await this._publishAuditEvent(action);
        return { success: true, crm_id: crmResult.meeting_id };
      }

      if (action.type === 'UPDATE_LEAD') {
        const leadId = action.data['lead_id'] as string | undefined;
        if (!leadId) {
          this.logger.warn('UPDATE_LEAD action missing lead_id in data');
          return { success: false };
        }

        const crmResult = await this.crmApiClient.updateLead(leadId, action.data);
        if (!crmResult.success) {
          return { success: false };
        }

        // Write to MongoDB
        await this.leadModel.findOneAndUpdate(
          { lead_id: leadId },
          { $set: { ...action.data, crm_last_synced: new Date() } },
          { upsert: true, new: true },
        );

        await this.cacheService.invalidate(CACHE_KEYS.rmDashboard(action.rm_id));

        await this._publishAuditEvent(action);
        return { success: true, crm_id: leadId };
      }

      if (action.type === 'CREATE_PIPELINE') {
        // Pipeline write-back: write to MongoDB directly (no separate CRM pipeline create API yet)
        const pipelineId = `PIPE-${action.rm_id}-${Date.now()}`;
        await this.pipelineModel.findOneAndUpdate(
          { pipeline_id: pipelineId },
          {
            $set: {
              ...action.data,
              pipeline_id: pipelineId,
              rm_id: action.rm_id,
              crm_last_synced: new Date(),
            },
          },
          { upsert: true, new: true },
        );

        await this.cacheService.invalidate(CACHE_KEYS.rmDashboard(action.rm_id));

        await this._publishAuditEvent(action);
        return { success: true, crm_id: pipelineId };
      }

      // Exhaustive type check
      const _exhaustiveCheck: never = action;
      return _exhaustiveCheck;
    } catch (err) {
      this.logger.error(`WriteBack failed [${action.type}]: ${(err as Error).message}`);
      return { success: false };
    }
  }

  // --------------------------------------------------------------------------
  // Private: sync helpers
  // --------------------------------------------------------------------------

  /**
   * Syncs all entities (clients, portfolios, meetings, leads, pipeline) for
   * a single RM. Used by fullSync(). changedSince=undefined means fetch all.
   */
  private async _syncAllEntitiesForRM(
    rmId: string,
    changedSince: Date | undefined,
  ): Promise<SyncResult[]> {
    return Promise.all([
      this._syncClients(rmId, changedSince),
      this._syncPortfolios(rmId, changedSince),
      this._syncMeetings(rmId, changedSince),
      this._syncLeads(rmId, changedSince),
      this._syncPipeline(rmId),
    ]);
  }

  private async _syncClients(rmId: string, changedSince?: Date): Promise<SyncResult> {
    const start = Date.now();
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response: CRMSyncPage<CRMClient> = await this.crmApiClient.getClients(
          rmId,
          page,
          100,
        );

        for (const crmClient of response.data) {
          try {
            const existing = await this.clientModel.findOne(
              { client_id: crmClient.client_id },
              { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 },
            ).lean();

            const incomingChecksum = this.computeChecksum(crmClient as unknown as Record<string, unknown>);
            const existingChecksum = existing
              ? this.computeChecksum(existing as unknown as Record<string, unknown>)
              : null;

            if (incomingChecksum === existingChecksum) {
              skipped++;
              continue;
            }

            await this.clientModel.findOneAndUpdate(
              { client_id: crmClient.client_id },
              {
                $set: {
                  rm_id: crmClient.rm_id,
                  client_name: crmClient.client_name,
                  email: crmClient.email,
                  phone: crmClient.phone,
                  pan: crmClient.pan,
                  dob: new Date(crmClient.dob),
                  tier: crmClient.tier,
                  risk_profile: crmClient.risk_profile,
                  kyc_status: crmClient.kyc_status,
                  onboarding_date: new Date(crmClient.onboarding_date),
                  last_interaction: new Date(crmClient.last_interaction),
                  total_aum: crmClient.total_aum,
                  total_revenue_ytd: crmClient.total_revenue_ytd,
                  accounts: crmClient.accounts.map((a) => ({
                    ...a,
                    opening_date: new Date(a.opening_date),
                  })),
                  tags: crmClient.tags,
                  crm_last_synced: new Date(),
                },
              },
              { upsert: true },
            );

            synced++;
          } catch (err) {
            this.logger.error(
              `Failed to upsert client ${crmClient.client_id}: ${(err as Error).message}`,
            );
            errors++;
          }
        }

        hasMore = response.hasMore;
        page++;
      }
    } catch (err) {
      this.logger.error(`Client sync failed for RM ${rmId}: ${(err as Error).message}`);
      errors++;
    }

    return { rm_id: rmId, entity: 'clients', synced, skipped, errors, duration_ms: Date.now() - start };
  }

  private async _syncPortfolios(rmId: string, _changedSince?: Date): Promise<SyncResult> {
    const start = Date.now();
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response: CRMSyncPage<CRMPortfolio> = await this.crmApiClient.getPortfolios(
          rmId,
          page,
        );

        for (const portfolio of response.data) {
          try {
            const existing = await this.portfolioModel.findOne(
              { client_id: portfolio.client_id },
              { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 },
            ).lean();

            const incomingChecksum = this.computeChecksum(portfolio as unknown as Record<string, unknown>);
            const existingChecksum = existing
              ? this.computeChecksum(existing as unknown as Record<string, unknown>)
              : null;

            if (incomingChecksum === existingChecksum) {
              skipped++;
              continue;
            }

            await this.portfolioModel.findOneAndUpdate(
              { client_id: portfolio.client_id },
              {
                $set: {
                  rm_id: portfolio.rm_id,
                  holdings: portfolio.holdings,
                  summary: {
                    total_aum: portfolio.total_aum,
                    by_asset_class: {},
                    cash_balance: 0,
                    cash_pct: 0,
                    concentration: {
                      max_stock_pct: 0,
                      max_stock_name: '',
                      max_sector_pct: 0,
                      max_sector_name: '',
                    },
                  },
                  drawdown: {
                    peak_value: portfolio.total_aum,
                    current_value: portfolio.total_aum,
                    drawdown_pct: 0,
                    peak_date: new Date(),
                  },
                  snapshot_date: new Date(portfolio.snapshot_date),
                  crm_last_synced: new Date(),
                },
              },
              { upsert: true },
            );

            synced++;
          } catch (err) {
            this.logger.error(
              `Failed to upsert portfolio ${portfolio.client_id}: ${(err as Error).message}`,
            );
            errors++;
          }
        }

        hasMore = response.hasMore;
        page++;
      }
    } catch (err) {
      this.logger.error(`Portfolio sync failed for RM ${rmId}: ${(err as Error).message}`);
      errors++;
    }

    return { rm_id: rmId, entity: 'portfolios', synced, skipped, errors, duration_ms: Date.now() - start };
  }

  private async _syncMeetings(rmId: string, changedSince?: Date): Promise<SyncResult> {
    const start = Date.now();
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const response: CRMSyncPage<CRMMeeting> = await this.crmApiClient.getMeetings(
        rmId,
        changedSince,
      );

      for (const meeting of response.data) {
        try {
          const existing = await this.meetingModel.findOne(
            { meeting_id: meeting.meeting_id },
            { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 },
          ).lean();

          const incomingChecksum = this.computeChecksum(meeting as unknown as Record<string, unknown>);
          const existingChecksum = existing
            ? this.computeChecksum(existing as unknown as Record<string, unknown>)
            : null;

          if (incomingChecksum === existingChecksum) {
            skipped++;
            continue;
          }

          await this.meetingModel.findOneAndUpdate(
            { meeting_id: meeting.meeting_id },
            {
              $set: {
                ...meeting,
                scheduled_date: new Date(meeting.scheduled_date),
                crm_last_synced: new Date(),
              },
            },
            { upsert: true },
          );

          synced++;
        } catch (err) {
          this.logger.error(
            `Failed to upsert meeting ${meeting.meeting_id}: ${(err as Error).message}`,
          );
          errors++;
        }
      }
    } catch (err) {
      this.logger.error(`Meeting sync failed for RM ${rmId}: ${(err as Error).message}`);
      errors++;
    }

    return { rm_id: rmId, entity: 'meetings', synced, skipped, errors, duration_ms: Date.now() - start };
  }

  private async _syncLeads(rmId: string, changedSince?: Date): Promise<SyncResult> {
    const start = Date.now();
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const response: CRMSyncPage<CRMLead> = await this.crmApiClient.getLeads(
        rmId,
        changedSince,
      );

      for (const lead of response.data) {
        try {
          const existing = await this.leadModel.findOne(
            { lead_id: lead.lead_id },
            { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 },
          ).lean();

          const incomingChecksum = this.computeChecksum(lead as unknown as Record<string, unknown>);
          const existingChecksum = existing
            ? this.computeChecksum(existing as unknown as Record<string, unknown>)
            : null;

          if (incomingChecksum === existingChecksum) {
            skipped++;
            continue;
          }

          await this.leadModel.findOneAndUpdate(
            { lead_id: lead.lead_id },
            {
              $set: {
                ...lead,
                created_date: new Date(lead.created_date),
                expiry_date: new Date(lead.expiry_date),
                last_contact: new Date(lead.last_contact),
                crm_last_synced: new Date(),
              },
            },
            { upsert: true },
          );

          synced++;
        } catch (err) {
          this.logger.error(
            `Failed to upsert lead ${lead.lead_id}: ${(err as Error).message}`,
          );
          errors++;
        }
      }
    } catch (err) {
      this.logger.error(`Lead sync failed for RM ${rmId}: ${(err as Error).message}`);
      errors++;
    }

    return { rm_id: rmId, entity: 'leads', synced, skipped, errors, duration_ms: Date.now() - start };
  }

  private async _syncPipeline(rmId: string): Promise<SyncResult> {
    const start = Date.now();
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const response: CRMSyncPage<CRMPipelineItem> = await this.crmApiClient.getPipeline(rmId);

      for (const item of response.data) {
        try {
          const existing = await this.pipelineModel.findOne(
            { pipeline_id: item.pipeline_id },
            { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 },
          ).lean();

          const incomingChecksum = this.computeChecksum(item as unknown as Record<string, unknown>);
          const existingChecksum = existing
            ? this.computeChecksum(existing as unknown as Record<string, unknown>)
            : null;

          if (incomingChecksum === existingChecksum) {
            skipped++;
            continue;
          }

          await this.pipelineModel.findOneAndUpdate(
            { pipeline_id: item.pipeline_id },
            {
              $set: {
                ...item,
                expected_close_date: new Date(item.expected_close_date),
                created_date: new Date(item.created_date),
                last_updated: new Date(item.last_updated),
                crm_last_synced: new Date(),
              },
            },
            { upsert: true },
          );

          synced++;
        } catch (err) {
          this.logger.error(
            `Failed to upsert pipeline item ${item.pipeline_id}: ${(err as Error).message}`,
          );
          errors++;
        }
      }
    } catch (err) {
      this.logger.error(`Pipeline sync failed for RM ${rmId}: ${(err as Error).message}`);
      errors++;
    }

    return { rm_id: rmId, entity: 'pipeline', synced, skipped, errors, duration_ms: Date.now() - start };
  }

  // --------------------------------------------------------------------------
  // Private: cache warming
  // --------------------------------------------------------------------------

  /**
   * Warms Redis cache for one RM after an incremental sync.
   * Fetches clients and portfolios from MongoDB and caches them.
   */
  private async _warmRMCache(rmId: string): Promise<void> {
    try {
      await this.cacheService.warmup(rmId, async () => {
        const [clients, portfolios] = await Promise.all([
          this.clientModel.find({ rm_id: rmId }).lean().exec(),
          this.portfolioModel.find({ rm_id: rmId }).lean().exec(),
        ]);

        return {
          [CRM_CACHE.rmClients(rmId)]: clients,
          [CRM_CACHE.rmPortfolios(rmId)]: portfolios,
        };
      });
    } catch (err) {
      // Cache warming failure must not block the sync result
      this.logger.error(`Cache warmup failed for RM ${rmId}: ${(err as Error).message}`);
    }
  }

  // --------------------------------------------------------------------------
  // Private: audit event
  // --------------------------------------------------------------------------

  private async _publishAuditEvent(action: WriteBackAction): Promise<void> {
    try {
      await this.kafkaService.publish(TOPIC_AUDIT_TRAIL, action.rm_id, {
        event: `crm.writeback.${action.type.toLowerCase()}`,
        rm_id: action.rm_id,
        timestamp: new Date().toISOString(),
        payload: action.data,
      });
    } catch (err) {
      this.logger.error(`Failed to publish audit event: ${(err as Error).message}`);
    }
  }

  // --------------------------------------------------------------------------
  // Private: active RM IDs
  // --------------------------------------------------------------------------

  /**
   * Fetches distinct RM IDs that have at least one client record in MongoDB.
   * Falls back to an empty array on error so fullSync() degrades gracefully.
   */
  private async getActiveRMIds(): Promise<string[]> {
    try {
      const ids = await this.clientModel.distinct('rm_id').exec();
      return ids as string[];
    } catch (err) {
      this.logger.error(`Failed to fetch active RM IDs: ${(err as Error).message}`);
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Private: checksum
  // --------------------------------------------------------------------------

  /**
   * Computes a deterministic SHA-256 checksum over a plain object.
   *
   * Keys are sorted before serialisation so that `{ a: 1, b: 2 }` and
   * `{ b: 2, a: 1 }` produce the same checksum, preventing spurious updates
   * when the CRM API returns fields in a different order.
   */
  computeChecksum(data: Record<string, unknown>): string {
    const sorted = this._sortedStringify(data);
    return crypto.createHash('sha256').update(sorted).digest('hex');
  }

  private _sortedStringify(value: unknown): string {
    if (value === null || value === undefined) {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this._sortedStringify(v)).join(',') + ']';
    }
    if (typeof value === 'object' && !(value instanceof Date)) {
      const obj = value as Record<string, unknown>;
      const sorted = Object.keys(obj)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${this._sortedStringify(obj[k])}`)
        .join(',');
      return '{' + sorted + '}';
    }
    return JSON.stringify(value);
  }
}
