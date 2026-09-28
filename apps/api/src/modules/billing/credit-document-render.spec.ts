import { renderCreditDocument, CreditDocumentSnapshot } from './credit-document-render';
export const creditPdfFixture: CreditDocumentSnapshot = {
  version: 1,
  identities: {
    issuerName: 'Atelier Démonstration inc.',
    issuerAddress: '123, rue de l’Érable\nQuébec (Québec) G1A 1A1',
    issuerTaxIds: 'TPS : EXEMPLE SEULEMENT\nTVQ : EXEMPLE SEULEMENT',
    recipientName: 'Société cliente de démonstration',
    recipientAddress: '456, avenue du Parc\nMontréal (Québec)',
  },
  number: 'AVC-000042',
  invoiceNumber: 'CINV-000128',
  documentDate: '2026-09-23T16:00:00.000Z',
  accountingDate: '2026-09-22T16:00:00.000Z',
  currency: 'CAD',
  reason:
    'Retour partiel : pièce reçue, contrôlée et acceptée. Démonstration, sans valeur comptable.',
  netAmount: '100.00',
  taxAmount: '14.98',
  totalAmount: '114.98',
  lines: [
    {
      description: 'Ensemble de fixation — retour partiel',
      quantity: '2',
      netAmount: '100.00',
      taxAmount: '14.98',
      totalAmount: '114.98',
      taxes: [
        { description: 'TPS', rate: '5', amount: '5.00' },
        { description: 'TVQ', rate: '9.975', amount: '9.98' },
      ],
    },
  ],
};
describe('Credit PDF frozen renderer', () => {
  it('renders an actual PDF from the frozen snapshot only', async () => {
    const before = JSON.stringify(creditPdfFixture);
    const pdf = await renderCreditDocument(creditPdfFixture);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/Count 1');
    expect(JSON.stringify(creditPdfFixture)).toBe(before);
  });
  it('paginates many long lines without dropping the document ending', async () => {
    const pdf = await renderCreditDocument({
      ...creditPdfFixture,
      lines: Array.from({ length: 40 }, (_, i) => ({
        ...creditPdfFixture.lines[0],
        description: `${i + 1}. ${'Désignation longue à préserver. '.repeat(25)}`,
      })),
    });
    expect(pdf.toString('latin1')).toMatch(/\/Count [1-9]\d/);
    expect(pdf.subarray(-6).toString().trim()).toBe('%%EOF');
  });
  it('renders the historical source legend without printing internal provenance fields', async () => {
    const pdf = await renderCreditDocument({
      ...creditPdfFixture,
      recipientProvenance: {
        kind: 'INVOICE',
        invoiceId: 'PRIVATE-ID',
        contactEmail: 'private@example.test',
        coordinatesHash: 'a'.repeat(64),
        frozenAt: '2026-09-24T14:00:00.000Z',
        addressVersion: 2,
      },
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/Count 1');
  });
});
