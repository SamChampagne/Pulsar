/**
 * Normalizes an actor id for `AuditLog.userId`.
 *
 * API-key principals are identified as `apikey:<id>` and are not `User` rows —
 * writing that string would break the FK, so the column stays null for them
 * (same convention as `AuditInterceptor`, which handles the declarative
 * `@Audit(...)` path).
 */
export function auditActor(actorId?: string): string | undefined {
  if (!actorId) return undefined;
  return actorId.startsWith('apikey:') ? undefined : actorId;
}
