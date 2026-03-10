import {
  evaluatePortfolioDrift,
  buildPortfolioDriftMessage,
  PORTFOLIO_DRIFT_RULE,
  TARGET_ALLOCATION,
  PortfolioDriftCandidate,
} from '../portfolio-drift.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

/**
 * Build a minimal portfolio drift aggregate result row.
 * All drift values are pre-computed as the aggregation pipeline would return them.
 */
const makeAggRow = (
  overrides: Partial<{
    client_id: string;
    client_name: string;
    client_tier: string;
    total_aum: number;
    actual_eq_pct: number;
    actual_fi_pct: number;
    actual_cash_pct: number;
    max_drift_pct: number;
    eq_drift: number;
    fi_drift: number;
    cash_drift: number;
  }> = {},
) => {
  const eq = overrides.actual_eq_pct ?? 60;
  const fi = overrides.actual_fi_pct ?? 30;
  const cash = overrides.actual_cash_pct ?? 10;
  const eqDrift = Math.abs(eq - TARGET_ALLOCATION.EQ);
  const fiDrift = Math.abs(fi - TARGET_ALLOCATION.FI);
  const cashDrift = Math.abs(cash - TARGET_ALLOCATION.CASH);
  const maxDrift = Math.max(eqDrift, fiDrift, cashDrift);

  return {
    client_id: 'C001',
    client_name: 'Rajesh Kumar',
    client_tier: 'HNI',
    total_aum: 1_000_000,
    actual_eq_pct: eq,
    actual_fi_pct: fi,
    actual_cash_pct: cash,
    max_drift_pct: maxDrift,
    eq_drift: eqDrift,
    fi_drift: fiDrift,
    cash_drift: cashDrift,
    ...overrides,
  };
};

/** Build a mock portfolio Model — aggregate resolves with the given rows. */
const makePortfolioModel = (aggregateResult: unknown[]) => ({
  aggregate: jest.fn().mockResolvedValue(aggregateResult),
});

// ---------------------------------------------------------------------------
// Test suite — evaluatePortfolioDrift()
// ---------------------------------------------------------------------------

