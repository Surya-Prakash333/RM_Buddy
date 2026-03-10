import { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../config/logger';

/**
 * HTTP request/response logger middleware.
 *
 * Captures: method, url, rm_id (from X-RM-Identity), status_code,
 * response_time_ms.
 *
 * Log levels:
 *   info  — 2xx and 3xx responses
 *   warn  — 4xx client errors
 *   error — 5xx server errors
 *
 * All output is JSON via the shared Winston logger.
 */
export const requestLogger: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const startMs = Date.now();

  // Resolve rm_id lazily on response finish so authForward has had a chance
  // to populate the header.
  res.on('finish', () => {
    const responseTimeMs = Date.now() - startMs;
    const statusCode = res.statusCode;

    let rmId: string | undefined;
    try {
      const identityHeader = req.headers['x-rm-identity'];
      if (identityHeader) {
        const raw = Array.isArray(identityHeader) ? identityHeader[0] : identityHeader;
        const parsed = JSON.parse(raw) as { rm_id?: string };
        rmId = parsed.rm_id;
      }
    } catch {
      // Header present but not valid JSON — leave rmId undefined
    }

    const logPayload = {
      method: req.method,
      url: req.originalUrl,
      status_code: statusCode,
      response_time_ms: responseTimeMs,
      rm_id: rmId,
      ip: req.ip,
    };

    if (statusCode >= 500) {
      logger.error('http', logPayload);
    } else if (statusCode >= 400) {
      logger.warn('http', logPayload);
    } else {
      logger.info('http', logPayload);
    }
  });

  next();
};
