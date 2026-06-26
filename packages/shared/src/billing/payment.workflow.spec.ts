import { describe, it, expect } from 'vitest';
import { PaymentStatus, canTransitionPayment, isPaymentOpen } from './payment.workflow';

describe('canTransitionPayment', () => {
  it('DRAFT → SUBMITTED and DRAFT → CANCELLED', () => {
    expect(canTransitionPayment(PaymentStatus.DRAFT, PaymentStatus.SUBMITTED)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.DRAFT, PaymentStatus.CANCELLED)).toBe(true);
  });
  it('SUBMITTED → CANCELLED only', () => {
    expect(canTransitionPayment(PaymentStatus.SUBMITTED, PaymentStatus.CANCELLED)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.SUBMITTED, PaymentStatus.DRAFT)).toBe(false);
  });
  it('CANCELLED is terminal', () => {
    expect(canTransitionPayment(PaymentStatus.CANCELLED, PaymentStatus.SUBMITTED)).toBe(false);
    expect(canTransitionPayment(PaymentStatus.CANCELLED, PaymentStatus.DRAFT)).toBe(false);
  });
  it('isPaymentOpen true only for DRAFT/SUBMITTED', () => {
    expect(isPaymentOpen(PaymentStatus.DRAFT)).toBe(true);
    expect(isPaymentOpen(PaymentStatus.SUBMITTED)).toBe(true);
    expect(isPaymentOpen(PaymentStatus.CANCELLED)).toBe(false);
  });
});
