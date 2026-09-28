export interface ViewColumn {
  key: string;
  label: string;
  width?: number;
  required?: boolean;
}
export interface TableView {
  hidden: string[];
  widths: Record<string, number>;
}
export const columnWidth = (width: number) => Math.min(640, Math.max(100, Math.round(width)));
export function normalizeTableView(input: unknown, columns: ViewColumn[]): TableView {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<TableView>;
  const hidden = columns
    .filter((c) => !c.required && Array.isArray(raw.hidden) && raw.hidden.includes(c.key))
    .map((c) => c.key);
  // Even a misconfigured persisted view must leave an identifiable record visible.
  if (hidden.length === columns.length) hidden.shift();
  const widths = Object.fromEntries(
    columns.map((c) => {
      const width = raw.widths?.[c.key];
      return [
        c.key,
        columnWidth(typeof width === 'number' && Number.isFinite(width) ? width : (c.width ?? 180)),
      ];
    }),
  );
  return { hidden, widths };
}
