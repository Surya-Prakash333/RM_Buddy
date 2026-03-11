import type { ReactElement } from 'react';
import { AlertOctagon } from 'lucide-react';
import type { WidgetPayload } from '../../types/index';
import type {
  AlertCardData,
  MetricCardData,
  ActionCardData,
  TextWidgetData,
  WidgetActionExtended,
  ClientTableRow,
  MeetingItem,
  PipelineChartItem,
  BriefingSection,
} from '../../types/widget.types';
import { AlertCard } from './AlertCard';
import { MetricCard } from './MetricCard';
import { ClientTable } from './ClientTable';
import { MeetingList } from './MeetingList';
import { PipelineChart } from './PipelineChart';
import { BriefingWidget } from './BriefingWidget';
import { BriefingPanel } from './BriefingPanel';
import { ActionCard } from './ActionCard';
import { ActionList } from './ActionList';
import { DailyStatusCard } from './DailyStatusCard';
import { StrengthRadar } from './StrengthRadar';
import { EngagementTrend } from './EngagementTrend';
import { TextWidget } from './TextWidget';

// ---------------------------------------------------------------------------
// Type coercions — WidgetPayload.data is Record<string, unknown>;
// we cast to the specific shape each component expects. The agent backend is
// the source of truth for data shape correctness.
// ---------------------------------------------------------------------------

function asAlertData(d: Record<string, unknown>): AlertCardData {
  return d as unknown as AlertCardData;
}

function asMetricData(d: Record<string, unknown>): MetricCardData {
  return d as unknown as MetricCardData;
}

function asClientTableData(d: Record<string, unknown>): { clients: ClientTableRow[]; total?: number } {
  // Flat array
  if (Array.isArray(d)) return { clients: d as unknown as ClientTableRow[] };

  // Agent returns { rows: [...], columns: [...], row_count: N }
  // Normalise each row: map `name` → `client_name` if needed
  if (Array.isArray(d['rows'])) {
    const clients = (d['rows'] as Record<string, unknown>[]).map((r) => ({
      client_id: (r['client_id'] ?? r['id'] ?? '') as string,
      client_name: (r['client_name'] ?? r['name'] ?? '') as string,
      tier: (r['tier'] ?? '') as string,
      aum: (r['aum'] ?? '') as string,
      last_interaction: (r['last_interaction'] ?? r['change'] ?? '') as string,
    }));
    return { clients, total: typeof d['row_count'] === 'number' ? d['row_count'] : clients.length };
  }

  // Already has clients key
  return d as unknown as { clients: ClientTableRow[]; total?: number };
}

function asMeetingData(d: Record<string, unknown>): { meetings: MeetingItem[] } {
  return d as unknown as { meetings: MeetingItem[] };
}

function asPipelineData(d: Record<string, unknown>): { stages: PipelineChartItem[]; total_amount?: string } {
  return d as unknown as { stages: PipelineChartItem[]; total_amount?: string };
}

function asBriefingData(d: Record<string, unknown>): { sections: BriefingSection[]; generated_at?: string } {
  return d as unknown as { sections: BriefingSection[]; generated_at?: string };
}

function asActionData(d: Record<string, unknown>): ActionCardData {
  return d as unknown as ActionCardData;
}

function asTextData(d: Record<string, unknown>): TextWidgetData {
  // If content is missing, show JSON representation so nothing is lost
  if (typeof d.content !== 'string') {
    return { content: JSON.stringify(d, null, 2) };
  }
  return d as unknown as TextWidgetData;
}

// ---------------------------------------------------------------------------
// Coerce WidgetAction[] (from index.ts) to WidgetActionExtended[]
// The extended type is a superset — any missing fields will be undefined.
// ---------------------------------------------------------------------------

function coerceActions(
  actions?: WidgetPayload['actions'],
): WidgetActionExtended[] | undefined {
  return actions as unknown as WidgetActionExtended[] | undefined;
}

// ---------------------------------------------------------------------------
// Debug fallback — shown when widget_type is unknown
// ---------------------------------------------------------------------------

function DebugWidget({
  title,
  widgetType,
  data,
}: {
  title: string;
  widgetType: string;
  data: Record<string, unknown>;
}): ReactElement {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-dashed border-gray-300 p-4">
      <div className="flex items-center gap-2 mb-3 text-gray-400">
        <AlertOctagon className="w-4 h-4" />
        <span className="text-xs font-medium">Unknown widget type: {widgetType}</span>
      </div>
      {title && <p className="text-sm font-semibold text-gray-600 mb-2">{title}</p>}
      <pre className="text-xs text-gray-500 bg-gray-50 rounded p-3 overflow-x-auto whitespace-pre-wrap break-words">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WidgetRenderer
// ---------------------------------------------------------------------------

interface WidgetRendererProps {
  widget: WidgetPayload;
  onAction?: (action: WidgetActionExtended) => void;
}

export function WidgetRenderer({ widget, onAction }: WidgetRendererProps): ReactElement {
  const { widget_type, title, data, actions } = widget;
  const extActions = coerceActions(actions);

  switch (widget_type) {
    case 'metric_card':
    case 'line_chart': // line chart falls back to metric card (placeholder)
      return (
        <MetricCard
          title={title}
          data={asMetricData(data)}
          actions={extActions}
          onAction={onAction}
        />
      );

    case 'alert_card':
      return (
        <AlertCard
          title={title}
          data={asAlertData(data)}
          actions={extActions}
          onAction={onAction}
        />
      );

    case 'table':
    case 'client_summary': // single-client view reuses table
      return (
        <ClientTable
          title={title}
          data={asClientTableData(data)}
          actions={extActions}
          onAction={(action) => onAction?.(action)}
        />
      );

    case 'meeting_list':
      return (
        <MeetingList
          title={title}
          data={asMeetingData(data)}
          actions={extActions}
          onAction={onAction}
        />
      );

    case 'bar_chart':
    case 'pie_chart': // pie chart reuses pipeline bar chart for now
      return (
        <PipelineChart
          title={title}
          data={asPipelineData(data)}
          actions={extActions}
          onAction={onAction}
        />
      );

    case 'briefing_panel':
      return (
        <BriefingWidget
          title={title}
          data={asBriefingData(data)}
          actions={extActions}
          onAction={onAction}
        />
      );

    case 'briefing_panel_v2':
      return <BriefingPanel data={data as unknown as import('./BriefingPanel').BriefingPanelData} />;

    case 'action_list':
      return <ActionList data={data as unknown as import('./ActionList').ActionListData} />;

    case 'daily_status':
      return <DailyStatusCard data={data as unknown as import('./DailyStatusCard').DailyStatusData} />;

    case 'strength_radar':
      return <StrengthRadar data={data as unknown as import('./StrengthRadar').StrengthData} />;

    case 'engagement_trend':
      return <EngagementTrend data={data as unknown as import('./EngagementTrend').EngagementData} />;

    case 'action_card':
      return (
        <ActionCard
          title={title}
          data={asActionData(data)}
          actions={extActions}
          onAction={onAction}
        />
      );

    case 'text':
      return (
        <TextWidget
          title={title}
          data={asTextData(data)}
          actions={extActions}
          onAction={onAction}
        />
      );

    default:
      return (
        <DebugWidget
          title={title}
          widgetType={String(widget_type)}
          data={data}
        />
      );
  }
}

export default WidgetRenderer;
