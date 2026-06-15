// Pure, browser-safe. Mirrored in packages/database schema.prisma (fleet module).

export enum ComplianceSubject { VEHICLE = 'VEHICLE', TRAILER = 'TRAILER', DRIVER = 'DRIVER' }
export enum ComplianceDocType {
  REGISTRATION = 'REGISTRATION',
  INSURANCE = 'INSURANCE',
  INSPECTION = 'INSPECTION',
  LICENSE = 'LICENSE',
  MEDICAL = 'MEDICAL',
  OTHER = 'OTHER',
}

export type ComplianceStatus = 'VALID' | 'EXPIRING' | 'EXPIRED';

/** Expired if past; expiring if within `warnDays`; else valid. Pure. */
export function computeComplianceStatus(expiresAt: string | Date, now: number, warnDays = 30): ComplianceStatus {
  const exp = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt.getTime();
  if (exp < now) return 'EXPIRED';
  if (exp <= now + warnDays * 86_400_000) return 'EXPIRING';
  return 'VALID';
}
