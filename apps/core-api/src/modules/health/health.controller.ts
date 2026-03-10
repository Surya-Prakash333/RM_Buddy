import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

interface HealthResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

interface ReadinessResponse {
  status: string;
  checks: {
    mongo: string;
    redis: string;
  };
}

/**
 * HealthController provides Kubernetes-style liveness and readiness probes.
 *
 * GET /health  — liveness: service is running
 * GET /ready   — readiness: service dependencies are reachable
 *
 * Real dependency checks (Mongo ping, Redis ping) will be wired in a later
 * story. For now both return static 'ok' so the app can start without
 * live infrastructure.
 */
@ApiTags('Health')
@Controller()
export class HealthController {
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe — confirms the service is running' })
  liveness(): HealthResponse {
    return {
      status: 'ok',
      service: 'core-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — confirms dependencies are reachable' })
  readiness(): ReadinessResponse {
    // TODO: replace with real Mongoose + Redis ping checks
    return {
      status: 'ready',
      checks: {
        mongo: 'ok',
        redis: 'ok',
      },
    };
  }
}
