/**
 * PerformanceService — S1-F33-L1-Data & S1-F33-L2-Logic
 *
 * Provides:
 *   getPerformanceMetrics(rmId, period)  — T1 RM metrics, cached 1 h
 *   getPeerMetrics(branch, period)       — All-RM branch metrics, cached 1 h
 *   identifyStrengths(rmId, branch, period) — Top-3 strengths + bottom-2 growth areas
 *
 * Data sources (all via single aggregation pipeline per collection):
 *   clients      → count by tier, total_aum, new clients, retention
 *   meetings     → total meetings, calls, client visits
 *   transactions → gross_sales, revenue_generated
 *   portfolios   → avg_portfolio_return, products_per_client
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client, ClientDocument } from '../../database/models/client.model';
import { Meeting, MeetingDocument } from '../../database/models/meeting.model';
import { Transaction, TransactionDocument } from '../../database/models/transaction.model';
import { Portfolio, PortfolioDocument } from '../../database/models/portfolio.model';
import { CacheService } from '../cache/cache.service';
import {
  RMPerformanceMetrics,
  StrengthReport,
  StrengthItem,
  StrengthDimensionsMap,
  KeyMetric,
} from './dto/performance.dto';

// ---------------------------------------------------------------------------
// Strength dimension configuration (configurable weights)
// ---------------------------------------------------------------------------

export const STRENGTH_DIMENSIONS: StrengthDimensionsMap = {
  client_relationships: {
    label: 'Client Relationships',
    metrics: ['total_meetings', 'client_retention_rate'],
    weight: 1.0,
  },
  business_development: {
    label: 'Business Development',
    metrics: ['gross_sales', 'new_clients_added'],
    weight: 1.2,
  },
  portfolio_performance: {
    label: 'Portfolio Performance',
    metrics: ['avg_portfolio_return', 'aum_growth_pct'],
    weight: 1.0,
  },
  product_diversification: {
    label: 'Product Diversification',
    metrics: ['products_per_client'],
    weight: 0.8,
  },
  revenue_generation: {
    label: 'Revenue Generation',
    metrics: ['revenue_generated'],
    weight: 1.1,
  },
};

const METRICS_CACHE_TTL = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Internal aggregation result types
// ---------------------------------------------------------------------------

interface ClientAggResult {
  total_clients: number;
  diamond_clients: number;
  platinum_clients: number;
  new_clients_added: number;
  clients_with_recent_interaction: number;
  total_aum: number;
  aum_start: number; // approximated as 0 when unavailable
}

interface MeetingAggResult {
  total_meetings: number;
  total_calls: number;
  client_visits: number;
}

interface TransactionAggResult {
  gross_sales: number;
  revenue_generated: number;
}

interface PortfolioAggResult {
  avg_portfolio_return: number;
  products_per_client: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);

  constructor(
    @InjectModel(Client.name) private readonly clientModel: Model<ClientDocument>,
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(Portfolio.name) private readonly portfolioModel: Model<PortfolioDocument>,
    private readonly cacheService: CacheService,
  ) {}

  // -------------------------------------------------------------------------
  // S1-F33-L1-Data: Data Layer
  // -------------------------------------------------------------------------

  /**
   * Get all T1 RM performance metrics for a given period.
   * Redis cache key: perf:metrics:{rmId}:{period} — TTL 3600 s
   */
  async getPerformanceMetrics(rmId: string, period: string): Promise<RMPerformanceMetrics> {
    const cacheKey = `perf:metrics:${rmId}:${period}`;
    const cached = await this.cacheService.get<RMPerformanceMetrics>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT perf metrics rm=${rmId} period=${period}`);
      return cached;
    }

    const metrics = await this.fetchMetricsFromDb(rmId, period);
    await this.cacheService.set(cacheKey, metrics, METRICS_CACHE_TTL);
    return metrics;
  }

  /**
   * Get performance metrics for ALL RMs in the branch (peer comparison).
   * Redis cache key: perf:peer:{branch}:{period} — TTL 3600 s
   */
  async getPeerMetrics(branch: string, period: string): Promise<RMPerformanceMetrics[]> {
    const cacheKey = `perf:peer:${branch}:${period}`;
    const cached = await this.cacheService.get<RMPerformanceMetrics[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT peer metrics branch=${branch} period=${period}`);
      return cached;
    }

    // Collect distinct rm_ids in this branch from clients collection
    const rmIds: string[] = (await this.clientModel.distinct('rm_id').exec()) as string[];

    if (rmIds.length === 0) {
      return [];
    }

    // Fetch metrics for all RMs in parallel
    const allMetrics = await Promise.all(
      rmIds.map((rmId) => this.fetchMetricsFromDb(rmId, period, branch)),
    );

    // Filter to only those belonging to the branch (branch is stored on client)
    const branchMetrics = allMetrics.filter((m) => m.branch === branch || branch === 'ALL');

    await this.cacheService.set(cacheKey, branchMetrics, METRICS_CACHE_TTL);
    return branchMetrics;
  }

  // -------------------------------------------------------------------------
  // S1-F33-L2-Logic: Strength Identification
  // -------------------------------------------------------------------------

  /**
   * Identify top-3 strengths and bottom-2 growth areas for an RM vs peers.
   */
  async identifyStrengths(
    rmId: string,
    branch: string,
    period: string,
  ): Promise<StrengthReport> {
    const [rmMetrics, peerMetrics] = await Promise.all([
      this.getPerformanceMetrics(rmId, period),
      this.getPeerMetrics(branch, period),
    ]);

    // Include RM itself in peer set for ranking calculations
    const allPeers = peerMetrics.length > 0 ? peerMetrics : [rmMetrics];
    const peerCount = allPeers.length;

    // Score each dimension
    const dimensionScores = Object.entries(STRENGTH_DIMENSIONS).map(([key, dim]) => {
      const keyMetrics: KeyMetric[] = dim.metrics.map((metricName) => {
        const rmValue = rmMetrics[metricName] as number;
        const peerValues = allPeers.map((p) => p[metricName] as number).sort((a, b) => a - b);

        const peerMedian = this.computeMedian(peerValues);
        const peersBelow = peerValues.filter((v) => v < rmValue).length;
        const percentile = peerCount > 1 ? (peersBelow / (peerCount - 1)) * 100 : 50;

        return {
          name: metricName,
          rm_value: rmValue,
          peer_median: peerMedian,
          percentile: Math.round(percentile * 10) / 10,
        };
      });

      // Weighted average of metric percentiles × dimension weight
      const avgPercentile =
        keyMetrics.reduce((sum, m) => sum + m.percentile, 0) / keyMetrics.length;
      const dimensionScore = Math.min(100, avgPercentile * dim.weight);

      // Rank among peers: how many peers score lower in this dimension
      const peerDimScores = allPeers.map((peer) => {
        const peerKeyMetrics = dim.metrics.map((metricName) => {
          const peerRmValues = allPeers
            .map((p) => p[metricName] as number)
            .sort((a, b) => a - b);
          const peerVal = peer[metricName] as number;
          const below = peerRmValues.filter((v) => v < peerVal).length;
          return peerCount > 1 ? (below / (peerCount - 1)) * 100 : 50;
        });
        const peerAvg = peerKeyMetrics.reduce((s, v) => s + v, 0) / peerKeyMetrics.length;
        return Math.min(100, peerAvg * dim.weight);
      });

      const peerRank =
        peerDimScores.filter((s) => s > dimensionScore).length + 1;

      const coachingNote = this.generateCoachingNote(key, avgPercentile);

      return {
        dimension: key,
        label: dim.label,
        score: Math.round(dimensionScore * 10) / 10,
        peer_rank: peerRank,
        peer_count: peerCount,
        key_metrics: keyMetrics,
        coaching_note: coachingNote,
      } satisfies StrengthItem;
    });

    // Sort descending by score
    const sorted = [...dimensionScores].sort((a, b) => b.score - a.score);
    const strengths = sorted.slice(0, 3);
    const growth_areas = sorted.slice(-2);

    // Overall percentile: average across all metric percentiles
    const allMetricPercentiles = dimensionScores.flatMap((d) =>
      d.key_metrics.map((m) => m.percentile),
    );
    const overall_percentile =
      Math.round(
        (allMetricPercentiles.reduce((s, v) => s + v, 0) / allMetricPercentiles.length) * 10,
      ) / 10;

    return {
      rm_id: rmId,
      period,
      strengths,
      growth_areas,
      overall_percentile,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Fetch all T1 metrics for one RM from MongoDB using single aggregation
   * pipeline per collection (avoids N+1 queries).
   */
  private async fetchMetricsFromDb(
    rmId: string,
    period: string,
    branchOverride?: string,
  ): Promise<RMPerformanceMetrics> {
    const { startDate, endDate } = this.parsePeriod(period);

    // Run all four aggregations in parallel
    const [clientAgg, meetingAgg, transactionAgg, portfolioAgg] = await Promise.all([
      this.aggregateClients(rmId, startDate, endDate),
      this.aggregateMeetings(rmId, startDate, endDate),
      this.aggregateTransactions(rmId, startDate, endDate),
      this.aggregatePortfolios(rmId),
    ]);

    // Determine branch from client data (first client's branch field is not in schema,
    // so we fall back to branchOverride or a safe default)
    const branch = branchOverride ?? (await this.getRmBranch(rmId));

    const aumGrowth = clientAgg.total_aum - clientAgg.aum_start;
    const aumGrowthPct =
      clientAgg.aum_start > 0 ? (aumGrowth / clientAgg.aum_start) * 100 : 0;

    return {
      rm_id: rmId,
      rm_name: await this.getRmName(rmId),
      branch,
      period,

      total_meetings: meetingAgg.total_meetings,
      total_calls: meetingAgg.total_calls,
      client_visits: meetingAgg.client_visits,

      gross_sales: transactionAgg.gross_sales,
      aum_growth: Math.round(aumGrowth),
      aum_growth_pct: Math.round(aumGrowthPct * 100) / 100,
      revenue_generated: transactionAgg.revenue_generated,

      total_clients: clientAgg.total_clients,
      diamond_clients: clientAgg.diamond_clients,
      platinum_clients: clientAgg.platinum_clients,
      new_clients_added: clientAgg.new_clients_added,
      client_retention_rate:
        clientAgg.total_clients > 0
          ? Math.round(
              (clientAgg.clients_with_recent_interaction / clientAgg.total_clients) * 1000,
            ) / 10
          : 0,

      avg_portfolio_return: portfolioAgg.avg_portfolio_return,
      products_per_client: portfolioAgg.products_per_client,
    };
  }

  /** Single-pipeline aggregation over clients collection. */
  private async aggregateClients(
    rmId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<ClientAggResult> {
    type AggRow = {
      total_clients: number;
      diamond_clients: number;
      platinum_clients: number;
      new_clients_added: number;
      clients_with_recent_interaction: number;
      total_aum: number;
    };

    const rows = await this.clientModel
      .aggregate<AggRow>([
        { $match: { rm_id: rmId } },
        {
          $group: {
            _id: null,
            total_clients: { $sum: 1 },
            diamond_clients: {
              $sum: { $cond: [{ $eq: ['$tier', 'DIAMOND'] }, 1, 0] },
            },
            platinum_clients: {
              $sum: { $cond: [{ $eq: ['$tier', 'PLATINUM'] }, 1, 0] },
            },
            new_clients_added: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$onboarding_date', startDate] },
                      { $lte: ['$onboarding_date', endDate] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            clients_with_recent_interaction: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$last_interaction', startDate] },
                      { $lte: ['$last_interaction', endDate] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_aum: { $sum: '$total_aum' },
          },
        },
      ])
      .exec();

    const row = rows[0];
    if (!row) {
      return {
        total_clients: 0,
        diamond_clients: 0,
        platinum_clients: 0,
        new_clients_added: 0,
        clients_with_recent_interaction: 0,
        total_aum: 0,
        aum_start: 0,
      };
    }

    return { ...row, aum_start: 0 };
  }

  /** Single-pipeline aggregation over meetings collection. */
  private async aggregateMeetings(
    rmId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<MeetingAggResult> {
    type AggRow = {
      total_meetings: number;
      total_calls: number;
      client_visits: number;
    };

    const rows = await this.meetingModel
      .aggregate<AggRow>([
        {
          $match: {
            rm_id: rmId,
            scheduled_date: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: null,
            total_meetings: { $sum: 1 },
            total_calls: {
              $sum: {
                $cond: [{ $in: ['$meeting_type', ['CALL', 'PHONE_CALL']] }, 1, 0],
              },
            },
            client_visits: {
              $sum: {
                $cond: [{ $in: ['$meeting_type', ['IN_PERSON', 'VISIT', 'OFFICE_VISIT']] }, 1, 0],
              },
            },
          },
        },
      ])
      .exec();

    return rows[0] ?? { total_meetings: 0, total_calls: 0, client_visits: 0 };
  }

  /** Single-pipeline aggregation over transactions collection. */
  private async aggregateTransactions(
    rmId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<TransactionAggResult> {
    type AggRow = {
      gross_sales: number;
      revenue_generated: number;
    };

    const rows = await this.transactionModel
      .aggregate<AggRow>([
        {
          $match: {
            rm_id: rmId,
            txn_date: { $gte: startDate, $lte: endDate },
            txn_type: 'BUY',
            status: 'SETTLED',
          },
        },
        {
          $group: {
            _id: null,
            gross_sales: { $sum: '$amount' },
            revenue_generated: { $sum: '$brokerage' },
          },
        },
      ])
      .exec();

    return rows[0] ?? { gross_sales: 0, revenue_generated: 0 };
  }

  /** Single-pipeline aggregation over portfolios collection. */
  private async aggregatePortfolios(rmId: string): Promise<PortfolioAggResult> {
    type AggRow = {
      avg_portfolio_return: number;
      avg_products_per_client: number;
    };

    const rows = await this.portfolioModel
      .aggregate<AggRow>([
        { $match: { rm_id: rmId } },
        {
          $project: {
            avg_pnl_pct: { $avg: '$holdings.pnl_pct' },
            product_count: {
              $size: {
                $ifNull: [
                  { $setUnion: ['$holdings.asset_class'] },
                  [],
                ],
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            avg_portfolio_return: { $avg: '$avg_pnl_pct' },
            avg_products_per_client: { $avg: '$product_count' },
          },
        },
      ])
      .exec();

    const portfolioRow = rows[0];
    if (!portfolioRow) {
      return { avg_portfolio_return: 0, products_per_client: 0 };
    }

    return {
      avg_portfolio_return: Math.round(portfolioRow.avg_portfolio_return * 100) / 100,
      products_per_client: Math.round(portfolioRow.avg_products_per_client * 10) / 10,
    };
  }

  /** Parse a period string ('YYYY-MM' or 'YYYY') into start/end Date objects. */
  private parsePeriod(period: string): { startDate: Date; endDate: Date } {
    if (/^\d{4}-\d{2}$/.test(period)) {
      const parts = period.split('-');
      const year = parseInt(parts[0] ?? '2024', 10);
      const month = parseInt(parts[1] ?? '01', 10);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      return { startDate, endDate };
    }
    // Assume 'YYYY'
    const year = parseInt(period, 10);
    return {
      startDate: new Date(year, 0, 1),
      endDate: new Date(year, 11, 31, 23, 59, 59, 999),
    };
  }

  /** Look up RM branch from a client record. Falls back to 'UNKNOWN'. */
  private async getRmBranch(rmId: string): Promise<string> {
    // The Client schema doesn't have a branch field; we return 'UNKNOWN' by default.
    // In a real system this would come from an RM profile collection.
    void rmId;
    return 'UNKNOWN';
  }

  /** Get RM display name. Falls back to rm_id. */
  private async getRmName(rmId: string): Promise<string> {
    // No RM profile collection in current schema; return rmId as-is.
    return rmId;
  }

  /** Compute the median of a sorted numeric array. */
  private computeMedian(sorted: number[]): number {
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    }
    return sorted[mid] ?? 0;
  }

  /** Generate a generic coaching note for a dimension and percentile. */
  private generateCoachingNote(dimension: string, percentile: number): string {
    const dimLabels: Record<string, string> = {
      client_relationships: 'client relationship activities',
      business_development: 'business development',
      portfolio_performance: 'portfolio performance',
      product_diversification: 'product diversification',
      revenue_generation: 'revenue generation',
    };

    const label = dimLabels[dimension] ?? dimension;

    if (percentile >= 75) {
      return `Top quartile in ${label} — maintain consistency and share best practices with the team.`;
    } else if (percentile >= 50) {
      return `Above peer median in ${label} — continue current approach and look for incremental improvements.`;
    } else if (percentile >= 25) {
      return `Below peer median in ${label} — opportunity to grow by reviewing peer strategies and setting targeted goals.`;
    } else {
      return `Opportunity to grow in ${label} — consider focused coaching and peer learning in this area.`;
    }
  }
}
