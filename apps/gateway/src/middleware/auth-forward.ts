import { RequestHandler, Request, Response, NextFunction } from 'express';
import axios, { AxiosError } from 'axios';
import { config } from '../config/env';
import { logger } from '../config/logger';

/**
 * Shape of the response body returned by auth-service POST /auth/validate.
 */
interface AuthValidateResponse {
  status: 'ok' | 'error';
  data?: {
    rm_identity: Record<string, unknown>;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Extract the bearer token from the request.
 *
 * Priority order:
 *   1. Authorization: Bearer <token> header
 *   2. sso_token cookie (set after initial login redirect)
 *
 * Returns undefined when no token is present in either location.
 */
function extractToken(req: Request): string | undefined {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      return token;
    }
  }

  const cookieToken = (req as Request & { cookies: Record<string, string> }).cookies?.['sso_token'];
  if (cookieToken && cookieToken.trim().length > 0) {
    return cookieToken.trim();
  }

  return undefined;
}

/**
 * authForward middleware
 *
 * 1. Extracts the SSO token from Authorization header or sso_token cookie.
 * 2. Calls POST {AUTH_SERVICE_URL}/auth/validate with { sso_token: token }.
 * 3. On success: injects X-RM-Identity header (JSON-serialised rm_identity)
 *    and calls next().
 * 4. On failure: returns a structured error response.
 *
 * Error codes:
 *   AUTH_003 — No token provided (401)
 *   AUTH_001 — Invalid / expired token (401)
 *   AUTH_004 — Auth service unreachable (503)
 */
export const authForward: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = extractToken(req);

  if (!token) {
    logger.warn('authForward: no token provided', {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    });

    res.status(401).json({
      status: 'error',
      error: {
        code: 'AUTH_003',
        message: 'No authentication token provided',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    const response = await axios.post<AuthValidateResponse>(
      `${config.authServiceUrl}/auth/validate`,
      { sso_token: token },
      {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const rmIdentity = response.data?.data?.rm_identity;

    if (!rmIdentity) {
      logger.warn('authForward: auth service returned ok but rm_identity missing', {
        url: req.originalUrl,
      });

      res.status(401).json({
        status: 'error',
        error: {
          code: 'AUTH_001',
          message: 'Invalid or expired SSO token',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Inject identity for downstream services and the rate limiter.
    req.headers['x-rm-identity'] = JSON.stringify(rmIdentity);

    logger.info('authForward: token validated', {
      rm_id: rmIdentity['rm_id'],
      method: req.method,
      url: req.originalUrl,
    });

    next();
  } catch (err) {
    const axiosErr = err as AxiosError<AuthValidateResponse>;

    // Auth service returned a 4xx — treat as invalid token.
    if (axiosErr.response) {
      const statusCode = axiosErr.response.status;
      const body = axiosErr.response.data;

      logger.warn('authForward: auth service rejected token', {
        statusCode,
        errorCode: body?.error?.code,
        url: req.originalUrl,
      });

      res.status(401).json({
        status: 'error',
        error: {
          code: 'AUTH_001',
          message: 'Invalid or expired SSO token',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Network error, ECONNREFUSED, timeout — auth service is unavailable.
    logger.error('authForward: auth service unreachable', {
      message: (err as Error).message,
      url: req.originalUrl,
    });

    res.status(503).json({
      status: 'error',
      error: {
        code: 'AUTH_004',
        message: 'Authentication service temporarily unavailable',
      },
      timestamp: new Date().toISOString(),
    });
  }
};
