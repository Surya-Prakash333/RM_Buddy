import { Test, TestingModule } from '@nestjs/testing';
import { RBACService } from '../rbac.service';
import { RMIdentity } from '../../sso/sso.types';

/**
 * Unit tests for RBACService.
 *
 * The service is stateless (no infrastructure dependencies), so the module
 * setup is minimal — just RBACService provided directly.
 */

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function buildRMIdentity(overrides: Partial<RMIdentity> = {}): RMIdentity {
  return {
    rm_id: 'RM001',
    rm_name: 'Rajesh Kumar',
    rm_code: 'RK001',
    rm_email: 'rajesh.kumar@nuvama.com',
    rm_branch: 'Mumbai-BKC',
    rm_region: 'West',
    role: 'RM',
    client_count: 20,
    session_id: 'test-session-001',
    token_expires: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

const RM_IDENTITY = buildRMIdentity();

const BM_IDENTITY = buildRMIdentity({
  rm_id: 'RM003',
  rm_name: 'Vikram Nair',
  rm_code: 'VN003',
  rm_email: 'vikram.nair@nuvama.com',
  role: 'BM',
  client_count: 0,
});

const ADMIN_IDENTITY = buildRMIdentity({
  rm_id: 'RM_ADMIN',
  rm_name: 'Admin User',
  rm_code: 'AD000',
  rm_email: 'admin@nuvama.com',
  rm_branch: 'HQ',
  rm_region: 'All',
  role: 'ADMIN',
  client_count: 0,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('RBACService', () => {
  let service: RBACService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RBACService],
    }).compile();

    service = module.get<RBACService>(RBACService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getScopeFilter
  // -------------------------------------------------------------------------

  describe('getScopeFilter', () => {
    it('returns { rm_id } filter for RM role', () => {
      const filter = service.getScopeFilter(RM_IDENTITY);
      expect(filter).toEqual({ rm_id: 'RM001' });
    });

    it('returns { rm_branch } filter for BM role', () => {
      const filter = service.getScopeFilter(BM_IDENTITY);
      expect(filter).toEqual({ rm_branch: 'Mumbai-BKC' });
    });

    it('returns empty filter for ADMIN role', () => {
      const filter = service.getScopeFilter(ADMIN_IDENTITY);
      expect(filter).toEqual({});
    });

    it('RM filter uses the exact rm_id from identity', () => {
      const custom = buildRMIdentity({ rm_id: 'RM042' });
      expect(service.getScopeFilter(custom)).toEqual({ rm_id: 'RM042' });
    });

    it('BM filter uses the exact rm_branch from identity', () => {
      const custom = buildRMIdentity({ role: 'BM', rm_branch: 'Delhi-CP' });
      expect(service.getScopeFilter(custom)).toEqual({ rm_branch: 'Delhi-CP' });
    });
  });

  // -------------------------------------------------------------------------
  // canAccessRM
  // -------------------------------------------------------------------------

  describe('canAccessRM', () => {
    it('RM can access own rm_id', () => {
      expect(service.canAccessRM(RM_IDENTITY, 'RM001')).toBe(true);
    });

    it('RM cannot access another RM\'s rm_id', () => {
      expect(service.canAccessRM(RM_IDENTITY, 'RM002')).toBe(false);
    });

    it('BM can access an RM in the same branch (targetRmBranch matches)', () => {
      expect(service.canAccessRM(BM_IDENTITY, 'RM001', 'Mumbai-BKC')).toBe(true);
    });

    it('BM cannot access an RM in a different branch', () => {
      expect(service.canAccessRM(BM_IDENTITY, 'RM002', 'Delhi-CP')).toBe(false);
    });

    it('BM defaults to allowing access when targetRmBranch is omitted', () => {
      // Without branch context, canAccessRM cannot disprove same-branch
      // membership — the caller is responsible for scoping via getScopeFilter.
      expect(service.canAccessRM(BM_IDENTITY, 'RM_ANY')).toBe(true);
    });

    it('ADMIN can access any rm_id', () => {
      expect(service.canAccessRM(ADMIN_IDENTITY, 'RM001')).toBe(true);
      expect(service.canAccessRM(ADMIN_IDENTITY, 'RM999')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // hasRole
  // -------------------------------------------------------------------------

  describe('hasRole', () => {
    it('returns true when identity role is in the required roles list', () => {
      expect(service.hasRole(RM_IDENTITY, ['RM'])).toBe(true);
    });

    it('returns false when identity role is NOT in the required roles list', () => {
      expect(service.hasRole(RM_IDENTITY, ['BM', 'ADMIN'])).toBe(false);
    });

    it('returns true for BM when BM is in the required roles list', () => {
      expect(service.hasRole(BM_IDENTITY, ['BM', 'ADMIN'])).toBe(true);
    });

    it('returns true for ADMIN when ADMIN is in the required roles list', () => {
      expect(service.hasRole(ADMIN_IDENTITY, ['ADMIN'])).toBe(true);
    });

    it('returns false for empty required roles list', () => {
      expect(service.hasRole(RM_IDENTITY, [])).toBe(false);
    });

    it('returns true when identity role appears anywhere in a multi-role list', () => {
      expect(service.hasRole(RM_IDENTITY, ['BM', 'RM', 'ADMIN'])).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getAllowedRMIds
  // -------------------------------------------------------------------------

  describe('getAllowedRMIds', () => {
    it('returns [rm_id] for RM role', () => {
      expect(service.getAllowedRMIds(RM_IDENTITY)).toEqual(['RM001']);
    });

    it('returns null for ADMIN role (unrestricted)', () => {
      expect(service.getAllowedRMIds(ADMIN_IDENTITY)).toBeNull();
    });

    it('returns the supplied allBranchRMIds array for BM role', () => {
      const branchRMs = ['RM001', 'RM003', 'RM007'];
      expect(service.getAllowedRMIds(BM_IDENTITY, branchRMs)).toEqual(branchRMs);
    });

    it('returns empty array for BM when allBranchRMIds is omitted (fail-safe)', () => {
      expect(service.getAllowedRMIds(BM_IDENTITY)).toEqual([]);
    });

    it('RM getAllowedRMIds ignores the allBranchRMIds argument', () => {
      const result = service.getAllowedRMIds(RM_IDENTITY, ['RM001', 'RM002', 'RM003']);
      expect(result).toEqual(['RM001']);
    });

    it('ADMIN getAllowedRMIds returns null regardless of allBranchRMIds', () => {
      expect(service.getAllowedRMIds(ADMIN_IDENTITY, ['RM001', 'RM002'])).toBeNull();
    });
  });
});
