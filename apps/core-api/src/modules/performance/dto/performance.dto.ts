/**
 * Data Transfer Objects for the Performance / Strength Identification module.
 *
 * S1-F33-L1-Data  — RMPerformanceMetrics: all T1 RM performance metrics.
 * S1-F33-L2-Logic — StrengthReport / StrengthItem: business logic output.
 */

// ---------------------------------------------------------------------------
// T1 RM Performance Metrics
// ---------------------------------------------------------------------------

export interface RMPerformanceMetrics {
  rm_id: string;
  rm_name: string;
  branch: string;
  period: string; // 'YYYY-MM' or 'YYYY'

  // Activity metrics
  total_meetings: number;
  total_calls: number;
  client_visits: number;

  // Business metrics
  gross_sales: number;         // total new investments
  aum_growth: number;          // AUM change in period
  aum_growth_pct: number;
  revenue_generated: number;

  // Client metrics
  total_clients: number;
  diamond_clients: number;
  platinum_clients: number;
  new_clients_added: number;
  client_retention_rate: number; // % clients with at least 1 interaction in period

  // Portfolio metrics
  avg_portfolio_return: number; // avg across all clients
  products_per_client: number;  // diversification
}

// ---------------------------------------------------------------------------
// Strength Identification (S1-F33-L2-Logic)
// ---------------------------------------------------------------------------

export interface KeyMetric {
  name: string;
  rm_value: number;
  peer_median: number;
  percentile: number;
}

export interface StrengthItem {
  dimension: string;
  label: string;
  score: number;        // 0-100 percentile
  peer_rank: number;    // 1-based rank among peers
  peer_count: number;
  key_metrics: KeyMetric[];
  coaching_note: string; // generic, non-financial-advice note
}

export interface StrengthReport {
  rm_id: string;
  period: string;
  strengths: StrengthItem[];    // top 3 dimensions
  growth_areas: StrengthItem[]; // bottom 2 dimensions
  overall_percentile: number;   // where RM ranks among ALL peers (0-100)
}

// ---------------------------------------------------------------------------
// Strength dimension configuration type
// ---------------------------------------------------------------------------

export interface StrengthDimensionConfig {
  label: string;
  metrics: (keyof RMPerformanceMetrics)[];
  weight: number;
}

export type StrengthDimensionsMap = Record<string, StrengthDimensionConfig>;
