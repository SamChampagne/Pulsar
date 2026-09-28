import { describe, expect, it } from 'vitest';
import { reconcileAssetHistory } from './asset-history';
const posting = (amount: string) => [
  { accountCode: '5100', accountType: 'EXPENSE', debit: amount, credit: '0' },
  { accountCode: '1590', accountType: 'ASSET', debit: '0', credit: amount },
];
const input = {
  cost: '1200',
  salvage: '0',
  accumulated: '200',
  acquisitionDate: '2024-01-15',
  throughMonth: '2026-09',
  periods: [
    { period: '2024-01', amount: '100', lines: posting('100') },
    { period: '2024-03', amount: '100', lines: posting('100') },
  ],
};
describe('Recorded asset history', () => {
  it('reconciles recorded periods without manufacturing a continuous or future plan', () => {
    expect(reconcileAssetHistory(input)).toEqual({
      cost: '1200.00',
      salvageValue: '0.00',
      accumulatedAmount: '200.00',
      recordedBookValue: '1000.00',
      periodCount: 2,
      firstPeriod: '2024-01',
      lastPeriod: '2024-03',
      unrecordedMonthCount: 1,
    });
    expect(reconcileAssetHistory({ ...input, periods: [...input.periods].reverse() })).toEqual(
      reconcileAssetHistory(input),
    );
  });
  it('does not infer amounts from a monthly formula or require current account configuration', () => {
    const periods = [
      { period: '2024-01', amount: '99.99', lines: posting('99.99') },
      {
        period: '2024-02',
        amount: '100.01',
        lines: posting('100.01').map((l) => ({ ...l, accountCode: l.accountCode + 'A' })),
      },
    ];
    expect(reconcileAssetHistory({ ...input, periods })).toMatchObject({
      accumulatedAmount: '200.00',
      unrecordedMonthCount: 0,
    });
  });
  it('rejects missing, excess, negative, fractional or inconsistent accumulated history', () => {
    for (const change of [
      { cost: '0' },
      { salvage: '1201' },
      { accumulated: '201' },
      { accumulated: '1201' },
      { periods: [] },
      { accumulated: '200.001' },
      { acquisitionDate: '2024-02-30' },
      { throughMonth: '2023-12' },
      { acquisitionDate: '2024-02-01' },
      { periods: [input.periods[0], input.periods[0]] },
      { periods: [{ ...input.periods[0], period: '2024-13' }] },
      { periods: [{ ...input.periods[0], amount: '-100' }] },
      { periods: Array.from({ length: 1201 }, () => input.periods[0]) },
    ])
      expect(() => reconcileAssetHistory({ ...input, ...change })).toThrow();
  });
  it('rejects wrong direction, account type, unbalanced lines and different posted amounts', () => {
    for (const lines of [
      posting('99'),
      posting('100').map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
      posting('100').map((l) => ({ ...l, accountCode: '5100' })),
      [posting('100')[0]],
      posting('100').map((l) => ({ ...l, accountType: 'REVENUE' })),
    ])
      expect(() =>
        reconcileAssetHistory({
          ...input,
          periods: [{ ...input.periods[0], lines }, input.periods[1]],
        }),
      ).toThrow();
  });
});
