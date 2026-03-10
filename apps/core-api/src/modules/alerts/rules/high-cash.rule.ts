import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../database/models/portfolio.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-F25 High Cash Allocation
// ---------------------------------------------------------------------------

export const HIGH_CASH_RULE: AlertRule = {
  rule_id: 'RULE-HIGH-CASH',
  alert_type: 'HIGH_CASH_ALLOCATION',
  name: 'High Cash Allocation',
  conditions: {
    cash_pct_threshold: 30,   // > 30% in cash
    min_cash_balance: 200_000, // ₹2L minimum (filter small portfolios)
  },
  cooldown_hours: 72, // 3 days
  severity: 'medium',
  channels: ['IN_APP'],
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface HighCashCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  cash_balance: number;
  cash_pct: number;
  total_aum: number;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Identify clients with cash allocation > 30% of portfolio AND cash balance
 * of at least ₹2L, sorted by cash_pct descending (worst offenders first).
 */
export async function evaluateHighCash(
  portfolioModel: Model<PortfolioDocument>,
  rmId: string,
): Promise<HighCashCandidate[]> {
  const cashPctThreshold = (HIGH_CASH_RULE.conditions['cash_pct_threshold'] as number);
  const minCashBalance = (HIGH_CASH_RULE.conditions['min_cash_balance'] as number);

  return portfolioModel.aggregate<HighCashCandidate>([
    {
      $match: {
        rm_id: rmId,
        'summary.cash_pct': { $gt: cashPctThreshold },
        'summary.cash_balance': { $gte: minCashBalance },
      },
    },
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
        cash_balance: '$summary.cash_balance',
        cash_pct: '$summary.cash_pct',
        total_aum: '$summary.total_aum',
      },
    },
    { $sort: { cash_pct: -1 } },
  ]);
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/** Format rupees in Indian notation (e.g. 200000 → "2,00,000"). */
function formatIndian(amount: number): string {
  return amount.toLocaleString('en-IN');
}

/**
 * Build the alert message for a high-cash candidate.
 *
 * Example: "Priya Mehta's portfolio is 45% cash (₹2,50,000).
 *           Review investment strategy."
 */
export function buildHighCashMessage(candidate: HighCashCandidate): string {
  return (
    `${candidate.client_name}'s portfolio is ${candidate.cash_pct}% cash ` +
    `(₹${formatIndian(candidate.cash_balance)}). Review investment strategy.`
  );
}
