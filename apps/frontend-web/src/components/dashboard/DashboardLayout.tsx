import { type ReactNode, useState, useCallback, useEffect } from 'react';
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
 *  │  (240px)     │   (flex-1)           │   (resizable)      │
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
  const [chatWidth, setChatWidth] = useState(380);
  const [isDragging, setIsDragging] = useState(false);

  const startDragging = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const stopDragging = useCallback(() => {
    setIsDragging(false);
  }, []);

  const onDrag = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = document.body.clientWidth - e.clientX;
      if (newWidth >= 300 && newWidth <= 800) {
        setChatWidth(newWidth);
      }
    },
    [isDragging]
  );

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', onDrag);
      window.addEventListener('mouseup', stopDragging);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      // Prevent pointer events on iframes during drag
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(iframe => iframe.style.pointerEvents = 'none');
    } else {
      window.removeEventListener('mousemove', onDrag);
      window.removeEventListener('mouseup', stopDragging);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(iframe => iframe.style.pointerEvents = 'auto');
    }
    return () => {
      window.removeEventListener('mousemove', onDrag);
      window.removeEventListener('mouseup', stopDragging);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, onDrag, stopDragging]);

  return (
    <div className="flex flex-col h-screen min-w-[1280px] bg-surface overflow-x-auto">
      {/* ── Top bar spans full width ─────────────────────────── */}
      <TopBar pendingAlertsCount={pendingAlertsCount} />

      {/* ── Three-column body ────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left: Sidebar */}
        <Sidebar />

        {/* Centre: Main scrollable content */}
        <main className="flex-1 overflow-y-auto p-6 min-w-0">
          {children}
        </main>

        {/* Resizer Handle */}
        <div
          className="w-1.5 hover:bg-primary/50 cursor-col-resize z-10 transition-colors bg-transparent border-l border-gray-200 shadow-sm flex items-center justify-center shrink-0 group"
          onMouseDown={startDragging}
        >
          <div className="w-1 h-8 rounded-full bg-gray-300 group-hover:bg-primary/70 transition-colors" />
        </div>

        {/* Right: Chat panel */}
        <aside
          className="shrink-0 bg-gray-50 flex flex-col overflow-hidden transition-none"
          style={{ width: `${chatWidth}px` }}
        >
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
