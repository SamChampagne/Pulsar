import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from '@pulsar/shared';

export const AUDIT_KEY = 'auditMeta';

export interface AuditMeta {
  entityType: string;
  action: AuditAction;
}

/**
 * Declarative audit: logs the action with the response's `id` as entityId
 * after the handler succeeds (see AuditInterceptor). Workflow services keep
 * their explicit AuditLogsService calls (they record before/after state).
 */
export const Audit = (entityType: string, action: AuditAction) =>
  SetMetadata(AUDIT_KEY, { entityType, action } satisfies AuditMeta);
