// ============================================================
// WidgetPanel.tsx — Right side dynamic widget area
// ============================================================

import type { ReactElement, ReactNode } from 'react';
import { LayoutGrid } from 'lucide-react';

interface WidgetPanelProps {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
  /** Show a collapse/pin toggle button on top-right */
  onToggleCollapse?: () => void;
}

function EmptyWorkspace(): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center select-none">
      <div className="mb-4 opacity-30">
        <LayoutGrid size={42} strokeWidth={1} className="text-gray-400 mx-auto" />
      </div>
      <p className="text-sm text-gray-400 font-medium">
        Workspace activates when insights or actions are requested.
      </p>
      <p className="text-xs text-gray-300 mt-1.5">
        Ask for analysis, simulations, or execution.
      </p>
    </div>
  );
}

export function WidgetPanel({
  children,
  title,
  subtitle,
  onToggleCollapse,
}: WidgetPanelProps): ReactElement {
  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between px-5 py-3 shrink-0">
        <div>
          {title && (
            <p className="text-sm font-semibold text-gray-800">{title}</p>
          )}
          {subtitle && (
            <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
          )}
        </div>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Collapse panel"
          >
            {/* Collapse icon (two arrows pointing inward) */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Content area with dotted grid background ─────────────── */}
      <div
        className="flex-1 overflow-y-auto relative"
        style={{
          backgroundImage:
            'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0',
        }}
      >
        {children ? (
          <div className="p-4 space-y-4">{children}</div>
        ) : (
          <EmptyWorkspace />
        )}
      </div>
    </div>
  );
}

export default WidgetPanel;
