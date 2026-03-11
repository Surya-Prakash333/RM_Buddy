import { Router } from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { rateLimiter } from '../middleware/rate-limiter';
import { config } from '../config/env';
import { logger } from '../config/logger';

const router = Router();

/**
 * Proxy /auth/* to the auth-service (no authForward middleware — this IS the auth endpoint).
 */
const authProxy = createProxyMiddleware({
  target: config.authServiceUrl,
  changeOrigin: true,
  onProxyReq: fixRequestBody,
  onError: (err: Error, _req, res) => {
    logger.error('auth proxy error', { message: err.message });
    if ('status' in res) {
      (res as import('express').Response).status(502).json({
        status: 'error',
        error: { code: 'AUTH_PROXY_ERROR', message: 'Auth service is temporarily unavailable' },
        timestamp: new Date().toISOString(),
      });
    }
  },
});

router.use('/auth', rateLimiter, authProxy);

export default router;
