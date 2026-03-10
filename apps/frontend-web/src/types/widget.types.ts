// ============================================================
// widget.types.ts — Extended widget data shapes for INFRA-FE-02
// Supplements apps/frontend-web/src/types/index.ts
// ============================================================

// Extended widget action with variant + trigger_chat support
export interface WidgetActionExtended {
  label: string;
  action_type: 'navigate' | 'api_call' | 'trigger_chat' | 'confirm';
  payload: Record<string, unknown>;
  variant?: 'primary' | 'secondary' | 'danger';
}

// Alert card data shape
export interface AlertCardData {
  alert_id: string;
  alert_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  client_name: string;
  client_tier: string;
  // Support both old (message/action_suggestion) and new (title/body/status) shapes
  message?: string;
  action_suggestion?: string;
  title?: string;
  body?: string;
  status?: 'PENDING' | 'ACKNOWLEDGED' | 'ACTIONED';
  metadata?: Record<string, unknown>;
  recommendation?: string;
  created_at: string;
}

// Metric card data shape
export interface MetricCardData {
  value: string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'flat';
  trend_value?: string; // e.g. "+5.2%"
  color?: 'default' | 'success' | 'warning' | 'danger';
}

// Client table row
export interface ClientTableRow {
  client_id: string;
  client_name: string;
  tier: string;
  aum: string;
  last_interaction: string;
  status?: string;
}

// Meeting item
export interface MeetingItem {
  meeting_id: string;
  client_name: string;
  client_tier: string;
  time: string;
  duration_minutes: number;
  meeting_type: 'in_person' | 'virtual' | 'phone';
  agenda: string;
  status: 'scheduled' | 'completed' | 'cancelled';
}

// Pipeline chart item
export interface PipelineChartItem {
  stage: string;
  count: number;
  amount: string;
  color?: string;
}

// Briefing section item
export interface BriefingSectionItem {
  text: string;
  priority?: 'high' | 'medium' | 'low';
  tag?: string;
}

// Briefing section
export interface BriefingSection {
  title: string;
  icon?: string;
  items: BriefingSectionItem[];
}

// Action card data shape
export interface ActionCardData {
  description: string;
  priority?: 'high' | 'medium' | 'low';
  client_name?: string;
  client_id?: string;
  due_date?: string;
  status?: 'pending' | 'completed' | 'skipped';
}

// Text widget data shape
export interface TextWidgetData {
  content: string;
}
