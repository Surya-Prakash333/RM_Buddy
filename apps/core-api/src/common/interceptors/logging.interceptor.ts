import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  rmIdentity?: { rm_id?: string };
}

/**
 * LoggingInterceptor emits a structured log line for every HTTP request:
 *   - HTTP method and URL
 *   - rm_id extracted from the decoded X-RM-Identity (if present)
 *   - Response time in milliseconds
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const { method, url } = request;
    const rmId = request.rmIdentity?.rm_id ?? 'anonymous';
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const elapsedMs = Date.now() - startedAt;
        this.logger.log(`${method} ${url} rm_id=${rmId} +${elapsedMs}ms`);
      }),
    );
  }
}
