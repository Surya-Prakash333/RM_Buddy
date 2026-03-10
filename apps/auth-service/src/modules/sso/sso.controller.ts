import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam } from '@nestjs/swagger';
import { SsoService } from './sso.service';
import { SessionService } from '../session/session.service';
import { RMIdentity, SessionData } from './sso.types';

// ---------------------------------------------------------------------------
// Request / Response DTOs (inline — no separate dto file needed at this scale)
// ---------------------------------------------------------------------------

class ValidateTokenDto {
  token!: string;
}

class CreateSessionDto {
  token!: string;
}

class ValidateTokenResponseDto {
  identity!: RMIdentity;
}

class CreateSessionResponseDto {
  session_id!: string;
}

class HealthResponseDto {
  status!: string;
  service!: string;
  timestamp!: string;
}

/**
 * SsoController exposes auth endpoints consumed by the API Gateway and
 * internal services.
 *
 * All endpoints are under /auth to keep the routing unambiguous when this
 * service sits behind the gateway.
 */
@ApiTags('auth')
@Controller()
export class SsoController {
  private readonly logger = new Logger(SsoController.name);

  constructor(
    private readonly ssoService: SsoService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * POST /auth/validate
   *
   * Validate an SSO token and return the full RMIdentity object.
   * Does NOT create a persistent session — use /auth/session/create for that.
   */
  @Post('auth/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate SSO token and return RM identity' })
  @ApiBody({ type: ValidateTokenDto })
  @ApiResponse({ status: 200, description: 'Token is valid, returns RMIdentity' })
  @ApiResponse({ status: 401, description: 'AUTH_001: Invalid or expired SSO token' })
  async validateToken(@Body() dto: ValidateTokenDto): Promise<ValidateTokenResponseDto> {
    this.logger.log('POST /auth/validate called');
    const identity = await this.ssoService.validateSSOToken(dto.token);
    return { identity };
  }

  /**
   * POST /auth/session/create
   *
   * Validate an SSO token and create a persistent session (Redis + MongoDB).
   * Returns the session_id that downstream services use for session lookup.
   */
  @Post('auth/session/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Validate SSO token and create a persistent session' })
  @ApiBody({ type: CreateSessionDto })
  @ApiResponse({ status: 201, description: 'Session created, returns session_id' })
  @ApiResponse({ status: 401, description: 'AUTH_001: Invalid or expired SSO token' })
  async createSession(@Body() dto: CreateSessionDto): Promise<CreateSessionResponseDto> {
    this.logger.log('POST /auth/session/create called');
    const session_id = await this.ssoService.validateAndCreateSession(dto.token);
    return { session_id };
  }

  /**
   * GET /auth/session/:sessionId
   *
   * Retrieve session data for a given session_id.
   * Used by the gateway and other services to validate active sessions.
   */
  @Get('auth/session/:sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retrieve session data by session ID' })
  @ApiParam({ name: 'sessionId', description: 'UUID session identifier' })
  @ApiResponse({ status: 200, description: 'Session found, returns SessionData' })
  @ApiResponse({ status: 404, description: 'Session not found or expired' })
  async getSession(@Param('sessionId') sessionId: string): Promise<SessionData> {
    this.logger.log(`GET /auth/session/${sessionId}`);
    const session = await this.sessionService.getSession(sessionId);

    if (!session) {
      throw new NotFoundException(`Session not found: ${sessionId}`);
    }

    return session;
  }

  /**
   * GET /health
   *
   * Liveness probe for PM2, load balancers, and Kubernetes probes.
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Service health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  healthCheck(): HealthResponseDto {
    return {
      status: 'ok',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
    };
  }
}
