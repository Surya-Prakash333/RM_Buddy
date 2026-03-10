import { Model } from 'mongoose';
import { PortfolioDocument } from '../../../database/models/portfolio.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-F28 Concentration Risk
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Concentration Risk alert (S2-F28).
 *
 * Fires when a client's portfolio is overly concentrated:
 *  - Single stock > 25% of portfolio total AUM, OR
 *  - Single sector > 40% of portfolio total AUM
 *
 * Severity : HIGH (P2) — significant financial risk from concentration
 * Cooldown : 72 hours (3 days)
 */
export const CONCENTRATION_RISK_RULE: AlertRule = {
  rule_id: 'RULE-CONCENTRATION',
  alert_type: 'CONCENTRATION_RISK',
  name: 'Concentration Risk',
  severity: 'high',
  cooldown_hours: 72,
  channels: ['IN_APP'],
  conditions: {
    max_stock_pct: 25,  // single stock > 25% = risky
    max_sector_pct: 40, // single sector > 40% = risky
  },
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ConcentrationAlert {
  client_id: string;
  client_name: string;
  client_tier: string;
  total_aum: number;
  concentration_type: 'STOCK' | 'SECTOR';
  /** Stock name or sector name. */
  name: string;
  /** Percentage of portfolio held in this stock/sector. */
  pct: number;
  /** Absolute amount (in rupees) held in this stock/sector. */
  amount: number;
}

// ---------------------------------------------------------------------------
// Aggregation result shape (internal)
// ---------------------------------------------------------------------------

interface ConcentrationAggRow {
  client_id: string;
  client_name: string;
  client_tier: string;
  total_aum: number;
  max_stock_pct: number;
  max_stock_name: string;
  max_sector_pct: number;
  max_sector_name: string;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` whose portfolios breach concentration limits.
 *
 * Uses pre-computed `summary.concentration` fields:
 *   - max_stock_pct / max_stock_name — the largest single-stock weight
 *   - max_sector_pct / max_sector_name — the largest single-sector weight
 *
 * A single portfolio can produce up to two alerts (one STOCK + one SECTOR)
 * if both thresholds are breached simultaneously.
 *
 * @returns Array of ConcentrationAlert objects (may be empty).
 */
export async function evaluateConcentrationRisk(
  portfolioModel: Model<PortfolioDocument>,
  rmId: string,
): Promise<ConcentrationAlert[]> {
  const maxStockPct = (CONCENTRATION_RISK_RULE.conditions['max_stock_pct'] as number);
  const maxSectorPct = (CONCENTRATION_RISK_RULE.conditions['max_sector_pct'] as number);

  const portfolios = await portfolioModel.aggregate<ConcentrationAggRow>([
    {
      $match: {
        rm_id: rmId,
        $or: [
          { 'summary.concentration.max_stock_pct': { $gt: maxStockPct } },
          { 'summary.concentration.max_sector_pct': { $gt: maxSectorPct } },
        ],
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
        total_aum: '$summary.total_aum',
        max_stock_pct: '$summary.concentration.max_stock_pct',
        max_stock_name: '$summary.concentration.max_stock_name',
        max_sector_pct: '$summary.concentration.max_sector_pct',
        max_sector_name: '$summary.concentration.max_sector_name',
      },
    },
  ]);

  const alerts: ConcentrationAlert[] = [];

  for (const p of portfolios) {
    if (p.max_stock_pct > maxStockPct && p.max_stock_name) {
      alerts.push({
        client_id: p.client_id,
        client_name: p.client_name,
        client_tier: p.client_tier,
        total_aum: p.total_aum,
        concentration_type: 'STOCK',
        name: p.max_stock_name,
        pct: p.max_stock_pct,
        amount: (p.max_stock_pct / 100) * p.total_aum,
      });
    }

    if (p.max_sector_pct > maxSectorPct && p.max_sector_name) {
      alerts.push({
        client_id: p.client_id,
        client_name: p.client_name,
        client_tier: p.client_tier,
        total_aum: p.total_aum,
        concentration_type: 'SECTOR',
        name: p.max_sector_name,
        pct: p.max_sector_pct,
        amount: (p.max_sector_pct / 100) * p.total_aum,
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/** Format rupees in Indian notation (e.g. 1500000 → "15,00,000"). */
function formatIndian(amount: number): string {
  return amount.toLocaleString('en-IN');
}

/**
 * Build the alert message for a concentration risk alert.
 *
 * STOCK example:
 *   "Priya Mehta: HDFC Bank is 32% of portfolio (₹3,20,000). Recommend partial booking."
 *
 * SECTOR example:
 *   "Priya Mehta: IT sector concentration is 45%. Diversification needed."
 */
export function buildConcentrationRiskMessage(alert: ConcentrationAlert): string {
  if (alert.concentration_type === 'STOCK') {
    return (
      `${alert.client_name}: ${alert.name} is ${alert.pct.toFixed(1)}% of portfolio ` +
      `(₹${formatIndian(Math.round(alert.amount))}). Recommend partial booking.`
    );
  }

  return (
    `${alert.client_name}: ${alert.name} sector concentration is ${alert.pct.toFixed(1)}%. ` +
    `Diversification needed.`
  );
}
