import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../database/models/portfolio.model';
import { TransactionDocument } from '../../../database/models/transaction.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-N2 Cashflow Reinvestment
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Cashflow Reinvestment alert (S2-N2).
 *
 * Fires when a client:
 *  - Has cash_pct > 20% of portfolio value
 *  - Had a SELL or REDEMPTION transaction in the last 30 days
 *    (proxy for a recent dividend/interest/maturity inflow)
 *
 * Severity : MEDIUM (P3)
 * Cooldown : 7 days (168 hours)
 */
export const CASHFLOW_REINVEST_RULE: AlertRule = {
  rule_id: 'RULE-CASHFLOW-REINVEST',
  alert_type: 'CASHFLOW_REINVEST',
  name: 'Cashflow Reinvestment Opportunity',
  severity: 'medium',
  cooldown_hours: 168,
  channels: ['IN_APP'],
  conditions: {
    min_cash_pct: 20,    // portfolio cash % threshold
    lookback_days: 30,   // dividend/interest in last 30 days
  },
};

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

export interface CashflowReinvestCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  cash_balance: number;
  cash_pct: number;
  recent_inflow_amount: number;  // estimated from transaction history or portfolio change
  txn_type: string;              // SELL or REDEMPTION that triggered the flag
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` who have excess cash following a recent
 * SELL or REDEMPTION transaction.
 *
 * Algorithm:
 *  1. Find portfolios where cash_pct > 20%.
 *  2. For each portfolio, look for a SELL or REDEMPTION transaction in the
 *     last 30 days — this is a proxy for a recent cashflow event.
 *  3. If found → flag the client as a reinvestment candidate.
 *
 * @returns Array of candidates (may be empty).
 */
export async function evaluateCashflowReinvest(
  portfolioModel: Model<PortfolioDocument>,
  transactionModel: Model<TransactionDocument>,
  rmId: string,
): Promise<CashflowReinvestCandidate[]> {
  const minCashPct = (CASHFLOW_REINVEST_RULE.conditions['min_cash_pct'] as number);
  const lookbackDays = (CASHFLOW_REINVEST_RULE.conditions['lookback_days'] as number);

  // Step 1 — portfolios with high cash percentage
  const highCashPortfolios = await portfolioModel.aggregate<{
    client_id: string;
    client_name: string;
    client_tier: string;
    cash_balance: number;
    cash_pct: number;
  }>([
    {
      $match: {
        rm_id: rmId,
        'summary.cash_pct': { $gt: minCashPct },
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
      },
    },
  ]);

  if (highCashPortfolios.length === 0) return [];

  // Step 2 — check for a recent SELL or REDEMPTION (cashflow proxy)
  const cutoff = new Date(Date.now() - lookbackDays * 86_400_000);

  const candidates: CashflowReinvestCandidate[] = [];

  for (const p of highCashPortfolios) {
    const recentSell = await transactionModel
      .findOne({
        client_id: p.client_id,
        txn_type: { $in: ['SELL', 'REDEMPTION'] },
        txn_date: { $gte: cutoff },
      })
      .lean()
      .exec();

    if (recentSell) {
      candidates.push({
        client_id: p.client_id,
        client_name: p.client_name,
        client_tier: p.client_tier ?? 'STANDARD',
        cash_balance: p.cash_balance,
        cash_pct: p.cash_pct,
        recent_inflow_amount: (recentSell as { amount?: number }).amount ?? 0,
        txn_type: (recentSell as { txn_type?: string }).txn_type ?? 'SELL',
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/**
 * Build the alert message for a Cashflow Reinvestment candidate.
 *
 * Example:
 *   "Priya Mehta received ₹1,50,000 from recent REDEMPTION.
 *    25.0% cash sitting idle — suggest reinvestment."
 */
export function buildCashflowReinvestMessage(
  candidate: CashflowReinvestCandidate,
): string {
  const formattedAmount = candidate.recent_inflow_amount.toLocaleString('en-IN');
  return (
    `${candidate.client_name} received ₹${formattedAmount} from recent ${candidate.txn_type}. ` +
    `${candidate.cash_pct.toFixed(1)}% cash sitting idle — suggest reinvestment.`
  );
}
