import { describe, it, expect } from 'vitest';
import { AccountType, normalBalance, isBalanced, DEFAULT_CHART } from './ledger';

describe('normalBalance', () => {
  it('ASSET/EXPENSE → DEBIT, others → CREDIT', () => {
    expect(normalBalance(AccountType.ASSET)).toBe('DEBIT');
    expect(normalBalance(AccountType.EXPENSE)).toBe('DEBIT');
    expect(normalBalance(AccountType.LIABILITY)).toBe('CREDIT');
    expect(normalBalance(AccountType.EQUITY)).toBe('CREDIT');
    expect(normalBalance(AccountType.REVENUE)).toBe('CREDIT');
  });
});

describe('isBalanced', () => {
  it('true when Σdebit === Σcredit, ≥2 lines, each line one-sided', () => {
    expect(isBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }])).toBe(true);
    expect(isBalanced([{ debit: 60, credit: 0 }, { debit: 40, credit: 0 }, { debit: 0, credit: 100 }])).toBe(true);
  });
  it('false when unbalanced / single line / two-sided line', () => {
    expect(isBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 90 }])).toBe(false);
    expect(isBalanced([{ debit: 100, credit: 0 }])).toBe(false);
    expect(isBalanced([{ debit: 50, credit: 50 }, { debit: 0, credit: 100 }])).toBe(false);
    expect(isBalanced([])).toBe(false);
  });
  it('rounds to 2 decimals', () => {
    expect(isBalanced([{ debit: 33.33, credit: 0 }, { debit: 33.33, credit: 0 }, { debit: 33.34, credit: 0 }, { debit: 0, credit: 100 }])).toBe(true);
  });
});

describe('DEFAULT_CHART', () => {
  it('has the core accounts with valid types', () => {
    const codes = DEFAULT_CHART.map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(['1000', '1100', '2000', '4000', '5000']));
    for (const a of DEFAULT_CHART) expect(Object.values(AccountType)).toContain(a.type);
  });
});
