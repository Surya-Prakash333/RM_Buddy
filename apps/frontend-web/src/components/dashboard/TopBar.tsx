import { useEffect, useState } from 'react';
import { Bell, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/hooks/useAuth';

interface TopBarProps {
  /** Number of unread / pending alerts to show on the bell badge. */
  pendingAlertsCount?: number;
}

function formatDateTime(date: Date): { dateStr: string; timeStr: string } {
  const dateStr = date.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return { dateStr, timeStr };
}

const ROLE_LABEL: Record<string, string> = {
  RM: 'Relationship Manager',
  BM: 'Branch Manager',
  ADMIN: 'Administrator',
};

/**
 * Full-width top bar spanning all three layout columns.
 * Shows the RM Buddy brand on the left, current date/time in the centre,
 * and RM identity + actions on the right.
 */
export function TopBar({ pendingAlertsCount = 0 }: TopBarProps): JSX.Element {
  const { rmIdentity, logout } = useAuth();
  const [now, setNow] = useState(() => new Date());

  // Update clock every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { dateStr, timeStr } = formatDateTime(now);

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-4 z-10 shrink-0">
      {/* ── Left: Brand ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 w-[240px] shrink-0">
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-white text-xs font-bold">RM</span>
        </div>
        <span className="font-semibold text-primary text-sm tracking-wide">RM Buddy</span>
        <span className="text-gray-300 text-xs ml-1">by Nuvama</span>
      </div>

      {/* ── Centre: Date & Time ─────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center gap-2 text-xs text-gray-500 select-none">
        <span>{dateStr}</span>
        <span className="text-gray-300">|</span>
        <span className="font-medium text-gray-700">{timeStr}</span>
      </div>

      {/* ── Right: RM identity + actions ────────────────────────── */}
      <div className="flex items-center gap-3 w-[380px] justify-end shrink-0">
        {rmIdentity && (
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-800 leading-tight">
                {rmIdentity.rm_name}
              </p>
              <p className="text-xs text-gray-500 leading-tight">
                {ROLE_LABEL[rmIdentity.role] ?? rmIdentity.role}
              </p>
            </div>
            <span
              className={clsx(
                'px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
                {
                  'bg-primary/10 text-primary': rmIdentity.role === 'RM',
                  'bg-secondary/10 text-secondary': rmIdentity.role === 'BM',
                  'bg-accent/10 text-amber-700': rmIdentity.role === 'ADMIN',
                },
              )}
            >
              {rmIdentity.role}
            </span>
          </div>
        )}

        {/* Notification bell */}
        <button
          className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label={`${pendingAlertsCount} pending alerts`}
        >
          <Bell className="w-4 h-4" />
          {pendingAlertsCount > 0 && (
            <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
              {pendingAlertsCount > 9 ? '9+' : pendingAlertsCount}
            </span>
          )}
        </button>

        {/* Logout */}
        <button
          onClick={logout}
          className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-danger transition-colors"
          aria-label="Logout"
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
