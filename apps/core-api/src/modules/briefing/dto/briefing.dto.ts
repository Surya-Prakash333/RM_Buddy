/**
 * BriefingData — the full shape returned by GET /api/v1/briefing/today
 * and GET /api/v1/briefing/:date.
 *
 * All five sections are populated in parallel via Promise.all.
 */

export interface MeetingItem {
  meeting_id: string;
  client_name: string;
  client_tier: string;
  time: string;           // HH:MM
  duration_min: number;
  agenda: string;
  location: string;
}

export interface MeetingsToday {
  count: number;
  items: MeetingItem[];
}

export interface TaskItem {
  task_id: string;
  client_name: string;
  description: string;
  due_date: string;
  is_overdue: boolean;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface PendingTasks {
  count: number;
  overdue: number;
  items: TaskItem[];
}

export interface AlertItem {
  alert_id: string;
  alert_type: string;
  client_name: string;
  severity: string;
  title: string;
  created_at: string;
}

export interface ActiveAlerts {
  count: number;
  critical: number;
  high: number;
  items: AlertItem[];
}

export interface ClientMover {
  client_name: string;
  client_id: string;
  change_pct: number;
}

export interface PortfolioSummary {
  total_aum: number;
  aum_change_today: number;
  top_gainers: ClientMover[];
  top_losers: ClientMover[];
}

export interface RevenueYTD {
  amount: number;
  target: number;
  achievement_pct: number;
  vs_last_year: number;
}

export interface BriefingData {
  rm_id: string;
  date: string;
  generated_at: string;       // ISO timestamp
  meetings_today: MeetingsToday;
  pending_tasks: PendingTasks;
  active_alerts: ActiveAlerts;
  portfolio_summary: PortfolioSummary;
  revenue_ytd: RevenueYTD;
}

// ---------------------------------------------------------------------------
// Logic-layer types (S2-F1-L2-Logic)
// ---------------------------------------------------------------------------

/** Priority rank for any briefing item. */
export type BriefingItemPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Unified ranked briefing item (flattened from all 5 sections). */
export interface RankedBriefingItem {
  item_type: 'ALERT' | 'MEETING' | 'TASK' | 'OPPORTUNITY' | 'PORTFOLIO_ALERT';
  priority: BriefingItemPriority;
  urgency_score: number;    // 0-100
  importance_score: number; // 0-100
  combined_score: number;   // Math.round(urgency * importance / 100)
  title: string;
  subtitle: string;
  client_id?: string;
  client_name?: string;
  due_at?: string;          // ISO date when action is due
  action: string;           // what RM should do
  source_data: Record<string, unknown>; // original item data
}

/** BriefingData extended with ranked items (idempotent response shape). */
export interface RankedBriefingData extends BriefingData {
  ranked_items: RankedBriefingItem[];   // all items sorted by combined_score desc
  briefing_id: string;                   // stable ID = rmId-date (for idempotency)
  top_priorities: RankedBriefingItem[]; // top 5 items only
}
