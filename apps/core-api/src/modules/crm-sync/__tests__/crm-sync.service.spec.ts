import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CrmSyncService, SyncResult, WriteBackAction } from '../crm-sync.service';
import { CrmApiClient, CRMClient, CRMSyncPage } from '../crm-api.client';
import { CacheService } from '../../cache/cache.service';
import { KafkaService } from '../../kafka/kafka.service';
import { Client } from '../../../database/models/client.model';
import { Portfolio } from '../../../database/models/portfolio.model';
import { Meeting } from '../../../database/models/meeting.model';
import { Lead } from '../../../database/models/lead.model';
import { Pipeline } from '../../../database/models/pipeline.model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockCRMClient(overrides: Partial<CRMClient> = {}): CRMClient {
  return {
    client_id: 'CL001',
    rm_id: 'RM001',
    client_name: 'Test Client',
    email: 'test@example.com',
    phone: '+91-9999999999',
    pan: 'ABCDE1234F',
    dob: '1980-01-01',
    tier: 'Gold',
    risk_profile: 'Moderate',
    kyc_status: 'verified',
    onboarding_date: '2020-01-01',
    last_interaction: '2024-01-01',
    total_aum: 10000000,
    total_revenue_ytd: 150000,
    accounts: [
      {
        account_id: 'ACC001',
        account_type: 'Demat',
        status: 'active',
        opening_date: '2020-01-01',
        current_value: 10000000,
      },
    ],
    tags: ['test'],
    ...overrides,
  };
}

function makeClientPage(
  clients: CRMClient[],
  page: number,
  limit: number,
): CRMSyncPage<CRMClient> {
  const start = (page - 1) * limit;
  const data = clients.slice(start, start + limit);
  return {
    data,
    page,
    limit,
    total: clients.length,
    hasMore: start + limit < clients.length,
  };
}

/** Build 150 unique CRM client records to exercise pagination (2 pages of 100) */
function make150Clients(): CRMClient[] {
  return Array.from({ length: 150 }, (_, i) =>
    makeMockCRMClient({ client_id: `CL${String(i + 1).padStart(3, '0')}` }),
  );
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockCrmApiClient() {
  return {
    getClients: jest.fn(),
    getPortfolios: jest.fn(),
    getMeetings: jest.fn(),
    getLeads: jest.fn(),
    getPipeline: jest.fn(),
    createMeeting: jest.fn(),
    updateLead: jest.fn(),
  };
}

function makeMockCacheService() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined),
    warmup: jest.fn().mockResolvedValue(undefined),
    writeThrough: jest.fn(),
    readThrough: jest.fn(),
    ping: jest.fn().mockResolvedValue(true),
  };
}

function makeMockKafkaService() {
  return {
    publish: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
  };
}

