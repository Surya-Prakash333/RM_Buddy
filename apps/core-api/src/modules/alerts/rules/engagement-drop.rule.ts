import { Model } from 'mongoose';
import { MeetingDocument } from '../../../database/models/meeting.model';
import { ClientDocument } from '../../../database/models/client.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-F30 Engagement Drop
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Engagement Drop alert (S2-F30).
 *
 * Fires when a client's interaction count (proxied via meetings) drops by
 * more than 30% in the last 14 days compared to the prior 14-day window.
 *
 * Severity : HIGH (P2)
 * Cooldown : 72 hours — re-alert at most once every 3 days
 */
export const ENGAGEMENT_DROP_RULE: AlertRule = {
  rule_id: 'RULE-ENGAGEMENT-DROP',
  alert_type: 'ENGAGEMENT_DROP',
  name: 'Engagement Drop',
  severity: 'high',
  cooldown_hours: 72,
  channels: ['IN_APP', 'VOICE'],
  conditions: { drop_percent: 30, lookback_days: 14 },
};

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

export interface EngagementDropCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  current_interactions: number;   // last 14 days
  previous_interactions: number;  // prior 14 days (days 15–28)
  drop_pct: number;               // percentage drop
}

// ---------------------------------------------------------------------------
// Internal aggregate result
// ---------------------------------------------------------------------------

interface PeriodCount {
  _id: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` whose meeting/interaction count dropped by
 * more than 30% in the last 14 days vs the prior 14-day window.
 *
 * Algorithm:
 *  1. Aggregate meetings in current period (last 14 days) per client.
 *  2. Aggregate meetings in previous period (days 15–28 ago) per client.
 *  3. For clients that appear in the previous period (> 0 interactions),
 *     compute drop_pct = (prev - curr) / prev * 100.
 *  4. Flag clients where drop_pct > 30.
 *  5. Join with clients collection for name/tier.
 *
 * Clients with zero previous interactions are excluded — a drop from 0
 * has no meaningful baseline.
 *
 * @returns Array of candidates sorted by drop_pct descending (may be empty).
 */
export async function evaluateEngagementDrop(
  meetingModel: Model<MeetingDocument>,
  clientModel: Model<ClientDocument>,
  rmId: string,
): Promise<EngagementDropCandidate[]> {
  const now = new Date();
  const day14ago = new Date(now.getTime() - 14 * 86_400_000);
  const day28ago = new Date(now.getTime() - 28 * 86_400_000);

  // Current period: last 14 days
  const currentPeriod = await meetingModel.aggregate<PeriodCount>([
    {
      $match: {
        rm_id: rmId,
        scheduled_date: { $gte: day14ago, $lte: now },
      },
    },
    { $group: { _id: '$client_id', count: { $sum: 1 } } },
  ]);

  // Previous period: 14–28 days ago
  const prevPeriod = await meetingModel.aggregate<PeriodCount>([
    {
      $match: {
        rm_id: rmId,
        scheduled_date: { $gte: day28ago, $lt: day14ago },
      },
    },
    { $group: { _id: '$client_id', count: { $sum: 1 } } },
  ]);

  if (prevPeriod.length === 0) return [];

  // Build lookup maps
  const currentMap = new Map<string, number>(
    currentPeriod.map((r) => [r._id, r.count]),
  );
  const prevMap = new Map<string, number>(
    prevPeriod.map((r) => [r._id, r.count]),
  );

  // Clients that had interactions in previous period
  const dropThreshold = (ENGAGEMENT_DROP_RULE.conditions['drop_percent'] as number);

  const flaggedClientIds: Array<{
    client_id: string;
    current_interactions: number;
    previous_interactions: number;
    drop_pct: number;
  }> = [];

  for (const [clientId, prevCount] of prevMap.entries()) {
    if (prevCount === 0) continue;

    const currCount = currentMap.get(clientId) ?? 0;
    const dropPct = ((prevCount - currCount) / prevCount) * 100;

    if (dropPct > dropThreshold) {
      flaggedClientIds.push({
        client_id: clientId,
        current_interactions: currCount,
        previous_interactions: prevCount,
        drop_pct: Math.round(dropPct * 10) / 10,
      });
    }
  }

  if (flaggedClientIds.length === 0) return [];

  // Fetch client details
  const ids = flaggedClientIds.map((f) => f.client_id);
  const clients = await clientModel
    .find({ rm_id: rmId, client_id: { $in: ids } })
    .lean()
    .exec();

  const clientMap = new Map(clients.map((c) => [c.client_id, c]));

  const candidates: EngagementDropCandidate[] = flaggedClientIds
    .map((f) => {
      const client = clientMap.get(f.client_id);
      if (!client) return null;
      return {
        client_id: f.client_id,
        client_name: client.client_name,
        client_tier: client.tier ?? 'STANDARD',
        current_interactions: f.current_interactions,
        previous_interactions: f.previous_interactions,
        drop_pct: f.drop_pct,
      };
    })
    .filter((c): c is EngagementDropCandidate => c !== null)
    .sort((a, b) => b.drop_pct - a.drop_pct);

  return candidates;
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/**
 * Format an Engagement Drop alert message for a candidate.
 *
 * Example: "Rajesh Kumar engagement dropped 60% in last 14 days
 *           (5 → 2 interactions). Schedule a proactive outreach."
 */
export function buildEngagementDropMessage(candidate: EngagementDropCandidate): string {
  return (
    `${candidate.client_name} engagement dropped ${candidate.drop_pct}% in last 14 days ` +
    `(${candidate.previous_interactions} → ${candidate.current_interactions} interactions). ` +
    `Schedule a proactive outreach.`
  );
}
