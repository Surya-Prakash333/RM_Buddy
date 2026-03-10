/**
 * Centralised environment configuration for the gateway.
 *
 * All process.env reads are isolated here so the rest of the codebase stays
 * testable without needing to stub process.env directly.
 */
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:3002',
  coreApiUrl: process.env.CORE_API_URL || 'http://localhost:3001',
  agentOrchestratorUrl: process.env.AGENT_ORCHESTRATOR_URL || 'http://localhost:5000',
  commServiceUrl: process.env.COMM_SERVICE_URL || 'http://localhost:3003',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(','),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;
