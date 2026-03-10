/**
 * Unit tests for authForward middleware.
 *
 * Axios is fully mocked — no real HTTP calls are made. The auth-service
 * contract (POST /auth/validate) is exercised via mock implementations.
 */
import { Request, Response, NextFunction } from 'express';

// Mock axios before importing the module under test.
jest.mock('axios');

import axios from 'axios';
import { authForward } from '../middleware/auth-forward';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Build a minimal Express Request mock. */
function buildRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    originalUrl: '/api/v1/dashboard',
    ip: '127.0.0.1',
    headers: {},
    cookies: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

/** Build a minimal Express Response mock with jest spies. */
function buildResponse(): Response & {
  status: jest.Mock;
  json: jest.Mock;
  _statusCode: number;
} {
  const res = {
    _statusCode: 200,
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response & { status: jest.Mock; json: jest.Mock; _statusCode: number };

  // Make status() return the response itself for chaining.
  res.status.mockReturnValue(res);

  return res;
}

const mockNext: NextFunction = jest.fn();

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_RM_IDENTITY = {
  rm_id: 'RM001',
  rm_name: 'Rajesh Kumar',
  rm_code: 'RK001',
  rm_email: 'rajesh.kumar@nuvama.com',
  rm_branch: 'Mumbai-BKC',
  rm_region: 'West',
  role: 'RM',
  client_count: 20,
  session_id: 'sess-abc-123',
  token_expires: '2026-03-11T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authForward middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('valid Bearer token', () => {
    it('calls auth service, injects X-RM-Identity header, and calls next()', async () => {
      const req = buildRequest({
        headers: { authorization: 'Bearer MOCK_TOKEN_RM001' },
      });
      const res = buildResponse();

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          status: 'ok',
          data: { rm_identity: MOCK_RM_IDENTITY },
        },
      });

      await authForward(req, res, mockNext);

      // Auth service called with correct payload
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/auth/validate'),
        { sso_token: 'MOCK_TOKEN_RM001' },
        expect.objectContaining({ timeout: 5000 }),
      );

      // Identity header injected
      expect(req.headers['x-rm-identity']).toBe(JSON.stringify(MOCK_RM_IDENTITY));

      // next() called — request proceeds
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(/* no error */);

      // No error response sent
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('valid sso_token cookie (no Authorization header)', () => {
    it('extracts token from cookie, validates, and calls next()', async () => {
      const req = buildRequest({
        headers: {},
        cookies: { sso_token: 'MOCK_TOKEN_RM002' },
      });
      const res = buildResponse();

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          status: 'ok',
          data: { rm_identity: { ...MOCK_RM_IDENTITY, rm_id: 'RM002' } },
        },
      });

      await authForward(req, res, mockNext);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/auth/validate'),
        { sso_token: 'MOCK_TOKEN_RM002' },
        expect.any(Object),
      );
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Missing token — AUTH_003
  // -------------------------------------------------------------------------

  describe('missing token', () => {
    it('returns 401 AUTH_003 when no Authorization header and no cookie', async () => {
      const req = buildRequest({ headers: {}, cookies: {} });
      const res = buildResponse();

      await authForward(req, res, mockNext);

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.objectContaining({ code: 'AUTH_003' }),
        }),
      );
    });

    it('returns 401 AUTH_003 when Authorization header is "Bearer " (empty token)', async () => {
      const req = buildRequest({
        headers: { authorization: 'Bearer ' },
        cookies: {},
      });
      const res = buildResponse();

      await authForward(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'AUTH_003' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Invalid / expired token — AUTH_001
  // -------------------------------------------------------------------------

  describe('invalid token', () => {
    it('returns 401 AUTH_001 when auth service responds with 401', async () => {
      const req = buildRequest({
        headers: { authorization: 'Bearer INVALID_TOKEN' },
      });
      const res = buildResponse();

      // Simulate axios throwing for a 4xx response
      const axiosError = Object.assign(new Error('Request failed with status code 401'), {
        response: {
          status: 401,
          data: {
            status: 'error',
            error: { code: 'AUTH_001', message: 'Invalid or expired SSO token' },
          },
        },
      });
      mockedAxios.post.mockRejectedValueOnce(axiosError);

      await authForward(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'AUTH_001' }),
        }),
      );
    });

    it('returns 401 AUTH_001 when auth service returns ok but rm_identity is missing', async () => {
      const req = buildRequest({
        headers: { authorization: 'Bearer SOME_TOKEN' },
      });
      const res = buildResponse();

      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 'ok', data: {} }, // rm_identity absent
      });

      await authForward(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'AUTH_001' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Expired token — AUTH_001 (same code, different scenario)
  // -------------------------------------------------------------------------

  describe('expired token', () => {
    it('returns 401 AUTH_001 when auth service returns 403 for expired token', async () => {
      const req = buildRequest({
        headers: { authorization: 'Bearer EXPIRED_TOKEN' },
      });
      const res = buildResponse();

      const axiosError = Object.assign(new Error('Request failed with status code 403'), {
        response: {
          status: 403,
          data: {
            status: 'error',
            error: { code: 'AUTH_001', message: 'Token has expired' },
          },
        },
      });
      mockedAxios.post.mockRejectedValueOnce(axiosError);

      await authForward(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'AUTH_001' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Auth service unavailable — AUTH_004
  // -------------------------------------------------------------------------

  describe('auth service unreachable', () => {
    it('returns 503 AUTH_004 when axios throws a network error (ECONNREFUSED)', async () => {
      const req = buildRequest({
        headers: { authorization: 'Bearer MOCK_TOKEN_RM001' },
      });
      const res = buildResponse();

      // Network error — no .response property
      const networkError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3002'), {
        code: 'ECONNREFUSED',
      });
      mockedAxios.post.mockRejectedValueOnce(networkError);

      await authForward(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.objectContaining({ code: 'AUTH_004' }),
        }),
      );
    });

    it('returns 503 AUTH_004 when axios request times out', async () => {
      const req = buildRequest({
        headers: { authorization: 'Bearer MOCK_TOKEN_RM001' },
      });
      const res = buildResponse();

      const timeoutError = Object.assign(new Error('timeout of 5000ms exceeded'), {
        code: 'ECONNABORTED',
      });
      mockedAxios.post.mockRejectedValueOnce(timeoutError);

      await authForward(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'AUTH_004' }),
        }),
      );
    });
  });
});
