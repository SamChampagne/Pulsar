/**
 * Display helpers. The product is French (fr-CA): dates are always formatted
 * with an explicit locale, never the visitor's — an operator in Toronto and one
 * in Québec must read the same string, and `toLocaleDateString()` without a
 * locale silently yields `9/16/2026` on an en-US browser.
 */
const LOCALE = 'fr-CA';
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};
const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: '2-digit',
  minute: '2-digit',
};

/** Money: always 2 decimals + currency code (e.g. "1 840.00 CAD"). */
export function formatMoney(amount: number | string, currency: string): string {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

/** Custom field display: BOOLEAN→Oui/Non, DATE→locale date, else string coercion. */
export function fmtCustomValue(value: unknown, type?: string): string {
  if (value === null || value === undefined) return '—';
  if (type === 'BOOLEAN') return value ? 'Oui' : 'Non';
  if (type === 'DATE' && typeof value === 'string') return formatDate(value);
  return String(value);
}

/** Date only (no time), e.g. "2026-09-16". */
export function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(LOCALE, DATE_OPTIONS) : '—';
}

/** Date + time, e.g. "2026-09-16 14:02". */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString(LOCALE, TIME_OPTIONS) : '—';
}

/** Time only (no date), e.g. "14:02". Falls back to the placeholder for an unparseable value too. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}
