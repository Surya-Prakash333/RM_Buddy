import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../database/models/portfolio.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-N4 Portfolio Drift
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Portfolio Drift alert (S2-N4).
 *
 * Fires when a client's portfolio allocation has drifted more than 8%
 * from a standard target allocation:
 *   Equity: 60%, Fixed Income: 30%, Cash+Other: 10%
 *
 * Severity : MEDIUM (P3)
 * Cooldown : 7 days (168 hours)
 */
export const PORTFOLIO_DRIFT_RULE: AlertRule = {
  rule_id: 'RULE-PORTFOLIO-DRIFT',
  alert_type: 'PORTFOLIO_DRIFT',
  name: 'Portfolio Drift Alert',
  severity: 'medium',
  cooldown_hours: 168,
  channels: ['IN_APP'],
  conditions: {
    drift_pct: 8,  // > 8% drift from any target allocation
  },
};

// ---------------------------------------------------------------------------
// Standard target allocations
// ---------------------------------------------------------------------------

/**
 * Standard model portfolio target weights (percentage).
 * Can be made client-configurable in a future iteration.
 */
export const TARGET_ALLOCATION = {
  EQ: 60,   // Equity
  FI: 30,   // Fixed Income
  CASH: 10, // Cash + Other
};

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

export interface PortfolioDriftCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  total_aum: number;
  actual_eq_pct: number;
  actual_fi_pct: number;
  actual_cash_pct: number;
  max_drift_pct: number;  // largest deviation from any target allocation
  drift_asset: string;    // which asset class is most off-target ('EQ' | 'FI' | 'CASH')
}

// ---------------------------------------------------------------------------
// Internal aggregation result shape
// ---------------------------------------------------------------------------

interface DriftAggRow {
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
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Determine which asset class has the largest deviation from its target.
 */
function computeLargestDriftAsset(row: DriftAggRow): string {
  if (row.eq_drift >= row.fi_drift && row.eq_drift >= row.cash_drift) {
    return 'EQ';
  }
  if (row.fi_drift >= row.eq_drift && row.fi_drift >= row.cash_drift) {
    return 'FI';
  }
  return 'CASH';
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` whose portfolios have drifted significantly
 * from the standard target allocation.
 *
 * Uses the MongoDB aggregation pipeline to compute per-asset percentages
 * and drift values directly, then filters for max_drift > 8%.
 *
 * @returns Array of candidates sorted by max_drift_pct descending.
 */
export async function evaluatePortfolioDrift(
  portfolioModel: Model<PortfolioDocument>,
  rmId: string,
): Promise<PortfolioDriftCandidate[]> {
  const driftThreshold = (PORTFOLIO_DRIFT_RULE.conditions['drift_pct'] as number);

  const portfolios = await portfolioModel.aggregate<DriftAggRow>([
    { $match: { rm_id: rmId } },
    {
      $addFields: {
        eq_pct: {
          $multiply: [
            {
              $divide: [
                { $ifNull: ['$summary.by_asset_class.EQ', 0] },
                { $max: ['$summary.total_aum', 1] },
              ],
            },
            100,
          ],
        },
        fi_pct: {
          $multiply: [
            {
              $divide: [
                { $ifNull: ['$summary.by_asset_class.FI', 0] },
                { $max: ['$summary.total_aum', 1] },
              ],
            },
            100,
          ],
        },
        cash_pct_actual: '$summary.cash_pct',
      },
    },
    {
      $addFields: {
        eq_drift: { $abs: { $subtract: ['$eq_pct', TARGET_ALLOCATION.EQ] } },
        fi_drift: { $abs: { $subtract: ['$fi_pct', TARGET_ALLOCATION.FI] } },
        cash_drift: { $abs: { $subtract: ['$cash_pct_actual', TARGET_ALLOCATION.CASH] } },
      },
    },
    {
      $addFields: {
        max_drift: { $max: ['$eq_drift', '$fi_drift', '$cash_drift'] },
      },
    },
    { $match: { max_drift: { $gt: driftThreshold } } },
    {
      $lookup: {
        from: 'clients',
        localField: 'client_id',
        foreignField: 'client_id',
        as: 'client',
      },
    },
    { $unwind: '$client' },
    {
      $project: {
        _id: 0,
        client_id: 1,
        client_name: '$client.client_name',
        client_tier: '$client.tier',
        total_aum: '$summary.total_aum',
        actual_eq_pct: '$eq_pct',
        actual_fi_pct: '$fi_pct',
        actual_cash_pct: '$cash_pct_actual',
        max_drift_pct: '$max_drift',
        eq_drift: 1,
        fi_drift: 1,
        cash_drift: 1,
      },
    },
    { $sort: { max_drift_pct: -1 } },
  ]);

  // Compute drift_asset in JS after aggregation
  return portfolios.map((p) => ({
    client_id: p.client_id,
    client_name: p.client_name,
    client_tier: p.client_tier ?? 'STANDARD',
    total_aum: p.total_aum,
    actual_eq_pct: p.actual_eq_pct,
    actual_fi_pct: p.actual_fi_pct,
    actual_cash_pct: p.actual_cash_pct,
    max_drift_pct: p.max_drift_pct,
    drift_asset: computeLargestDriftAsset(p),
  }));
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/**
 * Build the alert message for a Portfolio Drift candidate.
 *
 * Example:
 *   "Priya Mehta's portfolio has drifted 20.0% from target
 *    (EQ: 80.0% vs target 60%). Review allocation."
 */
export function buildPortfolioDriftMessage(
  candidate: PortfolioDriftCandidate,
): string {
  const targetMap: Record<string, number> = {
    EQ: TARGET_ALLOCATION.EQ,
    FI: TARGET_ALLOCATION.FI,
    CASH: TARGET_ALLOCATION.CASH,
  };
  const actualMap: Record<string, number> = {
    EQ: candidate.actual_eq_pct,
    FI: candidate.actual_fi_pct,
    CASH: candidate.actual_cash_pct,
  };

  const driftAsset = candidate.drift_asset;
  const actual = actualMap[driftAsset]?.toFixed(1) ?? '?';
  const target = targetMap[driftAsset] ?? '?';

  return (
    `${candidate.client_name}'s portfolio has drifted ${candidate.max_drift_pct.toFixed(1)}% ` +
    `from target (${driftAsset}: ${actual}% vs target ${target}%). Review allocation.`
  );
}
