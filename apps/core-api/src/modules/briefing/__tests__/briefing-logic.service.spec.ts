/**
 * BriefingService — Logic Layer tests (S2-F1-L2-Logic)
 *
 * Covers:
 *  - rankBriefingData: scoring, ordering, section coverage
 *  - getIdempotentBriefing: cache idempotency, TTL, stable briefing_id
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { Meeting } from '../../../database/models/meeting.model';
import { AlertRecord } from '../../../database/models/alert.model';
import { Portfolio } from '../../../database/models/portfolio.model';
import { Transaction } from '../../../database/models/transaction.model';
import { Client } from '../../../database/models/client.model';
import { CacheService } from '../../cache/cache.service';
import { BriefingService } from '../briefing.service';
import { BriefingData, RankedBriefingData } from '../dto/briefing.dto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';
const DATE = '2026-03-10';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const makeCacheMock = () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined),
});

const makeModelMock = (findResult: unknown[] = [], aggregateResult: unknown[] = []) => ({
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(findResult),
    }),
  }),
  aggregate: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(aggregateResult),
  }),
  countDocuments: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(findResult.length),
  }),
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal BriefingData with known items for deterministic scoring tests. */
const makeMinimalBriefingData = (overrides: Partial<BriefingData> = {}): BriefingData => ({
  rm_id: RM_ID,
  date: DATE,
  generated_at: '2026-03-10T05:00:00.000Z',
  meetings_today: { count: 0, items: [] },
  pending_tasks: { count: 0, overdue: 0, items: [] },
  active_alerts: { count: 0, critical: 0, high: 0, items: [] },
  portfolio_summary: { total_aum: 0, aum_change_today: 0, top_gainers: [], top_losers: [] },
  revenue_ytd: { amount: 0, target: 0, achievement_pct: 0, vs_last_year: 0 },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('BriefingService — Logic Layer', () => {
  let service: BriefingService;
  let cacheMock: ReturnType<typeof makeCacheMock>;

  async function buildModule(): Promise<void> {
    cacheMock = makeCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BriefingService,
        { provide: CacheService, useValue: cacheMock },
        { provide: getModelToken(Meeting.name), useValue: makeModelMock() },
        { provide: getModelToken(AlertRecord.name), useValue: makeModelMock() },
        { provide: getModelToken(Portfolio.name), useValue: makeModelMock() },
        { provide: getModelToken(Transaction.name), useValue: makeModelMock() },
        { provide: getModelToken(Client.name), useValue: makeModelMock() },
      ],
    }).compile();

    service = module.get<BriefingService>(BriefingService);
  }

  beforeEach(async () => {
    await buildModule();
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // rankBriefingData
  // =========================================================================

  describe('rankBriefingData', () => {
    it('should rank CRITICAL alert above HIGH alert', () => {
      const data = makeMinimalBriefingData({
        active_alerts: {
          count: 2,
          critical: 1,
          high: 1,
          items: [
            {
              alert_id: 'a-high',
              alert_type: 'generic',
              client_name: 'Client A',
              severity: 'high',
              title: 'High Alert',
              created_at: '2026-03-10T04:00:00.000Z',
            },
            {
              alert_id: 'a-critical',
              alert_type: 'generic',
              client_name: 'Client B',
              severity: 'critical',
              title: 'Critical Alert',
              created_at: '2026-03-10T04:00:00.000Z',
            },
          ],
        },
      });

      const result = service.rankBriefingData(data);
      const alertItems = result.ranked_items.filter((i) => i.item_type === 'ALERT');

      // Both items are present
      expect(alertItems).toHaveLength(2);

      // Critical alert must appear first (higher combined_score)
      expect(alertItems[0].urgency_score).toBe(100); // critical urgency
      expect(alertItems[1].urgency_score).toBe(80);  // high urgency
      expect(alertItems[0].combined_score).toBeGreaterThanOrEqual(alertItems[1].combined_score);
    });

    it('should rank overdue task with urgency 100', () => {
      const data = makeMinimalBriefingData({
        pending_tasks: {
          count: 1,
          overdue: 1,
          items: [
            {
              task_id: 't-001',
              client_name: 'Late Client',
              description: 'Follow up — 30+ days',
              due_date: '2026-02-01',
              is_overdue: true,
              priority: 'HIGH',
            },
          ],
        },
      });

      const result = service.rankBriefingData(data);
      const taskItem = result.ranked_items.find((i) => i.item_type === 'TASK');

      expect(taskItem).toBeDefined();
      expect(taskItem!.urgency_score).toBe(100);
    });

    it('should rank Diamond client items above Silver client items with same urgency', () => {
      const data = makeMinimalBriefingData({
        active_alerts: {
          count: 2,
          critical: 0,
          high: 2,
          items: [
            {
              alert_id: 'a-silver',
              alert_type: 'generic',
              client_name: 'Silver Client',
              // client_tier is not on AlertItem by default but computeImportance reads it
              severity: 'high',
              title: 'High Alert Silver',
              created_at: '2026-03-10T04:00:00.000Z',
            },
            {
              alert_id: 'a-diamond',
              alert_type: 'generic',
              client_name: 'Diamond Client',
              severity: 'high',
              title: 'High Alert Diamond',
              created_at: '2026-03-10T04:00:00.000Z',
            },
          ],
        },
      });

      // Manually inject client_tier into source items so computeImportance can pick it up
      (data.active_alerts.items[0] as unknown as Record<string, unknown>)['client_tier'] = 'SILVER';
      (data.active_alerts.items[1] as unknown as Record<string, unknown>)['client_tier'] = 'DIAMOND';

      const result = service.rankBriefingData(data);
      const alerts = result.ranked_items.filter((i) => i.item_type === 'ALERT');

      expect(alerts).toHaveLength(2);
      const diamondAlert = alerts.find((a) => (a.source_data['client_tier'] as string) === 'DIAMOND');
      const silverAlert = alerts.find((a) => (a.source_data['client_tier'] as string) === 'SILVER');

      expect(diamondAlert).toBeDefined();
      expect(silverAlert).toBeDefined();
      expect(diamondAlert!.importance_score).toBeGreaterThan(silverAlert!.importance_score);
      expect(diamondAlert!.combined_score).toBeGreaterThanOrEqual(silverAlert!.combined_score);
    });

    it('should include items from all 5 sections in ranked_items', () => {
      const data = makeMinimalBriefingData({
        active_alerts: {
          count: 1,
          critical: 1,
          high: 0,
          items: [
            {
              alert_id: 'a-1',
              alert_type: 'generic',
              client_name: 'Client A',
              severity: 'critical',
              title: 'Critical Alert',
              created_at: '2026-03-10T04:00:00.000Z',
            },
          ],
        },
        meetings_today: {
          count: 1,
          items: [
            {
              meeting_id: 'mtg-1',
              client_name: 'Client B',
              client_tier: 'GOLD',
              time: '14:00',
              duration_min: 60,
              agenda: 'Review',
              location: 'Office',
            },
          ],
        },
        pending_tasks: {
          count: 1,
          overdue: 0,
          items: [
            {
              task_id: 'task-1',
              client_name: 'Client C',
              description: 'Follow up',
              due_date: '2026-03-15',
              is_overdue: false,
              priority: 'MEDIUM',
            },
          ],
        },
        portfolio_summary: {
          total_aum: 5_000_000,
          aum_change_today: -100_000,
          top_gainers: [],
          top_losers: [
            { client_id: 'c-loser', client_name: 'Losing Client', change_pct: -5.0 },
          ],
        },
      });

      const result = service.rankBriefingData(data);

      const types = new Set(result.ranked_items.map((i) => i.item_type));
      expect(types.has('ALERT')).toBe(true);
      expect(types.has('MEETING')).toBe(true);
      expect(types.has('TASK')).toBe(true);
      expect(types.has('PORTFOLIO_ALERT')).toBe(true);
    });

    it('should return top_priorities with exactly 5 items (or fewer if total < 5)', () => {
      // Create data with exactly 3 alerts so total items < 5
      const data = makeMinimalBriefingData({
        active_alerts: {
          count: 3,
          critical: 3,
          high: 0,
          items: [
            { alert_id: 'a-1', alert_type: 'x', client_name: 'C1', severity: 'critical', title: 'A1', created_at: '' },
            { alert_id: 'a-2', alert_type: 'x', client_name: 'C2', severity: 'critical', title: 'A2', created_at: '' },
            { alert_id: 'a-3', alert_type: 'x', client_name: 'C3', severity: 'critical', title: 'A3', created_at: '' },
          ],
        },
      });

      const result = service.rankBriefingData(data);
      expect(result.top_priorities.length).toBeLessThanOrEqual(5);
      expect(result.top_priorities.length).toBe(3); // only 3 total items

      // Now create data with 7 items and expect exactly 5
      const data7 = makeMinimalBriefingData({
        active_alerts: {
          count: 7,
          critical: 7,
          high: 0,
          items: Array.from({ length: 7 }, (_, i) => ({
            alert_id: `a-${i}`,
            alert_type: 'x',
            client_name: `C${i}`,
            severity: 'critical',
            title: `Alert ${i}`,
            created_at: '',
          })),
        },
      });
      const result7 = service.rankBriefingData(data7);
      expect(result7.top_priorities).toHaveLength(5);
    });

    it('should compute combined_score as Math.round(urgency * importance / 100)', () => {
      const data = makeMinimalBriefingData({
        pending_tasks: {
          count: 1,
          overdue: 1,
          items: [
            {
              task_id: 't-1',
              client_name: 'Test',
              description: 'Test task',
              due_date: '2026-02-01',
              is_overdue: true,
              priority: 'HIGH',
            },
          ],
        },
      });

      const result = service.rankBriefingData(data);
      const taskItem = result.ranked_items.find((i) => i.item_type === 'TASK')!;

      const expectedCombined = Math.round((taskItem.urgency_score * taskItem.importance_score) / 100);
      expect(taskItem.combined_score).toBe(expectedCombined);
    });
  });

  // =========================================================================
  // getIdempotentBriefing
  // =========================================================================

  describe('getIdempotentBriefing', () => {
    it('should return same briefing_id on repeated calls for same date', async () => {
      const expectedId = `${RM_ID}-${DATE}`;

      // First call (cache miss → generate)
      const first = await service.getIdempotentBriefing(RM_ID, DATE);
      expect(first.briefing_id).toBe(expectedId);

      // Second call: simulate the cache returning the stored ranked briefing
      cacheMock.get.mockResolvedValueOnce(first);
      const second = await service.getIdempotentBriefing(RM_ID, DATE);
      expect(second.briefing_id).toBe(expectedId);
    });

    it('should NOT regenerate briefing if cached version exists (idempotent)', async () => {
      const cachedRanked: RankedBriefingData = {
        ...makeMinimalBriefingData(),
        briefing_id: `${RM_ID}-${DATE}`,
        ranked_items: [],
        top_priorities: [],
      };

      cacheMock.get.mockResolvedValue(cachedRanked);

      const rankSpy = jest.spyOn(service, 'rankBriefingData');
      const getBriefingSpy = jest.spyOn(service, 'getBriefingData');

      await service.getIdempotentBriefing(RM_ID, DATE);

      expect(rankSpy).not.toHaveBeenCalled();
      expect(getBriefingSpy).not.toHaveBeenCalled();
    });

    it('should cache ranked briefing with 24h TTL', async () => {
      await service.getIdempotentBriefing(RM_ID, DATE);

      expect(cacheMock.set).toHaveBeenCalledWith(
        `briefing:ranked:${RM_ID}:${DATE}`,
        expect.objectContaining({ briefing_id: `${RM_ID}-${DATE}` }),
        86400,
      );
    });

    it('should generate new briefing for different date', async () => {
      const DATE2 = '2026-03-11';

      const ranked1 = await service.getIdempotentBriefing(RM_ID, DATE);
      const ranked2 = await service.getIdempotentBriefing(RM_ID, DATE2);

      expect(ranked1.briefing_id).toBe(`${RM_ID}-${DATE}`);
      expect(ranked2.briefing_id).toBe(`${RM_ID}-${DATE2}`);
      expect(ranked1.briefing_id).not.toBe(ranked2.briefing_id);
    });
  });
});
