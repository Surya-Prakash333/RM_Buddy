import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../../database/models/portfolio.model';
import {
  evaluateCrossSell,
  buildCrossSellMessage,
  CROSS_SELL_RULE,
  CrossSellCandidate,
} from '../cross-sell.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM-TEST-001';

/**
 * Build a minimal aggregation result row as returned by evaluateCrossSell.
 * The aggregate mock resolves to these rows directly; the function maps them
 * into CrossSellCandidate objects.
 */
const makeAggRow = (overrides: Partial<{
  client_id: string;
  client_name: string;
  client_tier: string;
  total_aum: number;
  product_count: number;
  current_products: string[];
}> = {}) => ({
  client_id: 'client-001',
  client_name: 'Anil Sharma',
  client_tier: 'HNI',
  total_aum: 6_000_000,
  product_count: 1,
  current_products: ['EQ'],
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

describe('CrossSellRule', () => {
  // -------------------------------------------------------------------------
  // Rule config
  // -------------------------------------------------------------------------

  it('should have the correct rule_id and alert_type', () => {
    expect(CROSS_SELL_RULE.rule_id).toBe('RULE-CROSS-SELL');
    expect(CROSS_SELL_RULE.alert_type).toBe('CROSS_SELL');
  });

  it('should have a 7-day (168-hour) cooldown', () => {
    expect(CROSS_SELL_RULE.cooldown_hours).toBe(168);
  });

  // -------------------------------------------------------------------------
  // evaluateCrossSell — flagging logic
  // -------------------------------------------------------------------------

  it('should flag client with 1 product type and AUM > ₹50L', async () => {
    const row = makeAggRow({ product_count: 1, current_products: ['EQ'], total_aum: 6_000_000 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateCrossSell(model, RM_ID);

    expect(results).toHaveLength(1);
    expect(results[0].product_count).toBe(1);
    expect(results[0].total_aum).toBeGreaterThanOrEqual(5_000_000);
  });

  it('should flag client with 2 product types and AUM > ₹50L', async () => {
    const row = makeAggRow({
      product_count: 2,
      current_products: ['EQ', 'MF'],
      total_aum: 8_000_000,
    });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateCrossSell(model, RM_ID);

    expect(results).toHaveLength(1);
    expect(results[0].product_count).toBe(2);
  });

  it('should NOT flag client with 3+ product types (aggregate returns empty)', async () => {
    // The aggregation $match on { $lt: [..., max_products] } would exclude them;
    // we model this by returning an empty array from aggregate.
    const model = makePortfolioModelMock([]);

    const results = await evaluateCrossSell(model, RM_ID);

    expect(results).toHaveLength(0);
  });

  it('should NOT flag client with AUM < ₹50L (aggregate returns empty)', async () => {
    // AUM below the min threshold — excluded by the $match in the pipeline.
    const model = makePortfolioModelMock([]);

    const results = await evaluateCrossSell(model, RM_ID);

    expect(results).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // missing_products computation
  // -------------------------------------------------------------------------

  it('should identify missing products correctly for a client with only EQ', async () => {
    const row = makeAggRow({ current_products: ['EQ'], product_count: 1 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateCrossSell(model, RM_ID);

    expect(results[0].missing_products).toEqual(
      expect.arrayContaining(['FI', 'MF', 'INSURANCE', 'PMS', 'AIF']),
    );
    expect(results[0].missing_products).not.toContain('EQ');
  });

  it('should identify missing products correctly for a client with EQ and MF', async () => {
    const row = makeAggRow({ current_products: ['EQ', 'MF'], product_count: 2 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateCrossSell(model, RM_ID);

    expect(results[0].missing_products).toEqual(
      expect.arrayContaining(['FI', 'INSURANCE', 'PMS', 'AIF']),
    );
    expect(results[0].missing_products).not.toContain('EQ');
    expect(results[0].missing_products).not.toContain('MF');
  });

  // -------------------------------------------------------------------------
  // product_count field
  // -------------------------------------------------------------------------

  it('should return product_count as the number of distinct asset classes', async () => {
    const row = makeAggRow({ current_products: ['EQ', 'FI'], product_count: 2 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateCrossSell(model, RM_ID);

    expect(results[0].product_count).toBe(2);
  });

  // -------------------------------------------------------------------------
  // buildCrossSellMessage
  // -------------------------------------------------------------------------

  it('should build a message mentioning client name, product count and top missing products', () => {
    const candidate: CrossSellCandidate = {
      client_id: 'client-001',
      client_name: 'Anil Sharma',
      client_tier: 'HNI',
      total_aum: 5_000_000,
      product_count: 1,
      current_products: ['EQ'],
      missing_products: ['FI', 'MF', 'INSURANCE', 'PMS', 'AIF'],
    };

    const msg = buildCrossSellMessage(candidate);

    expect(msg).toContain('Anil Sharma');
    expect(msg).toContain('1 product type(s)');
    expect(msg).toContain('FI');
    expect(msg).toContain('MF');
  });

  // -------------------------------------------------------------------------
  // aggregate pipeline — verify RM ID is passed through
  // -------------------------------------------------------------------------

  it('should call aggregate with the provided rm_id', async () => {
    const model = makePortfolioModelMock([]);
    await evaluateCrossSell(model, RM_ID);

    expect(model.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({ rm_id: RM_ID }),
        }),
      ]),
    );
  });
});
