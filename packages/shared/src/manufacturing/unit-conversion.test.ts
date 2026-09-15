import { describe, expect, it } from 'vitest';
import { convertMrpCommercialQuantity as convert } from './unit-conversion';
describe('Explicit MRP commercial ratio', () => {
  it('converts cartons to pieces with exact decimal arithmetic', () => {
    expect(convert('2.5', '12', '1')).toBe('30');
    expect(convert('0.1', '3', '1')).toBe('0.3');
  });
  it('supports an explicit denominator without rounding', () => {
    expect(convert('3', '1', '3')).toBe('1');
    expect(convert('1', '1', '8')).toBe('0.125');
    expect(() => convert('1', '1', '3')).toThrow('non exacte');
  });
  it('rejects zero, non-finite, negative, too precise and oversized values', () => {
    for (const value of ['0', '-1', 'NaN', 'Infinity', '1e2', '0.0001', '1000000001'])
      expect(() => convert(value, '1', '1')).toThrow();
    expect(() => convert('1', '1', '0')).toThrow();
    expect(() => convert('1000000000', '12', '1')).toThrow();
  });
});
