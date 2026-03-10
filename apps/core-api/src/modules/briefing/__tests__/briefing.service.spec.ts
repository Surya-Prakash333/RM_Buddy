import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { Meeting } from '../../../database/models/meeting.model';
import { AlertRecord } from '../../../database/models/alert.model';
import { Portfolio } from '../../../database/models/portfolio.model';
import { Transaction } from '../../../database/models/transaction.model';
import { Client } from '../../../database/models/client.model';
import { CacheService } from '../../cache/cache.service';
import { BriefingService } from '../briefing.service';
import { BriefingData } from '../dto/briefing.dto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';
const DATE = '2026-03-10';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/** CacheService mock — cache miss by default. */
const makeCacheMock = () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined),
});

/**
 * Minimal Mongoose Model mock that supports:
 *   model.find({}).lean().exec()
 *   model.find({}).sort({}).lean().exec()
 *   model.find({}).select('').lean().exec()
 *   model.aggregate([]).exec()
 */
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

const makeMeeting = (overrides: Partial<Record<string, unknown>> = {}) => ({
  meeting_id: 'mtg-001',
  rm_id: RM_ID,
  client_id: 'c-001',
  client_name: 'Rajesh Kumar',
  client_tier: 'HNI',
  scheduled_time: '10:00',
  duration_minutes: 60,
  agenda: 'Portfolio review',
  location: 'Office',
  ...overrides,
});

const makeAlert = (overrides: Partial<Record<string, unknown>> = {}) => ({
  alert_id: 'alert-001',
  alert_type: 'birthday',
  rm_id: RM_ID,
  client_name: 'Meena Sharma',
  severity: 'high',
  status: 'NEW',
  title: 'Birthday in 2 days',
  createdAt: new Date('2026-03-09T08:00:00Z'),
  ...overrides,
});

const makePortfolio = (clientId: string, totalAum: number, pnlPct: number) => ({
  client_id: clientId,
  rm_id: RM_ID,
  summary: { total_aum: totalAum },
  holdings: [{ pnl: totalAum * (pnlPct / 100), pnl_pct: pnlPct, current_value: totalAum }],
});

