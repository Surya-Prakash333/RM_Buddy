import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { Client } from '../../../database/models/client.model';
import { AlertRecord } from '../../../database/models/alert.model';
import { Meeting } from '../../../database/models/meeting.model';
import { Portfolio } from '../../../database/models/portfolio.model';
import { REDIS_CLIENT } from '../../cache/cache.service';

import { SearchService } from '../search.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RM_ID = 'rm-001';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeClientDoc = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  client_id: 'client-001',
  client_name: 'Priya Sharma',
  tier: 'PLATINUM',
  total_aum: 5_000_000,
  last_interaction: new Date('2025-01-15'),
  rm_id: RM_ID,
  score: 1.5,
  ...overrides,
});

const makeAlertDoc = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  alert_id: 'alert-001',
  title: 'Portfolio Drawdown Alert',
  message: 'Portfolio drawdown exceeded 10%',
  client_name: 'Priya Sharma',
  severity: 'HIGH',
  status: 'NEW',
  rm_id: RM_ID,
  score: 1.2,
  ...overrides,
});

const makeMeetingDoc = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  meeting_id: 'meeting-001',
  client_name: 'Priya Sharma',
  agenda: 'Portfolio review',
  notes: 'Discussed rebalancing',
  scheduled_date: new Date('2025-02-10'),
  rm_id: RM_ID,
  score: 1.0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const makeQueryChain = (docs: unknown[]) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(docs),
});

const makeModelMock = (docs: unknown[] = []) => ({
  find: jest.fn().mockReturnValue(makeQueryChain(docs)),
  findOne: jest.fn().mockReturnValue({
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(null),
  }),
});

