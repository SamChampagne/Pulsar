import { describe, expect, it } from 'vitest';
import { directoryEntryImpact } from './directory-impact';
import type { CoordinateCopy, DocumentCoordinates } from './document-coordinates';
import { PartyDirectoryKind } from './party-directory';
const entry: CoordinateCopy = {
  id: 'entry',
  version: 2,
  data: {
    kind: PartyDirectoryKind.ADDRESS,
    label: 'Bureau',
    role: 'Achats',
    active: true,
    validFrom: null,
    validUntil: null,
    email: '',
    phone: '',
    notes: 'privé',
    address: {
      line1: '42 rue du Parc',
      line2: '',
      city: 'Québec',
      region: 'QC',
      countryCode: 'CA',
      postalCode: 'G1K 3X2',
    },
  },
};
const copy = (frozenAt: string | null = null): DocumentCoordinates => ({
  schemaVersion: 1,
  owner: { kind: 'supplier', id: 'supplier', code: 'FR', name: 'Fournisseur' },
  entries: { billingAddress: { ...entry, version: 1 }, deliveryAddress: null, contact: null },
  selectedAt: '2026-09-01T00:00:00Z',
  selectedBy: 'user',
  reason: 'Revue',
  referenceDate: '2026-09-01',
  timeZone: 'America/Toronto',
  frozenAt,
});
describe('directory entry impact', () => {
  it('flags stale selected versions, with supplier-specific labels and no captured private data', () => {
    const result = directoryEntryImpact(copy(), entry, '2026-09-24');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ label: 'Adresse du fournisseur', selectedVersion: 1 });
    expect(result[0].issue).toContain('version 2');
    expect(JSON.stringify(result)).not.toContain('privé');
  });
  it('never marks a frozen historical copy stale', () =>
    expect(
      directoryEntryImpact(copy('2026-09-02T00:00:00Z'), entry, '2026-09-24')[0].issue,
    ).toBeNull());
  it('checks validity of the same version, without mutating the snapshot', () => {
    const c = copy(),
      before = JSON.stringify(c);
    const result = directoryEntryImpact(
      c,
      { ...entry, version: 1, data: { ...entry.data, active: false } },
      '2026-09-24',
    );
    expect(result[0].issue).toContain('désactivée');
    expect(JSON.stringify(c)).toBe(before);
  });
  it('does not review other entries, and reports multiple roles without duplicating the document', () => {
    const c = copy();
    c.owner.kind = 'customer';
    c.entries.deliveryAddress = c.entries.billingAddress;
    expect(directoryEntryImpact(c, entry, '2026-09-24')).toHaveLength(2);
    expect(directoryEntryImpact(c, { ...entry, id: 'unrelated' }, '2026-09-24')).toEqual([]);
  });
});
