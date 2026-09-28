import { describe, expect, it } from 'vitest';
import {
  paymentAllocationAmounts,
  reconcilePaymentLedger,
  reversePaymentLedger,
} from './payment-ledger';
const lines = [
  { accountCode: '1010', debit: '12.34', credit: '0' },
  { accountCode: '1100', debit: '0', credit: '12.34' },
];
const source = { total: '12.34', allocations: ['2.01', '10.33'], lines };
describe('Payment ledger recovery', () => {
  it('matches exact allocations and reverses original accounts', () => {
    const reversal = reversePaymentLedger(lines);
    expect(reversal[0]).toEqual({ accountCode: '1010', debit: '0.00', credit: '12.34' });
    expect(reconcilePaymentLedger({ ...source, reversal: [...reversal].reverse() })).toEqual({
      total: '12.34',
      allocationCount: 2,
      allocatedAmount: '12.34',
      unallocatedAmount: '0.00',
      allocationState: 'FULL',
    });
  });
  it('rejects fractional cents, excessive or empty allocations and unbalanced entries', () => {
    for (const change of [
      { allocations: ['12.33'] },
      { allocations: ['12.341'] },
      { allocations: ['-1', '13.34'] },
      { total: '12' },
      { allocations: [] },
      { allocations: ['0'] },
      { lines: [lines[0]] },
      { lines: [lines[0], { ...lines[1], credit: '12.33' }] },
    ])
      expect(() => reconcilePaymentLedger({ ...source, ...change })).toThrow();
  });
  it('qualifies only the allocation-sized posting of a partial payment', () => {
    expect(
      reconcilePaymentLedger({ ...source, total: '15.01', reversal: reversePaymentLedger(lines) }),
    ).toEqual({
      total: '15.01',
      allocatedAmount: '12.34',
      unallocatedAmount: '2.67',
      allocationCount: 2,
      allocationState: 'PARTIAL',
    });
    const fullPosting = lines.map((l, i) => ({
      ...l,
      debit: i ? '0' : '15.01',
      credit: i ? '15.01' : '0',
    }));
    expect(() => reconcilePaymentLedger({ ...source, total: '15.01', lines: fullPosting })).toThrow(
      'total affecté',
    );
    expect(() =>
      reconcilePaymentLedger({
        ...source,
        total: '15.01',
        reversal: reversePaymentLedger(fullPosting),
      }),
    ).toThrow('comptes originaux');
  });
  it('keeps very small allocations and large remainders exact without inventing a credit', () => {
    expect(paymentAllocationAmounts('9999999999.99', ['0.01', '0.02'])).toMatchObject({
      allocatedAmount: '0.03',
      unallocatedAmount: '9999999999.96',
      allocationState: 'PARTIAL',
    });
    expect(() => paymentAllocationAmounts('15.001', ['12'])).toThrow();
  });
  it('rejects a balanced reversal on the wrong accounts or amounts', () => {
    expect(() =>
      reconcilePaymentLedger({
        ...source,
        reversal: reversePaymentLedger(lines).map((l, i) =>
          i ? l : { ...l, accountCode: '1000' },
        ),
      }),
    ).toThrow('comptes originaux');
    expect(() => reconcilePaymentLedger({ ...source, reversal: lines })).toThrow(
      'comptes originaux',
    );
  });
  it('handles exact large cents and split reversals without floating-point arithmetic', () => {
    const amount = '9999999999.99';
    expect(
      reconcilePaymentLedger({
        total: amount,
        allocations: [amount],
        lines: lines.map((l, i) => ({ ...l, debit: i ? '0' : amount, credit: i ? amount : '0' })),
      }).total,
    ).toBe(amount);
    expect(
      reconcilePaymentLedger({
        ...source,
        reversal: [
          { accountCode: '1010', credit: '12.34', debit: '0' },
          { accountCode: '1100', credit: '0', debit: '2' },
          { accountCode: '1100', credit: '0', debit: '10.34' },
        ],
      }).total,
    ).toBe('12.34');
  });
});
