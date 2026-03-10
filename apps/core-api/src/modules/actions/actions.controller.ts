import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiHeader,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RMIdentity } from '../../common/decorators/rm-identity.decorator';
import { ActionsService } from './actions.service';
import { DailyActionsData, DailyActionsSummary, RankedActionsData } from './dto/actions.dto';

interface RmIdentityPayload {
  rm_id: string;
  name?: string;
  rm_branch?: string;
}

/**
 * ActionsController exposes the Daily Actions endpoints for the RM Buddy
 * front-end card.
 *
 * Base path: /api/v1/daily-actions
 *
 * Every route is protected by AuthGuard which reads and decodes the
 * X-RM-Identity header populated by the API gateway.
 */
@ApiTags('Daily Actions')
@ApiHeader({
  name: 'X-RM-Identity',
  description: 'Base64-encoded JSON: {"rm_id":"rm-001","name":"Arjun Shah"}',
  required: true,
})
@Controller('api/v1/daily-actions')
@UseGuards(AuthGuard)
export class ActionsController {
  private readonly logger = new Logger(ActionsController.name);

  constructor(private readonly actionsService: ActionsService) {}

  /**
   * GET /api/v1/daily-actions
   *
   * Returns full aggregated daily-actions payload for the RM, optionally
   * scoped to a specific date (defaults to today).
   */
  @Get()
  @ApiOperation({
    summary: 'Get all daily actions aggregated from 4 sources',
    description:
      'Aggregates pipeline aging, pending proposals, due follow-ups, and idle-cash clients ' +
      'for the authenticated RM. Results are cached 15 minutes per RM per date.',
  })
  @ApiQuery({
    name: 'date',
    description: 'ISO date (YYYY-MM-DD). Defaults to today.',
    required: false,
  })
  async getDailyActions(
    @RMIdentity() rm: RmIdentityPayload,
    @Query('date') date?: string,
  ): Promise<DailyActionsData> {
    const targetDate = date ?? new Date().toISOString().split('T')[0];
    this.logger.log(`getDailyActions rm_id=${rm.rm_id} date=${targetDate}`);
    return this.actionsService.getActionsData(rm.rm_id, targetDate);
  }

  /**
   * GET /api/v1/daily-actions/ranked
   *
   * Returns all actions scored and ranked by composite priority score.
   * Top 10 actions are included in `top_actions`; all scored actions in `all_actions`.
   * Results are cached 15 minutes per RM per date.
   */
  @Get('ranked')
  @ApiOperation({
    summary: 'Get priority-scored and ranked daily actions',
    description:
      'Scores all actions across 4 sources using a composite formula ' +
      '(client tier × urgency × financial stake) and returns them ranked ' +
      'by priority_score descending. Top 10 are in top_actions.',
  })
  @ApiQuery({
    name: 'date',
    description: 'ISO date (YYYY-MM-DD). Defaults to today.',
    required: false,
  })
  async getRankedActions(
    @RMIdentity() rm: RmIdentityPayload,
    @Query('date') date?: string,
  ): Promise<RankedActionsData> {
    const targetDate = date ?? new Date().toISOString().split('T')[0];
    this.logger.log(`getRankedActions rm_id=${rm.rm_id} date=${targetDate}`);
    return this.actionsService.getRankedActions(rm.rm_id, targetDate);
  }

  /**
   * GET /api/v1/daily-actions/summary
   *
   * Returns a lightweight count-only summary for badge/notification rendering.
   */
  @Get('summary')
  @ApiOperation({
    summary: 'Get count summary of daily actions (badge counts)',
    description:
      'Returns counts per source (pipeline, proposals, follow-ups, idle cash) and a ' +
      'total_actions figure. Useful for rendering notification badges.',
  })
  async getActionsSummary(
    @RMIdentity() rm: RmIdentityPayload,
  ): Promise<DailyActionsSummary> {
    this.logger.log(`getActionsSummary rm_id=${rm.rm_id}`);
    return this.actionsService.getActionsSummary(rm.rm_id);
  }
}
