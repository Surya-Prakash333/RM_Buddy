import { useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import axios from 'axios';

import {
  LayoutDashboard,
  Users,
  Bell,
  TrendingUp,
  Lightbulb,
  History,
  Settings,
  ChevronRight,
  Plus,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/auth.store';
import { useChatStore, type SessionSummary } from '@/store/chat.store';

interface NavItem {
  label: string;
  path: string;
  Icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',      path: '/dashboard',            Icon: LayoutDashboard },
  { label: 'Clients',        path: '/dashboard/clients',    Icon: Users },
  { label: 'Alerts',         path: '/dashboard/alerts',     Icon: Bell },
  { label: 'Performance',    path: '/dashboard/pipeline',   Icon: TrendingUp },
  { label: 'Practice with AI', path: '/dashboard/practice', Icon: Lightbulb },
  { label: 'History',        path: '/dashboard/history',    Icon: History },
  { label: 'Settings',       path: '/dashboard/settings',  Icon: Settings },
];

function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem('rm-buddy-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string } };
    return parsed?.state?.token ?? null;
  } catch {
    return null;
  }
}

function formatTimeAgo(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays}d ago`;
  } catch {
    return '';
  }
}

function groupByDay(sessions: SessionSummary[]): Record<string, SessionSummary[]> {
  const groups: Record<string, SessionSummary[]> = {};
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  for (const s of sessions) {
    let group = 'Older';
    try {
      const d = new Date(s.updated_at).toDateString();
      if (d === todayStr) group = 'Today';
      else if (d === yesterdayStr) group = 'Yesterday';
    } catch { /* ignore */ }
    if (!groups[group]) groups[group] = [];
    groups[group].push(s);
  }
  return groups;
}

interface SidebarProps {
  expanded: boolean;
  onToggle: () => void;
  onSessionSelect?: (sessionId: string) => void;
}

export function Sidebar({ expanded, onToggle, onSessionSelect }: SidebarProps): JSX.Element {
  const { rmIdentity, logout } = useAuth();
  const rmId = useAuthStore((s) => s.rmIdentity?.rm_id);
  const { recentSessions, setRecentSessions, activeSessionId, setActiveSession, startNewConversation, removeSession } = useChatStore();

  const initials = rmIdentity
    ? rmIdentity.rm_name
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : 'RM';

  // Fetch recent sessions
  const fetchSessions = useCallback(async () => {
    if (!rmId) return;
    const token = getAuthToken();
    const apiUrl = import.meta.env.VITE_API_URL ?? '';
    try {
      const resp = await axios.get(`${apiUrl}/api/v1/agent/sessions`, {
        params: { rm_id: rmId, limit: 10 },
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const sessions = resp.data?.sessions ?? [];
      setRecentSessions(sessions);
    } catch {
      // Silent fail — sidebar still works with empty list
    }
  }, [rmId, setRecentSessions]);

  useEffect(() => {
    fetchSessions();
    // Refresh every 30 seconds
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleSessionClick = (sessionId: string) => {
    setActiveSession(sessionId);
    onSessionSelect?.(sessionId);
  };

  const handleNewChat = () => {
    startNewConversation();
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation(); // Don't trigger session click
    const token = getAuthToken();
    const apiUrl = import.meta.env.VITE_API_URL ?? '';
    try {
      await axios.delete(`${apiUrl}/api/v1/agent/sessions/${sessionId}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      removeSession(sessionId);
    } catch {
      // Silent fail — session stays in list
    }
  };

  const grouped = groupByDay(recentSessions);

  return (
    <aside
      className={clsx(
        'flex flex-col h-full bg-white border-r border-gray-100 transition-all duration-300 ease-in-out overflow-hidden shrink-0 z-20',
        expanded ? 'w-[210px]' : 'w-[55px]',
      )}
    >
      {/* ── Logo / Toggle ─────────────────────────────────────── */}
      <div
        className={clsx(
          'flex items-center border-b border-gray-100 py-4 shrink-0',
          expanded ? 'px-4 gap-3' : 'justify-center px-0',
        )}
      >
        {expanded ? (
          <>
            <div className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center shrink-0">
              <span className="text-white text-[10px] font-bold leading-none">LOGO</span>
            </div>
            <button
              onClick={onToggle}
              className="ml-auto p-1 rounded hover:bg-gray-100 transition-colors"
              aria-label="Collapse sidebar"
            >
              <ChevronRight className="w-4 h-4 text-gray-400 rotate-180" />
            </button>
          </>
        ) : (
          <button
            onClick={onToggle}
            className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors"
            aria-label="Expand sidebar"
          >
            <span className="text-white text-[10px] font-bold leading-none">R</span>
          </button>
        )}
      </div>

      {/* ── Navigation ─────────────────────────────────────────── */}
      <nav className={clsx('flex-1 overflow-y-auto py-3 space-y-0.5', expanded ? 'px-3' : 'px-2')}>
        {NAV_ITEMS.map(({ label, path, Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/dashboard'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 py-2 rounded-lg text-sm font-medium transition-colors group',
                expanded ? 'px-3' : 'px-0 justify-center',
                isActive
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800',
              )
            }
            title={!expanded ? label : undefined}
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={clsx(
                    'shrink-0',
                    isActive ? 'text-gray-800' : 'text-gray-400 group-hover:text-gray-600',
                  )}
                  size={18}
                />
                {expanded && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}

        {/* ── Recent sessions (only when expanded) ─── */}
        {expanded && (
          <div className="pt-4">
            <div className="flex items-center justify-between px-3 mb-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Recent
              </p>
              <button
                onClick={handleNewChat}
                className="p-0.5 rounded hover:bg-gray-100 transition-colors"
                title="New conversation"
              >
                <Plus size={12} className="text-gray-400" />
              </button>
            </div>

            {recentSessions.length === 0 && (
              <p className="text-[10px] text-gray-300 px-3">No conversations yet</p>
            )}

            {Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="mb-2">
                <p className="text-[10px] text-gray-400 px-3 mb-1">{group}</p>
                {items.map((item) => (
                  <div
                    key={item.session_id}
                    onClick={() => handleSessionClick(item.session_id)}
                    className={clsx(
                      'w-full text-left px-3 py-1.5 rounded-lg transition-colors group cursor-pointer flex items-start gap-1',
                      activeSessionId === item.session_id
                        ? 'bg-blue-50 border border-blue-200'
                        : 'hover:bg-gray-50',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={clsx(
                        'text-xs font-medium truncate',
                        activeSessionId === item.session_id
                          ? 'text-blue-700'
                          : 'text-gray-700 group-hover:text-gray-900',
                      )}>
                        {item.title}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {formatTimeAgo(item.updated_at)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => void handleDeleteSession(e, item.session_id)}
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-all shrink-0 mt-0.5"
                      title="Delete conversation"
                    >
                      <Trash2 size={12} className="text-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* ── Footer: RM Avatar ────────────────────────────────────── */}
      <div
        className={clsx(
          'shrink-0 border-t border-gray-100 py-3',
          expanded ? 'px-3' : 'px-0 flex justify-center',
        )}
      >
        {expanded ? (
          <div className="flex items-center gap-2">
            <button
              onClick={logout}
              className="w-8 h-8 rounded-full bg-[#2c3e6b] flex items-center justify-center shrink-0 hover:opacity-80 transition-opacity"
              title="Logout"
            >
              <span className="text-white text-xs font-bold">{initials}</span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-gray-800 truncate">
                {rmIdentity?.rm_name ?? 'Loading…'}
              </p>
              <p className="text-[10px] text-gray-400">Senior RM</p>
            </div>
          </div>
        ) : (
          <button
            onClick={logout}
            className="w-8 h-8 rounded-full bg-[#2c3e6b] flex items-center justify-center hover:opacity-80 transition-opacity"
            title={`${rmIdentity?.rm_name ?? 'RM'} — Click to logout`}
          >
            <span className="text-white text-xs font-bold">{initials}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
