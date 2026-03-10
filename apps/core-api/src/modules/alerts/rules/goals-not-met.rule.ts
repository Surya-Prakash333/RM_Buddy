import { Model } from 'mongoose';
import { ClientDocument } from '../../../database/models/client.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-F32 Goals Not Met
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Investment Goals Review alert (S2-F32).
 *
 * Fires when a client's AUM growth falls below 70% of the expected milestone
 * for their tenure as a client.  Milestones are conservative flat targets
 * used as a proxy for goal-tracking in the absence of explicit goal data.
 *
 * Severity : MEDIUM (P3)
 * Cooldown : 720 hours (30 days) — monthly check-in at most
 */
export const GOALS_NOT_MET_RULE: AlertRule = {
  rule_id: 'RULE-GOALS-NOT-MET',
  alert_type: 'GOALS_NOT_MET',
  name: 'Investment Goals Review',
  severity: 'medium',
  cooldown_hours: 720, // monthly
  channels: ['IN_APP'],
  conditions: {
    progress_threshold_pct: 70, // below 70% of expected AUM growth
    min_years: 2,               // client must be with us for 2+ years
  },
};

// ---------------------------------------------------------------------------
// AUM milestone benchmarks
// ---------------------------------------------------------------------------

/**
 * Conservative AUM milestones by client tenure (years).
 * If a client's actual AUM is below 70% of the applicable milestone,
 * they are flagged for a goals review.
 */
export const AUM_MILESTONES: { years: number; min_aum: number }[] = [
  { years: 2, min_aum: 500_000 },       // ₹5L after 2 years
  { years: 3, min_aum: 1_000_000 },     // ₹10L after 3 years
  { years: 5, min_aum: 2_500_000 },     // ₹25L after 5 years
  { years: 10, min_aum: 10_000_000 },   // ₹1Cr after 10 years
];

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

export interface GoalsNotMetCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  total_aum: number;
  years_as_client: number;
  expected_aum: number;   // the milestone they should have reached
  progress_pct: number;   // actual / expected * 100, rounded
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` who are not on track to meet their investment
 * goals based on conservative AUM milestones.
 *
 * Algorithm:
 *  1. Fetch clients onboarded 2+ years ago.
 *  2. For each client, determine the latest applicable AUM milestone.
 *  3. Compute progress_pct = (total_aum / milestone.min_aum) * 100.
 *  4. If progress_pct < 70, include the client as a candidate.
 *
 * @returns Array of candidates (may be empty).
 */
export async function evaluateGoalsNotMet(
  clientModel: Model<ClientDocument>,
  rmId: string,
): Promise<GoalsNotMetCandidate[]> {
  const minYears = (GOALS_NOT_MET_RULE.conditions['min_years'] as number);
  const progressThreshold = (GOALS_NOT_MET_RULE.conditions['progress_threshold_pct'] as number);

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - minYears);

  const clients = await clientModel
    .find(
      {
        rm_id: rmId,
        onboarding_date: { $lte: cutoff },
      },
      {
        client_id: 1,
        client_name: 1,
        tier: 1,
        total_aum: 1,
        onboarding_date: 1,
      },
    )
    .lean()
    .exec();

  const candidates: GoalsNotMetCandidate[] = [];

  for (const c of clients) {
    const yearsAsClient =
      (Date.now() - new Date(c.onboarding_date).getTime()) / (365.25 * 86_400_000);

    // Find the most recent applicable milestone (largest years <= yearsAsClient)
    const milestone = AUM_MILESTONES.filter((m) => m.years <= Math.round(yearsAsClient)).sort(
      (a, b) => b.years - a.years,
    )[0];

    if (!milestone) continue;

    const progressPct = ((c.total_aum ?? 0) / milestone.min_aum) * 100;

    if (progressPct < progressThreshold) {
      candidates.push({
        client_id: c.client_id,
        client_name: c.client_name,
        client_tier: c.tier ?? 'STANDARD',
        total_aum: c.total_aum ?? 0,
        years_as_client: Math.floor(yearsAsClient),
        expected_aum: milestone.min_aum,
        progress_pct: Math.round(progressPct),
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/** Format rupees in Indian notation (e.g. 2500000 → "25,00,000"). */
function formatIndian(amount: number): string {
  return amount.toLocaleString('en-IN');
}

/**
 * Build the alert message for a goals-not-met candidate.
 *
 * Example: "Amit Verma is at 45% of expected AUM milestone
 *           (₹4,50,000 vs ₹10,00,000 target after 3 years).
 *           Schedule investment review."
 */
export function buildGoalsNotMetMessage(candidate: GoalsNotMetCandidate): string {
  return (
    `${candidate.client_name} is at ${candidate.progress_pct}% of expected AUM milestone ` +
    `(₹${formatIndian(candidate.total_aum)} vs ₹${formatIndian(candidate.expected_aum)} target ` +
    `after ${candidate.years_as_client} years). Schedule investment review.`
  );
}
