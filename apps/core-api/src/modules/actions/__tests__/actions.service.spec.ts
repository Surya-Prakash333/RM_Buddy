import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ActionsService } from '../actions.service';
import { CacheService } from '../../cache/cache.service';
import { Pipeline } from '../../../database/models/pipeline.model';
import { Portfolio } from '../../../database/models/portfolio.model';
import { Client } from '../../../database/models/client.model';
import { Meeting } from '../../../database/models/meeting.model';
import { DailyActionsData } from '../dto/actions.dto';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function buildAggExecMock(resolvedValue: unknown[]) {
  return jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(resolvedValue) });
}

function buildPipelineModelMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    aggregate: buildAggExecMock([]),
    ...overrides,
  };
}

function buildPortfolioModelMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    aggregate: buildAggExecMock([]),
    ...overrides,
  };
}

function buildClientModelMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    aggregate: buildAggExecMock([]),
    ...overrides,
  };
}

function buildMeetingModelMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    aggregate: buildAggExecMock([]),
    ...overrides,
  };
}

function buildCacheServiceMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    readThrough: jest.fn().mockImplementation(
      async (_key: string, fetchFn: () => Promise<unknown>) => fetchFn(),
    ),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake pipeline row in PROPOSAL_SENT status. */
function makePipelineRow(overrides: Record<string, unknown> = {}) {
  const lastUpdated = new Date();
  lastUpdated.setDate(lastUpdated.getDate() - 10); // 10 days ago → pending > 5 days
  return {
    pipeline_id: 'pipe-001',
    client_id: 'client-001',
    client_name: 'Test Client',
    client_tier: 'DIAMOND',
    amount: 5_000_000,
    asset_class: 'MF',
    sub_product: 'SIP',
    status: 'PROPOSAL_SENT',
    last_updated: lastUpdated,
    ...overrides,
  };
}

/** Build a fake pipeline row in an aging (non-proposal) status. */
function makeAgingPipelineRow(overrides: Record<string, unknown> = {}) {
  const lastUpdated = new Date();
  lastUpdated.setDate(lastUpdated.getDate() - 14); // 14 days ago → stuck > 7 days
  return {
    pipeline_id: 'pipe-002',
    client_id: 'client-002',
    client_name: 'Aging Client',
    client_tier: 'GOLD',
    amount: 2_000_000,
    asset_class: 'PMS',
    sub_product: 'Equity Growth',
    status: 'NEGOTIATION',
    last_updated: lastUpdated,
    ...overrides,
  };
}

/** Build a fake portfolio row with high cash. */
function makeIdleCashRow(overrides: Record<string, unknown> = {}) {
  const lastInteraction = new Date();
  lastInteraction.setDate(lastInteraction.getDate() - 45); // 45 days ago → idle > 30 days
  return {
    client_id: 'client-003',
    client_name: 'Idle Client',
    client_tier: 'PLATINUM',
    cash_balance: 1_500_000, // ₹15L
    cash_pct: 25,            // 25% > 15% threshold
    last_interaction: lastInteraction,
    ...overrides,
  };
}

