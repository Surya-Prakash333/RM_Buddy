import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './config/database.module';
import { CacheModule } from './modules/cache/cache.module';
import { KafkaModule } from './modules/kafka/kafka.module';
import { HealthModule } from './modules/health/health.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { SearchModule } from './modules/search/search.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { BriefingModule } from './modules/briefing/briefing.module';
import { ActionsModule } from './modules/actions/actions.module';
// CrmSyncModule exists but is kept commented out per INFRA-API-01 scope.
// Uncomment once scheduler integration is verified end-to-end (INFRA-MONGO-02).
// import { CrmSyncModule } from './modules/crm-sync/crm-sync.module';
// TODO: uncomment after alerts module is implemented
// import { AlertsModule } from './modules/alerts/alerts.module';

/**
 * AppModule is the root NestJS module for core-api.
 *
 * Module load order:
 *   1. ConfigModule  — global env / config namespace registration
 *   2. DatabaseModule — Mongoose connection (depends on config)
 *   3. CacheModule   — ioredis client
 *   4. KafkaModule   — KafkaJS producer + consumer
 *   5. HealthModule  — /health and /ready probes (no auth)
 *   6. DashboardModule — all /api/v1/* business endpoints
 *   7. ActionsModule  — /api/v1/daily-actions (S2-F13-L1-Data)
 *
 * Modules commented out are pending their respective implementation stories.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    CacheModule,
    KafkaModule,
    HealthModule,
    DashboardModule,
    PerformanceModule,
    SearchModule,
    EngagementModule,
    BriefingModule,
    ActionsModule,
    // CrmSyncModule, // uncomment after scheduler integration verified (INFRA-MONGO-02)
    // AlertsModule,  // TODO: implement in alerts story
  ],
})
export class AppModule {}
