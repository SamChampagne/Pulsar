/**
 * Pure label/filter helpers behind `EntityPicker`.
 *
 * Kept out of the component so they can be unit-tested: the picker feeds on
 * heterogeneous list endpoints (locations expose `name`, bins `code`/`zone`,
 * vehicles `unitNumber`, drivers `firstName`/`lastName`, GL accounts a bare
 * array of `code`/`name`) and silently rendering an empty row for any of them
 * was the bug the audit found.
 */

/** A list row as returned by an API endpoint — shape depends on the endpoint. */
export type PickerRecord = Record<string, unknown>;

export interface PickerLabel {
  label: string;
  detail?: string;
}

/** Keys tried, in order, when the requested `labelKey` yields nothing. */
const FALLBACK_KEYS = ['name', 'code', 'label', 'unitNumber', 'number', 'sku', 'title', 'id'];

/** Renders one field value as display text. Only strings and finite numbers
 *  produce text — objects/booleans/null yield '' rather than "[object Object]". */
function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Resolves a label key that may name several fields ("firstName lastName"),
 *  joining the non-empty parts with a single space. */
function textFor(item: PickerRecord, key: string): string {
  const parts = key.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return text(item[key]);
  return parts
    .map((part) => text(item[part]))
    .filter(Boolean)
    .join(' ');
}

/**
 * Display text for one picker row.
 *
 * `labelKey` may name a single field or several whitespace-separated fields
 * (`'firstName lastName'`). When it resolves to nothing, the usual identifying
 * keys are tried so a caller that forgot `labelKey` still sees a row rather
 * than a blank button. `detail` is the optional secondary line and is omitted
 * when blank.
 */
export function formatItem(item: PickerRecord, labelKey = 'name', detailKey?: string): PickerLabel {
  if (!item || typeof item !== 'object') return { label: '' };
  let label = textFor(item, labelKey);
  if (!label) {
    for (const key of FALLBACK_KEYS) {
      label = text(item[key]);
      if (label) break;
    }
  }
  const detail = detailKey ? text(item[detailKey]) : '';
  return detail ? { label, detail } : { label };
}

/** Case- and accent-insensitive comparison key. */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Client-side search over an already-loaded array (`listShape: 'array'`
 * endpoints such as the chart of accounts, which returns every account at once
 * and takes no `search` parameter). Matches a substring on any of `keys`,
 * ignoring case and accents, and preserves the source order.
 */
export function filterArray<T extends PickerRecord>(
  items: readonly T[],
  query: string,
  keys: readonly string[],
): T[] {
  if (!Array.isArray(items)) return [];
  const needle = normalize((query ?? '').trim());
  if (!needle) return [...items];
  if (!keys.length) return [];
  return items.filter((item) =>
    keys.some((key) => {
      const value = textFor(item, key);
      return value !== '' && normalize(value).includes(needle);
    }),
  );
}
