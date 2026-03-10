import {
  evaluateIdleCash,
  buildIdleCashMessage,
  IDLE_CASH_RULE,
  IdleCashCandidate,
} from '../idle-cash.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

/** Build a minimal portfolio aggregate result object. */
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
  client_name: 'Rajesh Kumar',
  client_tier: 'HNI',
  cash_balance: 200_000,
  cash_pct: 35,
  ...overrides,
});

/** Build a mock Mongoose Model for portfolios. */
const makePortfolioModel = (aggregateResult: unknown[]) => ({
  aggregate: jest.fn().mockResolvedValue(aggregateResult),
});

/** Build a mock Mongoose Model for transactions. */
const makeTransactionModel = (findOneResult: unknown | null) => {
  const execMock = jest.fn().mockResolvedValue(findOneResult);
  const sortMock = jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: execMock }) });
  const leanMock = jest.fn().mockReturnValue({ exec: execMock });
  return {
    findOne: jest.fn().mockReturnValue({
      sort: sortMock,
      lean: leanMock,
    }),
    _execMock: execMock,
    _sortMock: sortMock,
  };
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('evaluateIdleCash()', () => {
  it('should flag client with cash_pct > 30% and no transaction in 30 days', async () => {
    const portfolio = makePortfolioAgg({ cash_pct: 35, cash_balance: 200_000 });
    const portfolioModel = makePortfolioModel([portfolio]);
    const txnModel = makeTransactionModel(null); // no recent transaction

    const candidates = await evaluateIdleCash(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
    expect(candidates[0].cash_pct).toBe(35);
    expect(candidates[0].cash_balance).toBe(200_000);
    expect(candidates[0].days_idle).toBe(IDLE_CASH_RULE.conditions['idle_days']);
  });

  it('should NOT flag client with a recent executed transaction (within 30 days)', async () => {
    const portfolio = makePortfolioAgg({ cash_pct: 40, cash_balance: 150_000 });
    const portfolioModel = makePortfolioModel([portfolio]);
    // Recent transaction found → client is NOT idle
    const txnModel = makeTransactionModel({ txn_id: 'TXN001', txn_date: new Date(), status: 'Executed' });

    const candidates = await evaluateIdleCash(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(0);
  });

  it('should NOT flag client with cash_pct <= 30%', async () => {
    // The aggregate $match filters these out — aggregate returns empty
    const portfolioModel = makePortfolioModel([]); // no portfolios pass filter
    const txnModel = makeTransactionModel(null);

    const candidates = await evaluateIdleCash(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(0);
    // Confirm findOne was never called because there were no portfolios to check
    expect(txnModel.findOne).not.toHaveBeenCalled();
  });

  it('should NOT flag client with cash_balance < ₹1L (100,000)', async () => {
    // The aggregate $match filters these out — aggregate returns empty
    const portfolioModel = makePortfolioModel([]); // no portfolios pass the cash_balance filter
    const txnModel = makeTransactionModel(null);

    const candidates = await evaluateIdleCash(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(0);
    expect(txnModel.findOne).not.toHaveBeenCalled();
  });

  it('should return days_idle equal to the configured idle_days minimum', async () => {
    const portfolio = makePortfolioAgg({ cash_pct: 45, cash_balance: 500_000 });
    const portfolioModel = makePortfolioModel([portfolio]);
    const txnModel = makeTransactionModel(null);

    const candidates = await evaluateIdleCash(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates[0].days_idle).toBe(30);
  });

  it('should handle multiple portfolios and only flag truly idle ones', async () => {
    const portfolios = [
      makePortfolioAgg({ client_id: 'C001', cash_pct: 35, cash_balance: 200_000 }),
      makePortfolioAgg({ client_id: 'C002', cash_pct: 40, cash_balance: 300_000 }),
    ];
    const portfolioModel = makePortfolioModel(portfolios);

    // C001: no recent transaction → idle
    // C002: has a recent transaction → not idle
    const c001TxnModel = { txn_id: 'T001', txn_date: new Date() };
    let callCount = 0;
    const txnModel = {
      findOne: jest.fn().mockImplementation(() => {
        callCount++;
        const result = callCount === 1 ? null : c001TxnModel;
        return {
          sort: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
          }),
        };
      }),
    };

    const candidates = await evaluateIdleCash(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
  });

  it('should return empty array when no portfolios match the cash threshold filter', async () => {
    const portfolioModel = makePortfolioModel([]);
    const txnModel = makeTransactionModel(null);

    const candidates = await evaluateIdleCash(
      portfolioModel as any,
      txnModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildIdleCashMessage()
// ---------------------------------------------------------------------------

describe('buildIdleCashMessage()', () => {
  const candidate: IdleCashCandidate = {
    client_id: 'C001',
    client_name: 'Rajesh Kumar',
    client_tier: 'HNI',
    cash_balance: 150_000,
    cash_pct: 35.5,
    days_idle: 30,
  };

  it('should include cash balance formatted in Indian numbering', () => {
    const msg = buildIdleCashMessage(candidate);
    expect(msg).toContain('1,50,000');
  });

  it('should include cash_pct percentage', () => {
    const msg = buildIdleCashMessage(candidate);
    expect(msg).toContain('35.5%');
  });

  it('should include reinvestment suggestion', () => {
    const msg = buildIdleCashMessage(candidate);
    expect(msg).toContain('SIP or FD reinvestment');
  });

  it('should include days_idle in the message', () => {
    const msg = buildIdleCashMessage(candidate);
    expect(msg).toContain('30+');
  });
});

// ---------------------------------------------------------------------------
// IDLE_CASH_RULE constant
// ---------------------------------------------------------------------------

describe('IDLE_CASH_RULE constant', () => {
  it('should have rule_id RULE-IDLE-CASH', () => {
    expect(IDLE_CASH_RULE.rule_id).toBe('RULE-IDLE-CASH');
  });

  it('should have severity high', () => {
    expect(IDLE_CASH_RULE.severity).toBe('high');
  });

  it('should have cooldown_hours of 168 (7 days)', () => {
    expect(IDLE_CASH_RULE.cooldown_hours).toBe(168);
  });

  it('should have cash_pct_threshold of 30', () => {
    expect(IDLE_CASH_RULE.conditions['cash_pct_threshold']).toBe(30);
  });

  it('should have cash_balance_threshold of 100000', () => {
    expect(IDLE_CASH_RULE.conditions['cash_balance_threshold']).toBe(100_000);
  });
});
