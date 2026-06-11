/** Billing module enums. Source of truth; mirrored in the Prisma schema. */
export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  DISPUTED = 'DISPUTED',
  PAID = 'PAID',
}

/**
 * Codified dispute reasons — the basis for future per-carrier variance stats.
 * Deliberately NOT set automatically when a reconciliation lands in DISPUTED:
 * the code qualifies the human diagnosis at resolution time, and a wrong
 * automatic default would pollute exactly those statistics.
 */
export enum DisputeReasonCode {
  RATE_MISMATCH = 'RATE_MISMATCH',
  QUANTITY_MISMATCH = 'QUANTITY_MISMATCH',
  UNEXPECTED_CHARGE = 'UNEXPECTED_CHARGE',
  DUPLICATE_BILLING = 'DUPLICATE_BILLING',
  OTHER = 'OTHER',
}
