import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { RMSession } from '../../../database/models/rm-session.model';
import { AuditTrail } from '../../../database/models/audit.model';
import { EngagementService } from '../engagement.service';
import { CacheService } from '../../cache/cache.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/** Mock CacheService — readThrough calls the fetchFn by default (cache miss). */
const makeCacheServiceMock = () => ({
  readThrough: jest.fn().mockImplementation(
    (_key: string, fetchFn: () => Promise<unknown>, _ttl: number) => fetchFn(),
  ),
  set: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(null),
  invalidate: jest.fn().mockResolvedValue(undefined),
});

/** Minimal Mongoose Model mock supporting find().lean().exec() chain. */
const makeModelMock = (returnValue: unknown[] = []) => ({
  find: jest.fn().mockReturnValue({
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(returnValue),
    }),
  }),
});

// ---------------------------------------------------------------------------
// Helper: build a fake RMSession document
// ---------------------------------------------------------------------------

const makeSession = (
  overrides: { createdAt?: Date; last_active?: Date } = {},
) => ({
  rm_id: RM_ID,
  session_id: `sess-${Math.random()}`,
  is_active: true,
  createdAt: overrides.createdAt ?? new Date('2024-01-10T09:00:00Z'),
  last_active: overrides.last_active ?? new Date('2024-01-10T10:00:00Z'),
});

// ---------------------------------------------------------------------------
// Helper: build a fake AuditTrail document
// ---------------------------------------------------------------------------

