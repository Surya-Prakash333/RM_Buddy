// ---------------------------------------------------------------------------
// Query Engine DTOs — S2-QA-L2-QueryEngine
// ---------------------------------------------------------------------------

export type QueryIntent =
  | 'COUNT'
  | 'FILTER_LIST'
  | 'AGGREGATE_SUM'
  | 'AGGREGATE_AVG'
  | 'FIND_CLIENT'
  | 'TIME_FILTER'
  | 'ALERT_QUERY'
  | 'UNKNOWN';

export interface QueryFilter {
  field: string;
  operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'regex';
  value: unknown;
}

export interface ParsedQuery {
  original: string;
  intent: QueryIntent;
  collection: 'clients' | 'portfolios' | 'alerts' | 'meetings' | 'transactions';
  filters: QueryFilter[];
  aggregation?: 'count' | 'sum' | 'avg';
  field?: string;        // field to aggregate on
  limit?: number;
  sort?: { field: string; direction: 'asc' | 'desc' };
}

export interface QueryResult {
  intent: QueryIntent;
  data: unknown;            // raw result
  formatted_answer: string; // human-readable answer (Indian formatting)
  count?: number;
  widgets_hint?: string;    // widget type to render: 'METRIC_CARD', 'TABLE', etc.
}
