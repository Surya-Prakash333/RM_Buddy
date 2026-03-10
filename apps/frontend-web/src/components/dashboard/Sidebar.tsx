import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Bell,
  TrendingUp,
  CalendarCheck,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/hooks/useAuth';

interface NavItem {
  label: string;
  path: string;
  Icon: React.FC<{ className?: string }>;
  badge?: number;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard },
  { label: 'Clients', path: '/dashboard/clients', Icon: Users },
  { label: 'Alerts', path: '/dashboard/alerts', Icon: Bell },
  { label: 'Pipeline', path: '/dashboard/pipeline', Icon: TrendingUp },
  { label: 'Meetings', path: '/dashboard/meetings', Icon: CalendarCheck },
];

/**
 * Fixed-width left sidebar (240px).
 * Contains the RM's profile summary at the top and primary navigation links.
 * Active route is highlighted with a white pill against the navy background.
 */
export function Sidebar(): JSX.Element {
  const { rmIdentity } = useAuth();

  // Derive initials for the avatar
  const initials = rmIdentity
    ? rmIdentity.rm_name
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : 'RM';

  return (
    <aside className="w-[240px] shrink-0 bg-[#1B4F72] flex flex-col h-full overflow-y-auto">
      {/* ── RM Profile ─────────────────────────────────────────── */}
      <div className="px-4 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-bold">{initials}</span>
          </div>

          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">
              {rmIdentity?.rm_name ?? 'Loading…'}
            </p>
            <p className="text-white/60 text-xs truncate">
              {rmIdentity?.rm_branch ?? ''}
            </p>
            {rmIdentity && (
              <p className="text-accent text-[10px] font-medium mt-0.5">
                {rmIdentity.client_count} clients
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Navigation ─────────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ label, path, Icon, badge }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/dashboard'} // exact match only for root dashboard
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-white/75 hover:bg-white/10 hover:text-white',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={clsx(
                    'w-4 h-4 shrink-0',
                    isActive ? 'text-primary' : 'text-white/75',
                  )}
                />
                <span className="flex-1">{label}</span>
                {badge !== undefined && badge > 0 && (
                  <span
                    className={clsx(
                      'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                      isActive
                        ? 'bg-danger text-white'
                        : 'bg-white/20 text-white',
                    )}
                  >
                    {badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Footer: app version ─────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-white/10">
        <p className="text-white/30 text-[10px]">RM Buddy v1.0 · Nuvama Wealth</p>
      </div>
    </aside>
  );
}
