import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { AlertRecord } from '../../../database/models/alert.model';
import { Client } from '../../../database/models/client.model';
import { AlertEngineService, AlertRule, AlertCandidate } from '../alert-engine.service';
import { AlertsService } from '../alerts.service';
import { CacheService } from '../../cache/cache.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

const BASE_RULE: AlertRule = {
  rule_id: 'rule-test-001',
  alert_type: 'birthday',
  name: 'Test Birthday Rule',
  conditions: { days_ahead: 3 },
  cooldown_hours: 168,
  severity: 'medium',
  channels: ['IN_APP'],
};

const makeCandidate = (clientId: string, overrides: Partial<AlertCandidate> = {}): AlertCandidate => ({
  client_id: clientId,
  client_name: `Client ${clientId}`,
  client_tier: 'PLATINUM',
  rm_id: RM_ID,
  data: { days_until_birthday: 2 },
  title: `Birthday: Client ${clientId}`,
  message: `Client ${clientId}'s birthday is in 2 days.`,
  action_suggestion: 'Send a greeting.',
  ...overrides,
});

const makeAlertRecord = (alertId: string, rmId: string = RM_ID): AlertRecord => ({
  alert_id: alertId,
  alert_type: 'birthday',
  rm_id: rmId,
  client_id: `client-${alertId}`,
  client_name: `Client ${alertId}`,
  client_tier: 'PLATINUM',
  severity: 'medium',
  status: 'NEW',
  title: 'Birthday Alert',
  message: 'Birthday soon.',
  data: {},
  action_suggestion: 'Call client.',
  delivered_at: new Date(),
  acknowledged_at: null as unknown as Date,
  acted_at: null as unknown as Date,
  expires_at: new Date(Date.now() + 86_400_000),
  rule_id: 'rule-test-001',
});

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/** Mock AlertsService — spies are wired per test. */
const makeAlertsServiceMock = () => ({
  createAlert: jest.fn(),
  publishAlert: jest.fn(),
});

/** Mock CacheService — get() returns null by default (cache miss). */
const makeCacheServiceMock = () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined),
});

