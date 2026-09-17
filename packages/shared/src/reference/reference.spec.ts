import { describe, it, expect } from 'vitest';
import {
  COUNTRIES,
  REGIONS_BY_COUNTRY,
  regionsFor,
  CURRENCIES,
  WMS_UNITS,
  type ReferenceEntry,
} from './index';

function assertCatalog(entries: readonly ReferenceEntry[], label: string) {
  expect(entries.length, `${label} is not empty`).toBeGreaterThan(0);
  const codes = entries.map((e) => e.code);
  expect(new Set(codes).size, `${label} has unique codes`).toBe(codes.length);
  for (const entry of entries) {
    expect(entry.code, `${label} code is a non-empty string`).toMatch(/^[A-Z0-9-]+$/);
    expect(entry.name.trim().length, `${label} ${entry.code} has a label`).toBeGreaterThan(0);
  }
}

describe('COUNTRIES', () => {
  it('is a well-formed catalog', () => {
    assertCatalog(COUNTRIES, 'COUNTRIES');
  });

  it('covers the countries the app operates in, with ISO-3166-1 alpha-2 codes', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(codes).toEqual(
      expect.arrayContaining(['CA', 'US', 'MX', 'FR', 'GB', 'DE', 'ES', 'IT', 'BE', 'NL', 'CH']),
    );
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it('labels countries in French', () => {
    const byCode = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));
    expect(byCode.CA).toBe('Canada');
    expect(byCode.US).toBe('États-Unis');
    expect(byCode.MX).toBe('Mexique');
    expect(byCode.GB).toBe('Royaume-Uni');
    expect(byCode.DE).toBe('Allemagne');
  });
});

describe('REGIONS_BY_COUNTRY', () => {
  it('has the 13 Canadian provinces and territories, in French', () => {
    const ca = REGIONS_BY_COUNTRY.CA;
    assertCatalog(ca, 'REGIONS_BY_COUNTRY.CA');
    expect(ca).toHaveLength(13);
    const byCode = Object.fromEntries(ca.map((r) => [r.code, r.name]));
    expect(byCode.QC).toBe('Québec');
    expect(byCode.ON).toBe('Ontario');
    expect(byCode.BC).toBe('Colombie-Britannique');
    expect(byCode.PE).toBe('Île-du-Prince-Édouard');
    expect(byCode.NT).toBe('Territoires du Nord-Ouest');
  });

  it('has the 50 US states plus DC', () => {
    const us = REGIONS_BY_COUNTRY.US;
    assertCatalog(us, 'REGIONS_BY_COUNTRY.US');
    expect(us).toHaveLength(51);
    const byCode = Object.fromEntries(us.map((r) => [r.code, r.name]));
    expect(byCode.NY).toBe('New York');
    expect(byCode.CA).toBe('Californie');
    expect(byCode.DC).toBe('District de Columbia');
    expect(byCode.NC).toBe('Caroline du Nord');
  });

  it('only keys countries that exist in COUNTRIES', () => {
    const known = new Set(COUNTRIES.map((c) => c.code));
    for (const code of Object.keys(REGIONS_BY_COUNTRY)) expect(known.has(code)).toBe(true);
  });
});

describe('regionsFor', () => {
  it('returns the regions of a known country', () => {
    expect(regionsFor('CA')).toBe(REGIONS_BY_COUNTRY.CA);
    expect(regionsFor('US')).toHaveLength(51);
  });

  it('normalises case and surrounding whitespace', () => {
    expect(regionsFor(' ca ')).toBe(REGIONS_BY_COUNTRY.CA);
    expect(regionsFor('us')).toBe(REGIONS_BY_COUNTRY.US);
  });

  it('returns an empty list for a country with no region catalog or no country at all', () => {
    expect(regionsFor('FR')).toEqual([]);
    expect(regionsFor('')).toEqual([]);
    expect(regionsFor(undefined)).toEqual([]);
    expect(regionsFor(null)).toEqual([]);
  });
});

describe('CURRENCIES', () => {
  it('is a well-formed catalog of the supported ISO-4217 currencies', () => {
    assertCatalog(CURRENCIES, 'CURRENCIES');
    expect(CURRENCIES.map((c) => c.code)).toEqual(['CAD', 'USD', 'EUR', 'MXN', 'GBP']);
    for (const c of CURRENCIES) expect(c.code).toMatch(/^[A-Z]{3}$/);
  });

  it('carries a display symbol per currency', () => {
    const byCode = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.symbol]));
    expect(byCode.CAD).toBe('$');
    expect(byCode.EUR).toBe('€');
    expect(byCode.GBP).toBe('£');
  });
});

describe('WMS_UNITS', () => {
  it('is a well-formed catalog with the warehouse units, labelled in French', () => {
    assertCatalog(WMS_UNITS, 'WMS_UNITS');
    expect(WMS_UNITS.map((u) => u.code)).toEqual(['EA', 'KG', 'LB', 'L', 'M', 'PAL', 'BOX', 'CS']);
    const byCode = Object.fromEntries(WMS_UNITS.map((u) => [u.code, u.name]));
    expect(byCode.EA).toBe('Unité');
    expect(byCode.PAL).toBe('Palette');
    expect(byCode.KG).toBe('Kilogramme');
  });
});
