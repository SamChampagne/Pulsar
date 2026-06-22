export type SettingType = 'enum' | 'boolean' | 'number' | 'string';

export interface SettingDescriptor {
  key: string;
  label: string;
  help?: string;
  type: SettingType;
  default: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  pattern?: string;
  maxLength?: number;
}

export interface ModuleSettingsCatalog {
  module: string;
  settings: SettingDescriptor[];
}

export type ResolvedSettings = Record<string, string | number | boolean>;

/** v1 catalog. Defaults MUST equal current hardcoded behavior. */
export const MODULE_SETTINGS_CATALOG: ModuleSettingsCatalog[] = [
  {
    module: 'transportation',
    settings: [
      {
        key: 'capacityOverage',
        label: 'Dépassement de capacité',
        help: 'Comportement quand un load dépasse la capacité à la consolidation.',
        type: 'enum',
        default: 'WARN',
        options: [
          { value: 'WARN', label: 'Avertir (laisser passer)' },
          { value: 'BLOCK', label: 'Bloquer (refuser)' },
        ],
      },
      // NOTE: mode-threshold knobs (modeThresholdParcelMaxKg/LtlMaxKg) were intentionally
      // NOT shipped here. `suggestMode` accepts thresholds, but its only callers are
      // frontend pages using the hardcoded defaults — there is no API consumer yet, so a
      // tenant setting would have no runtime effect. Re-add when a tenant-aware consumer exists.
      { key: 'autoTenderOnPlan', label: 'Auto-tender à la planification', type: 'boolean', default: true },
      {
        key: 'requireTendering',
        label: 'Exigence de tendering',
        help: 'OPTIONAL = libre (tender, auto-tender ou assignation directe). REQUIRED = un tender accepté est obligatoire avant le dispatch. DISABLED = assignation directe seulement.',
        type: 'enum',
        default: 'OPTIONAL',
        options: [
          { value: 'OPTIONAL', label: 'Optionnel (défaut)' },
          { value: 'REQUIRED', label: 'Tender accepté obligatoire' },
          { value: 'DISABLED', label: 'Désactivé (assignation directe)' },
        ],
      },
      { key: 'podRequiredBeforeCompletion', label: 'POD requis avant complétion', type: 'boolean', default: false },
      { key: 'bolRequiredBeforeDispatch', label: 'BOL requis avant dispatch', type: 'boolean', default: false },
      {
        key: 'windowCoherence',
        label: 'Cohérence des fenêtres',
        help: 'STRICT = rejette (400) les fenêtres incohérentes. LENIENT = avertit sans bloquer.',
        type: 'enum',
        default: 'STRICT',
        options: [
          { value: 'STRICT', label: 'Stricte (rejet)' },
          { value: 'LENIENT', label: 'Souple (avertissement)' },
        ],
      },
      { key: 'documentPrefixTransportOrder', label: 'Préfixe n° ordre', type: 'string', default: 'TO', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      { key: 'documentPrefixShipment', label: 'Préfixe n° shipment', type: 'string', default: 'SH', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      { key: 'documentPrefixLoad', label: 'Préfixe n° load', type: 'string', default: 'LD', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
    ],
  },
  {
    module: 'procurement',
    settings: [
      {
        key: 'bidUniqueness',
        label: 'Unicité des soumissions',
        help: 'Un transporteur peut soumettre plusieurs offres, ou une seule par voie (remplace la précédente).',
        type: 'enum',
        default: 'MULTIPLE',
        options: [
          { value: 'MULTIPLE', label: 'Plusieurs offres autorisées' },
          { value: 'SINGLE', label: 'Une offre par voie + transporteur' },
        ],
      },
      { key: 'awardCreatesRateByDefault', label: 'Attribution crée un tarif par défaut', type: 'boolean', default: false },
    ],
  },
  {
    module: 'connect',
    settings: [
      {
        key: 'csvNumberLocale',
        label: 'Format des nombres CSV',
        type: 'enum',
        default: 'EN',
        options: [
          { value: 'EN', label: 'Anglais (1,234.56)' },
          { value: 'FR', label: 'Français (1 234,56)' },
          { value: 'AUTO', label: 'Auto-détection' },
        ],
      },
    ],
  },
  {
    module: 'carrier-portal',
    settings: [
      { key: 'podRequiresDispatched', label: 'POD exige un load dispatché', type: 'boolean', default: false },
    ],
  },
  {
    module: 'billing',
    settings: [
      { key: 'tolerancePct', label: 'Tolérance rapprochement (%)', type: 'number', default: 2, min: 0, max: 100 },
      { key: 'toleranceAbsolute', label: 'Tolérance rapprochement (absolue)', type: 'number', default: 25, min: 0, max: 1000000 },
      { key: 'autoSendOnApproval', label: 'Envoi auto du relevé à l\'approbation', type: 'boolean', default: false },
      {
        key: 'toleranceMode', label: 'Mode de tolérance', type: 'enum', default: 'MAX',
        help: 'MAX = seuil = max(absolu, %). MIN = seuil = min (plus strict).',
        options: [ { value: 'MAX', label: 'Max (défaut)' }, { value: 'MIN', label: 'Min (strict)' } ],
      },
      { key: 'invoiceNumberPrefix', label: 'Préfixe n° facture transporteur', type: 'string', default: 'INV', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      { key: 'customerInvoiceNumberPrefix', label: 'Préfixe n° relevé client', type: 'string', default: 'CINV', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      { key: 'defaultCurrency', label: 'Devise par défaut', type: 'string', default: 'CAD', pattern: '^[A-Z]{3}$', maxLength: 3 },
    ],
  },
  {
    module: 'fleet',
    settings: [
      { key: 'complianceExpiringWindowDays', label: 'Fenêtre « expire bientôt » (jours)', type: 'number', default: 30, min: 1, max: 365 },
    ],
  },
];

export function catalogFor(moduleKey: string): ModuleSettingsCatalog | undefined {
  return MODULE_SETTINGS_CATALOG.find((c) => c.module === moduleKey);
}

function isValid(d: SettingDescriptor, v: unknown): boolean {
  if (d.type === 'boolean') return typeof v === 'boolean';
  if (d.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    if (d.min !== undefined && v < d.min) return false;
    if (d.max !== undefined && v > d.max) return false;
    return true;
  }
  if (d.type === 'string') {
    if (typeof v !== 'string') return false;
    if (d.maxLength !== undefined && v.length > d.maxLength) return false;
    if (d.pattern !== undefined && !new RegExp(d.pattern).test(v)) return false;
    return true;
  }
  // enum
  return typeof v === 'string' && !!d.options?.some((o) => o.value === v);
}

/** Merge stored values over catalog defaults, dropping invalid/unknown keys. */
export function resolveSettings(catalog: ModuleSettingsCatalog, stored: Record<string, unknown>): ResolvedSettings {
  const out: ResolvedSettings = {};
  for (const d of catalog.settings) {
    const v = stored[d.key];
    out[d.key] = v !== undefined && isValid(d, v) ? (v as string | number | boolean) : d.default;
  }
  return out;
}

/** Validate a write patch against the catalog (whitelist keys + type/range/enum). */
export function validateSettings(
  catalog: ModuleSettingsCatalog,
  patch: Record<string, unknown>,
): { ok: true; value: ResolvedSettings } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const value: ResolvedSettings = {};
  const known = new Map(catalog.settings.map((d) => [d.key, d]));
  for (const [k, v] of Object.entries(patch)) {
    const d = known.get(k);
    if (!d) {
      errors.push(`Unknown setting "${k}"`);
      continue;
    }
    if (!isValid(d, v)) {
      errors.push(`Invalid value for "${k}"`);
      continue;
    }
    value[k] = v as string | number | boolean;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
