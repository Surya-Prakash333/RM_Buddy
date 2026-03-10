// ============================================================
// ActionList.tsx — Daily Priority Actions Widget (S2-F13-L4)
// ============================================================

import { type ReactElement, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionItem {
  action_id: string;
  client_name: string;
  client_tier: 'Diamond' | 'Platinum' | 'Gold' | 'Silver' | string;
  action_type: string;
  description: string;
  priority_score: number;
  priority_label: 'P1' | 'P2' | 'P3' | 'P4';
  aum_context?: string;
  urgency_reason?: string;
  source: 'pipeline' | 'proposal' | 'followup' | 'idle_cash' | string;
}

export interface ActionListData {
  actions: ActionItem[];
  total?: number;
  generated_at?: string;
}

interface ActionListProps {
  data: ActionListData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<string, string> = {
  P1: 'bg-red-500 text-white',
  P2: 'bg-orange-500 text-white',
  P3: 'bg-amber-400 text-white',
  P4: 'bg-gray-300 text-gray-700',
};

const TIER_STYLES: Record<string, string> = {
  Diamond: 'bg-purple-100 text-purple-700',
  Platinum: 'bg-slate-100 text-slate-700',
  Gold: 'bg-yellow-100 text-yellow-700',
  Silver: 'bg-gray-100 text-gray-600',
};

const SOURCE_LABELS: Record<string, string> = {
  pipeline: 'Pipeline',
  proposal: 'Proposal',
  followup: 'Follow-up',
  idle_cash: 'Idle Cash',
};

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'followup', label: 'Follow-ups' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'idle_cash', label: 'Idle Cash' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ActionItemCard({
  item,
  onDone,
  onSkip,
}: {
  item: ActionItem;
  onDone?: (id: string) => void;
  onSkip?: (id: string) => void;
}): ReactElement {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {/* Priority badge */}
        <span
          className={[
            'flex-shrink-0 text-xs font-bold w-8 h-8 rounded-lg flex items-center justify-center',
            PRIORITY_STYLES[item.priority_label] ?? PRIORITY_STYLES.P4,
          ].join(' ')}
        >
          {item.priority_label}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-gray-900">{item.client_name}</span>
            <span
              className={[
                'text-xs px-2 py-0.5 rounded-full font-medium',
                TIER_STYLES[item.client_tier] ?? 'bg-gray-100 text-gray-600',
              ].join(' ')}
            >
              {item.client_tier}
            </span>
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
              {SOURCE_LABELS[item.source] ?? item.source}
            </span>
          </div>

          <p className="text-xs font-medium text-gray-700 mb-0.5">{item.action_type}</p>
          <p className="text-xs text-gray-500 leading-relaxed">{item.description}</p>

          {item.aum_context && (
            <p className="text-xs text-gray-400 mt-1">{item.aum_context}</p>
          )}
          {item.urgency_reason && (
            <p className="text-xs text-red-500 font-medium mt-1">⚠ {item.urgency_reason}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => onDone?.(item.action_id)}
            className="text-xs px-3 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 transition-colors font-medium"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => onSkip?.(item.action_id)}
            className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ActionList({ data }: ActionListProps): ReactElement {
  const [activeTab, setActiveTab] = useState('all');
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  const filtered = (data.actions ?? []).filter((a) => {
    if (doneIds.has(a.action_id)) return false;
    if (activeTab === 'all') return true;
    return a.source === activeTab;
  });

  const handleDone = (id: string) => setDoneIds((prev) => new Set([...prev, id]));
  const handleSkip = (id: string) => setDoneIds((prev) => new Set([...prev, id]));

  const total = (data.actions ?? []).filter((a) => !doneIds.has(a.action_id)).length;

  return (
    <div className="bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">Today's Priority Actions</span>
          <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full font-medium">
            {total}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-2 bg-white border-b border-gray-100 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={[
              'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap',
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-500 hover:bg-gray-100',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Action items */}
      <div className="p-3 space-y-2 max-h-[480px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-2xl mb-2">🎉</p>
            <p className="text-sm font-medium text-gray-600">No priority actions today!</p>
            <p className="text-xs text-gray-400 mt-1">Check back tomorrow.</p>
          </div>
        ) : (
          filtered.map((item) => (
            <ActionItemCard
              key={item.action_id}
              item={item}
              onDone={handleDone}
              onSkip={handleSkip}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default ActionList;
