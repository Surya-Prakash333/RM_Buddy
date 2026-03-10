import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * AuthGuard reads the X-RM-Identity header, decodes it (base64 JSON or raw JSON),
 * and attaches the parsed identity to `request['rmIdentity']`.
 *
 * The header format is: base64({"rm_id":"rm-001","name":"Arjun Shah"})
 * Raw JSON is also accepted as a fallback.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const headers = request['headers'] as Record<string, string | undefined>;
    const identityHeader = headers['x-rm-identity'];

    if (!identityHeader) {
      throw new UnauthorizedException('Missing X-RM-Identity header');
    }

    try {
      let identity: unknown;
      try {
        identity = JSON.parse(Buffer.from(identityHeader, 'base64').toString('utf-8'));
      } catch {
        identity = JSON.parse(identityHeader);
      }
      request['rmIdentity'] = identity;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid X-RM-Identity header');
    }
  }
}
