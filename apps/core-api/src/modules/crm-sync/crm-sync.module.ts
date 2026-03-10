import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '../cache/cache.module';
import { KafkaModule } from '../kafka/kafka.module';
import { CrmApiClient } from './crm-api.client';
import { CrmSyncService } from './crm-sync.service';
import {
  Client,
  ClientSchema,
  Portfolio,
  PortfolioSchema,
  Meeting,
  MeetingSchema,
  Lead,
  LeadSchema,
  Pipeline,
  PipelineSchema,
} from '../../database/models';

/**
 * CrmSyncModule wires up the CRM API client and the sync orchestration service.
 *
 * NOTE: To enable the CrmSyncCron scheduled job, this module (or CrmSyncModule)
 * must be imported in AppModule alongside ScheduleModule.forRoot() from
 * @nestjs/schedule. CrmSyncCron is declared in apps/core-api/src/scheduler/
 * and should be registered as a provider in AppModule or a top-level scheduler
 * module — it is kept outside CrmSyncModule deliberately so the scheduler
 * layer stays decoupled from the feature module.
 */
@Module({
  imports: [
    ConfigModule,
    CacheModule,
    KafkaModule,
    MongooseModule.forFeature([
      { name: Client.name, schema: ClientSchema },
      { name: Portfolio.name, schema: PortfolioSchema },
      { name: Meeting.name, schema: MeetingSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Pipeline.name, schema: PipelineSchema },
    ]),
  ],
  providers: [CrmApiClient, CrmSyncService],
  exports: [CrmSyncService],
})
export class CrmSyncModule {}
