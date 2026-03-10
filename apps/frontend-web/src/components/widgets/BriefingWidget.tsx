import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  Bell,
  Calendar,
  Zap,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  FileText,
} from 'lucide-react';
import type { BriefingSection, WidgetActionExtended } from '../../types/widget.types';

// ---------------------------------------------------------------------------
// Section icon resolver — maps icon string hint to lucide icon
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, ReactNode> = {
  alerts: <Bell className="w-4 h-4" />,
  meetings: <Calendar className="w-4 h-4" />,
  actions: <Zap className="w-4 h-4" />,
  revenue: <TrendingUp className="w-4 h-4" />,
};

function resolveIcon(hint?: string): ReactNode {
  if (!hint) return <FileText className="w-4 h-4" />;
  const key = hint.toLowerCase();
  return ICON_MAP[key] ?? <FileText className="w-4 h-4" />;
}

// ---------------------------------------------------------------------------
// Priority badge
// ---------------------------------------------------------------------------

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-500',
};

// ---------------------------------------------------------------------------
// Individual section (collapsible)
// ---------------------------------------------------------------------------

interface SectionProps {
  section: BriefingSection;
  defaultOpen?: boolean;
}

function BriefingSectionPanel({ section, defaultOpen = true }: SectionProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2 text-gray-700">
          <span className="text-gray-400">{resolveIcon(section.icon ?? section.title)}</span>
          <span className="text-sm font-semibold">{section.title}</span>
          <span className="text-xs text-gray-400">({section.items.length})</span>
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {/* Section items */}
      {open && (
        <ul className="divide-y divide-gray-50">
          {section.items.map((item, idx) => (
            <li
              key={idx}
              className={[
                'flex items-start gap-2 px-3 py-2.5',
                item.priority === 'high' ? 'bg-red-50/30' : '',
              ].join(' ')}
            >
              {/* Bullet */}
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />

              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 leading-relaxed">{item.text}</p>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {item.priority && (
                  <span
                    className={[
                      'text-xs px-1.5 py-0.5 rounded font-medium capitalize',
                      PRIORITY_BADGE[item.priority] ?? '',
                    ].join(' ')}
                  >
                    {item.priority}
                  </span>
                )}
                {item.tag && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">
                    {item.tag}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
// Main component
// ---------------------------------------------------------------------------

interface BriefingWidgetProps {
  title: string;
  data: { sections: BriefingSection[]; generated_at?: string };
  actions?: WidgetActionExtended[];
  onAction?: (action: WidgetActionExtended) => void;
}

export function BriefingWidget({
  title,
  data,
  actions,
  onAction,
}: BriefingWidgetProps): ReactElement {
  const { sections, generated_at } = data;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Widget header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <p className="font-semibold text-gray-800 text-sm">{title}</p>
          {generated_at && (
            <p className="text-xs text-gray-400 mt-0.5">
              Generated at {new Date(generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>

        {actions && actions.length > 0 && (
          <div className="flex items-center gap-2">
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

      {/* Sections */}
      <div className="p-4 flex flex-col gap-3">
        {sections.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No briefing content available</p>
        ) : (
          sections.map((section, idx) => (
            <BriefingSectionPanel
              key={section.title + idx}
              section={section}
              defaultOpen={idx === 0}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default BriefingWidget;
