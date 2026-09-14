import type { Tone } from '$lib/components/ui';

export interface PaymentAllocation {
  id: string;
  targetType: 'CUSTOMER_INVOICE' | 'CARRIER_INVOICE';
  targetId: string;
  amount: string | number;
  target?: { id: string; invoiceNumber: string } | null;
}

export interface Payment {
  id: string;
  paymentNumber: string;
  type: 'RECEIVE' | 'PAY';
  partyType: 'CUSTOMER' | 'CARRIER';
  partyId: string;
  party?: { id: string; name: string } | null;
  date: string;
  totalAmount: string | number;
  currency: string;
  reference: string | null;
  note: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'CANCELLED';
  reconciledAt?: string | null;
  modeOfPayment: { id: string; name: string } | null;
  allocations: PaymentAllocation[];
}

export interface OpenInvoice {
  id: string;
  invoiceNumber: string;
  totalAmount: string | number;
  amountPaid: string | number;
  currency: string;
  targetType: PaymentAllocation['targetType'];
  outstanding: string | number;
}

export const paymentStatusLabel = {
  DRAFT: 'Brouillon',
  SUBMITTED: 'Comptabilisé',
  CANCELLED: 'Annulé',
};
export const paymentStatusTone: Record<Payment['status'], Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'ok',
  CANCELLED: 'neutral',
};
export const paymentTypeLabel = { RECEIVE: 'Encaissement', PAY: 'Décaissement' };

export function invoiceHref(targetType: PaymentAllocation['targetType'], id: string) {
  return `/invoices?${targetType === 'CUSTOMER_INVOICE' ? 'statement' : 'invoice'}=${encodeURIComponent(id)}`;
}

/** Display only: the ledger posts allocated amounts, not an unallocated balance. */
export function postedPaymentTotals(payments: Payment[]) {
  const totals = new Map<string, { currency: string; received: number; paid: number }>();
  for (const payment of payments) {
    if (payment.status !== 'SUBMITTED') continue;
    const row = totals.get(payment.currency) ?? {
      currency: payment.currency,
      received: 0,
      paid: 0,
    };
    const amount = payment.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
    if (payment.type === 'RECEIVE') row.received += amount;
    else row.paid += amount;
    totals.set(payment.currency, row);
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
