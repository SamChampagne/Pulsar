// Pure, browser-safe. No Node imports.
export enum PaymentType {
  RECEIVE = 'RECEIVE',
  PAY = 'PAY',
}

export enum PaymentStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentPartyType {
  CUSTOMER = 'CUSTOMER',
  CARRIER = 'CARRIER',
}

export enum PaymentTargetType {
  CUSTOMER_INVOICE = 'CUSTOMER_INVOICE',
  CARRIER_INVOICE = 'CARRIER_INVOICE',
}

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.DRAFT]: [PaymentStatus.SUBMITTED, PaymentStatus.CANCELLED],
  [PaymentStatus.SUBMITTED]: [PaymentStatus.CANCELLED],
  [PaymentStatus.CANCELLED]: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Open = not in a terminal state (CANCELLED). */
export function isPaymentOpen(s: PaymentStatus): boolean {
  return s !== PaymentStatus.CANCELLED;
}
