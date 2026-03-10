import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { SsoService } from '../sso.service';
import { SessionService, SESSION_REDIS_CLIENT, SESSION_MODEL } from '../../session/session.service';
import { RMIdentity, SessionData } from '../sso.types';

/**
 * Unit tests for SsoService.
 *
 * Infrastructure (Redis, MongoDB) is injected as plain object mocks via DI
 * tokens — no jest.mock('ioredis') or jest.mock('mongoose') calls needed.
 * This means the tests run without those packages installed, matching the
 * established pattern from core-api/src/modules/cache/__tests__/cache.service.spec.ts
 */

// ---------------------------------------------------------------------------
// Mock type helpers
// ---------------------------------------------------------------------------

interface MockRedisClient {
  get: jest.Mock;
  setex: jest.Mock;
  del: jest.Mock;
}

interface MockSessionModel {
  create: jest.Mock;
  findOne: jest.Mock;
  updateOne: jest.Mock;
}

function buildMockRedis(): MockRedisClient {
  return {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  };
}

function buildMockSessionModel(): MockSessionModel {
  return {
    create: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
    updateOne: jest.fn().mockResolvedValue({}),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SsoService', () => {
  let ssoService: SsoService;
  let sessionService: SessionService;
  let mockRedis: MockRedisClient;
  let mockSessionModel: MockSessionModel;

  beforeEach(async () => {
    mockRedis = buildMockRedis();
    mockSessionModel = buildMockSessionModel();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SsoService,
        SessionService,
        { provide: SESSION_REDIS_CLIENT, useValue: mockRedis },
        { provide: SESSION_MODEL, useValue: mockSessionModel },
        { provide: 'SESSION_TTL', useValue: 86400 },
      ],
    }).compile();

    ssoService = module.get<SsoService>(SsoService);
    sessionService = module.get<SessionService>(SessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // validateSSOToken — happy path
  // -------------------------------------------------------------------------

  describe('validateSSOToken — valid tokens', () => {
    it('returns RMIdentity for MOCK_TOKEN_RM001 with correct rm_id and role', async () => {
      const identity = await ssoService.validateSSOToken('MOCK_TOKEN_RM001');

      expect(identity.rm_id).toBe('RM001');
      expect(identity.rm_name).toBe('Rajesh Kumar');
      expect(identity.rm_code).toBe('RK001');
      expect(identity.rm_email).toBe('rajesh.kumar@nuvama.com');
      expect(identity.rm_branch).toBe('Mumbai-BKC');
      expect(identity.rm_region).toBe('West');
      expect(identity.role).toBe('RM');
      expect(identity.client_count).toBe(20);
    });

    it('returns a valid UUID v4 session_id on success', async () => {
      const identity = await ssoService.validateSSOToken('MOCK_TOKEN_RM001');
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(identity.session_id).toMatch(uuidV4Regex);
    });

    it('returns token_expires as ISO 8601 string ~24h in the future', async () => {
      const before = Date.now();
      const identity = await ssoService.validateSSOToken('MOCK_TOKEN_RM001');
      const after = Date.now();

      const expiresMs = new Date(identity.token_expires).getTime();
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;

      expect(expiresMs).toBeGreaterThanOrEqual(before + twentyFourHoursMs);
      expect(expiresMs).toBeLessThanOrEqual(after + twentyFourHoursMs + 1000);
    });

    it('returns BM role for MOCK_TOKEN_BM003', async () => {
      const identity = await ssoService.validateSSOToken('MOCK_TOKEN_BM003');
      expect(identity.rm_id).toBe('RM003');
      expect(identity.role).toBe('BM');
      expect(identity.client_count).toBe(0);
    });

    it('generates a unique session_id on each call for the same token', async () => {
      const [a, b] = await Promise.all([
        ssoService.validateSSOToken('MOCK_TOKEN_RM002'),
        ssoService.validateSSOToken('MOCK_TOKEN_RM002'),
      ]);
      expect(a.session_id).not.toBe(b.session_id);
    });
  });

  // -------------------------------------------------------------------------
  // validateSSOToken — error cases
  // -------------------------------------------------------------------------

  describe('validateSSOToken — invalid tokens', () => {
    it('throws UnauthorizedException for an unknown token string', async () => {
      await expect(ssoService.validateSSOToken('INVALID_TOKEN')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('includes AUTH_001 error code in the message for unknown token', async () => {
      await expect(ssoService.validateSSOToken('INVALID_TOKEN')).rejects.toThrow('AUTH_001');
    });

    it('throws UnauthorizedException for an empty string token', async () => {
      await expect(ssoService.validateSSOToken('')).rejects.toThrow(UnauthorizedException);
    });

    it('includes AUTH_001 error code for empty token', async () => {
      await expect(ssoService.validateSSOToken('')).rejects.toThrow('AUTH_001');
    });

    it('throws UnauthorizedException for a whitespace-only token', async () => {
      await expect(ssoService.validateSSOToken('   ')).rejects.toThrow(UnauthorizedException);
    });
  });

  // -------------------------------------------------------------------------
  // createSession (via SessionService)
  // -------------------------------------------------------------------------

  describe('SessionService.createSession', () => {
    const buildIdentity = (): RMIdentity => ({
      rm_id: 'RM001',
      rm_name: 'Rajesh Kumar',
      rm_code: 'RK001',
      rm_email: 'rajesh.kumar@nuvama.com',
      rm_branch: 'Mumbai-BKC',
      rm_region: 'West',
      role: 'RM',
      client_count: 20,
      session_id: 'test-session-uuid-001',
      token_expires: new Date(Date.now() + 86400_000).toISOString(),
    });

    it('returns a non-empty string session_id', async () => {
      const sessionId = await sessionService.createSession(buildIdentity());
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it('calls redis.setex to cache the session', async () => {
      await sessionService.createSession(buildIdentity());
      expect(mockRedis.setex).toHaveBeenCalledTimes(1);
    });

    it('calls redis.setex with key pattern "session:{sessionId}"', async () => {
      const identity = buildIdentity();
      await sessionService.createSession(identity);
      const [calledKey] = mockRedis.setex.mock.calls[0] as [string, number, string];
      expect(calledKey).toBe(`session:${identity.session_id}`);
    });

    it('calls redis.setex with the configured TTL (86400)', async () => {
      await sessionService.createSession(buildIdentity());
      const [, calledTtl] = mockRedis.setex.mock.calls[0] as [string, number, string];
      expect(calledTtl).toBe(86400);
    });

    it('calls sessionModel.create to persist to MongoDB', async () => {
      await sessionService.createSession(buildIdentity());
      expect(mockSessionModel.create).toHaveBeenCalledTimes(1);
    });

    it('passes the correct rm_id to MongoDB create', async () => {
      await sessionService.createSession(buildIdentity());
      const [doc] = mockSessionModel.create.mock.calls[0] as [Record<string, unknown>];
      expect(doc.rm_id).toBe('RM001');
    });
  });

  // -------------------------------------------------------------------------
  // getSession — cache hit
  // -------------------------------------------------------------------------

  describe('SessionService.getSession — Redis cache HIT', () => {
    it('returns parsed SessionData from Redis without querying MongoDB', async () => {
      const sessionData: SessionData = {
        session_id: 'redis-hit-session',
        rm_identity: {
          rm_id: 'RM001',
          rm_name: 'Rajesh Kumar',
          rm_code: 'RK001',
          rm_email: 'rajesh.kumar@nuvama.com',
          rm_branch: 'Mumbai-BKC',
          rm_region: 'West',
          role: 'RM',
          client_count: 20,
          session_id: 'redis-hit-session',
          token_expires: new Date(Date.now() + 86400_000).toISOString(),
        },
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400_000).toISOString(),
        status: 'active',
      };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(sessionData));

      const result = await sessionService.getSession('redis-hit-session');

      expect(result).toEqual(sessionData);
      expect(mockSessionModel.findOne).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getSession — MongoDB fallback on Redis miss
  // -------------------------------------------------------------------------

  describe('SessionService.getSession — MongoDB fallback on Redis MISS', () => {
    it('queries MongoDB when Redis returns null', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const now = new Date();
      const mongoDoc = {
        session_id: 'mongo-fallback-session',
        rm_id: 'RM002',
        rm_name: 'Priya Sharma',
        rm_code: 'PS002',
        rm_email: 'priya.sharma@nuvama.com',
        rm_branch: 'Delhi-CP',
        rm_region: 'North',
        role: 'RM',
        expires_at: new Date(now.getTime() + 86400_000),
        created_at_ts: now,
        status: 'active',
      };

      mockSessionModel.findOne.mockResolvedValueOnce(mongoDoc);

      const result = await sessionService.getSession('mongo-fallback-session');

      expect(mockSessionModel.findOne).toHaveBeenCalledWith({ session_id: 'mongo-fallback-session' });
      expect(result).not.toBeNull();
      expect(result?.rm_identity.rm_id).toBe('RM002');
    });

    it('re-hydrates Redis after MongoDB fallback', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const now = new Date();
      mockSessionModel.findOne.mockResolvedValueOnce({
        session_id: 'rehydrate-session',
        rm_id: 'RM003',
        rm_name: 'Vikram Nair',
        rm_code: 'VN003',
        rm_email: 'vikram.nair@nuvama.com',
        rm_branch: 'Mumbai-BKC',
        rm_region: 'West',
        role: 'BM',
        expires_at: new Date(now.getTime() + 86400_000),
        created_at_ts: now,
        status: 'active',
      });

      await sessionService.getSession('rehydrate-session');

      expect(mockRedis.setex).toHaveBeenCalledTimes(1);
      const [calledKey] = mockRedis.setex.mock.calls[0] as [string, number, string];
      expect(calledKey).toBe('session:rehydrate-session');
    });

    it('returns null when session not found in Redis or MongoDB', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockSessionModel.findOne.mockResolvedValueOnce(null);

      const result = await sessionService.getSession('nonexistent-session');

      expect(result).toBeNull();
    });
  });
});
