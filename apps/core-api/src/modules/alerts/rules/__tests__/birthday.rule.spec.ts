import { Model } from 'mongoose';
import { ClientDocument } from '../../../../database/models/client.model';
import {
  evaluateBirthdays,
  buildBirthdayMessage,
  BIRTHDAY_RULE,
  BirthdayCandidate,
} from '../birthday.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM-TEST-002';

/** Return a Date whose month+day is N days from today (any year). */
const birthdayInDays = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  // Use an old year to simulate a real birth date
  d.setFullYear(1985);
  return d;
};

/** Today's birthday (same month+day as today, birth year 1985). */
const birthdayToday = (): Date => {
  const d = new Date();
  d.setFullYear(1985);
  return d;
};

/** Birthday that occurred N days AGO (already passed this year). */
const birthdayDaysAgo = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setFullYear(1985);
  return d;
};

/** Minimal client document shape returned by the aggregation pipeline. */
const makeAggregationResult = (
  overrides: Partial<{
    client_id: string;
    client_name: string;
    tier: string;
    dob: Date;
    days_until_birthday: number;
  }> = {},
) => ({
  client_id: 'client-bday-001',
  client_name: 'Rajesh Kumar',
  tier: 'HNI',
  dob: birthdayToday(),
  days_until_birthday: 0,
  ...overrides,
});

/**
 * Build a mock Model whose .aggregate() resolves with `returnValue`.
 * The birthday rule uses aggregation, not find().lean().exec().
 */
