import { describe, it, expect } from 'vitest';
import { computeLineTotal, sumLineItems } from './line-items';

describe('computeLineTotal', () => {
  it('multiplies quantity × unitPrice', () => {
    expect(computeLineTotal({ quantity: 3, unitPrice: 10, discountPct: 0 })).toBe(30);
  });
  it('applies a percentage discount', () => {
    expect(computeLineTotal({ quantity: 2, unitPrice: 100, discountPct: 10 })).toBe(180);
  });
  it('rounds to 2 decimals', () => {
    expect(computeLineTotal({ quantity: 3, unitPrice: 9.99, discountPct: 0 })).toBe(29.97);
    expect(computeLineTotal({ quantity: 1, unitPrice: 10, discountPct: 33.333 })).toBe(6.67);
  });
});

describe('sumLineItems', () => {
  it('sums line totals, rounded', () => {
    expect(sumLineItems([
      { quantity: 2, unitPrice: 100, discountPct: 10 }, // 180
      { quantity: 3, unitPrice: 9.99, discountPct: 0 },  // 29.97
    ])).toBe(209.97);
  });
  it('empty list is 0', () => {
    expect(sumLineItems([])).toBe(0);
  });
});
