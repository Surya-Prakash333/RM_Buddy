import type { ReactElement } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { MetricCardData, WidgetActionExtended } from '../../types/widget.types';

// ---------------------------------------------------------------------------
// Color variants for the value text
// ---------------------------------------------------------------------------

const VALUE_COLOR: Record<NonNullable<MetricCardData['color']>, string> = {
  default: 'text-gray-900',
  success: 'text-green-600',
  warning: 'text-yellow-600',
  danger: 'text-red-600',
};

const TREND_CONFIG: Record<NonNullable<MetricCardData['trend']>, { icon: ReactElement; className: string }> = {
  up: {
    icon: <TrendingUp className="w-4 h-4" />,
    className: 'text-green-600',
  },
  down: {
    icon: <TrendingDown className="w-4 h-4" />,
    className: 'text-red-500',
  },
  flat: {
    icon: <Minus className="w-4 h-4" />,
    className: 'text-gray-400',
  },
};

// ---------------------------------------------------------------------------
// Action button helpers
// ---------------------------------------------------------------------------

const ACTION_VARIANT: Record<string, string> = {
  primary: 'bg-primary text-white hover:bg-primary/90',
  secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
  danger: 'bg-red-500 text-white hover:bg-red-600',
};

function actionButtonClass(variant?: string): string {
  return ACTION_VARIANT[variant ?? 'secondary'] ?? ACTION_VARIANT.secondary;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MetricCardProps {
  title: string;
  data: MetricCardData;
  actions?: WidgetActionExtended[];
  onAction?: (action: WidgetActionExtended) => void;
}

export function MetricCard({ title, data, actions, onAction }: MetricCardProps): ReactElement {
  const colorClass = VALUE_COLOR[data.color ?? 'default'];
  const trendConfig = data.trend ? TREND_CONFIG[data.trend] : null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-1">
      {/* Title */}
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{title}</p>

      {/* Main value */}
      <p className={['text-3xl font-bold leading-tight', colorClass].join(' ')}>{data.value}</p>

      {/* Trend indicator */}
      {trendConfig && (
        <div className={['flex items-center gap-1 text-sm font-medium', trendConfig.className].join(' ')}>
          {trendConfig.icon}
          {data.trend_value && <span>{data.trend_value}</span>}
        </div>
      )}

      {/* Subtitle */}
      {data.subtitle && (
        <p className="text-xs text-gray-400 mt-0.5">{data.subtitle}</p>
      )}

      {/* Action buttons */}
      {actions && actions.length > 0 && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onAction?.(action)}
              className={[
                'text-xs font-medium px-3 py-1.5 rounded-lg transition-colors',
                actionButtonClass(action.variant),
              ].join(' ')}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MetricCard;
