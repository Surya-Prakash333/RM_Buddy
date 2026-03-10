import type { ReactElement, ReactNode } from 'react';
import { AlertTriangle, AlertCircle, Info, Bell } from 'lucide-react';
import type { AlertCardData, WidgetActionExtended } from '../../types/widget.types';

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

type SeverityKey = 'critical' | 'high' | 'medium' | 'low';

function normalizeSeverity(s: AlertCardData['severity']): SeverityKey {
  return s.toLowerCase() as SeverityKey;
}

const SEVERITY_BORDER: Record<SeverityKey, string> = {
  critical: 'border-l-4 border-red-500',
  high: 'border-l-4 border-orange-400',
  medium: 'border-l-4 border-yellow-400',
  low: 'border-l-4 border-blue-400',
};

const SEVERITY_BADGE: Record<SeverityKey, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-blue-100 text-blue-600',
};

const SEVERITY_ICON: Record<SeverityKey, ReactNode> = {
  critical: <AlertCircle className="w-4 h-4 text-red-500" />,
  high: <AlertTriangle className="w-4 h-4 text-orange-400" />,
  medium: <AlertTriangle className="w-4 h-4 text-yellow-400" />,
  low: <Info className="w-4 h-4 text-blue-400" />,
};

// ---------------------------------------------------------------------------
// Tier badge
// ---------------------------------------------------------------------------

const TIER_BADGE: Record<string, string> = {
  Diamond: 'bg-purple-100 text-purple-700',
  Platinum: 'bg-gray-100 text-gray-700',
  Gold: 'bg-yellow-100 text-yellow-700',
  Silver: 'bg-blue-100 text-blue-600',
};

function tierBadgeClass(tier: string): string {
  return TIER_BADGE[tier] ?? 'bg-gray-100 text-gray-600';
}

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

// ---------------------------------------------------------------------------
// Action button variant helper
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

interface AlertCardProps {
  title: string;
  data: AlertCardData;
  actions?: WidgetActionExtended[];
  onAction?: (action: WidgetActionExtended) => void;
}

export function AlertCard({ title, data, actions, onAction }: AlertCardProps): ReactElement {
  return (
    <div
      className={[
        'bg-white rounded-xl shadow-sm border border-gray-100 p-4',
        SEVERITY_BORDER[normalizeSeverity(data.severity)],
      ].join(' ')}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {SEVERITY_ICON[normalizeSeverity(data.severity)]}
          <span className="font-semibold text-gray-800 text-sm truncate">{title}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Alert type label */}
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Bell className="w-3 h-3" />
            {data.alert_type.replace(/_/g, ' ')}
          </span>
          {/* Severity badge */}
          <span
            className={[
              'text-xs font-medium px-2 py-0.5 rounded-full uppercase',
              SEVERITY_BADGE[normalizeSeverity(data.severity)],
            ].join(' ')}
          >
            {data.severity}
          </span>
        </div>
      </div>

      {/* Client row */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium text-gray-700">{data.client_name}</span>
        <span
          className={[
            'text-xs px-2 py-0.5 rounded-full font-medium',
            tierBadgeClass(data.client_tier),
          ].join(' ')}
        >
          {data.client_tier}
        </span>
      </div>

      {/* Alert message/body */}
      <p className="text-sm text-gray-700 mb-2 leading-relaxed">
        {data.body ?? data.message ?? ''}
      </p>

      {/* Recommendation (new field) or action_suggestion (old field) */}
      {(data.recommendation ?? data.action_suggestion) && (
        <p className="text-xs text-gray-500 italic mb-3">
          {data.recommendation ?? data.action_suggestion}
        </p>
      )}

      {/* Footer: timestamp + status + action buttons */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-gray-400">{relativeTime(data.created_at)}</span>

        {data.status === 'ACKNOWLEDGED' ? (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full font-medium">
            ✓ Acknowledged
          </span>
        ) : actions && actions.length > 0 ? (
          <div className="flex items-center gap-2 flex-wrap">
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
        ) : data.status === 'PENDING' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Acknowledge
            </button>
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-lg bg-[#1B4F72] text-white hover:bg-[#2E86AB] transition-colors"
            >
              Take Action
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AlertCard;
