/**
 * API and WebSocket base URLs.
 * In production these are set via VITE_* env vars injected at build time.
 * In development, Vite proxies /api → localhost:3000 but direct axios calls
 * use these constants, so both point to the gateway.
 */
export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export const WS_BASE_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:3000';

export const API_TIMEOUT = 30_000; // ms
