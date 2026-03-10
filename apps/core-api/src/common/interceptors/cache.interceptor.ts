import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CacheService } from '../../modules/cache/cache.service';

/** Cache TTL for GET responses: 5 minutes */
const HTTP_CACHE_TTL_SECONDS = 300;

/**
 * Minimal typings for the HTTP request/response objects used here.
 * We avoid importing @types/express directly so the interceptor compiles
 * without that optional dev dependency.
 */
interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

interface HttpResponse {
  setHeader(name: string, value: string): void;
}

/**
 * HTTP-level caching interceptor.
 *
 * - Caches GET responses keyed by `http:{url}:rm:{rmId}`.
 * - Skips caching for non-GET methods.
 * - Sets `X-Cache: HIT` or `X-Cache: MISS` on every matched response.
 * - Reads the RM identity from the `x-rm-identity` request header,
 *   which carries a base64-encoded JSON object with an `rm_id` field.
 *
 * Example header value: base64({"rm_id":"rm-001","name":"Arjun"})
 */
@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpCacheInterceptor.name);

  constructor(private readonly cacheService: CacheService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();

    // Only cache GET requests
    if (request.method !== 'GET') {
      return next.handle();
    }

    const rmId = this.extractRmId(request);
    const cacheKey = `http:${request.url}:rm:${rmId ?? 'anonymous'}`;

    // Attempt cache lookup
    const cached = await this.cacheService.get<unknown>(cacheKey);
    if (cached !== null) {
      response.setHeader('X-Cache', 'HIT');
      this.logger.debug(`HTTP cache HIT: ${cacheKey}`);
      return of(cached);
    }

    response.setHeader('X-Cache', 'MISS');
    this.logger.debug(`HTTP cache MISS: ${cacheKey}`);

    // On response, store the result in Redis
    return next.handle().pipe(
      tap(async (data: unknown) => {
        if (data !== null && data !== undefined) {
          await this.cacheService.set(cacheKey, data, HTTP_CACHE_TTL_SECONDS);
        }
      }),
    );
  }

  /**
   * Decode the `x-rm-identity` header (base64 JSON) and extract `rm_id`.
   * Returns null when the header is absent or malformed.
   */
  private extractRmId(request: HttpRequest): string | null {
    const header = request.headers['x-rm-identity'];
    if (!header || typeof header !== 'string') {
      return null;
    }

    try {
      const decoded = Buffer.from(header, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded) as Record<string, unknown>;
      const rmId = parsed['rm_id'];
      return typeof rmId === 'string' ? rmId : null;
    } catch {
      this.logger.warn(`Failed to decode x-rm-identity header: ${header}`);
      return null;
    }
  }
}
