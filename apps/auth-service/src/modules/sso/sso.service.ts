import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { RMIdentity, MockTokenPayload } from './sso.types';
import { SessionService } from '../session/session.service';

// ---------------------------------------------------------------------------
// Mock SSO token registry (S0–S3 only)
//
// Each entry maps a test token string to the RM's base profile. The
// session_id and token_expires fields are generated at validation time.
//
// TODO S4: Replace this map with a real HTTP call to NUVAMA_SSO_URL using
//          the axios HttpService and the configured client credentials.
// ---------------------------------------------------------------------------
const MOCK_TOKENS: Record<string, MockTokenPayload> = {
  MOCK_TOKEN_RM001: {
    rm_id: 'RM001',
    rm_name: 'Rajesh Kumar',
    rm_code: 'RK001',
    rm_email: 'rajesh.kumar@nuvama.com',
    rm_branch: 'Mumbai-BKC',
    rm_region: 'West',
    role: 'RM',
    client_count: 20,
  },
  MOCK_TOKEN_RM002: {
    rm_id: 'RM002',
    rm_name: 'Priya Sharma',
    rm_code: 'PS002',
    rm_email: 'priya.sharma@nuvama.com',
    rm_branch: 'Delhi-CP',
    rm_region: 'North',
    role: 'RM',
    client_count: 15,
  },
  MOCK_TOKEN_BM003: {
    rm_id: 'RM003',
    rm_name: 'Vikram Nair',
    rm_code: 'VN003',
    rm_email: 'vikram.nair@nuvama.com',
    rm_branch: 'Mumbai-BKC',
    rm_region: 'West',
    role: 'BM',
    client_count: 0,
  },
  MOCK_TOKEN_RM004: {
    rm_id: 'RM004',
    rm_name: 'Ananya Iyer',
    rm_code: 'AI004',
    rm_email: 'ananya.iyer@nuvama.com',
    rm_branch: 'Bangalore-MG',
    rm_region: 'South',
    role: 'RM',
    client_count: 18,
  },
  MOCK_TOKEN_RM005: {
    rm_id: 'RM005',
    rm_name: 'Suresh Patel',
    rm_code: 'SP005',
    rm_email: 'suresh.patel@nuvama.com',
    rm_branch: 'Bangalore-MG',
    rm_region: 'South',
    role: 'RM',
    client_count: 12,
  },
};

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(private readonly sessionService: SessionService) {}

  /**
   * Validate an SSO token and return the RM's full identity.
   *
   * In S0-S3 this performs a map lookup against MOCK_TOKENS.
   * In S4 this will delegate to the real Nuvama SSO endpoint.
   *
   * @param token  The raw SSO bearer token string from the client.
   * @returns      Populated RMIdentity with a fresh session_id.
   * @throws       UnauthorizedException (AUTH_001) if the token is invalid.
   */
  async validateSSOToken(token: string): Promise<RMIdentity> {
    if (!token || token.trim() === '') {
      this.logger.warn('SSO validation rejected: empty token');
      throw new UnauthorizedException('AUTH_001: Token must not be empty');
    }

    const payload = MOCK_TOKENS[token];

    if (!payload) {
      this.logger.warn(`SSO validation rejected: unknown token [token=${token.slice(0, 12)}...]`);
      throw new UnauthorizedException('AUTH_001: Invalid or expired SSO token');
    }

    const session_id = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const identity: RMIdentity = {
      ...payload,
      session_id,
      token_expires: expiresAt.toISOString(),
    };

    this.logger.log(`SSO token validated for rm_id=${payload.rm_id} session_id=${session_id}`);

    return identity;
  }

  /**
   * Validate an SSO token and immediately create a persistent session.
   *
   * This is a convenience wrapper used by the session/create endpoint so the
   * caller does not need two round-trips.
   *
   * @param token  Raw SSO bearer token.
   * @returns      session_id string for the newly created session.
   */
  async validateAndCreateSession(token: string): Promise<string> {
    const identity = await this.validateSSOToken(token);
    const sessionId = await this.sessionService.createSession(identity);
    return sessionId;
  }
}
