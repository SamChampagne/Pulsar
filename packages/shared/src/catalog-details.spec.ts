import { describe, expect, it } from 'vitest';
import { catalogDetailFields, validateCatalogDetails } from './catalog-details';
describe('catalog information contract', () => {
  it('keeps product and service sections distinct', () => {
    expect(catalogDetailFields('SERVICE').some((f) => f.key === 'netWeightKg')).toBe(false);
    expect(catalogDetailFields('GOODS').some((f) => f.key === 'deliverables')).toBe(false);
    expect(validateCatalogDetails({ netWeightKg: '1' }, 'SERVICE').value).toBeUndefined();
    expect(validateCatalogDetails({ scope: 'test' }, 'GOODS').value).toBeUndefined();
  });
  it('trims optional text and preserves exact measurement strings', () => {
    expect(
      validateCatalogDetails(
        { brand: ' Test ', netWeightKg: '0.0001', internalNotes: ' ' },
        'GOODS',
      ).value,
    ).toEqual({ brand: 'Test', netWeightKg: '0.0001' });
  });
  it.each(['0', '-1', '1e2', '1,2', '1.23456', '1000000000', 'Infinity'])(
    'refuses invalid measurement %s',
    (value) => {
      expect(validateCatalogDetails({ lengthMm: value }, 'GOODS').errors.length).toBeGreaterThan(0);
    },
  );
  it('rejects non objects, unknown keys, wrong types and oversized values', () => {
    for (const value of [null, [], 'x', { stock: 5 }, { brand: null }, { model: 'x'.repeat(121) }])
      expect(validateCatalogDetails(value, 'GOODS').value).toBeUndefined();
  });
});
