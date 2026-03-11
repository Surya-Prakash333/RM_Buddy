import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RMIdentity } from '@/types';
import { authService } from '@/services/auth';
import { appEnv } from '@/config/env';

// ── State shape ─────────────────────────────────────────────────────────────

interface AuthState {
  token: string | null;
  rmIdentity: RMIdentity | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// ── Actions shape ────────────────────────────────────────────────────────────

interface AuthActions {
  /**
   * Authenticate with either a real SSO token or a dev mock token.
   * In dev mode (appEnv.mockAuthEnabled) tokens prefixed with "MOCK_" are
   * resolved locally; all others go through the real /auth/validate endpoint.
   */
  login: (token: string) => Promise<void>;

  /** Clears all auth state from memory and localStorage. */
  logout: () => void;

  setLoading: (loading: boolean) => void;
}

type AuthStore = AuthState & AuthActions;

// ── Store implementation ─────────────────────────────────────────────────────

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, _get) => ({
      // Initial state
      token: null,
      rmIdentity: null,
      isAuthenticated: false,
      isLoading: false,

      // ── Actions ──────────────────────────────────────────────────────────

      login: async (token: string): Promise<void> => {
        set({ isLoading: true });

        try {
          let rmIdentity: RMIdentity;
          let resolvedToken: string = token;

          // Always call the real auth-service so identity comes from DB-aligned data
          const response = await authService.validateToken(token);
          rmIdentity = response.data.rm_identity;
          resolvedToken = response.data.token ?? token;

          set({
            token: resolvedToken,
            rmIdentity,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          set({
            token: null,
            rmIdentity: null,
            isAuthenticated: false,
            isLoading: false,
          });
          throw error;
        }
      },

      logout: (): void => {
        set({
          token: null,
          rmIdentity: null,
          isAuthenticated: false,
          isLoading: false,
        });
        // Zustand persist will sync the cleared state to localStorage automatically.
      },

      setLoading: (loading: boolean): void => {
        set({ isLoading: loading });
      },
    }),
    {
      name: 'rm-buddy-auth',
      storage: createJSONStorage(() => localStorage),
      /**
       * Only persist the token and identity — derive isAuthenticated from token
       * presence so rehydration stays consistent.
       */
      partialize: (state) => ({
        token: state.token,
        rmIdentity: state.rmIdentity,
        isAuthenticated: state.isAuthenticated,
      }),
      /**
       * After rehydration, re-derive isAuthenticated from token to guard against
       * stale/corrupted localStorage values.
       */
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = !!state.token && !!state.rmIdentity;
        }
      },
    },
  ),
);
