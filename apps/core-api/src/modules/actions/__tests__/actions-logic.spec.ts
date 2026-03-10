/**
 * Unit tests for ActionsService — Logic Layer (S2-F13-L2-Logic)
 *
 * Tests cover:
 *   - computePriorityScore (private, accessed via scoreAndRankActions)
 *   - scoreAndRankActions
 *   - getRankedActions (cache integration)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ActionsService } from '../actions.service';
import { CacheService } from '../../cache/cache.service';
import { Pipeline } from '../../../database/models/pipeline.model';
import { Portfolio } from '../../../database/models/portfolio.model';
import { Client } from '../../../database/models/client.model';
import { Meeting } from '../../../database/models/meeting.model';
import { DailyActionsData, RankedActionsData } from '../dto/actions.dto';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function buildAggExecMock(resolvedValue: unknown[]) {
  return jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(resolvedValue) });
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

function buildModelMock(overrides: Record<string, jest.Mock> = {}) {
  return { aggregate: buildAggExecMock([]), ...overrides };
}

// ---------------------------------------------------------------------------
// DailyActionsData builder helpers
// ---------------------------------------------------------------------------

function emptyDailyActions(rmId = 'rm-001', date = '2026-03-10'): DailyActionsData {
  return {
    rm_id: rmId,
    date,
    total_actions: 0,
    pipeline_aging: { count: 0, items: [] },
    proposals_pending: { count: 0, items: [] },
    follow_ups_due: { count: 0, overdue: 0, items: [] },
    idle_cash_clients: { count: 0, total_idle_amount: 0, items: [] },
  };
}

function makePipelineItem(overrides: Record<string, unknown> = {}) {
  return {
    pipeline_id: 'pipe-001',
    client_name: 'Test Client',
    client_tier: 'DIAMOND',
    deal_amount: 3_000_000,
    product: 'MF — SIP',
    stage: 'NEGOTIATION',
    days_in_stage: 15,
    priority: 'HIGH' as const,
    action_needed: 'Follow up — stuck 15 days',
    ...overrides,
  };
}

function makeProposalItem(overrides: Record<string, unknown> = {}) {
  return {
    proposal_id: 'prop-001',
    client_name: 'Proposal Client',
    client_tier: 'PLATINUM',
    proposal_amount: 2_000_000,
    proposed_product: 'PMS — Equity',
    submitted_date: '2026-02-20',
    days_pending: 18,
    action_needed: 'Follow up on proposal — 18 days pending',
    ...overrides,
  };
}

function makeFollowUpItem(overrides: Record<string, unknown> = {}) {
  return {
    followup_id: 'mtg-001',
    client_name: 'Follow Client',
    client_tier: 'HNI',
    due_date: '2026-03-09',
    days_overdue: 1,
    description: 'Portfolio review',
    action_needed: 'Overdue follow-up — 1 day past due',
    ...overrides,
  };
}

function makeIdleCashItem(overrides: Record<string, unknown> = {}) {
  return {
    client_id: 'client-003',
    client_name: 'Idle Client',
    client_tier: 'GOLD',
    cash_balance: 1_500_000,
    cash_pct: 25,
    days_idle: 45,
    action_needed: '₹15L idle cash — suggest SIP',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

async function createService(cacheOverrides: Record<string, jest.Mock> = {}): Promise<ActionsService> {
  const cacheServiceMock = buildCacheServiceMock(cacheOverrides);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ActionsService,
      { provide: getModelToken(Pipeline.name), useValue: buildModelMock() },
      { provide: getModelToken(Portfolio.name), useValue: buildModelMock() },
      { provide: getModelToken(Client.name), useValue: buildModelMock() },
      { provide: getModelToken(Meeting.name), useValue: buildModelMock() },
      { provide: CacheService, useValue: cacheServiceMock },
    ],
  }).compile();

  return module.get<ActionsService>(ActionsService);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActionsService — Logic Layer', () => {
  // -------------------------------------------------------------------------
  // computePriorityScore (tested indirectly via scoreAndRankActions)
  // -------------------------------------------------------------------------

  describe('computePriorityScore', () => {
    it('should give Diamond client higher score than Silver for same urgency and amount', async () => {
      const service = await createService();

      const diamondData: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 1,
          items: [makePipelineItem({ client_tier: 'DIAMOND', days_in_stage: 15, deal_amount: 1_000_000 })],
        },
      };

      const silverData: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 1,
          items: [makePipelineItem({ client_tier: 'SILVER', days_in_stage: 15, deal_amount: 1_000_000 })],
        },
      };

      const diamondRanked = service.scoreAndRankActions('rm-001', diamondData);
      const silverRanked = service.scoreAndRankActions('rm-001', silverData);

      expect(diamondRanked.all_actions[0].priority_score).toBeGreaterThan(
        silverRanked.all_actions[0].priority_score,
      );
    });

    it('should increase score with more days pending', async () => {
      const service = await createService();

      const fewDaysData: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 1,
          items: [makePipelineItem({ client_tier: 'GOLD', days_in_stage: 5, deal_amount: 500_000 })],
        },
      };

      const manyDaysData: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 1,
          items: [makePipelineItem({ client_tier: 'GOLD', days_in_stage: 25, deal_amount: 500_000 })],
        },
      };

      const fewRanked = service.scoreAndRankActions('rm-001', fewDaysData);
      const manyRanked = service.scoreAndRankActions('rm-001', manyDaysData);

      expect(manyRanked.all_actions[0].priority_score).toBeGreaterThan(
        fewRanked.all_actions[0].priority_score,
      );
    });

    it('should cap days factor at 30 days (urgency maxes out)', async () => {
      const service = await createService();

      const thirtyDaysData: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 1,
          items: [makePipelineItem({ client_tier: 'GOLD', days_in_stage: 30, deal_amount: 500_000 })],
        },
      };

      const sixtyDaysData: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 1,
          items: [makePipelineItem({ client_tier: 'GOLD', days_in_stage: 60, deal_amount: 500_000 })],
        },
      };

      const thirtyRanked = service.scoreAndRankActions('rm-001', thirtyDaysData);
      const sixtyRanked = service.scoreAndRankActions('rm-001', sixtyDaysData);

      // Both should produce the same score because urgency is capped at 1.0 at 30 days
      expect(thirtyRanked.all_actions[0].priority_score).toBe(
        sixtyRanked.all_actions[0].priority_score,
      );
    });

    it('should return scores within 0-1000 range', async () => {
      const service = await createService();

      const data: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 3,
          items: [
            makePipelineItem({ client_tier: 'DIAMOND', days_in_stage: 100, deal_amount: 100_000_000 }),
            makePipelineItem({ client_tier: 'SILVER', days_in_stage: 0, deal_amount: 0, pipeline_id: 'p2' }),
            makePipelineItem({ client_tier: 'GOLD', days_in_stage: 15, deal_amount: 2_500_000, pipeline_id: 'p3' }),
          ],
        },
      };

      const ranked = service.scoreAndRankActions('rm-001', data);

      for (const action of ranked.all_actions) {
        expect(action.priority_score).toBeGreaterThanOrEqual(0);
        expect(action.priority_score).toBeLessThanOrEqual(1000);
      }
    });
  });

  // -------------------------------------------------------------------------
  // scoreAndRankActions
  // -------------------------------------------------------------------------

  describe('scoreAndRankActions', () => {
    it('should merge items from all 4 sources', async () => {
      const service = await createService();

      const data: DailyActionsData = {
        ...emptyDailyActions(),
        total_actions: 4,
        pipeline_aging: { count: 1, items: [makePipelineItem()] },
        proposals_pending: { count: 1, items: [makeProposalItem()] },
        follow_ups_due: { count: 1, overdue: 1, items: [makeFollowUpItem()] },
        idle_cash_clients: { count: 1, total_idle_amount: 1_500_000, items: [makeIdleCashItem()] },
      };

      const ranked = service.scoreAndRankActions('rm-001', data);

      expect(ranked.all_actions).toHaveLength(4);
      const sources = ranked.all_actions.map((a) => a.source);
      expect(sources).toContain('pipeline');
      expect(sources).toContain('proposal');
      expect(sources).toContain('followup');
      expect(sources).toContain('idle_cash');
    });

    it('should sort by priority_score descending', async () => {
      const service = await createService();

      const data: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 3,
          items: [
            makePipelineItem({ pipeline_id: 'low', client_tier: 'SILVER', days_in_stage: 1, deal_amount: 0 }),
            makePipelineItem({ pipeline_id: 'high', client_tier: 'DIAMOND', days_in_stage: 30, deal_amount: 5_000_000 }),
            makePipelineItem({ pipeline_id: 'mid', client_tier: 'GOLD', days_in_stage: 15, deal_amount: 2_000_000 }),
          ],
        },
      };

      const ranked = service.scoreAndRankActions('rm-001', data);
      const scores = ranked.all_actions.map((a) => a.priority_score);

      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
      }
    });

    it('should map score >= 800 to P1_CRITICAL', async () => {
      const service = await createService();

      // DIAMOND + 30+ days + max amount → score should be >= 800
      const data: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 1,
          items: [makePipelineItem({ client_tier: 'DIAMOND', days_in_stage: 30, deal_amount: 5_000_000 })],
        },
      };

      const ranked = service.scoreAndRankActions('rm-001', data);
      // Score = (1.0*0.4 + 1.0*0.35 + 1.0*0.25) * 1000 = 1000
      expect(ranked.all_actions[0].priority_score).toBe(1000);
      expect(ranked.all_actions[0].priority).toBe('P1_CRITICAL');
    });

    it('should map score 600-799 to P2_HIGH', async () => {
      const service = await createService();

      // PLATINUM + 0 days + 0 amount → score = (0.85*0.4 + 0 + 0) * 1000 = 340 → P4_LOW
      // PLATINUM + 15 days + 2_500_000 → score = (0.85*0.4 + 0.5*0.35 + 0.5*0.25) * 1000 = (0.34+0.175+0.125)*1000 = 640 → P2_HIGH
      const data: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 1,
          items: [makePipelineItem({ client_tier: 'PLATINUM', days_in_stage: 15, deal_amount: 2_500_000 })],
        },
      };

      const ranked = service.scoreAndRankActions('rm-001', data);
      expect(ranked.all_actions[0].priority_score).toBe(640);
      expect(ranked.all_actions[0].priority).toBe('P2_HIGH');
    });

    it('should limit top_actions to 10 items', async () => {
      const service = await createService();

      const manyItems = Array.from({ length: 15 }, (_, i) =>
        makePipelineItem({ pipeline_id: `pipe-${i}`, client_tier: 'GOLD', days_in_stage: i, deal_amount: i * 100_000 }),
      );

      const data: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: { count: 15, items: manyItems },
      };

      const ranked = service.scoreAndRankActions('rm-001', data);

      expect(ranked.all_actions).toHaveLength(15);
      expect(ranked.top_actions).toHaveLength(10);
    });

    it('should compute p1_count correctly', async () => {
      const service = await createService();

      const data: DailyActionsData = {
        ...emptyDailyActions(),
        pipeline_aging: {
          count: 2,
          items: [
            makePipelineItem({ pipeline_id: 'p1', client_tier: 'DIAMOND', days_in_stage: 30, deal_amount: 5_000_000 }),
            makePipelineItem({ pipeline_id: 'p2', client_tier: 'SILVER', days_in_stage: 0, deal_amount: 0 }),
          ],
        },
      };

      const ranked = service.scoreAndRankActions('rm-001', data);

      // Only the DIAMOND item should reach >= 800 → P1_CRITICAL
      expect(ranked.p1_count).toBe(1);
      // SILVER + 0 days + 0 amount → P4_LOW
      expect(ranked.p2_count).toBe(0);
    });

    it('should compute summary_by_source from all 4 source counts', async () => {
      const service = await createService();

      const data: DailyActionsData = {
        ...emptyDailyActions(),
        total_actions: 10,
        pipeline_aging: { count: 3, items: [] },
        proposals_pending: { count: 2, items: [] },
        follow_ups_due: { count: 4, overdue: 1, items: [] },
        idle_cash_clients: { count: 1, total_idle_amount: 0, items: [] },
      };

      const ranked = service.scoreAndRankActions('rm-001', data);

      expect(ranked.summary_by_source.pipeline).toBe(3);
      expect(ranked.summary_by_source.proposal).toBe(2);
      expect(ranked.summary_by_source.followup).toBe(4);
      expect(ranked.summary_by_source.idle_cash).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getRankedActions
  // -------------------------------------------------------------------------

  describe('getRankedActions', () => {
    it('should cache ranked result for 15 minutes (900 seconds)', async () => {
      let capturedTtl: number | undefined;
      const setMock = jest.fn().mockImplementation(async (_key: string, _val: unknown, ttl: number) => {
        capturedTtl = ttl;
      });

      const service = await createService({ set: setMock });
      await service.getRankedActions('rm-001', '2026-03-10');

      expect(capturedTtl).toBe(900);
    });

    it('should return cached data on second call without re-computing', async () => {
      const cachedRanked: RankedActionsData = {
        rm_id: 'rm-001',
        date: '2026-03-10',
        top_actions: [],
        all_actions: [],
        total_count: 42,
        p1_count: 5,
        p2_count: 10,
        summary_by_source: { pipeline: 10, proposal: 8, followup: 15, idle_cash: 9 },
      };

      // getMock returns cached data on every call
      const getMock = jest.fn().mockResolvedValue(cachedRanked);
      const service = await createService({ get: getMock });

      const result = await service.getRankedActions('rm-001', '2026-03-10');

      expect(result.total_count).toBe(42);
      // get was called → cache hit → no DB queries triggered
      expect(getMock).toHaveBeenCalledTimes(1);
    });
  });
});
