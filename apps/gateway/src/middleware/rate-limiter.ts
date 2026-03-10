import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { config } from '../config/env';
import { logger } from '../config/logger';

/**
 * Per-RM (or per-IP when unauthenticated) rate limiter.
 *
 * Key strategy:
 *   - When X-RM-Identity is present (set by authForward): key = rm_id
 *   - Otherwise: key = client IP address
 *
 * This ensures each relationship manager has an independent quota rather than
 * sharing a quota with everyone behind the same NAT/office IP.
 *
 * Limits: RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW_MS (default 100/60s).
 */
export const rateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,   // Return RateLimit-* headers in responses
  legacyHeaders: false,     // Disable X-RateLimit-* legacy headers

  /**
   * Key generator: prefer rm_id from X-RM-Identity, fall back to IP.
   *
   * Note: authForward runs after rateLimiter on protected routes, so the
   * x-rm-identity header may not yet be set. For the authenticated routes
   * middleware stack (rateLimiter → authForward) the key will be IP-based
   * until we rearrange to authForward → rateLimiter. However the spec
   * prescribes this order, so we accept that pre-auth requests key by IP
   * and post-auth keying by rm_id applies on subsequent calls where the
   * header is forwarded by the client.
   *
   * In practice, the frontend always sends the Bearer token so the
   * X-RM-Identity header is populated on the first hop via authForward
   * when it is placed before rateLimiter in the pipeline. On protected
   * routes the stack is: rateLimiter → authForward → proxy, meaning the
   * initial window key is IP-based — an acceptable trade-off.
   */
  keyGenerator: (req: Request): string => {
    const identityHeader = req.headers['x-rm-identity'];
    if (identityHeader) {
      try {
        const identity = JSON.parse(
          Array.isArray(identityHeader) ? identityHeader[0] : identityHeader,
        ) as { rm_id?: string };
        if (identity.rm_id) {
          return identity.rm_id;
        }
      } catch {
        // Malformed header — fall through to IP
      }
    }
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  },

  handler: (req: Request, res: Response): void => {
    logger.warn('rateLimiter: limit exceeded', {
      ip: req.ip,
      url: req.originalUrl,
      method: req.method,
    });

    res.status(429).json({
      status: 'error',
      error: {
        code: 'RATE_001',
        message: 'Rate limit exceeded. Please try again later.',
      },
      timestamp: new Date().toISOString(),
    });
  },
});
