/**
 * Data-transfer objects and response interfaces for the Daily Status Review
 * feature (S1-F6-L1-Data and S1-F6-L2-Logic).
 */

export interface DailyActivitySummary {
  rm_id: string;
  date: string;
  calls: number;
  meetings: number;
  tasks_completed: number;
  proposals_sent: number;
  active_alerts: number;
  cached_at?: string;
}

export interface TeamAverageSummary {
  calls: number;
  meetings: number;
  tasks_completed: number;
  proposals_sent: number;
  /** Number of RMs included in the average */
  sample_size: number;
}

export interface ActivityGaps {
  /** Positive = RM above average, negative = below */
  calls: number;
  meetings: number;
  tasks_completed: number;
  proposals_sent: number;
}

export interface PeerRank {
  /** Rank by calls among branch RMs (1 = most calls) */
  calls: number;
  /** Rank by meetings among branch RMs (1 = most meetings) */
  meetings: number;
  /** Rank by total activity (calls + meetings + tasks + proposals) */
  overall: number;
}

export interface DailyStatus {
  rm_summary: DailyActivitySummary;
  team_avg: TeamAverageSummary;
  gaps: ActivityGaps;
  peer_rank: PeerRank;
}
