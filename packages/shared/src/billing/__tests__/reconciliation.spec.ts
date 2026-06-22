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

describe('evaluateReconciliation mode', () => {
  const lines = [{ expected: 1000, invoiced: 1040 }]; // gross variance 40
  const tol = { tolerancePct: 2, toleranceAbsolute: 25 }; // pct of 1040 = 20.8; max=25, min=20.8

  it('MAX (default) uses max(absolute, pct) — 40 > 25 → outside', () => {
    expect(evaluateReconciliation(lines, tol).withinTolerance).toBe(false);
    expect(evaluateReconciliation(lines, tol, 'MAX').withinTolerance).toBe(false);
  });

  it('a within-MAX case: gross 20 ≤ 25', () => {
    expect(evaluateReconciliation([{ expected: 1000, invoiced: 1020 }], tol, 'MAX').withinTolerance).toBe(true);
  });

  it('MIN tightens: threshold = min(25, 20.8)=20.8 → gross 20 still in, gross 22 out', () => {
    expect(evaluateReconciliation([{ expected: 1000, invoiced: 1020 }], tol, 'MIN').withinTolerance).toBe(true);
    expect(evaluateReconciliation([{ expected: 1000, invoiced: 1022 }], tol, 'MIN').withinTolerance).toBe(false);
  });
});
