import type { ReactElement } from 'react';
import { CheckCircle, XCircle, User } from 'lucide-react';
import type { ActionCardData, WidgetActionExtended } from '../../types/widget.types';

// ---------------------------------------------------------------------------
// Priority badge
// ---------------------------------------------------------------------------

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-500',
};

const PRIORITY_BORDER: Record<string, string> = {
  high: 'border-l-4 border-red-400',
  medium: 'border-l-4 border-yellow-400',
  low: 'border-l-4 border-gray-300',
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

interface ActionCardProps {
  title: string;
  data: ActionCardData;
  actions?: WidgetActionExtended[];
  onAction?: (action: WidgetActionExtended) => void;
  onComplete?: () => void;
  onSkip?: () => void;
}

export function ActionCard({
  title,
  data,
  actions,
  onAction,
  onComplete,
  onSkip,
}: ActionCardProps): ReactElement {
  const borderClass = PRIORITY_BORDER[data.priority ?? 'low'];

  return (
    <div
      className={[
        'bg-white rounded-xl shadow-sm border border-gray-100 p-4',
        borderClass,
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-semibold text-gray-800 text-sm">{title}</span>
        {data.priority && (
          <span
            className={[
              'text-xs px-2 py-0.5 rounded-full font-medium capitalize flex-shrink-0',
              PRIORITY_BADGE[data.priority] ?? '',
            ].join(' ')}
          >
            {data.priority}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-gray-700 leading-relaxed mb-3">{data.description}</p>

      {/* Client reference */}
      {data.client_name && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-3">
          <User className="w-3 h-3" />
          <span>{data.client_name}</span>
        </div>
      )}

      {/* Due date */}
      {data.due_date && (
        <p className="text-xs text-gray-400 mb-3">Due: {data.due_date}</p>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Quick complete / skip */}
        {onComplete && (
          <button
            type="button"
            onClick={onComplete}
            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Complete
          </button>
        )}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" />
            Skip
          </button>
        )}

        {/* Custom action buttons from prop */}
        {actions &&
          actions.map((action) => (
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
    </div>
  );
}

export default ActionCard;
