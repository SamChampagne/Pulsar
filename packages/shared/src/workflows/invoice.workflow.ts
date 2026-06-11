import { InvoiceStatus } from '../enums/billing';

export const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  // reconcile() routes DRAFT to APPROVED (within tolerance) or DISPUTED.
  [InvoiceStatus.DRAFT]: [InvoiceStatus.APPROVED, InvoiceStatus.DISPUTED],
  // resolve-dispute or a corrected-invoice re-reconcile; staying DISPUTED is a no-op.
  [InvoiceStatus.DISPUTED]: [InvoiceStatus.APPROVED],
  [InvoiceStatus.APPROVED]: [InvoiceStatus.PAID],
  [InvoiceStatus.PAID]: [],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from]?.includes(to) ?? false;
}
