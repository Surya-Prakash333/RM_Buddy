import {
  evaluateGoalsNotMet,
  buildGoalsNotMetMessage,
  GOALS_NOT_MET_RULE,
  AUM_MILESTONES,
  GoalsNotMetCandidate,
} from '../goals-not-met.rule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RM_ID = 'RM001';

/** Date helper: subtract `years` from today. */
function yearsAgo(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

/** Build a minimal lean client document. */
const makeClient = (
  overrides: Partial<{
    client_id: string;
    client_name: string;
    tier: string;
    total_aum: number;
    onboarding_date: Date;
  }> = {},
) => ({
  client_id: 'C001',
  client_name: 'Amit Verma',
  tier: 'STANDARD',
  total_aum: 300_000,           // ₹3L — below ₹5L milestone at 2 years
  onboarding_date: yearsAgo(2), // exactly 2 years ago
  ...overrides,
});

/** Build a mock Mongoose Model that returns `docs` from .find().lean().exec(). */
const makeClientModel = (docs: ReturnType<typeof makeClient>[]) => ({
  find: jest.fn().mockReturnValue({
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(docs),
    }),
  }),
});

// ---------------------------------------------------------------------------
// evaluateGoalsNotMet()
// ---------------------------------------------------------------------------

describe('evaluateGoalsNotMet()', () => {
  it('should flag client at < 70% of expected AUM milestone', async () => {
    // 2-year milestone = ₹5L. Client has ₹3L → 60% → flagged
    const client = makeClient({ total_aum: 300_000, onboarding_date: yearsAgo(2) });
    const clientModel = makeClientModel([client]);

    const candidates = await evaluateGoalsNotMet(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
    expect(candidates[0].progress_pct).toBeLessThan(70);
  });

  it('should NOT flag client at >= 70% of expected AUM', async () => {
    // 2-year milestone = ₹5L. Client has ₹4L → 80% → not flagged
    const client = makeClient({ total_aum: 400_000, onboarding_date: yearsAgo(2) });
    const clientModel = makeClientModel([client]);

    const candidates = await evaluateGoalsNotMet(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(0);
  });

  it('should use the latest applicable milestone for years as client', async () => {
    // Client has been with us for 3 years → applicable milestone is 3-year (₹10L)
    // Client has ₹5L → 50% → flagged with expected_aum = ₹10L
    const client = makeClient({ total_aum: 500_000, onboarding_date: yearsAgo(3) });
    const clientModel = makeClientModel([client]);

    const candidates = await evaluateGoalsNotMet(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].expected_aum).toBe(1_000_000); // ₹10L (3-year milestone)
  });

  it('should NOT include clients with < 2 years tenure', async () => {
    // The Mongoose query filters onboarding_date > 2 years ago — model returns empty
    const clientModel = makeClientModel([]);

    const candidates = await evaluateGoalsNotMet(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(0);
    expect(clientModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        onboarding_date: expect.objectContaining({ $lte: expect.any(Date) }),
      }),
      expect.anything(),
    );
  });

  it('should compute progress_pct as actual_aum / expected * 100', async () => {
    // 3-year milestone = ₹10L. Client has ₹4L → 40%
    const client = makeClient({ total_aum: 400_000, onboarding_date: yearsAgo(3) });
    const clientModel = makeClientModel([client]);

    const candidates = await evaluateGoalsNotMet(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].progress_pct).toBe(40); // Math.round(400000/1000000 * 100)
  });

  it('should return years_as_client in result', async () => {
    const client = makeClient({ total_aum: 300_000, onboarding_date: yearsAgo(3) });
    const clientModel = makeClientModel([client]);

    const candidates = await evaluateGoalsNotMet(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].years_as_client).toBe(3);
  });

  it('should return expected_aum for the applicable milestone', async () => {
    // 5-year client → ₹25L milestone; AUM ₹10L → 40% → flagged
    const client = makeClient({ total_aum: 1_000_000, onboarding_date: yearsAgo(5) });
    const clientModel = makeClientModel([client]);

    const candidates = await evaluateGoalsNotMet(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].expected_aum).toBe(2_500_000); // ₹25L (5-year milestone)
  });
});

// ---------------------------------------------------------------------------
// buildGoalsNotMetMessage()
// ---------------------------------------------------------------------------

describe('buildGoalsNotMetMessage()', () => {
  const candidate: GoalsNotMetCandidate = {
    client_id: 'C001',
    client_name: 'Amit Verma',
    client_tier: 'STANDARD',
    total_aum: 400_000,
    years_as_client: 3,
    expected_aum: 1_000_000,
    progress_pct: 40,
  };

  it('should include client name', () => {
    const msg = buildGoalsNotMetMessage(candidate);
    expect(msg).toContain('Amit Verma');
  });

  it('should include progress_pct', () => {
    const msg = buildGoalsNotMetMessage(candidate);
    expect(msg).toContain('40%');
  });

  it('should include actual AUM formatted in Indian notation', () => {
    const msg = buildGoalsNotMetMessage(candidate);
    expect(msg).toContain('4,00,000');
  });

  it('should include expected AUM formatted in Indian notation', () => {
    const msg = buildGoalsNotMetMessage(candidate);
    expect(msg).toContain('10,00,000');
  });

  it('should include years_as_client', () => {
    const msg = buildGoalsNotMetMessage(candidate);
    expect(msg).toContain('3 years');
  });

  it('should mention investment review', () => {
    const msg = buildGoalsNotMetMessage(candidate);
    expect(msg).toContain('investment review');
  });
});

// ---------------------------------------------------------------------------
// GOALS_NOT_MET_RULE constant
// ---------------------------------------------------------------------------

describe('GOALS_NOT_MET_RULE constant', () => {
  it('should have rule_id RULE-GOALS-NOT-MET', () => {
    expect(GOALS_NOT_MET_RULE.rule_id).toBe('RULE-GOALS-NOT-MET');
  });

  it('should have severity medium', () => {
    expect(GOALS_NOT_MET_RULE.severity).toBe('medium');
  });

  it('should have cooldown_hours of 720 (30 days)', () => {
    expect(GOALS_NOT_MET_RULE.cooldown_hours).toBe(720);
  });

  it('should have progress_threshold_pct of 70', () => {
    expect(GOALS_NOT_MET_RULE.conditions['progress_threshold_pct']).toBe(70);
  });

  it('should have min_years of 2', () => {
    expect(GOALS_NOT_MET_RULE.conditions['min_years']).toBe(2);
  });

  it('should NOT have a description field', () => {
    expect((GOALS_NOT_MET_RULE as any).description).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AUM_MILESTONES
// ---------------------------------------------------------------------------

describe('AUM_MILESTONES', () => {
  it('should include a 2-year milestone of ₹5L', () => {
    const m = AUM_MILESTONES.find((x) => x.years === 2);
    expect(m).toBeDefined();
    expect(m!.min_aum).toBe(500_000);
  });

  it('should include a 3-year milestone of ₹10L', () => {
    const m = AUM_MILESTONES.find((x) => x.years === 3);
    expect(m).toBeDefined();
    expect(m!.min_aum).toBe(1_000_000);
  });

  it('should include a 5-year milestone of ₹25L', () => {
    const m = AUM_MILESTONES.find((x) => x.years === 5);
    expect(m).toBeDefined();
    expect(m!.min_aum).toBe(2_500_000);
  });

  it('should include a 10-year milestone of ₹1Cr', () => {
    const m = AUM_MILESTONES.find((x) => x.years === 10);
    expect(m).toBeDefined();
    expect(m!.min_aum).toBe(10_000_000);
  });
});
