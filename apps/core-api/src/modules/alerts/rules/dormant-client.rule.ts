import { Model } from 'mongoose';
import { ClientDocument } from '../../../database/models/client.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-F29 Dormant Client Revival
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Dormant Client Revival alert (S2-F29).
 *
 * Fires when an RM has had no recorded interaction with a client for 90+
 * consecutive days.  Only active clients should be flagged — the query
 * relies on last_interaction being non-null.
 *
 * Severity : MEDIUM (P3)
 * Cooldown : 7 days (168 hours) — avoid spamming about the same dormant client
 */
export const DORMANT_CLIENT_RULE: AlertRule = {
  rule_id: 'RULE-DORMANT',
  alert_type: 'DORMANT_CLIENT',
  name: 'Dormant Client Revival',
  severity: 'medium',
  cooldown_hours: 168, // 7 days
  channels: ['IN_APP'],
  conditions: {
    inactive_days: 90,
  },
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface DormantClientCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  total_aum: number;
  last_interaction: Date;
  days_dormant: number;
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` who have had no RM interaction in 90+ days.
 *
 * Only clients whose `last_interaction` field is set (non-null) and is older
 * than the 90-day cutoff are included.  Clients missing the field entirely
 * are skipped to avoid false positives on newly onboarded records.
 *
 * @returns Array of dormant client candidates (may be empty).
 */
export async function evaluateDormantClients(
  clientModel: Model<ClientDocument>,
  rmId: string,
): Promise<DormantClientCandidate[]> {
  const inactiveDays =
    (DORMANT_CLIENT_RULE.conditions['inactive_days'] as number | undefined) ?? 90;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - inactiveDays);

  const clients = await clientModel
    .find(
      {
        rm_id: rmId,
        last_interaction: { $lt: cutoff, $ne: null, $exists: true },
      },
      {
        client_id: 1,
        client_name: 1,
        tier: 1,
        total_aum: 1,
        last_interaction: 1,
      },
    )
    .lean()
    .exec();

  return clients
    .filter((c) => c.last_interaction != null)
    .map((c) => ({
      client_id: c.client_id,
      client_name: c.client_name,
      client_tier: c.tier ?? 'STANDARD',
      total_aum: c.total_aum ?? 0,
      last_interaction: new Date(c.last_interaction),
      days_dormant: Math.floor(
        (Date.now() - new Date(c.last_interaction).getTime()) / 86_400_000,
      ),
    }));
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/** Format rupees in Indian notation (e.g. 5000000 → "50,00,000"). */
function formatIndian(amount: number): string {
  return amount.toLocaleString('en-IN');
}

/**
 * Build the alert message for a dormant client candidate.
 *
 * Today:    "Anil Sharma (₹50,00,000 AUM) — no interaction in 95 days. Schedule a check-in call."
 */
export function buildDormantClientMessage(candidate: DormantClientCandidate): string {
  return (
    `${candidate.client_name} (₹${formatIndian(candidate.total_aum)} AUM) — ` +
    `no interaction in ${candidate.days_dormant} days. Schedule a check-in call.`
  );
}
