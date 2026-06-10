import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '@pulsar/shared';
import { Observable, tap } from 'rxjs';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { AUDIT_KEY, type AuditMeta } from '../decorators/audit.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogs: AuditLogsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    return next.handle().pipe(
      tap((result) => {
        if (!user) return;
        void this.auditLogs.log({
          tenantId: user.tenantId,
          // API-key principals are not User rows — keep the FK null for them.
          userId: user.id.startsWith('apikey:') ? undefined : user.id,
          action: meta.action,
          entityType: meta.entityType,
          entityId:
            result && typeof result === 'object' && 'id' in result
              ? String((result as { id: unknown }).id)
              : undefined,
        });
      }),
    );
  }
}