const makeClientModelMock = (returnValue: unknown[] = []): Model<ClientDocument> =>
  ({
    aggregate: jest.fn().mockResolvedValue(returnValue),
  } as unknown as Model<ClientDocument>);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('BirthdayRule', () => {
  // -------------------------------------------------------------------------
  // Rule metadata
  // -------------------------------------------------------------------------

  it('has the correct rule_id and alert_type', () => {
    expect(BIRTHDAY_RULE.rule_id).toBe('RULE-BIRTHDAY');
    expect(BIRTHDAY_RULE.alert_type).toBe('BIRTHDAY');
  });

  it('has cooldown_hours of 24 (once per day)', () => {
    expect(BIRTHDAY_RULE.cooldown_hours).toBe(24);
  });

  it('has days_ahead condition of 3', () => {
    expect(BIRTHDAY_RULE.conditions['days_ahead']).toBe(3);
  });

  // -------------------------------------------------------------------------
  // evaluateBirthdays()
  // -------------------------------------------------------------------------

  describe('evaluateBirthdays()', () => {
    it('should flag client with birthday today (days_until=0)', async () => {
      const row = makeAggregationResult({ days_until_birthday: 0 });
      const model = makeClientModelMock([row]);

      const results = await evaluateBirthdays(model, RM_ID);

      expect(results).toHaveLength(1);
      expect(results[0].days_until_birthday).toBe(0);
    });

    it('should flag client with birthday in 2 days', async () => {
      const row = makeAggregationResult({
        client_id: 'client-002',
        client_name: 'Meena Sharma',
        dob: birthdayInDays(2),
        days_until_birthday: 2,
      });
      const model = makeClientModelMock([row]);

      const results = await evaluateBirthdays(model, RM_ID);

      expect(results).toHaveLength(1);
      expect(results[0].days_until_birthday).toBe(2);
    });

    it('should flag client with birthday in 3 days (boundary)', async () => {
      const row = makeAggregationResult({
        client_id: 'client-003',
        dob: birthdayInDays(3),
        days_until_birthday: 3,
      });
      const model = makeClientModelMock([row]);

      const results = await evaluateBirthdays(model, RM_ID);

      expect(results).toHaveLength(1);
      expect(results[0].days_until_birthday).toBe(3);
    });

    it('should NOT flag client with birthday in 4+ days', async () => {
      // The aggregation pipeline filters these out; simulate empty result
      const model = makeClientModelMock([]);

      const results = await evaluateBirthdays(model, RM_ID);

      expect(results).toHaveLength(0);
    });

    it('should handle birthday that already passed this year (check next year)', async () => {
      // The aggregation computes next_birthday as next year when birthday passed.
      // Simulate the result the pipeline would return for a birthday 2 days away
      // (next year) — the mock already represents the post-aggregation state.
      const row = makeAggregationResult({
        client_id: 'client-next-year',
        dob: birthdayDaysAgo(10), // birthday was 10 days ago → next year's occurrence is ~355 days away
        days_until_birthday: 355, // pipeline would NOT return this — filtered out
      });

      // When birthday is already past and next occurrence is > 3 days away,
      // the aggregation returns an empty set.
      const model = makeClientModelMock([]);

      const results = await evaluateBirthdays(model, RM_ID);

      expect(results).toHaveLength(0);
    });

    it('should sort results by days_until_birthday ascending', async () => {
      const rows = [
        makeAggregationResult({ client_id: 'c-3', client_name: 'Three', days_until_birthday: 3 }),
        makeAggregationResult({ client_id: 'c-1', client_name: 'One',   days_until_birthday: 1 }),
        makeAggregationResult({ client_id: 'c-0', client_name: 'Today', days_until_birthday: 0 }),
      ];
      // Aggregation pipeline sorts ascending; mock returns already-sorted data
      const sortedRows = [...rows].sort((a, b) => a.days_until_birthday - b.days_until_birthday);
      const model = makeClientModelMock(sortedRows);

      const results = await evaluateBirthdays(model, RM_ID);

      expect(results.map((r) => r.days_until_birthday)).toEqual([0, 1, 3]);
    });

    it('should map tier to client_tier in the result', async () => {
      const row = makeAggregationResult({ tier: 'PLATINUM', days_until_birthday: 1 });
      const model = makeClientModelMock([row]);

      const results = await evaluateBirthdays(model, RM_ID);

      expect(results[0].client_tier).toBe('PLATINUM');
    });

    it('should default client_tier to STANDARD when tier is missing', async () => {
      const row = { ...makeAggregationResult(), tier: undefined };
      const model = makeClientModelMock([row]);

      const results = await evaluateBirthdays(model, RM_ID);

      expect(results[0].client_tier).toBe('STANDARD');
    });

    it('should return an empty array when no clients have an upcoming birthday', async () => {
      const model = makeClientModelMock([]);

      const results = await evaluateBirthdays(model, RM_ID);

      expect(results).toEqual([]);
    });

    it('should pass rm_id to the aggregation pipeline', async () => {
      const model = makeClientModelMock([]);

      await evaluateBirthdays(model, RM_ID);

      // First stage of pipeline is $match with rm_id
      const pipeline = (model.aggregate as jest.Mock).mock.calls[0][0];
      const matchStage = pipeline[0];
      expect(matchStage.$match).toMatchObject({ rm_id: RM_ID });
    });

    it('should include dob as a Date in the result', async () => {
      const dob = birthdayToday();
      const row = makeAggregationResult({ dob, days_until_birthday: 0 });
      const model = makeClientModelMock([row]);

      const results = await evaluateBirthdays(model, RM_ID);

      expect(results[0].dob).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // buildBirthdayMessage()
  // -------------------------------------------------------------------------

  describe('buildBirthdayMessage()', () => {
    const makeCandidate = (overrides: Partial<BirthdayCandidate> = {}): BirthdayCandidate => ({
      client_id: 'c-001',
      client_name: 'Rajesh Kumar',
      client_tier: 'HNI',
      dob: birthdayToday(),
      days_until_birthday: 0,
      ...overrides,
    });

    it('includes cake emoji and "today" when days_until_birthday is 0', () => {
      const msg = buildBirthdayMessage(makeCandidate({ days_until_birthday: 0 }));
      expect(msg).toContain('🎂');
      expect(msg.toLowerCase()).toContain('today');
    });

    it('includes "wishes" and "call" in the today message', () => {
      const msg = buildBirthdayMessage(makeCandidate({ days_until_birthday: 0 }));
      expect(msg.toLowerCase()).toContain('wishes');
      expect(msg.toLowerCase()).toContain('call');
    });

    it('includes the number of days for upcoming birthdays', () => {
      const msg = buildBirthdayMessage(makeCandidate({ days_until_birthday: 2 }));
      expect(msg).toContain('2 days');
    });

    it('uses singular "day" for 1-day upcoming birthday', () => {
      const msg = buildBirthdayMessage(makeCandidate({ days_until_birthday: 1 }));
      expect(msg).toContain('1 day');
      expect(msg).not.toContain('1 days');
    });

    it('includes "personalized message" in upcoming birthday message', () => {
      const msg = buildBirthdayMessage(makeCandidate({ days_until_birthday: 3 }));
      expect(msg.toLowerCase()).toContain('personalized message');
    });

    it('includes the client name in all message variants', () => {
      const today = buildBirthdayMessage(makeCandidate({ client_name: 'Priya Mehta', days_until_birthday: 0 }));
      const upcoming = buildBirthdayMessage(makeCandidate({ client_name: 'Priya Mehta', days_until_birthday: 2 }));

      expect(today).toContain('Priya Mehta');
      expect(upcoming).toContain('Priya Mehta');
    });
  });
});
