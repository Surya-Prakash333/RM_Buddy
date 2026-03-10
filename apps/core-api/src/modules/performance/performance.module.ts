/**
 * PerformanceModule — S1-F33-L1-Data & S1-F33-L2-Logic
 *
 * Registers the Mongoose models needed for performance metrics aggregation
 * and wires up the controller + service.
 *
 * CacheModule is NOT re-imported here; it is global and exported from AppModule.
 * CacheService is available for injection via the global CacheModule export.
 */

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { Client, ClientSchema } from '../../database/models/client.model';
import { Meeting, MeetingSchema } from '../../database/models/meeting.model';
import { Transaction, TransactionSchema } from '../../database/models/transaction.model';
import { Portfolio, PortfolioSchema } from '../../database/models/portfolio.model';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Client.name, schema: ClientSchema },
      { name: Meeting.name, schema: MeetingSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Portfolio.name, schema: PortfolioSchema },
    ]),
    CacheModule,
  ],
  controllers: [PerformanceController],
  providers: [PerformanceService],
  exports: [PerformanceService],
})
export class PerformanceModule {}
