import { describe, expect, it } from 'vitest';
import {
  reviewDocumentCoordinates,
  type DocumentCoordinates,
  type CoordinateCopy,
  SUPPLIER_COORDINATE_ROLES,
  SUPPLIER_COORDINATE_LABELS,
} from './document-coordinates';
import { PartyDirectoryKind } from './party-directory';
const entry: CoordinateCopy = {
  id: 'contact-1',
  version: 1,
  data: {
    kind: PartyDirectoryKind.CONTACT,
    label: 'Réception',
    role: '',
    active: true,
    validFrom: '2026-09-01',
    validUntil: '2026-10-01',
    email: 'a@example.test',
    phone: '',
    address: null,
    notes: '',
  },
};
const snapshot: DocumentCoordinates = {
  schemaVersion: 1,
  owner: { kind: 'partner', id: 'p1', code: 'P1', name: 'Atelier' },
  entries: { billingAddress: null, deliveryAddress: null, contact: entry },
  selectedAt: '2026-09-24T12:00:00Z',
  selectedBy: 'u1',
  reason: 'Accord',
  referenceDate: '2026-09-24',
  timeZone: 'America/Toronto',
  frozenAt: null,
};
describe('document coordinates review', () => {
  it('keeps the buyer receiving destination out of supplier directory choices', () => {
    expect(SUPPLIER_COORDINATE_ROLES).toEqual(['billingAddress', 'contact']);
    expect(SUPPLIER_COORDINATE_LABELS.billingAddress).toBe('Adresse du fournisseur');
  });
  it('accepts an exact current version on a valid civil day', () =>
    expect(reviewDocumentCoordinates(snapshot, [entry], '2026-09-24')).toEqual([]));
  it('does not silently follow a changed directory version', () =>
    expect(
      reviewDocumentCoordinates(snapshot, [{ ...entry, version: 2 }], '2026-09-24')[0].message,
    ).toContain('version 2'));
  it('rejects the exclusive expiry date', () =>
    expect(reviewDocumentCoordinates(snapshot, [entry], '2026-10-01')).toHaveLength(1));
  it('rejects future validity and inactive entries', () => {
    expect(reviewDocumentCoordinates(snapshot, [entry], '2026-08-31')).toHaveLength(1);
    expect(
      reviewDocumentCoordinates(
        snapshot,
        [{ ...entry, data: { ...entry.data, active: false } }],
        '2026-09-24',
      ),
    ).toHaveLength(1);
  });
  it('rejects missing entries and incompatible usage', () => {
    expect(reviewDocumentCoordinates(snapshot, [], '2026-09-24')).toHaveLength(1);
    expect(
      reviewDocumentCoordinates(
        { ...snapshot, entries: { billingAddress: entry, deliveryAddress: null, contact: null } },
        [entry],
        '2026-09-24',
      ),
    ).toHaveLength(1);
  });
  it('does not mutate captured copies', () => {
    const before = JSON.stringify(snapshot);
    reviewDocumentCoordinates(snapshot, [{ ...entry, version: 8 }], '2026-09-24');
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
