import { CustomerInvoiceStatus } from '../enums/billing';

// Deleting a DRAFT is NOT a transition — it is a DELETE that frees the orders
// (see spec invariant 2). APPROVED+ statements are immutable.
export const CUSTOMER_INVOICE_TRANSITIONS: Record<CustomerInvoiceStatus, CustomerInvoiceStatus[]> = {
  [CustomerInvoiceStatus.DRAFT]: [CustomerInvoiceStatus.APPROVED],
  [CustomerInvoiceStatus.APPROVED]: [CustomerInvoiceStatus.SENT],
  [CustomerInvoiceStatus.SENT]: [CustomerInvoiceStatus.PAID],
  [CustomerInvoiceStatus.PAID]: [],
};

export function canTransitionCustomerInvoice(
  from: CustomerInvoiceStatus,
  to: CustomerInvoiceStatus,
): boolean {
  return CUSTOMER_INVOICE_TRANSITIONS[from]?.includes(to) ?? false;
}
