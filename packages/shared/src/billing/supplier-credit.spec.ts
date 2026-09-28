import { describe, it, expect } from 'vitest';
import {
  canTransitionSupplierCredit,
  supplierCreditBalance,
  supplierCreditTotals,
  validateSupplierCredit,
} from './supplier-credit';
const invoice = {
  lines: [
    { id: 'a', netAmount: '10.10' },
    { id: 'b', netAmount: '2.20' },
  ],
  taxes: [
    { label: 'Taxe', amount: '0.30' },
    { label: 'Taxe', amount: '0.40' },
  ],
};
const credit = {
  lines: [{ invoiceLineId: 'a', netAmount: '0.10' }],
  taxes: [{ position: 0, amount: '0.10' }],
};
describe('Supplier documentary credits', () => {
  it('uses exact cents and preserves duplicate tax labels by position', () => {
    const b = supplierCreditBalance(invoice, [credit, credit, credit]);
    expect(b.credited).toBe('0.60');
    expect(b.remaining).toBe('12.40');
    expect(b.taxes[0].remaining).toBe('0.00');
    expect(b.taxes[1].remaining).toBe('0.40');
  });
  it('allows tax-only credits without inventing net allocation', () =>
    expect(
      supplierCreditTotals({ lines: [], taxes: [{ position: 0, amount: '0.10' }] }).totalAmount,
    ).toBe('0.10'));
  it('allows a credit equal to the full balance', () =>
    expect(
      supplierCreditBalance(invoice, [
        {
          lines: [
            { invoiceLineId: 'a', netAmount: '10.10' },
            { invoiceLineId: 'b', netAmount: '2.20' },
          ],
          taxes: [
            { position: 0, amount: '0.30' },
            { position: 1, amount: '0.40' },
          ],
        },
      ]).remaining,
    ).toBe('0.00'));
  it.each(['-1', '0.001', '1e2', 'NaN', '10000000000', '1,25'])(
    'rejects invalid amount %s',
    (netAmount) =>
      expect(() =>
        supplierCreditTotals({ lines: [{ invoiceLineId: 'a', netAmount }], taxes: [] }),
      ).toThrow(),
  );
  it('rejects zero and total overflow', () => {
    expect(() => supplierCreditTotals({ lines: [], taxes: [] })).toThrow();
    expect(() =>
      supplierCreditTotals({
        lines: [
          { invoiceLineId: 'a', netAmount: '9999999999.99' },
          { invoiceLineId: 'b', netAmount: '0.01' },
        ],
        taxes: [],
      }),
    ).toThrow();
  });
  it('rejects duplicate references', () => {
    expect(() =>
      supplierCreditTotals({ ...credit, lines: [...credit.lines, ...credit.lines] }),
    ).toThrow();
    expect(() =>
      supplierCreditTotals({ ...credit, taxes: [...credit.taxes, ...credit.taxes] }),
    ).toThrow();
  });
  it('rejects foreign lines and tax components', () => {
    expect(() =>
      supplierCreditBalance(invoice, [
        { lines: [{ invoiceLineId: 'x', netAmount: '1' }], taxes: [] },
      ]),
    ).toThrow();
    expect(() =>
      supplierCreditBalance(invoice, [{ lines: [], taxes: [{ position: 3, amount: '1' }] }]),
    ).toThrow();
  });
  it('enforces component caps even when the total fits', () => {
    expect(() =>
      supplierCreditBalance(invoice, [
        { lines: [{ invoiceLineId: 'b', netAmount: '2.21' }], taxes: [] },
      ]),
    ).toThrow();
    expect(() => supplierCreditBalance(invoice, [credit, credit, credit, credit])).toThrow();
  });
  it('validates dates and an explicit reason', () => {
    const d = {
      ...credit,
      invoiceId: 'i',
      externalNumber: 'AV 1',
      creditDate: '2026-09-26',
      reason: 'Rabais commercial déclaré',
    };
    expect(validateSupplierCredit(d).totalAmount).toBe('0.20');
    expect(() => validateSupplierCredit({ ...d, creditDate: '2026-02-30' })).toThrow();
    expect(() => validateSupplierCredit({ ...d, reason: ' ' })).toThrow();
  });
  it('never reopens qualified or cancelled documents', () => {
    expect(canTransitionSupplierCredit('DRAFT', 'QUALIFIED')).toBe(true);
    expect(canTransitionSupplierCredit('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransitionSupplierCredit('QUALIFIED', 'DRAFT')).toBe(false);
    expect(canTransitionSupplierCredit('CANCELLED', 'QUALIFIED')).toBe(false);
  });
});
