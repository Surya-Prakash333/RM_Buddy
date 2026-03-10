import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../database/models/portfolio.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-N6 Tax Loss Harvesting
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Tax Loss Harvesting alert (S2-N6).
 *
 * Fires when:
 *  - Client has unrealized loss > ₹50,000 on any equity holding
 *  - The Indian financial year-end (March 31) is within 60 days
 *
 * Severity : MEDIUM (P3)
 * Cooldown : 7 days (168 hours) — re-alert once per week at most
 */
export const TAX_LOSS_HARVESTING_RULE: AlertRule = {
  rule_id: 'RULE-TAX-LOSS-HARVEST',
  alert_type: 'TAX_LOSS_HARVESTING',
  name: 'Tax Loss Harvesting Opportunity',
  severity: 'medium',
  cooldown_hours: 168, // 7 days
  channels: ['IN_APP'],
  conditions: {
    min_unrealized_loss: 50000,   // ₹50K minimum loss
    fy_end_buffer_days: 60,       // alert if within 60 days of March 31
  },
};

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

export interface TaxLossCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  total_unrealized_loss: number;   // sum of negative pnl across holdings
  holdings_in_loss: {
    instrument_name: string;
    pnl: number;
    pnl_pct: number;
  }[];
  days_until_fy_end: number;
}

// ---------------------------------------------------------------------------
// FY-end proximity helper
// ---------------------------------------------------------------------------

/**
 * Returns true when today is within `daysThreshold` days of Indian FY end
 * (March 31).  Handles year-boundary: if March 31 has already passed this
 * calendar year, the next March 31 is used.
 */
export function isDaysBeforeFYEnd(daysThreshold: number): boolean {
  const now = new Date();
  const fyEnd = new Date(now.getFullYear(), 2, 31); // March 31 same year
  if (fyEnd < now) {
    fyEnd.setFullYear(now.getFullYear() + 1); // next year's March 31
  }
  const daysUntil = Math.ceil((fyEnd.getTime() - now.getTime()) / 86400000);
  return daysUntil <= daysThreshold;
}

/**
 * Compute the number of days remaining until Indian FY end (March 31).
 */
export function daysUntilFYEnd(): number {
  const now = new Date();
  const fyEnd = new Date(now.getFullYear(), 2, 31);
  if (fyEnd < now) {
    fyEnd.setFullYear(now.getFullYear() + 1);
  }
  return Math.ceil((fyEnd.getTime() - now.getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` who have equity holdings with significant
 * unrealized losses and are within the FY-end harvesting window.
 *
 * Algorithm:
 *  1. Return empty if NOT within 60 days of March 31.
 *  2. Aggregate portfolios: unwind holdings, filter equity losses > ₹50K,
 *     group by client, join client details.
 *
 * @returns Array of candidates sorted by total_unrealized_loss ascending
 *          (most loss first), may be empty.
 */
export async function evaluateTaxLossHarvesting(
  portfolioModel: Model<PortfolioDocument>,
  rmId: string,
): Promise<TaxLossCandidate[]> {
  const fyEndBufferDays = (TAX_LOSS_HARVESTING_RULE.conditions['fy_end_buffer_days'] as number);
  const minUnrealizedLoss = (TAX_LOSS_HARVESTING_RULE.conditions['min_unrealized_loss'] as number);

  // Only fire if within the FY-end buffer window
  if (!isDaysBeforeFYEnd(fyEndBufferDays)) return [];

  const remainingDays = daysUntilFYEnd();

  const results = await portfolioModel.aggregate<Omit<TaxLossCandidate, 'days_until_fy_end'>>([
    { $match: { rm_id: rmId } },
    { $unwind: '$holdings' },
    {
      $match: {
        'holdings.pnl': { $lt: -minUnrealizedLoss }, // loss > ₹50K
        'holdings.asset_class': 'EQ',                 // equity only
      },
    },
    {
      $group: {
        _id: '$client_id',
        total_unrealized_loss: { $sum: '$holdings.pnl' },
        holdings_in_loss: {
          $push: {
            instrument_name: '$holdings.instrument_name',
            pnl: '$holdings.pnl',
            pnl_pct: '$holdings.pnl_pct',
          },
        },
      },
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
        total_unrealized_loss: 1,
        holdings_in_loss: 1,
      },
    },
    { $sort: { total_unrealized_loss: 1 } }, // most loss first (most negative)
  ]);

  // Attach days_until_fy_end to each candidate
  return results.map((r) => ({ ...r, days_until_fy_end: remainingDays }));
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/**
 * Format a Tax Loss Harvesting alert message for a candidate.
 *
 * Example:
 *   "Priya Sharma has ₹75,000 unrealized loss in 2 equity holdings.
 *    Consider tax-loss harvesting before FY end (45 days)."
 */
export function buildTaxLossHarvestingMessage(candidate: TaxLossCandidate): string {
  const lossAbs = Math.abs(candidate.total_unrealized_loss);
  const lossFormatted = lossAbs.toLocaleString('en-IN');
  const count = candidate.holdings_in_loss.length;
  return (
    `${candidate.client_name} has ₹${lossFormatted} unrealized loss in ` +
    `${count} equity holding${count === 1 ? '' : 's'}. ` +
    `Consider tax-loss harvesting before FY end (${candidate.days_until_fy_end} days).`
  );
}