const makeClient = (clientId: string, name: string) => ({
  client_id: clientId,
  client_name: name,
  rm_id: RM_ID,
  tier: 'HNI',
  last_interaction: new Date('2026-01-01'),
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('BriefingService', () => {
  let service: BriefingService;
  let cacheMock: ReturnType<typeof makeCacheMock>;
  let meetingModelMock: ReturnType<typeof makeModelMock>;
  let alertModelMock: ReturnType<typeof makeModelMock>;
  let portfolioModelMock: ReturnType<typeof makeModelMock>;
  let transactionModelMock: ReturnType<typeof makeModelMock>;
  let clientModelMock: ReturnType<typeof makeModelMock>;

  /** Helper to (re)build the testing module with fresh mocks. */
  async function buildModule(overrides: {
    meetings?: unknown[];
    alerts?: unknown[];
    portfolios?: unknown[];
    clients?: unknown[];
    txnAggregate?: unknown[];
  } = {}): Promise<void> {
    cacheMock = makeCacheMock();
    meetingModelMock = makeModelMock(overrides.meetings ?? []);
    alertModelMock = makeModelMock(overrides.alerts ?? []);
    portfolioModelMock = makeModelMock(overrides.portfolios ?? []);
    transactionModelMock = makeModelMock([], overrides.txnAggregate ?? []);
    clientModelMock = makeModelMock(overrides.clients ?? []);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BriefingService,
        { provide: CacheService, useValue: cacheMock },
        { provide: getModelToken(Meeting.name), useValue: meetingModelMock },
        { provide: getModelToken(AlertRecord.name), useValue: alertModelMock },
        { provide: getModelToken(Portfolio.name), useValue: portfolioModelMock },
        { provide: getModelToken(Transaction.name), useValue: transactionModelMock },
        { provide: getModelToken(Client.name), useValue: clientModelMock },
      ],
    }).compile();

    service = module.get<BriefingService>(BriefingService);
  }

  beforeEach(async () => {
    await buildModule();
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // 1. All 5 sections present
  // -------------------------------------------------------------------------

  it('should return all 5 sections in briefing data', async () => {
    const briefing: BriefingData = await service.getBriefingData(RM_ID, DATE);

    expect(briefing).toMatchObject({
      rm_id: RM_ID,
      date: DATE,
    });

    expect(briefing).toHaveProperty('meetings_today');
    expect(briefing).toHaveProperty('pending_tasks');
    expect(briefing).toHaveProperty('active_alerts');
    expect(briefing).toHaveProperty('portfolio_summary');
    expect(briefing).toHaveProperty('revenue_ytd');

    // generated_at must be an ISO timestamp
    expect(briefing.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // -------------------------------------------------------------------------
  // 2. Promise.all parallelism
  // -------------------------------------------------------------------------

  it('should fetch all sections in parallel (Promise.all)', async () => {
    const fetchMeetingsSpy = jest.spyOn(service, 'fetchMeetingsToday');
    const fetchTasksSpy = jest.spyOn(service, 'fetchPendingTasks');
    const fetchAlertsSpy = jest.spyOn(service, 'fetchActiveAlerts');
    const fetchPortfolioSpy = jest.spyOn(service, 'fetchPortfolioSummary');
    const fetchRevenueSpy = jest.spyOn(service, 'fetchRevenueYTD');

    await service.getBriefingData(RM_ID, DATE);

    // Each section fetcher must be called exactly once per briefing
    expect(fetchMeetingsSpy).toHaveBeenCalledTimes(1);
    expect(fetchTasksSpy).toHaveBeenCalledTimes(1);
    expect(fetchAlertsSpy).toHaveBeenCalledTimes(1);
    expect(fetchPortfolioSpy).toHaveBeenCalledTimes(1);
    expect(fetchRevenueSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 3. Cache with 5-minute TTL
  // -------------------------------------------------------------------------

  it('should cache briefing with 5-min TTL', async () => {
    await service.getBriefingData(RM_ID, DATE);

    expect(cacheMock.set).toHaveBeenCalledWith(
      `briefing:${RM_ID}:${DATE}`,
      expect.objectContaining({ rm_id: RM_ID, date: DATE }),
      300,
    );
  });

  // -------------------------------------------------------------------------
  // 4. Cache hit — no DB calls
  // -------------------------------------------------------------------------

  it('should return cached briefing on subsequent calls', async () => {
    const cachedBriefing: BriefingData = {
      rm_id: RM_ID,
      date: DATE,
      generated_at: '2026-03-10T05:00:00.000Z',
      meetings_today: { count: 0, items: [] },
      pending_tasks: { count: 0, overdue: 0, items: [] },
      active_alerts: { count: 0, critical: 0, high: 0, items: [] },
      portfolio_summary: { total_aum: 0, aum_change_today: 0, top_gainers: [], top_losers: [] },
      revenue_ytd: { amount: 0, target: 0, achievement_pct: 0, vs_last_year: 0 },
    };

    cacheMock.get.mockResolvedValue(cachedBriefing);

    const result = await service.getBriefingData(RM_ID, DATE);

    expect(result).toEqual(cachedBriefing);
    // No DB queries should be fired
    expect(meetingModelMock.find).not.toHaveBeenCalled();
    expect(alertModelMock.find).not.toHaveBeenCalled();
    expect(portfolioModelMock.find).not.toHaveBeenCalled();
    expect(transactionModelMock.aggregate).not.toHaveBeenCalled();
    expect(clientModelMock.find).not.toHaveBeenCalled();
    // Cache.set must NOT be called again
    expect(cacheMock.set).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. Meetings sorted ascending by time
  // -------------------------------------------------------------------------

  it('should sort meetings by time ascending', async () => {
    const unsortedMeetings = [
      makeMeeting({ meeting_id: 'mtg-002', scheduled_time: '14:30' }),
      makeMeeting({ meeting_id: 'mtg-001', scheduled_time: '09:00' }),
      makeMeeting({ meeting_id: 'mtg-003', scheduled_time: '11:00' }),
    ];

    await buildModule({ meetings: unsortedMeetings });

    const result = await service.fetchMeetingsToday(RM_ID, DATE);

    expect(result.items[0].time).toBe('09:00');
    expect(result.items[1].time).toBe('11:00');
    expect(result.items[2].time).toBe('14:30');
  });

  // -------------------------------------------------------------------------
  // 6. Tasks marked overdue
  // -------------------------------------------------------------------------

  it('should mark tasks as overdue when past due_date', async () => {
    // A client whose last_interaction was 60 days ago makes the follow-up
    // due date fall 30 days after that (i.e. 30 days in the past) → overdue.
    const sixtyDaysAgo = new Date(DATE);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const overdueClient = makeClient('c-overdue', 'Late Client');
    (overdueClient as Record<string, unknown>).last_interaction = sixtyDaysAgo;

    await buildModule({ clients: [overdueClient] });

    const result = await service.fetchPendingTasks(RM_ID, DATE);

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].is_overdue).toBe(true);
    expect(result.overdue).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 7. Top 3 gainers and losers sorted by change_pct
  // -------------------------------------------------------------------------

  it('should return top 3 gainers and losers sorted by change_pct', async () => {
    const portfolios = [
      makePortfolio('c-001', 1_000_000, 5.0),   // gainer
      makePortfolio('c-002', 2_000_000, 12.0),  // best gainer
      makePortfolio('c-003', 1_500_000, 3.0),   // gainer
      makePortfolio('c-004', 1_200_000, -2.0),  // loser
      makePortfolio('c-005', 800_000, -8.0),    // worst loser
      makePortfolio('c-006', 900_000, -4.0),    // loser
    ];

    // Client name enrichment mock — portfolio model returns portfolios,
    // client model returns names for the mover client IDs.
    const clientDocs = [
      { client_id: 'c-002', client_name: 'Top Gainer' },
      { client_id: 'c-001', client_name: 'Second Gainer' },
      { client_id: 'c-003', client_name: 'Third Gainer' },
      { client_id: 'c-005', client_name: 'Worst Loser' },
      { client_id: 'c-006', client_name: 'Second Loser' },
      { client_id: 'c-004', client_name: 'Third Loser' },
    ];

    portfolioModelMock = makeModelMock(portfolios);
    clientModelMock = makeModelMock(clientDocs);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BriefingService,
        { provide: CacheService, useValue: cacheMock },
        { provide: getModelToken(Meeting.name), useValue: meetingModelMock },
        { provide: getModelToken(AlertRecord.name), useValue: alertModelMock },
        { provide: getModelToken(Portfolio.name), useValue: portfolioModelMock },
        { provide: getModelToken(Transaction.name), useValue: transactionModelMock },
        { provide: getModelToken(Client.name), useValue: clientModelMock },
      ],
    }).compile();

    service = module.get<BriefingService>(BriefingService);

    const result = await service.fetchPortfolioSummary(RM_ID);

    // Gainers sorted descending by change_pct
    expect(result.top_gainers).toHaveLength(3);
    expect(result.top_gainers[0].change_pct).toBeGreaterThan(result.top_gainers[1].change_pct);
    expect(result.top_gainers[1].change_pct).toBeGreaterThan(result.top_gainers[2].change_pct);

    // Losers sorted: worst loss first (most negative)
    expect(result.top_losers).toHaveLength(3);
    expect(result.top_losers[0].change_pct).toBeLessThan(result.top_losers[1].change_pct);
    expect(result.top_losers[1].change_pct).toBeLessThan(result.top_losers[2].change_pct);

    // All losers must be negative
    result.top_losers.forEach((l) => expect(l.change_pct).toBeLessThan(0));
  });

  // -------------------------------------------------------------------------
  // Bonus: Revenue YTD aggregation
  // -------------------------------------------------------------------------

  it('should sum brokerage from Executed transactions for YTD revenue', async () => {
    transactionModelMock = makeModelMock([], [{ _id: null, total: 150_000 }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BriefingService,
        { provide: CacheService, useValue: cacheMock },
        { provide: getModelToken(Meeting.name), useValue: meetingModelMock },
        { provide: getModelToken(AlertRecord.name), useValue: alertModelMock },
        { provide: getModelToken(Portfolio.name), useValue: portfolioModelMock },
        { provide: getModelToken(Transaction.name), useValue: transactionModelMock },
        { provide: getModelToken(Client.name), useValue: clientModelMock },
      ],
    }).compile();

    service = module.get<BriefingService>(BriefingService);

    const result = await service.fetchRevenueYTD(RM_ID, DATE);

    expect(result.amount).toBe(150_000);
    expect(result.target).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Bonus: Active alerts count critical and high
  // -------------------------------------------------------------------------

  it('should count critical and high alerts separately', async () => {
    const alerts = [
      makeAlert({ alert_id: 'a-1', severity: 'critical' }),
      makeAlert({ alert_id: 'a-2', severity: 'high' }),
      makeAlert({ alert_id: 'a-3', severity: 'high' }),
      makeAlert({ alert_id: 'a-4', severity: 'medium' }),
    ];

    await buildModule({ alerts });

    const result = await service.fetchActiveAlerts(RM_ID);

    expect(result.count).toBe(4);
    expect(result.critical).toBe(1);
    expect(result.high).toBe(2);
  });
});