const makeAudit = (overrides: { createdAt?: Date; resource_type?: string } = {}) => ({
  rm_id: RM_ID,
  action: 'VIEW',
  resource_type: overrides.resource_type ?? 'clients',
  createdAt: overrides.createdAt ?? new Date('2024-01-10T09:30:00Z'),
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('EngagementService', () => {
  let service: EngagementService;
  let cacheService: ReturnType<typeof makeCacheServiceMock>;
  let sessionModelMock: ReturnType<typeof makeModelMock>;
  let auditModelMock: ReturnType<typeof makeModelMock>;

  beforeEach(async () => {
    cacheService = makeCacheServiceMock();
    sessionModelMock = makeModelMock();
    auditModelMock = makeModelMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementService,
        { provide: CacheService, useValue: cacheService },
        { provide: getModelToken(RMSession.name), useValue: sessionModelMock },
        { provide: getModelToken(AuditTrail.name), useValue: auditModelMock },
      ],
    }).compile();

    service = module.get<EngagementService>(EngagementService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // computeScore() — unit
  // -------------------------------------------------------------------------

  describe('computeScore()', () => {
    it('should compute consistency_score between 0 and 100 for all-zero inputs', () => {
      const score = service.computeScore(0, 0, 0);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should return 100 when all sub-scores are 100', () => {
      const score = service.computeScore(100, 100, 100);
      expect(score).toBe(100);
    });

    it('should return a value between 0 and 100 for arbitrary sub-scores', () => {
      const score = service.computeScore(60, 45, 80);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should apply weighted average: login_regularity 0.4, session_depth 0.3, crm_usage 0.3', () => {
      // 100*0.4 + 0*0.3 + 0*0.3 = 40
      expect(service.computeScore(100, 0, 0)).toBeCloseTo(40, 1);
      // 0*0.4 + 100*0.3 + 0*0.3 = 30
      expect(service.computeScore(0, 100, 0)).toBeCloseTo(30, 1);
      // 0*0.4 + 0*0.3 + 100*0.3 = 30
      expect(service.computeScore(0, 0, 100)).toBeCloseTo(30, 1);
    });
  });

  // -------------------------------------------------------------------------
  // classifyTrend() — unit
  // -------------------------------------------------------------------------

  describe('classifyTrend()', () => {
    it('should classify trend as improving when score increased > 5 pts', () => {
      expect(service.classifyTrend(75, 68)).toBe('improving');
      expect(service.classifyTrend(100, 90)).toBe('improving');
    });

    it('should classify trend as declining when score decreased > 5 pts', () => {
      expect(service.classifyTrend(60, 70)).toBe('declining');
      expect(service.classifyTrend(20, 40)).toBe('declining');
    });

    it('should classify trend as stable when diff is within ±5 pts', () => {
      expect(service.classifyTrend(70, 70)).toBe('stable');
      expect(service.classifyTrend(70, 65)).toBe('stable');
      expect(service.classifyTrend(65, 70)).toBe('stable');
      expect(service.classifyTrend(70, 67)).toBe('stable');
    });

    it('should classify trend as stable at exactly +5 boundary', () => {
      // diff === 5 is NOT > 5, so stable
      expect(service.classifyTrend(75, 70)).toBe('stable');
    });

    it('should classify trend as stable at exactly -5 boundary', () => {
      // diff === -5 is NOT < -5, so stable
      expect(service.classifyTrend(65, 70)).toBe('stable');
    });
  });

  // -------------------------------------------------------------------------
  // getEngagementData() — integration with mocked models
  // -------------------------------------------------------------------------

  describe('getEngagementData()', () => {
    it('should cache engagement data with 30-min TTL via readThrough', async () => {
      sessionModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });
      auditModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });

      await service.getEngagementData(RM_ID, '2024-01');

      expect(cacheService.readThrough).toHaveBeenCalledWith(
        'engagement:RM001:2024-01',
        expect.any(Function),
        1800,
      );
    });

    it('should return consistency_score between 0 and 100', async () => {
      const sessions = [
        makeSession({
          createdAt: new Date('2024-01-10T09:00:00Z'),
          last_active: new Date('2024-01-10T10:00:00Z'),
        }),
        makeSession({
          createdAt: new Date('2024-01-11T09:00:00Z'),
          last_active: new Date('2024-01-11T09:45:00Z'),
        }),
      ];
      const audits = Array.from({ length: 10 }, (_, i) =>
        makeAudit({ createdAt: new Date(`2024-01-${10 + i}T10:00:00Z`) }),
      );

      sessionModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(sessions) }),
      });
      auditModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(audits) }),
      });

      const result = await service.getEngagementData(RM_ID, '2024-01');

      expect(result.consistency_score).toBeGreaterThanOrEqual(0);
      expect(result.consistency_score).toBeLessThanOrEqual(100);
    });

    it('should return is_estimated=true when there are no sessions or audit records', async () => {
      sessionModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });
      auditModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });

      const result = await service.getEngagementData(RM_ID, '2024-01');

      expect(result.is_estimated).toBe(true);
      expect(result.consistency_score).toBe(0);
    });

    it('should aggregate pages_visited from audit resource_type', async () => {
      const audits = [
        makeAudit({ resource_type: 'clients' }),
        makeAudit({ resource_type: 'clients' }),
        makeAudit({ resource_type: 'dashboard' }),
      ];

      sessionModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });
      auditModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(audits) }),
      });

      const result = await service.getEngagementData(RM_ID, '2024-01');

      expect(result.pages_visited['clients']).toBe(2);
      expect(result.pages_visited['dashboard']).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getEngagementTrend() — daily trend points
  // -------------------------------------------------------------------------

  describe('getEngagementTrend()', () => {
    it('should return daily trend points for requested days', async () => {
      sessionModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });
      auditModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });

      const trend = await service.getEngagementTrend(RM_ID, 7);

      expect(trend).toHaveLength(7);
      trend.forEach(point => {
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('login');
        expect(point).toHaveProperty('session_count');
        expect(point).toHaveProperty('crm_actions');
        expect(point).toHaveProperty('daily_score');
        expect(point.daily_score).toBeGreaterThanOrEqual(0);
        expect(point.daily_score).toBeLessThanOrEqual(100);
      });
    });

    it('should mark login=true on days where sessions exist', async () => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      sessionModelMock.find.mockImplementation((filter: Record<string, unknown>) => {
        const createdAtFilter = filter['createdAt'] as { $gte?: Date; $lte?: Date } | undefined;
        const gte = createdAtFilter?.$gte;
        const session = gte
          ? makeSession({ createdAt: new Date(gte), last_active: new Date(gte.getTime() + 30 * 60_000) })
          : null;
        return {
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(session ? [session] : []),
          }),
        };
      });

      auditModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });

      const trend = await service.getEngagementTrend(RM_ID, 1);
      const todayPoint = trend.find(p => p.date === todayStr);

      expect(todayPoint).toBeDefined();
      expect(todayPoint?.login).toBe(true);
    });

    it('should return 30 points by default when days=30', async () => {
      sessionModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });
      auditModelMock.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });

      const trend = await service.getEngagementTrend(RM_ID, 30);
      expect(trend).toHaveLength(30);
    });
  });
});
