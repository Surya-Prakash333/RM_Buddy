import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../database/models/portfolio.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-N7 Dividend Collection
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Dividend Collection alert (S2-N7).
 *
 * Fires when a client holds EQ positions >= ₹2L that may be eligible for
 * upcoming dividend payouts.  In production this would integrate with an
 * NSE/BSE dividend calendar API; this implementation uses holding value as
 * a proxy (requires market data integration for record-date awareness).
 *
 * Severity : LOW (P4)
 * Cooldown : 24 hours — daily check
 */
export const DIVIDEND_COLLECTION_RULE: AlertRule = {
  rule_id: 'RULE-DIVIDEND-COLLECTION',
  alert_type: 'DIVIDEND_COLLECTION',
  name: 'Dividend Collection Reminder',
  severity: 'low',
  cooldown_hours: 24, // daily
  channels: ['IN_APP'],
  conditions: {
    days_ahead: 3,              // dividend record date within 3 days
    min_holding_value: 200000,  // ₹2L minimum holding value
  },
};

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

export interface DividendCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  instrument_name: string;
  current_value: number;
  estimated_dividend: number; // estimated (0 if unknown — requires market data)
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` with EQ holdings >= ₹2L that may be
 * eligible for dividend collection.
 *
 * Simplified approach: flag clients with EQ holdings above the minimum
 * value threshold.  A production implementation would join against an
 * NSE/BSE dividend calendar to filter by upcoming record dates (within
 * `days_ahead` days).
 *
 * @returns Top 10 candidates sorted by current_value descending.
 */
export async function evaluateDividendCollection(
  portfolioModel: Model<PortfolioDocument>,
  rmId: string,
): Promise<DividendCandidate[]> {
  const minHoldingValue = (DIVIDEND_COLLECTION_RULE.conditions['min_holding_value'] as number);

  const results = await portfolioModel.aggregate<DividendCandidate>([
    { $match: { rm_id: rmId } },
    { $unwind: '$holdings' },
    {
      $match: {
        'holdings.asset_class': 'EQ',
        'holdings.current_value': { $gte: minHoldingValue },
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
        current_value: '$holdings.current_value',
        estimated_dividend: { $literal: 0 }, // requires market data integration
      },
    },
    { $sort: { current_value: -1 } },
    { $limit: 10 }, // top 10 by value
  ]);

  return results;
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/**
 * Format a Dividend Collection alert message for a candidate.
 *
 * Example:
 *   "Check dividend schedules for Amit Mehta's INFY holding (₹3,50,000).
 *    Confirm record date to ensure dividend eligibility."
 */
export function buildDividendCollectionMessage(candidate: DividendCandidate): string {
  const valueFormatted = candidate.current_value.toLocaleString('en-IN');
  return (
    `Check dividend schedules for ${candidate.client_name}'s ` +
    `${candidate.instrument_name} holding (₹${valueFormatted}). ` +
    `Confirm record date to ensure dividend eligibility.`
  );
}
