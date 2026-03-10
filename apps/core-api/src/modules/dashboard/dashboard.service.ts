import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Meeting as MeetingModel, MeetingDocument } from '../../database/models/meeting.model';
import { AlertRecord, AlertDocument } from '../../database/models/alert.model';
import { CacheService } from '../cache/cache.service';
import {
  DailyActivitySummary,
  DailyStatus,
  TeamAverageSummary,
  ActivityGaps,
  PeerRank,
} from './dto/daily-activity.dto';

// ---------------------------------------------------------------------------
// Shared value types used across mock data
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  status: 'success';
  data: T;
  timestamp: string;
}

export interface ClientSummary {
  id: string;
  name: string;
  tier: string;
  aum: string;
  last_interaction: string;
  phone: string;
  email: string;
}

export interface Holding {
  name: string;
  asset_class: string;
  value: string;
  weight_pct: number;
  gain_loss_pct: number;
}

export interface Portfolio {
  client_id: string;
  summary: {
    total_aum: string;
    cash_pct: number;
    by_asset_class: Record<string, string>;
  };
  holdings: Holding[];
}

export interface Alert {
  id: string;
  type: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  client_id: string;
  client_name: string;
  message: string;
  created_at: string;
  acknowledged: boolean;
}

export interface DailyAction {
  id: string;
  priority: number;
  action: string;
  client_id: string;
  client_name: string;
  reasoning: string;
  estimated_value: string;
  due_by: string;
}

export interface Meeting {
  id: string;
  time: string;
  client_id: string;
  client_name: string;
  agenda: string;
  location: string;
  duration_min: number;
}

export interface Lead {
  id: string;
  name: string;
  stage: 'HOT' | 'WARM' | 'COLD';
  potential_aum: string;
  source: string;
  last_contact: string;
}

export interface PipelineItem {
  id: string;
  client_name: string;
  product: string;
  stage: string;
  amount: string;
  probability_pct: number;
  expected_close: string;
}

