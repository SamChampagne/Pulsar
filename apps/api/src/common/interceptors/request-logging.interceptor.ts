import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { AuthUser } from '@pulsar/shared';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import type { RequestWithId } from '../middleware/request-id.middleware';

/**
 * Public route prefixes whose NEXT path segment is a capability token
 * (inbound webhook token, portal/driver/tender/tracking link, unsubscribe
 * token). The token is a credential: it must never reach a log file.
 */
const TOKEN_PATH_PREFIXES = [
  'public/hooks',
  'public/portal',
  'public/driver',
  'public/tenders',
  'public/tracking',
  'public/carrier-portal',
  'public/rfp-invites',
  'public/crm/unsubscribe',
] as const;

const REDACTED = '<redacted>';

/**
 * Replaces a capability token embedded in a request path by `<redacted>`,
 * keeping everything else intact (`/api/v1/public/portal/<redacted>/orders`).
 * Pure — exported for testing and reusable by any other logging surface.
 */
export function redactTokenPath(path: string): string {
  if (!path) return path;
  for (const prefix of TOKEN_PATH_PREFIXES) {
    // Match the prefix wherever it sits (the global `api/v1` prefix is in front)
    // and redact ONLY the segment that follows it.
    const marker = `/${prefix}/`;
    const at = path.indexOf(marker);
    if (at === -1) continue;
    const start = at + marker.length;
    const end = path.indexOf('/', start);
    if (start === path.length) continue; // trailing slash, no token
    return end === -1
      ? `${path.slice(0, start)}${REDACTED}`
      : `${path.slice(0, start)}${REDACTED}${path.slice(end)}`;
  }
  return path;
}

/**
 * One structured line per completed request: method, path, status, duration,
 * requestId, and tenant/user when authenticated. Skips `/health/*` (polled
 * frequently, would just be noise). Never logs bodies/headers/secrets — and
 * capability tokens carried IN the path are redacted (`redactTokenPath`).
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
        `method=${request.method} path=${redactTokenPath(request.path)} status=${response.statusCode} ` +
          `durationMs=${durationMs} requestId=${request.requestId ?? '-'} ` +
          `tenantId=${user?.tenantId ?? '-'} userId=${user?.id ?? '-'}`,
      );
    });

    return next.handle();
  }
}
