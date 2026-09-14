import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { AuthUser } from '@pulsar/shared';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import type { RequestWithId } from '../middleware/request-id.middleware';

/**
 * One structured line per completed request: method, path, status, duration,
 * requestId, and tenant/user when authenticated. Skips `/health/*` (polled
 * frequently, would just be noise). Never logs bodies/headers/secrets.
 *
 * Logs from the response's `finish` event rather than the interceptor's
 * `tap`/`catchError` — by the time an exception filter has turned a thrown
 * error into a response, the interceptor's own error callback has already run
 * with the *pre-filter* status code, so `finish` is the only point where
 * `res.statusCode` is guaranteed final for both success and error paths.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<RequestWithId>();
    const response = httpContext.getResponse<Response>();

    if (request.path?.includes('/health/')) {
      return next.handle();
    }

    const start = Date.now();
    response.once('finish', () => {
      const user: AuthUser | undefined = (request as RequestWithId & { user?: AuthUser }).user;
      const durationMs = Date.now() - start;
      this.logger.log(
        `method=${request.method} path=${request.path} status=${response.statusCode} ` +
          `durationMs=${durationMs} requestId=${request.requestId ?? '-'} ` +
          `tenantId=${user?.tenantId ?? '-'} userId=${user?.id ?? '-'}`,
      );
    });

    return next.handle();
  }
}
