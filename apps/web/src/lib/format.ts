/** Money: always 2 decimals + currency code (e.g. "1 840.00 CAD"). */
export function formatMoney(amount: number | string, currency: string): string {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

/** Date only (no time). */
export function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

/** Date + time. */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}
