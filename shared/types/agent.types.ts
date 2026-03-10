export interface AgentRequest {
  request_id: string;
  rm_id: string;
  session_id: string;
  type: 'chat' | 'voice' | 'proactive';
  intent?: string;
  message: string;
  context?: {
    client_id?: string;
    current_screen?: string;
    previous_messages?: Array<{ role: string; content: string }>;
  };
  metadata?: Record<string, any>;
}

export interface AgentResponse {
  request_id: string;
  response_text: string;
  widgets?: WidgetPayload[];
  actions?: ActionPayload[];
  suggestions?: string[];
  confidence: number;
  processing_time_ms: number;
}

export interface WidgetPayload {
  type: string;
  title: string;
  data: Record<string, any>;
  actions?: Array<{
    label: string;
    action: string;
    payload?: Record<string, any>;
  }>;
}

export interface ActionPayload {
  action_type: 'create_lead' | 'schedule_meeting' | 'update_record' | 'send_notification';
  requires_confirmation: boolean;
  description: string;
  payload: Record<string, any>;
}
