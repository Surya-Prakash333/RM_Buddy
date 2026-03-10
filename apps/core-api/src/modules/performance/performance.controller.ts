/**
 * PerformanceController — S1-F33-L1-Data & S1-F33-L2-Logic
 *
 * Base path: /api/v1/performance
 *
 * Endpoints:
 *   GET /api/v1/performance/strengths?period=2024-01
 *     → StrengthReport for the authenticated RM
 *
 *   GET /api/v1/performance/team-strengths?period=2024-01
 *     → StrengthReport[] for all RMs in the BM's branch
 *
 * Auth: X-RM-Identity header required (processed by AuthGuard).
 */

import {
  Controller,
  Get,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiHeader,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RMIdentity } from '../../common/decorators/rm-identity.decorator';
import { PerformanceService } from './performance.service';
import { StrengthReport } from './dto/performance.dto';

interface RmIdentityPayload {
  rm_id: string;
  name?: string;
  rm_branch?: string;
}

@ApiTags('Performance')
@ApiHeader({
  name: 'X-RM-Identity',
  description: 'Base64-encoded JSON: {"rm_id":"rm-001","name":"Arjun Shah","rm_branch":"BKC"}',
  required: true,
})
@Controller('api/v1/performance')
@UseGuards(AuthGuard)
export class PerformanceController {
  private readonly logger = new Logger(PerformanceController.name);

  constructor(private readonly performanceService: PerformanceService) {}

  /**
   * GET /api/v1/performance/strengths?period=2024-01
   *
   * Returns the top-3 strengths and bottom-2 growth areas for the
   * authenticated RM relative to their branch peers.
   */
  @Get('strengths')
  @ApiOperation({
    summary: 'Get strength report for the authenticated RM vs branch peers',
  })
  @ApiQuery({
    name: 'period',
    description: "Period in 'YYYY-MM' or 'YYYY' format. Defaults to current month.",
    required: false,
    example: '2024-01',
  })
  async getStrengths(
    @RMIdentity() rm: RmIdentityPayload,
    @Query('period') period?: string,
  ): Promise<StrengthReport> {
    const p = period ?? new Date().toISOString().slice(0, 7); // YYYY-MM
    const branch = rm.rm_branch ?? 'UNKNOWN';
    this.logger.log(`getStrengths rm_id=${rm.rm_id} branch=${branch} period=${p}`);
    return this.performanceService.identifyStrengths(rm.rm_id, branch, p);
  }

  /**
   * GET /api/v1/performance/team-strengths?period=2024-01
   *
   * Returns strength reports for all RMs in the BM's branch.
   * Intended for Branch Manager use.
   */
  @Get('team-strengths')
  @ApiOperation({
    summary: "Get strength reports for all RMs in the BM's branch",
  })
  @ApiQuery({
    name: 'period',
    description: "Period in 'YYYY-MM' or 'YYYY' format. Defaults to current month.",
    required: false,
    example: '2024-01',
  })
  async getTeamStrengths(
    @RMIdentity() rm: RmIdentityPayload,
    @Query('period') period?: string,
  ): Promise<StrengthReport[]> {
    const p = period ?? new Date().toISOString().slice(0, 7);
    const branch = rm.rm_branch ?? 'UNKNOWN';
    this.logger.log(`getTeamStrengths bm=${rm.rm_id} branch=${branch} period=${p}`);

    // Get all peer metrics for the branch, then generate a strength report per RM
    const peerMetrics = await this.performanceService.getPeerMetrics(branch, p);
    return Promise.all(
      peerMetrics.map((peer) =>
        this.performanceService.identifyStrengths(peer.rm_id, branch, p),
      ),
    );
  }
}
