import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * RBACGuard enforces role-based access on top of the already-authenticated
 * request populated by AuthGuard.
 *
 * Execution order: AuthGuard → RBACGuard
 * AuthGuard must run first because RBACGuard reads `request.rmIdentity`.
 *
 * Behaviour:
 *   - No @Roles() on the handler/class → allow all authenticated callers.
 *   - @Roles() present → identity.role must appear in the decorator's list.
 *   - Missing identity (AuthGuard skipped or failed silently) → ForbiddenException.
 *
 * Usage example:
 * ```typescript
 * @Get('branch/overview')
 * @UseGuards(AuthGuard, RBACGuard)
 * @Roles('BM', 'ADMIN')
 * async getBranchOverview(@RMIdentity() identity: RMIdentity) { ... }
 * ```
 */
@Injectable()
export class RBACGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(
      'roles',
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator — open to all authenticated callers.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const identity = request['rmIdentity'] as { role: string } | undefined;

    if (!identity) {
      throw new ForbiddenException('No identity found on request. Ensure AuthGuard runs before RBACGuard.');
    }

    if (!requiredRoles.includes(identity.role)) {
      throw new ForbiddenException(
        `Role ${identity.role} is not authorized to access this resource. Required: [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
