import {
  evaluateCashflowReinvest,
  buildCashflowReinvestMessage,
  CASHFLOW_REINVEST_RULE,
  CashflowReinvestCandidate,
} from '../cashflow-reinvest.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

/** Build a minimal portfolio aggregate result row. */
const makePortfolioAgg = (
  overrides: Partial<{
    client_id: string;
    client_name: string;
    client_tier: string;
    cash_balance: number;
    cash_pct: number;
  }> = {},
) => ({
  client_id: 'C001',
  client_name: 'Priya Mehta',
  client_tier: 'HNI',
  cash_balance: 300_000,
  cash_pct: 25,
  ...overrides,
});

/** Build a mock portfolio Model — aggregate resolves with the given rows. */
const makePortfolioModel = (aggregateResult: unknown[]) => ({
  aggregate: jest.fn().mockResolvedValue(aggregateResult),
});

/** Build a minimal transaction document. */
const makeTxn = (overrides: Partial<{ txn_type: string; amount: number; txn_date: Date }> = {}) => ({
  txn_id: 'TXN001',
  client_id: 'C001',
  txn_type: 'SELL',
  amount: 150_000,
  txn_date: new Date(),
  status: 'Executed',
  ...overrides,
});

/**
 * Build a mock transaction Model.
 * findOne() returns a chain: .lean().exec() resolves with `result`.
 */
const makeTransactionModel = (result: unknown | null) => {
  const execMock = jest.fn().mockResolvedValue(result);
  const leanMock = jest.fn().mockReturnValue({ exec: execMock });
  return {
    findOne: jest.fn().mockReturnValue({ lean: leanMock }),
    _execMock: execMock,
  };
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('evaluateCashflowReinvest()', () => {
  it('should flag client with cash_pct > 20% AND recent SELL transaction', async () => {
    const portfolio = makePortfolioAgg({ cash_pct: 25, cash_balance: 300_000 });
    const portfolioModel = makePortfolioModel([portfolio]);
    const txn = makeTxn({ txn_type: 'SELL', amount: 150_000 });
    const txnModel = makeTransactionModel(txn);

    const candidates = await evaluateCashflowReinvest(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
    expect(candidates[0].cash_pct).toBe(25);
    expect(candidates[0].txn_type).toBe('SELL');
    expect(candidates[0].recent_inflow_amount).toBe(150_000);
  });

  it('should NOT flag client with cash_pct > 20% but no recent transactions', async () => {
    const portfolio = makePortfolioAgg({ cash_pct: 28 });
    const portfolioModel = makePortfolioModel([portfolio]);
    // No recent SELL/REDEMPTION found
    const txnModel = makeTransactionModel(null);

    const candidates = await evaluateCashflowReinvest(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(0);
  });

  it('should NOT flag client with cash_pct <= 20%', async () => {
    // Aggregate returns empty because the $match filters out portfolios with cash_pct <= 20
    const portfolioModel = makePortfolioModel([]);
    const txnModel = makeTransactionModel(null);

    const candidates = await evaluateCashflowReinvest(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(0);
    // findOne should never be called if there are no portfolios to check
    expect(txnModel.findOne).not.toHaveBeenCalled();
  });

  it('should detect REDEMPTION as cashflow trigger', async () => {
    const portfolio = makePortfolioAgg({ cash_pct: 30 });
    const portfolioModel = makePortfolioModel([portfolio]);
    const txn = makeTxn({ txn_type: 'REDEMPTION', amount: 200_000 });
    const txnModel = makeTransactionModel(txn);

    const candidates = await evaluateCashflowReinvest(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].txn_type).toBe('REDEMPTION');
  });

  it('should look back exactly 30 days', async () => {
    const portfolio = makePortfolioAgg({ cash_pct: 22 });
    const portfolioModel = makePortfolioModel([portfolio]);
    const txnModel = makeTransactionModel(makeTxn());

    await evaluateCashflowReinvest(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    // Verify the findOne query was called with txn_type and txn_date filters
    const callArg = txnModel.findOne.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg['txn_type']).toEqual({ $in: ['SELL', 'REDEMPTION'] });
    const txnDateFilter = callArg['txn_date'] as { $gte: Date };
    expect(txnDateFilter).toHaveProperty('$gte');

    const cutoff = txnDateFilter['$gte'];
    const expectedCutoff = new Date(Date.now() - 30 * 86_400_000);
    // Allow a 5-second tolerance for test execution time
    expect(Math.abs(cutoff.getTime() - expectedCutoff.getTime())).toBeLessThan(5_000);
  });

  it('should return recent_inflow_amount in result', async () => {
    const portfolio = makePortfolioAgg({ cash_pct: 35 });
    const portfolioModel = makePortfolioModel([portfolio]);
    const txn = makeTxn({ amount: 500_000 });
    const txnModel = makeTransactionModel(txn);

    const candidates = await evaluateCashflowReinvest(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].recent_inflow_amount).toBe(500_000);
  });
});

// ---------------------------------------------------------------------------
// buildCashflowReinvestMessage()
// ---------------------------------------------------------------------------

describe('buildCashflowReinvestMessage()', () => {
  const candidate: CashflowReinvestCandidate = {
    client_id: 'C001',
    client_name: 'Priya Mehta',
    client_tier: 'HNI',
    cash_balance: 300_000,
    cash_pct: 25.5,
    recent_inflow_amount: 150_000,
    txn_type: 'REDEMPTION',
  };

  it('should include client name', () => {
    const msg = buildCashflowReinvestMessage(candidate);
    expect(msg).toContain('Priya Mehta');
  });

  it('should include formatted inflow amount', () => {
    const msg = buildCashflowReinvestMessage(candidate);
    expect(msg).toContain('1,50,000');
  });

  it('should include transaction type', () => {
    const msg = buildCashflowReinvestMessage(candidate);
    expect(msg).toContain('REDEMPTION');
  });

  it('should include cash percentage', () => {
    const msg = buildCashflowReinvestMessage(candidate);
    expect(msg).toContain('25.5%');
  });

  it('should mention reinvestment', () => {
    const msg = buildCashflowReinvestMessage(candidate);
    expect(msg.toLowerCase()).toContain('reinvest');
  });
});

// ---------------------------------------------------------------------------
// CASHFLOW_REINVEST_RULE constant
// ---------------------------------------------------------------------------

describe('CASHFLOW_REINVEST_RULE constant', () => {
  it('should have rule_id RULE-CASHFLOW-REINVEST', () => {
    expect(CASHFLOW_REINVEST_RULE.rule_id).toBe('RULE-CASHFLOW-REINVEST');
  });

  it('should have severity medium', () => {
    expect(CASHFLOW_REINVEST_RULE.severity).toBe('medium');
  });

  it('should have cooldown_hours of 168', () => {
    expect(CASHFLOW_REINVEST_RULE.cooldown_hours).toBe(168);
  });

  it('should have min_cash_pct of 20', () => {
    expect(CASHFLOW_REINVEST_RULE.conditions['min_cash_pct']).toBe(20);
  });

  it('should have lookback_days of 30', () => {
    expect(CASHFLOW_REINVEST_RULE.conditions['lookback_days']).toBe(30);
  });
});
