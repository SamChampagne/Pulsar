export interface WorkView {
  name: string;
  type: string;
  search: string;
  status: string;
}
export const ROOT_TYPES = ['SALES_ORDER', 'TRANSPORT_ORDER', 'SHIPMENT', 'LOAD'] as const;
/** Browser storage is untrusted input; only filter data is restored, never server records. */
export function parseWorkViews(raw: string | null): WorkView[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (v): v is WorkView =>
          !!v &&
          typeof v === 'object' &&
          typeof v.name === 'string' &&
          v.name.length > 0 &&
          v.name.length <= 50 &&
          ROOT_TYPES.includes(v.type) &&
          typeof v.search === 'string' &&
          v.search.length <= 200 &&
          typeof v.status === 'string' &&
          v.status.length <= 40,
      )
      .slice(0, 10);
  } catch {
    return [];
  }
}
