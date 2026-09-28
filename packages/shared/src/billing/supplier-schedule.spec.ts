import { describe, it, expect } from 'vitest';
import {
  canTransitionSupplierSchedule as transition,
  validateSupplierSchedule as validate,
  supplierScheduleBucket as bucket,
  SupplierScheduleStatus as S,
} from './supplier-schedule';
const input = () => ({
  status: S.CONFIRMED,
  note: 'Plan convenu avec le fournisseur',
  installments: [
    { dueDate: '2026-09-27', amount: '0.10', note: '' },
    { dueDate: '2026-10-01', amount: '0.20', note: 'Solde' },
  ],
});
describe('supplier schedules', () => {
  it('sums exact cents and never applies a payment or currency conversion', () =>
    expect(validate(input(), '0.30', '2026-09-26').installments[0].amount).toBe('0.10'));
  it.each(['0.29', '0.31'])('requires the full remaining amount %s', (n) =>
    expect(() => validate(input(), n, '2026-09-26')).toThrow('exactement'),
  );
  it.each(['2026-02-30', '1899-12-31', '2200-01-01', '2026-09-25'])(
    'rejects invalid or pre-invoice date %s',
    (dueDate) => {
      const d = input();
      d.installments[0].dueDate = dueDate;
      expect(() => validate(d, '0.30', '2026-09-26')).toThrow();
    },
  );
  it('rejects repeated or unordered dates', () => {
    const d = input();
    d.installments[1].dueDate = d.installments[0].dueDate;
    expect(() => validate(d, '0.30', '2026-09-26')).toThrow();
  });
  it.each(['0', '-1', '1e2', '0.001'])('rejects invalid installment amount %s', (amount) => {
    const d = input();
    d.installments[0].amount = amount;
    expect(() => validate(d, '0.30', '2026-09-26')).toThrow();
  });
  it('requires no installments for a fully credited document', () => {
    expect(validate({ ...input(), installments: [] }, '0.00', '2026-09-26').installments).toEqual(
      [],
    );
    expect(() => validate(input(), '0.00', '2026-09-26')).toThrow();
  });
  it('withdraws without inventing zero installments or forgiving a balance', () => {
    expect(
      validate({ ...input(), status: S.WITHDRAWN, installments: [] }, '2.00', '2026-09-26').status,
    ).toBe(S.WITHDRAWN);
    expect(() => validate({ ...input(), status: S.WITHDRAWN }, '2.00', '2026-09-26')).toThrow();
  });
  it('uses explicit append-only revision transitions', () => {
    expect(transition(null, 'CONFIRMED')).toBe(true);
    expect(transition(null, 'WITHDRAWN')).toBe(false);
    expect(transition('CONFIRMED', 'CONFIRMED')).toBe(true);
    expect(transition('WITHDRAWN', 'CONFIRMED')).toBe(true);
    expect(transition('WITHDRAWN', 'WITHDRAWN')).toBe(false);
    expect(transition('PAID', 'CONFIRMED')).toBe(false);
  });
  it.each([
    ['2026-09-26', 'OVERDUE'],
    ['2026-09-27', 'TODAY'],
    ['2026-10-04', 'WITHIN_7'],
    ['2026-10-05', 'WITHIN_30'],
    ['2026-10-27', 'WITHIN_30'],
    ['2026-10-28', 'LATER'],
  ])('classifies civil date %s', (date, result) => expect(bucket(date, '2026-09-27')).toBe(result));
});
