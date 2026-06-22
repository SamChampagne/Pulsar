export enum CustomFieldEntity {
  TRANSPORT_ORDER = 'TRANSPORT_ORDER',
  SHIPMENT = 'SHIPMENT',
  LOAD = 'LOAD',
}

export enum CustomFieldType {
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  DATE = 'DATE',
  BOOLEAN = 'BOOLEAN',
  SELECT = 'SELECT',
}

export interface CustomFieldDefinition {
  key: string;
  label: string;
  type: CustomFieldType;
  options?: { value: string; label: string }[];
  required: boolean;
  showInList: boolean;
  sortOrder: number;
}

export type CustomFieldValues = Record<string, string | number | boolean | null>;

const KEY_RE = /^[a-z][a-zA-Z0-9_]{0,39}$/;

/** Validates a custom-field definition list for shape/uniqueness (used by the write endpoint). */
export function validateDefinitions(
  defs: CustomFieldDefinition[],
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (!KEY_RE.test(d.key)) errors.push(`Invalid key "${d.key}"`);
    if (seen.has(d.key)) errors.push(`Duplicate key "${d.key}"`);
    seen.add(d.key);
    if (d.type === CustomFieldType.SELECT && (!d.options || d.options.length === 0)) {
      errors.push(`SELECT field "${d.key}" needs options`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function isIsoDate(v: unknown): boolean {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/** Validates a values payload against the tenant's definitions. */
export function validateCustomFields(
  defs: CustomFieldDefinition[],
  data: unknown,
  opts: { partial?: boolean } = {},
): { ok: true; value: CustomFieldValues } | { ok: false; errors: string[] } {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['customData must be an object'] };
  }
  const input = data as Record<string, unknown>;
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const errors: string[] = [];
  const value: CustomFieldValues = {};

  for (const [k, raw] of Object.entries(input)) {
    const d = byKey.get(k);
    if (!d) {
      errors.push(`Unknown field "${k}"`);
      continue;
    }
    if (raw === null || raw === '') {
      value[k] = null;
      continue;
    }
    switch (d.type) {
      case CustomFieldType.TEXT:
        if (typeof raw !== 'string') errors.push(`Field "${k}" must be text`);
        else value[k] = raw;
        break;
      case CustomFieldType.NUMBER:
        if (typeof raw !== 'number' || !Number.isFinite(raw)) errors.push(`Field "${k}" must be a number`);
        else value[k] = raw;
        break;
      case CustomFieldType.DATE:
        if (!isIsoDate(raw)) errors.push(`Field "${k}" must be a date`);
        else value[k] = raw as string;
        break;
      case CustomFieldType.BOOLEAN:
        if (typeof raw !== 'boolean') errors.push(`Field "${k}" must be a boolean`);
        else value[k] = raw;
        break;
      case CustomFieldType.SELECT:
        if (typeof raw !== 'string' || !d.options?.some((o) => o.value === raw)) {
          errors.push(`Field "${k}" must be one of the allowed options`);
        } else value[k] = raw;
        break;
    }
  }

  if (!opts.partial) {
    for (const d of defs) {
      if (d.required) {
        const v = value[d.key];
        if (v === undefined || v === null) errors.push(`Field "${d.label}" is required`);
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}
