import { useAuthStore } from '@/store/auth.store';
import type { RMIdentity } from '@/types';

/**
 * Convenience hook that surfaces auth state and actions from the Zustand store.
 *
 * Consumers should use this hook rather than importing useAuthStore directly —
 * it keeps the coupling to Zustand internal and makes component tests easier
 * to mock at the hook boundary.
 */
export interface UseAuthReturn {
  rmIdentity: RMIdentity | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
}

export function useAuth(): UseAuthReturn {
  const rmIdentity = useAuthStore((s) => s.rmIdentity);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);

  return { rmIdentity, isAuthenticated, isLoading, login, logout };
}
