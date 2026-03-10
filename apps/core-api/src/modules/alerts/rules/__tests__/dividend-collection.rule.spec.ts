import {
  evaluateDividendCollection,
  buildDividendCollectionMessage,
  DIVIDEND_COLLECTION_RULE,
  DividendCandidate,
} from '../dividend-collection.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

/** Build a minimal DividendCandidate aggregate result. */
const makeAggResult = (overrides: Partial<DividendCandidate> = {}): DividendCandidate => ({
  client_id: 'C001',
  client_name: 'Amit Mehta',
  client_tier: 'HNI',
  instrument_name: 'INFY',
  current_value: 350000,
  estimated_dividend: 0,
  ...overrides,
});

/** Build a mock Mongoose Model for portfolios. */
const makePortfolioModel = (aggregateResult: unknown[]) => ({
  aggregate: jest.fn().mockResolvedValue(aggregateResult),
});

// ---------------------------------------------------------------------------
// evaluateDividendCollection()
// ---------------------------------------------------------------------------

describe('evaluateDividendCollection()', () => {
  it('should return EQ holdings with value >= ₹2L', async () => {
    const agg = makeAggResult({ current_value: 250000 });
    const portfolioModel = makePortfolioModel([agg]);

    const candidates = await evaluateDividendCollection(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
    expect(candidates[0].current_value).toBeGreaterThanOrEqual(200000);
  });

  it('should NOT return holdings below ₹2L', async () => {
    // Aggregate returns empty because current_value < 200000 is filtered by $match
    const portfolioModel = makePortfolioModel([]);

    const candidates = await evaluateDividendCollection(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(0);
  });

  it('should limit results to top 10', async () => {
    // Build 12 aggregate results — evaluate should only return ≤ 10
    // (the $limit stage in the pipeline handles this; mock returns 10 max)
    const aggResults = Array.from({ length: 10 }, (_, i) =>
      makeAggResult({ client_id: `C00${i + 1}`, current_value: 300000 - i * 10000 }),
    );
    const portfolioModel = makePortfolioModel(aggResults);

    const candidates = await evaluateDividendCollection(portfolioModel as any, RM_ID);

    expect(candidates.length).toBeLessThanOrEqual(10);

    // Verify $limit: 10 appears in the aggregate pipeline
    const pipeline = portfolioModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const limitStage = pipeline.find((s) => s['$limit'] !== undefined);
    expect(limitStage).toBeDefined();
    expect(limitStage!['$limit']).toBe(10);
  });

  it('should set estimated_dividend to 0 (requires market data)', async () => {
    const agg = makeAggResult({ current_value: 500000 });
    const portfolioModel = makePortfolioModel([agg]);

    const candidates = await evaluateDividendCollection(portfolioModel as any, RM_ID);

    expect(candidates[0].estimated_dividend).toBe(0);
  });

  it('should sort by current_value descending', async () => {
    // Verify $sort: { current_value: -1 } is in the pipeline
    const portfolioModel = makePortfolioModel([]);

    await evaluateDividendCollection(portfolioModel as any, RM_ID);

    const pipeline = portfolioModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const sortStage = pipeline.find((s) => s['$sort'] !== undefined);
    expect(sortStage).toBeDefined();
    expect((sortStage!['$sort'] as Record<string, unknown>)['current_value']).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// DIVIDEND_COLLECTION_RULE constant
// ---------------------------------------------------------------------------

describe('DIVIDEND_COLLECTION_RULE constant', () => {
  it('should have rule_id RULE-DIVIDEND-COLLECTION', () => {
    expect(DIVIDEND_COLLECTION_RULE.rule_id).toBe('RULE-DIVIDEND-COLLECTION');
  });

  it('should have severity low', () => {
    expect(DIVIDEND_COLLECTION_RULE.severity).toBe('low');
  });

  it('should have cooldown_hours of 24', () => {
    expect(DIVIDEND_COLLECTION_RULE.cooldown_hours).toBe(24);
  });

  it('should have min_holding_value of 200000', () => {
    expect(DIVIDEND_COLLECTION_RULE.conditions['min_holding_value']).toBe(200000);
  });

  it('should have days_ahead of 3', () => {
    expect(DIVIDEND_COLLECTION_RULE.conditions['days_ahead']).toBe(3);
  });

  it('should NOT have a description field', () => {
    expect((DIVIDEND_COLLECTION_RULE as unknown as Record<string, unknown>)['description']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildDividendCollectionMessage()
// ---------------------------------------------------------------------------

describe('buildDividendCollectionMessage()', () => {
  const candidate: DividendCandidate = {
    client_id: 'C001',
    client_name: 'Amit Mehta',
    client_tier: 'HNI',
    instrument_name: 'INFY',
    current_value: 350000,
    estimated_dividend: 0,
  };

  it('should include client name in message', () => {
    const msg = buildDividendCollectionMessage(candidate);
    expect(msg).toContain('Amit Mehta');
  });

  it('should include instrument name in message', () => {
    const msg = buildDividendCollectionMessage(candidate);
    expect(msg).toContain('INFY');
  });

  it('should include formatted holding value', () => {
    const msg = buildDividendCollectionMessage(candidate);
    expect(msg).toContain('3,50,000');
  });

  it('should mention record date confirmation', () => {
    const msg = buildDividendCollectionMessage(candidate);
    expect(msg).toContain('record date');
  });
});
