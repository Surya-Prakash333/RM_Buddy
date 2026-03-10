import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../database/models/portfolio.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-F31 Rebalancing Due
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Rebalancing Due alert (S2-F31).
 *
 * Fires when a portfolio has experienced a drawdown > 10% from its peak value.
 * Drawdown magnitude is used as a proxy for allocation drift: a portfolio that
 * has declined significantly from its peak is likely out of its target
 * allocation and warrants a rebalancing conversation.
 *
 * Severity : MEDIUM (P3)
 * Cooldown : 168 hours (7 days) — re-alert once per week at most
 */
export const REBALANCING_DUE_RULE: AlertRule = {
  rule_id: 'RULE-REBALANCING',
  alert_type: 'REBALANCING_DUE',
  name: 'Portfolio Rebalancing Due',
  severity: 'medium',
  cooldown_hours: 168,
  channels: ['IN_APP'],
  conditions: {
    drift_threshold_pct: 10, // > 10% drawdown from peak triggers rebalancing review
  },
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RebalancingDueCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  drawdown_pct: number;
  peak_value: number;
  current_value: number;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` whose portfolios have drifted beyond the
 * rebalancing threshold.
 *
 * Uses `drawdown.drawdown_pct` as a proxy for allocation drift severity.
 * Results are sorted by `drawdown_pct` descending so the worst cases appear
 * first.
 *
 * @returns Array of RebalancingDueCandidate objects sorted by drawdown_pct desc.
 */
export async function evaluateRebalancingDue(
  portfolioModel: Model<PortfolioDocument>,
  rmId: string,
): Promise<RebalancingDueCandidate[]> {
  const driftThreshold = (REBALANCING_DUE_RULE.conditions['drift_threshold_pct'] as number);

  return portfolioModel.aggregate<RebalancingDueCandidate>([
    {
      $match: {
        rm_id: rmId,
        'drawdown.drawdown_pct': { $gt: driftThreshold },
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
        drawdown_pct: '$drawdown.drawdown_pct',
        peak_value: '$drawdown.peak_value',
        current_value: '$drawdown.current_value',
      },
    },
    { $sort: { drawdown_pct: -1 } },
  ]);
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/** Format rupees in Indian notation (e.g. 1500000 → "15,00,000"). */
function formatIndian(amount: number): string {
  return amount.toLocaleString('en-IN');
}

/**
 * Build the alert message for a rebalancing due candidate.
 *
 * Example:
 *   "Rajesh Kumar's portfolio has declined 15.2% from peak
 *    (₹25,00,000 → ₹21,20,000). Review rebalancing opportunities."
 */
export function buildRebalancingDueMessage(candidate: RebalancingDueCandidate): string {
  return (
    `${candidate.client_name}'s portfolio has declined ${candidate.drawdown_pct.toFixed(1)}% from peak ` +
    `(₹${formatIndian(Math.round(candidate.peak_value))} → ₹${formatIndian(Math.round(candidate.current_value))}). ` +
    `Review rebalancing opportunities.`
  );
}
