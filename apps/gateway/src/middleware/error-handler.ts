import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { logger } from '../config/logger';

/**
 * Global Express error handler.
 *
 * Must be registered last (after all routes) so Express routes unhandled
 * errors here. The four-parameter signature is mandatory for Express to
 * recognise this as an error-handling middleware.
 *
 * Returns a consistent error envelope:
 * {
 *   status: 'error',
 *   error: { code, message },
 *   timestamp: ISO 8601
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (
  err: Error & { code?: string; statusCode?: number; status?: number },
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  const statusCode = err.statusCode ?? err.status ?? 500;
  const code = err.code ?? 'INTERNAL_ERROR';

  logger.error('unhandled error', {
    code,
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    statusCode,
  });

  res.status(statusCode).json({
    status: 'error',
    error: {
      code,
      message:
        statusCode === 500
          ? 'An unexpected error occurred. Please try again later.'
          : err.message,
    },
    timestamp: new Date().toISOString(),
  });
};