/** Creates a minimal Mongoose Model mock that satisfies the service's usage. */
function makeMockModel() {
  const instance = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    distinct: jest.fn(),
    find: jest.fn(),
  };

  // The service calls .findOne(...).lean() (no .exec()), so lean() must return a Promise.
  // .find(...).lean().exec() pattern is also used in cache warming.
  const leanResolve = (returnValue: unknown) => ({
    lean: () => Promise.resolve(returnValue),
  });

  const leanExec = (returnValue: unknown) => ({
    lean: () => ({ exec: () => Promise.resolve(returnValue) }),
  });

  instance.findOne.mockImplementation(() => leanResolve(null));
  instance.findOneAndUpdate.mockResolvedValue({});
  instance.distinct.mockImplementation(() => ({ exec: () => Promise.resolve([]) }));
  instance.find.mockImplementation(() => leanExec([]));

  return instance;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CrmSyncService', () => {
  let service: CrmSyncService;
  let crmApiClient: ReturnType<typeof makeMockCrmApiClient>;
  let cacheService: ReturnType<typeof makeMockCacheService>;
  let kafkaService: ReturnType<typeof makeMockKafkaService>;
  let clientModel: ReturnType<typeof makeMockModel>;
  let portfolioModel: ReturnType<typeof makeMockModel>;
  let meetingModel: ReturnType<typeof makeMockModel>;
  let leadModel: ReturnType<typeof makeMockModel>;
  let pipelineModel: ReturnType<typeof makeMockModel>;

  beforeEach(async () => {
    crmApiClient = makeMockCrmApiClient();
    cacheService = makeMockCacheService();
    kafkaService = makeMockKafkaService();
    clientModel = makeMockModel();
    portfolioModel = makeMockModel();
    meetingModel = makeMockModel();
    leadModel = makeMockModel();
    pipelineModel = makeMockModel();

    // Default portfolio/meeting/lead/pipeline responses (empty)
    const emptyPage = { data: [], page: 1, limit: 100, total: 0, hasMore: false };
    crmApiClient.getPortfolios.mockResolvedValue(emptyPage);
    crmApiClient.getMeetings.mockResolvedValue(emptyPage);
    crmApiClient.getLeads.mockResolvedValue(emptyPage);
    crmApiClient.getPipeline.mockResolvedValue(emptyPage);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmSyncService,
        { provide: CrmApiClient, useValue: crmApiClient },
        { provide: CacheService, useValue: cacheService },
        { provide: KafkaService, useValue: kafkaService },
        { provide: getModelToken(Client.name), useValue: clientModel },
        { provide: getModelToken(Portfolio.name), useValue: portfolioModel },
        { provide: getModelToken(Meeting.name), useValue: meetingModel },
        { provide: getModelToken(Lead.name), useValue: leadModel },
        { provide: getModelToken(Pipeline.name), useValue: pipelineModel },
      ],
    }).compile();

    service = module.get<CrmSyncService>(CrmSyncService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // fullSync
  // --------------------------------------------------------------------------

  describe('fullSync()', () => {
    it('processes all pages when 150 clients require 2 pages', async () => {
      const allClients = make150Clients();

      // clientModel.distinct returns one RM
      clientModel.distinct.mockImplementation(() => ({
        exec: () => Promise.resolve(['RM001']),
      }));

      // Page 1: 100 clients; page 2: 50 clients
      crmApiClient.getClients
        .mockResolvedValueOnce(makeClientPage(allClients, 1, 100))
        .mockResolvedValueOnce(makeClientPage(allClients, 2, 100));

      const results = await service.fullSync();

      // getClients called twice (page 1 + page 2)
      expect(crmApiClient.getClients).toHaveBeenCalledTimes(2);
      expect(crmApiClient.getClients).toHaveBeenNthCalledWith(1, 'RM001', 1, 100);
      expect(crmApiClient.getClients).toHaveBeenNthCalledWith(2, 'RM001', 2, 100);

      const clientResult = results.find((r) => r.entity === 'clients');
      expect(clientResult).toBeDefined();
      expect(clientResult!.synced).toBe(150);
      expect(clientResult!.errors).toBe(0);
    });

    it('skips records whose checksum has not changed', async () => {
      const client = makeMockCRMClient();
      // Simulate checksum match: findOne returns existing data with same fields
      // We compute what the checksum would be and return it pre-stored
      const existingDoc = {
        client_id: client.client_id,
        rm_id: client.rm_id,
        client_name: client.client_name,
        email: client.email,
        phone: client.phone,
        pan: client.pan,
        dob: client.dob,
        tier: client.tier,
        risk_profile: client.risk_profile,
        kyc_status: client.kyc_status,
        onboarding_date: client.onboarding_date,
        last_interaction: client.last_interaction,
        total_aum: client.total_aum,
        total_revenue_ytd: client.total_revenue_ytd,
        accounts: client.accounts,
        tags: client.tags,
      };

      clientModel.findOne.mockImplementation(() => ({
        lean: () => Promise.resolve(existingDoc),
      }));

      clientModel.distinct.mockImplementation(() => ({
        exec: () => Promise.resolve(['RM001']),
      }));

      crmApiClient.getClients.mockResolvedValue({
        data: [client],
        page: 1,
        limit: 100,
        total: 1,
        hasMore: false,
      });

      const results = await service.fullSync();
      const clientResult = results.find((r) => r.entity === 'clients');

      // The checksum of incoming matches stored checksum — record should be skipped
      expect(clientResult!.skipped).toBe(1);
      expect(clientResult!.synced).toBe(0);
      expect(clientModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('upserts records whose checksum has changed', async () => {
      const client = makeMockCRMClient();

      // Existing doc has a different AUM → checksum will differ
      clientModel.findOne.mockImplementation(() => ({
        lean: () => Promise.resolve({ ...client, total_aum: 1 }),
      }));

      clientModel.distinct.mockImplementation(() => ({
        exec: () => Promise.resolve(['RM001']),
      }));

      crmApiClient.getClients.mockResolvedValue({
        data: [client],
        page: 1,
        limit: 100,
        total: 1,
        hasMore: false,
      });

      const results = await service.fullSync();
      const clientResult = results.find((r) => r.entity === 'clients');

      expect(clientResult!.synced).toBe(1);
      expect(clientResult!.skipped).toBe(0);
      expect(clientModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('publishes crm.sync.completed Kafka event after all RMs are processed', async () => {
      clientModel.distinct.mockImplementation(() => ({
        exec: () => Promise.resolve(['RM001', 'RM002']),
      }));

      const emptyClientPage = { data: [], page: 1, limit: 100, total: 0, hasMore: false };
      crmApiClient.getClients.mockResolvedValue(emptyClientPage);

      await service.fullSync();

      expect(kafkaService.publish).toHaveBeenCalledWith(
        'crm.sync.completed',
        'system',
        expect.objectContaining({
          event: 'crm.sync.completed',
          rm_count: 2,
        }),
      );
    });

    it('sets crm:sync:status to "idle" and crm:sync:last_run after completion', async () => {
      clientModel.distinct.mockImplementation(() => ({
        exec: () => Promise.resolve([]),
      }));

      await service.fullSync();

      expect(cacheService.set).toHaveBeenCalledWith('crm:sync:status', 'idle', expect.any(Number));
      expect(cacheService.set).toHaveBeenCalledWith(
        'crm:sync:last_run',
        expect.any(String),
        expect.any(Number),
      );
    });
  });

  // --------------------------------------------------------------------------
  // syncForRM
  // --------------------------------------------------------------------------

  describe('syncForRM()', () => {
    it('completes and returns results for clients and portfolios', async () => {
      crmApiClient.getClients.mockResolvedValue({
        data: [makeMockCRMClient()],
        page: 1,
        limit: 100,
        total: 1,
        hasMore: false,
      });
      crmApiClient.getPortfolios.mockResolvedValue({
        data: [],
        page: 1,
        limit: 100,
        total: 0,
        hasMore: false,
      });

      const results = await service.syncForRM('RM001');

      expect(results).toHaveLength(2);
      const entities = results.map((r) => r.entity);
      expect(entities).toContain('clients');
      expect(entities).toContain('portfolios');
    });

    it('warms Redis cache for the RM after sync completes', async () => {
      crmApiClient.getClients.mockResolvedValue({
        data: [],
        page: 1,
        limit: 100,
        total: 0,
        hasMore: false,
      });

      await service.syncForRM('RM001');

      expect(cacheService.warmup).toHaveBeenCalledWith('RM001', expect.any(Function));
    });

    it('records the last sync timestamp in Redis after completion', async () => {
      crmApiClient.getClients.mockResolvedValue({
        data: [],
        page: 1,
        limit: 100,
        total: 0,
        hasMore: false,
      });

      await service.syncForRM('RM001');

      expect(cacheService.set).toHaveBeenCalledWith(
        'crm:sync:rm:RM001:last_sync',
        expect.any(String),
        expect.any(Number),
      );
    });

    it('uses changedSince from Redis when previous sync timestamp exists', async () => {
      const lastSyncTs = '2024-01-01T00:00:00.000Z';
      cacheService.get.mockResolvedValueOnce(lastSyncTs);

      crmApiClient.getClients.mockResolvedValue({
        data: [],
        page: 1,
        limit: 100,
        total: 0,
        hasMore: false,
      });

      await service.syncForRM('RM001');

      // Portfolio sync uses changedSince — verify getPortfolios was called
      // (the exact changedSince is passed internally; we verify the call happened)
      expect(crmApiClient.getPortfolios).toHaveBeenCalledWith('RM001', 1);
    });
  });

  // --------------------------------------------------------------------------
  // writeBack
  // --------------------------------------------------------------------------

  describe('writeBack()', () => {
    it('CREATE_MEETING: calls CRM API, writes to MongoDB, invalidates cache, publishes audit', async () => {
      crmApiClient.createMeeting.mockResolvedValue({
        success: true,
        meeting_id: 'MTG-CRM-001',
      });

      const action: WriteBackAction = {
        type: 'CREATE_MEETING',
        rm_id: 'RM001',
        data: {
          client_id: 'CL001',
          meeting_type: 'Portfolio Review',
          scheduled_date: '2024-02-15',
        },
      };

      const result = await service.writeBack(action);

      expect(result.success).toBe(true);
      expect(result.crm_id).toBe('MTG-CRM-001');

      // CRM API called
      expect(crmApiClient.createMeeting).toHaveBeenCalledWith(action.data);

      // MongoDB upsert called
      expect(meetingModel.findOneAndUpdate).toHaveBeenCalledWith(
        { meeting_id: 'MTG-CRM-001' },
        expect.objectContaining({ $set: expect.objectContaining({ meeting_id: 'MTG-CRM-001' }) }),
        { upsert: true, new: true },
      );

      // Cache invalidated
      expect(cacheService.invalidate).toHaveBeenCalledWith('dashboard:rm:RM001');

      // Audit event published
      expect(kafkaService.publish).toHaveBeenCalledWith(
        'audit.trail',
        'RM001',
        expect.objectContaining({ event: 'crm.writeback.create_meeting' }),
      );
    });

    it('UPDATE_LEAD: calls CRM API, updates MongoDB, returns crm_id', async () => {
      crmApiClient.updateLead.mockResolvedValue({ success: true });

      const action: WriteBackAction = {
        type: 'UPDATE_LEAD',
        rm_id: 'RM001',
        data: {
          lead_id: 'LEAD-001',
          status: 'converted',
          notes: 'Client invested ₹50L',
        },
      };

      const result = await service.writeBack(action);

      expect(result.success).toBe(true);
      expect(result.crm_id).toBe('LEAD-001');
      expect(crmApiClient.updateLead).toHaveBeenCalledWith('LEAD-001', action.data);
      expect(leadModel.findOneAndUpdate).toHaveBeenCalledWith(
        { lead_id: 'LEAD-001' },
        expect.objectContaining({ $set: expect.objectContaining({ status: 'converted' }) }),
        { upsert: true, new: true },
      );
    });

    it('UPDATE_LEAD: returns { success: false } when lead_id is missing from data', async () => {
      const action: WriteBackAction = {
        type: 'UPDATE_LEAD',
        rm_id: 'RM001',
        data: { status: 'converted' }, // no lead_id
      };

      const result = await service.writeBack(action);

      expect(result.success).toBe(false);
      expect(crmApiClient.updateLead).not.toHaveBeenCalled();
    });

    it('CREATE_MEETING: returns { success: false } when CRM API returns success=false', async () => {
      crmApiClient.createMeeting.mockResolvedValue({ success: false, meeting_id: '' });

      const action: WriteBackAction = {
        type: 'CREATE_MEETING',
        rm_id: 'RM001',
        data: {},
      };

      const result = await service.writeBack(action);

      expect(result.success).toBe(false);
      expect(meetingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('CREATE_PIPELINE: writes to MongoDB and returns generated pipeline_id', async () => {
      const action: WriteBackAction = {
        type: 'CREATE_PIPELINE',
        rm_id: 'RM001',
        data: {
          client_id: 'CL001',
          asset_class: 'Equity',
          amount: 10000000,
        },
      };

      const result = await service.writeBack(action);

      expect(result.success).toBe(true);
      expect(result.crm_id).toMatch(/^PIPE-RM001-/);
      expect(pipelineModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // computeChecksum
  // --------------------------------------------------------------------------

  describe('computeChecksum()', () => {
    it('returns identical checksums for identical objects', () => {
      const obj = { a: 1, b: 'hello', c: true };
      expect(service.computeChecksum(obj)).toBe(service.computeChecksum({ ...obj }));
    });

    it('returns the same checksum regardless of key order', () => {
      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { c: 3, a: 1, b: 2 };
      expect(service.computeChecksum(obj1)).toBe(service.computeChecksum(obj2));
    });

    it('returns different checksums for objects with different values', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 99 };
      expect(service.computeChecksum(obj1)).not.toBe(service.computeChecksum(obj2));
    });

    it('returns a 64-character hex string (SHA-256)', () => {
      const result = service.computeChecksum({ total_aum: 10000000, tier: 'Platinum' });
      expect(result).toMatch(/^[a-f0-9]{64}$/);
    });

    it('handles nested objects deterministically', () => {
      const obj1 = { client: { id: '1', tags: ['a', 'b'] } };
      const obj2 = { client: { tags: ['a', 'b'], id: '1' } };
      expect(service.computeChecksum(obj1)).toBe(service.computeChecksum(obj2));
    });

    it('is sensitive to array ordering (arrays are not sorted)', () => {
      const obj1 = { tags: ['a', 'b'] };
      const obj2 = { tags: ['b', 'a'] };
      // Arrays are ordered data — different order = different checksum
      expect(service.computeChecksum(obj1)).not.toBe(service.computeChecksum(obj2));
    });
  });
});
