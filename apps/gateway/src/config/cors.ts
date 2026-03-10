import { CorsOptions } from 'cors';
import { config } from './env';

/**
 * CORS configuration derived from environment.
 *
 * CORS_ORIGINS is a comma-separated list of allowed origins.
 * Credentials are allowed so the browser can send the sso_token cookie.
 */
export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, Postman).
    if (!origin) {
      callback(null, true);
      return;
    }

    if (config.corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Request-ID',
    'X-RM-Identity',
  ],
  exposedHeaders: ['X-Request-ID'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86400, // 24 hours — browsers cache preflight results
};
