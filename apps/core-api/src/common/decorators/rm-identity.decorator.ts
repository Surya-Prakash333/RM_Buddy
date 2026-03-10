import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @RMIdentity() extracts the parsed RM identity object from the request,
 * which is populated by AuthGuard after decoding the X-RM-Identity header.
 *
 * Usage in a controller:
 *   @Get('profile')
 *   getProfile(@RMIdentity() identity: RmIdentityDto) { ... }
 */
export const RMIdentity = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    return request['rmIdentity'];
  },
);
