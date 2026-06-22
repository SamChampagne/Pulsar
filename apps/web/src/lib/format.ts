/** Money: always 2 decimals + currency code (e.g. "1 840.00 CAD"). */
export function formatMoney(amount: number | string, currency: string): string {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

/** Custom field display: BOOLEAN→Oui/Non, DATE→locale date, else string coercion. */
export function fmtCustomValue(value: unknown, type?: string): string {
  if (value === null || value === undefined) return '—';
  if (type === 'BOOLEAN') return value ? 'Oui' : 'Non';
  if (type === 'DATE' && typeof value === 'string')
    return new Date(value).toLocaleDateString();
  return String(value);
}

/** Date only (no time). */
export function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

/** Date + time. */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}
