/** UTC bounds of fiscal year `fiscalYear` starting at month `startMonth` (1–12).
 * startMonth=1 → [fy-01-01 00:00:00.000, fy-12-31 23:59:59.999].
 * Pure: no Date.now / argless new Date. */
export function fiscalYearBounds(fiscalYear: number, startMonth: number): { from: Date; to: Date } {
  const m = Number.isFinite(startMonth) && startMonth >= 1 && startMonth <= 12 ? Math.floor(startMonth) : 1;
  const from = new Date(Date.UTC(fiscalYear, m - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(fiscalYear + 1, m - 1, 1, 0, 0, 0, 0));
  to.setUTCMilliseconds(to.getUTCMilliseconds() - 1); // one year minus 1ms → last instant of the FY
  return { from, to };
}
