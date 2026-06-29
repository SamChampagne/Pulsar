import { describe, it, expect } from 'vitest';
import { computeBudgetVariance } from './budget';

describe('computeBudgetVariance', () => {
  it('variance = budget − actual, with pct and totals', () => {
    const r = computeBudgetVariance([
      { accountCode: '5000', name: 'Charges', budget: 1000, actual: 800 },
      { accountCode: '4000', name: 'Revenus', budget: 5000, actual: 6000 },
    ]);
    expect(r.rows[0]).toEqual({ accountCode: '5000', name: 'Charges', budget: 1000, actual: 800, variance: 200, variancePct: 20 });
    expect(r.rows[1].variance).toBe(-1000);
    expect(r.rows[1].variancePct).toBe(-20);
    expect(r.totalBudget).toBe(6000);
    expect(r.totalActual).toBe(6800);
    expect(r.totalVariance).toBe(-800);
  });

  it('budget 0 → variancePct 0', () => {
    const r = computeBudgetVariance([{ accountCode: '5000', name: 'X', budget: 0, actual: 50 }]);
    expect(r.rows[0].variancePct).toBe(0);
    expect(r.rows[0].variance).toBe(-50);
  });
});