export interface CrossSellOpportunity {
  id: string;
  client_id: string;
  client_name: string;
  product: string;
  rationale: string;
  potential_value: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Mock data constants — realistic Nuvama wealth management data
// ---------------------------------------------------------------------------

const MOCK_CLIENTS: ClientSummary[] = [
  {
    id: 'client-001',
    name: 'Rajesh Mehta',
    tier: 'ULTRA_HNI',
    aum: '₹42Cr',
    last_interaction: '2026-03-08T10:30:00Z',
    phone: '+91-98765-43210',
    email: 'rajesh.mehta@example.com',
  },
  {
    id: 'client-002',
    name: 'Sunita Patel',
    tier: 'HNI',
    aum: '₹18Cr',
    last_interaction: '2026-03-07T14:15:00Z',
    phone: '+91-98700-11223',
    email: 'sunita.patel@example.com',
  },
  {
    id: 'client-003',
    name: 'Vikram Bose',
    tier: 'HNI',
    aum: '₹28Cr',
    last_interaction: '2026-03-05T09:00:00Z',
    phone: '+91-98876-54321',
    email: 'vikram.bose@example.com',
  },
  {
    id: 'client-004',
    name: 'Anita Sharma',
    tier: 'AFFLUENT',
    aum: '₹6Cr',
    last_interaction: '2026-03-01T16:45:00Z',
    phone: '+91-97788-99001',
    email: 'anita.sharma@example.com',
  },
  {
    id: 'client-005',
    name: 'Deepak Nair',
    tier: 'AFFLUENT',
    aum: '₹9Cr',
    last_interaction: '2026-02-28T11:00:00Z',
    phone: '+91-96655-44332',
    email: 'deepak.nair@example.com',
  },
];

const MOCK_ALERTS: Alert[] = [
  {
    id: 'alert-001',
    type: 'IDLE_CASH',
    priority: 'HIGH',
    client_id: 'client-001',
    client_name: 'Rajesh Mehta',
    message: '₹3.2Cr sitting in savings account for 45 days. Consider liquid fund or FD ladder.',
    created_at: '2026-03-09T08:00:00Z',
    acknowledged: false,
  },
  {
    id: 'alert-002',
    type: 'BIRTHDAY',
    priority: 'MEDIUM',
    client_id: 'client-002',
    client_name: 'Sunita Patel',
    message: "Client's birthday tomorrow — March 11. Schedule a congratulatory call.",
    created_at: '2026-03-10T06:00:00Z',
    acknowledged: false,
  },
  {
    id: 'alert-003',
    type: 'MATURITY',
    priority: 'HIGH',
    client_id: 'client-003',
    client_name: 'Vikram Bose',
    message: '₹2Cr FD maturing on March 15. Reinvestment options must be presented this week.',
    created_at: '2026-03-08T10:00:00Z',
    acknowledged: false,
  },
  {
    id: 'alert-004',
    type: 'PORTFOLIO_DRIFT',
    priority: 'MEDIUM',
    client_id: 'client-004',
    client_name: 'Anita Sharma',
    message: 'Equity allocation at 78% vs target 65%. Rebalancing required.',
    created_at: '2026-03-07T12:00:00Z',
    acknowledged: false,
  },
  {
    id: 'alert-005',
    type: 'SIP_LAPSE',
    priority: 'LOW',
    client_id: 'client-005',
    client_name: 'Deepak Nair',
    message: 'SIP of ₹50,000/month in Axis Bluechip Fund missed last 2 months.',
    created_at: '2026-03-06T09:00:00Z',
    acknowledged: true,
  },
];

/** Redis TTL for the per-RM daily activity cache (15 minutes). */
const DAILY_ACTIVITY_TTL_SECONDS = 900;

/**
 * DashboardService provides all business logic for dashboard-related endpoints.
 *
 * Legacy mock methods are kept intact for other feature areas.
 * S1-F6-L1-Data and S1-F6-L2-Logic add real MongoDB queries for daily activity.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectModel(MeetingModel.name) private readonly meetingModel: Model<MeetingDocument>,
    @InjectModel(AlertRecord.name) private readonly alertModel: Model<AlertDocument>,
    private readonly cacheService: CacheService,
  ) {}

  // -------------------------------------------------------------------------
  // S1-F6-L1-Data: Daily Activity Summary
  // -------------------------------------------------------------------------

  /**
   * Fetch the daily activity summary for a single RM.
   *
   * Data is served from the Redis cache when available
   * (key: `daily:activity:{rmId}:{date}`, TTL 900 s).
   * On a cache miss it runs MongoDB queries and populates the cache.
   *
   * rm_interactions collection does not exist in the current scaffold,
   * so calls / tasks / proposals fall back to 0. Only meetings are queried
   * from the real `meetings` collection.
   */
  async getDailyActivitySummary(rmId: string, date: string): Promise<DailyActivitySummary> {
    const cacheKey = `daily:activity:${rmId}:${date}`;

    const cached = await this.cacheService.readThrough<DailyActivitySummary>(
      cacheKey,
      async () => {
        return this.fetchActivityFromDB(rmId, date);
      },
      DAILY_ACTIVITY_TTL_SECONDS,
    );

    if (cached) {
      return cached;
    }

    // Defensive: readThrough should never return null when fetchFn succeeds,
    // but guard here to satisfy strict TS.
    return this.fetchActivityFromDB(rmId, date);
  }

  /**
   * Execute the MongoDB queries for a single RM's daily activity.
   * No interaction collection exists yet — returns 0 for calls/tasks/proposals.
   */
  private async fetchActivityFromDB(rmId: string, date: string): Promise<DailyActivitySummary> {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const [meetings, activeAlerts] = await Promise.all([
      this.meetingModel
        .countDocuments({
          rm_id: rmId,
          scheduled_date: { $gte: dayStart, $lte: dayEnd },
        })
        .exec(),
      this.alertModel
        .countDocuments({
          rm_id: rmId,
          status: { $in: ['pending', 'NEW'] },
        })
        .exec(),
    ]);

    const summary: DailyActivitySummary = {
      rm_id: rmId,
      date,
      calls: 0,          // rm_interactions collection not yet in scaffold
      meetings,
      tasks_completed: 0, // rm_interactions collection not yet in scaffold
      proposals_sent: 0,  // rm_interactions collection not yet in scaffold
      active_alerts: activeAlerts,
      cached_at: new Date().toISOString(),
    };

    this.logger.debug(`fetchActivityFromDB rm=${rmId} date=${date} meetings=${meetings}`);
    return summary;
  }

