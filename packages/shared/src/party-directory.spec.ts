import { describe, it, expect } from 'vitest';
import { directoryValidity, validateDirectoryEntry, PartyDirectoryKind } from './party-directory';
const contact = {
  kind: PartyDirectoryKind.CONTACT,
  label: 'Camille Dubois',
  role: 'Réception',
  active: true,
  email: 'camille@example.test',
  phone: '+1 514 555 0142',
  validFrom: '2026-09-24',
  validUntil: '2026-10-01',
  address: null,
};
describe('Shared party directory contract', () => {
  it('normalizes a closed contract without inventing authorization', () => {
    const r = validateDirectoryEntry({ ...contact, label: ' Camille Dubois ' });
    expect(r.errors).toEqual([]);
    expect(r.value?.label).toBe('Camille Dubois');
    expect(r.value).not.toHaveProperty('permissions');
  });
  it.each([
    { ...contact, tenantId: 'foreign' },
    { ...contact, permissions: ['admin'] },
    { ...contact, phone: 'call me' },
    { ...contact, email: 'not an email' },
    { ...contact, active: 'true' },
    { ...contact, validFrom: '2026-02-30' },
    { ...contact, validUntil: '2026-09-24' },
    { ...contact, address: [] },
    { ...contact, kind: 'UNKNOWN' },
    { ...contact, label: ' ' },
    { ...contact, role: 'x'.repeat(101) },
    {
      ...contact,
      kind: 'ADDRESS',
      address: { line1: '1 Rue', city: 'Montréal', countryCode: 'CA', postalCode: '1234567890' },
    },
    {
      ...contact,
      kind: 'ADDRESS',
      address: {
        line1: '1 Rue',
        city: 'Montréal',
        countryCode: 'CA',
        postalCode: 'H2Y 1C6',
        tenantId: 'foreign',
      },
    },
  ])('rejects invalid or overprivileged data %#', (input) =>
    expect(validateDirectoryEntry(input).value).toBeUndefined(),
  );
  it('permits international addresses and configured role labels', () => {
    const r = validateDirectoryEntry({
      ...contact,
      kind: 'ADDRESS',
      role: 'Réception sur rendez-vous',
      address: {
        line1: '12 Rue du Port',
        city: 'Montréal',
        countryCode: 'ca',
        postalCode: 'H2Y 1C6',
      },
    });
    expect(r.errors).toEqual([]);
    expect(r.value?.address?.countryCode).toBe('CA');
  });
  it('uses inclusive starts, exclusive ends, and an explicit civil date', () => {
    expect(directoryValidity(contact, '2026-09-23')).toBe('UPCOMING');
    expect(directoryValidity(contact, '2026-09-24')).toBe('ACTIVE');
    expect(directoryValidity(contact, '2026-09-30')).toBe('ACTIVE');
    expect(directoryValidity(contact, '2026-10-01')).toBe('EXPIRED');
    expect(directoryValidity({ ...contact, active: false }, '2026-09-25')).toBe('INACTIVE');
    expect(directoryValidity(contact, 'bad')).toBe('UNKNOWN');
  });
});
