import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { Meeting, MeetingSchema } from '../../database/models/meeting.model';
import { AlertRecord, AlertSchema } from '../../database/models/alert.model';
import { Portfolio, PortfolioSchema } from '../../database/models/portfolio.model';
import { Transaction, TransactionSchema } from '../../database/models/transaction.model';
import { Client, ClientSchema } from '../../database/models/client.model';

import { CacheModule } from '../cache/cache.module';

import { BriefingService } from './briefing.service';
import { BriefingController } from './briefing.controller';

/**
 * BriefingModule wires together all data sources needed for the morning
 * briefing feature (S2-F1-L1-Data).
 *
 * Dependencies:
 *  - ConfigModule     — global env config (kept explicit for clarity)
 *  - CacheModule      — Redis read/write for 5-minute briefing cache
 *  - MongooseModule   — Meeting, AlertRecord, Portfolio, Transaction, Client
 *
 * The module is self-contained and exports BriefingService so that other
 * modules (e.g., a scheduler) can request a briefing without HTTP overhead.
 */
@Module({
  imports: [
    ConfigModule,
    CacheModule,
    MongooseModule.forFeature([
      { name: Meeting.name, schema: MeetingSchema },
      { name: AlertRecord.name, schema: AlertSchema },
      { name: Portfolio.name, schema: PortfolioSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Client.name, schema: ClientSchema },
    ]),
  ],
  providers: [BriefingService],
  controllers: [BriefingController],
  exports: [BriefingService],
})
export class BriefingModule {}
