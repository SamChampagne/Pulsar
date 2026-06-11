/**
 * Core platform enums. These are the source of truth; the Prisma schema mirrors
 * them with identical value names (keep both in sync when adding values).
 */
export enum TenantStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum UserStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum IntegrationStatus {
  DISABLED = 'DISABLED',
  ENABLED = 'ENABLED',
  ERROR = 'ERROR',
}

export enum NotificationLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  STATUS_CHANGE = 'STATUS_CHANGE',
  LOGIN = 'LOGIN',
}

/** Platform-plane operators (cross-tenant). Mirrored in schema.prisma. */
export enum PlatformUserStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}
