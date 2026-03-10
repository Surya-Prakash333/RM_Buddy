import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Client, ClientSchema } from '../../database/models/client.model';
import { AlertRecord, AlertSchema } from '../../database/models/alert.model';
import { Meeting, MeetingSchema } from '../../database/models/meeting.model';
import { Portfolio, PortfolioSchema } from '../../database/models/portfolio.model';

import { CacheModule } from '../cache/cache.module';

import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { QueryEngineService } from './query-engine.service';

/**
 * SearchModule provides full-text search, fast client lookup capabilities,
 * and a natural-language query engine (QueryEngineService).
 *
 * Dependencies:
 *  - CacheModule    — ioredis client for Redis hash lookup maps
 *  - MongooseModule — Client, AlertRecord, Meeting, Portfolio collections
 *
 * Exports:
 *  - SearchService      — for other modules (e.g., QA agent) that need search
 *  - QueryEngineService — NL query parser/executor for the LangGraph Q&A agent
 */
@Module({
  imports: [
    CacheModule,
    MongooseModule.forFeature([
      { name: Client.name, schema: ClientSchema },
      { name: AlertRecord.name, schema: AlertSchema },
      { name: Meeting.name, schema: MeetingSchema },
      { name: Portfolio.name, schema: PortfolioSchema },
    ]),
  ],
  providers: [SearchService, QueryEngineService],
  controllers: [SearchController],
  exports: [SearchService, QueryEngineService],
})
export class SearchModule {}
