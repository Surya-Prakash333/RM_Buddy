import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DashboardService } from '../dashboard.service';
import { CacheService } from '../../cache/cache.service';
import { Meeting } from '../../../database/models/meeting.model';
import { AlertRecord } from '../../../database/models/alert.model';
import { DailyActivitySummary, DailyStatus } from '../dto/daily-activity.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Meeting model mock */
function buildMeetingModelMock(overrides: Partial<{
  countDocuments: jest.Mock;
  aggregate: jest.Mock;
}> = {}) {
  return {
    countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
    aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    ...overrides,
  };
}

/** Build a minimal Alert model mock */
function buildAlertModelMock(overrides: Partial<{
  countDocuments: jest.Mock;
}> = {}) {
  return {
    countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
    ...overrides,
  };
}

/** Build a CacheService mock */
function buildCacheServiceMock(overrides: Partial<{
  readThrough: jest.Mock;
}> = {}) {
  return {
    readThrough: jest.fn().mockImplementation(
      async (_key: string, fetchFn: () => Promise<unknown>) => fetchFn(),
    ),
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardService', () => {
  let service: DashboardService;
  let meetingModelMock: ReturnType<typeof buildMeetingModelMock>;
  let alertModelMock: ReturnType<typeof buildAlertModelMock>;
  let cacheServiceMock: ReturnType<typeof buildCacheServiceMock>;

  async function createModule(
    meetingOverrides?: Partial<ReturnType<typeof buildMeetingModelMock>>,
    alertOverrides?: Partial<ReturnType<typeof buildAlertModelMock>>,
    cacheOverrides?: Partial<ReturnType<typeof buildCacheServiceMock>>,
  ) {
    meetingModelMock = buildMeetingModelMock(meetingOverrides);
    alertModelMock = buildAlertModelMock(alertOverrides);
    cacheServiceMock = buildCacheServiceMock(cacheOverrides);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: getModelToken(Meeting.name), useValue: meetingModelMock },
        { provide: getModelToken(AlertRecord.name), useValue: alertModelMock },
        { provide: CacheService, useValue: cacheServiceMock },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  }

  // -------------------------------------------------------------------------
  // getDailyActivitySummary
  // -------------------------------------------------------------------------

  describe('getDailyActivitySummary', () => {
    it('should return activity counts for RM on given date', async () => {
      await createModule(
        {
          countDocuments: jest
            .fn()
            .mockReturnValue({ exec: jest.fn().mockResolvedValue(3) }),
        },
        {
          countDocuments: jest
            .fn()
            .mockReturnValue({ exec: jest.fn().mockResolvedValue(2) }),
        },
      );

      const result: DailyActivitySummary = await service.getDailyActivitySummary(
        'rm-001',
        '2026-03-10',
      );

      expect(result.rm_id).toBe('rm-001');
      expect(result.date).toBe('2026-03-10');
      expect(result.meetings).toBe(3);
      expect(result.active_alerts).toBe(2);
      // rm_interactions not in scaffold — should be 0
      expect(result.calls).toBe(0);
      expect(result.tasks_completed).toBe(0);
      expect(result.proposals_sent).toBe(0);
    });

    it('should return cached data on cache hit', async () => {
      const cachedSummary: DailyActivitySummary = {
        rm_id: 'rm-001',
        date: '2026-03-10',
        calls: 5,
        meetings: 4,
        tasks_completed: 2,
        proposals_sent: 1,
        active_alerts: 3,
        cached_at: '2026-03-10T08:00:00.000Z',
      };

      await createModule(
        undefined,
        undefined,
        {
          // Simulate a cache hit: readThrough returns the cached value immediately
          readThrough: jest.fn().mockResolvedValue(cachedSummary),
        },
      );

      const result = await service.getDailyActivitySummary('rm-001', '2026-03-10');

      expect(result).toEqual(cachedSummary);
      // MongoDB should NOT have been called
      expect(meetingModelMock.countDocuments).not.toHaveBeenCalled();
    });

    it('should compute from MongoDB on cache miss', async () => {
      const meetingCountExec = jest.fn().mockResolvedValue(2);
      const alertCountExec = jest.fn().mockResolvedValue(1);

      await createModule(
        {
          countDocuments: jest.fn().mockReturnValue({ exec: meetingCountExec }),
        },
        {
          countDocuments: jest.fn().mockReturnValue({ exec: alertCountExec }),
        },
        // Default cacheServiceMock calls fetchFn (simulates cache miss)
      );

      const result = await service.getDailyActivitySummary('rm-002', '2026-03-10');

      expect(result.meetings).toBe(2);
      expect(result.active_alerts).toBe(1);
      expect(meetingCountExec).toHaveBeenCalled();
      expect(alertCountExec).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getDailyStatusWithGapAnalysis
  // -------------------------------------------------------------------------

  describe('getDailyStatusWithGapAnalysis', () => {
    /**
     * Helper: set up a scenario where the RM has `rmMeetings` meetings and
     * the rest of the team is represented by `peerRows`.
     */
    async function setupGapScenario(
      rmMeetings: number,
      peerRows: Array<{ rm_id: string; meetings: number }>,
      alertCount = 0,
    ) {
      // countDocuments is called by getDailyActivitySummary (meetings) and alert
      const meetingCountExec = jest.fn().mockResolvedValue(rmMeetings);
      const alertCountExec = jest.fn().mockResolvedValue(alertCount);

      // aggregate is called twice: once for team avg, once for peer rank
      const aggregateExec = jest.fn().mockResolvedValue(peerRows);

      await createModule(
        {
          countDocuments: jest.fn().mockReturnValue({ exec: meetingCountExec }),
          aggregate: jest.fn().mockReturnValue({ exec: aggregateExec }),
        },
        {
          countDocuments: jest.fn().mockReturnValue({ exec: alertCountExec }),
        },
      );
    }

    it('should return positive gap when RM is above team avg', async () => {
      // RM has 5 meetings; team peers each have 2 meetings → avg = 2
      const peerRows = [
        { rm_id: 'rm-002', meetings: 2 },
        { rm_id: 'rm-003', meetings: 2 },
      ];
      await setupGapScenario(5, peerRows);

      const result: DailyStatus = await service.getDailyStatusWithGapAnalysis(
        'rm-001',
        'branch-A',
        '2026-03-10',
      );

      // team avg meetings = (2+2) / 2 = 2
      expect(result.team_avg.meetings).toBe(2);
      // rm has 5 meetings → gap = 5 - 2 = 3 (positive = above average)
      expect(result.gaps.meetings).toBeGreaterThan(0);
    });

    it('should return negative gap when RM is below team avg', async () => {
      // RM has 1 meeting; team peers have 4 meetings each → avg = 4
      const peerRows = [
        { rm_id: 'rm-002', meetings: 4 },
        { rm_id: 'rm-003', meetings: 4 },
      ];
      await setupGapScenario(1, peerRows);

      const result: DailyStatus = await service.getDailyStatusWithGapAnalysis(
        'rm-001',
        'branch-A',
        '2026-03-10',
      );

      expect(result.gaps.meetings).toBeLessThan(0);
    });

    it('should rank RM correctly among branch peers', async () => {
      // RM rm-001 has 3 meetings; peers: rm-002=5, rm-003=1
      // Rank = RMs with fewer meetings + 1 = (rm-003 has fewer) + 1 = 2
      const peerRows = [
        { rm_id: 'rm-001', meetings: 3 },
        { rm_id: 'rm-002', meetings: 5 },
        { rm_id: 'rm-003', meetings: 1 },
      ];
      await setupGapScenario(3, peerRows);

      const result: DailyStatus = await service.getDailyStatusWithGapAnalysis(
        'rm-001',
        'branch-A',
        '2026-03-10',
      );

      // rm-003 has fewer meetings (1 < 3), so rank = 1 + 1 = 2
      expect(result.peer_rank.meetings).toBe(2);
    });
  });
});
