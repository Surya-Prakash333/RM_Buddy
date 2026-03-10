import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../database/models/portfolio.model';
import { TransactionDocument } from '../../../database/models/transaction.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-F21 Idle Cash
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Idle Cash alert (S2-F21).
 *
 * Fires when a client has:
 *  - Cash percentage > 30% of portfolio
 *  - Absolute cash balance > ₹1L (100,000)
 *  - No executed investment transaction in the last 30 days
 *
 * Severity : HIGH (P2)
 * Cooldown : 7 days (168 hours) — re-alert once per week at most
 */
export const IDLE_CASH_RULE: AlertRule = {
  rule_id: 'RULE-IDLE-CASH',
  alert_type: 'idle_cash',
  name: 'Idle Cash Alert',
  severity: 'high',
  cooldown_hours: 168,
  channels: ['IN_APP', 'VOICE'],
  conditions: {
    cash_pct_threshold: 30,          // % of portfolio
    cash_balance_threshold: 100_000, // ₹1L minimum
    idle_days: 30,                   // no investment in last N days
  },
};

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

export interface IdleCashCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  cash_balance: number;
  cash_pct: number;
  days_idle: number;
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` whose portfolios have excess idle cash.
 *
 * Algorithm:
 *  1. Aggregate portfolios where cash_pct > 30 AND cash_balance > 100,000.
 *  2. For each portfolio, check whether any executed transaction exists
 *     in the last 30 days.  If none found → idle cash candidate.
 *
 * @returns Array of candidates (may be empty).
 */
export async function evaluateIdleCash(
  portfolioModel: Model<PortfolioDocument>,
  transactionModel: Model<TransactionDocument>,
  rmId: string,
): Promise<IdleCashCandidate[]> {
  const cashPctThreshold = (IDLE_CASH_RULE.conditions['cash_pct_threshold'] as number);
  const cashBalanceThreshold = (IDLE_CASH_RULE.conditions['cash_balance_threshold'] as number);
  const idleDays = (IDLE_CASH_RULE.conditions['idle_days'] as number);

  // Step 1 — portfolios exceeding the cash thresholds
  const portfolios = await portfolioModel.aggregate<{
    client_id: string;
    client_name: string;
    client_tier: string;
    cash_balance: number;
    cash_pct: number;
  }>([
    {
      $match: {
        rm_id: rmId,
        'summary.cash_pct': { $gt: cashPctThreshold },
        'summary.cash_balance': { $gt: cashBalanceThreshold },
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

  if (portfolios.length === 0) return [];

  // Step 2 — filter out clients that had a recent transaction
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - idleDays);

  const candidates: IdleCashCandidate[] = [];

  for (const p of portfolios) {
    const lastTxn = await transactionModel
      .findOne(
        { client_id: p.client_id, txn_date: { $gte: cutoff }, status: 'Executed' },
        { txn_date: 1 },
      )
      .sort({ txn_date: -1 })
      .lean()
      .exec();

    if (!lastTxn) {
      // No executed transaction in the idle window → flag as idle cash
      candidates.push({
        client_id: p.client_id,
        client_name: p.client_name,
        client_tier: p.client_tier ?? 'STANDARD',
        cash_balance: p.cash_balance,
        cash_pct: p.cash_pct,
        days_idle: idleDays, // at minimum idleDays have elapsed
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/**
 * Format an Idle Cash alert message for a candidate.
 *
 * Example: "₹1,50,000 idle for 30+ days (35% of portfolio). Suggest SIP or FD reinvestment."
 */
export function buildIdleCashMessage(candidate: IdleCashCandidate): string {
  const formattedBalance = candidate.cash_balance.toLocaleString('en-IN');
  return (
    `₹${formattedBalance} idle for ${candidate.days_idle}+ days ` +
    `(${candidate.cash_pct.toFixed(1)}% of portfolio). ` +
    `Suggest SIP or FD reinvestment.`
  );
}
