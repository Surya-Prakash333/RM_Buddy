// ============================================================
// DailyStatusCard.tsx — BM Daily Status Widget (S1-F6-L4)
// ============================================================

import type { ReactElement } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyStatusData {
  rm_id: string;
  rm_name: string;
  date: string;
  metrics: {
    calls: number;
    meetings: number;
    proposals: number;
    tasks_completed: number;
  };
  gaps: {
    calls_gap: number;
    meetings_gap: number;
    proposals_gap: number;
    tasks_gap: number;
  };
  peer_rank: {
    overall_rank: number;
    total_peers: number;
    percentile: number;
  };
  team_averages: {
    calls: number;
    meetings: number;
    proposals: number;
    tasks_completed: number;
  };
}

interface DailyStatusCardProps {
  data: DailyStatusData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function rankSuffix(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

function MetricRow({
  label,
  actual,
  average,
  gap,
}: {
  label: string;
  actual: number;
  average: number;
  gap: number;
}): ReactElement {
  const maxVal = Math.max(actual, average, 1);
  const pctActual = Math.round((actual / maxVal) * 100);
  const pctAvg = Math.round((average / maxVal) * 100);
  const isAbove = gap >= 0;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-900">{actual}</span>
          <span
            className={[
              'text-xs px-2 py-0.5 rounded-full font-medium',
              isAbove
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700',
            ].join(' ')}
          >
            {isAbove ? '+' : ''}{gap} vs avg
          </span>
        </div>
      </div>

      {/* Progress bars */}
      <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
        {/* Team average marker */}
        <div
          className="absolute top-0 h-full border-r-2 border-gray-400 border-dashed z-10"
          style={{ left: `${pctAvg}%` }}
          title={`Team avg: ${average}`}
        />
        {/* Actual bar */}
        <div
          className={[
            'h-full rounded-full transition-all duration-500',
            isAbove ? 'bg-green-500' : 'bg-amber-400',
          ].join(' ')}
          style={{ width: `${pctActual}%` }}
        />
      </div>

      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-gray-400">0</span>
        <span className="text-[10px] text-gray-400">Avg: {average}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DailyStatusCard({ data }: DailyStatusCardProps): ReactElement {
  const rank = data.peer_rank;
  const rankLabel = `${rank.overall_rank}${rankSuffix(rank.overall_rank)} of ${rank.total_peers}`;
  const percentile = rank.percentile;

  const percentileColor =
    percentile >= 75 ? 'text-green-700 bg-green-100' :
    percentile >= 50 ? 'text-blue-700 bg-blue-100' :
    'text-amber-700 bg-amber-100';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-[#1B4F72] text-white">
        <div>
          <p className="font-semibold text-base">{data.rm_name}</p>
          <p className="text-white/70 text-xs">{formatDate(data.date)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold">Rank #{rankLabel}</p>
          <p className="text-white/70 text-xs">Today</p>
        </div>
      </div>

      <div className="p-5">
        {/* Metric rows */}
        <MetricRow
          label="Calls Made"
          actual={data.metrics.calls}
          average={data.team_averages.calls}
          gap={data.gaps.calls_gap}
        />
        <MetricRow
          label="Meetings"
          actual={data.metrics.meetings}
          average={data.team_averages.meetings}
          gap={data.gaps.meetings_gap}
        />
        <MetricRow
          label="Proposals"
          actual={data.metrics.proposals}
          average={data.team_averages.proposals}
          gap={data.gaps.proposals_gap}
        />
        <MetricRow
          label="Tasks Completed"
          actual={data.metrics.tasks_completed}
          average={data.team_averages.tasks_completed}
          gap={data.gaps.tasks_gap}
        />

        {/* Percentile pill */}
        <div className={['mt-4 text-center py-2 rounded-xl text-xs font-semibold', percentileColor].join(' ')}>
          Top {100 - percentile}th percentile today
        </div>
      </div>
    </div>
  );
}

export default DailyStatusCard;