const makeRedisMock = () => ({
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
  ping: jest.fn().mockResolvedValue('PONG'),
  hget: jest.fn().mockResolvedValue(null),
  hset: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SearchService', () => {
  let service: SearchService;
  let clientModelMock: ReturnType<typeof makeModelMock>;
  let alertModelMock: ReturnType<typeof makeModelMock>;
  let meetingModelMock: ReturnType<typeof makeModelMock>;
  let portfolioModelMock: ReturnType<typeof makeModelMock>;
  let redisMock: ReturnType<typeof makeRedisMock>;

  beforeEach(async () => {
    clientModelMock = makeModelMock([makeClientDoc()]);
    alertModelMock = makeModelMock([makeAlertDoc()]);
    meetingModelMock = makeModelMock([makeMeetingDoc()]);
    portfolioModelMock = makeModelMock([]);
    redisMock = makeRedisMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: getModelToken(Client.name), useValue: clientModelMock },
        { provide: getModelToken(AlertRecord.name), useValue: alertModelMock },
        { provide: getModelToken(Meeting.name), useValue: meetingModelMock },
        { provide: getModelToken(Portfolio.name), useValue: portfolioModelMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  // -------------------------------------------------------------------------
  // searchAll
  // -------------------------------------------------------------------------

  it('should return client search hits from MongoDB text search', async () => {
    const result = await service.searchAll({ rm_id: RM_ID, query: 'Sharma' });

    expect(result.clients).toHaveLength(1);
    expect(result.clients[0].client_name).toBe('Priya Sharma');
    expect(result.clients[0].client_id).toBe('client-001');
    expect(result.clients[0].score).toBe(1.5);
  });

  it('should search across multiple collections simultaneously', async () => {
    const result = await service.searchAll({ rm_id: RM_ID, query: 'Sharma' });

    expect(result.clients).toHaveLength(1);
    expect(result.alerts).toHaveLength(1);
    expect(result.meetings).toHaveLength(1);
    expect(result.total).toBe(3);
    expect(result.took_ms).toBeGreaterThanOrEqual(0);
  });

  it('should include took_ms in result', async () => {
    const result = await service.searchAll({ rm_id: RM_ID, query: 'Priya' });
    expect(typeof result.took_ms).toBe('number');
  });

  // -------------------------------------------------------------------------
  // findClientByName — Redis fast path
  // -------------------------------------------------------------------------

  it('should use Redis lookup for fast client name lookup (<200ms)', async () => {
    redisMock.hget.mockResolvedValueOnce('client-001');
    clientModelMock.findOne.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(makeClientDoc()),
    });

    const start = Date.now();
    const result = await service.findClientByName(RM_ID, 'Priya Sharma');
    const elapsed = Date.now() - start;

    expect(result).not.toBeNull();
    expect(result!.client_id).toBe('client-001');
    expect(redisMock.hget).toHaveBeenCalledWith(`lookup:rm:${RM_ID}:clients`, 'priya sharma');
    expect(elapsed).toBeLessThan(200);
  });

  // -------------------------------------------------------------------------
  // findClientByName — MongoDB fallback
  // -------------------------------------------------------------------------

  it('should fall back to MongoDB when Redis lookup misses', async () => {
    redisMock.hget.mockResolvedValueOnce(null); // Redis miss
    clientModelMock.find.mockReturnValue(makeQueryChain([makeClientDoc()]));

    const result = await service.findClientByName(RM_ID, 'Priya Sharma');

    expect(redisMock.hget).toHaveBeenCalledTimes(1);
    expect(clientModelMock.find).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.client_name).toBe('Priya Sharma');
  });

  it('should update Redis lookup map after MongoDB fallback resolves a client', async () => {
    redisMock.hget.mockResolvedValueOnce(null);
    clientModelMock.find.mockReturnValue(makeQueryChain([makeClientDoc()]));

    await service.findClientByName(RM_ID, 'Priya Sharma');

    expect(redisMock.hset).toHaveBeenCalledWith(
      `lookup:rm:${RM_ID}:clients`,
      'priya sharma',
      'client-001',
    );
  });

  // -------------------------------------------------------------------------
  // fuzzyScore / fuzzyFilter
  // -------------------------------------------------------------------------

  it('should fuzzy match "Sharma" with "Priya Sharma"', () => {
    const score = service.fuzzyScore('Sharma', 'Priya Sharma');
    // "Priya Sharma".includes("sharma") case-insensitively => 0.95
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it('should NOT match completely unrelated strings', () => {
    const score = service.fuzzyScore('Sharma', 'xyz123');
    expect(score).toBeLessThan(0.7);
  });

  it('should return matching candidates via fuzzyFilter', () => {
    const candidates = ['Priya Sharma', 'Ravi Kumar', 'Anjali Sharma', 'Xyz Abc'];
    const matches = service.fuzzyFilter('Sharma', candidates);
    expect(matches).toContain('Priya Sharma');
    expect(matches).toContain('Anjali Sharma');
    expect(matches).not.toContain('Xyz Abc');
  });

  // -------------------------------------------------------------------------
  // buildLookupMaps
  // -------------------------------------------------------------------------

  it('should build lookup maps as Redis HASH with name and PAN fields', async () => {
    const clients = [
      makeClientDoc({ client_id: 'c-001', client_name: 'Priya Sharma', pan: 'ABCDE1234F' }),
      makeClientDoc({ client_id: 'c-002', client_name: 'Ravi Kumar', pan: 'XYZPQ5678G' }),
    ];
    clientModelMock.find.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(clients),
    });

    await service.buildLookupMaps(RM_ID);

    expect(redisMock.hset).toHaveBeenCalledWith(
      `lookup:rm:${RM_ID}:clients`,
      'priya sharma',
      'c-001',
      'ravi kumar',
      'c-002',
    );
    expect(redisMock.expire).toHaveBeenCalledWith(`lookup:rm:${RM_ID}:clients`, 3600);
  });

  it('should skip building maps when no clients exist for the RM', async () => {
    clientModelMock.find.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });

    await service.buildLookupMaps(RM_ID);

    expect(redisMock.hset).not.toHaveBeenCalled();
  });
});
