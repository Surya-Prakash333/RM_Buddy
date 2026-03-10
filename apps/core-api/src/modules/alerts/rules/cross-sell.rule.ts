import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../database/models/portfolio.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-F23 Cross-Sell Intel
// ---------------------------------------------------------------------------

export const CROSS_SELL_RULE: AlertRule = {
  rule_id: 'RULE-CROSS-SELL',
  alert_type: 'CROSS_SELL',
  name: 'Cross-Sell Opportunity',
  conditions: {
    max_products: 3,      // client has fewer than this many distinct product types
    min_aum: 5_000_000,   // ₹50L AUM minimum
  },
  cooldown_hours: 168, // 7 days
  severity: 'medium',  // P3
  channels: ['IN_APP'],
};

// ---------------------------------------------------------------------------
// Product universe
// ---------------------------------------------------------------------------

const ALL_PRODUCTS = ['EQ', 'FI', 'MF', 'INSURANCE', 'PMS', 'AIF'];

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface CrossSellCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  total_aum: number;
  product_count: number;
  current_products: string[];
  missing_products: string[];
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Identify clients with fewer than 3 distinct product types and AUM >= ₹50L.
 * Uses MongoDB aggregation to count distinct asset_class values across holdings.
 */
export async function evaluateCrossSell(
  portfolioModel: Model<PortfolioDocument>,
  rmId: string,
): Promise<CrossSellCandidate[]> {
  const minAum = (CROSS_SELL_RULE.conditions['min_aum'] as number);
  const maxProducts = (CROSS_SELL_RULE.conditions['max_products'] as number);

  const results = await portfolioModel.aggregate([
    // Only portfolios for this RM with AUM above the minimum
    {
      $match: {
        rm_id: rmId,
        'summary.total_aum': { $gte: minAum },
      },
    },
    // Unwind holdings to enumerate each position's asset class
    { $unwind: '$holdings' },
    // Group by client — collect distinct asset classes
    {
      $group: {
        _id: '$client_id',
        product_types: { $addToSet: '$holdings.asset_class' },
        total_aum: { $first: '$summary.total_aum' },
        client_id: { $first: '$client_id' },
      },
    },
    // Only clients with fewer than max_products distinct product types
    {
      $match: {
        $expr: { $lt: [{ $size: '$product_types' }, maxProducts] },
      },
    },
    // Join client details for name and tier
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
        total_aum: 1,
        product_count: { $size: '$product_types' },
        current_products: '$product_types',
      },
    },
  ]);

  // Compute missing products in application layer (deterministic ordering)
  return results.map(
    (r: {
      client_id: string;
      client_name: string;
      client_tier: string;
      total_aum: number;
      product_count: number;
      current_products: string[];
    }): CrossSellCandidate => ({
      client_id: r.client_id,
      client_name: r.client_name,
      client_tier: r.client_tier,
      total_aum: r.total_aum,
      product_count: r.product_count,
      current_products: r.current_products ?? [],
      missing_products: ALL_PRODUCTS.filter(
        (p) => !(r.current_products ?? []).includes(p),
      ),
    }),
  );
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/** Format rupees in Indian notation (e.g. 5000000 → "50,00,000"). */
function formatIndian(amount: number): string {
  return amount.toLocaleString('en-IN');
}

/**
 * Build the alert message for a cross-sell candidate.
 *
 * Example: "Anil Sharma has only 1 product type(s) with ₹50,00,000 AUM.
 *           Consider: FI, MF."
 */
export function buildCrossSellMessage(candidate: CrossSellCandidate): string {
  const topTwo = candidate.missing_products.slice(0, 2).join(', ');
  return (
    `${candidate.client_name} has only ${candidate.product_count} product type(s) ` +
    `with ₹${formatIndian(candidate.total_aum)} AUM. Consider: ${topTwo}.`
  );
}
