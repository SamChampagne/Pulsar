import { describe, it, expect } from 'vitest';
import {
  canTransitionSupplierInvoice,
  supplierInvoiceNumberKey,
  supplierInvoiceTotals,
  validateSupplierInvoice,
} from './supplier-invoice';
const draft = () => ({
  supplierId: 'supplier',
  externalNumber: 'FV-1',
  invoiceDate: '2026-09-26',
  currency: 'CAD',
  notes: '',
  lines: [{ description: 'Service', quantity: '1.2500', unit: 'h', netAmount: '0.10' }],
  taxes: [{ label: 'Taxe déclarée', amount: '0.20' }],
});
describe('Supplier invoice documentary contract', () => {
  it('sums cents exactly without inferring a tax rate or unit price', () =>
    expect(validateSupplierInvoice(draft())).toEqual({
      netAmount: '0.10',
      taxAmount: '0.20',
      totalAmount: '0.30',
    }));
  it('supports more than three named tax components', () =>
    expect(
      supplierInvoiceTotals({
        ...draft(),
        taxes: Array.from({ length: 10 }, () => ({ label: 'Taxe', amount: '0.01' })),
      }).totalAmount,
    ).toBe('0.20'));
  it.each(['-1', '0.001', '1e2', '1,20', '10000000000', 'NaN'])(
    'rejects invalid amounts %s',
    (netAmount) =>
      expect(() =>
        validateSupplierInvoice({ ...draft(), lines: [{ ...draft().lines[0], netAmount }] }),
      ).toThrow(),
  );
  it('rejects overflow instead of rounding', () =>
    expect(() =>
      supplierInvoiceTotals({
        lines: [{ ...draft().lines[0], netAmount: '9999999999.99' }],
        taxes: [{ label: 'X', amount: '0.01' }],
      }),
    ).toThrow());
  it.each(['0', '0.0000', '-1', '1.00001'])('requires exact positive quantities %s', (quantity) =>
    expect(() =>
      validateSupplierInvoice({ ...draft(), lines: [{ ...draft().lines[0], quantity }] }),
    ).toThrow(),
  );
  it('validates actual civil dates and ordering', () => {
    expect(() => validateSupplierInvoice({ ...draft(), invoiceDate: '2026-02-30' })).toThrow();
    expect(() => validateSupplierInvoice({ ...draft(), dueDate: '2026-09-25' })).toThrow();
  });
  it('normalizes numbers without stripping meaningful punctuation or zeros', () => {
    expect(supplierInvoiceNumberKey('  ｆｖ  001 ')).toBe('FV 001');
    expect(supplierInvoiceNumberKey('FV-001')).not.toBe(supplierInvoiceNumberKey('FV001'));
  });
  it('rejects duplicate purchase line links', () =>
    expect(() =>
      validateSupplierInvoice({
        ...draft(),
        lines: [1, 2].map(() => ({ ...draft().lines[0], purchaseLineId: 'same' })),
      }),
    ).toThrow());
  it('freezes documentary closure and never exposes a payment transition', () => {
    expect(canTransitionSupplierInvoice('DRAFT', 'QUALIFIED')).toBe(true);
    expect(canTransitionSupplierInvoice('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransitionSupplierInvoice('QUALIFIED', 'DRAFT')).toBe(false);
    expect(canTransitionSupplierInvoice('QUALIFIED', 'CANCELLED')).toBe(false);
    expect(canTransitionSupplierInvoice('DRAFT', 'PAID')).toBe(false);
  });
});
