import { describe, expect, it } from 'vitest';
import { PARTY_ACCESS, PARTY_PROFILE_FIELDS, validatePartyProfile } from './party-profile';
describe('Private business profile', () => {
  it('trims optional values without inferring workflows or modifying input', () => {
    const data = {
      legalName: ' Atelier Nord ',
      website: 'https://example.test',
      timeZone: 'America/Toronto',
      additional: [{ label: ' Porte ', value: ' Quai 4 ' }],
    };
    expect(validatePartyProfile(data)).toEqual({
      errors: [],
      value: {
        ...data,
        legalName: 'Atelier Nord',
        additional: [{ label: 'Porte', value: 'Quai 4' }],
      },
    });
    expect(data.legalName).toBe(' Atelier Nord ');
  });
  it('rejects unknown, active content, oversized and malformed fields', () => {
    for (const input of [
      null,
      [],
      'x',
      { tenantId: 'other' },
      { legalName: true },
      { legalName: 'x'.repeat(201) },
      { website: 'javascript:alert(1)' },
      { website: 'https://user:pass@example.test' },
      { timeZone: 'nope' },
      { additional: [{ label: 'A', value: 12 }] },
      { additional: [{ label: 'A', value: '', secret: true }] },
    ])
      expect(validatePartyProfile(input).value).toBeUndefined();
  });
  it('bounds extensions and rejects duplicate labels or blank labels', () => {
    for (const additional of [
      Array.from({ length: 21 }, (_, i) => ({ label: `${i}`, value: '' })),
      [{ label: '', value: '' }],
      [
        { label: 'Porte', value: 'A' },
        { label: ' porte ', value: 'B' },
      ],
    ])
      expect(validatePartyProfile({ additional }).errors.length).toBeGreaterThan(0);
  });
  it('accepts empty profiles, clearing and text that never executes', () => {
    expect(validatePartyProfile({ legalName: ' ', additional: [] }).value).toEqual({
      additional: [],
    });
    expect(
      validatePartyProfile({ internalNotes: '<script>alert(1)</script>' }).value?.internalNotes,
    ).toContain('<script>');
  });
  it('has unique fields and statically guarded consumer paths', () => {
    expect(new Set(PARTY_PROFILE_FIELDS.map((f) => f.key)).size).toBe(PARTY_PROFILE_FIELDS.length);
    expect(new Set(PARTY_ACCESS.map((a) => a.path)).size).toBe(PARTY_ACCESS.length);
    for (const a of PARTY_ACCESS) {
      expect(a.read).toBeTruthy();
      expect(a.manage).toBeTruthy();
    }
  });
});