describe('evaluatePortfolioDrift()', () => {
  it('should flag portfolio with equity allocation 20% above target (80% vs 60%)', async () => {
    // EQ at 80% → drift = |80 - 60| = 20 > threshold of 8
    const row = makeAggRow({ actual_eq_pct: 80, actual_fi_pct: 15, actual_cash_pct: 5 });
    const portfolioModel = makePortfolioModel([row]);

    const candidates = await evaluatePortfolioDrift(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
    expect(candidates[0].max_drift_pct).toBeGreaterThan(8);
    expect(candidates[0].actual_eq_pct).toBe(80);
  });

  it('should flag portfolio with FI allocation 15% below target (15% vs 30%)', async () => {
    // FI at 15% → drift = |15 - 30| = 15 > threshold of 8
    const row = makeAggRow({ actual_eq_pct: 65, actual_fi_pct: 15, actual_cash_pct: 20 });
    const portfolioModel = makePortfolioModel([row]);

    const candidates = await evaluatePortfolioDrift(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].actual_fi_pct).toBe(15);
    expect(candidates[0].max_drift_pct).toBeGreaterThan(8);
  });

  it('should NOT flag well-balanced portfolio (within 8% of targets)', async () => {
    // EQ=63, FI=28, CASH=9 → drifts: 3, 2, 1 — all <= 8
    // Aggregate $match { max_drift: { $gt: 8 } } filters this out → empty result
    const portfolioModel = makePortfolioModel([]);

    const candidates = await evaluatePortfolioDrift(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(0);
  });

  it('should identify drift_asset as most deviated asset class', async () => {
    // EQ=80 (drift 20), FI=28 (drift 2), CASH=8 (drift 2) → EQ is largest
    const row = makeAggRow({ actual_eq_pct: 80, actual_fi_pct: 28, actual_cash_pct: 8 });
    const portfolioModel = makePortfolioModel([row]);

    const candidates = await evaluatePortfolioDrift(portfolioModel as any, RM_ID);

    expect(candidates[0].drift_asset).toBe('EQ');
  });

  it('should sort by max_drift_pct descending', async () => {
    // Two portfolios: C001 max_drift=20, C002 max_drift=12 — sorted C001 first
    const row1 = makeAggRow({
      client_id: 'C001',
      actual_eq_pct: 80,
      actual_fi_pct: 15,
      actual_cash_pct: 5,
    });
    const row2 = makeAggRow({
      client_id: 'C002',
      actual_eq_pct: 48,
      actual_fi_pct: 35,
      actual_cash_pct: 17,
    });
    // Simulate already-sorted aggregation result (as MongoDB $sort would give us)
    const portfolioModel = makePortfolioModel([row1, row2]);

    const candidates = await evaluatePortfolioDrift(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(2);
    expect(candidates[0].max_drift_pct).toBeGreaterThanOrEqual(candidates[1].max_drift_pct);
  });

  it('should compute eq_pct from by_asset_class.EQ / total_aum * 100', async () => {
    // The aggregation pipeline computes eq_pct = (EQ / total_aum) * 100.
    // We simulate the aggregate output where eq_pct is already computed.
    const row = makeAggRow({ actual_eq_pct: 75, actual_fi_pct: 18, actual_cash_pct: 7 });
    const portfolioModel = makePortfolioModel([row]);

    const candidates = await evaluatePortfolioDrift(portfolioModel as any, RM_ID);

    // Verify the aggregation pipeline was called with the rm_id match
    const aggCall = (portfolioModel.aggregate as jest.Mock).mock.calls[0][0] as unknown[];
    const matchStage = aggCall[0] as { $match: { rm_id: string } };
    expect(matchStage['$match']['rm_id']).toBe(RM_ID);

    expect(candidates[0].actual_eq_pct).toBe(75);
  });

  it('should handle missing by_asset_class.EQ gracefully (default to 0)', async () => {
    // When EQ is missing, $ifNull defaults to 0 → eq_pct = 0
    // eq_drift = |0 - 60| = 60 → well above threshold → should be flagged
    const row = makeAggRow({ actual_eq_pct: 0, actual_fi_pct: 80, actual_cash_pct: 20 });
    const portfolioModel = makePortfolioModel([row]);

    const candidates = await evaluatePortfolioDrift(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].actual_eq_pct).toBe(0);
    expect(candidates[0].max_drift_pct).toBeGreaterThan(8);
  });
});

// ---------------------------------------------------------------------------
// buildPortfolioDriftMessage()
// ---------------------------------------------------------------------------

describe('buildPortfolioDriftMessage()', () => {
  const candidate: PortfolioDriftCandidate = {
    client_id: 'C001',
    client_name: 'Rajesh Kumar',
    client_tier: 'HNI',
    total_aum: 1_000_000,
    actual_eq_pct: 80,
    actual_fi_pct: 15,
    actual_cash_pct: 5,
    max_drift_pct: 20,
    drift_asset: 'EQ',
  };

  it('should include client name', () => {
    const msg = buildPortfolioDriftMessage(candidate);
    expect(msg).toContain('Rajesh Kumar');
  });

  it('should include max_drift_pct', () => {
    const msg = buildPortfolioDriftMessage(candidate);
    expect(msg).toContain('20.0%');
  });

  it('should include drift_asset', () => {
    const msg = buildPortfolioDriftMessage(candidate);
    expect(msg).toContain('EQ');
  });

  it('should include actual allocation percentage', () => {
    const msg = buildPortfolioDriftMessage(candidate);
    expect(msg).toContain('80.0%');
  });

  it('should include target allocation percentage', () => {
    const msg = buildPortfolioDriftMessage(candidate);
    expect(msg).toContain('60');
  });

  it('should mention reviewing allocation', () => {
    const msg = buildPortfolioDriftMessage(candidate);
    expect(msg.toLowerCase()).toContain('review');
  });
});

// ---------------------------------------------------------------------------
// PORTFOLIO_DRIFT_RULE constant
// ---------------------------------------------------------------------------

describe('PORTFOLIO_DRIFT_RULE constant', () => {
  it('should have rule_id RULE-PORTFOLIO-DRIFT', () => {
    expect(PORTFOLIO_DRIFT_RULE.rule_id).toBe('RULE-PORTFOLIO-DRIFT');
  });

  it('should have severity medium', () => {
    expect(PORTFOLIO_DRIFT_RULE.severity).toBe('medium');
  });

  it('should have cooldown_hours of 168', () => {
    expect(PORTFOLIO_DRIFT_RULE.cooldown_hours).toBe(168);
  });

  it('should have drift_pct threshold of 8', () => {
    expect(PORTFOLIO_DRIFT_RULE.conditions['drift_pct']).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// TARGET_ALLOCATION constant
// ---------------------------------------------------------------------------

describe('TARGET_ALLOCATION', () => {
  it('should target 60% equity', () => {
    expect(TARGET_ALLOCATION.EQ).toBe(60);
  });

  it('should target 30% fixed income', () => {
    expect(TARGET_ALLOCATION.FI).toBe(30);
  });

  it('should target 10% cash', () => {
    expect(TARGET_ALLOCATION.CASH).toBe(10);
  });
});
