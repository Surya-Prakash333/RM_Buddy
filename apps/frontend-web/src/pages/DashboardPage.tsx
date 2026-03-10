import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { useAuth } from '@/hooks/useAuth';

/**
 * Root dashboard page — renders the three-column DashboardLayout with a
 * morning briefing placeholder.  Widget-rich content will be added when the
 * agent orchestrator integration is wired up in INFRA-FE-02.
 */
export default function DashboardPage(): JSX.Element {
  const { rmIdentity } = useAuth();

  return (
    <DashboardLayout pendingAlertsCount={0}>
      <div className="space-y-6">
        {/* ── Morning briefing header ───────────────────────── */}
        <div>
          <h1 className="text-xl font-semibold text-gray-800">
            Good{getGreeting()},{' '}
            <span className="text-primary">
              {rmIdentity?.rm_name.split(' ')[0] ?? 'RM'}
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Here is your briefing for today. Your AI assistant is ready.
          </p>
        </div>

        {/* ── KPI cards row (placeholder skeletons) ─────────── */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Key Metrics
          </h2>
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <LoadingSkeleton key={i} variant="card" />
            ))}
          </div>
        </section>

        {/* ── Alerts & Actions (placeholder) ────────────────── */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Alerts & Actions
          </h2>
          <LoadingSkeleton variant="table" rows={5} />
        </section>

        {/* ── Upcoming meetings (placeholder) ───────────────── */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Upcoming Meetings
          </h2>
          <LoadingSkeleton variant="table" rows={3} />
        </section>

        {/* Dev note */}
        {import.meta.env.DEV && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
            <strong>Dev note:</strong> Dashboard widgets will be populated by the
            agent orchestrator in INFRA-FE-02. The skeletons above are intentional
            placeholders.
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
