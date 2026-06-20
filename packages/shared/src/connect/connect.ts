// ============================================================================
// Connect / Ingestion — shared pure types and helpers (no Node, no side effects)
// ============================================================================

// ---------- Enums as TS unions + const arrays --------------------------------

export type InboundSource = 'CSV' | 'PDF' | 'DOCUMENT' | 'WEBHOOK';
export const INBOUND_SOURCES: InboundSource[] = ['CSV', 'PDF', 'DOCUMENT', 'WEBHOOK'];

export type InboundStatus = 'RECEIVED' | 'PARSED' | 'IMPORTED' | 'FAILED' | 'IGNORED';
export const INBOUND_STATUSES: InboundStatus[] = [
  'RECEIVED',
  'PARSED',
  'IMPORTED',
  'FAILED',
  'IGNORED',
];

export type ImportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export const IMPORT_STATUSES: ImportStatus[] = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];

export type ImportRowStatus = 'IMPORTED' | 'FAILED';
export const IMPORT_ROW_STATUSES: ImportRowStatus[] = ['IMPORTED', 'FAILED'];

// ---------- Import target catalog -------------------------------------------

export interface ImportTarget {
  key: string;
  label: string;
  requiredColumns: string[];
  optionalColumns: string[];
  permission: string;
}

export const IMPORT_TARGETS: ImportTarget[] = [
  {
    key: 'customers',
    label: 'Customers',
    requiredColumns: ['code', 'name'],
    optionalColumns: ['contactName', 'email', 'phone', 'notes'],
    permission: 'transportation.master-data.manage',
  },
  {
    key: 'carriers',
    label: 'Carriers',
    requiredColumns: ['code', 'name'],
    optionalColumns: ['scacCode', 'mcNumber', 'dotNumber', 'contactName', 'email', 'phone'],
    permission: 'transportation.master-data.manage',
  },
  {
    key: 'locations',
    label: 'Locations',
    requiredColumns: ['code', 'name', 'type', 'addressLine1', 'city'],
    optionalColumns: [
      'addressLine2',
      'state',
      'postalCode',
      'country',
      'latitude',
      'longitude',
      'timezone',
    ],
    permission: 'transportation.master-data.manage',
  },
  {
    key: 'items',
    label: 'Items (WMS)',
    requiredColumns: ['sku', 'name'],
    optionalColumns: ['unit', 'barcode', 'reorderPoint', 'reorderQty'],
    permission: 'wms.manage',
  },
  {
    key: 'vehicles',
    label: 'Vehicles',
    requiredColumns: ['unitNumber', 'type'],
    optionalColumns: ['carrierId', 'make', 'model', 'year', 'vin', 'plate'],
    permission: 'transportation.master-data.manage',
  },
  {
    key: 'trailers',
    label: 'Trailers',
    requiredColumns: ['unitNumber', 'type'],
    optionalColumns: [
      'carrierId',
      'capacityWeightKg',
      'capacityVolumeM3',
      'capacityPallets',
      'plate',
    ],
    permission: 'transportation.master-data.manage',
  },
];

export function getImportTarget(key: string): ImportTarget | undefined {
  return IMPORT_TARGETS.find((t) => t.key === key);
}

// ---------- Pure helpers -----------------------------------------------------

const NUMERIC_FIELDS = new Set([
  'latitude',
  'longitude',
  'year',
  'reorderPoint',
  'reorderQty',
  'capacityWeightKg',
  'capacityVolumeM3',
  'capacityPallets',
]);

/**
 * Renames CSV columns → DTO fields according to the mapping, trimming each value.
 * mapping: { [dtoField]: csvColumnHeader }
 * Returns a record with only the mapped fields that exist in the row.
 */
export function applyMapping(
  row: Record<string, string>,
  mapping: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [field, column] of Object.entries(mapping)) {
    if (column in row) {
      result[field] = row[column].trim();
    }
  }
  return result;
}

/**
 * Returns the list of required fields that are missing (undefined) or empty ('') in the record.
 */
export function validateRequired(
  record: Record<string, unknown>,
  requiredColumns: string[],
): string[] {
  return requiredColumns.filter((col) => {
    const val = record[col];
    return val === undefined || val === null || val === '';
  });
}

/**
 * Coerces known numeric fields to numbers when present and parseable.
 * Drops empty strings. Leaves other values as strings.
 *
 * Security: only fields declared in the target's required/optional columns are
 * kept. This prevents a caller-controlled mapping from smuggling arbitrary model
 * fields (e.g. `tenantId`, `id`, `createdById`) into the downstream create.
 */
export function coerceTypes(
  record: Record<string, string>,
  target: ImportTarget,
): Record<string, unknown> {
  const allowed = new Set([...target.requiredColumns, ...target.optionalColumns]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!allowed.has(key)) continue; // drop unknown/injected fields
    if (value === '') continue; // drop empty strings
    if (NUMERIC_FIELDS.has(key)) {
      const n = Number(value);
      result[key] = isNaN(n) ? value : n;
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------- Minimal robust CSV parser ----------------------------------------

/**
 * Parses a CSV string into headers + rows. Pure, no Node dependencies.
 * Handles:
 *   - Quoted fields (double-quote escaping: "" → ")
 *   - Commas inside quoted fields
 *   - CRLF and LF line endings
 *   - Trailing newline (ignored)
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // Normalise line endings to LF, strip trailing newline
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
  const lines = splitLines(normalised);

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseRow(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

/** Split CSV text into logical lines, respecting quoted fields that span lines. */
function splitLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === '\n' && !inQuote) {
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Parse a single CSV line into an array of field values. */
function parseRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuote = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        // Escaped double-quote
        field += '"';
        i += 2;
        continue;
      }
      inQuote = !inQuote;
      i++;
    } else if (ch === ',' && !inQuote) {
      fields.push(field);
      field = '';
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  fields.push(field);
  return fields;
}
