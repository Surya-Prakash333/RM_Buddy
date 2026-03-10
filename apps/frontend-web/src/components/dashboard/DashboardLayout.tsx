import { type ReactNode } from 'react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';

interface DashboardLayoutProps {
  /** Main content area — typically the page's primary widgets/tables. */
  children: ReactNode;
  /** Optional chat panel override. Defaults to a placeholder. */
  chatPanel?: ReactNode;
  /** Passed through to TopBar for the notification badge. */
  pendingAlertsCount?: number;
}

/**
 * Three-column dashboard shell:
 *
 *  ┌──────────────────────────────────────────────────────────┐
 *  │                      TopBar (full width)                 │
 *  ├──────────────┬──────────────────────┬────────────────────┤
 *  │  Sidebar     │   Main Content       │   Chat Panel       │
 *  │  (240px)     │   (flex-1)           │   (380px)          │
 *  │  fixed       │   scrollable         │   fixed / scroll   │
 *  └──────────────┴──────────────────────┴────────────────────┘
 *
 * Min-width: 1280px.  On smaller viewports a horizontal scrollbar appears
 * rather than breaking the layout — this is intentional for a desktop-first
 * wealth management tool.
 */
export function DashboardLayout({
  children,
  chatPanel,
  pendingAlertsCount = 0,
}: DashboardLayoutProps): JSX.Element {
  return (
    <div className="flex flex-col h-screen min-w-[1280px] bg-surface overflow-x-auto">
      {/* ── Top bar spans full width ─────────────────────────── */}
      <TopBar pendingAlertsCount={pendingAlertsCount} />

      {/* ── Three-column body ────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Sidebar */}
        <Sidebar />

        {/* Centre: Main scrollable content */}
        <main className="flex-1 overflow-y-auto p-6 min-w-0">
          {children}
        </main>

        {/* Right: Chat panel */}
        <aside className="w-[380px] shrink-0 bg-gray-50 border-l border-gray-200 flex flex-col overflow-hidden">
          {chatPanel ?? <ChatPanelPlaceholder />}
        </aside>
      </div>
    </div>
  );
}

// ── Chat panel placeholder ───────────────────────────────────────────────────

function ChatPanelPlaceholder(): JSX.Element {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <p className="text-sm font-semibold text-gray-800">RM Buddy AI</p>
        <p className="text-xs text-gray-400">Ask me anything about your clients</p>
      </div>

      {/* Message area placeholder */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-6 h-6 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700">Chat coming soon</p>
          <p className="text-xs text-gray-400 max-w-[200px]">
            The AI chat panel will be wired up in the next sprint.
          </p>
        </div>
      </div>

      {/* Input area placeholder */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white">
        <div className="h-9 rounded-lg bg-gray-100 animate-pulse" />
      </div>
    </div>
  );
}
