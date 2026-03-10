import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { DashboardController } from '../dashboard.controller';
import { DashboardService } from '../dashboard.service';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { Meeting } from '../../../database/models/meeting.model';
import { AlertRecord } from '../../../database/models/alert.model';
import { CacheService } from '../../cache/cache.service';

// ---------------------------------------------------------------------------
// Mock guard — bypasses header parsing in unit tests
// ---------------------------------------------------------------------------
const mockAuthGuard = {
  canActivate: (_ctx: ExecutionContext): boolean => true,
};

const MOCK_IDENTITY = { rm_id: 'rm-001', name: 'Arjun Shah' };

describe('DashboardController', () => {
  let controller: DashboardController;
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        DashboardService,
        {
          provide: getModelToken(Meeting.name),
          useValue: {
            find: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([]),
            countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
            aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
          },
        },
        {
          provide: getModelToken(AlertRecord.name),
          useValue: {
            find: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([]),
            countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
          },
        },
        {
          provide: CacheService,
          useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true), readThrough: jest.fn().mockImplementation(async (_key: string, fetchFn: () => Promise<unknown>) => fetchFn()) },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(mockAuthGuard)
      .compile();

    controller = module.get<DashboardController>(DashboardController);
    service = module.get<DashboardService>(DashboardService);
  });

  // -------------------------------------------------------------------------
  // Smoke test: module wires up
  // -------------------------------------------------------------------------

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/dashboard/summary
  // -------------------------------------------------------------------------

  describe('getSummary()', () => {
    it('returns 200 envelope with status success', () => {
      const result = controller.getSummary(MOCK_IDENTITY);

      expect(result.status).toBe('success');
      expect(result.timestamp).toBeDefined();
      expect(result.data).toBeDefined();
    });

    it('includes RM KPIs in data', () => {
      const result = controller.getSummary(MOCK_IDENTITY);
      const data = result.data as Record<string, unknown>;

      expect(data['kpis']).toBeDefined();
      const kpis = data['kpis'] as Record<string, unknown>;
      expect(kpis['total_clients']).toBe(20);
      expect(kpis['aum_total']).toBe('₹125Cr');
    });

    it('reflects the rm_id from the identity header', () => {
      const result = controller.getSummary({ rm_id: 'rm-999', name: 'Test RM' });
      const data = result.data as Record<string, unknown>;
      expect(data['rm_id']).toBe('rm-999');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/clients
  // -------------------------------------------------------------------------

  describe('getClients()', () => {
    it('returns 200 with an array in data', () => {
      const result = controller.getClients(MOCK_IDENTITY, {}, {});

      expect(result.status).toBe('success');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('returns at least one client', () => {
      const result = controller.getClients(MOCK_IDENTITY, {}, {});
      const clients = result.data as unknown[];
      expect(clients.length).toBeGreaterThan(0);
    });

    it('each client has required fields', () => {
      const result = controller.getClients(MOCK_IDENTITY, {}, {});
      const clients = result.data as Array<Record<string, unknown>>;

      for (const client of clients) {
        expect(client['id']).toBeDefined();
        expect(client['name']).toBeDefined();
        expect(client['tier']).toBeDefined();
        expect(client['aum']).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/alerts
  // -------------------------------------------------------------------------

  describe('getAlerts()', () => {
    it('returns 200 with an alerts array', () => {
      const result = controller.getAlerts(MOCK_IDENTITY, {});

      expect(result.status).toBe('success');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('each alert has type and priority', () => {
      const result = controller.getAlerts(MOCK_IDENTITY, {});
      const alerts = result.data as Array<Record<string, unknown>>;

      for (const alert of alerts) {
        expect(alert['type']).toBeDefined();
        expect(alert['priority']).toBeDefined();
        expect(['HIGH', 'MEDIUM', 'LOW']).toContain(alert['priority']);
      }
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/v1/alerts/:id/acknowledge
  // -------------------------------------------------------------------------

  describe('acknowledgeAlert()', () => {
    it('returns acknowledged: true for any alert id', () => {
      const result = controller.acknowledgeAlert(MOCK_IDENTITY, 'alert-001');
      const data = result.data as Record<string, unknown>;

      expect(result.status).toBe('success');
      expect(data['acknowledged']).toBe(true);
      expect(data['alert_id']).toBe('alert-001');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/clients/:id
  // -------------------------------------------------------------------------

  describe('getClient()', () => {
    it('returns client details with extended fields', () => {
      const result = controller.getClient(MOCK_IDENTITY, 'client-001');
      const data = result.data as Record<string, unknown>;

      expect(result.status).toBe('success');
      expect(data['id']).toBeDefined();
      expect(data['kyc_status']).toBe('VERIFIED');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/clients/:id/portfolio
  // -------------------------------------------------------------------------

  describe('getPortfolio()', () => {
    it('returns portfolio with holdings array', () => {
      const result = controller.getPortfolio(MOCK_IDENTITY, 'client-001');
      const data = result.data as Record<string, unknown>;

      expect(result.status).toBe('success');
      expect(Array.isArray(data['holdings'])).toBe(true);
      expect(data['summary']).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/briefing/today
  // -------------------------------------------------------------------------

  describe('getBriefing()', () => {
    it('returns briefing with expected sections', () => {
      const result = controller.getBriefing(MOCK_IDENTITY);
      const data = result.data as Record<string, unknown>;

      expect(result.status).toBe('success');
      expect(data['alerts_summary']).toBeDefined();
      expect(data['meetings']).toBeDefined();
      expect(data['daily_actions']).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/daily-actions
  // -------------------------------------------------------------------------

  describe('getDailyActions()', () => {
    it('returns sorted prioritized actions', () => {
      const result = controller.getDailyActions(MOCK_IDENTITY);
      const actions = result.data as Array<Record<string, unknown>>;

      expect(result.status).toBe('success');
      expect(actions.length).toBeGreaterThan(0);
      // Priority 1 should come first
      expect(actions[0]['priority']).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/meetings
  // -------------------------------------------------------------------------

  describe('getMeetings()', () => {
    it('returns meetings array with time and agenda', () => {
      const result = controller.getMeetings(MOCK_IDENTITY);
      const meetings = result.data as Array<Record<string, unknown>>;

      expect(result.status).toBe('success');
      expect(meetings.length).toBeGreaterThan(0);
      expect(meetings[0]['time']).toBeDefined();
      expect(meetings[0]['agenda']).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/crm-sync/trigger
  // -------------------------------------------------------------------------

  describe('triggerSync()', () => {
    it('returns a queued job with a job_id', () => {
      const result = controller.triggerSync(MOCK_IDENTITY);
      const data = result.data as Record<string, unknown>;

      expect(result.status).toBe('success');
      expect(typeof data['job_id']).toBe('string');
      expect(data['status']).toBe('QUEUED');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/qa/query
  // -------------------------------------------------------------------------

  describe('queryQA()', () => {
    it('returns an AI response with confidence score', () => {
      const result = controller.queryQA(MOCK_IDENTITY, 'Which clients have idle cash?');
      const data = result.data as Record<string, unknown>;

      expect(result.status).toBe('success');
      expect(data['answer']).toBeDefined();
      expect(typeof data['confidence']).toBe('number');
    });

    it('echoes the query back in the response', () => {
      const q = 'Show top cross-sell opportunities';
      const result = controller.queryQA(MOCK_IDENTITY, q);
      const data = result.data as Record<string, unknown>;
      expect(data['query']).toBe(q);
    });
  });
});
