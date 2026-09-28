import { describe, it, expect } from 'vitest';
import { supplierDocumentHref } from './supplier-dossier';
describe('supplier dossier links', () => {
  it('opens an invoice and an explicit credit without confusing evidence IDs', () => {
    expect(supplierDocumentHref({ kind: 'INVOICE', id: 'i', invoiceId: 'i' })).toBe(
      '/billing/supplier-invoices?invoiceId=i',
    );
    expect(supplierDocumentHref({ kind: 'CREDIT', id: 'c', invoiceId: 'i' })).toBe(
      '/billing/supplier-invoices?invoiceId=i&creditId=c',
    );
    expect(
      supplierDocumentHref({ kind: 'CREDIT', id: 'file', parentId: 'c', invoiceId: 'i' }),
    ).toBe('/billing/supplier-invoices?invoiceId=i&creditId=c');
  });
  it('encodes opaque identifiers rather than injecting query parameters', () => {
    expect(supplierDocumentHref({ kind: 'CREDIT', id: 'c&other=1', invoiceId: 'i?' })).toBe(
      '/billing/supplier-invoices?invoiceId=i%3F&creditId=c%26other%3D1',
    );
  });
});