  // -------------------------------------------------------------------------
  // S1-F6-L2-Logic: Team Average + Gap Analysis
  // -------------------------------------------------------------------------

  /**
   * Aggregate average daily activity for all RMs in the given branch on date.
   * Uses a single MongoDB aggregation pipeline — no N+1 queries.
   */
  async getTeamAverageSummary(branch: string, date: string): Promise<TeamAverageSummary> {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    // Aggregate meetings per RM in the branch for the date.
    // The meetings collection has rm_id but not branch; we use client_tier as
    // a branch proxy until an rm_branch field is added to the schema.
    // For now we query all RMs whose meeting records exist on this date
    // (branch filtering is future work — treat all as same branch for MVP).
    type MeetingAggRow = { rm_id: string; meetings: number };
    const rows = await this.meetingModel.aggregate<MeetingAggRow>([
      {
        $match: {
          scheduled_date: { $gte: dayStart, $lte: dayEnd },
        },
      },
      {
        $group: {
          _id: '$rm_id',
          meetings: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          rm_id: '$_id',
          meetings: 1,
        },
      },
    ]).exec();

    const sampleSize = rows.length;

    if (sampleSize === 0) {
      return {
        calls: 0,
        meetings: 0,
        tasks_completed: 0,
        proposals_sent: 0,
        sample_size: 0,
      };
    }

    const totalMeetings = rows.reduce((sum, r) => sum + r.meetings, 0);

    return {
      calls: 0,           // rm_interactions not yet in scaffold
      meetings: Math.round((totalMeetings / sampleSize) * 100) / 100,
      tasks_completed: 0, // rm_interactions not yet in scaffold
      proposals_sent: 0,  // rm_interactions not yet in scaffold
      sample_size: sampleSize,
    };
  }

  /**
   * Return the daily status with gap analysis vs. team average and peer rank.
   *
   * Peer rank is computed by counting how many RMs in the branch have
   * FEWER meetings/calls than this RM (rank 1 = best performer).
   */
  async getDailyStatusWithGapAnalysis(
    rmId: string,
    branch: string,
    date: string,
  ): Promise<DailyStatus> {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    // Run RM summary + team aggregation in parallel
    const [rmSummary, teamAvg] = await Promise.all([
      this.getDailyActivitySummary(rmId, date),
      this.getTeamAverageSummary(branch, date),
    ]);

    const gaps: ActivityGaps = {
      calls: rmSummary.calls - teamAvg.calls,
      meetings: rmSummary.meetings - teamAvg.meetings,
      tasks_completed: rmSummary.tasks_completed - teamAvg.tasks_completed,
      proposals_sent: rmSummary.proposals_sent - teamAvg.proposals_sent,
    };

    // Peer rank: count RMs with fewer meetings than this RM (for meetings rank)
    type PeerRow = { rm_id: string; meetings: number };
    const peerRows = await this.meetingModel.aggregate<PeerRow>([
      {
        $match: {
          scheduled_date: { $gte: dayStart, $lte: dayEnd },
        },
      },
      {
        $group: {
          _id: '$rm_id',
          meetings: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          rm_id: '$_id',
          meetings: 1,
        },
      },
    ]).exec();

    const rmMeetings = rmSummary.meetings;
    const rmTotal = rmSummary.calls + rmSummary.meetings + rmSummary.tasks_completed + rmSummary.proposals_sent;

    // Rank = number of peers with strictly fewer + 1
    const meetingsRank =
      peerRows.filter((r) => r.rm_id !== rmId && r.meetings < rmMeetings).length + 1;

    const overallRank =
      peerRows.filter((r) => {
        if (r.rm_id === rmId) return false;
        const peerTotal = r.meetings; // only meetings available without rm_interactions
        return peerTotal < rmTotal;
      }).length + 1;

    const peerRank: PeerRank = {
      calls: 1,          // No call data — RM trivially ranks 1st
      meetings: meetingsRank,
      overall: overallRank,
    };

    return {
      rm_summary: rmSummary,
      team_avg: teamAvg,
      gaps,
      peer_rank: peerRank,
    };
  }
  // -------------------------------------------------------------------------
  // Summary / KPIs
  // -------------------------------------------------------------------------

