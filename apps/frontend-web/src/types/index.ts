// ============================================================
// RM Identity — mirrors shared/types/api.types.ts RMIdentity
// ============================================================
export interface RMIdentity {
  rm_id: string;
  rm_name: string;
  rm_code: string;
  rm_email: string;
  rm_branch: string;
  rm_region: string;
  role: 'RM' | 'BM' | 'ADMIN';
  client_count: number;
  session_id: string;
  token_expires: string; // ISO 8601
}

// ============================================================
// API Response Wrapper — mirrors shared/types/api.types.ts
// ============================================================
export interface APIResponse<T> {
  status: 'success' | 'error';
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
  };
  timestamp: string;
}

// ============================================================
// Widget types — mirrors shared/types/agent.types.ts WidgetPayload
// with stronger typing on widget_type discriminant
// ============================================================
export enum WidgetType {
  METRIC_CARD = 'metric_card',
  TABLE = 'table',
  BAR_CHART = 'bar_chart',
  PIE_CHART = 'pie_chart',
  LINE_CHART = 'line_chart',
  ALERT_CARD = 'alert_card',
  ACTION_CARD = 'action_card',
  BRIEFING_PANEL = 'briefing_panel',
  CLIENT_SUMMARY = 'client_summary',
  MEETING_LIST = 'meeting_list',
  TEXT = 'text',
  BRIEFING_PANEL_V2 = 'briefing_panel_v2',
  ACTION_LIST = 'action_list',
  DAILY_STATUS = 'daily_status',
  STRENGTH_RADAR = 'strength_radar',
  ENGAGEMENT_TREND = 'engagement_trend',
}

export interface WidgetAction {
  label: string;
  action_type: 'navigate' | 'api_call' | 'confirm';
  payload: Record<string, unknown>;
}

export interface WidgetPayload {
  widget_type: WidgetType;
  title: string;
  data: Record<string, unknown>;
  actions?: WidgetAction[];
}

// ============================================================
// Chat / Agent types
// ============================================================
export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  widgets?: WidgetPayload[];
  suggestions?: string[];
  timestamp: string;
}

// ============================================================
// Auth types
// ============================================================
export interface ValidateTokenResponse {
  rm_identity: RMIdentity;
  token: string;
}

export interface SessionCreateResponse {
  session_id: string;
  expires_at: string;
}

// ============================================================
// Navigation
// ============================================================
export type NavItem = {
  label: string;
  path: string;
  icon: string; // lucide icon name
  badge?: number;
};
