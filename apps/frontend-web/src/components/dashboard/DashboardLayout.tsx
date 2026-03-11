import { type ReactNode, useState } from 'react';
import { Sidebar } from './Sidebar';
import { RMCompanionPanel } from '@/components/chat/RMCompanionPanel';
import { WidgetPanel } from '@/components/widgets/WidgetPanel';

interface DashboardLayoutProps {
  /** Not used by the new layout — main content is now the widget panel */
  children?: ReactNode;
  /** Passed to WidgetPanel as dynamic widgets */
  widgetContent?: ReactNode;
  /** Widget panel title (e.g. "Daily Planner" or "Client Profile") */
  widgetTitle?: string;
  /** Optional subtitle beneath the widget title */
  widgetSubtitle?: string;
  /** Passed through for compatibility, unused in new layout */
  pendingAlertsCount?: number;
  /** Optional override for the chat panel (for testing) */
  chatPanel?: ReactNode;
}

/**
 * New two-column layout matching the Figma design:
 *
 *  ┌──────┬──────────────────────────┬───────────────────────────────┐
 *  │ Side │    RM Companion Panel    │       Widget Panel             │
 *  │ bar  │    (chat + voice)        │       (dotted grid)            │
 *  │ 55px │       ~380px             │          flex-1                │
 *  └──────┴──────────────────────────┴───────────────────────────────┘
 *
 * The sidebar collapses to icon-only (55px) and expands to 210px.
 */
export function DashboardLayout({
  widgetContent,
  widgetTitle,
  widgetSubtitle,
  chatPanel,
}: DashboardLayoutProps): JSX.Element {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      {/* ── Left sidebar ─────────────────────────────────────────── */}
      <Sidebar
        expanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded((v) => !v)}
      />

      {/* ── RM Companion (chat) panel ─────────────────────────────── */}
      <div
        className="shrink-0 flex flex-col border-r border-gray-100 overflow-hidden"
        style={{ width: '380px' }}
      >
        {chatPanel ?? <RMCompanionPanel />}
      </div>

      {/* ── Widget panel ─────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <WidgetPanel
          title={widgetTitle}
          subtitle={widgetSubtitle}
        >
          {widgetContent}
        </WidgetPanel>
      </div>
    </div>
  );
}
