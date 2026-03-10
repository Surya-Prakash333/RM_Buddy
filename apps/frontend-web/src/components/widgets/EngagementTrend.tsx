// ============================================================
// EngagementTrend.tsx — Engagement Consistency Widget (S1-F37-L4)
// ============================================================

import type { ReactElement } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EngagementData {
  rm_name: string;
  consistency_score: number;
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  login_regularity: number;
  session_depth: number;
  crm_usage: number;
  recommendation?: string;
}

interface EngagementTrendProps {
  data: EngagementData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TREND_CONFIG = {
  IMPROVING: {
    icon: '↑',
    label: 'IMPROVING',
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-200',
    scoreColor: 'text-green-700',
  },
  STABLE: {
    icon: '→',
    label: 'STABLE',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    scoreColor: 'text-blue-700',
  },
  DECLINING: {
    icon: '↓',
    label: 'DECLINING',
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    scoreColor: 'text-red-700',
  },
};

function SubMetricBar({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description?: string;
}): ReactElement {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  const barColor =
    pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400';

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <span className="text-xs font-bold text-gray-900">{pct}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={['h-full rounded-full transition-all duration-700', barColor].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
      {description && (
        <p className="text-[10px] text-gray-400 mt-0.5">{description}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EngagementTrend({ data }: EngagementTrendProps): ReactElement {
  const cfg = TREND_CONFIG[data.trend] ?? TREND_CONFIG.STABLE;
  const score = Math.round(data.consistency_score);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-gradient-to-r from-[#1B4F72] to-[#2E86AB]">
        <p className="text-white font-semibold text-base">Engagement: {data.rm_name}</p>
        <p className="text-white/70 text-xs">Consistency analysis</p>
      </div>

      <div className="p-5">
        {/* Score + trend */}
        <div
          className={[
            'flex items-center justify-between p-4 rounded-xl border mb-5',
            cfg.bg,
            cfg.border,
          ].join(' ')}
        >
          <div>
            <p className={['text-5xl font-black', cfg.scoreColor].join(' ')}>
              {score}
              <span className="text-2xl font-normal">/100</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">Consistency Score</p>
          </div>
          <div className="text-right">
            <p className={['text-3xl font-bold', cfg.color].join(' ')}>{cfg.icon}</p>
            <p className={['text-xs font-bold mt-1', cfg.color].join(' ')}>{cfg.label}</p>
          </div>
        </div>

        {/* Sub-metrics */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Breakdown
          </p>
          <SubMetricBar
            label="Login Regularity"
            value={data.login_regularity}
            description="How consistently the RM logs in each day"
          />
          <SubMetricBar
            label="Session Depth"
            value={data.session_depth}
            description="Average time and pages visited per session"
          />
          <SubMetricBar
            label="CRM Usage"
            value={data.crm_usage}
            description="How actively CRM is being updated"
          />
        </div>

        {/* Recommendation */}
        {data.recommendation && (
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
            <p className="text-xs font-semibold text-gray-700 mb-1">💡 Recommendation</p>
            <p className="text-xs text-gray-600 leading-relaxed">{data.recommendation}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default EngagementTrend;
