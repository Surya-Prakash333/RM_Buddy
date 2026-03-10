import { Injectable } from '@nestjs/common';
import { RMIdentity } from '../sso/sso.types';

/**
 * RBACService encapsulates all role-based access control logic for the RM Buddy
 * platform. It is consumed by:
 *   - core-api guards (via the shared identity already in the request)
 *   - agent-orchestrator when scoping MongoDB queries
 *
 * Scope rules:
 *   RM    — sees only own clients      → filter { rm_id: identity.rm_id }
 *   BM    — sees all RMs in own branch → filter { rm_branch: identity.rm_branch }
 *   ADMIN — unrestricted               → filter {}
 */
@Injectable()
export class RBACService {
  /**
   * Build a MongoDB query filter that limits the result set to the records
   * the given identity is authorised to see.
   *
   * @param identity  Validated RMIdentity attached to the current request.
   * @returns         A plain object suitable for use as a Mongoose query filter.
   */
  getScopeFilter(identity: RMIdentity): Record<string, unknown> {
    switch (identity.role) {
      case 'RM':
        return { rm_id: identity.rm_id };
      case 'BM':
        return { rm_branch: identity.rm_branch };
      case 'ADMIN':
        return {};
    }
  }

  /**
   * Determine whether the given identity may read data belonging to
   * `targetRmId`.
   *
   * @param identity    The requesting RM's identity.
   * @param targetRmId  The rm_id whose data is being accessed.
   * @param targetRmBranch
   *   Optional branch of the target RM. Required for a BM doing a same-branch
   *   check when the target RM's branch is not already known from context.
   *   If omitted for a BM, access is granted as long as we cannot disprove
   *   same-branch membership (callers that know the branch should always pass
   *   it so the check is authoritative).
   */
  canAccessRM(
    identity: RMIdentity,
    targetRmId: string,
    targetRmBranch?: string,
  ): boolean {
    switch (identity.role) {
      case 'ADMIN':
        return true;

      case 'RM':
        // RMs may only access their own data.
        return identity.rm_id === targetRmId;

      case 'BM':
        // BMs may access any RM in the same branch.
        // If the caller provides the target's branch we can do an authoritative
        // check; otherwise we fall back to allowing access (the calling layer is
        // expected to scope the query with getScopeFilter).
        if (targetRmBranch !== undefined) {
          return identity.rm_branch === targetRmBranch;
        }
        // No branch info provided — allow; enforcement is the caller's
        // responsibility via getScopeFilter.
        return true;
    }
  }

  /**
   * Check whether the identity holds at least one of the `requiredRoles`.
   *
   * @param identity       The requesting RM's identity.
   * @param requiredRoles  List of role strings the endpoint accepts.
   */
  hasRole(identity: RMIdentity, requiredRoles: string[]): boolean {
    return requiredRoles.includes(identity.role);
  }

  /**
   * Return the list of rm_ids this identity is authorised to query in batch
   * operations.
   *
   * @param identity         The requesting RM's identity.
   * @param allBranchRMIds   Pre-loaded list of all rm_ids in the identity's
   *                         branch. Required only for BM identities; ignored
   *                         for RM and ADMIN.
   * @returns                Array of allowed rm_ids, or `null` for ADMIN
   *                         (unrestricted — no IN-clause needed).
   */
  getAllowedRMIds(
    identity: RMIdentity,
    allBranchRMIds?: string[],
  ): string[] | null {
    switch (identity.role) {
      case 'ADMIN':
        return null;

      case 'RM':
        return [identity.rm_id];

      case 'BM':
        // Return the caller-supplied branch list when available; otherwise
        // return an empty array to fail-safe (the caller must supply the list
        // for batch queries to be meaningful).
        return allBranchRMIds ?? [];
    }
  }
}
