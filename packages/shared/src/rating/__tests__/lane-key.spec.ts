import { describe, expect, it } from 'vitest';
import { LaneEndpointType } from '../../enums/transportation';
import {
  buildEndpointKey,
  candidateEndpointKeys,
  compareLanes,
  normalizeGeo,
} from '../lane-key';

describe('normalizeGeo', () => {
  it('strips diacritics, case and whitespace — Québec market requirement', () => {
    expect(normalizeGeo('Montréal')).toBe('montreal');
    expect(normalizeGeo('  MONTREAL ')).toBe('montreal');
    expect(normalizeGeo('Trois-Rivières')).toBe('trois-rivieres');
  });
});

describe('buildEndpointKey', () => {
  it('builds keys per level', () => {
    expect(buildEndpointKey(LaneEndpointType.LOCATION, { locationId: 'loc1' })).toBe('LOCATION:loc1');
    expect(
      buildEndpointKey(LaneEndpointType.CITY, { city: 'Montréal', state: 'QC', country: 'CA' }),
    ).toBe('CITY:ca|qc|montreal');
    expect(buildEndpointKey(LaneEndpointType.STATE, { state: 'QC', country: 'CA' })).toBe('STATE:ca|qc');
    expect(buildEndpointKey(LaneEndpointType.COUNTRY, { country: 'CA' })).toBe('COUNTRY:ca');
  });

  it('throws on missing required fields', () => {
    expect(() => buildEndpointKey(LaneEndpointType.CITY, { city: 'Montréal' })).toThrow();
    expect(() => buildEndpointKey(LaneEndpointType.LOCATION, {})).toThrow();
  });
});

describe('candidateEndpointKeys', () => {
  it('returns all matchable keys, most specific first', () => {
    expect(
      candidateEndpointKeys({ id: 'loc1', city: 'Montréal', state: 'QC', country: 'CA' }),
    ).toEqual(['LOCATION:loc1', 'CITY:ca|qc|montreal', 'STATE:ca|qc', 'COUNTRY:ca']);
  });

  it('skips CITY and STATE levels when the location has no state', () => {
    expect(candidateEndpointKeys({ id: 'loc1', city: 'Montréal', state: null, country: 'CA' })).toEqual([
      'LOCATION:loc1',
      'COUNTRY:ca',
    ]);
  });
});

describe('compareLanes — deterministic total ordering', () => {
  const lane = (
    originType: LaneEndpointType,
    destinationType: LaneEndpointType,
    createdAt = new Date('2026-01-01'),
  ) => ({ originType, destinationType, createdAt });

  it('higher total specificity wins', () => {
    const a = lane(LaneEndpointType.LOCATION, LaneEndpointType.LOCATION); // 6
    const b = lane(LaneEndpointType.CITY, LaneEndpointType.CITY); // 4
    expect([b, a].sort(compareLanes)[0]).toBe(a);
  });

  it('tie on total → destination specificity wins (3+2 vs 2+3 ⇒ LOCATION destination first)', () => {
    const locToCity = lane(LaneEndpointType.LOCATION, LaneEndpointType.CITY); // 3+2
    const cityToLoc = lane(LaneEndpointType.CITY, LaneEndpointType.LOCATION); // 2+3
    expect([locToCity, cityToLoc].sort(compareLanes)[0]).toBe(cityToLoc);
  });

  it('full tie → newest lane wins (deterministic safety net)', () => {
    const old = lane(LaneEndpointType.CITY, LaneEndpointType.CITY, new Date('2026-01-01'));
    const recent = lane(LaneEndpointType.CITY, LaneEndpointType.CITY, new Date('2026-02-01'));
    expect([old, recent].sort(compareLanes)[0]).toBe(recent);
  });
});
