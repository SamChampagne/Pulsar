export enum ServiceQuoteStatus {
  DRAFT = 'DRAFT',
  ACCEPTED = 'ACCEPTED',
  CANCELLED = 'CANCELLED',
}
export function canTransitionServiceQuote(
  from: ServiceQuoteStatus,
  to: ServiceQuoteStatus,
): boolean {
  return (
    from === ServiceQuoteStatus.DRAFT &&
    [ServiceQuoteStatus.ACCEPTED, ServiceQuoteStatus.CANCELLED].includes(to)
  );
}
export interface ServiceQuoteLine {
  catalogItemId: string;
  quantity: number;
  unitPrice: number;
  name: string;
  unit: string;
}
/** Half-open intervals: ending exactly at the next start is not a collision. */
export function serviceIntervalsOverlap(
  start: number,
  minutes: number,
  otherStart: number,
  otherMinutes: number,
): boolean {
  return start < otherStart + otherMinutes * 60000 && otherStart < start + minutes * 60000;
}
export function serviceLocalDateTime(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const p = (name: string) => parts.find((x) => x.type === name)!.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}
/** Reject DST gaps and folds instead of silently scheduling a different wall-clock time. */
export function serviceLocalToInstant(local: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error('Date et heure locales requises.');
  const base = Date.parse(local + ':00Z');
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 16) !== local)
    throw new Error('Date invalide.');
  const matches: string[] = [];
  // Contemporary IANA offsets use quarter-hour increments; the business date range is 2000–2199.
  if (Number(local.slice(0, 4)) < 2000 || Number(local.slice(0, 4)) > 2199)
    throw new Error('Année attendue entre 2000 et 2199.');
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(base + offset * 60000).toISOString();
    if (serviceLocalDateTime(candidate, timeZone) === local) matches.push(candidate);
  }
  if (matches.length !== 1)
    throw new Error(
      'Heure inexistante ou ambiguë au changement d’heure. Choisissez une heure non ambiguë.',
    );
  return matches[0];
}
