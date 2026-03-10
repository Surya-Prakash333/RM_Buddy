// ============================================================
// BriefingPanel.tsx — Morning Briefing Panel Widget (S2-F1-L4)
// ============================================================

import { type ReactElement, useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, Calendar, CheckSquare, TrendingUp } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankedBriefingItem {
  type: 'MEETING' | 'ALERT' | 'TASK' | 'PORTFOLIO' | 'REVENUE';
  title: string;
  body: string;
  score: number;
  urgency: number;
  importance: number;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
}

export interface BriefingPanelData {
  briefing_id: string;
  generated_at: string;
  top_priorities: RankedBriefingItem[];
  ranked_items: RankedBriefingItem[];
  summary: {
    total_meetings: number;
    pending_tasks: number;
    active_alerts: number;
    revenue_ytd: number;
    revenue_target: number;
  };
  rm_name?: string;
}

interface BriefingPanelProps {
  data: BriefingPanelData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtInr(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)} Cr`;
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)} L`;
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(0)}K`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

const PRIORITY_BADGE: Record<RankedBriefingItem['priority'], string> = {
  P1: 'bg-red-100 text-red-700 border-red-200',
  P2: 'bg-orange-100 text-orange-700 border-orange-200',
  P3: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  P4: 'bg-gray-100 text-gray-600 border-gray-200',
};

const SECTION_ICONS: Record<string, ReactElement> = {
  ALERT: <AlertTriangle className="w-4 h-4" />,
  MEETING: <Calendar className="w-4 h-4" />,
  TASK: <CheckSquare className="w-4 h-4" />,
  REVENUE: <TrendingUp className="w-4 h-4" />,
  PORTFOLIO: <TrendingUp className="w-4 h-4" />,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PriorityBadge({ priority }: { priority: RankedBriefingItem['priority'] }): ReactElement {
  return (
    <span
      className={[
        'text-xs font-semibold px-1.5 py-0.5 rounded border',
        PRIORITY_BADGE[priority],
      ].join(' ')}
    >
      {priority}
    </span>
  );
}

function TopPriorities({ items }: { items: RankedBriefingItem[] }): ReactElement {
  const top3 = items.slice(0, 3);
  if (top3.length === 0) return <></>;

  return (
    <div className="mb-4 p-3 bg-amber-50 rounded-xl border border-amber-200">
      <p className="text-xs font-semibold text-amber-800 mb-2 uppercase tracking-wide">
        🔥 Top Priorities
      </p>
      <div className="space-y-2">
        {top3.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <PriorityBadge priority={item.priority} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{item.title}</p>
              <p className="text-xs text-gray-500 truncate">{item.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: ReactElement;
  count?: number;
  children: ReactElement;
}): ReactElement {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-500">{icon}</span>
          <span className="text-sm font-semibold text-gray-800">{title}</span>
          {count !== undefined && (
            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full font-medium">
              {count}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {open && <div className="px-4 pb-3 pt-1 bg-white">{children}</div>}
    </div>
  );
}

function SummaryGrid({
  summary,
}: {
  summary: BriefingPanelData['summary'];
}): ReactElement {
  const ytdPct = summary.revenue_target > 0
    ? Math.min(100, Math.round((summary.revenue_ytd / summary.revenue_target) * 100))
    : 0;

  return (
    <div className="grid grid-cols-3 gap-2 mb-4">
      <div className="bg-blue-50 rounded-xl p-3 text-center">
        <p className="text-xl font-bold text-blue-700">{summary.total_meetings}</p>
        <p className="text-xs text-blue-500">Meetings</p>
      </div>
      <div className="bg-orange-50 rounded-xl p-3 text-center">
        <p className="text-xl font-bold text-orange-700">{summary.active_alerts}</p>
        <p className="text-xs text-orange-500">Alerts</p>
      </div>
      <div className="bg-purple-50 rounded-xl p-3 text-center">
        <p className="text-xl font-bold text-purple-700">{summary.pending_tasks}</p>
        <p className="text-xs text-purple-500">Tasks</p>
      </div>
      <div className="col-span-3 bg-green-50 rounded-xl p-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="font-medium text-green-800">Revenue YTD</span>
          <span className="text-green-700">
            {fmtInr(summary.revenue_ytd)} / {fmtInr(summary.revenue_target)} ({ytdPct}%)
          </span>
        </div>
        <div className="h-2 bg-green-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-500"
            style={{ width: `${ytdPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function ItemList({ items }: { items: RankedBriefingItem[] }): ReactElement {
  if (items.length === 0) {
    return <p className="text-xs text-gray-400 py-2">Nothing here today 🎉</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 py-1">
          <PriorityBadge priority={item.priority} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-800">{item.title}</p>
            {item.body && <p className="text-xs text-gray-500 mt-0.5">{item.body}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BriefingPanel({ data }: BriefingPanelProps): ReactElement {
  const greeting = data.rm_name ? `Good morning, ${data.rm_name}!` : 'Good morning!';
  const dateStr = fmtDate(data.generated_at);

  const alerts = data.ranked_items.filter((i) => i.type === 'ALERT');
  const meetings = data.ranked_items.filter((i) => i.type === 'MEETING');
  const tasks = data.ranked_items.filter((i) => i.type === 'TASK');

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1B4F72] to-[#2E86AB] px-5 py-4">
        <p className="text-white font-semibold text-base">{greeting}</p>
        <p className="text-white/70 text-xs mt-0.5">Here's your briefing for {dateStr}</p>
      </div>

      <div className="p-4">
        {/* Summary stats */}
        <SummaryGrid summary={data.summary} />

        {/* Top priorities (sticky feel) */}
        {data.top_priorities.length > 0 && (
          <TopPriorities items={data.top_priorities} />
        )}

        {/* Collapsible sections */}
        <CollapsibleSection
          title="Alerts"
          icon={SECTION_ICONS.ALERT}
          count={data.summary.active_alerts}
        >
          <ItemList items={alerts} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Meetings"
          icon={SECTION_ICONS.MEETING}
          count={data.summary.total_meetings}
        >
          <ItemList items={meetings} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Tasks"
          icon={SECTION_ICONS.TASK}
          count={data.summary.pending_tasks}
        >
          <ItemList items={tasks} />
        </CollapsibleSection>
      </div>
    </div>
  );
}

export default BriefingPanel;
