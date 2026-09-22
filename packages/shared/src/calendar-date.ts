/** Calendar date contract, with no timezone conversion or legal/day-balance calculation. */
export function isCalendarDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '1900-01-01' &&
    value <= '2199-12-31' &&
    Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) &&
    new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value
  );
}
export function calendarDate(value: unknown): Date {
  if (!isCalendarDate(value))
    throw new Error('Date invalide : utilisez une date réelle entre 1900 et 2199 (AAAA-MM-JJ).');
  return new Date(value + 'T00:00:00.000Z');
}
