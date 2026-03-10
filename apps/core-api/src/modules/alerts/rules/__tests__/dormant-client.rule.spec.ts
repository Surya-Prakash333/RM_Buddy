import { Model } from 'mongoose';
import { ClientDocument } from '../../../../database/models/client.model';
import {
  evaluateDormantClients,
  buildDormantClientMessage,
  DORMANT_CLIENT_RULE,
  DormantClientCandidate,
} from '../dormant-client.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM-TEST-001';

/** Days → milliseconds */
const daysAgo = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

/** Build a minimal client document shape as returned by .lean() */
const makeClient = (
  overrides: Partial<{
    client_id: string;
    client_name: string;
    rm_id: string;
    tier: string;
    total_aum: number;
    last_interaction: Date | null;
  }> = {},
) => ({
  client_id: 'client-001',
  client_name: 'Anil Sharma',
  rm_id: RM_ID,
  tier: 'HNI',
  total_aum: 5_000_000,
  last_interaction: daysAgo(100),
  ...overrides,
});

/**
 * Build a mock Mongoose Model whose .find().lean().exec() chain resolves
 * with `returnValue`.
 */
const makeClientModelMock = (returnValue: unknown[] = []): Model<ClientDocument> =>
  ({
    find: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(returnValue),
      }),
    }),
  } as unknown as Model<ClientDocument>);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('DormantClientRule', () => {
  // -------------------------------------------------------------------------
  // Rule metadata
  // -------------------------------------------------------------------------

  it('has the correct rule_id and alert_type', () => {
    expect(DORMANT_CLIENT_RULE.rule_id).toBe('RULE-DORMANT');
    expect(DORMANT_CLIENT_RULE.alert_type).toBe('DORMANT_CLIENT');
  });

  it('has cooldown_hours set to 168 (7 days)', () => {
    expect(DORMANT_CLIENT_RULE.cooldown_hours).toBe(168);
  });

  it('has inactive_days condition of 90', () => {
    expect(DORMANT_CLIENT_RULE.conditions['inactive_days']).toBe(90);
  });

  // -------------------------------------------------------------------------
  // evaluateDormantClients()
  // -------------------------------------------------------------------------

  describe('evaluateDormantClients()', () => {
    it('should flag client with last_interaction > 90 days ago', async () => {
      const client = makeClient({ last_interaction: daysAgo(100) });
      const model = makeClientModelMock([client]);

      const results = await evaluateDormantClients(model, RM_ID);

      expect(results).toHaveLength(1);
      expect(results[0].client_id).toBe(client.client_id);
    });

    it('should NOT flag client with recent interaction (< 90 days)', async () => {
      // The MongoDB query filters these out; simulate empty result from DB
      const model = makeClientModelMock([]); // DB returns no rows matching $lt cutoff

      const results = await evaluateDormantClients(model, RM_ID);

      expect(results).toHaveLength(0);
    });

    it('should compute days_dormant correctly', async () => {
      const dormantDays = 95;
      const client = makeClient({ last_interaction: daysAgo(dormantDays) });
      const model = makeClientModelMock([client]);

      const results = await evaluateDormantClients(model, RM_ID);

      expect(results).toHaveLength(1);
      // days_dormant is computed as floor(ms / 86400000) — allow ±1 for timing
      expect(results[0].days_dormant).toBeGreaterThanOrEqual(dormantDays - 1);
      expect(results[0].days_dormant).toBeLessThanOrEqual(dormantDays + 1);
    });

    it('should return client_tier in result', async () => {
      const client = makeClient({ tier: 'PLATINUM', last_interaction: daysAgo(100) });
      const model = makeClientModelMock([client]);

      const results = await evaluateDormantClients(model, RM_ID);

      expect(results[0].client_tier).toBe('PLATINUM');
    });

    it('should default client_tier to STANDARD when tier is missing', async () => {
      const client = makeClient({ tier: undefined as unknown as string, last_interaction: daysAgo(100) });
      const model = makeClientModelMock([client]);

      const results = await evaluateDormantClients(model, RM_ID);

      expect(results[0].client_tier).toBe('STANDARD');
    });

    it('should NOT flag client if last_interaction is null or undefined', async () => {
      // Simulate a client record that somehow has a null last_interaction
      // (e.g., newly onboarded — the DB query uses $ne:null but we test the
      // application-layer filter too).
      const client = makeClient({ last_interaction: null });
      const model = makeClientModelMock([client]);

      const results = await evaluateDormantClients(model, RM_ID);

      expect(results).toHaveLength(0);
    });

    it('should pass rm_id filter to the query', async () => {
      const model = makeClientModelMock([]);

      await evaluateDormantClients(model, RM_ID);

      expect(model.find).toHaveBeenCalledWith(
        expect.objectContaining({ rm_id: RM_ID }),
        expect.any(Object),
      );
    });

    it('should include last_interaction as a Date object in result', async () => {
      const interactionDate = daysAgo(100);
      const client = makeClient({ last_interaction: interactionDate });
      const model = makeClientModelMock([client]);

      const results = await evaluateDormantClients(model, RM_ID);

      expect(results[0].last_interaction).toBeInstanceOf(Date);
    });

    it('should handle multiple dormant clients and return all of them', async () => {
      const clients = [
        makeClient({ client_id: 'c-001', client_name: 'Client One', last_interaction: daysAgo(120) }),
        makeClient({ client_id: 'c-002', client_name: 'Client Two', last_interaction: daysAgo(200) }),
        makeClient({ client_id: 'c-003', client_name: 'Client Three', last_interaction: daysAgo(91) }),
      ];
      const model = makeClientModelMock(clients);

      const results = await evaluateDormantClients(model, RM_ID);

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.client_id)).toEqual(['c-001', 'c-002', 'c-003']);
    });

    it('should return an empty array when no clients are dormant', async () => {
      const model = makeClientModelMock([]);

      const results = await evaluateDormantClients(model, RM_ID);

      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // buildDormantClientMessage()
  // -------------------------------------------------------------------------

  describe('buildDormantClientMessage()', () => {
    const makeCandidate = (overrides: Partial<DormantClientCandidate> = {}): DormantClientCandidate => ({
      client_id: 'c-001',
      client_name: 'Anil Sharma',
      client_tier: 'HNI',
      total_aum: 5_000_000,
      last_interaction: daysAgo(95),
      days_dormant: 95,
      ...overrides,
    });

    it('includes the client name in the message', () => {
      const msg = buildDormantClientMessage(makeCandidate({ client_name: 'Priya Mehta' }));
      expect(msg).toContain('Priya Mehta');
    });

    it('includes AUM formatted in Indian notation', () => {
      const msg = buildDormantClientMessage(makeCandidate({ total_aum: 5_000_000 }));
      // Indian format for 5,000,000 is 50,00,000
      expect(msg).toContain('50,00,000');
    });

    it('includes the number of dormant days', () => {
      const msg = buildDormantClientMessage(makeCandidate({ days_dormant: 95 }));
      expect(msg).toContain('95 days');
    });

    it('includes a call-to-action about scheduling a check-in', () => {
      const msg = buildDormantClientMessage(makeCandidate());
      expect(msg.toLowerCase()).toContain('check-in');
    });
  });
});
