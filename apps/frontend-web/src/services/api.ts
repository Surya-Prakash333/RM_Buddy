import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { API_BASE_URL, API_TIMEOUT } from '@/config/api';
import type { APIResponse } from '@/types';
// Imported at module level — Zustand stores are singletons so no circular dep issue at runtime
import { useAuthStore } from '@/store/auth.store';

/**
 * Central Axios instance for all API calls.
 *
 * Request interceptor  — attaches JWT Bearer token from auth store.
 * Response interceptor — unwraps APIResponse<T>.data so callers receive T directly.
 *                      — on 401 clears auth state and redirects to /login.
 *
 * NOTE: We import the auth store lazily (inside interceptors) to avoid
 * circular-dependency issues at module initialisation time.
 */
const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ── Request interceptor: attach Authorization header ────────────────────────
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    const token = useAuthStore.getState().token;

    if (token && config.headers) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    return config;
  },
  (error: unknown) => Promise.reject(error),
);

// ── Response interceptor: unwrap data / handle 401 ──────────────────────────
api.interceptors.response.use(
  (response: AxiosResponse<APIResponse<unknown>>): AxiosResponse => {
    /**
     * All backend endpoints return APIResponse<T>.
     * We unwrap the `data` field so callers get T directly via response.data.
     */
    const apiResponse = response.data;

    if (apiResponse && typeof apiResponse === 'object' && 'status' in apiResponse) {
      if (apiResponse.status === 'error' && apiResponse.error) {
        return Promise.reject(
          new Error(apiResponse.error.message ?? 'API error'),
        ) as never;
      }
      // Replace the response body with the inner data payload
      response.data = apiResponse.data as APIResponse<unknown>;
    }

    return response;
  },
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      useAuthStore.getState().logout();
      // Hard-redirect to login; avoids importing react-router here
      window.location.href = '/login';
    }

    return Promise.reject(error);
  },
);

export default api;
