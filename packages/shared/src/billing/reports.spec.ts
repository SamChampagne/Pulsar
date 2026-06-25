import { describe, it, expect } from 'vitest';
import { AccountType } from './ledger';
import { naturalBalance, buildProfitAndLoss, buildBalanceSheet, bucketForAge, buildAging } from './reports';

describe('naturalBalance', () => {
  it('debit-normal (asset/expense) = debit − credit', () => {
    expect(naturalBalance({ code: '1000', name: 'Cash', type: AccountType.ASSET, debit: 100, credit: 30 })).toBe(70);
  });
  it('credit-normal (liability/revenue/equity) = credit − debit', () => {
    expect(naturalBalance({ code: '4000', name: 'Rev', type: AccountType.REVENUE, debit: 10, credit: 110 })).toBe(100);
  });
});

describe('buildProfitAndLoss', () => {
  it('net income = revenue − expense', () => {
    const r = buildProfitAndLoss([
      { code: '4000', name: 'Rev', type: AccountType.REVENUE, debit: 0, credit: 100 },
      { code: '5000', name: 'Exp', type: AccountType.EXPENSE, debit: 40, credit: 0 },
      { code: '1000', name: 'Cash', type: AccountType.ASSET, debit: 100, credit: 0 }, // ignored in P&L
    ]);
    expect(r.totalRevenue).toBe(100);
    expect(r.totalExpense).toBe(40);
    expect(r.netIncome).toBe(60);
    expect(r.revenue).toHaveLength(1);
    expect(r.expense).toHaveLength(1);
  });
});

describe('buildBalanceSheet', () => {
  it('balanced when assets = liabilities + equity + netIncome', () => {
    const r = buildBalanceSheet([
      { code: '1000', name: 'Cash', type: AccountType.ASSET, debit: 160, credit: 0 },
      { code: '2000', name: 'AP', type: AccountType.LIABILITY, debit: 0, credit: 100 },
      { code: '3000', name: 'Capital', type: AccountType.EQUITY, debit: 0, credit: 0 },
    ], 60);
    expect(r.totalAssets).toBe(160);
    expect(r.totalLiabilities).toBe(100);
    expect(r.totalEquity).toBe(0);
    expect(r.netIncome).toBe(60);
    expect(r.balanced).toBe(true);
  });
});

describe('bucketForAge', () => {
  it('boundaries', () => {
    expect(bucketForAge(0)).toBe('0-30');
    expect(bucketForAge(30)).toBe('0-30');
    expect(bucketForAge(31)).toBe('31-60');
    expect(bucketForAge(90)).toBe('61-90');
    expect(bucketForAge(121)).toBe('120+');
  });
});

describe('buildAging', () => {
  it('groups by party and buckets by age', () => {
    const asOf = new Date('2026-02-01T00:00:00Z');
    const r = buildAging([
      { partyId: 'c1', partyName: 'Acme', reference: 'INV-1', date: '2026-01-20', outstanding: 50 }, // 12d → 0-30
      { partyId: 'c1', partyName: 'Acme', reference: 'INV-2', date: '2025-12-01', outstanding: 30 }, // 62d → 61-90
    ], asOf);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].buckets['0-30']).toBe(50);
    expect(r.rows[0].buckets['61-90']).toBe(30);
    expect(r.rows[0].total).toBe(80);
    expect(r.grandTotal).toBe(80);
  });
});
