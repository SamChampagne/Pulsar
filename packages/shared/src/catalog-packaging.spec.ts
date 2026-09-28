import { describe, expect, it } from 'vitest';
import { packageQuantity } from './catalog-packaging';
describe('exact purchase packaging', () => {
  it('converts packages to base units without converting prices', () => {
    expect(packageQuantity('2', '12', true)).toBe('24');
    expect(packageQuantity('0.3', '0.1', false, 3)).toBe('0.03');
    expect(packageQuantity('3', '0.3333', true)).toBe('0.9999');
  });
  it('refuses precision loss at each operational boundary', () => {
    expect(() => packageQuantity('1', '0.0001', false, 3)).toThrow('3 décimales');
    expect(packageQuantity('1', '0.0001', false, 4)).toBe('0.0001');
    expect(() => packageQuantity('3', '0.333333', true, 4)).toThrow('4 décimales');
    expect(() => packageQuantity('0.5', '12', true)).toThrow('entier');
  });
  it.each(['0', '-1', '1e2', '1,2', '1.00001', 'Infinity'])('rejects invalid count %s', (count) =>
    expect(() => packageQuantity(count, '12', false)).toThrow(),
  );
  it('rejects overflow and preserves max supported value', () => {
    expect(packageQuantity('1000000000', '1', true, 3)).toBe('1000000000');
    expect(() => packageQuantity('1000000000', '2', true)).toThrow('supérieure');
  });
});
