// ============================================================================
// Integration field mapping — pure, browser-safe (no Node, no side effects).
//
// One engine, two consumers:
//   - the studio dry run (`IntegrationsService.buildDryRunMapping`), lenient:
//     an unknown transform is a no-op, exactly as before this file existed;
//   - the inbound webhook receiver, STRICT: an unknown transform is an error,
//     because silently writing an untransformed value into a business service
//     is data corruption, not a UI preview.
//
// Note on naming: the barrel already exports a CSV-column `applyMapping`
// (`connect/connect.ts`). This one is exported as `applyIntegrationMapping`
// so both can live in `@pulsar/shared` without an ambiguous re-export.
// ============================================================================

/**
 * One mapping row as the integration studio writes it into `config.mappings`.
 * `from`/`to` are accepted as aliases by `normalizeMappingRules`.
 */
export interface MappingRule {
  /** Dotted path read from the incoming payload, e.g. `order.customer.code`. */
  source: string;
  /** Dotted path written into the output object, e.g. `customerCode`. */
  target: string;
  /** Transform key, see `MAPPING_TRANSFORMS`. Absent/`none` = verbatim. */
  transform?: string;
  /** A missing/empty source value is reported as an error instead of skipped. */
  required?: boolean;
}

export type MappingRowStatus = 'mapped' | 'missing' | 'skipped';

export interface MappingRowResult extends MappingRule {
  status: MappingRowStatus;
  value?: unknown;
}

export interface MappingResult {
  /** Object built from the `target` paths of every mapped row. */
  output: Record<string, unknown>;
  rows: MappingRowResult[];
  /** Missing required sources (+ unknown transforms in strict mode). */
  errors: string[];
}

export interface ApplyMappingOptions {
  /**
   * Reject an unknown transform instead of passing the value through.
   * Used by the inbound webhook receiver; the studio dry run stays lenient.
   */
  strictTransforms?: boolean;
}

/** Transform keys understood by `applyIntegrationTransform` (prefix forms included). */
export const MAPPING_TRANSFORMS = [
  'none',
  'trim',
  'uppercase',
  'number',
  'date.iso',
  'default:<value>',
  'concat:<separator>',
] as const;

const PREFIX_TRANSFORMS = ['default:', 'concat:'] as const;
const PLAIN_TRANSFORMS = new Set(['', 'none', 'trim', 'uppercase', 'number', 'date.iso']);

/** True when `transform` is one of the supported keys (prefix forms included). */
export function isKnownTransform(transform?: string): boolean {
  const op = transform ?? '';
  if (PLAIN_TRANSFORMS.has(op)) return true;
  return PREFIX_TRANSFORMS.some((prefix) => op.startsWith(prefix));
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Applies one transform to one value. `default:<v>` is the only transform that
 * produces a value out of an empty input; every other transform leaves
 * null/undefined untouched.
 *
 * @throws Error when `strict` and the transform key is unknown.
 */
export function applyIntegrationTransform(
  value: unknown,
  transform?: string,
  strict = false,
): unknown {
  const op = transform ?? '';
  if (op.startsWith('default:')) {
    return isEmpty(value) ? op.slice('default:'.length) : value;
  }
  if (value == null) return value;
  if (op.startsWith('concat:')) {
    const separator = op.slice('concat:'.length);
    return Array.isArray(value) ? value.filter((v) => !isEmpty(v)).join(separator) : String(value);
  }
  if (op === 'trim' && typeof value === 'string') return value.trim();
  if (op === 'uppercase' && typeof value === 'string') return value.toUpperCase();
  if (op === 'number') return Number(value);
  if (op === 'date.iso') return new Date(String(value)).toISOString();
  if (strict && !PLAIN_TRANSFORMS.has(op)) {
    throw new Error(`Unknown transform: "${op}"`);
  }
  return value;
}

/** Reads a dotted path out of a plain object (arrays are not traversed). */
export function getMappingPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

/** Writes a value at a dotted path, creating intermediate objects as needed. */
export function setMappingPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split('.').filter(Boolean);
  if (!segments.length) return;
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Coerces whatever sits in `config.mappings` into well-formed rules.
 * Accepts the studio shape (`source`/`target`) and the `from`/`to` aliases.
 * Rows without a source AND without a target are dropped.
 */
export function normalizeMappingRules(value: unknown): MappingRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object' && !Array.isArray(item),
    )
    .map((item) => ({
      source: asString(item.source) || asString(item.from),
      target: asString(item.target) || asString(item.to),
      transform: asString(item.transform) || 'none',
      required: Boolean(item.required),
    }))
    .filter((item) => item.source || item.target);
}

/**
 * Applies a mapping to an incoming payload.
 *
 * Pure: no clock, no I/O. A row whose source is missing/empty is `missing`
 * (and an error when `required`); a row missing source or target is `skipped`.
 */
export function applyIntegrationMapping(
  payload: Record<string, unknown>,
  mappings: MappingRule[],
  options: ApplyMappingOptions = {},
): MappingResult {
  const strict = options.strictTransforms === true;
  const errors: string[] = [];
  if (strict) {
    for (const mapping of mappings) {
      if (!isKnownTransform(mapping.transform)) {
        errors.push(`Unknown transform: "${mapping.transform}"`);
      }
    }
  }
  const output: Record<string, unknown> = {};
  const rows: MappingRowResult[] = mappings.map((mapping) => {
    if (!mapping.source || !mapping.target) {
      return { ...mapping, status: 'skipped' as const };
    }
    const op = mapping.transform ?? '';
    const isDefault = op.startsWith('default:');
    // `default:` is the only transform that turns an empty source into a value,
    // so it runs BEFORE the emptiness check; every other transform runs after
    // it (identical to the pre-extraction dry-run behaviour: an empty source is
    // `missing`, never coerced — e.g. `number` on '' stays missing, not 0).
    const raw = getMappingPath(payload, mapping.source);
    const seed = isDefault ? applyIntegrationTransform(raw, op) : raw;
    if (isEmpty(seed)) {
      if (mapping.required) errors.push(`Champ requis manquant: ${mapping.source}`);
      return { ...mapping, status: 'missing' as const };
    }
    let value: unknown;
    try {
      // Unknown transforms were already collected above (strict mode); here the
      // try/catch guards value-level failures such as `date.iso` on garbage.
      value = isDefault ? seed : applyIntegrationTransform(seed, op);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      return { ...mapping, status: 'skipped' as const };
    }
    setMappingPath(output, mapping.target, value);
    return { ...mapping, status: 'mapped' as const, value };
  });
  return { output, rows, errors };
}
