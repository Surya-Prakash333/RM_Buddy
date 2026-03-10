import { Model } from 'mongoose';
import { TransactionDocument } from '../../../database/models/transaction.model';
import { ClientDocument } from '../../../database/models/client.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-F26 High Trading Frequency
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the High Trading Frequency alert (S2-F26).
 *
 * Fires when a client executes more than 5 trades within a 7-day window,
 * indicating potential overtrading risk that warrants RM review.
 *
 * Severity : MEDIUM (P3)
 * Cooldown : 24 hours — re-alert at most once per day
 */
export const HIGH_TRADING_FREQ_RULE: AlertRule = {
  rule_id: 'RULE-HIGH-TRADING',
  alert_type: 'HIGH_TRADING_FREQ',
  name: 'High Trading Frequency',
  severity: 'medium',
  cooldown_hours: 24,
  channels: ['IN_APP'],
  conditions: { trades_per_week: 5 },
};

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

export interface HighTradingCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  trade_count: number;       // trades in last 7 days
  total_traded_value: number;
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` who have executed more than 5 trades in the
 * last 7 days, sorted by trade_count descending.
 *
 * Algorithm:
 *  1. Aggregate executed transactions in the last 7 days grouped by client_id.
 *  2. Filter groups where trade_count > 5.
 *  3. Lookup client details (name, tier) from the clients collection.
 *
 * @returns Array of candidates (may be empty).
 */
export async function evaluateHighTradingFreq(
  transactionModel: Model<TransactionDocument>,
  clientModel: Model<ClientDocument>,
  rmId: string,
): Promise<HighTradingCandidate[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const results = await transactionModel.aggregate<HighTradingCandidate>([
    {
      $match: {
        rm_id: rmId,
        txn_date: { $gte: sevenDaysAgo },
        status: 'Executed',
      },
    },
    {
      $group: {
        _id: '$client_id',
        trade_count: { $sum: 1 },
        total_traded_value: { $sum: '$amount' },
      },
    },
    {
      $match: { trade_count: { $gt: 5 } },
    },
    {
      $lookup: {
        from: 'clients',
        localField: '_id',
        foreignField: 'client_id',
        as: 'client',
      },
    },
    { $unwind: '$client' },
    {
      $project: {
        _id: 0,
        client_id: '$_id',
        client_name: '$client.client_name',
        client_tier: '$client.tier',
        trade_count: 1,
        total_traded_value: 1,
      },
    },
    { $sort: { trade_count: -1 } },
  ]);

  return results;
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/**
 * Format a High Trading Frequency alert message for a candidate.
 *
 * Example: "Rajesh Kumar executed 8 trades this week (₹5,00,000).
 *           Review trading pattern — risk of overtrading."
 */
export function buildHighTradingMessage(candidate: HighTradingCandidate): string {
  const valueFormatted = candidate.total_traded_value.toLocaleString('en-IN');
  return (
    `${candidate.client_name} executed ${candidate.trade_count} trades this week ` +
    `(₹${valueFormatted}). Review trading pattern — risk of overtrading.`
  );
}
