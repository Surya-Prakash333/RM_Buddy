import {
  evaluateTaxLossHarvesting,
  isDaysBeforeFYEnd,
  TAX_LOSS_HARVESTING_RULE,
  TaxLossCandidate,
  buildTaxLossHarvestingMessage,
} from '../tax-loss-harvesting.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

/** Build a minimal aggregate result matching a TaxLossCandidate (without days_until_fy_end). */
const makeAggResult = (
  overrides: Partial<Omit<TaxLossCandidate, 'days_until_fy_end'>> = {},
) => ({
  client_id: 'C001',
  client_name: 'Priya Sharma',
  client_tier: 'HNI',
  total_unrealized_loss: -80000,
  holdings_in_loss: [
    { instrument_name: 'INFY', pnl: -60000, pnl_pct: -12.5 },
    { instrument_name: 'TCS', pnl: -20000, pnl_pct: -5.0 },
  ],
  ...overrides,
});

/** Build a mock Mongoose Model for portfolios. */
const makePortfolioModel = (aggregateResult: unknown[]) => ({
  aggregate: jest.fn().mockResolvedValue(aggregateResult),
});

// ---------------------------------------------------------------------------
// isDaysBeforeFYEnd()
// ---------------------------------------------------------------------------

describe('isDaysBeforeFYEnd()', () => {
  it('isDaysBeforeFYEnd should return true when within threshold', () => {
    // Mock Date to be 30 days before March 31
    const mockDate = new Date(new Date().getFullYear(), 2, 1); // March 1 same year
    const realDate = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(mockDate);
        } else {
          // @ts-ignore
          super(...args);
        }
      }
    } as typeof Date;
    global.Date.now = () => mockDate.getTime();

    const result = isDaysBeforeFYEnd(60);
    expect(result).toBe(true);

    global.Date = realDate;
  });

  it('should return false when more than threshold days before FY end', () => {
    // Mock Date to be July 1 — well outside the 60-day window before March 31
    const mockDate = new Date(new Date().getFullYear(), 6, 1); // July 1
    const realDate = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(mockDate);
        } else {
          // @ts-ignore
          super(...args);
        }
      }
    } as typeof Date;
    global.Date.now = () => mockDate.getTime();

    const result = isDaysBeforeFYEnd(60);
    expect(result).toBe(false);

    global.Date = realDate;
  });
});

// ---------------------------------------------------------------------------
// evaluateTaxLossHarvesting()
// ---------------------------------------------------------------------------

