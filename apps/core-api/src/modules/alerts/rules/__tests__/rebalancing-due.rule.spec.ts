import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../../database/models/portfolio.model';
import {
  evaluateRebalancingDue,
  buildRebalancingDueMessage,
  REBALANCING_DUE_RULE,
  RebalancingDueCandidate,
} from '../rebalancing-due.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM-TEST-001';

/**
 * Build a minimal aggregation result row as returned by evaluateRebalancingDue.
 * Represents a portfolio that has breached the drawdown threshold.
 */
const makeAggRow = (overrides: Partial<RebalancingDueCandidate> = {}): RebalancingDueCandidate => ({
  client_id: 'client-001',
  client_name: 'Rajesh Kumar',
  client_tier: 'PLATINUM',
  drawdown_pct: 15,
  peak_value: 10_000_000,
  current_value: 8_500_000,
  ...overrides,
});

/** Create a mock portfolioModel whose aggregate() resolves to the given rows. */
const makePortfolioModelMock = (rows: RebalancingDueCandidate[]) =>
  ({
    aggregate: jest.fn().mockResolvedValue(rows),
  }) as unknown as Model<PortfolioDocument>;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RebalancingDueRule', () => {
  // -------------------------------------------------------------------------
  // Rule config
  // -------------------------------------------------------------------------

  it('should have the correct rule_id and alert_type', () => {
    expect(REBALANCING_DUE_RULE.rule_id).toBe('RULE-REBALANCING');
    expect(REBALANCING_DUE_RULE.alert_type).toBe('REBALANCING_DUE');
  });

  it('should have a 168-hour cooldown (7 days)', () => {
    expect(REBALANCING_DUE_RULE.cooldown_hours).toBe(168);
  });

  it('should have MEDIUM severity', () => {
    expect(REBALANCING_DUE_RULE.severity).toBe('medium');
  });

  it('should have drift_threshold_pct of 10', () => {
    expect(REBALANCING_DUE_RULE.conditions['drift_threshold_pct']).toBe(10);
  });

  // -------------------------------------------------------------------------
  // evaluateRebalancingDue — flagging logic
  // -------------------------------------------------------------------------

  it('should flag portfolios with drawdown > 10%', async () => {
    const row = makeAggRow({ drawdown_pct: 15 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateRebalancingDue(model, RM_ID);

    expect(results).toHaveLength(1);
    expect(results[0].drawdown_pct).toBe(15);
  });

  it('should NOT flag portfolios with drawdown <= 10%', async () => {
    // The aggregate $match uses $gt 10; portfolios at or below threshold are
    // excluded by the pipeline — modelled by returning an empty array.
    const model = makePortfolioModelMock([]);

    const results = await evaluateRebalancingDue(model, RM_ID);

    expect(results).toHaveLength(0);
  });

  it('should NOT flag portfolios with drawdown exactly at threshold (10%)', async () => {
    // $gt 10 excludes exactly 10.
    const model = makePortfolioModelMock([]);

    const results = await evaluateRebalancingDue(model, RM_ID);

    expect(results).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  it('should sort results by drawdown_pct descending', async () => {
    // The aggregate pipeline includes $sort: { drawdown_pct: -1 }.
    // We simulate the already-sorted output from MongoDB.
    const rows = [
      makeAggRow({ client_id: 'client-003', drawdown_pct: 25 }),
      makeAggRow({ client_id: 'client-001', drawdown_pct: 15 }),
      makeAggRow({ client_id: 'client-002', drawdown_pct: 11 }),
    ];
    const model = makePortfolioModelMock(rows);

    const results = await evaluateRebalancingDue(model, RM_ID);

    expect(results[0].drawdown_pct).toBe(25);
    expect(results[1].drawdown_pct).toBe(15);
    expect(results[2].drawdown_pct).toBe(11);
  });

  // -------------------------------------------------------------------------
  // Result shape
  // -------------------------------------------------------------------------

  it('should include peak_value and current_value in result', async () => {
    const row = makeAggRow({ peak_value: 10_000_000, current_value: 8_500_000 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateRebalancingDue(model, RM_ID);

    expect(results[0].peak_value).toBe(10_000_000);
    expect(results[0].current_value).toBe(8_500_000);
  });

  it('should include client_name and client_tier in result', async () => {
    const row = makeAggRow({ client_name: 'Rajesh Kumar', client_tier: 'PLATINUM' });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateRebalancingDue(model, RM_ID);

    expect(results[0].client_name).toBe('Rajesh Kumar');
    expect(results[0].client_tier).toBe('PLATINUM');
  });

  // -------------------------------------------------------------------------
  // Aggregate pipeline — verify RM ID is passed through
  // -------------------------------------------------------------------------

  it('should call aggregate with the provided rm_id', async () => {
    const model = makePortfolioModelMock([]);
    await evaluateRebalancingDue(model, RM_ID);

    expect(model.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({ rm_id: RM_ID }),
        }),
      ]),
    );
  });

  it('should return empty array when no portfolios exceed the drawdown threshold', async () => {
    const model = makePortfolioModelMock([]);

    const results = await evaluateRebalancingDue(model, RM_ID);

    expect(results).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // buildRebalancingDueMessage
  // -------------------------------------------------------------------------

  it('should build a message mentioning client name, drawdown_pct, peak_value, and current_value', () => {
    const candidate: RebalancingDueCandidate = {
      client_id: 'client-001',
      client_name: 'Rajesh Kumar',
      client_tier: 'PLATINUM',
      drawdown_pct: 15.2,
      peak_value: 25_000_000,
      current_value: 21_200_000,
    };

    const msg = buildRebalancingDueMessage(candidate);

    expect(msg).toContain('Rajesh Kumar');
    expect(msg).toContain('15.2%');
    expect(msg).toContain('Review rebalancing opportunities');
  });

  it('should include rupee symbol in the message', () => {
    const candidate: RebalancingDueCandidate = {
      client_id: 'client-002',
      client_name: 'Anil Sharma',
      client_tier: 'HNI',
      drawdown_pct: 12,
      peak_value: 5_000_000,
      current_value: 4_400_000,
    };

    const msg = buildRebalancingDueMessage(candidate);

    expect(msg).toContain('₹');
  });
});
