import { Router, Request, Response } from 'express';
import axios from 'axios';
import { config } from '../config/env';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /health
 *
 * Shallow liveness probe — always returns 200 when the gateway process is up.
 * No auth required. Used by load-balancers and PM2 health checks.
 */
router.get('/health', (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'ok',
    service: 'gateway',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /ready
 *
 * Deep readiness probe — checks connectivity to auth-service and core-api.
 * Returns 200 only when all upstream dependencies report healthy.
 * Returns 503 with details of which services failed.
 *
 * No auth required. Used by orchestrators (K8s readinessProbe) before sending
 * traffic.
 */
router.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  const checks: Record<string, boolean> = {
    'auth-service': false,
    'core-api': false,
  };

  await Promise.allSettled([
    axios
      .get(`${config.authServiceUrl}/health`, { timeout: 3000 })
      .then(() => {
        checks['auth-service'] = true;
      })
      .catch((err) => {
        logger.warn('ready: auth-service health check failed', {
          message: (err as Error).message,
        });
      }),

    axios
      .get(`${config.coreApiUrl}/health`, { timeout: 3000 })
      .then(() => {
        checks['core-api'] = true;
      })
      .catch((err) => {
        logger.warn('ready: core-api health check failed', {
          message: (err as Error).message,
        });
      }),
  ]);

  const allHealthy = Object.values(checks).every(Boolean);
  const statusCode = allHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: allHealthy ? 'ok' : 'degraded',
    service: 'gateway',
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
