import { Model } from 'mongoose';
import { ClientDocument } from '../../../database/models/client.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-N10 Beneficiary Updates
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Beneficiary Update Reminder alert (S2-N10).
 *
 * Fires when a client has:
 *  - High AUM (> ₹50L / 5,000,000)
 *  - Account onboarded 3+ years ago (proxy for stale beneficiary data)
 *  - Verified KYC status (active clients only)
 *
 * Severity : LOW (P4)
 * Cooldown : 720 hours (30 days) — monthly reminder at most
 */
export const BENEFICIARY_UPDATES_RULE: AlertRule = {
  rule_id: 'RULE-BENEFICIARY-UPDATES',
  alert_type: 'BENEFICIARY_UPDATES',
  name: 'Beneficiary Update Reminder',
  severity: 'low',
  cooldown_hours: 720, // 30 days (monthly)
  channels: ['IN_APP'],
  conditions: {
    min_aum: 5_000_000,      // ₹50L AUM
    years_since_review: 3,   // 3+ years old account without review
  },
};

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

export interface BeneficiaryUpdateCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  total_aum: number;
  onboarding_date: Date;
  years_since_onboarding: number;
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` who are due for a beneficiary nomination review.
 *
 * Algorithm:
 *  1. Query clients with AUM >= ₹50L, onboarding_date <= 3 years ago,
 *     and kyc_status === 'Verified'.
 *  2. Map each matching client into a BeneficiaryUpdateCandidate.
 *
 * @returns Array of candidates (may be empty).
 */
export async function evaluateBeneficiaryUpdates(
  clientModel: Model<ClientDocument>,
  rmId: string,
): Promise<BeneficiaryUpdateCandidate[]> {
  const minAum = (BENEFICIARY_UPDATES_RULE.conditions['min_aum'] as number);
  const yearsThreshold = (BENEFICIARY_UPDATES_RULE.conditions['years_since_review'] as number);

  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - yearsThreshold);

  const clients = await clientModel
    .find(
      {
        rm_id: rmId,
        total_aum: { $gte: minAum },
        onboarding_date: { $lte: threeYearsAgo },
        kyc_status: 'Verified',
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

  return clients.map((c) => ({
    client_id: c.client_id,
    client_name: c.client_name,
    client_tier: c.tier ?? 'STANDARD',
    total_aum: c.total_aum ?? 0,
    onboarding_date: new Date(c.onboarding_date),
    years_since_onboarding: Math.round(
      (Date.now() - new Date(c.onboarding_date).getTime()) / (365.25 * 86_400_000),
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
 * Build the alert message for a beneficiary update candidate.
 *
 * Example: "Priya Mehta (₹75,00,000 AUM) — account 4 years old.
 *           Schedule beneficiary nomination review."
 */
export function buildBeneficiaryUpdateMessage(
  candidate: BeneficiaryUpdateCandidate,
): string {
  return (
    `${candidate.client_name} (₹${formatIndian(candidate.total_aum)} AUM) — ` +
    `account ${candidate.years_since_onboarding} years old. ` +
    `Schedule beneficiary nomination review.`
  );
}
