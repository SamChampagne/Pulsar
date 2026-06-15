// Pure. Mirrored in packages/database schema.prisma (phase 16).

export enum FreightAuditStatus {
  RECEIVED = 'RECEIVED',
  MATCHED = 'MATCHED',
  FLAGGED = 'FLAGGED',
  DISPUTED = 'DISPUTED',
  RESOLVED = 'RESOLVED',
  PAID = 'PAID',
}

const TRANSITIONS: Record<FreightAuditStatus, FreightAuditStatus[]> = {
  [FreightAuditStatus.RECEIVED]: [FreightAuditStatus.MATCHED, FreightAuditStatus.FLAGGED],
  [FreightAuditStatus.MATCHED]: [FreightAuditStatus.PAID],
  [FreightAuditStatus.FLAGGED]: [FreightAuditStatus.DISPUTED, FreightAuditStatus.RESOLVED, FreightAuditStatus.MATCHED],
  [FreightAuditStatus.DISPUTED]: [FreightAuditStatus.RESOLVED],
  [FreightAuditStatus.RESOLVED]: [FreightAuditStatus.PAID],
  [FreightAuditStatus.PAID]: [],
};

/** Re-audit from FLAGGED back to MATCHED/FLAGGED is allowed (a corrected invoice). */
export function canTransitionFreightAudit(from: FreightAuditStatus, to: FreightAuditStatus): boolean {
  if (from === to) return true; // re-audit / idempotent no-op
  return (TRANSITIONS[from] ?? []).includes(to);
}
