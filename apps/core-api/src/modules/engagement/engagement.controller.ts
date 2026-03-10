import {
  Controller,
  Get,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { AuthGuard } from '../../common/guards/auth.guard';
import { RMIdentity } from '../../common/decorators/rm-identity.decorator';
import { EngagementService } from './engagement.service';
import { EngagementDataQueryDto, EngagementTrendQueryDto } from './dto/engagement.dto';

/** Minimal shape attached to the request by AuthGuard. */
interface RMIdentityPayload {
  rm_id: string;
  name?: string;
}

/**
 * EngagementController exposes two read-only endpoints under /api/v1/engagement.
 *
 * All routes require an authenticated RM identity via AuthGuard.
 * Data is scoped to the RM identified by the X-RM-Identity header.
 *
 * Routes:
 *   GET /api/v1/engagement/data?period=YYYY-MM  — full engagement snapshot
 *   GET /api/v1/engagement/trend?days=N         — daily trend for last N days
 */
@ApiTags('Engagement')
@Controller('api/v1/engagement')
@UseGuards(AuthGuard)
export class EngagementController {
  private readonly logger = new Logger(EngagementController.name);

  constructor(private readonly engagementService: EngagementService) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/engagement/data
  // ---------------------------------------------------------------------------

  /**
   * Return the full engagement data snapshot for the authenticated RM.
   * Optional query param `period` (YYYY-MM); defaults to current month.
   *
   * Response is cached in Redis for 30 minutes.
   */
  @ApiOperation({ summary: 'Get engagement data snapshot for authenticated RM' })
  @ApiResponse({ status: 200, description: 'Engagement data snapshot' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-RM-Identity header' })
  @Get('data')
  async getEngagementData(
    @RMIdentity() rm: RMIdentityPayload,
    @Query() query: EngagementDataQueryDto,
  ) {
    this.logger.debug(`GET /engagement/data rm=${rm.rm_id} period=${query.period ?? 'current'}`);

    const data = await this.engagementService.getEngagementData(
      rm.rm_id,
      query.period ?? '',
    );

    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      data,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/engagement/trend
  // ---------------------------------------------------------------------------

  /**
   * Return daily consistency scores for the last N days (default 30).
   * Each data point includes: login flag, session count, CRM actions, daily score.
   */
  @ApiOperation({ summary: 'Get daily engagement trend for authenticated RM' })
  @ApiResponse({ status: 200, description: 'Array of daily engagement trend points' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-RM-Identity header' })
  @Get('trend')
  async getEngagementTrend(
    @RMIdentity() rm: RMIdentityPayload,
    @Query() query: EngagementTrendQueryDto,
  ) {
    const days = query.days ?? 30;
    this.logger.debug(`GET /engagement/trend rm=${rm.rm_id} days=${days}`);

    const trend = await this.engagementService.getEngagementTrend(rm.rm_id, days);

    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: trend,
    };
  }
}
