import { describe, expect, it } from 'vitest';
import { evaluateReconciliation } from '../reconciliation';

const TOL = { tolerancePct: 2, toleranceAbsolute: 25 };

describe('evaluateReconciliation', () => {
  it('approves when the gross variance is within tolerance', () => {
    const outcome = evaluateReconciliation([{ expected: 800, invoiced: 810 }], TOL);
    expect(outcome.invoicedTotal).toBe(810);
    expect(outcome.varianceTotal).toBe(10);
    expect(outcome.varianceGross).toBe(10);
    expect(outcome.withinTolerance).toBe(true);
  });

  it('catches compensating line errors (net 0, gross over) — the blind-spot test', () => {
    const outcome = evaluateReconciliation(
      [
        { expected: 400, invoiced: 500 },
        { expected: 400, invoiced: 300 },
      ],
      TOL,
    );
    expect(outcome.varianceTotal).toBe(0);
    expect(outcome.varianceGross).toBe(200);
    expect(outcome.withinTolerance).toBe(false);
  });

  it('uses max(absolute, pct) as a floor for small invoices', () => {
    // gross 20 ≤ max(25, 2% of 120 = 2.4) → within tolerance thanks to the floor
    const outcome = evaluateReconciliation([{ expected: 100, invoiced: 120 }], TOL);
    expect(outcome.withinTolerance).toBe(true);
  });

  it('the pct side dominates on large invoices', () => {
    // gross 150 ≤ max(25, 2% of 10150 = 203) → within tolerance
    const outcome = evaluateReconciliation([{ expected: 10000, invoiced: 10150 }], TOL);
    expect(outcome.withinTolerance).toBe(true);
  });

  it('rounds to cents', () => {
    const outcome = evaluateReconciliation([{ expected: 0.1, invoiced: 0.3 }], TOL);
    expect(outcome.varianceGross).toBe(0.2);
  });
});
