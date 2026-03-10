// ============================================================
// StrengthRadar.tsx — Strength Analysis Widget (S1-F33-L4)
// Uses horizontal bar chart (no SVG dependencies)
// ============================================================

import type { ReactElement } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrengthDimension {
  dimension: string;
  score: number;
  peer_median: number;
  percentile: number;
  label: 'STRENGTH' | 'AVERAGE' | 'BELOW';
}

export interface StrengthData {
  rm_name: string;
  top_strengths: StrengthDimension[];
  coaching_note?: string;
}

interface StrengthRadarProps {
  data: StrengthData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LABEL_STYLES: Record<StrengthDimension['label'], { bar: string; badge: string; text: string }> = {
  STRENGTH: {
    bar: 'bg-green-500',
    badge: 'bg-green-100 text-green-700',
    text: '💪 Strength',
  },
  AVERAGE: {
    bar: 'bg-blue-400',
    badge: 'bg-blue-100 text-blue-700',
    text: '→ Average',
  },
  BELOW: {
    bar: 'bg-orange-400',
    badge: 'bg-orange-100 text-orange-700',
    text: '↓ Below avg',
  },
};

function DimensionBar({ dim }: { dim: StrengthDimension }): ReactElement {
  const styles = LABEL_STYLES[dim.label];
  const maxScore = 100;
  const barPct = Math.min(100, Math.round((dim.score / maxScore) * 100));
  const medianPct = Math.min(100, Math.round((dim.peer_median / maxScore) * 100));

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-gray-800">{dim.dimension}</span>
        <div className="flex items-center gap-2">
          <span
            className={['text-[10px] px-2 py-0.5 rounded-full font-medium', styles.badge].join(' ')}
          >
            {styles.text}
          </span>
          <span className="text-[10px] text-gray-500 font-medium">{dim.percentile}th pct</span>
        </div>
      </div>

      {/* Bar */}
      <div className="relative h-5 bg-gray-100 rounded-full overflow-hidden">
        {/* Peer median line */}
        <div
          className="absolute top-0 h-full border-r-2 border-gray-400 border-dashed z-10"
          style={{ left: `${medianPct}%` }}
          title={`Peer median: ${dim.peer_median}`}
        />
        {/* Score bar */}
        <div
          className={['h-full rounded-full transition-all duration-700', styles.bar].join(' ')}
          style={{ width: `${barPct}%` }}
        />
      </div>

      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-gray-400">Score: {dim.score}</span>
        <span className="text-[10px] text-gray-400">Median: {dim.peer_median}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StrengthRadar({ data }: StrengthRadarProps): ReactElement {
  const strengths = data.top_strengths.filter((d) => d.label === 'STRENGTH');
  const others = data.top_strengths.filter((d) => d.label !== 'STRENGTH');

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-gradient-to-r from-[#1B4F72] to-[#2E86AB]">
        <p className="text-white font-semibold text-base">Strengths: {data.rm_name}</p>
        <p className="text-white/70 text-xs">Peer-relative performance analysis</p>
      </div>

      <div className="p-5">
        {/* Top strengths */}
        {strengths.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              🌟 Top Strengths
            </p>
            {strengths.map((dim) => (
              <DimensionBar key={dim.dimension} dim={dim} />
            ))}
          </div>
        )}

        {/* Other dimensions */}
        {others.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Other Dimensions
            </p>
            {others.map((dim) => (
              <DimensionBar key={dim.dimension} dim={dim} />
            ))}
          </div>
        )}

        {data.top_strengths.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No data available yet.</p>
        )}

        {/* Coaching note */}
        {data.coaching_note && (
          <div className="mt-2 p-4 bg-amber-50 rounded-xl border border-amber-200">
            <p className="text-xs font-semibold text-amber-800 mb-1">💬 Coaching Note</p>
            <p className="text-xs text-amber-700 leading-relaxed italic">"{data.coaching_note}"</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default StrengthRadar;
