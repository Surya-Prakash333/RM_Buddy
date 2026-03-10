import {
  evaluateMaturityProceeds,
  buildMaturityProceedsMessage,
  MATURITY_PROCEEDS_RULE,
  MaturityProceedsCandidate,
} from '../maturity-proceeds.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

/** Create a date that is `n` days from now. */
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

/** Build a minimal maturity candidate as returned by the aggregation. */
const makeMaturityCandidate = (
  overrides: Partial<MaturityProceedsCandidate> = {},
): MaturityProceedsCandidate => ({
  client_id: 'C001',
  client_name: 'Rajesh Kumar',
  client_tier: 'HNI',
  instrument_name: 'HDFC FD 2026',
  maturity_date: daysFromNow(3),
  maturity_amount: 250_000,
  days_until_maturity: 3,
  ...overrides,
});

/** Build a mock portfolio model whose aggregate resolves to `result`. */
const makePortfolioModel = (result: unknown[]) => ({
  aggregate: jest.fn().mockResolvedValue(result),
});

/** Build a mock portfolio model whose aggregate rejects with an error. */
const makePortfolioModelThrowing = (error: Error) => ({
  aggregate: jest.fn().mockRejectedValue(error),
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('evaluateMaturityProceeds()', () => {
  it('should find holdings maturing within 7 days', async () => {
    const candidate = makeMaturityCandidate({ days_until_maturity: 5 });
    const portfolioModel = makePortfolioModel([candidate]);

    const results = await evaluateMaturityProceeds(portfolioModel as any, RM_ID);

    expect(results).toHaveLength(1);
    expect(results[0].client_id).toBe('C001');
    expect(results[0].instrument_name).toBe('HDFC FD 2026');
    expect(results[0].days_until_maturity).toBe(5);
  });

  it('should NOT include maturities beyond 7 days (aggregation pipeline filters them)', async () => {
    // Aggregation with $match handles this — simulate with empty result
    const portfolioModel = makePortfolioModel([]);

    const results = await evaluateMaturityProceeds(portfolioModel as any, RM_ID);

    expect(results).toHaveLength(0);
  });

  it('should NOT include maturities with amount < ₹50K (aggregation pipeline filters them)', async () => {
    // Pipeline $match on current_value >= 50000 handles this — simulate empty result
    const portfolioModel = makePortfolioModel([]);

    const results = await evaluateMaturityProceeds(portfolioModel as any, RM_ID);

    expect(results).toHaveLength(0);
  });

  it('should return empty array if maturity_date field does not exist (graceful degradation)', async () => {
    // Simulate a scenario where the aggregation throws (e.g. schema mismatch)
    const portfolioModel = makePortfolioModelThrowing(
      new Error('unknown field: maturity_date'),
    );

    const results = await evaluateMaturityProceeds(portfolioModel as any, RM_ID);

    expect(results).toHaveLength(0);
  });

  it('should compute days_until_maturity correctly from aggregation result', async () => {
    const candidate = makeMaturityCandidate({ days_until_maturity: 2 });
    const portfolioModel = makePortfolioModel([candidate]);

    const results = await evaluateMaturityProceeds(portfolioModel as any, RM_ID);

    expect(results[0].days_until_maturity).toBe(2);
  });

  it('should return multiple candidates sorted by nearest maturity first', async () => {
    const c1 = makeMaturityCandidate({ client_id: 'C001', days_until_maturity: 1, maturity_date: daysFromNow(1) });
    const c2 = makeMaturityCandidate({ client_id: 'C002', days_until_maturity: 5, maturity_date: daysFromNow(5) });
    // Aggregation returns already-sorted (sort stage in pipeline)
    const portfolioModel = makePortfolioModel([c1, c2]);

    const results = await evaluateMaturityProceeds(portfolioModel as any, RM_ID);

    expect(results).toHaveLength(2);
    expect(results[0].client_id).toBe('C001');
    expect(results[1].client_id).toBe('C002');
  });

  it('should default client_tier to STANDARD when tier is missing', async () => {
    const candidate = { ...makeMaturityCandidate(), client_tier: undefined as unknown as string };
    const portfolioModel = makePortfolioModel([candidate]);

    const results = await evaluateMaturityProceeds(portfolioModel as any, RM_ID);

    expect(results[0].client_tier).toBe('STANDARD');
  });

  it('should return empty array when no portfolios are found for the RM', async () => {
    const portfolioModel = makePortfolioModel([]);

    const results = await evaluateMaturityProceeds(portfolioModel as any, RM_ID);

    expect(results).toHaveLength(0);
  });

  it('should pass correct date range to the aggregation pipeline', async () => {
    const portfolioModel = makePortfolioModel([]);

    await evaluateMaturityProceeds(portfolioModel as any, RM_ID);

    expect(portfolioModel.aggregate).toHaveBeenCalledTimes(1);
    const pipeline = portfolioModel.aggregate.mock.calls[0][0] as unknown[];
    // Find the $match stage after $unwind
    const matchStages = pipeline.filter(
      (s) => typeof s === 'object' && s !== null && '$match' in (s as object),
    ) as Array<{ $match: Record<string, unknown> }>;

    // First $match: rm_id filter
    expect(matchStages[0].$match).toEqual({ rm_id: RM_ID });
    // Second $match: maturity_date range
    const holdingsMatch = matchStages[1].$match;
    expect(holdingsMatch).toHaveProperty(['holdings.maturity_date']);
    expect(holdingsMatch).toHaveProperty(['holdings.current_value']);
  });
});

// ---------------------------------------------------------------------------
// buildMaturityProceedsMessage()
// ---------------------------------------------------------------------------

describe('buildMaturityProceedsMessage()', () => {
  const candidate: MaturityProceedsCandidate = {
    client_id: 'C001',
    client_name: 'Rajesh Kumar',
    client_tier: 'HNI',
    instrument_name: 'HDFC FD 2026',
    maturity_date: daysFromNow(3),
    maturity_amount: 250_000,
    days_until_maturity: 3,
  };

  it('should include instrument name', () => {
    const msg = buildMaturityProceedsMessage(candidate);
    expect(msg).toContain('HDFC FD 2026');
  });

  it('should include days_until_maturity', () => {
    const msg = buildMaturityProceedsMessage(candidate);
    expect(msg).toContain('3 days');
  });

  it('should include maturity amount in Indian formatting', () => {
    const msg = buildMaturityProceedsMessage(candidate);
    expect(msg).toContain('2,50,000');
  });

  it('should include client name', () => {
    const msg = buildMaturityProceedsMessage(candidate);
    expect(msg).toContain('Rajesh Kumar');
  });

  it('should use singular "day" when days_until_maturity is 1', () => {
    const singleDay: MaturityProceedsCandidate = { ...candidate, days_until_maturity: 1 };
    const msg = buildMaturityProceedsMessage(singleDay);
    expect(msg).toContain('1 day');
    expect(msg).not.toContain('1 days');
  });

  it('should mention reinvestment options', () => {
    const msg = buildMaturityProceedsMessage(candidate);
    expect(msg).toContain('reinvestment');
  });
});

// ---------------------------------------------------------------------------
// MATURITY_PROCEEDS_RULE constant
// ---------------------------------------------------------------------------

describe('MATURITY_PROCEEDS_RULE constant', () => {
  it('should have rule_id RULE-MATURITY', () => {
    expect(MATURITY_PROCEEDS_RULE.rule_id).toBe('RULE-MATURITY');
  });

  it('should have alert_type maturity', () => {
    expect(MATURITY_PROCEEDS_RULE.alert_type).toBe('maturity');
  });

  it('should have severity high', () => {
    expect(MATURITY_PROCEEDS_RULE.severity).toBe('high');
  });

  it('should have cooldown_hours of 48 (2 days)', () => {
    expect(MATURITY_PROCEEDS_RULE.cooldown_hours).toBe(48);
  });

  it('should have days_ahead of 7', () => {
    expect(MATURITY_PROCEEDS_RULE.conditions['days_ahead']).toBe(7);
  });

  it('should have min_amount of 50000', () => {
    expect(MATURITY_PROCEEDS_RULE.conditions['min_amount']).toBe(50_000);
  });
});
