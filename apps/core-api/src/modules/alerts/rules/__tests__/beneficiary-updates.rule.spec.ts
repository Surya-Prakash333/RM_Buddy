import {
  evaluateBeneficiaryUpdates,
  buildBeneficiaryUpdateMessage,
  BENEFICIARY_UPDATES_RULE,
  BeneficiaryUpdateCandidate,
} from '../beneficiary-updates.rule';

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
    kyc_status: string;
  }> = {},
) => ({
  client_id: 'C001',
  client_name: 'Priya Mehta',
  tier: 'HNI',
  total_aum: 7_500_000,          // ₹75L — above ₹50L threshold
  onboarding_date: yearsAgo(4),  // 4 years ago — above 3-year threshold
  kyc_status: 'Verified',
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
// evaluateBeneficiaryUpdates()
// ---------------------------------------------------------------------------

describe('evaluateBeneficiaryUpdates()', () => {
  it('should flag client with AUM > ₹50L and onboarding > 3 years ago', async () => {
    const client = makeClient();
    const clientModel = makeClientModel([client]);

    const candidates = await evaluateBeneficiaryUpdates(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_id).toBe('C001');
    expect(candidates[0].total_aum).toBe(7_500_000);
  });

  it('should NOT flag client with AUM < ₹50L even if old', async () => {
    // The Mongoose query filters these out — model returns empty array
    const clientModel = makeClientModel([]);

    const candidates = await evaluateBeneficiaryUpdates(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(0);
    // Verify the find query was still invoked (the filter happens in DB)
    expect(clientModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ total_aum: { $gte: 5_000_000 } }),
      expect.anything(),
    );
  });

  it('should NOT flag client onboarded within 3 years', async () => {
    // The Mongoose query filters these out — model returns empty array
    const clientModel = makeClientModel([]);

    const candidates = await evaluateBeneficiaryUpdates(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(0);
    expect(clientModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ onboarding_date: expect.objectContaining({ $lte: expect.any(Date) }) }),
      expect.anything(),
    );
  });

  it('should only include Verified KYC clients', async () => {
    // The Mongoose query filters kyc_status — model returns empty for non-Verified
    const clientModel = makeClientModel([]);

    const candidates = await evaluateBeneficiaryUpdates(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(0);
    expect(clientModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ kyc_status: 'Verified' }),
      expect.anything(),
    );
  });

  it('should compute years_since_onboarding correctly', async () => {
    const client = makeClient({ onboarding_date: yearsAgo(5) });
    const clientModel = makeClientModel([client]);

    const candidates = await evaluateBeneficiaryUpdates(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].years_since_onboarding).toBe(5);
  });

  it('should return client_tier in result', async () => {
    const client = makeClient({ tier: 'UHNI' });
    const clientModel = makeClientModel([client]);

    const candidates = await evaluateBeneficiaryUpdates(clientModel as any, RM_ID);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].client_tier).toBe('UHNI');
  });
});

// ---------------------------------------------------------------------------
// buildBeneficiaryUpdateMessage()
// ---------------------------------------------------------------------------

describe('buildBeneficiaryUpdateMessage()', () => {
  const candidate: BeneficiaryUpdateCandidate = {
    client_id: 'C001',
    client_name: 'Priya Mehta',
    client_tier: 'HNI',
    total_aum: 7_500_000,
    onboarding_date: yearsAgo(4),
    years_since_onboarding: 4,
  };

  it('should include client name in message', () => {
    const msg = buildBeneficiaryUpdateMessage(candidate);
    expect(msg).toContain('Priya Mehta');
  });

  it('should include AUM formatted in Indian notation', () => {
    const msg = buildBeneficiaryUpdateMessage(candidate);
    expect(msg).toContain('75,00,000');
  });

  it('should include years_since_onboarding', () => {
    const msg = buildBeneficiaryUpdateMessage(candidate);
    expect(msg).toContain('4 years old');
  });

  it('should mention beneficiary nomination review', () => {
    const msg = buildBeneficiaryUpdateMessage(candidate);
    expect(msg).toContain('beneficiary nomination review');
  });
});

// ---------------------------------------------------------------------------
// BENEFICIARY_UPDATES_RULE constant
// ---------------------------------------------------------------------------

describe('BENEFICIARY_UPDATES_RULE constant', () => {
  it('should have rule_id RULE-BENEFICIARY-UPDATES', () => {
    expect(BENEFICIARY_UPDATES_RULE.rule_id).toBe('RULE-BENEFICIARY-UPDATES');
  });

  it('should have severity low', () => {
    expect(BENEFICIARY_UPDATES_RULE.severity).toBe('low');
  });

  it('should have cooldown_hours of 720 (30 days)', () => {
    expect(BENEFICIARY_UPDATES_RULE.cooldown_hours).toBe(720);
  });

  it('should have min_aum of 5,000,000', () => {
    expect(BENEFICIARY_UPDATES_RULE.conditions['min_aum']).toBe(5_000_000);
  });

  it('should have years_since_review of 3', () => {
    expect(BENEFICIARY_UPDATES_RULE.conditions['years_since_review']).toBe(3);
  });

  it('should NOT have a description field', () => {
    expect((BENEFICIARY_UPDATES_RULE as any).description).toBeUndefined();
  });
});
