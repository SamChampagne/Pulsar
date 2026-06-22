export interface ReconciliationLine {
  /** Expected amount (the draft line, from the estimated load cost). */
  expected: number;
  /** Amount on the carrier's actual invoice. */
  invoiced: number;
}

export interface ReconciliationTolerance {
  /** Percent of the invoiced total. */
  tolerancePct: number;
  /** Absolute floor, in the invoice currency — protects small invoices. */
  toleranceAbsolute: number;
}

export interface ReconciliationOutcome {
  invoicedTotal: number;
  /** Net (signed) variance — display only. */
  varianceTotal: number;
  /** Sum of |line variance| — carries the tolerance check. |net| ≤ gross, so a
   *  single gross test also catches compensating line errors (+100/−100). */
  varianceGross: number;
  withinTolerance: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Tolerance threshold = max(absolute, invoicedTotal × pct/100): the absolute
 * value floors small invoices. Some customers will want min() (stricter) — that
 * becomes a third `toleranceMode` setting the day it is asked for.
 */
export function evaluateReconciliation(
  lines: ReconciliationLine[],
  tolerance: ReconciliationTolerance,
  mode: 'MAX' | 'MIN' = 'MAX',
): ReconciliationOutcome {
  const invoicedTotal = round(lines.reduce((acc, l) => acc + l.invoiced, 0));
  const varianceTotal = round(lines.reduce((acc, l) => acc + (l.invoiced - l.expected), 0));
  const varianceGross = round(
    lines.reduce((acc, l) => acc + Math.abs(l.invoiced - l.expected), 0),
  );
  const pct = (invoicedTotal * tolerance.tolerancePct) / 100;
  const threshold = mode === 'MIN'
    ? Math.min(tolerance.toleranceAbsolute, pct)
    : Math.max(tolerance.toleranceAbsolute, pct);
  return { invoicedTotal, varianceTotal, varianceGross, withinTolerance: varianceGross <= threshold };
}