describe('evaluateTaxLossHarvesting()', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('should return empty array when NOT within 60 days of FY end', async () => {
    // Simulate being in July — far from March 31
    const mockDate = new Date(new Date().getFullYear(), 6, 1); // July 1
    const realDate = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(mockDate);
        } else {
          // @ts-ignore
          super(...args);
        }
      }
    } as typeof Date;
    global.Date.now = () => mockDate.getTime();

    const portfolioModel = makePortfolioModel([makeAggResult()]);
    const candidates = await evaluateTaxLossHarvesting(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(0);
    // aggregate should never be called when outside the window
    expect(portfolioModel.aggregate).not.toHaveBeenCalled();

    global.Date = realDate;
  });

  it('should return candidates when within 60 days of FY end', async () => {
    // Simulate being in February — within 60 days of March 31
    const mockDate = new Date(new Date().getFullYear(), 1, 10); // Feb 10
    const realDate = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(mockDate);
        } else {
          // @ts-ignore
          super(...args);
        }
      }
    } as typeof Date;
    global.Date.now = () => mockDate.getTime();

    const agg = makeAggResult();
    const portfolioModel = makePortfolioModel([agg]);
    const candidates = await evaluateTaxLossHarvesting(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
    expect(candidates[0].total_unrealized_loss).toBe(-80000);
    expect(candidates[0].days_until_fy_end).toBeGreaterThan(0);

    global.Date = realDate;
  });

  it('should flag holdings with pnl < -50000', async () => {
    const mockDate = new Date(new Date().getFullYear(), 1, 10); // Feb 10
    const realDate = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(mockDate);
        } else {
          // @ts-ignore
          super(...args);
        }
      }
    } as typeof Date;
    global.Date.now = () => mockDate.getTime();

    const agg = makeAggResult({
      holdings_in_loss: [{ instrument_name: 'WIPRO', pnl: -75000, pnl_pct: -15.0 }],
      total_unrealized_loss: -75000,
    });
    const portfolioModel = makePortfolioModel([agg]);
    const candidates = await evaluateTaxLossHarvesting(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].holdings_in_loss[0].pnl).toBe(-75000);

    global.Date = realDate;
  });

  it('should NOT flag holdings with loss < ₹50K', async () => {
    // Simulate Feb 10 (within window) but aggregate returns nothing
    // because the $match filter in the aggregate pipeline filters out small losses
    const mockDate = new Date(new Date().getFullYear(), 1, 10);
    const realDate = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(mockDate);
        } else {
          // @ts-ignore
          super(...args);
        }
      }
    } as typeof Date;
    global.Date.now = () => mockDate.getTime();

    // Aggregate returns empty because pnl = -30000 doesn't exceed -50000
    const portfolioModel = makePortfolioModel([]);
    const candidates = await evaluateTaxLossHarvesting(portfolioModel as any, RM_ID);

    expect(candidates).toHaveLength(0);

    global.Date = realDate;
  });

  it('should only check equity holdings (asset_class = EQ)', async () => {
    const mockDate = new Date(new Date().getFullYear(), 1, 10);
    const realDate = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(mockDate);
        } else {
          // @ts-ignore
          super(...args);
        }
      }
    } as typeof Date;
    global.Date.now = () => mockDate.getTime();

    // Aggregate should be called; verify the pipeline contains EQ filter
    const portfolioModel = makePortfolioModel([]);
    await evaluateTaxLossHarvesting(portfolioModel as any, RM_ID);

    const pipeline = portfolioModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const matchStages = pipeline.filter((s) => s['$match']);
    // One of the $match stages should restrict to asset_class EQ
    const hasEqFilter = matchStages.some(
      (s) => (s['$match'] as Record<string, unknown>)['holdings.asset_class'] === 'EQ',
    );
    expect(hasEqFilter).toBe(true);

    global.Date = realDate;
  });

  it('should compute total_unrealized_loss as sum of all losing holdings', async () => {
    const mockDate = new Date(new Date().getFullYear(), 1, 10);
    const realDate = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(mockDate);
        } else {
          // @ts-ignore
          super(...args);
        }
      }
    } as typeof Date;
    global.Date.now = () => mockDate.getTime();

    const agg = makeAggResult({
      total_unrealized_loss: -130000, // sum of -80000 + -50000
      holdings_in_loss: [
        { instrument_name: 'INFY', pnl: -80000, pnl_pct: -16.0 },
        { instrument_name: 'TCS', pnl: -50000, pnl_pct: -8.0 },
      ],
    });
    const portfolioModel = makePortfolioModel([agg]);
    const candidates = await evaluateTaxLossHarvesting(portfolioModel as any, RM_ID);

    expect(candidates[0].total_unrealized_loss).toBe(-130000);
    expect(candidates[0].holdings_in_loss).toHaveLength(2);

    global.Date = realDate;
  });
});

// ---------------------------------------------------------------------------
// TAX_LOSS_HARVESTING_RULE constant
// ---------------------------------------------------------------------------

describe('TAX_LOSS_HARVESTING_RULE constant', () => {
  it('should have rule_id RULE-TAX-LOSS-HARVEST', () => {
    expect(TAX_LOSS_HARVESTING_RULE.rule_id).toBe('RULE-TAX-LOSS-HARVEST');
  });

  it('should have severity medium', () => {
    expect(TAX_LOSS_HARVESTING_RULE.severity).toBe('medium');
  });

  it('should have cooldown_hours of 168 (7 days)', () => {
    expect(TAX_LOSS_HARVESTING_RULE.cooldown_hours).toBe(168);
  });

  it('should have min_unrealized_loss of 50000', () => {
    expect(TAX_LOSS_HARVESTING_RULE.conditions['min_unrealized_loss']).toBe(50000);
  });

  it('should have fy_end_buffer_days of 60', () => {
    expect(TAX_LOSS_HARVESTING_RULE.conditions['fy_end_buffer_days']).toBe(60);
  });

  it('should NOT have a description field', () => {
    expect((TAX_LOSS_HARVESTING_RULE as unknown as Record<string, unknown>)['description']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildTaxLossHarvestingMessage()
// ---------------------------------------------------------------------------

describe('buildTaxLossHarvestingMessage()', () => {
  const candidate: TaxLossCandidate = {
    client_id: 'C001',
    client_name: 'Priya Sharma',
    client_tier: 'HNI',
    total_unrealized_loss: -80000,
    holdings_in_loss: [
      { instrument_name: 'INFY', pnl: -60000, pnl_pct: -12.5 },
      { instrument_name: 'TCS', pnl: -20000, pnl_pct: -5.0 },
    ],
    days_until_fy_end: 45,
  };

  it('should include client name in message', () => {
    const msg = buildTaxLossHarvestingMessage(candidate);
    expect(msg).toContain('Priya Sharma');
  });

  it('should include formatted loss amount', () => {
    const msg = buildTaxLossHarvestingMessage(candidate);
    expect(msg).toContain('80,000');
  });

  it('should include holding count', () => {
    const msg = buildTaxLossHarvestingMessage(candidate);
    expect(msg).toContain('2 equity holdings');
  });

  it('should include days until FY end', () => {
    const msg = buildTaxLossHarvestingMessage(candidate);
    expect(msg).toContain('45 days');
  });
});
