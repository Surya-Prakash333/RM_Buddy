import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import { corsOptions } from './config/cors';
import { logger } from './config/logger';
import { requestLogger } from './middleware/request-logger';
import { errorHandler } from './middleware/error-handler';
import { rateLimiter } from './middleware/rate-limiter';
import routes from './routes/index';

const app = express();

// ---------------------------------------------------------------------------
// 1. Cookie parser — must precede auth middleware so req.cookies is populated
// ---------------------------------------------------------------------------
app.use(cookieParser());

// ---------------------------------------------------------------------------
// 2. CORS — must be first so preflight OPTIONS requests get the right headers
// ---------------------------------------------------------------------------
app.use(cors(corsOptions));

// ---------------------------------------------------------------------------
// 3. JSON body parser — 1 MB limit is generous for API payloads
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ---------------------------------------------------------------------------
// 4. Global rate limiter — applied at gateway level before any routing.
//    Per-route stacks apply an additional limiter so protected routes are
//    double-counted (global + per-route). This is intentional: global limit
//    protects against DDoS on public endpoints; per-route limits enforce
//    per-RM quotas on authenticated endpoints.
// ---------------------------------------------------------------------------
app.use(rateLimiter);

// ---------------------------------------------------------------------------
// 5. Request logger — must come after body parser but before routes so it
//    captures the response status correctly via res.on('finish').
// ---------------------------------------------------------------------------
app.use(requestLogger);

// ---------------------------------------------------------------------------
// 6. Application routes
// ---------------------------------------------------------------------------
app.use('/', routes);

// ---------------------------------------------------------------------------
// 7. Global error handler — must be registered after all routes
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start server (skip in test environment — supertest binds its own port)
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(config.port, () => {
    logger.info('gateway started', {
      port: config.port,
      env: config.nodeEnv,
      authServiceUrl: config.authServiceUrl,
      coreApiUrl: config.coreApiUrl,
      agentOrchestratorUrl: config.agentOrchestratorUrl,
    });
  });

  // Graceful shutdown on SIGTERM (PM2 / K8s sends this before SIGKILL)
  process.on('SIGTERM', () => {
    logger.info('gateway: SIGTERM received, shutting down gracefully');
    server.close(() => {
      logger.info('gateway: HTTP server closed');
      process.exit(0);
    });
  });
}

export default app;
