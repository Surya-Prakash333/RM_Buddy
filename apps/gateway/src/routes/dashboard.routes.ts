import { Router } from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { rateLimiter } from '../middleware/rate-limiter';
import { authForward } from '../middleware/auth-forward';
import { config } from '../config/env';
import { logger } from '../config/logger';

const router = Router();

/**
 * Proxy all /api/v1/* traffic (except agent routes) to the core-api service.
 *
 * Middleware stack (order is intentional):
 *   1. rateLimiter   — shed load early before auth I/O
 *   2. authForward   — validate token, inject X-RM-Identity
 *   3. proxy         — forward to CORE_API_URL
 *
 * The proxy strips the path prefix rewrite is not needed here since core-api
 * also mounts at /api/v1.
 *
 * X-RM-Identity is forwarded automatically because authForward writes it
 * directly to req.headers, and http-proxy-middleware forwards all request
 * headers to the target.
 */
const coreApiProxy = createProxyMiddleware({
  target: config.coreApiUrl,
  changeOrigin: true,
  on: {
    proxyReq: fixRequestBody,
    error: (err, _req, res) => {
      logger.error('dashboard proxy error', { message: (err as Error).message });
      if ('status' in res) {
        (res as import('express').Response).status(502).json({
          status: 'error',
          error: {
            code: 'PROXY_ERROR',
            message: 'Core API is temporarily unavailable',
          },
          timestamp: new Date().toISOString(),
        });
      }
    },
  },
});

router.use('/api/v1', rateLimiter, authForward, coreApiProxy);

export default router;
