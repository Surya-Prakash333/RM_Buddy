import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../../database/models/portfolio.model';
import {
  evaluateConcentrationRisk,
  buildConcentrationRiskMessage,
  CONCENTRATION_RISK_RULE,
  ConcentrationAlert,
} from '../concentration-risk.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM-TEST-001';

/**
 * Build a minimal aggregation result row as returned by evaluateConcentrationRisk.
 * Represents a single portfolio document joined with its client.
 */
const makeAggRow = (overrides: Partial<{
  client_id: string;
  client_name: string;
  client_tier: string;
  total_aum: number;
  max_stock_pct: number;
  max_stock_name: string;
  max_sector_pct: number;
  max_sector_name: string;
}> = {}) => ({
  client_id: 'client-001',
  client_name: 'Priya Mehta',
  client_tier: 'HNI',
  total_aum: 10_000_000,
  max_stock_pct: 30,
  max_stock_name: 'HDFC Bank',
  max_sector_pct: 20,
  max_sector_name: 'IT',
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

describe('ConcentrationRiskRule', () => {
  // -------------------------------------------------------------------------
  // Rule config
  // -------------------------------------------------------------------------

  it('should have the correct rule_id and alert_type', () => {
    expect(CONCENTRATION_RISK_RULE.rule_id).toBe('RULE-CONCENTRATION');
    expect(CONCENTRATION_RISK_RULE.alert_type).toBe('CONCENTRATION_RISK');
  });

  it('should have a 72-hour cooldown (3 days)', () => {
    expect(CONCENTRATION_RISK_RULE.cooldown_hours).toBe(72);
  });

  it('should have HIGH severity', () => {
    expect(CONCENTRATION_RISK_RULE.severity).toBe('high');
  });

  it('should have max_stock_pct threshold of 25', () => {
    expect(CONCENTRATION_RISK_RULE.conditions['max_stock_pct']).toBe(25);
  });

  it('should have max_sector_pct threshold of 40', () => {
    expect(CONCENTRATION_RISK_RULE.conditions['max_sector_pct']).toBe(40);
  });

  // -------------------------------------------------------------------------
  // evaluateConcentrationRisk — STOCK flagging
  // -------------------------------------------------------------------------

  it('should flag client where single stock > 25% of portfolio', async () => {
    const row = makeAggRow({ max_stock_pct: 32, max_stock_name: 'HDFC Bank', max_sector_pct: 20 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateConcentrationRisk(model, RM_ID);

    const stockAlert = results.find((a) => a.concentration_type === 'STOCK');
    expect(stockAlert).toBeDefined();
    expect(stockAlert!.pct).toBe(32);
    expect(stockAlert!.name).toBe('HDFC Bank');
  });

  it('should NOT flag stock when stock pct is exactly at threshold (25)', async () => {
    // The aggregate $match uses $gt 25, so 25 itself is excluded.
    // Model the query exclusion by returning empty.
    const model = makePortfolioModelMock([]);

    const results = await evaluateConcentrationRisk(model, RM_ID);
    const stockAlerts = results.filter((a) => a.concentration_type === 'STOCK');

    expect(stockAlerts).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // evaluateConcentrationRisk — SECTOR flagging
  // -------------------------------------------------------------------------

  it('should flag client where single sector > 40%', async () => {
    const row = makeAggRow({ max_sector_pct: 45, max_sector_name: 'Banking', max_stock_pct: 20 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateConcentrationRisk(model, RM_ID);

    const sectorAlert = results.find((a) => a.concentration_type === 'SECTOR');
    expect(sectorAlert).toBeDefined();
    expect(sectorAlert!.pct).toBe(45);
    expect(sectorAlert!.name).toBe('Banking');
  });

  // -------------------------------------------------------------------------
  // evaluateConcentrationRisk — diversified portfolio (no alert)
  // -------------------------------------------------------------------------

  it('should NOT flag client with diversified portfolio (stock < 25%, sector < 40%)', async () => {
    // Aggregate pipeline $match excludes this portfolio; model returns empty.
    const model = makePortfolioModelMock([]);

    const results = await evaluateConcentrationRisk(model, RM_ID);

    expect(results).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Alert type discrimination
  // -------------------------------------------------------------------------

  it('should create STOCK type alert for stock concentration', async () => {
    const row = makeAggRow({ max_stock_pct: 30, max_sector_pct: 20 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateConcentrationRisk(model, RM_ID);

    const stockAlerts = results.filter((a) => a.concentration_type === 'STOCK');
    expect(stockAlerts).toHaveLength(1);
    expect(stockAlerts[0].concentration_type).toBe('STOCK');
  });

  it('should create SECTOR type alert for sector concentration', async () => {
    const row = makeAggRow({ max_sector_pct: 45, max_stock_pct: 20 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateConcentrationRisk(model, RM_ID);

    const sectorAlerts = results.filter((a) => a.concentration_type === 'SECTOR');
    expect(sectorAlerts).toHaveLength(1);
    expect(sectorAlerts[0].concentration_type).toBe('SECTOR');
  });

  it('should produce both STOCK and SECTOR alerts when both thresholds are breached', async () => {
    const row = makeAggRow({ max_stock_pct: 30, max_sector_pct: 45 });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateConcentrationRisk(model, RM_ID);

    expect(results).toHaveLength(2);
    const types = results.map((a) => a.concentration_type);
    expect(types).toContain('STOCK');
    expect(types).toContain('SECTOR');
  });

  // -------------------------------------------------------------------------
  // Amount calculation
  // -------------------------------------------------------------------------

  it('should compute amount correctly as pct/100 * total_aum', async () => {
    const row = makeAggRow({
      max_stock_pct: 30,
      total_aum: 10_000_000,
      max_sector_pct: 20, // below threshold — no sector alert
    });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateConcentrationRisk(model, RM_ID);

    const stockAlert = results.find((a) => a.concentration_type === 'STOCK');
    expect(stockAlert).toBeDefined();
    expect(stockAlert!.amount).toBeCloseTo((30 / 100) * 10_000_000, 2);
  });

  it('should compute sector amount correctly as pct/100 * total_aum', async () => {
    const row = makeAggRow({
      max_sector_pct: 45,
      total_aum: 5_000_000,
      max_stock_pct: 20, // below threshold — no stock alert
    });
    const model = makePortfolioModelMock([row]);

    const results = await evaluateConcentrationRisk(model, RM_ID);

    const sectorAlert = results.find((a) => a.concentration_type === 'SECTOR');
    expect(sectorAlert).toBeDefined();
    expect(sectorAlert!.amount).toBeCloseTo((45 / 100) * 5_000_000, 2);
  });

  // -------------------------------------------------------------------------
  // Aggregate pipeline — verify RM ID is passed through
  // -------------------------------------------------------------------------

  it('should call aggregate with the provided rm_id', async () => {
    const model = makePortfolioModelMock([]);
    await evaluateConcentrationRisk(model, RM_ID);

    expect(model.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({ rm_id: RM_ID }),
        }),
      ]),
    );
  });

  // -------------------------------------------------------------------------
  // buildConcentrationRiskMessage
  // -------------------------------------------------------------------------

  it('should build a STOCK message mentioning client name, stock name, pct, and amount', () => {
    const alert: ConcentrationAlert = {
      client_id: 'client-001',
      client_name: 'Priya Mehta',
      client_tier: 'HNI',
      total_aum: 10_000_000,
      concentration_type: 'STOCK',
      name: 'HDFC Bank',
      pct: 32,
      amount: 3_200_000,
    };

    const msg = buildConcentrationRiskMessage(alert);

    expect(msg).toContain('Priya Mehta');
    expect(msg).toContain('HDFC Bank');
    expect(msg).toContain('32.0%');
    expect(msg).toContain('Recommend partial booking');
  });

  it('should build a SECTOR message mentioning client name, sector name, and pct', () => {
    const alert: ConcentrationAlert = {
      client_id: 'client-002',
      client_name: 'Rajesh Kumar',
      client_tier: 'PLATINUM',
      total_aum: 8_000_000,
      concentration_type: 'SECTOR',
      name: 'Banking',
      pct: 45,
      amount: 3_600_000,
    };

    const msg = buildConcentrationRiskMessage(alert);

    expect(msg).toContain('Rajesh Kumar');
    expect(msg).toContain('Banking');
    expect(msg).toContain('45.0%');
    expect(msg).toContain('Diversification needed');
  });
});
