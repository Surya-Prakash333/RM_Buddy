import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../database/models/portfolio.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-F22 Maturity Proceeds
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Maturity Proceeds alert (S2-F22).
 *
 * Fires when a portfolio holding has a maturity_date within the next 7 days
 * AND the current_value of that holding is >= ₹50,000.
 *
 * Severity : HIGH (P2)
 * Cooldown : 2 days (48 hours) — frequent reminders as the date approaches
 */
export const MATURITY_PROCEEDS_RULE: AlertRule = {
  rule_id: 'RULE-MATURITY',
  alert_type: 'maturity',
  name: 'Maturity Proceeds Alert',
  severity: 'high',
  cooldown_hours: 48,
  channels: ['IN_APP', 'VOICE'],
  conditions: {
    days_ahead: 7,      // alert if maturity within 7 days
    min_amount: 50_000, // ₹50K minimum maturity value
  },
};

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

export interface MaturityProceedsCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  instrument_name: string;
  maturity_date: Date;
  maturity_amount: number;
  days_until_maturity: number;
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify holdings under `rmId` that are maturing within the configured window.
 *
 * The function attempts to query portfolio holdings for a `maturity_date` field.
 * If the field is absent in the collection (older data schema), the aggregation
 * will simply return no results — no error is thrown.
 *
 * Graceful degradation: any unexpected aggregation error is caught and an empty
 * array is returned so the rest of the alert pipeline is not disrupted.
 *
 * @returns Array of candidates sorted by nearest maturity first (may be empty).
 */
export async function evaluateMaturityProceeds(
  portfolioModel: Model<PortfolioDocument>,
  rmId: string,
): Promise<MaturityProceedsCandidate[]> {
  const daysAhead = (MATURITY_PROCEEDS_RULE.conditions['days_ahead'] as number);
  const minAmount = (MATURITY_PROCEEDS_RULE.conditions['min_amount'] as number);

  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysAhead);

  try {
    const maturities = await portfolioModel.aggregate<MaturityProceedsCandidate>([
      { $match: { rm_id: rmId } },
      { $unwind: '$holdings' },
      {
        $match: {
          'holdings.maturity_date': { $gte: now, $lte: cutoff },
          'holdings.current_value': { $gte: minAmount },
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
          instrument_name: '$holdings.instrument_name',
          maturity_date: '$holdings.maturity_date',
          maturity_amount: '$holdings.current_value',
          days_until_maturity: {
            $ceil: {
              $divide: [
                { $subtract: ['$holdings.maturity_date', now] },
                86_400_000, // ms per day
              ],
            },
          },
        },
      },
      { $sort: { maturity_date: 1 } },
    ]);

    return maturities.map((m) => ({
      ...m,
      client_tier: m.client_tier ?? 'STANDARD',
    }));
  } catch {
    // Graceful degradation — maturity_date field may not exist in this environment
    return [];
  }
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/**
 * Format a Maturity Proceeds alert message for a candidate.
 *
 * Example: "HDFC FD maturing in 3 days (₹2,50,000). Discuss reinvestment options with Rajesh Kumar."
 */
export function buildMaturityProceedsMessage(candidate: MaturityProceedsCandidate): string {
  const formattedAmount = candidate.maturity_amount.toLocaleString('en-IN');
  return (
    `${candidate.instrument_name} maturing in ${candidate.days_until_maturity} day` +
    `${candidate.days_until_maturity === 1 ? '' : 's'} (₹${formattedAmount}). ` +
    `Discuss reinvestment options with ${candidate.client_name}.`
  );
}
