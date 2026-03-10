import type { ReactElement } from 'react';
import { BarChart2 } from 'lucide-react';
import type { PipelineChartItem, WidgetActionExtended } from '../../types/widget.types';

// ---------------------------------------------------------------------------
// Stage colour palette — cycles if more stages than palette entries
// ---------------------------------------------------------------------------

const STAGE_COLORS = [
  'bg-blue-500',
  'bg-indigo-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-orange-400',
  'bg-yellow-400',
  'bg-green-500',
  'bg-teal-500',
];

// Parse amount string (e.g. "₹12.5 Cr", "12500000") to a numeric value for
// calculating proportional bar widths. Falls back to using `count`.
function parseAmount(amount: string): number {
  const cleaned = amount.replace(/[₹,\s]/g, '');
  // Handle Cr suffix (Indian crore)
  if (/cr/i.test(cleaned)) {
    return parseFloat(cleaned) * 10_000_000;
  }
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PipelineChartProps {
  title: string;
  data: { stages: PipelineChartItem[]; total_amount?: string };
  actions?: WidgetActionExtended[];
  onAction?: (action: WidgetActionExtended) => void;
}

export function PipelineChart({
  title,
  data,
  actions,
  onAction,
}: PipelineChartProps): ReactElement {
  const { stages, total_amount } = data;

  // Calculate max numeric amount for proportional bars
  const numerics = stages.map((s) => {
    const n = parseAmount(s.amount);
    return n > 0 ? n : s.count;
  });
  const max = Math.max(...numerics, 1);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-gray-400" />
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
        </div>

        <div className="flex items-center gap-3">
          {total_amount && (
            <span className="text-xs text-gray-500 font-medium">Total: {total_amount}</span>
          )}
          {actions && actions.length > 0 && (
            <div className="flex items-center gap-2">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => onAction?.(action)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bars */}
      {stages.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-sm text-gray-400">
          No pipeline data
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {stages.map((stage, idx) => {
            const numeric = numerics[idx];
            const pct = Math.max((numeric / max) * 100, 2); // min 2% so bar is always visible
            const colorClass = stage.color ?? STAGE_COLORS[idx % STAGE_COLORS.length];

            return (
              <div key={stage.stage} className="flex flex-col gap-1">
                {/* Stage label row */}
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700">{stage.stage}</span>
                  <div className="flex items-center gap-3 text-gray-500">
                    <span>{stage.count} deal{stage.count !== 1 ? 's' : ''}</span>
                    <span className="font-semibold text-gray-700">{stage.amount}</span>
                  </div>
                </div>

                {/* Horizontal bar */}
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={['h-full rounded-full transition-all duration-500', colorClass].join(' ')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PipelineChart;
