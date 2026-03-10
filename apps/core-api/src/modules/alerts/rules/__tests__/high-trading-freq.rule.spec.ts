import {
  evaluateHighTradingFreq,
  buildHighTradingMessage,
  HIGH_TRADING_FREQ_RULE,
  HighTradingCandidate,
} from '../high-trading-freq.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

/** Build a minimal aggregate result representing one client's trading summary. */
const makeAggResult = (
  overrides: Partial<HighTradingCandidate> = {},
): HighTradingCandidate => ({
  client_id: 'C001',
  client_name: 'Rajesh Kumar',
  client_tier: 'HNI',
  trade_count: 8,
  total_traded_value: 500_000,
  ...overrides,
});

/** Build a mock Mongoose Model for transactions using aggregate(). */
const makeTransactionModel = (aggregateResult: unknown[]) => ({
  aggregate: jest.fn().mockResolvedValue(aggregateResult),
});

/** Build a mock Mongoose Model for clients (not used by evaluateHighTradingFreq directly — lookup is in aggregate pipeline). */
const makeClientModel = () => ({
  find: jest.fn().mockReturnValue({
    lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
  }),
});

// ---------------------------------------------------------------------------
// Test suite — evaluateHighTradingFreq()
// ---------------------------------------------------------------------------

describe('evaluateHighTradingFreq()', () => {
  it('should flag client with > 5 trades in last 7 days', async () => {
    const aggResult = [makeAggResult({ trade_count: 8 })];
    const txnModel = makeTransactionModel(aggResult);
    const clientModel = makeClientModel();

    const candidates = await evaluateHighTradingFreq(
      txnModel as any,
      clientModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
    expect(candidates[0].trade_count).toBe(8);
  });

  it('should NOT flag client with exactly 5 trades', async () => {
    // The pipeline uses $gt: 5 so exactly 5 does not qualify.
    // Simulate the aggregate returning empty (Mongo already filtered out count=5).
    const txnModel = makeTransactionModel([]);
    const clientModel = makeClientModel();

    const candidates = await evaluateHighTradingFreq(
      txnModel as any,
      clientModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(0);
  });

  it('should NOT flag client with < 5 trades', async () => {
    // Aggregate pipeline ($match: trade_count > 5) filters these out.
    const txnModel = makeTransactionModel([]);
    const clientModel = makeClientModel();

    const candidates = await evaluateHighTradingFreq(
      txnModel as any,
      clientModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(0);
    expect(txnModel.aggregate).toHaveBeenCalledTimes(1);
  });

  it('should compute total_traded_value correctly', async () => {
    const aggResult = [makeAggResult({ trade_count: 7, total_traded_value: 1_250_000 })];
    const txnModel = makeTransactionModel(aggResult);
    const clientModel = makeClientModel();

    const candidates = await evaluateHighTradingFreq(
      txnModel as any,
      clientModel as any,
      RM_ID,
    );

    expect(candidates[0].total_traded_value).toBe(1_250_000);
  });

  it('should only count Executed status transactions', async () => {
    // Verify the aggregate pipeline receives the correct $match with status: 'Executed'
    const txnModel = makeTransactionModel([]);
    const clientModel = makeClientModel();

    await evaluateHighTradingFreq(txnModel as any, clientModel as any, RM_ID);

    const pipeline = txnModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const matchStage = pipeline[0] as { $match: Record<string, unknown> };
    expect(matchStage.$match).toMatchObject({ status: 'Executed', rm_id: RM_ID });
  });

  it('should sort by trade_count descending', async () => {
    const aggResult = [
      makeAggResult({ client_id: 'C001', trade_count: 10 }),
      makeAggResult({ client_id: 'C002', trade_count: 7 }),
      makeAggResult({ client_id: 'C003', trade_count: 6 }),
    ];
    const txnModel = makeTransactionModel(aggResult);
    const clientModel = makeClientModel();

    const candidates = await evaluateHighTradingFreq(
      txnModel as any,
      clientModel as any,
      RM_ID,
    );

    // Verify the pipeline includes a $sort stage with trade_count: -1
    const pipeline = txnModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const sortStage = pipeline.find((s) => '$sort' in s) as { $sort: Record<string, number> } | undefined;
    expect(sortStage).toBeDefined();
    expect(sortStage!.$sort.trade_count).toBe(-1);

    // Returned results maintain the order provided by the aggregate mock
    expect(candidates[0].trade_count).toBe(10);
    expect(candidates[1].trade_count).toBe(7);
    expect(candidates[2].trade_count).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// buildHighTradingMessage()
// ---------------------------------------------------------------------------

describe('buildHighTradingMessage()', () => {
  const candidate: HighTradingCandidate = {
    client_id: 'C001',
    client_name: 'Rajesh Kumar',
    client_tier: 'HNI',
    trade_count: 8,
    total_traded_value: 500_000,
  };

  it('should include client name in the message', () => {
    const msg = buildHighTradingMessage(candidate);
    expect(msg).toContain('Rajesh Kumar');
  });

  it('should include trade_count in the message', () => {
    const msg = buildHighTradingMessage(candidate);
    expect(msg).toContain('8');
  });

  it('should include formatted total_traded_value', () => {
    const msg = buildHighTradingMessage(candidate);
    // 500,000 in Indian format is 5,00,000
    expect(msg).toContain('5,00,000');
  });

  it('should mention overtrading risk', () => {
    const msg = buildHighTradingMessage(candidate);
    expect(msg).toContain('overtrading');
  });
});

// ---------------------------------------------------------------------------
// HIGH_TRADING_FREQ_RULE constant
// ---------------------------------------------------------------------------

describe('HIGH_TRADING_FREQ_RULE constant', () => {
  it('should have rule_id RULE-HIGH-TRADING', () => {
    expect(HIGH_TRADING_FREQ_RULE.rule_id).toBe('RULE-HIGH-TRADING');
  });

  it('should have severity medium', () => {
    expect(HIGH_TRADING_FREQ_RULE.severity).toBe('medium');
  });

  it('should have cooldown_hours of 24', () => {
    expect(HIGH_TRADING_FREQ_RULE.cooldown_hours).toBe(24);
  });

  it('should have trades_per_week threshold of 5', () => {
    expect(HIGH_TRADING_FREQ_RULE.conditions['trades_per_week']).toBe(5);
  });
});