  getSummary(rmId: string): Record<string, unknown> {
    return {
      rm_id: rmId,
      kpis: {
        total_clients: 20,
        active_alerts: 5,
        meetings_today: 3,
        revenue_ytd: '₹4.2Cr',
        aum_total: '₹125Cr',
        pipeline_value: '₹18Cr',
      },
      aum_change_mom_pct: 2.4,
      revenue_change_mom_pct: 8.1,
      top_alert_type: 'IDLE_CASH',
    };
  }

  // -------------------------------------------------------------------------
  // Clients
  // -------------------------------------------------------------------------

  getClients(_rmId: string): ClientSummary[] {
    return MOCK_CLIENTS;
  }

  getClient(_rmId: string, clientId: string): ClientSummary & Record<string, unknown> {
    const client = MOCK_CLIENTS.find((c) => c.id === clientId) ?? MOCK_CLIENTS[0];
    return {
      ...client,
      date_of_birth: '1968-04-15',
      pan: 'ABCDE1234F',
      risk_profile: 'MODERATE_AGGRESSIVE',
      relationship_since: '2018-06-01',
      relationship_manager: 'Arjun Shah',
      nominee: 'Priya Mehta',
      kyc_status: 'VERIFIED',
    };
  }

  // -------------------------------------------------------------------------
  // Portfolio
  // -------------------------------------------------------------------------

