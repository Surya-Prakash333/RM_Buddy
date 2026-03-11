import { Router } from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { rateLimiter } from '../middleware/rate-limiter';
import { authForward } from '../middleware/auth-forward';
import { config } from '../config/env';
import { logger } from '../config/logger';

const router = Router();

/**
 * Proxy agent endpoints to the Python FastAPI orchestrator.
 *
 * Routes handled here (mounted under /api/v1/agent in index.ts):
 *   POST /api/v1/agent/chat
 *   GET  /api/v1/agent/health
 *
 * A 3-minute proxy timeout is configured because LangGraph agent chains
 * involve multiple LLM calls across parallel specialists plus a compose step.
 * With Groq free-tier rate limits, individual requests can take 60-120s.
 *
 * Middleware stack: rateLimiter → authForward → proxy
 * The health sub-path bypasses auth so ops tooling can check it without a
 * token, but the proxy itself still forwards to the orchestrator.
 */
const agentProxy = createProxyMiddleware({
  target: config.agentOrchestratorUrl,
  changeOrigin: true,
  proxyTimeout: 180000,
  timeout: 180000,
  pathRewrite: { '^/api/v1/agent': '/agent' },
  onProxyReq: fixRequestBody,
  onError: (err: Error, _req, res) => {
    logger.error('agent proxy error', { message: err.message });
    if ('status' in res) {
      (res as import('express').Response).status(502).json({
        status: 'error',
        error: {
          code: 'PROXY_ERROR',
          message: 'Agent orchestrator is temporarily unavailable',
        },
        timestamp: new Date().toISOString(),
      });
    }
  },
});

// POST /api/v1/agent/chat — requires auth
router.post('/api/v1/agent/chat', rateLimiter, authForward, agentProxy);

// GET /api/v1/agent/sessions — list past sessions (requires auth)
router.get('/api/v1/agent/sessions', rateLimiter, authForward, agentProxy);

// GET /api/v1/agent/sessions/:id — get session messages (requires auth)
router.get('/api/v1/agent/sessions/:id', rateLimiter, authForward, agentProxy);

// DELETE /api/v1/agent/sessions/:id — delete a session (requires auth)
router.delete('/api/v1/agent/sessions/:id', rateLimiter, authForward, agentProxy);

// GET /api/v1/agent/health — no auth (ops probe)
router.get('/api/v1/agent/health', agentProxy);

export default router;
