import { renderInvoiceDocument, InvoiceDocumentSnapshot } from './invoice-document-render';
export const invoicePdfFixture: InvoiceDocumentSnapshot = {
  version: 1,
  identities: {
    issuerName: 'Atelier Démonstration',
    issuerAddress: '123 rue Exemple\nQuébec, QC',
    issuerTaxIds: 'TPS / TVQ : EXEMPLES',
    recipientName: 'Client historique',
    recipientAddress: '42 rue du Parc\nQuébec, QC, G1K 3X2',
  },
  recipientProvenance: {
    kind: 'INVOICE',
    frozenAt: '2026-09-24T12:00:00Z',
    contactEmail: 'private@example.test',
  },
  number: 'CINV-000042',
  documentDate: '2026-09-24T14:00:00Z',
  approvedAt: '2026-09-23T14:00:00Z',
  currency: 'CAD',
  netAmount: '100.00',
  taxAmount: '14.98',
  totalAmount: '114.98',
  lines: [{ description: 'Inspection atelier', quantity: '2', unitPrice: '50', amount: '100.00' }],
  taxes: [
    { description: 'TPS', rate: '5', amount: '5.00' },
    { description: 'TVQ', rate: '9.975', amount: '9.98' },
  ],
};
describe('Invoice canonical PDF', () => {
  it('renders the immutable snapshot without balance or payment assumptions', async () => {
    const before = JSON.stringify(invoicePdfFixture);
    const pdf = await renderInvoiceDocument(invoicePdfFixture);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/Count 1');
    expect(JSON.stringify(invoicePdfFixture)).toBe(before);
  });
  it('paginates long lines and tax summaries without dropping the ending', async () => {
    const pdf = await renderInvoiceDocument({
      ...invoicePdfFixture,
      lines: Array.from({ length: 35 }, () => ({
        ...invoicePdfFixture.lines[0],
        description: 'Désignation historique longue. '.repeat(20),
      })),
    });
    expect(pdf.toString('latin1')).toMatch(/\/Count [1-9]\d/);
    expect(pdf.subarray(-6).toString().trim()).toBe('%%EOF');
  });
});
