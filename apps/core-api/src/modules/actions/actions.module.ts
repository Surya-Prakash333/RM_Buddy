import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';
import { Pipeline, PipelineSchema } from '../../database/models/pipeline.model';
import { Portfolio, PortfolioSchema } from '../../database/models/portfolio.model';
import { Client, ClientSchema } from '../../database/models/client.model';
import { Meeting, MeetingSchema } from '../../database/models/meeting.model';
import { CacheModule } from '../cache/cache.module';

/**
 * ActionsModule registers all dependencies for the Daily Actions feature
 * (S2-F13-L1-Data).
 *
 * Models injected:
 *   - Pipeline  → pipeline aging + pending proposals
 *   - Portfolio → idle cash detection
 *   - Client    → tier enrichment for idle cash aggregation
 *   - Meeting   → follow-ups due (meeting_type = 'follow_up')
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Pipeline.name, schema: PipelineSchema },
      { name: Portfolio.name, schema: PortfolioSchema },
      { name: Client.name, schema: ClientSchema },
      { name: Meeting.name, schema: MeetingSchema },
    ]),
    CacheModule,
  ],
  controllers: [ActionsController],
  providers: [ActionsService],
  exports: [ActionsService],
})
export class ActionsModule {}
