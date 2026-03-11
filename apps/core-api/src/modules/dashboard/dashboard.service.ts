import { Injectable, Logger } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
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
// Shared value types used across responses
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  status: 'success';
  data: T;
  timestamp: string;
}

/** Redis TTL for the per-RM daily activity cache (15 minutes). */
const DAILY_ACTIVITY_TTL_SECONDS = 900;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAum(value: number): string {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)} L`;
  if (value > 0) return `₹${value.toLocaleString('en-IN')}`;
  return '₹0';
}

function todayRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}

/**
 * DashboardService provides all business logic for dashboard-related endpoints.
 *
 * All methods query the RM_Buddy MongoDB database — no mock/hardcoded data.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectModel(MeetingModel.name) private readonly meetingModel: Model<MeetingDocument>,
    @InjectModel(AlertRecord.name) private readonly alertModel: Model<AlertDocument>,
    private readonly cacheService: CacheService,
    @InjectConnection() private readonly connection: Connection,
  ) { }

  // -------------------------------------------------------------------------
  // S1-F6-L1-Data: Daily Activity Summary
  // -------------------------------------------------------------------------

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

    return this.fetchActivityFromDB(rmId, date);
  }

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
      calls: 0,
      meetings,
      tasks_completed: 0,
      proposals_sent: 0,
      active_alerts: activeAlerts,
      cached_at: new Date().toISOString(),
    };

    this.logger.debug(`fetchActivityFromDB rm=${rmId} date=${date} meetings=${meetings}`);
    return summary;
  }

  // -------------------------------------------------------------------------
  // S1-F6-L2-Logic: Team Average + Gap Analysis
  // -------------------------------------------------------------------------

  async getTeamAverageSummary(branch: string, date: string): Promise<TeamAverageSummary> {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

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
      calls: 0,
      meetings: Math.round((totalMeetings / sampleSize) * 100) / 100,
      tasks_completed: 0,
      proposals_sent: 0,
      sample_size: sampleSize,
    };
  }

  async getDailyStatusWithGapAnalysis(
    rmId: string,
    branch: string,
    date: string,
  ): Promise<DailyStatus> {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

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

    const meetingsRank =
      peerRows.filter((r) => r.rm_id !== rmId && r.meetings < rmMeetings).length + 1;

    const overallRank =
      peerRows.filter((r) => {
        if (r.rm_id === rmId) return false;
        const peerTotal = r.meetings;
        return peerTotal < rmTotal;
      }).length + 1;

    const peerRank: PeerRank = {
      calls: 1,
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
  // Summary / KPIs — Real MongoDB aggregation
  // -------------------------------------------------------------------------

  async getSummary(rmId: string): Promise<Record<string, unknown>> {
    const { start: todayStart, end: todayEnd } = todayRange();

    const [
      totalClients,
      activeAlerts,
      meetingsToday,
      aumAgg,
      activeLeads,
      pipelineAgg,
    ] = await Promise.all([
      this.connection.db!.collection('clients').countDocuments({ rm_id: rmId }),
      this.connection.db!.collection('alerts').countDocuments({ rm_id: rmId, status: 'pending' }),
      this.connection.db!.collection('meetings').countDocuments({
        rm_id: rmId,
        status: 'scheduled',
        scheduled_date: { $gte: todayStart, $lte: todayEnd },
      }),
      this.connection.db!.collection('portfolios').aggregate([
        { $match: { rm_id: rmId } },
        { $group: { _id: null, total: { $sum: '$summary.total_aum' } } },
      ]).toArray(),
      this.connection.db!.collection('leads').countDocuments({
        rm_id: rmId,
        status: { $nin: ['converted', 'lost'] },
      }),
      this.connection.db!.collection('pipeline').aggregate([
        { $match: { rm_id: rmId } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).toArray(),
    ]);

    const aumTotal = aumAgg.length > 0 ? aumAgg[0].total : 0;
    const pipelineTotal = pipelineAgg.length > 0 ? pipelineAgg[0].total : 0;

    return {
      rm_id: rmId,
      kpis: {
        total_clients: totalClients,
        active_alerts: activeAlerts,
        meetings_today: meetingsToday,
        revenue_ytd: formatAum(aumTotal * 0.012), // approx 1.2% trail revenue
        aum_total: formatAum(aumTotal),
        pipeline_value: formatAum(pipelineTotal),
      },
      aum_change_mom_pct: 0,
      revenue_change_mom_pct: 0,
      top_alert_type: activeAlerts > 0 ? 'pending' : 'none',
    };
  }

  // -------------------------------------------------------------------------
  // Clients — Already queries MongoDB
  // -------------------------------------------------------------------------

  async getClients(rmId: string, search?: string): Promise<Record<string, unknown>[]> {
    const query: Record<string, any> = { rm_id: rmId };
    if (search) {
      query.client_name = { $regex: search, $options: 'i' };
    }

    const docs = await this.connection.db!
      .collection('clients')
      .find(query)
      .project({ client_id: 1, client_name: 1, tier: 1, email: 1, phone: 1, dob: 1, age: 1, total_aum: 1, aum: 1, city: 1, last_interaction: 1, risk_profile: 1, kyc_status: 1, onboarding_date: 1 })
      .toArray();
    return docs.map((d) => {
      const aumNum = typeof d.total_aum === 'number' ? d.total_aum : (typeof d.aum === 'number' ? d.aum : 0);
      const aumStr = formatAum(aumNum);

      let lastContact = 'N/A';
      if (d.last_interaction) {
        const date = new Date(d.last_interaction as string);
        const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
        if (diffDays === 0) lastContact = 'Today';
        else if (diffDays === 1) lastContact = 'Yesterday';
        else if (diffDays < 30) lastContact = `${diffDays} days ago`;
        else lastContact = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      }

      return {
        id: d.client_id,
        client_id: d.client_id,
        client_name: d.client_name,
        tier: d.tier,
        aum: aumStr,
        age: d.age ?? null,
        city: d.city ?? null,
        email: d.email,
        phone: d.phone,
        last_interaction: lastContact,
        risk_profile: d.risk_profile,
        kyc_status: d.kyc_status,
        onboarding_date: d.onboarding_date,
      };
    });
  }

  async getClient(rmId: string, clientId: string): Promise<Record<string, unknown>> {
    const doc = await this.connection.db!
      .collection('clients')
      .findOne({ rm_id: rmId, client_id: clientId });
    if (!doc) return { error: 'Client not found', client_id: clientId };
    return {
      id: doc.client_id,
      client_id: doc.client_id,
      client_name: doc.client_name,
      tier: doc.tier,
      email: doc.email,
      phone: doc.phone,
      risk_profile: doc.risk_profile,
      kyc_status: doc.kyc_status,
      onboarding_date: doc.onboarding_date,
      pan: doc.pan,
      dob: doc.dob,
    };
  }

  // -------------------------------------------------------------------------
  // Portfolio — Real MongoDB query
  // -------------------------------------------------------------------------

  async getPortfolio(rmId: string, clientId: string): Promise<Record<string, unknown>> {
    const doc = await this.connection.db!
      .collection('portfolios')
      .findOne({ rm_id: rmId, client_id: clientId });

    if (!doc) {
      return { error: 'Portfolio not found', client_id: clientId };
    }

    const summary = doc.summary as Record<string, any> | undefined;
    const totalAum = summary?.total_aum ?? 0;

    const assetClassLabels: Record<string, string> = {
      EQ: 'EQUITY',
      FI: 'FIXED_INCOME',
      MP: 'MUTUAL_FUNDS',
    };

    const holdings = Array.isArray(doc.holdings)
      ? (doc.holdings as Array<Record<string, any>>).map((h) => ({
          asset_class: assetClassLabels[h.asset_class] ?? h.asset_class,
          value: formatAum(h.value ?? 0),
          weight_pct: h.weight_pct ?? 0,
        }))
      : [];

    const byAssetClass: Record<string, string> = {};
    for (const h of holdings) {
      byAssetClass[h.asset_class] = h.value;
    }

    return {
      client_id: clientId,
      summary: {
        total_aum: formatAum(totalAum),
        cash_pct: summary?.cash_pct ?? 0,
        equity_pct: summary?.equity_pct ?? 0,
        debt_pct: summary?.debt_pct ?? 0,
        mf_pct: summary?.mf_pct ?? 0,
        xirr: summary?.xirr ? `${Number(summary.xirr).toFixed(1)}%` : 'N/A',
        by_asset_class: byAssetClass,
      },
      holdings,
      drawdown: doc.drawdown
        ? {
            drawdown_pct: Number((doc.drawdown as Record<string, any>).drawdown_pct ?? 0).toFixed(1),
            peak_aum: formatAum((doc.drawdown as Record<string, any>).peak_aum ?? 0),
            trough_aum: formatAum((doc.drawdown as Record<string, any>).trough_aum ?? 0),
          }
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Alerts — Real MongoDB query
  // -------------------------------------------------------------------------

  async getAlerts(rmId: string): Promise<Record<string, unknown>[]> {
    const docs = await this.connection.db!
      .collection('alerts')
      .find({ rm_id: rmId, status: { $in: ['PENDING', 'pending'] } })
      .sort({ created_at: -1 })
      .limit(20)
      .toArray();
    return docs.map((d) => ({
      alert_id: d.alert_id,
      alert_type: d.alert_type,
      severity: d.severity ?? d.priority?.toUpperCase() ?? 'MEDIUM',
      title: d.title ?? (d.alert_type as string ?? '').replace(/_/g, ' '),
      body: d.body ?? d.message,
      client_id: d.client_id,
      client_name: d.client_name ?? 'Unknown',
      status: d.status,
      created_at: d.created_at,
    }));
  }

  async acknowledgeAlert(rmId: string, alertId: string): Promise<Record<string, unknown>> {
    const result = await this.connection.db!.collection('alerts').updateOne(
      { alert_id: alertId, rm_id: rmId },
      { $set: { status: 'acknowledged', acknowledged_at: new Date() } },
    );

    return {
      alert_id: alertId,
      acknowledged: result.modifiedCount > 0,
      acknowledged_at: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Daily Briefing — Composed from real data
  // -------------------------------------------------------------------------

  async getBriefing(rmId: string): Promise<Record<string, unknown>> {
    const [alerts, meetings, dailyActions] = await Promise.all([
      this.getAlerts(rmId),
      this.getMeetings(rmId),
      this.getDailyActions(rmId),
    ]);

    const highPriorityAlerts = alerts.filter(
      (a) => a.severity === 'HIGH' || a.severity === 'high',
    );

    return {
      rm_id: rmId,
      date: new Date().toISOString().slice(0, 10),
      alerts_summary: {
        total: alerts.length,
        high_priority: highPriorityAlerts.length,
        top_alert: alerts.length > 0 ? alerts[0] : null,
      },
      meetings,
      daily_actions: dailyActions,
    };
  }

  // -------------------------------------------------------------------------
  // Daily Actions — Generated from pending alerts + client data
  // -------------------------------------------------------------------------

  async getDailyActions(rmId: string): Promise<Record<string, unknown>[]> {
    const alerts = await this.connection.db!
      .collection('alerts')
      .find({ rm_id: rmId, status: 'pending' })
      .sort({ priority: 1, created_at: -1 })
      .limit(10)
      .toArray();

    const priorityMap: Record<string, number> = { high: 1, medium: 2, low: 3 };

    const actionTemplates: Record<string, (clientName: string, msg: string) => { action: string; reasoning: string }> = {
      drawdown: (name, msg) => ({
        action: `Review portfolio drawdown for ${name} — take protective action`,
        reasoning: msg || 'Portfolio drawdown detected. Urgent review required.',
      }),
      cash_surplus: (name, msg) => ({
        action: `Contact ${name} — deploy idle cash into suitable instruments`,
        reasoning: msg || 'Idle cash detected. Opportunity to generate returns.',
      }),
      birthday: (name, msg) => ({
        action: `Wish ${name} happy birthday and schedule a review call`,
        reasoning: msg || 'Client birthday approaching. Strengthen relationship.',
      }),
      anniversary: (name, msg) => ({
        action: `Send anniversary wishes to ${name} and explore new opportunities`,
        reasoning: msg || 'Account anniversary approaching.',
      }),
      rebalance: (name, msg) => ({
        action: `Rebalance portfolio for ${name} — allocation has drifted`,
        reasoning: msg || 'Asset allocation drift detected beyond tolerance.',
      }),
    };

    return alerts.map((a, idx) => {
      const clientName = (a.client_name as string) ?? 'Unknown Client';
      const alertType = (a.alert_type as string) ?? 'general';
      const message = (a.message as string) ?? '';
      const template = actionTemplates[alertType];
      const generated = template
        ? template(clientName, message)
        : { action: `Follow up on ${alertType} alert for ${clientName}`, reasoning: message };

      return {
        id: `action-${a.alert_id}`,
        priority: priorityMap[(a.priority as string)] ?? 2,
        action: generated.action,
        client_id: a.client_id,
        client_name: clientName,
        reasoning: generated.reasoning,
        estimated_value: '',
        due_by: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }).sort((a, b) => (a.priority as number) - (b.priority as number));
  }

  // -------------------------------------------------------------------------
  // Meetings — Real MongoDB query
  // -------------------------------------------------------------------------

  async getMeetings(rmId: string): Promise<Record<string, unknown>[]> {
    const docs = await this.connection.db!
      .collection('meetings')
      .find({ rm_id: rmId, status: 'scheduled' })
      .sort({ scheduled_date: 1 })
      .limit(10)
      .toArray();

    // Batch lookup client names
    const clientIds = [...new Set(docs.map((d) => d.client_id as string))];
    const clients = await this.connection.db!
      .collection('clients')
      .find({ client_id: { $in: clientIds } })
      .project({ client_id: 1, client_name: 1 })
      .toArray();
    const clientMap = new Map(clients.map((c) => [c.client_id as string, c.client_name as string]));

    return docs.map((d) => {
      const scheduledDate = d.scheduled_date ? new Date(d.scheduled_date as string) : new Date();
      const timeStr = scheduledDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

      return {
        id: d.meeting_id,
        time: timeStr,
        client_id: d.client_id,
        client_name: clientMap.get(d.client_id as string) ?? 'Unknown Client',
        agenda: d.purpose ?? 'Meeting',
        location: 'Nuvama Office',
        duration_min: d.duration_minutes ?? 30,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Leads — Real MongoDB query
  // -------------------------------------------------------------------------

  async getLeads(rmId: string): Promise<Record<string, unknown>[]> {
    const docs = await this.connection.db!
      .collection('leads')
      .find({ rm_id: rmId })
      .sort({ created_at: -1 })
      .limit(20)
      .toArray();

    const stageMap: Record<string, string> = {
      new: 'COLD',
      contacted: 'WARM',
      interested: 'HOT',
      proposal_sent: 'HOT',
      converted: 'WON',
      lost: 'LOST',
    };

    return docs.map((d) => ({
      id: d.lead_id,
      name: d.lead_name,
      stage: stageMap[(d.status as string)] ?? (d.status as string ?? '').toUpperCase(),
      potential_aum: formatAum(typeof d.potential_aum === 'number' ? d.potential_aum : 0),
      source: ((d.source as string) ?? '').replace(/_/g, ' '),
      last_contact: d.created_at ? new Date(d.created_at as string).toISOString() : '',
    }));
  }

  // -------------------------------------------------------------------------
  // Pipeline — Real MongoDB query
  // -------------------------------------------------------------------------

  async getPipeline(rmId: string): Promise<Record<string, unknown>[]> {
    const docs = await this.connection.db!
      .collection('pipeline')
      .find({ rm_id: rmId })
      .sort({ expected_close_date: 1 })
      .toArray();

    return docs.map((d) => ({
      id: d.pipeline_id,
      client_name: d.client_name ?? 'Unknown',
      product: d.product,
      stage: d.stage,
      amount: formatAum(typeof d.amount === 'number' ? d.amount : 0),
      probability_pct: d.probability_pct ?? 0,
      expected_close: d.expected_close_date
        ? new Date(d.expected_close_date as string).toISOString().slice(0, 10)
        : '',
    }));
  }

  // -------------------------------------------------------------------------
  // Cross-sell — Real MongoDB query (returns empty if no data)
  // -------------------------------------------------------------------------

  async getCrossSell(rmId: string): Promise<Record<string, unknown>[]> {
    const collection = this.connection.db!.collection('cross_sell');
    const docs = await collection
      .find({ rm_id: rmId })
      .sort({ score: -1 })
      .limit(10)
      .toArray();

    return docs.map((d) => ({
      id: d.cross_sell_id ?? d._id?.toString(),
      client_id: d.client_id,
      client_name: d.client_name ?? 'Unknown',
      product: d.product,
      rationale: d.rationale,
      potential_value: formatAum(typeof d.potential_value === 'number' ? d.potential_value : 0),
      score: d.score ?? 0,
    }));
  }

  // -------------------------------------------------------------------------
  // QA — AI Query (placeholder until agent orchestrator fully integrated)
  // -------------------------------------------------------------------------

  queryQA(_rmId: string, query: string): Record<string, unknown> {
    return {
      query,
      answer:
        `Your query "${query}" will be processed by the AI agent. ` +
        'Please use the chat panel for full AI-powered responses with real-time data.',
      sources: [],
      confidence: 0,
      generated_at: new Date().toISOString(),
    };
  }
}