/** Build a fake meeting row for a follow-up. */
function makeFollowUpRow(overrides: Record<string, unknown> = {}) {
  // Use 2026-03-09 (one day before the test DATE of 2026-03-10) so it's overdue
  const yesterday = new Date('2026-03-09T00:00:00.000Z');
  return {
    meeting_id: 'mtg-001',
    client_name: 'Follow Client',
    client_tier: 'HNI',
    scheduled_date: yesterday,
    agenda: 'Portfolio review follow-up',
    priority: 'HIGH',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ActionsService', () => {
  let service: ActionsService;
  let pipelineModelMock: ReturnType<typeof buildPipelineModelMock>;
  let portfolioModelMock: ReturnType<typeof buildPortfolioModelMock>;
  let clientModelMock: ReturnType<typeof buildClientModelMock>;
  let meetingModelMock: ReturnType<typeof buildMeetingModelMock>;
  let cacheServiceMock: ReturnType<typeof buildCacheServiceMock>;

  async function createModule(
    pipelineOverrides: Record<string, jest.Mock> = {},
    portfolioOverrides: Record<string, jest.Mock> = {},
    clientOverrides: Record<string, jest.Mock> = {},
    meetingOverrides: Record<string, jest.Mock> = {},
    cacheOverrides: Record<string, jest.Mock> = {},
  ) {
    pipelineModelMock = buildPipelineModelMock(pipelineOverrides);
    portfolioModelMock = buildPortfolioModelMock(portfolioOverrides);
    clientModelMock = buildClientModelMock(clientOverrides);
    meetingModelMock = buildMeetingModelMock(meetingOverrides);
    cacheServiceMock = buildCacheServiceMock(cacheOverrides);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActionsService,
        { provide: getModelToken(Pipeline.name), useValue: pipelineModelMock },
        { provide: getModelToken(Portfolio.name), useValue: portfolioModelMock },
        { provide: getModelToken(Client.name), useValue: clientModelMock },
        { provide: getModelToken(Meeting.name), useValue: meetingModelMock },
        { provide: CacheService, useValue: cacheServiceMock },
      ],
    }).compile();

    service = module.get<ActionsService>(ActionsService);
  }

  const RM_ID = 'rm-001';
  const DATE = '2026-03-10';

  // -------------------------------------------------------------------------
  // getActionsData — structural tests
  // -------------------------------------------------------------------------

  describe('getActionsData', () => {
    it('should aggregate from all 4 sources', async () => {
      await createModule();
      const result: DailyActionsData = await service.getActionsData(RM_ID, DATE);

      expect(result).toHaveProperty('rm_id', RM_ID);
      expect(result).toHaveProperty('date', DATE);
      expect(result).toHaveProperty('pipeline_aging');
      expect(result).toHaveProperty('proposals_pending');
      expect(result).toHaveProperty('follow_ups_due');
      expect(result).toHaveProperty('idle_cash_clients');
      expect(result).toHaveProperty('total_actions');
    });

    it('should compute total_actions as sum of all 4 source counts', async () => {
      // Pipeline mock: 1 aging row + 1 proposal row (aggregate called twice for pipeline)
      const agingRow = makeAgingPipelineRow();
      const proposalRow = makePipelineRow();
      let callCount = 0;
      const pipelineAggregateMock = jest.fn().mockImplementation(() => {
        callCount++;
        const row = callCount === 1 ? [agingRow] : [proposalRow];
        return { exec: jest.fn().mockResolvedValue(row) };
      });

      const meetingAggregateMock = buildAggExecMock([makeFollowUpRow()]);
      const portfolioAggregateMock = buildAggExecMock([makeIdleCashRow()]);

      await createModule(
        { aggregate: pipelineAggregateMock },
        { aggregate: portfolioAggregateMock },
        {},
        { aggregate: meetingAggregateMock },
      );

      const result = await service.getActionsData(RM_ID, DATE);
      // 1 pipeline aging + 1 proposal + 1 followup + 1 idle cash = 4
      expect(result.total_actions).toBe(4);
      expect(result.pipeline_aging.count).toBe(1);
      expect(result.proposals_pending.count).toBe(1);
      expect(result.follow_ups_due.count).toBe(1);
      expect(result.idle_cash_clients.count).toBe(1);
    });

    it('should return zero counts when no data exists', async () => {
      await createModule();
      const result = await service.getActionsData(RM_ID, DATE);

      expect(result.total_actions).toBe(0);
      expect(result.pipeline_aging.count).toBe(0);
      expect(result.proposals_pending.count).toBe(0);
      expect(result.follow_ups_due.count).toBe(0);
      expect(result.idle_cash_clients.count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Source 1: Pipeline aging
  // -------------------------------------------------------------------------

  describe('fetchPipelineAging', () => {
    it('should flag pipeline deals stuck > 7 days', async () => {
      const agingRow = makeAgingPipelineRow(); // last_updated 14 days ago
      await createModule({ aggregate: buildAggExecMock([agingRow]) });

      const items = await service.fetchPipelineAging(RM_ID);

      expect(items).toHaveLength(1);
      expect(items[0].days_in_stage).toBeGreaterThan(7);
      expect(items[0].pipeline_id).toBe('pipe-002');
      expect(items[0].action_needed).toMatch(/stuck/i);
    });

    it('should include deal_amount in returned items', async () => {
      const row = makeAgingPipelineRow({ amount: 3_000_000 });
      await createModule({ aggregate: buildAggExecMock([row]) });

      const items = await service.fetchPipelineAging(RM_ID);
      expect(items[0].deal_amount).toBe(3_000_000);
    });

    it('should return empty list when no deals are stagnant', async () => {
      await createModule({ aggregate: buildAggExecMock([]) });
      const items = await service.fetchPipelineAging(RM_ID);
      expect(items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Source 2: Proposals pending
  // -------------------------------------------------------------------------

  describe('fetchPendingProposals', () => {
    it('should flag proposals pending > 5 days', async () => {
      const proposalRow = makePipelineRow(); // last_updated 10 days ago

      // fetchPendingProposals calls pipeline aggregate once directly
      const aggreageMock = jest.fn().mockImplementation(() => {
        return { exec: jest.fn().mockResolvedValue([proposalRow]) };
      });

      await createModule({ aggregate: aggreageMock });

      const items = await service.fetchPendingProposals(RM_ID, DATE);

      expect(items).toHaveLength(1);
      expect(items[0].days_pending).toBeGreaterThan(5);
      expect(items[0].proposal_id).toBe('pipe-001');
      expect(items[0].action_needed).toMatch(/pending/i);
    });

    it('should return empty list when no proposals are pending', async () => {
      await createModule({ aggregate: buildAggExecMock([]) });
      const items = await service.fetchPendingProposals(RM_ID, DATE);
      expect(items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Source 3: Follow-ups due
  // -------------------------------------------------------------------------

  describe('fetchFollowUpsDue', () => {
    it('should include overdue follow-ups', async () => {
      const overdueRow = makeFollowUpRow(); // scheduled_date = yesterday → overdue
      await createModule({}, {}, {}, { aggregate: buildAggExecMock([overdueRow]) });

      const items = await service.fetchFollowUpsDue(RM_ID, DATE);

      expect(items).toHaveLength(1);
      expect(items[0].days_overdue).toBeGreaterThan(0);
      expect(items[0].action_needed).toMatch(/overdue/i);
    });

    it('should mark follow-up with days_overdue = 0 for today', async () => {
      const todayRow = makeFollowUpRow({ scheduled_date: new Date(`${DATE}T00:00:00.000Z`) });
      await createModule({}, {}, {}, { aggregate: buildAggExecMock([todayRow]) });

      const items = await service.fetchFollowUpsDue(RM_ID, DATE);

      expect(items).toHaveLength(1);
      expect(items[0].days_overdue).toBe(0);
      expect(items[0].action_needed).toMatch(/today/i);
    });

    it('should correctly compute overdue count in source object', async () => {
      const overdueRow = makeFollowUpRow();       // yesterday → overdue
      const tomorrow = new Date(`${DATE}T00:00:00.000Z`);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowRow = makeFollowUpRow({ scheduled_date: tomorrow, meeting_id: 'mtg-002' });

      await createModule({}, {}, {}, { aggregate: buildAggExecMock([overdueRow, tomorrowRow]) });

      const result = await service.getActionsData(RM_ID, DATE);
      expect(result.follow_ups_due.overdue).toBe(1);
      expect(result.follow_ups_due.count).toBe(2);
    });

    it('should return empty list when no follow-ups are due', async () => {
      await createModule({}, {}, {}, { aggregate: buildAggExecMock([]) });
      const items = await service.fetchFollowUpsDue(RM_ID, DATE);
      expect(items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Source 4: Idle cash clients
  // -------------------------------------------------------------------------

  describe('fetchIdleCashClients', () => {
    it('should flag clients with cash_pct > 15%', async () => {
      const idleRow = makeIdleCashRow(); // cash_pct = 25 → > 15%
      await createModule({}, { aggregate: buildAggExecMock([idleRow]) });

      const items = await service.fetchIdleCashClients(RM_ID);

      expect(items).toHaveLength(1);
      expect(items[0].cash_pct).toBeGreaterThan(15);
      expect(items[0].client_id).toBe('client-003');
      expect(items[0].action_needed).toMatch(/idle cash/i);
    });

    it('should accumulate total_idle_amount in the source object', async () => {
      const row1 = makeIdleCashRow({ client_id: 'c-001', cash_balance: 1_000_000 });
      const row2 = makeIdleCashRow({ client_id: 'c-002', cash_balance: 500_000 });
      await createModule({}, { aggregate: buildAggExecMock([row1, row2]) });

      const result = await service.getActionsData(RM_ID, DATE);
      expect(result.idle_cash_clients.total_idle_amount).toBe(1_500_000);
    });

    it('should return empty list when no clients have excessive idle cash', async () => {
      await createModule({}, { aggregate: buildAggExecMock([]) });
      const items = await service.fetchIdleCashClients(RM_ID);
      expect(items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Priority sorting
  // -------------------------------------------------------------------------

  describe('priority sorting', () => {
    it('should sort pipeline items with HIGH priority first', async () => {
      const diamondRow = makeAgingPipelineRow({
        pipeline_id: 'pipe-diamond',
        client_tier: 'DIAMOND',
        amount: 10_000_000,
      });
      const silverRow = makeAgingPipelineRow({
        pipeline_id: 'pipe-silver',
        client_tier: 'SILVER',
        amount: 500_000,
      });

      // Return silver first from DB to verify sorting works
      await createModule({ aggregate: buildAggExecMock([silverRow, diamondRow]) });

      const items = await service.fetchPipelineAging(RM_ID);

      expect(items[0].priority).toBe('HIGH');
      expect(items[0].pipeline_id).toBe('pipe-diamond');
      expect(items[1].priority).toBe('LOW');
    });

    it('should sort idle cash clients with HIGH priority first', async () => {
      const silverRow = makeIdleCashRow({ client_id: 'c-silver', client_tier: 'SILVER', cash_balance: 200_000 });
      const platinumRow = makeIdleCashRow({ client_id: 'c-platinum', client_tier: 'PLATINUM', cash_balance: 100_000 });

      await createModule({}, { aggregate: buildAggExecMock([silverRow, platinumRow]) });

      const items = await service.fetchIdleCashClients(RM_ID);

      expect(items[0].client_tier).toBe('PLATINUM');
      expect(items[1].client_tier).toBe('SILVER');
    });
  });

  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------

  describe('caching', () => {
    it('should cache with 15min TTL (900 seconds)', async () => {
      let capturedTtl: number | undefined;
      const readThroughMock = jest.fn().mockImplementation(
        async (_key: string, fetchFn: () => Promise<unknown>, ttl: number) => {
          capturedTtl = ttl;
          return fetchFn();
        },
      );

      await createModule({}, {}, {}, {}, { readThrough: readThroughMock });
      await service.getActionsData(RM_ID, DATE);

      expect(capturedTtl).toBe(900);
    });

    it('should use a cache key containing rm_id and date', async () => {
      let capturedKey = '';
      const readThroughMock = jest.fn().mockImplementation(
        async (key: string, fetchFn: () => Promise<unknown>) => {
          capturedKey = key;
          return fetchFn();
        },
      );

      await createModule({}, {}, {}, {}, { readThrough: readThroughMock });
      await service.getActionsData(RM_ID, DATE);

      expect(capturedKey).toContain(RM_ID);
      expect(capturedKey).toContain(DATE);
    });

    it('should return cached data without calling DB', async () => {
      const cachedData: DailyActionsData = {
        rm_id: RM_ID,
        date: DATE,
        total_actions: 99,
        pipeline_aging: { count: 0, items: [] },
        proposals_pending: { count: 0, items: [] },
        follow_ups_due: { count: 0, overdue: 0, items: [] },
        idle_cash_clients: { count: 0, total_idle_amount: 0, items: [] },
      };

      const readThroughMock = jest.fn().mockResolvedValue(cachedData);
      const aggregateSpy = buildAggExecMock([]);

      await createModule(
        { aggregate: aggregateSpy },
        { aggregate: aggregateSpy },
        { aggregate: aggregateSpy },
        { aggregate: aggregateSpy },
        { readThrough: readThroughMock },
      );

      const result = await service.getActionsData(RM_ID, DATE);

      expect(result.total_actions).toBe(99);
      // DB should not have been queried
      expect(aggregateSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getActionsSummary
  // -------------------------------------------------------------------------

  describe('getActionsSummary', () => {
    it('should return a summary with counts from all 4 sources', async () => {
      await createModule();
      const summary = await service.getActionsSummary(RM_ID);

      expect(summary).toHaveProperty('total_actions');
      expect(summary).toHaveProperty('pipeline_count');
      expect(summary).toHaveProperty('proposals_count');
      expect(summary).toHaveProperty('followups_count');
      expect(summary).toHaveProperty('idle_cash_count');
    });
  });
});
