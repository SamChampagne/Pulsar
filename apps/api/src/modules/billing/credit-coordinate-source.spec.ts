import { invoiceCreditRecipient } from './credit-coordinate-source';

const entry = {
  kind: 'ADDRESS',
  label: 'Bureau',
  role: 'Facturation',
  active: true,
  validFrom: null,
  validUntil: '2020-01-01',
  email: '',
  phone: '',
  notes: 'PRIVATE-ADDRESS-NOTE',
  address: {
    line1: '42 rue du Parc',
    line2: 'Bureau 3',
    city: 'Québec',
    region: 'QC',
    postalCode: 'G1K 3X2',
    countryCode: 'CA',
  },
};
export const coordinatesFixture = {
  schemaVersion: 1,
  owner: { kind: 'customer', id: 'customer-1', name: 'Client historique', code: 'OLD' },
  entries: {
    billingAddress: { id: 'address-1', version: 2, data: entry },
    deliveryAddress: {
      id: 'private-delivery',
      version: 1,
      data: { ...entry, notes: 'PRIVATE-DELIVERY' },
    },
    contact: {
      id: 'contact-1',
      version: 3,
      data: {
        ...entry,
        kind: 'CONTACT',
        address: null,
        email: 'historique@example.test',
        notes: 'PRIVATE-CONTACT-NOTE',
      },
    },
  },
  frozenAt: '2019-09-24T14:00:00.000Z',
};
describe('Credit recipient from frozen invoice coordinates', () => {
  it('uses the historical bill-to identity, never current validity or delivery notes', () => {
    const before = JSON.stringify(coordinatesFixture);
    const result = invoiceCreditRecipient('invoice-1', 'customer-1', coordinatesFixture)!;
    expect(result.recipientName).toBe('Client historique');
    expect(result.recipientAddress).toBe('42 rue du Parc\nBureau 3\nQuébec, QC, G1K 3X2\nCA');
    expect(result.contactEmail).toBe('historique@example.test');
    expect(result.coordinatesHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(coordinatesFixture)).toBe(before);
  });
  it.each([
    null,
    {},
    { ...coordinatesFixture, frozenAt: null },
    { ...coordinatesFixture, schemaVersion: 2 },
    { ...coordinatesFixture, entries: { billingAddress: null } },
  ])('does not invent a recipient from an absent or unfrozen source', (raw) => {
    expect(invoiceCreditRecipient('invoice-1', 'customer-1', raw)).toBeNull();
  });
  it('binds the owner and invoice, and refuses a malformed address', () => {
    expect(invoiceCreditRecipient('invoice-1', 'foreign', coordinatesFixture)).toBeNull();
    expect(
      invoiceCreditRecipient('invoice-1', 'customer-1', {
        ...coordinatesFixture,
        entries: { billingAddress: { id: 'x', version: 1, data: {} } },
      }),
    ).toBeNull();
    const hash = invoiceCreditRecipient(
      'invoice-1',
      'customer-1',
      coordinatesFixture,
    )!.coordinatesHash;
    expect(
      invoiceCreditRecipient('invoice-2', 'customer-1', coordinatesFixture)!.coordinatesHash,
    ).not.toBe(hash);
    expect(
      invoiceCreditRecipient('invoice-1', 'customer-1', {
        ...coordinatesFixture,
        entries: {
          ...coordinatesFixture.entries,
          contact: {
            ...coordinatesFixture.entries.contact,
            data: { ...coordinatesFixture.entries.contact.data, email: 'other@example.test' },
          },
        },
      })!.coordinatesHash,
    ).not.toBe(hash);
    expect(
      invoiceCreditRecipient('invoice-1', 'customer-1', {
        ...coordinatesFixture,
        owner: { ...coordinatesFixture.owner, name: 'Other' },
      })!.coordinatesHash,
    ).not.toBe(hash);
  });
});
