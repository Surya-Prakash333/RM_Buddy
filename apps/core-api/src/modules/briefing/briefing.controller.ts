import {
  Controller,
  Get,
  Param,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

import { AuthGuard } from '../../common/guards/auth.guard';
import { RMIdentity } from '../../common/decorators/rm-identity.decorator';
import { BriefingService } from './briefing.service';

/** Minimal RM identity shape attached to the request by AuthGuard. */
interface RMIdentityPayload {
  rm_id: string;
  name?: string;
}

/**
 * BriefingController exposes two endpoints under /api/v1/briefing.
 *
 * GET /api/v1/briefing/today    — briefing for today's date (auto-derived)
 * GET /api/v1/briefing/:date    — briefing for an explicit YYYY-MM-DD date
 *
 * Both routes are protected by AuthGuard (X-RM-Identity header).
 * Data is sourced from BriefingService which caches in Redis for 5 minutes.
 */
@ApiTags('Briefing')
@Controller('api/v1/briefing')
@UseGuards(AuthGuard)
export class BriefingController {
  private readonly logger = new Logger(BriefingController.name);

  constructor(private readonly briefingService: BriefingService) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/briefing/today
  // ---------------------------------------------------------------------------

  /**
   * Return today's morning briefing for the authenticated RM.
   * Date is derived server-side to avoid client clock skew.
   */
  @ApiOperation({ summary: "Return today's morning briefing for the authenticated RM" })
  @ApiResponse({ status: 200, description: 'Briefing data for today' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-RM-Identity header' })
  @Get('today')
  async getTodaysBriefing(@RMIdentity() rm: RMIdentityPayload) {
    const today = new Date().toISOString().split('T')[0];
    this.logger.debug(`GET /briefing/today rm=${rm.rm_id} date=${today}`);

    const data = await this.briefingService.getIdempotentBriefing(rm.rm_id, today);

    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      briefing_id: data.briefing_id,
      data,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/briefing/:date
  // ---------------------------------------------------------------------------

  /**
   * Return the morning briefing for the authenticated RM on a specific date.
   * Useful for reviewing past briefings or testing with a fixed date.
   *
   * @param date  YYYY-MM-DD
   */
  @ApiOperation({ summary: 'Return the morning briefing for the authenticated RM on a given date' })
  @ApiParam({ name: 'date', description: 'Date in YYYY-MM-DD format', example: '2026-03-10' })
  @ApiResponse({ status: 200, description: 'Briefing data for the requested date' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-RM-Identity header' })
  @Get(':date')
  async getBriefing(
    @RMIdentity() rm: RMIdentityPayload,
    @Param('date') date: string,
  ) {
    this.logger.debug(`GET /briefing/${date} rm=${rm.rm_id}`);

    const data = await this.briefingService.getBriefingData(rm.rm_id, date);

    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      data,
    };
  }
}
