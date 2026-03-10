import { SetMetadata } from '@nestjs/common';

/**
 * @Roles() is a metadata decorator consumed by RBACGuard to restrict an
 * endpoint to a specific set of roles.
 *
 * Pass one or more of: 'RM' | 'BM' | 'ADMIN'
 *
 * Usage examples:
 *
 * ```typescript
 * // Only Branch Managers and Admins may access this route:
 * @Get('branch/overview')
 * @UseGuards(AuthGuard, RBACGuard)
 * @Roles('BM', 'ADMIN')
 * async getBranchOverview() { ... }
 *
 * // All three roles may access this route (same as omitting @Roles):
 * @Get('profile')
 * @UseGuards(AuthGuard, RBACGuard)
 * @Roles('RM', 'BM', 'ADMIN')
 * async getProfile() { ... }
 * ```
 *
 * If @Roles() is omitted, RBACGuard allows any authenticated caller through.
 */
export const ROLES_KEY = 'roles';

export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
