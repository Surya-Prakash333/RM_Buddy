import { Model } from 'mongoose';
import { ClientDocument } from '../../../database/models/client.model';
import { AlertRule } from '../alert-engine.service';

// ---------------------------------------------------------------------------
// Rule definition — S2-N1 Birthday Reminders
// ---------------------------------------------------------------------------

/**
 * Alert rule constant for the Birthday Reminder alert (S2-N1).
 *
 * Fires when a client's birthday (month + day) falls within the next 3 days.
 * Because the `dob` field stores the actual birth year, comparisons are done
 * against the current (or next) year's occurrence using MongoDB aggregation.
 *
 * Severity : MEDIUM (P3)
 * Cooldown : 24 hours — once per day at most
 */
export const BIRTHDAY_RULE: AlertRule = {
  rule_id: 'RULE-BIRTHDAY',
  alert_type: 'BIRTHDAY',
  name: 'Birthday Reminder',
  severity: 'medium',
  cooldown_hours: 24,
  channels: ['IN_APP'],
  conditions: {
    days_ahead: 3, // alert if birthday is within 3 days (inclusive of today)
  },
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface BirthdayCandidate {
  client_id: string;
  client_name: string;
  client_tier: string;
  dob: Date;
  days_until_birthday: number;
}

// ---------------------------------------------------------------------------
// Evaluation function
// ---------------------------------------------------------------------------

/**
 * Identify clients under `rmId` whose birthday (month/day) falls within the
 * next `days_ahead` days (default: 3).
 *
 * Algorithm (MongoDB aggregation):
 *  1. Match clients with a non-null `dob` field.
 *  2. Compute this year's birthday via `$dateFromParts`.
 *  3. If that date has already passed, compute next year's occurrence instead.
 *  4. Calculate `days_until_birthday` = ceil((next_birthday − now) / 1 day).
 *  5. Filter to candidates where 0 ≤ days_until_birthday ≤ days_ahead.
 *  6. Sort ascending so the most urgent birthday appears first.
 *
 * `$dateFromParts` is a MongoDB 3.6+ operator — safe for all supported Atlas
 * and self-hosted deployments.
 *
 * @returns Array of birthday candidates sorted by days_until_birthday ASC.
 */
export async function evaluateBirthdays(
  clientModel: Model<ClientDocument>,
  rmId: string,
): Promise<BirthdayCandidate[]> {
  const daysAhead =
    (BIRTHDAY_RULE.conditions['days_ahead'] as number | undefined) ?? 3;

  const now = new Date();

  const candidates = await clientModel.aggregate<
    BirthdayCandidate & { tier: string }
  >([
    // Step 1 — only clients with a dob set
    {
      $match: {
        rm_id: rmId,
        dob: { $exists: true, $ne: null },
      },
    },

    // Step 2 — extract birth month and day
    {
      $addFields: {
        birth_month: { $month: '$dob' },
        birth_day: { $dayOfMonth: '$dob' },
      },
    },

    // Step 3 — construct this year's birthday date
    {
      $addFields: {
        birthday_this_year: {
          $dateFromParts: {
            year: { $year: now },
            month: '$birth_month',
            day: '$birth_day',
          },
        },
      },
    },

    // Step 4 — if birthday already passed this year, use next year
    {
      $addFields: {
        next_birthday: {
          $cond: {
            if: { $gte: ['$birthday_this_year', now] },
            then: '$birthday_this_year',
            else: {
              $dateFromParts: {
                year: { $add: [{ $year: now }, 1] },
                month: '$birth_month',
                day: '$birth_day',
              },
            },
          },
        },
      },
    },

    // Step 5 — compute days until birthday (ceiling to handle partial days)
    {
      $addFields: {
        days_until_birthday: {
          $ceil: {
            $divide: [{ $subtract: ['$next_birthday', now] }, 86_400_000],
          },
        },
      },
    },

    // Step 6 — keep only clients within the alert window
    {
      $match: {
        days_until_birthday: { $gte: 0, $lte: daysAhead },
      },
    },

    // Step 7 — project only the fields we need
    {
      $project: {
        _id: 0,
        client_id: 1,
        client_name: 1,
        tier: 1,
        dob: 1,
        days_until_birthday: 1,
      },
    },

    // Step 8 — most urgent birthday first
    { $sort: { days_until_birthday: 1 } },
  ]);

  return candidates.map((c) => ({
    client_id: c.client_id,
    client_name: c.client_name,
    client_tier: c.tier ?? 'STANDARD',
    dob: c.dob,
    days_until_birthday: c.days_until_birthday,
  }));
}

// ---------------------------------------------------------------------------
// Alert message builder
// ---------------------------------------------------------------------------

/**
 * Build the alert message for a birthday candidate.
 *
 * Birthday today: "🎂 Anil Sharma's birthday today! Send wishes and schedule a call."
 * Upcoming:       "Anil Sharma's birthday in 2 day(s) — prepare a personalized message."
 */
export function buildBirthdayMessage(candidate: BirthdayCandidate): string {
  if (candidate.days_until_birthday === 0) {
    return `🎂 ${candidate.client_name}'s birthday today! Send wishes and schedule a call.`;
  }
  const days = candidate.days_until_birthday;
  return `${candidate.client_name}'s birthday in ${days} day${days === 1 ? '' : 's'} — prepare a personalized message.`;
}
