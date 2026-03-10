import {
  evaluateEngagementDrop,
  buildEngagementDropMessage,
  ENGAGEMENT_DROP_RULE,
  EngagementDropCandidate,
} from '../engagement-drop.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

/** Build a minimal client document returned from clientModel.find(). */
const makeClient = (overrides: Partial<{ client_id: string; client_name: string; tier: string }> = {}) => ({
  client_id: 'C001',
  client_name: 'Rajesh Kumar',
  tier: 'HNI',
  ...overrides,
});

/**
 * Build a mock meetingModel that returns currentPeriod results for the first
 * aggregate() call and prevPeriod results for the second.
 */
const makeMeetingModel = (
  currentPeriodResult: Array<{ _id: string; count: number }>,
  prevPeriodResult: Array<{ _id: string; count: number }>,
) => {
  let callCount = 0;
  return {
    aggregate: jest.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? currentPeriodResult : prevPeriodResult);
    }),
  };
};

/** Build a mock clientModel that returns the provided clients. */
const makeClientModel = (clients: ReturnType<typeof makeClient>[]) => ({
  find: jest.fn().mockReturnValue({
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(clients),
    }),
  }),
});

// ---------------------------------------------------------------------------
// Test suite — evaluateEngagementDrop()
// ---------------------------------------------------------------------------

describe('evaluateEngagementDrop()', () => {
  it('should flag client with > 30% drop in interactions', async () => {
    // Previous: 5, Current: 2 → drop = (5-2)/5*100 = 60%
    const meetingModel = makeMeetingModel(
      [{ _id: 'C001', count: 2 }],
      [{ _id: 'C001', count: 5 }],
    );
    const clientModel = makeClientModel([makeClient()]);

    const candidates = await evaluateEngagementDrop(
      meetingModel as any,
      clientModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
    expect(candidates[0].drop_pct).toBe(60);
  });

  it('should NOT flag client with <= 30% drop', async () => {
    // Previous: 10, Current: 7 → drop = 30% (not > 30)
    const meetingModel = makeMeetingModel(
      [{ _id: 'C001', count: 7 }],
      [{ _id: 'C001', count: 10 }],
    );
    const clientModel = makeClientModel([makeClient()]);

    const candidates = await evaluateEngagementDrop(
      meetingModel as any,
      clientModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(0);
  });

  it('should NOT flag client who had zero interactions in previous period', async () => {
    // No previous interactions → no baseline → skip
    const meetingModel = makeMeetingModel(
      [{ _id: 'C001', count: 0 }],
      [], // empty previous period
    );
    const clientModel = makeClientModel([makeClient()]);

    const candidates = await evaluateEngagementDrop(
      meetingModel as any,
      clientModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(0);
  });

  it('should compute drop_pct correctly: (prev - curr) / prev * 100', async () => {
    // Previous: 8, Current: 3 → drop = (8-3)/8*100 = 62.5%
    const meetingModel = makeMeetingModel(
      [{ _id: 'C001', count: 3 }],
      [{ _id: 'C001', count: 8 }],
    );
    const clientModel = makeClientModel([makeClient()]);

    const candidates = await evaluateEngagementDrop(
      meetingModel as any,
      clientModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].drop_pct).toBe(62.5);
    expect(candidates[0].previous_interactions).toBe(8);
    expect(candidates[0].current_interactions).toBe(3);
  });

  it('should return client_tier in result', async () => {
    // Previous: 4, Current: 1 → drop = 75%
    const meetingModel = makeMeetingModel(
      [{ _id: 'C001', count: 1 }],
      [{ _id: 'C001', count: 4 }],
    );
    const clientModel = makeClientModel([makeClient({ tier: 'UHNI' })]);

    const candidates = await evaluateEngagementDrop(
      meetingModel as any,
      clientModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_tier).toBe('UHNI');
  });

  it('should handle client with no meetings in current period (100% drop)', async () => {
    // Previous: 6, Current: 0 (client not in currentPeriod at all) → drop = 100%
    const meetingModel = makeMeetingModel(
      [], // no current interactions for any client
      [{ _id: 'C001', count: 6 }],
    );
    const clientModel = makeClientModel([makeClient()]);

    const candidates = await evaluateEngagementDrop(
      meetingModel as any,
      clientModel as any,
      RM_ID,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
    expect(candidates[0].current_interactions).toBe(0);
    expect(candidates[0].drop_pct).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// buildEngagementDropMessage()
// ---------------------------------------------------------------------------

describe('buildEngagementDropMessage()', () => {
  const candidate: EngagementDropCandidate = {
    client_id: 'C001',
    client_name: 'Rajesh Kumar',
    client_tier: 'HNI',
    current_interactions: 2,
    previous_interactions: 5,
    drop_pct: 60,
  };

  it('should include client name in the message', () => {
    const msg = buildEngagementDropMessage(candidate);
    expect(msg).toContain('Rajesh Kumar');
  });

  it('should include drop_pct in the message', () => {
    const msg = buildEngagementDropMessage(candidate);
    expect(msg).toContain('60%');
  });

  it('should include both previous and current interactions', () => {
    const msg = buildEngagementDropMessage(candidate);
    expect(msg).toContain('5');
    expect(msg).toContain('2');
  });

  it('should include outreach suggestion', () => {
    const msg = buildEngagementDropMessage(candidate);
    expect(msg).toContain('outreach');
  });
});

// ---------------------------------------------------------------------------
// ENGAGEMENT_DROP_RULE constant
// ---------------------------------------------------------------------------

describe('ENGAGEMENT_DROP_RULE constant', () => {
  it('should have rule_id RULE-ENGAGEMENT-DROP', () => {
    expect(ENGAGEMENT_DROP_RULE.rule_id).toBe('RULE-ENGAGEMENT-DROP');
  });

  it('should have severity high', () => {
    expect(ENGAGEMENT_DROP_RULE.severity).toBe('high');
  });

  it('should have cooldown_hours of 72', () => {
    expect(ENGAGEMENT_DROP_RULE.cooldown_hours).toBe(72);
  });

  it('should have drop_percent threshold of 30', () => {
    expect(ENGAGEMENT_DROP_RULE.conditions['drop_percent']).toBe(30);
  });

  it('should have lookback_days of 14', () => {
    expect(ENGAGEMENT_DROP_RULE.conditions['lookback_days']).toBe(14);
  });
});
