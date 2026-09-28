import { describe, it, expect } from 'vitest';
import {
  validateAccountingTarget,
  validateBudgetPeriod,
  validateBudgetLines,
  exactBudgetVariance,
} from './planning';
describe('Accounting planning contracts', () => {
  it('accepts both tenant targets without inferring an external system', () => {
    expect(() => validateAccountingTarget('NATIVE', 'CAD', '')).not.toThrow();
    expect(() => validateAccountingTarget('EXTERNAL', 'USD', 'Business books')).not.toThrow();
    for (const args of [
      ['EXTERNAL', 'CAD', ' '],
      ['NATIVE', 'CAD', 'Other'],
      ['NATIVE', 'ZZZ', ''],
      ['OTHER', 'CAD', ''],
    ])
      expect(() => validateAccountingTarget(...(args as [string, string, string]))).toThrow();
  });
  it('captures inclusive civil dates, including leap years', () => {
    expect(() => validateBudgetPeriod('2024-01-01', '2024-12-31', 2024)).not.toThrow();
    expect(() => validateBudgetPeriod('2026-04-01', '2027-03-31', 2026)).not.toThrow();
    for (const [f, t, y] of [
      ['2026-02-30', '2026-03-01', 2026],
      ['2026-02-01', '2026-01-01', 2026],
      ['2026-01-01', '2027-01-02', 2026],
      ['2026-01-01', '2026-02-01', 2025],
    ] as const)
      expect(() => validateBudgetPeriod(f, t, y)).toThrow();
  });
  it('rejects missing, duplicate and sub-cent budget lines', () => {
    expect(validateBudgetLines([{ accountCode: '4000', amount: '0.10' }])[0].amount).toBe('0.10');
    for (const lines of [
      [],
      [{ accountCode: 'x', amount: '1' }],
      [{ accountCode: '4000', amount: '0.001' }],
      [
        { accountCode: '4000', amount: '1' },
        { accountCode: '4000', amount: '2' },
      ],
      [{ accountCode: '4000', amount: '10000000000' }],
    ])
      expect(() => validateBudgetLines(lines)).toThrow();
  });
  it('keeps exact cents and natural account signs with no misleading total', () => {
    const r = exactBudgetVariance(
      [
        { accountCode: '4000', amount: '0.10' },
        { accountCode: '5000', amount: '0.20' },
      ],
      [
        {
          accountId: 'a',
          code: '4000',
          name: 'Revenue',
          type: 'REVENUE',
          debit: '0',
          credit: '0.30',
        },
        {
          accountId: 'b',
          code: '5000',
          name: 'Expense',
          type: 'EXPENSE',
          debit: '90071992547409930.01',
          credit: '0',
        },
      ],
    );
    expect(r.rows[0]).toMatchObject({ actual: '0.30', variance: '-0.20' });
    expect(r.rows[1].variance).toBe('-90071992547409929.81');
    expect(r).not.toHaveProperty('totalVariance');
  });
});
