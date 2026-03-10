/**
 * Type-safe Vite environment variable accessors.
 *
 * Vite replaces `import.meta.env.VITE_*` at build time.
 * This module centralises all env reads so the rest of the app
 * never touches import.meta.env directly.
 */

interface AppEnv {
  /** Base URL of the API gateway (default: http://localhost:3000) */
  apiUrl: string;
  /** Base URL for WebSocket connections (default: ws://localhost:3000) */
  wsUrl: string;
  /** Whether the app is running in development mode */
  isDev: boolean;
  /** Whether the app is running in production mode */
  isProd: boolean;
  /** Enable mock authentication for local development */
  mockAuthEnabled: boolean;
}

function readEnv(): AppEnv {
  const env = import.meta.env;

  return {
    apiUrl: (env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000',
    wsUrl: (env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:3000',
    isDev: env.DEV === true,
    isProd: env.PROD === true,
    mockAuthEnabled:
      (env.VITE_MOCK_AUTH_ENABLED as string | undefined) === 'true' || env.DEV === true,
  };
}

export const appEnv: AppEnv = readEnv();
