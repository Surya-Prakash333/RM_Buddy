import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { MetricCard } from '@/components/widgets/MetricCard';
import { AlertCard } from '@/components/widgets/AlertCard';
import { MeetingList } from '@/components/widgets/MeetingList';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { useAuth } from '@/hooks/useAuth';
import api from '@/services/api';
import type { MetricCardData, AlertCardData, MeetingItem } from '@/types/widget.types';

// ── Types matching backend responses ────────────────────────────────────────

interface DashboardSummary {
  rm_id: string;
  kpis: {
    total_clients: number;
    active_alerts: number;
    meetings_today: number;
    revenue_ytd: string;
    aum_total: string;
    pipeline_value: string;
  };
  aum_change_mom_pct: number;
  revenue_change_mom_pct: number;
}

interface RawAlert {
  alert_id: string;
  alert_type: string;
  severity: string;
  client_id: string;
  client_name: string;
  body: string;
  created_at: string;
  status: string;
}

interface RawMeeting {
  id: string;
  time: string;
  client_id: string;
  client_name: string;
  agenda: string;
  location: string;
  duration_min: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function trendDir(pct: number): 'up' | 'down' | 'flat' {
  if (pct > 0) return 'up';
  if (pct < 0) return 'down';
  return 'flat';
}

function inferMeetingType(location: string): MeetingItem['meeting_type'] {
  const l = location.toLowerCase();
  if (l.includes('zoom') || l.includes('video') || l.includes('meet') || l.includes('teams')) return 'virtual';
  if (l.includes('phone') || l.includes('call')) return 'phone';
  return 'in_person';
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage(): JSX.Element {
  const { rmIdentity } = useAuth();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [alerts, setAlerts] = useState<RawAlert[]>([]);
  const [meetings, setMeetings] = useState<RawMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      try {
        const [sumRes, alertRes, meetRes] = await Promise.all([
          api.get<DashboardSummary>('/api/v1/dashboard/summary'),
          api.get<RawAlert[]>('/api/v1/alerts'),
          api.get<RawMeeting[]>('/api/v1/meetings'),
        ]);
        if (!cancelled) {
          setSummary(sumRes.data);
          setAlerts(Array.isArray(alertRes.data) ? alertRes.data : []);
          setMeetings(Array.isArray(meetRes.data) ? meetRes.data : []);
        }
      } catch {
        // silently keep loading=false — components show empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, []);

  // ── KPI cards ──────────────────────────────────────────────────────────────

  const kpiCards: Array<{ title: string; data: MetricCardData }> = summary
    ? [
        {
          title: 'Total Clients',
          data: {
            value: String(summary.kpis.total_clients),
            subtitle: 'under management',
            trend: 'flat',
            color: 'default',
          },
        },
        {
          title: 'AUM',
          data: {
            value: summary.kpis.aum_total,
            subtitle: 'total assets',
            trend: trendDir(summary.aum_change_mom_pct),
            trend_value: `${summary.aum_change_mom_pct > 0 ? '+' : ''}${summary.aum_change_mom_pct}% MoM`,
            color: summary.aum_change_mom_pct >= 0 ? 'success' : 'danger',
          },
        },
        {
          title: 'Revenue YTD',
          data: {
            value: summary.kpis.revenue_ytd,
            subtitle: 'year to date',
            trend: trendDir(summary.revenue_change_mom_pct),
            trend_value: `${summary.revenue_change_mom_pct > 0 ? '+' : ''}${summary.revenue_change_mom_pct}% MoM`,
            color: summary.revenue_change_mom_pct >= 0 ? 'success' : 'danger',
          },
        },
        {
          title: 'Active Alerts',
          data: {
            value: String(summary.kpis.active_alerts),
            subtitle: 'require attention',
            trend: summary.kpis.active_alerts > 3 ? 'up' : 'flat',
            color: summary.kpis.active_alerts > 5 ? 'danger' : summary.kpis.active_alerts > 2 ? 'warning' : 'default',
          },
        },
      ]
    : [];

  // ── Alert cards ────────────────────────────────────────────────────────────

  const alertCards: AlertCardData[] = alerts
    .filter((a) => a.status !== 'ACKNOWLEDGED' && a.status !== 'acknowledged')
    .slice(0, 5)
    .map((a) => ({
      alert_id: a.alert_id,
      alert_type: a.alert_type ?? 'ALERT',
      severity: (a.severity ?? 'MEDIUM') as AlertCardData['severity'],
      client_name: a.client_name,
      client_tier: 'Gold',
      message: a.body,
      created_at: a.created_at,
    }));

  // ── Meeting list ───────────────────────────────────────────────────────────

  const meetingItems: MeetingItem[] = meetings.map((m) => ({
    meeting_id: m.id,
    client_name: m.client_name,
    client_tier: 'Gold',
    time: m.time,
    duration_minutes: m.duration_min,
    meeting_type: inferMeetingType(m.location),
    agenda: m.agenda,
    status: 'scheduled',
  }));

  return (
    <DashboardLayout pendingAlertsCount={summary?.kpis.active_alerts ?? 0} chatPanel={<ChatWindow />}>
      <div className="space-y-6">

        {/* ── Greeting ──────────────────────────────────────────── */}
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

        {/* ── KPI cards ──────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Key Metrics
          </h2>
          {loading ? (
            <div className="grid grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <LoadingSkeleton key={i} variant="card" />)}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {kpiCards.map((card) => (
                <MetricCard key={card.title} title={card.title} data={card.data} />
              ))}
            </div>
          )}
        </section>

        {/* ── Alerts & Actions ──────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Alerts & Actions
          </h2>
          {loading ? (
            <LoadingSkeleton variant="table" rows={5} />
          ) : alertCards.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              No pending alerts
            </div>
          ) : (
            <div className="space-y-3">
              {alertCards.map((alert) => (
                <AlertCard
                  key={alert.alert_id}
                  title={alert.alert_type.replace(/_/g, ' ')}
                  data={alert}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Upcoming meetings ─────────────────────────────────── */}
        <section>
          {loading ? (
            <LoadingSkeleton variant="table" rows={3} />
          ) : (
            <MeetingList
              title="Upcoming Meetings"
              data={{ meetings: meetingItems }}
            />
          )}
        </section>

      </div>
    </DashboardLayout>
  );
}