  getPortfolio(_rmId: string, clientId: string): Portfolio {
    return {
      client_id: clientId,
      summary: {
        total_aum: '₹42Cr',
        cash_pct: 8,
        by_asset_class: {
          EQUITY: '₹22Cr',
          DEBT: '₹12Cr',
          MF: '₹5Cr',
          GOLD: '₹1.5Cr',
          REAL_ESTATE: '₹1.5Cr',
        },
      },
      holdings: [
        {
          name: 'Reliance Industries Ltd',
          asset_class: 'EQUITY',
          value: '₹8.4Cr',
          weight_pct: 20,
          gain_loss_pct: 34.2,
        },
        {
          name: 'HDFC Bank Ltd',
          asset_class: 'EQUITY',
          value: '₹6.3Cr',
          weight_pct: 15,
          gain_loss_pct: 12.8,
        },
        {
          name: 'Nuvama Debt PMS',
          asset_class: 'DEBT',
          value: '₹7Cr',
          weight_pct: 16.7,
          gain_loss_pct: 9.1,
        },
        {
          name: 'Axis Bluechip Fund',
          asset_class: 'MF',
          value: '₹3.2Cr',
          weight_pct: 7.6,
          gain_loss_pct: 18.5,
        },
        {
          name: 'Sovereign Gold Bond 2024',
          asset_class: 'GOLD',
          value: '₹1.5Cr',
          weight_pct: 3.6,
          gain_loss_pct: 22.0,
        },
        {
          name: 'ICICI Pru Corporate Bond',
          asset_class: 'DEBT',
          value: '₹5Cr',
          weight_pct: 11.9,
          gain_loss_pct: 7.6,
        },
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Alerts
  // -------------------------------------------------------------------------

  getAlerts(_rmId: string): Alert[] {
    return MOCK_ALERTS;
  }

  acknowledgeAlert(_rmId: string, alertId: string): { alert_id: string; acknowledged: boolean; acknowledged_at: string } {
    return {
      alert_id: alertId,
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Daily Briefing
  // -------------------------------------------------------------------------

  getBriefing(rmId: string): Record<string, unknown> {
    return {
      rm_id: rmId,
      date: new Date().toISOString().slice(0, 10),
      alerts_summary: {
        total: 5,
        high_priority: 2,
        top_alert: MOCK_ALERTS[0],
      },
      meetings: this.getMeetings(rmId),
      daily_actions: this.getDailyActions(rmId),
      revenue_summary: {
        mtd: '₹38L',
        ytd: '₹4.2Cr',
        target_ytd: '₹6Cr',
        achievement_pct: 70,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Daily Actions
  // -------------------------------------------------------------------------

  getDailyActions(_rmId: string): DailyAction[] {
    return [
      {
        id: 'action-001',
        priority: 1,
        action: 'Call Rajesh Mehta — present liquid fund options for ₹3.2Cr idle cash',
        client_id: 'client-001',
        client_name: 'Rajesh Mehta',
        reasoning: 'Idle cash alert (45 days). Opportunity to earn 7% annualized vs 3.5% in savings.',
        estimated_value: '₹11.2L incremental revenue',
        due_by: '2026-03-10T18:00:00Z',
      },
      {
        id: 'action-002',
        priority: 2,
        action: 'Send FD reinvestment proposal to Vikram Bose before EOD',
        client_id: 'client-003',
        client_name: 'Vikram Bose',
        reasoning: '₹2Cr FD matures March 15. Competitor outreach likely. Act now.',
        estimated_value: '₹6L revenue retention',
        due_by: '2026-03-10T17:00:00Z',
      },
      {
        id: 'action-003',
        priority: 3,
        action: 'Wish Sunita Patel happy birthday and schedule review call',
        client_id: 'client-002',
        client_name: 'Sunita Patel',
        reasoning: 'Birthday tomorrow. Last portfolio review was 4 months ago. Opportunity for AUM growth.',
        estimated_value: 'Relationship — potential ₹5Cr AUM expansion',
        due_by: '2026-03-10T12:00:00Z',
      },
      {
        id: 'action-004',
        priority: 4,
        action: 'Share rebalancing note to Anita Sharma — equity exposure at 78%',
        client_id: 'client-004',
        client_name: 'Anita Sharma',
        reasoning: 'Portfolio drifted 13pp above target equity. Market volatility risk is elevated.',
        estimated_value: 'Risk mitigation + advisory fee',
        due_by: '2026-03-11T10:00:00Z',
      },
      {
        id: 'action-005',
        priority: 5,
        action: 'Follow up Deepak Nair on lapsed SIP — two missed instalments',
        client_id: 'client-005',
        client_name: 'Deepak Nair',
        reasoning: 'SIP lapse breaks rupee cost averaging benefit. Quick resolve maintains trail.',
        estimated_value: '₹50K/month SIP continuity',
        due_by: '2026-03-12T10:00:00Z',
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Meetings
  // -------------------------------------------------------------------------

  getMeetings(_rmId: string): Record<string, unknown>[] {
    return [
      {
        id: 'mtg-001',
        time: '10:00',
        client_id: 'client-001',
        client_name: 'Rajesh Mehta',
        agenda: 'Annual portfolio review and idle cash deployment plan',
        location: 'Nuvama Office — BKC Mumbai, Conf Room 3A',
        duration_min: 60,
      },
      {
        id: 'mtg-002',
        time: '14:30',
        client_id: 'client-003',
        client_name: 'Vikram Bose',
        agenda: 'FD maturity reinvestment — present 3 options',
        location: 'Video Call (Zoom)',
        duration_min: 45,
      },
      {
        id: 'mtg-003',
        time: '17:00',
        client_id: 'client-002',
        client_name: 'Sunita Patel',
        agenda: 'Birthday call + NPS account opening discussion',
        location: 'Phone',
        duration_min: 20,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Leads
  // -------------------------------------------------------------------------

  getLeads(_rmId: string): Lead[] {
    return [
      {
        id: 'lead-001',
        name: 'Karan Oberoi',
        stage: 'HOT',
        potential_aum: '₹15Cr',
        source: 'Referral — Rajesh Mehta',
        last_contact: '2026-03-09T14:00:00Z',
      },
      {
        id: 'lead-002',
        name: 'Meera Iyer',
        stage: 'HOT',
        potential_aum: '₹8Cr',
        source: 'LinkedIn',
        last_contact: '2026-03-07T11:30:00Z',
      },
      {
        id: 'lead-003',
        name: 'Arjun Singhania',
        stage: 'WARM',
        potential_aum: '₹25Cr',
        source: 'Nuvama Wealth Event — Feb 2026',
        last_contact: '2026-02-28T15:00:00Z',
      },
      {
        id: 'lead-004',
        name: 'Priti Doshi',
        stage: 'WARM',
        potential_aum: '₹5Cr',
        source: 'Branch Walk-in',
        last_contact: '2026-02-20T10:00:00Z',
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Pipeline
  // -------------------------------------------------------------------------

  getPipeline(_rmId: string): PipelineItem[] {
    return [
      {
        id: 'pipe-001',
        client_name: 'Karan Oberoi',
        product: 'PMS — Nuvama Equity Growth',
        stage: 'PROPOSAL_SENT',
        amount: '₹10Cr',
        probability_pct: 75,
        expected_close: '2026-03-31',
      },
      {
        id: 'pipe-002',
        client_name: 'Meera Iyer',
        product: 'AIF Cat III — Quant Fund',
        stage: 'NEGOTIATION',
        amount: '₹5Cr',
        probability_pct: 60,
        expected_close: '2026-04-15',
      },
      {
        id: 'pipe-003',
        client_name: 'Arjun Singhania',
        product: 'Discretionary PMS',
        stage: 'INTEREST_SHOWN',
        amount: '₹15Cr',
        probability_pct: 40,
        expected_close: '2026-05-30',
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Cross-sell
  // -------------------------------------------------------------------------

  getCrossSell(_rmId: string): CrossSellOpportunity[] {
    return [
      {
        id: 'cs-001',
        client_id: 'client-001',
        client_name: 'Rajesh Mehta',
        product: 'Term Insurance — ₹5Cr cover',
        rationale: 'High net worth, no term insurance on record. Dependent family. Tax benefit u/s 80C.',
        potential_value: '₹1.2L first-year premium',
        score: 92,
      },
      {
        id: 'cs-002',
        client_id: 'client-002',
        client_name: 'Sunita Patel',
        product: 'NPS Corporate Account',
        rationale: 'Approaching retirement age (57). NPS gives additional ₹50K deduction u/s 80CCD(1B).',
        potential_value: '₹5L annual contribution',
        score: 87,
      },
      {
        id: 'cs-003',
        client_id: 'client-003',
        client_name: 'Vikram Bose',
        product: 'Sovereign Gold Bond Tranche',
        rationale: 'Existing portfolio underweight gold (< 3%). New SGB tranche opens March 20.',
        potential_value: '₹75L investment',
        score: 78,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // QA — AI Query
  // -------------------------------------------------------------------------

  queryQA(_rmId: string, query: string): Record<string, unknown> {
    return {
      query,
      answer:
        `Based on current portfolio data and market conditions, here is a concise response to your query: "${query}". ` +
        'Our AI analysis indicates that the recommended action aligns with the client\'s risk profile (MODERATE_AGGRESSIVE) ' +
        'and long-term wealth creation goals. Detailed supporting data and relevant client segments will be surfaced once ' +
        'the agent orchestrator is fully integrated in a subsequent story.',
      sources: [
        { type: 'PORTFOLIO_DATA', client_count: 5 },
        { type: 'MARKET_DATA', as_of: new Date().toISOString().slice(0, 10) },
      ],
      confidence: 0.82,
      generated_at: new Date().toISOString(),
    };
  }
}
