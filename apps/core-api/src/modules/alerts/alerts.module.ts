import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { AlertRecord, AlertSchema } from '../../database/models/alert.model';
import { AlertRuleRecord, AlertRuleSchema } from '../../database/models/alert-rule.model';
import { Client, ClientSchema } from '../../database/models/client.model';
import { Portfolio, PortfolioSchema } from '../../database/models/portfolio.model';
import { Transaction, TransactionSchema } from '../../database/models/transaction.model';

import { CacheModule } from '../cache/cache.module';
import { KafkaModule } from '../kafka/kafka.module';

import { AlertsService } from './alerts.service';
import { AlertEngineService } from './alert-engine.service';
import { AlertsController } from './alerts.controller';

/**
 * AlertsModule wires together the alert engine, CRUD service, and HTTP controller.
 *
 * Dependencies:
 *  - ConfigModule   — env-based config for cache/kafka (already global, kept for explicitness)
 *  - CacheModule    — Redis write-through cache + cooldown management
 *  - KafkaModule    — alerts.generated topic publishing
 *  - MongooseModule — AlertRecord, AlertRuleRecord, Client, Portfolio, Transaction collections
 *
 * The circular dependency between AlertsService ↔ AlertEngineService is resolved
 * by using @Inject(forwardRef(() => ...)) decorators in both service constructors.
 * NestJS handles circular provider dependencies automatically when both providers
 * are registered in the same module.
 *
 * Exports:
 *  - AlertsService      — for other modules that need to create/query alerts
 *  - AlertEngineService — for scheduled jobs in S2 that call evaluateRule()
 */
@Module({
  imports: [
    ConfigModule,
    CacheModule,
    KafkaModule,
    MongooseModule.forFeature([
      { name: AlertRecord.name, schema: AlertSchema },
      { name: AlertRuleRecord.name, schema: AlertRuleSchema },
      { name: Client.name, schema: ClientSchema },
      { name: Portfolio.name, schema: PortfolioSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  providers: [AlertsService, AlertEngineService],
  controllers: [AlertsController],
  exports: [AlertsService, AlertEngineService],
})
export class AlertsModule {}
