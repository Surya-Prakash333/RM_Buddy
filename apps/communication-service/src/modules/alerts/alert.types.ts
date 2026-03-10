/**
 * Canonical payload shape produced by Core API and published to the
 * `alerts.generated` Kafka topic. Communication Service consumes this.
 */
export interface AlertDeliveryPayload {
  alert_id: string;
  alert_type: string;
  rm_id: string;
  rm_name: string;
  client_id: string;
  client_name: string;
  client_tier: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  action_suggestion: string;
  channels: Array<'IN_APP' | 'VOICE'>;
  data: Record<string, unknown>;
  created_at: string;
}

/**
 * Formatted in-app notification payload delivered to the frontend via
 * WebSocket `new_alert` event.
 */
export interface InAppNotification {
  alert_id: string;
  title: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  alert_type: string;
  client_name: string;
  action_suggestion: string;
  created_at: string;
}
