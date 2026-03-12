import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiHeader,
  ApiResponse as SwaggerApiResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RMIdentity } from '../../common/decorators/rm-identity.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { FilterDto } from '../../common/dto/filter.dto';
import { DashboardService, ApiResponse } from './dashboard.service';

interface RmIdentityPayload {
  rm_id: string;
  name?: string;
  rm_branch?: string;
}

function buildResponse<T>(data: T): ApiResponse<T> {
  return { status: 'success', data, timestamp: new Date().toISOString() };
}

/**
 * DashboardController serves all dashboard and client-data endpoints for the
 * RM Buddy front end. Every route requires a valid X-RM-Identity header
 * (processed by AuthGuard).
 *
 * Base path: /api/v1
 *
 * All responses follow the envelope: { status, data, timestamp }.
 */
@ApiTags('Dashboard')
@ApiHeader({
  name: 'X-RM-Identity',
  description: 'Base64-encoded JSON: {"rm_id":"rm-001","name":"Arjun Shah"}',
  required: true,
})
@Controller('api/v1')
@UseGuards(AuthGuard)
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly dashboardService: DashboardService) { }

  // -------------------------------------------------------------------------
  // Dashboard Summary
  // -------------------------------------------------------------------------

  @Get('dashboard/summary')
  @ApiOperation({ summary: 'Get KPI summary for the authenticated RM' })
  async getSummary(@RMIdentity() identity: RmIdentityPayload): Promise<ApiResponse<Record<string, unknown>>> {
    this.logger.log(`getSummary rm_id=${identity.rm_id}`);
    return buildResponse(await this.dashboardService.getSummary(identity.rm_id));
  }

  // -------------------------------------------------------------------------
  // Clients
  // -------------------------------------------------------------------------

  @Get('clients')
  @ApiOperation({ summary: 'List all clients managed by the RM' })
  async getClients(
    @RMIdentity() identity: RmIdentityPayload,
    @Query() _pagination: PaginationDto,
    @Query() filter: FilterDto,
  ): Promise<ApiResponse<unknown>> {
    this.logger.log(`getClients rm_id=${identity.rm_id}`);
    return buildResponse(await this.dashboardService.getClients(identity.rm_id, filter.search, filter.tier, filter.city));
  }

  @Get('clients/:id')
  @ApiOperation({ summary: 'Get a single client by ID' })
  @ApiParam({ name: 'id', description: 'Client document ID' })
  async getClient(
    @RMIdentity() identity: RmIdentityPayload,
    @Param('id') clientId: string,
  ): Promise<ApiResponse<unknown>> {
    this.logger.log(`getClient rm_id=${identity.rm_id} client_id=${clientId}`);
    return buildResponse(await this.dashboardService.getClient(identity.rm_id, clientId));
  }

  @Get('clients/:id/portfolio')
  @ApiOperation({ summary: 'Get portfolio holdings for a client' })
  @ApiParam({ name: 'id', description: 'Client document ID' })
  async getPortfolio(
    @RMIdentity() identity: RmIdentityPayload,
    @Param('id') clientId: string,
  ): Promise<ApiResponse<unknown>> {
    this.logger.log(`getPortfolio rm_id=${identity.rm_id} client_id=${clientId}`);
    return buildResponse(await this.dashboardService.getPortfolio(identity.rm_id, clientId));
  }

  // -------------------------------------------------------------------------
  // Alerts
  // -------------------------------------------------------------------------

  @Get('alerts')
  @ApiOperation({ summary: 'List unacknowledged and recent alerts for the RM' })
  async getAlerts(
    @RMIdentity() identity: RmIdentityPayload,
    @Query() _filter: FilterDto,
  ): Promise<ApiResponse<unknown>> {
    this.logger.log(`getAlerts rm_id=${identity.rm_id}`);
    return buildResponse(await this.dashboardService.getAlerts(identity.rm_id));
  }

  @Patch('alerts/:id/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an alert by ID' })
  @ApiParam({ name: 'id', description: 'Alert document ID' })
  async acknowledgeAlert(
    @RMIdentity() identity: RmIdentityPayload,
    @Param('id') alertId: string,
  ): Promise<ApiResponse<unknown>> {
    this.logger.log(`acknowledgeAlert rm_id=${identity.rm_id} alert_id=${alertId}`);
    return buildResponse(await this.dashboardService.acknowledgeAlert(identity.rm_id, alertId));
  }

  // -------------------------------------------------------------------------
  // Briefing
  // -------------------------------------------------------------------------

  @Get('briefing/today')
  @ApiOperation({ summary: "Get today's AI-generated briefing for the RM" })
  async getBriefing(@RMIdentity() identity: RmIdentityPayload): Promise<ApiResponse<unknown>> {
    this.logger.log(`getBriefing rm_id=${identity.rm_id}`);
    return buildResponse(await this.dashboardService.getBriefing(identity.rm_id));
  }

  // -------------------------------------------------------------------------
  // Daily Actions
  // -------------------------------------------------------------------------

  @Get('daily-actions')
  @ApiOperation({ summary: 'Get prioritized daily actions for the RM' })
  async getDailyActions(@RMIdentity() identity: RmIdentityPayload): Promise<ApiResponse<unknown>> {
    this.logger.log(`getDailyActions rm_id=${identity.rm_id}`);
    return buildResponse(await this.dashboardService.getDailyActions(identity.rm_id));
  }

  // -------------------------------------------------------------------------
  // Meetings
  // -------------------------------------------------------------------------

  @Get('meetings')
  @ApiOperation({ summary: "Get today's meetings for the RM" })
  async getMeetings(@RMIdentity() identity: RmIdentityPayload): Promise<ApiResponse<unknown>> {
    this.logger.log(`getMeetings rm_id=${identity.rm_id}`);
    return buildResponse(await this.dashboardService.getMeetings(identity.rm_id));
  }

  // -------------------------------------------------------------------------
  // Leads & Pipeline
  // -------------------------------------------------------------------------

  @Get('leads')
  @ApiOperation({ summary: 'List leads assigned to the RM' })
  async getLeads(
    @RMIdentity() identity: RmIdentityPayload,
    @Query() _filter: FilterDto,
  ): Promise<ApiResponse<unknown>> {
    this.logger.log(`getLeads rm_id=${identity.rm_id}`);
    return buildResponse(await this.dashboardService.getLeads(identity.rm_id));
  }

  @Get('pipeline')
  @ApiOperation({ summary: 'Get sales pipeline items for the RM' })
  async getPipeline(
    @RMIdentity() identity: RmIdentityPayload,
    @Query() _pagination: PaginationDto,
  ): Promise<ApiResponse<unknown>> {
    this.logger.log(`getPipeline rm_id=${identity.rm_id}`);
    return buildResponse(await this.dashboardService.getPipeline(identity.rm_id));
  }

  @Get('cross-sell')
  @ApiOperation({ summary: 'Get AI-generated cross-sell opportunities' })
  async getCrossSell(
    @RMIdentity() identity: RmIdentityPayload,
    @Query() _filter: FilterDto,
  ): Promise<ApiResponse<unknown>> {
    this.logger.log(`getCrossSell rm_id=${identity.rm_id}`);
    return buildResponse(await this.dashboardService.getCrossSell(identity.rm_id));
  }

  // -------------------------------------------------------------------------
  // CRM Sync
  // -------------------------------------------------------------------------

  @Post('crm-sync/trigger')
  @ApiOperation({ summary: 'Trigger a manual CRM synchronization' })
  triggerSync(@RMIdentity() identity: RmIdentityPayload): ApiResponse<unknown> {
    this.logger.log(`triggerSync rm_id=${identity.rm_id}`);
    return buildResponse({
      job_id: `crm-sync-${Date.now()}`,
      status: 'QUEUED',
      message: 'CRM sync job has been queued. Results will be published to Kafka topic crm.sync.completed.',
      queued_at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // Daily Status Review (S1-F6-L1-Data / S1-F6-L2-Logic)
  // -------------------------------------------------------------------------

  @Get('dashboard/daily-status')
  @ApiOperation({ summary: 'Daily activity summary with gap analysis vs. branch team average' })
  @ApiQuery({ name: 'date', description: 'ISO date (YYYY-MM-DD). Defaults to today.', required: false })
  @SwaggerApiResponse({ status: 200, description: 'Daily status with peer rank and gaps' })
  async getDailyStatus(
    @RMIdentity() rm: RmIdentityPayload,
    @Query('date') date?: string,
  ): Promise<unknown> {
    const targetDate = date ?? new Date().toISOString().split('T')[0];
    const branch = rm.rm_branch ?? 'default';
    this.logger.log(`getDailyStatus rm_id=${rm.rm_id} branch=${branch} date=${targetDate}`);
    return this.dashboardService.getDailyStatusWithGapAnalysis(rm.rm_id, branch, targetDate);
  }

  // -------------------------------------------------------------------------
  // QA / AI Query
  // -------------------------------------------------------------------------

  @Get('qa/query')
  @ApiOperation({ summary: 'Ask a natural language question to the AI agent' })
  @ApiQuery({ name: 'q', description: 'Natural language question', required: false })
  queryQA(
    @RMIdentity() identity: RmIdentityPayload,
    @Query('q') query: string = '',
  ): ApiResponse<unknown> {
    this.logger.log(`queryQA rm_id=${identity.rm_id} q="${query}"`);
    return buildResponse(this.dashboardService.queryQA(identity.rm_id, query));
  }
}
