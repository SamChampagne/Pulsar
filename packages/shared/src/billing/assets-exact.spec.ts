import { describe, it, expect } from 'vitest';
import { buildExactAssetPlan, type AssetPlanInput } from './assets-exact';
import { ledgerCents } from './ledger-exact';
const input: AssetPlanInput = {
  currency: 'CAD',
  cost: '100',
  salvageValue: '0',
  usefulLifeMonths: 3,
  acquisitionDate: '2024-01-30',
  depreciationStartMonth: '2024-01',
  depreciationExpenseAccountCode: '5100',
  accumulatedDepreciationAccountCode: '1590',
};
describe('exact frozen asset plan', () => {
  it('allocates rounded cumulative cents, including leap-day boundaries', () => {
    const p = buildExactAssetPlan(input);
    expect(p.rows.map((r) => r.amount)).toEqual(['33.33', '33.34', '33.33']);
    expect(p.rows.map((r) => r.date)).toEqual(['2024-01-31', '2024-02-29', '2024-03-31']);
    expect(p.rows.at(-1)?.bookValue).toBe('0.00');
    expect(p.input.cost).toBe('100.00');
  });
  it('supports zero allocations without negative final months or stalling', () => {
    expect(buildExactAssetPlan({ ...input, cost: '0.01' }).rows.map((r) => r.amount)).toEqual([
      '0.00',
      '0.01',
      '0.00',
    ]);
    expect(
      buildExactAssetPlan({ ...input, cost: '25', salvageValue: '25' }).rows.every(
        (r) => r.amount === '0.00' && r.bookValue === '25.00',
      ),
    ).toBe(true);
  });
  it('conserves every cent across tiny and maximum amounts and long plans', () => {
    for (const cost of ['0', '0.01', '0.05', '1', '9999999999.99'])
      for (const life of [1, 3, 6, 13, 1200]) {
        const p = buildExactAssetPlan({ ...input, cost, usefulLifeMonths: life });
        expect(p.rows.reduce((n, r) => n + ledgerCents(r.amount), 0n)).toBe(ledgerCents(cost));
        expect(
          p.rows.every((r) => ledgerCents(r.amount) >= 0n && ledgerCents(r.bookValue) >= 0n),
        ).toBe(true);
      }
  });
  it('rejects invalid dates, excessive precision, currencies and ambiguous accounts', () => {
    for (const change of [
      { currency: '' },
      { currency: 'XXX' },
      { cost: '1.001' },
      { cost: 1 },
      { cost: '1e2' },
      { cost: '-1' },
      { salvageValue: '101' },
      { usefulLifeMonths: 0 },
      { usefulLifeMonths: 1201 },
      { usefulLifeMonths: 1.5 },
      { acquisitionDate: '2024-02-30' },
      { acquisitionDate: '1899-01-01' },
      { depreciationStartMonth: '2023-12' },
      { depreciationStartMonth: '2199-12', usefulLifeMonths: 2 },
      { accumulatedDepreciationAccountCode: '5100' },
    ])
      expect(() => buildExactAssetPlan({ ...input, ...change } as AssetPlanInput)).toThrow();
  });
  it('never assumes acquisition day prorata or converts currencies', () => {
    const a = buildExactAssetPlan({ ...input, currency: 'USD', salvageValue: '10' });
    expect(a.rows.map((r) => r.amount)).toEqual(['30.00', '30.00', '30.00']);
    expect(a.rows.at(-1)?.bookValue).toBe('10.00');
    expect(a.input.currency).toBe('USD');
  });
});
