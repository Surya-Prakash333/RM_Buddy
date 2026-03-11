import { NavLink } from 'react-router-dom';

import {
  LayoutDashboard,
  Users,
  Bell,
  TrendingUp,
  Lightbulb,
  History,
  Settings,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/hooks/useAuth';

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

const RECENT_ITEMS = [
  { label: 'Portfolio Review',      time: '2m ago',   group: 'Today' },
  { label: 'Client Risk Assessment', time: '1h ago',  group: 'Today' },
  { label: 'Market Analysis',        time: 'Yesterday', group: 'Yesterday' },
];

interface SidebarProps {
  expanded: boolean;
  onToggle: () => void;
}

export function Sidebar({ expanded, onToggle }: SidebarProps): JSX.Element {
  const { rmIdentity, logout } = useAuth();

  const initials = rmIdentity
    ? rmIdentity.rm_name
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : 'RM';

  // Group recent items
  const groupedRecent: Record<string, typeof RECENT_ITEMS> = {};
  RECENT_ITEMS.forEach((item) => {
    if (!groupedRecent[item.group]) groupedRecent[item.group] = [];
    groupedRecent[item.group].push(item);
  });

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

        {/* ── Recent items (only when expanded) ─── */}
        {expanded && (
          <div className="pt-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">
              Recent
            </p>
            {Object.entries(groupedRecent).map(([group, items]) => (
              <div key={group} className="mb-2">
                <p className="text-[10px] text-gray-400 px-3 mb-1">{group}</p>
                {items.map((item) => (
                  <button
                    key={item.label}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors group"
                  >
                    <p className="text-xs font-medium text-gray-700 truncate group-hover:text-gray-900">
                      {item.label}
                    </p>
                    <p className="text-[10px] text-gray-400">{item.time}</p>
                  </button>
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