/** Minimal Mongoose Model mock — only lean().exec() chain needed. */
const makeModelMock = (returnValue: unknown[] = []) => ({
  find: jest.fn().mockReturnValue({
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(returnValue),
    }),
  }),
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AlertEngineService', () => {
  let engine: AlertEngineService;
  let alertsService: ReturnType<typeof makeAlertsServiceMock>;
  let cacheService: ReturnType<typeof makeCacheServiceMock>;
  let alertModelMock: ReturnType<typeof makeModelMock>;
  let clientModelMock: ReturnType<typeof makeModelMock>;

  beforeEach(async () => {
    alertsService = makeAlertsServiceMock();
    cacheService = makeCacheServiceMock();
    alertModelMock = makeModelMock();
    clientModelMock = makeModelMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertEngineService,
        { provide: AlertsService, useValue: alertsService },
        { provide: CacheService, useValue: cacheService },
        { provide: getModelToken(AlertRecord.name), useValue: alertModelMock },
        { provide: getModelToken(Client.name), useValue: clientModelMock },
      ],
    }).compile();

    engine = module.get<AlertEngineService>(AlertEngineService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // evaluateRule() — happy path
  // -------------------------------------------------------------------------

  describe('evaluateRule()', () => {
    it('creates alerts for all 3 candidates when no cooldowns are active', async () => {
      const candidates = [
        makeCandidate('c-001'),
        makeCandidate('c-002'),
        makeCandidate('c-003'),
      ];

      alertsService.createAlert
        .mockResolvedValueOnce(makeAlertRecord('a-001'))
        .mockResolvedValueOnce(makeAlertRecord('a-002'))
        .mockResolvedValueOnce(makeAlertRecord('a-003'));

      const result = await engine.evaluateRule(BASE_RULE, candidates);

      expect(result).toHaveLength(3);
      expect(alertsService.createAlert).toHaveBeenCalledTimes(3);
    });

    it('publishes one Kafka event per created alert', async () => {
      const candidates = [
        makeCandidate('c-001'),
        makeCandidate('c-002'),
        makeCandidate('c-003'),
      ];

      alertsService.createAlert
        .mockResolvedValueOnce(makeAlertRecord('a-001'))
        .mockResolvedValueOnce(makeAlertRecord('a-002'))
        .mockResolvedValueOnce(makeAlertRecord('a-003'));

      await engine.evaluateRule(BASE_RULE, candidates);

      expect(alertsService.publishAlert).toHaveBeenCalledTimes(3);
    });

    it('skips a client whose cooldown key is present in Redis', async () => {
      const candidates = [
        makeCandidate('c-001'), // will be on cooldown
        makeCandidate('c-002'), // not on cooldown
      ];

      // First get() call for c-001 returns truthy (on cooldown)
      // Second call for c-002 returns null (cache miss — not on cooldown)
      cacheService.get
        .mockResolvedValueOnce(true)   // c-001: on cooldown
        .mockResolvedValueOnce(null);  // c-002: not on cooldown

      alertsService.createAlert.mockResolvedValueOnce(makeAlertRecord('a-002'));

      const result = await engine.evaluateRule(BASE_RULE, candidates);

      // Only c-002 should produce an alert
      expect(result).toHaveLength(1);
      expect(alertsService.createAlert).toHaveBeenCalledTimes(1);
      expect(alertsService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-002' }),
      );
    });

    it('returns empty array and fires no Kafka events when candidates list is empty', async () => {
      const result = await engine.evaluateRule(BASE_RULE, []);

      expect(result).toHaveLength(0);
      expect(alertsService.createAlert).not.toHaveBeenCalled();
      expect(alertsService.publishAlert).not.toHaveBeenCalled();
    });

    it('sets Redis cooldown key after creating an alert', async () => {
      const candidates = [makeCandidate('c-001')];

      alertsService.createAlert.mockResolvedValueOnce(makeAlertRecord('a-001'));

      await engine.evaluateRule(BASE_RULE, candidates);

      const expectedCooldownKey = `cooldown:${BASE_RULE.rule_id}:c-001`;
      const expectedTtl = BASE_RULE.cooldown_hours * 3600;

      expect(cacheService.set).toHaveBeenCalledWith(
        expectedCooldownKey,
        true,
        expectedTtl,
      );
    });

    it('invalidates the RM alert cache after generating alerts', async () => {
      const candidates = [makeCandidate('c-001')];

      alertsService.createAlert.mockResolvedValueOnce(makeAlertRecord('a-001'));

      await engine.evaluateRule(BASE_RULE, candidates);

      // Cache key format from CACHE_KEYS.rmAlertList(rmId)
      expect(cacheService.invalidate).toHaveBeenCalledWith(`alerts:rm:${RM_ID}`);
    });

    it('does not invalidate cache when no alerts were created (all on cooldown)', async () => {
      const candidates = [makeCandidate('c-001')];

      // All on cooldown
      cacheService.get.mockResolvedValue(true);

      await engine.evaluateRule(BASE_RULE, candidates);

      expect(cacheService.invalidate).not.toHaveBeenCalled();
    });

    it('continues processing remaining candidates when createAlert throws for one', async () => {
      const candidates = [
        makeCandidate('c-001'), // will fail
        makeCandidate('c-002'), // should succeed
      ];

      alertsService.createAlert
        .mockRejectedValueOnce(new Error('DB write failed'))
        .mockResolvedValueOnce(makeAlertRecord('a-002'));

      const result = await engine.evaluateRule(BASE_RULE, candidates);

      expect(result).toHaveLength(1);
      expect(result[0].alert_id).toBe('a-002');
    });
  });

  // -------------------------------------------------------------------------
  // computePriority()
  // -------------------------------------------------------------------------

  describe('computePriority()', () => {
    it('returns P3 (3) for birthday / medium severity', () => {
      const priority = engine.computePriority('birthday', 'medium', {});
      expect(priority).toBe(3);
    });

    it('returns P2 (2) for idle_cash / high severity with amount > ₹10L', () => {
      // ₹15L = 1,500,000
      const priority = engine.computePriority('idle_cash', 'high', { amount: 15_00_000 });
      expect(priority).toBe(2);
    });

    it('returns P3 (3) for idle_cash / high severity when amount ≤ ₹10L', () => {
      // amount exactly at the ₹10L boundary: should drop to P3
      const priority = engine.computePriority('idle_cash', 'high', { amount: 10_00_000 });
      expect(priority).toBe(3);
    });

    it('returns P1 (1) for asset_risk regardless of severity', () => {
      expect(engine.computePriority('asset_risk', 'low', {})).toBe(1);
      expect(engine.computePriority('asset_risk', 'medium', {})).toBe(1);
    });

    it('returns P1 (1) for compliance alert type', () => {
      expect(engine.computePriority('compliance', 'medium', {})).toBe(1);
    });

    it('returns P1 (1) for critical severity regardless of alert type', () => {
      expect(engine.computePriority('birthday', 'critical', {})).toBe(1);
    });

    it('returns P2 (2) for maturity / high severity', () => {
      expect(engine.computePriority('maturity', 'high', {})).toBe(2);
    });

    it('returns P2 (2) for engagement_drop / high severity', () => {
      expect(engine.computePriority('engagement_drop', 'high', {})).toBe(2);
    });

    it('returns P4 (4) for unknown type with low severity', () => {
      expect(engine.computePriority('some_new_type', 'low', {})).toBe(4);
    });

    it('returns P3 (3) for dormant_client / medium severity', () => {
      expect(engine.computePriority('dormant_client', 'medium', {})).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // evaluateBirthdayRule() — via evaluateProofOfConcept()
  // -------------------------------------------------------------------------

  describe('evaluateBirthdayRule() (via evaluateProofOfConcept)', () => {
    it('returns clients with birthday in next 3 days as candidates', async () => {
      const today = new Date();
      const in2Days = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);

      // Simulate a client whose birthday (month/day) falls in 2 days
      const dobThisYear = new Date(
        today.getFullYear(),
        in2Days.getMonth(),
        in2Days.getDate(),
      );

      const mockClients = [
        {
          client_id: 'client-birthday-001',
          client_name: 'Rajesh Kumar',
          rm_id: RM_ID,
          tier: 'HNI',
          dob: dobThisYear,
          total_aum: 5_000_000,
          last_interaction: new Date(),
          accounts: [],
        },
        {
          client_id: 'client-birthday-002',
          client_name: 'Meena Sharma',
          rm_id: RM_ID,
          tier: 'STANDARD',
          // Birthday 10 days away — should NOT be included
          dob: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 10),
          total_aum: 2_000_000,
          last_interaction: new Date(),
          accounts: [],
        },
      ];

      // First clientModel.find() call (for birthday rule)
      clientModelMock.find.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockClients),
        }),
      });

      // Remaining two rules return no candidates to isolate birthday
      clientModelMock.find
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
        });

      // createAlert returns a record for the one birthday candidate
      alertsService.createAlert.mockResolvedValueOnce(makeAlertRecord('a-bday-001'));

      const result = await engine.evaluateProofOfConcept(RM_ID);

      // Exactly one alert generated (only the 2-day birthday)
      expect(result.generated).toBe(1);
      expect(result.evaluated).toContain('rule-birthday-001');

      // Verify createAlert was called with birthday-specific fields
      expect(alertsService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: 'client-birthday-001',
          alert_type: 'birthday',
          rm_id: RM_ID,
        }),
      );
    });

    it('returns zero candidates when no clients have upcoming birthdays', async () => {
      // All clients have birthdays far in the future
      const farFuture = new Date();
      farFuture.setMonth(farFuture.getMonth() + 3);

      const mockClients = [
        {
          client_id: 'client-001',
          client_name: 'Test Client',
          rm_id: RM_ID,
          tier: 'HNI',
          dob: farFuture,
          total_aum: 1_000_000,
          last_interaction: new Date(),
          accounts: [],
        },
      ];

      // Birthday rule returns the far-future client (no match); other rules return empty
      clientModelMock.find
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockClients),
          }),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
        });

      const result = await engine.evaluateProofOfConcept(RM_ID);

      expect(result.generated).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cooldown key format
  // -------------------------------------------------------------------------

  describe('cooldown key format', () => {
    it('uses the pattern cooldown:{ruleId}:{clientId} in Redis set call', async () => {
      const rule: AlertRule = {
        ...BASE_RULE,
        rule_id: 'rule-idle-001',
        alert_type: 'idle_cash',
        severity: 'high',
        cooldown_hours: 72,
      };

      const candidates = [makeCandidate('c-idle-001')];
      alertsService.createAlert.mockResolvedValueOnce(makeAlertRecord('a-idle-001'));

      await engine.evaluateRule(rule, candidates);

      expect(cacheService.set).toHaveBeenCalledWith(
        'cooldown:rule-idle-001:c-idle-001',
        true,
        72 * 3600,
      );
    });
  });
});
