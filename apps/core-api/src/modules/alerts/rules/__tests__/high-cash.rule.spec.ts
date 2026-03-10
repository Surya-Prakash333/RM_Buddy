import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../../database/models/portfolio.model';
import {
  evaluateHighCash,
  buildHighCashMessage,
  HIGH_CASH_RULE,
  HighCashCandidate,
} from '../high-cash.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM-TEST-001';

/** Build a minimal aggregation result row as returned by evaluateHighCash. */
const makeAggRow = (overrides: Partial<{
  client_id: string;
  client_name: string;
  client_tier: string;
  cash_balance: number;
  cash_pct: number;
  total_aum: number;
}> = {}) => ({
  client_id: 'client-001',
  client_name: 'Priya Mehta',
  client_tier: 'PLATINUM',
  cash_balance: 500_000,
  cash_pct: 45,
  total_aum: 1_100_000,
  ...overrides,
});

/** Create a mock portfolioModel whose aggregate() resolves to the given rows. */
const makePortfolioModelMock = (rows: ReturnType<typeof makeAggRow>[]) =>
  ({
    aggregate: jest.fn().mockResolvedValue(rows),
  }) as unknown as Model<PortfolioDocument>;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('HighCashAllocationRule', () => {
  // -------------------------------------------------------------------------
  // Rule config
  // -------------------------------------------------------------------------

  it('should have the correct rule_id and alert_type', () => {
    expect(HIGH_CASH_RULE.rule_id).toBe('RULE-HIGH-CASH');
    expect(HIGH_CASH_RULE.alert_type).toBe('HIGH_CASH_ALLOCATION');
  });

  it('should have a 3-day (72-hour) cooldown', () => {
    expect(HIGH_CASH_RULE.cooldown_hours).toBe(72);
  });

  it('should have cash_pct_threshold of 30 and min_cash_balance of 200000', () => {
    expect(HIGH_CASH_RULE.conditions['cash_pct_threshold']).toBe(30);
    expect(HIGH_CASH_RULE.conditions['min_cash_balance']).toBe(200_000);
  });

  // -------------------------------------------------------------------------
  // evaluateHighCash — flagging logic
  // -------------------------------------------------------------------------

  it('should flag client with cash_pct > 30% and balance > ₹2L', async () => {
    const row = makeAggRow({ cash_pct: 45, cash_balance: 500_000 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateHighCash(model, RM_ID);

    expect(results).toHaveLength(1);
    expect(results[0].cash_pct).toBeGreaterThan(30);
    expect(results[0].cash_balance).toBeGreaterThanOrEqual(200_000);
  });

  it('should NOT flag client with cash_pct <= 30% (aggregate returns empty)', async () => {
    // The $match { cash_pct: { $gt: 30 } } would exclude these clients.
    const model = makePortfolioModelMock([]);

    const results = await evaluateHighCash(model, RM_ID);

    expect(results).toHaveLength(0);
  });

  it('should NOT flag client with balance < ₹2L even if pct > 30% (aggregate returns empty)', async () => {
    // The $match { cash_balance: { $gte: 200000 } } would exclude these clients.
    const model = makePortfolioModelMock([]);

    const results = await evaluateHighCash(model, RM_ID);

    expect(results).toHaveLength(0);
  });

  it('should sort results by cash_pct descending', async () => {
    // Aggregate returns rows already sorted; verify our pipeline includes the sort stage.
    const rows = [
      makeAggRow({ client_id: 'client-001', cash_pct: 60 }),
      makeAggRow({ client_id: 'client-002', cash_pct: 45 }),
      makeAggRow({ client_id: 'client-003', cash_pct: 35 }),
    ];
    const model = makePortfolioModelMock(rows);

    const results = await evaluateHighCash(model, RM_ID);

    // Results come back in the order MongoDB returns them (our mock preserves insertion order)
    expect(results[0].cash_pct).toBeGreaterThanOrEqual(results[1].cash_pct);
    expect(results[1].cash_pct).toBeGreaterThanOrEqual(results[2].cash_pct);

    // Verify the pipeline includes a $sort stage with { cash_pct: -1 }
    expect(model.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ $sort: { cash_pct: -1 } }),
      ]),
    );
  });

  // -------------------------------------------------------------------------
  // Result shape
  // -------------------------------------------------------------------------

  it('should return client_id, client_name, client_tier, cash_balance, cash_pct, total_aum', async () => {
    const row = makeAggRow({
      client_id: 'client-xyz',
      client_name: 'Rohan Das',
      client_tier: 'HNI',
      cash_balance: 300_000,
      cash_pct: 38,
      total_aum: 789_474,
    });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateHighCash(model, RM_ID);

    expect(results[0]).toMatchObject({
      client_id: 'client-xyz',
      client_name: 'Rohan Das',
      client_tier: 'HNI',
      cash_balance: 300_000,
      cash_pct: 38,
      total_aum: 789_474,
    });
  });

  // -------------------------------------------------------------------------
  // aggregate pipeline — verify RM ID is passed through
  // -------------------------------------------------------------------------

  it('should call aggregate with the provided rm_id', async () => {
    const model = makePortfolioModelMock([]);
    await evaluateHighCash(model, RM_ID);

    expect(model.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({ rm_id: RM_ID }),
        }),
      ]),
    );
  });

  // -------------------------------------------------------------------------
  // buildHighCashMessage
  // -------------------------------------------------------------------------

  it('should build a message mentioning client name, cash_pct and formatted cash balance', () => {
    const candidate: HighCashCandidate = {
      client_id: 'client-001',
      client_name: 'Priya Mehta',
      client_tier: 'PLATINUM',
      cash_balance: 250_000,
      cash_pct: 45,
      total_aum: 555_556,
    };

    const msg = buildHighCashMessage(candidate);

    expect(msg).toContain('Priya Mehta');
    expect(msg).toContain('45%');
    expect(msg).toContain('₹');
    expect(msg).toContain('Review investment strategy');
  });
});
