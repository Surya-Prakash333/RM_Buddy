import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { RMSession, RMSessionSchema } from '../../database/models/rm-session.model';
import { AuditTrail, AuditSchema } from '../../database/models/audit.model';
import { CacheModule } from '../cache/cache.module';

import { EngagementService } from './engagement.service';
import { EngagementController } from './engagement.controller';

/**
 * EngagementModule wires together session/audit data sources and the HTTP controller.
 *
 * Dependencies:
 *  - CacheModule      — Redis read-through / write-through cache (30-min TTL)
 *  - MongooseModule   — RMSession (rm_sessions) and AuditTrail (audit_trail) collections
 *
 * Exports:
 *  - EngagementService — for other modules that need to query engagement data
 */
@Module({
  imports: [
    CacheModule,
    MongooseModule.forFeature([
      { name: RMSession.name, schema: RMSessionSchema },
      { name: AuditTrail.name, schema: AuditSchema },
    ]),
  ],
  providers: [EngagementService],
  controllers: [EngagementController],
  exports: [EngagementService],
})
export class EngagementModule {}
