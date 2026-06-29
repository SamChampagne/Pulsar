import { describe, it, expect } from 'vitest';
import { computeTax, TaxTemplateType } from './tax';

describe('computeTax', () => {
  it('single rate on net', () => {
    const r = computeTax(100, [{ description: 'GST', rate: 5, accountCode: '2100' }]);
    expect(r.taxAmount).toBe(5);
    expect(r.lines).toEqual([{ description: 'GST', rate: 5, accountCode: '2100', amount: 5 }]);
  });
  it('multi-rate flat on net', () => {
    const r = computeTax(100, [
      { description: 'GST', rate: 5, accountCode: '2100' },
      { description: 'QST', rate: 9.975, accountCode: '2100' },
    ]);
    expect(r.lines.map((l) => l.amount)).toEqual([5, 9.98]);
    expect(r.taxAmount).toBe(14.98);
  });
  it('empty lines → zero', () => {
    expect(computeTax(100, [])).toEqual({ taxAmount: 0, lines: [] });
  });
  it('rounds each line to 2dp', () => {
    const r = computeTax(33.33, [{ description: 'GST', rate: 5, accountCode: '2100' }]);
    expect(r.lines[0].amount).toBe(1.67); // 1.6665 → 1.67
  });
  it('enum values', () => {
    expect(TaxTemplateType.SALES).toBe('SALES');
    expect(TaxTemplateType.PURCHASE).toBe('PURCHASE');
  });
});
