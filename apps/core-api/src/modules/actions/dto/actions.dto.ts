/**
 * Data-transfer objects and response interfaces for the Daily Actions feature
 * (S2-F13-L1-Data).
 *
 * Aggregates four sources:
 *   1. Pipeline aging     — deals stagnant > 7 days in same stage
 *   2. Proposals pending  — proposals awaiting client response > 5 days
 *   3. Follow-ups due     — due today, tomorrow, or overdue (≤ 7 days)
 *   4. Idle cash clients  — cash_pct > 15%, cash_balance > 50 000, last_investment > 30 days
 */

/** Legacy three-tier priority used by the data layer. */
export type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

// ---------------------------------------------------------------------------
// Logic-layer priority types (S2-F13-L2-Logic)
// ---------------------------------------------------------------------------

/** Four-tier priority used by the ranked-actions logic layer. */
export type ScoredActionPriority = 'P1_CRITICAL' | 'P2_HIGH' | 'P3_MEDIUM' | 'P4_LOW';

export interface ScoredAction {
  action_id: string;           // unique ID for dedup
  source: 'pipeline' | 'proposal' | 'followup' | 'idle_cash';
  priority: ScoredActionPriority;
  priority_score: number;      // 0-1000 composite score
  client_id?: string;
  client_name: string;
  client_tier: string;
  title: string;               // human-readable action title
  description: string;
  due_date?: string;
  amount?: number;             // financial amount at stake
  days_pending?: number;       // how stale is this
  action_url?: string;         // deep link into CRM (optional)
}

export interface RankedActionsData {
  rm_id: string;
  date: string;
  top_actions: ScoredAction[];  // top 10, sorted by priority_score desc
  all_actions: ScoredAction[];  // all actions sorted
  total_count: number;
  p1_count: number;
  p2_count: number;
  summary_by_source: {
    pipeline: number;
    proposal: number;
    followup: number;
    idle_cash: number;
  };
}

// ---------------------------------------------------------------------------
// Source 1: Pipeline aging
// ---------------------------------------------------------------------------

export interface PipelineAgingItem {
  pipeline_id: string;
  client_name: string;
  client_tier: string;
  deal_amount: number;
  product: string;
  stage: string;
  /** Number of days the deal has been sitting in the current stage. */
  days_in_stage: number;
  priority: ActionPriority;
  action_needed: string;
}

export interface PipelineAgingSource {
  count: number;
  items: PipelineAgingItem[];
}

// ---------------------------------------------------------------------------
// Source 2: Proposals pending client approval
// ---------------------------------------------------------------------------

export interface ProposalPendingItem {
  proposal_id: string;
  client_name: string;
  client_tier: string;
  proposal_amount: number;
  proposed_product: string;
  submitted_date: string;
  days_pending: number;
  action_needed: string;
}

export interface ProposalsPendingSource {
  count: number;
  items: ProposalPendingItem[];
}

// ---------------------------------------------------------------------------
// Source 3: Follow-ups due today or overdue
// ---------------------------------------------------------------------------

export interface FollowUpItem {
  followup_id: string;
  client_name: string;
  client_tier: string;
  due_date: string;
  /** Negative = future, 0 = today, positive = overdue days. */
  days_overdue: number;
  description: string;
  action_needed: string;
}

export interface FollowUpsDueSource {
  count: number;
  /** Number of items that are genuinely overdue (days_overdue > 0). */
  overdue: number;
  items: FollowUpItem[];
}

// ---------------------------------------------------------------------------
// Source 4: Idle cash clients
// ---------------------------------------------------------------------------

export interface IdleCashItem {
  client_id: string;
  client_name: string;
  client_tier: string;
  cash_balance: number;
  /** Percentage of portfolio held in cash. */
  cash_pct: number;
  /** Days since the client last made an investment. */
  days_idle: number;
  action_needed: string;
}

export interface IdleCashSource {
  count: number;
  total_idle_amount: number;
  items: IdleCashItem[];
}

// ---------------------------------------------------------------------------
// Top-level response
// ---------------------------------------------------------------------------

export interface DailyActionsData {
  rm_id: string;
  date: string;
  total_actions: number;
  pipeline_aging: PipelineAgingSource;
  proposals_pending: ProposalsPendingSource;
  follow_ups_due: FollowUpsDueSource;
  idle_cash_clients: IdleCashSource;
  cached_at?: string;
}

export interface DailyActionsSummary {
  total_actions: number;
  pipeline_count: number;
  proposals_count: number;
  followups_count: number;
  idle_cash_count: number;
}
