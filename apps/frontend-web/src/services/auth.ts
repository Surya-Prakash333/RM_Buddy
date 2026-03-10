import api from './api';
import type { RMIdentity, ValidateTokenResponse, SessionCreateResponse } from '@/types';

/**
 * Mock user identities used during development.
 * Each entry maps a mock token (e.g. "MOCK_RM001") to an RMIdentity object
 * so the LoginPage can simulate auth without a live SSO endpoint.
 */
export const MOCK_USERS: Record<string, RMIdentity> = {
  MOCK_RM001: {
    rm_id: 'RM001',
    rm_name: 'Arjun Mehta',
    rm_code: 'NUV-RM-001',
    rm_email: 'arjun.mehta@nuvama.com',
    rm_branch: 'Mumbai - BKC',
    rm_region: 'West',
    role: 'RM',
    client_count: 42,
    session_id: 'mock-session-001',
    token_expires: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  },
  MOCK_RM002: {
    rm_id: 'RM002',
    rm_name: 'Priya Sharma',
    rm_code: 'NUV-RM-002',
    rm_email: 'priya.sharma@nuvama.com',
    rm_branch: 'Delhi - Connaught Place',
    rm_region: 'North',
    role: 'RM',
    client_count: 38,
    session_id: 'mock-session-002',
    token_expires: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  },
  MOCK_RM003: {
    rm_id: 'RM003',
    rm_name: 'Vikram Nair',
    rm_code: 'NUV-RM-003',
    rm_email: 'vikram.nair@nuvama.com',
    rm_branch: 'Bengaluru - Indiranagar',
    rm_region: 'South',
    role: 'BM',
    client_count: 65,
    session_id: 'mock-session-003',
    token_expires: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  },
  MOCK_RM004: {
    rm_id: 'RM004',
    rm_name: 'Sunita Reddy',
    rm_code: 'NUV-RM-004',
    rm_email: 'sunita.reddy@nuvama.com',
    rm_branch: 'Hyderabad - Jubilee Hills',
    rm_region: 'South',
    role: 'RM',
    client_count: 29,
    session_id: 'mock-session-004',
    token_expires: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  },
  MOCK_RM005: {
    rm_id: 'RM005',
    rm_name: 'Rajesh Gupta',
    rm_code: 'NUV-RM-005',
    rm_email: 'rajesh.gupta@nuvama.com',
    rm_branch: 'Chennai - Anna Nagar',
    rm_region: 'South',
    role: 'ADMIN',
    client_count: 0,
    session_id: 'mock-session-005',
    token_expires: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  },
};

/**
 * authService wraps all authentication-related API calls.
 *
 * The real SSO flow:
 *   1. Browser redirects to Nuvama SSO → gets back a short-lived sso_token in query params.
 *   2. Frontend calls validateToken(sso_token) → backend validates with SSO provider,
 *      returns RMIdentity + JWT.
 *   3. Frontend calls createSession(rmIdentity) to register the session in the gateway.
 *
 * The dev flow:
 *   1. Developer picks a mock user from the dropdown in LoginPage.
 *   2. mockLogin(mockToken) is called → returns a synthetic ValidateTokenResponse
 *      without hitting the network.
 */
export const authService = {
  /**
   * Validates an SSO token with the auth-service.
   * POST /auth/validate  { sso_token }
   */
  validateToken: (token: string): Promise<{ data: ValidateTokenResponse }> =>
    api.post<ValidateTokenResponse>('/auth/validate', { sso_token: token }),

  /**
   * Registers an authenticated RM session in the gateway.
   * POST /auth/session/create  { rm_identity }
   */
  createSession: (rmIdentity: RMIdentity): Promise<{ data: SessionCreateResponse }> =>
    api.post<SessionCreateResponse>('/auth/session/create', { rm_identity: rmIdentity }),

  /**
   * Dev-only: resolve a mock token to a synthetic ValidateTokenResponse
   * without making any network call.
   */
  mockLogin: (mockToken: string): ValidateTokenResponse => {
    const identity = MOCK_USERS[mockToken];
    if (!identity) {
      throw new Error(`Unknown mock token: ${mockToken}`);
    }
    return {
      rm_identity: identity,
      token: mockToken,
    };
  },
};
