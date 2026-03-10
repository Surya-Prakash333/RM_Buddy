/**
 * PerformanceService unit tests — S1-F33-L1-Data & S1-F33-L2-Logic
 *
 * Tests:
 *   - RM percentile computation vs peers
 *   - Top-3 dimension identification as strengths
 *   - coaching_note present for each strength
 *   - Metrics cached with 1 h TTL
 *   - overall_percentile computed correctly
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PerformanceService, STRENGTH_DIMENSIONS } from '../performance.service';
import { CacheService } from '../../cache/cache.service';
import { Client } from '../../../database/models/client.model';
import { Meeting } from '../../../database/models/meeting.model';
import { Transaction } from '../../../database/models/transaction.model';
import { Portfolio } from '../../../database/models/portfolio.model';
import { RMPerformanceMetrics } from '../dto/performance.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<RMPerformanceMetrics> = {}): RMPerformanceMetrics {
  return {
    rm_id: 'rm-001',
    rm_name: 'rm-001',
    branch: 'BKC',
    period: '2024-01',
    total_meetings: 20,
    total_calls: 10,
    client_visits: 5,
    gross_sales: 5_000_000,
    aum_growth: 200_000,
    aum_growth_pct: 4,
    revenue_generated: 50_000,
    total_clients: 15,
    diamond_clients: 2,
    platinum_clients: 5,
    new_clients_added: 3,
    client_retention_rate: 80,
    avg_portfolio_return: 12,
    products_per_client: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factory: returns a Mongoose Model-like object
// ---------------------------------------------------------------------------

function makeMockModel() {
  return {
    aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    distinct: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PerformanceService', () => {
  let service: PerformanceService;

  let cacheGetMock: jest.Mock;
  let cacheSetMock: jest.Mock;

  let clientModel: ReturnType<typeof makeMockModel>;
  let meetingModel: ReturnType<typeof makeMockModel>;
  let transactionModel: ReturnType<typeof makeMockModel>;
  let portfolioModel: ReturnType<typeof makeMockModel>;

  beforeEach(async () => {
    cacheGetMock = jest.fn().mockResolvedValue(null);
    cacheSetMock = jest.fn().mockResolvedValue(undefined);

    clientModel = makeMockModel();
    meetingModel = makeMockModel();
    transactionModel = makeMockModel();
    portfolioModel = makeMockModel();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceService,
        {
          provide: getModelToken(Client.name),
          useValue: clientModel,
        },
        {
          provide: getModelToken(Meeting.name),
          useValue: meetingModel,
        },
        {
          provide: getModelToken(Transaction.name),
          useValue: transactionModel,
        },
        {
          provide: getModelToken(Portfolio.name),
          useValue: portfolioModel,
        },
        {
          provide: CacheService,
          useValue: {
            get: cacheGetMock,
            set: cacheSetMock,
          },
        },
      ],
    }).compile();

    service = module.get<PerformanceService>(PerformanceService);
  });

  // -------------------------------------------------------------------------
  // Helper to spy on private methods
  // -------------------------------------------------------------------------

  function spyMetrics(rmMetrics: RMPerformanceMetrics, peerList: RMPerformanceMetrics[]) {
    jest
      .spyOn(service, 'getPerformanceMetrics')
      .mockResolvedValue(rmMetrics);
    jest
      .spyOn(service, 'getPeerMetrics')
      .mockResolvedValue(peerList);
  }

  // -------------------------------------------------------------------------
  // 1. RM percentile computation vs peers
  // -------------------------------------------------------------------------

  it('should compute RM percentile correctly vs peers', async () => {
    // RM has total_meetings = 20; peers have [5, 10, 15] → RM is above all 3
    const rmMetrics = makeMetrics({ rm_id: 'rm-001', total_meetings: 20 });
    const peers = [
      makeMetrics({ rm_id: 'rm-001', total_meetings: 20 }),
      makeMetrics({ rm_id: 'rm-002', total_meetings: 5 }),
      makeMetrics({ rm_id: 'rm-003', total_meetings: 10 }),
      makeMetrics({ rm_id: 'rm-004', total_meetings: 15 }),
    ];

    spyMetrics(rmMetrics, peers);

    const report = await service.identifyStrengths('rm-001', 'BKC', '2024-01');

    // client_relationships dimension uses total_meetings
    const crStrength = [...report.strengths, ...report.growth_areas].find(
      (s) => s.dimension === 'client_relationships',
    );

    expect(crStrength).toBeDefined();
    const meetingsMetric = crStrength!.key_metrics.find((m) => m.name === 'total_meetings');
    expect(meetingsMetric).toBeDefined();
    // RM is above peers[1,2,3] (3 out of 3 peers below) → 3/3 * 100 = 100
    expect(meetingsMetric!.percentile).toBe(100);
  });

  // -------------------------------------------------------------------------
  // 2. Top-3 dimensions identified as strengths
  // -------------------------------------------------------------------------

  it('should identify top 3 dimensions as strengths', async () => {
    // RM excels at meetings, gross_sales, revenue — client_relationships,
    // business_development, revenue_generation should be top 3
    const rmMetrics = makeMetrics({
      total_meetings: 40,
      client_retention_rate: 95,
      gross_sales: 10_000_000,
      new_clients_added: 10,
      revenue_generated: 200_000,
      avg_portfolio_return: 5,    // low
      aum_growth_pct: 1,          // low
      products_per_client: 1,     // low
    });

    // Build 4 peers that are all weaker in the strong dimensions
    const peers = [rmMetrics, ...Array.from({ length: 4 }, (_, i) =>
      makeMetrics({
        rm_id: `rm-00${i + 2}`,
        total_meetings: 10,
        client_retention_rate: 60,
        gross_sales: 1_000_000,
        new_clients_added: 1,
        revenue_generated: 10_000,
        avg_portfolio_return: 8,
        aum_growth_pct: 3,
        products_per_client: 2,
      }),
    )];

    spyMetrics(rmMetrics, peers);

    const report = await service.identifyStrengths('rm-001', 'BKC', '2024-01');

    expect(report.strengths).toHaveLength(3);
    expect(report.growth_areas).toHaveLength(2);

    const strengthDimensions = report.strengths.map((s) => s.dimension);
    expect(strengthDimensions).toContain('client_relationships');
    expect(strengthDimensions).toContain('business_development');
    expect(strengthDimensions).toContain('revenue_generation');
  });

  // -------------------------------------------------------------------------
  // 3. coaching_note present for each strength
  // -------------------------------------------------------------------------

  it('should return coaching_note for each strength', async () => {
    const rmMetrics = makeMetrics();
    const peers = [rmMetrics, makeMetrics({ rm_id: 'rm-002' })];
    spyMetrics(rmMetrics, peers);

    const report = await service.identifyStrengths('rm-001', 'BKC', '2024-01');

    for (const strength of report.strengths) {
      expect(typeof strength.coaching_note).toBe('string');
      expect(strength.coaching_note.length).toBeGreaterThan(0);
    }

    for (const area of report.growth_areas) {
      expect(typeof area.coaching_note).toBe('string');
      expect(area.coaching_note.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Metrics cached with 1 h TTL
  // -------------------------------------------------------------------------

  it('should cache metrics with 1h TTL', async () => {
    // Stub DB aggregations to return empty (zeroed metrics)
    clientModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });
    meetingModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });
    transactionModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });
    portfolioModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });
    clientModel.distinct.mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });

    // Cache miss → should call set
    cacheGetMock.mockResolvedValue(null);

    await service.getPerformanceMetrics('rm-001', '2024-01');

    expect(cacheSetMock).toHaveBeenCalledWith(
      'perf:metrics:rm-001:2024-01',
      expect.anything(),
      3600,
    );
  });

  // -------------------------------------------------------------------------
  // 5. overall_percentile computed correctly
  // -------------------------------------------------------------------------

  it('should compute overall_percentile correctly', async () => {
    // RM is exactly at median across all metrics → overall percentile ≈ 50
    const baseVal = 10;
    const rmMetrics = makeMetrics({
      total_meetings: baseVal,
      total_calls: baseVal,
      client_visits: baseVal,
      gross_sales: baseVal,
      aum_growth_pct: baseVal,
      revenue_generated: baseVal,
      client_retention_rate: baseVal,
      avg_portfolio_return: baseVal,
      products_per_client: baseVal,
      new_clients_added: baseVal,
    });

    // Create peers where half have lower values and half have higher
    const lower = makeMetrics({
      rm_id: 'rm-low',
      total_meetings: 5,
      total_calls: 5,
      client_visits: 5,
      gross_sales: 5,
      aum_growth_pct: 5,
      revenue_generated: 5,
      client_retention_rate: 5,
      avg_portfolio_return: 5,
      products_per_client: 5,
      new_clients_added: 5,
    });
    const higher = makeMetrics({
      rm_id: 'rm-high',
      total_meetings: 20,
      total_calls: 20,
      client_visits: 20,
      gross_sales: 20,
      aum_growth_pct: 20,
      revenue_generated: 20,
      client_retention_rate: 20,
      avg_portfolio_return: 20,
      products_per_client: 20,
      new_clients_added: 20,
    });

    spyMetrics(rmMetrics, [rmMetrics, lower, higher]);

    const report = await service.identifyStrengths('rm-001', 'BKC', '2024-01');

    // With symmetric peers, overall percentile should be roughly 50
    expect(report.overall_percentile).toBeGreaterThanOrEqual(40);
    expect(report.overall_percentile).toBeLessThanOrEqual(60);
  });

  // -------------------------------------------------------------------------
  // 6. STRENGTH_DIMENSIONS configuration sanity check
  // -------------------------------------------------------------------------

  it('should have 5 configured strength dimensions', () => {
    expect(Object.keys(STRENGTH_DIMENSIONS)).toHaveLength(5);
    for (const [, dim] of Object.entries(STRENGTH_DIMENSIONS)) {
      expect(dim.label).toBeTruthy();
      expect(dim.metrics.length).toBeGreaterThan(0);
      expect(dim.weight).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Cache hit path returns cached data without hitting DB
  // -------------------------------------------------------------------------

  it('should return cached metrics on cache hit without DB query', async () => {
    const cached = makeMetrics({ rm_id: 'rm-001' });
    cacheGetMock.mockResolvedValue(cached);

    const result = await service.getPerformanceMetrics('rm-001', '2024-01');

    expect(result).toEqual(cached);
    // DB should NOT have been called
    expect(clientModel.aggregate).not.toHaveBeenCalled();
  });
});
