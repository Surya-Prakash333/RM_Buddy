export interface AlertRule {
  rule_id: string;
  name: string;
  description: string;
  category: AlertCategory;
  priority: AlertPriority;
  conditions: AlertCondition[];
  cooldown_hours: number;
  data_source: {
    collection: string;
    query_fields: string[];
    aggregation?: any;
  };
  notification: {
    channels: ('push' | 'voice' | 'whatsapp' | 'email')[];
    template: string;
    urgency: 'immediate' | 'batched' | 'daily_digest';
  };
  enabled: boolean;
}

export interface AlertCondition {
  field: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'ne' | 'in' | 'nin' | 'exists' | 'regex';
  value: any;
  description: string;
}

export interface Alert {
  alert_id: string;
  rule_id: string;
  rm_id: string;
  client_id: string;
  client_name: string;
  priority: AlertPriority;
  category: AlertCategory;
  title: string;
  description: string;
  data: Record<string, any>;
  status: AlertStatus;
  created_at: string;
  acknowledged_at?: string;
  dismissed_at?: string;
}

export type AlertPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertCategory = 'PORTFOLIO' | 'ENGAGEMENT' | 'COMPLIANCE' | 'PIPELINE' | 'MARKET';
export type AlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'DISMISSED' | 'ACTIONED' | 'EXPIRED';

export const ALERT_TYPES = [
  'idle_cash', 'concentration_risk', 'sip_due', 'maturity',
  'insurance_renewal', 'sector_alert', 'missed_sip', 'anomaly_detection',
  'compliance', 'inactive_client', 'cross_sell', 'revenue_at_risk',
  'tax_harvesting', 'market_trigger', 'regulatory_update', 'custom_rule',
  'pipeline_expiry'
] as const;
export type AlertType = typeof ALERT_TYPES[number];
