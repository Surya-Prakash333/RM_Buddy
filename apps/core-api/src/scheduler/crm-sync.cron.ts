import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrmSyncService } from '../modules/crm-sync/crm-sync.service';

/**
 * Scheduled cron job that triggers the nightly full CRM sync.
 *
 * IMPORTANT — registration requirements:
 *   This class must be registered as a provider in AppModule (or a top-level
 *   SchedulerModule) alongside:
 *     - ScheduleModule.forRoot()  from @nestjs/schedule
 *     - CrmSyncModule             (exports CrmSyncService)
 *
 *   Example AppModule imports:
 *     imports: [ScheduleModule.forRoot(), CrmSyncModule, ...]
 *     providers: [CrmSyncCron, ...]
 *
 * The @Cron decorator is provided by @nestjs/schedule (already in package.json).
 * No additional npm install is required.
 */
@Injectable()
export class CrmSyncCron {
  private readonly logger = new Logger(CrmSyncCron.name);

  constructor(private readonly crmSyncService: CrmSyncService) {}

  /**
   * Nightly full CRM sync at 2:00 AM IST.
   *
   * Runs after the cache-warmup.cron.ts job (both are scheduled at 2AM; the
   * sync should ideally be offset to 2:05 AM or later in production if cache
   * warmup must complete first — adjust the cron expression accordingly).
   *
   * Time zone: Asia/Kolkata (IST = UTC+5:30)
   */
  @Cron('0 2 * * *', { name: 'crm-full-sync', timeZone: 'Asia/Kolkata' })
  async handleDailyFullSync(): Promise<void> {
    this.logger.log('Starting nightly full CRM sync...');

    try {
      const results = await this.crmSyncService.fullSync();

      const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
      const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

      this.logger.log(
        `Nightly sync complete: ${totalSynced} records synced, ` +
        `${totalSkipped} skipped (unchanged), ` +
        `${totalErrors} errors`,
      );

      if (totalErrors > 0) {
        this.logger.warn(
          `Nightly sync completed with ${totalErrors} error(s) — check logs for details`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Nightly full CRM sync failed unexpectedly: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
