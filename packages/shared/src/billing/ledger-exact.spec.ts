import { describe, it, expect } from 'vitest';
import {
  ledgerCents,
  ledgerAmount,
  formatLedgerAmount,
  validateLedgerLines,
  exactTrialBalance,
  exactProfitAndLoss,
  exactBalanceSheet,
  exactCashFlow,
  exactCurrentAging,
} from './ledger-exact';
describe('currency-qualified ledger arithmetic', () => {
  it('keeps aggregate cents beyond IEEE safe integers and SQL scale', () => {
    const v = '90071992547409930.010000000000000000000';
    expect(ledgerCents(v)).toBe(9007199254740993001n);
    expect(ledgerAmount(ledgerCents(v))).toBe('90071992547409930.01');
    expect(formatLedgerAmount('-1234567.80')).toBe('-1\u202f234\u202f567,80');
  });
  it.each(['1.001', 'NaN', 'Infinity', '1e5', '1,25', '', '--1'])(
    'rejects non-exact amount %s',
    (v) => expect(() => ledgerCents(v)).toThrow(),
  );
  it('normalizes balanced lines without float arithmetic', () => {
    const lines = validateLedgerLines([
      { accountCode: ' 1000 ', debit: '0.10' },
      { accountCode: '1000', debit: '0.20' },
      { accountCode: '4000', credit: '0.30' },
    ]);
    expect(lines[0]).toMatchObject({ accountCode: '1000', debit: '0.10', credit: '0.00' });
  });
  it.each([
    [
      { accountCode: '1000', debit: '1.00' },
      { accountCode: '4000', credit: '1.01' },
    ],
    [
      { accountCode: '1000', debit: '1.001' },
      { accountCode: '4000', credit: '1.001' },
    ],
    [
      { accountCode: '1000', debit: '0' },
      { accountCode: '4000', credit: '0' },
    ],
    [
      { accountCode: '1000', debit: '1', credit: '1' },
      { accountCode: '4000', credit: '1' },
    ],
    [
      { accountCode: '1000', debit: '10000000000' },
      { accountCode: '4000', credit: '10000000000' },
    ],
    [
      { accountCode: '', debit: '1' },
      { accountCode: '4000', credit: '1' },
    ],
  ])('rejects unsafe journal lines', (...lines) =>
    expect(() => validateLedgerLines(lines)).toThrow(),
  );
  it('derives all financial totals exactly', () => {
    const rows = [
      {
        accountId: 'a',
        code: '1000',
        name: 'Cash',
        type: 'ASSET',
        debit: '100.10',
        credit: '20.03',
      },
      {
        accountId: 'r',
        code: '4000',
        name: 'Sales',
        type: 'REVENUE',
        debit: '0.00',
        credit: '100.10',
      },
      {
        accountId: 'e',
        code: '5000',
        name: 'Costs',
        type: 'EXPENSE',
        debit: '20.03',
        credit: '0.00',
      },
    ];
    expect(exactTrialBalance(rows)).toMatchObject({
      totalDebit: '120.13',
      totalCredit: '120.13',
      balanced: true,
    });
    expect(exactProfitAndLoss(rows)).toMatchObject({ netIncome: '80.07' });
    expect(exactBalanceSheet(rows)).toMatchObject({
      totalAssets: '80.07',
      totalLiabilitiesAndEquity: '80.07',
      balanced: true,
    });
    expect(exactCashFlow(rows, ['1000'])).toMatchObject({ netChange: '80.07' });
  });
  it('classifies current positive balances without rounding or inventing historical balances', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const r = exactCurrentAging(
      [
        { partyId: 'a', partyName: 'A', date, outstanding: '0.10' },
        { partyId: 'a', partyName: 'A', date, outstanding: '0.20' },
        { partyId: 'b', partyName: 'B', date, outstanding: '-2.00' },
      ],
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(r.grandTotal).toBe('0.30');
    expect(r.rows).toHaveLength(1);
    expect(r.totals['31-60']).toBe('0.30');
  });
});
