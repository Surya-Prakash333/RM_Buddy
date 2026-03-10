import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

import { AuthGuard } from '../../common/guards/auth.guard';
import { RMIdentity } from '../../common/decorators/rm-identity.decorator';
import { AlertsService } from './alerts.service';
import { AlertEngineService } from './alert-engine.service';
import { AlertQueryDto } from './dto/alert-query.dto';

/** Minimal shape attached to the request by AuthGuard. */
interface RMIdentityPayload {
  rm_id: string;
  name?: string;
}

/**
 * AlertsController exposes four endpoints under /api/v1/alerts.
 *
 * All routes require an authenticated RM identity via AuthGuard.
 * The rm_id from the identity header is used as the data isolation boundary —
 * an RM can only read and mutate their own alerts.
 */
@ApiTags('Alerts')
@Controller('api/v1/alerts')
@UseGuards(AuthGuard)
export class AlertsController {
  private readonly logger = new Logger(AlertsController.name);

  constructor(
    private readonly alertsService: AlertsService,
    private readonly alertEngineService: AlertEngineService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/alerts
  // ---------------------------------------------------------------------------

  /**
   * Return paginated alerts for the authenticated RM.
   * Optional query params: status, alert_type, severity, page, limit.
   */
  @ApiOperation({ summary: 'List alerts for authenticated RM' })
  @ApiResponse({ status: 200, description: 'Paginated alert list' })
  @Get()
  async getAlerts(
    @RMIdentity() rm: RMIdentityPayload,
    @Query() query: AlertQueryDto,
  ) {
    this.logger.debug(`GET /alerts rm=${rm.rm_id} query=${JSON.stringify(query)}`);

    const result = await this.alertsService.getAlertsForRM(rm.rm_id, query);

    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: result,
    };
  }

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/alerts/:id/acknowledge
  // ---------------------------------------------------------------------------

  /**
   * Mark an alert as ACKNOWLEDGED.
   * Sets status = ACKNOWLEDGED and acknowledged_at = now.
   * Returns 403 if the alert does not belong to the requesting RM.
   */
  @ApiOperation({ summary: 'Acknowledge an alert' })
  @ApiParam({ name: 'id', description: 'alert_id UUID' })
  @ApiResponse({ status: 200, description: 'Alert acknowledged' })
  @ApiResponse({ status: 403, description: 'Ownership violation' })
  @ApiResponse({ status: 404, description: 'Alert not found' })
  @Patch(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  async acknowledgeAlert(
    @Param('id') alertId: string,
    @RMIdentity() rm: RMIdentityPayload,
  ) {
    this.logger.debug(`PATCH /alerts/${alertId}/acknowledge rm=${rm.rm_id}`);

    const alert = await this.alertsService.acknowledgeAlert(alertId, rm.rm_id);

    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: alert,
    };
  }

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/alerts/:id/act
  // ---------------------------------------------------------------------------

  /**
   * Mark an alert as ACTED_ON.
   * Sets status = ACTED_ON and acted_at = now.
   * Returns 403 if the alert does not belong to the requesting RM.
   */
  @ApiOperation({ summary: 'Mark an alert as acted upon' })
  @ApiParam({ name: 'id', description: 'alert_id UUID' })
  @ApiResponse({ status: 200, description: 'Alert marked as acted on' })
  @ApiResponse({ status: 403, description: 'Ownership violation' })
  @ApiResponse({ status: 404, description: 'Alert not found' })
  @Patch(':id/act')
  @HttpCode(HttpStatus.OK)
  async actOnAlert(
    @Param('id') alertId: string,
    @RMIdentity() rm: RMIdentityPayload,
  ) {
    this.logger.debug(`PATCH /alerts/${alertId}/act rm=${rm.rm_id}`);

    const alert = await this.alertsService.actOnAlert(alertId, rm.rm_id);

    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: alert,
    };
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/alerts/evaluate
  // ---------------------------------------------------------------------------

  /**
   * Manually trigger proof-of-concept rule evaluation for the authenticated RM.
   * Intended for development/QA testing — not for production scheduling.
   *
   * Returns the list of rule IDs evaluated and the count of alerts generated.
   */
  @ApiOperation({ summary: 'Manually trigger alert rule evaluation (PoC)' })
  @ApiResponse({ status: 200, description: 'Evaluation summary' })
  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  async evaluateAlerts(@RMIdentity() rm: RMIdentityPayload) {
    this.logger.log(`POST /alerts/evaluate rm=${rm.rm_id}`);

    const result = await this.alertEngineService.evaluateProofOfConcept(rm.rm_id);

    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: result,
    };
  }
}
