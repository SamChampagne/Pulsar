import { describe, it, expect } from 'vitest';
import {
  summarizeSupplierDossier,
  formatSupplierDossierMoney,
  type SupplierDossierGroup,
} from './supplier-dossier';
const group = (
  currency = 'CAD',
  kind: SupplierDossierGroup['kind'] = 'INVOICE',
  status: SupplierDossierGroup['status'] = 'QUALIFIED',
  amount = '10.35',
  count = 1,
): SupplierDossierGroup => ({ currency, kind, status, amount, count });
describe('Supplier documentary dossier', () => {
  it('keeps currencies separate and excludes drafts/cancelled amounts', () => {
    const s = summarizeSupplierDossier([
      group(),
      group('CAD', 'CREDIT', 'QUALIFIED', '4.20'),
      group('USD'),
      group('CAD', 'INVOICE', 'DRAFT', '100'),
      group('CAD', 'CREDIT', 'CANCELLED', '7'),
    ]);
    expect(s.currencies.map((c) => [c.currency, c.documentaryRemaining])).toEqual([
      ['CAD', '6.15'],
      ['USD', '10.35'],
    ]);
    expect(s.counts).toEqual({
      invoiceDraft: 1,
      invoiceQualified: 2,
      invoiceCancelled: 0,
      creditDraft: 0,
      creditQualified: 1,
      creditCancelled: 1,
    });
  });
  it('adds cents exactly over multiple groups', () =>
    expect(
      summarizeSupplierDossier([
        group('CAD', 'INVOICE', 'QUALIFIED', '0.10'),
        group('CAD', 'INVOICE', 'QUALIFIED', '0.20'),
      ]).currencies[0].qualifiedInvoices,
    ).toBe('0.30'));
  it('supports aggregate amounts larger than a document or Number safe integer', () => {
    const value = '12345678901234567890.12';
    expect(
      summarizeSupplierDossier([group('CAD', 'INVOICE', 'QUALIFIED', value)]).currencies[0]
        .documentaryRemaining,
    ).toBe(value);
    expect(formatSupplierDossierMoney(value, 'CAD')).toBe(
      '12\u202f345\u202f678\u202f901\u202f234\u202f567\u202f890,12 CAD',
    );
  });
  it('signals inconsistent history without hiding it behind a zero balance', () =>
    expect(summarizeSupplierDossier([group('CAD', 'CREDIT')]).currencies[0]).toMatchObject({
      inconsistent: true,
      documentaryRemaining: null,
    }));
  it('returns no invented currency or money for an empty dossier', () =>
    expect(summarizeSupplierDossier([]).currencies).toEqual([]));
  it.each(['-1', '1e2', '0.001', 'NaN'])('rejects invalid aggregate %s', (v) =>
    expect(() => summarizeSupplierDossier([group('CAD', 'INVOICE', 'QUALIFIED', v)])).toThrow(),
  );
});
