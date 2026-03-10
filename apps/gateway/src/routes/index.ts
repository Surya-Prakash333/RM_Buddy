import { Router, Request, Response } from 'express';
import healthRouter from './health.routes';
import agentRouter from './agent.routes';
import dashboardRouter from './dashboard.routes';

const router = Router();

/**
 * Health and readiness probes (no auth required).
 */
router.use('/', healthRouter);

/**
 * Agent orchestrator routes.
 * Registered before the catch-all dashboard proxy so specific agent paths are
 * matched first.
 */
router.use('/', agentRouter);

/**
 * ElevenLabs webhook stubs.
 *
 * These stubs reserve the URL space for the ElevenLabs voice integration
 * (planned for a later sprint). Returning 200 immediately prevents the
 * ElevenLabs platform from treating the endpoint as down during development.
 *
 * POST /api/v1/elevenlabs/tools/* — server tool callbacks (e.g. balance check)
 * POST /api/v1/elevenlabs/auth    — signed agent auth webhook
 */
router.post(
  '/api/v1/elevenlabs/tools/:toolName',
  (_req: Request, res: Response): void => {
    res.status(200).json({
      status: 'ok',
      message: 'ElevenLabs tool endpoint (stub)',
      timestamp: new Date().toISOString(),
    });
  },
);

router.post(
  '/api/v1/elevenlabs/auth',
  (_req: Request, res: Response): void => {
    res.status(200).json({
      status: 'ok',
      message: 'ElevenLabs auth endpoint (stub)',
      timestamp: new Date().toISOString(),
    });
  },
);

/**
 * Dashboard / core-api proxy (catch-all for /api/v1/*).
 * Must be registered after the more-specific agent and ElevenLabs routes.
 */
router.use('/', dashboardRouter);

export default router;
