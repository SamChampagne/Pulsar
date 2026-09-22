/** Product/process quality. Separate from Fleet DVIR and from physical stock quarantine. */
export enum QualityInspectionStatus {
  DRAFT = 'DRAFT',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}
export enum QualityNonconformityStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}
export enum QualityOutcome {
  PASS = 'PASS',
  FAIL = 'FAIL',
}
export const QUALITY_INSPECTION_LABELS: Record<QualityInspectionStatus, string> = {
  DRAFT: 'À préparer',
  IN_PROGRESS: 'En contrôle',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};
export const QUALITY_NC_LABELS: Record<QualityNonconformityStatus, string> = {
  OPEN: 'À analyser',
  IN_PROGRESS: 'En traitement',
  RESOLVED: 'Action réalisée',
  CLOSED: 'Vérifié et clôturé',
};
export function canTransitionQualityInspection(
  from: QualityInspectionStatus,
  to: QualityInspectionStatus,
) {
  return (
    (
      {
        DRAFT: ['IN_PROGRESS', 'CANCELLED'],
        IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
        COMPLETED: [],
        CANCELLED: [],
      } as Record<string, string[]>
    )[from]?.includes(to) ?? false
  );
}
export function canTransitionQualityNonconformity(
  from: QualityNonconformityStatus,
  to: QualityNonconformityStatus,
) {
  return (
    (
      {
        OPEN: ['IN_PROGRESS'],
        IN_PROGRESS: ['RESOLVED'],
        RESOLVED: ['IN_PROGRESS', 'CLOSED'],
        CLOSED: [],
      } as Record<string, string[]>
    )[from]?.includes(to) ?? false
  );
}
export interface QualityCriterion {
  key: string;
  label: string;
  kind: 'CHECK' | 'NUMBER';
  unit?: string;
  min?: number;
  max?: number;
}
export interface QualityResult {
  key: string;
  value: number | 'PASS' | 'FAIL';
  note: string;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9;
const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
export function validateQualityCriteria(input: unknown): QualityCriterion[] {
  if (!Array.isArray(input) || !input.length || input.length > 30)
    throw new Error('Un plan exige de 1 à 30 critères.');
  const keys = new Set<string>();
  return input.map((c): QualityCriterion => {
    if (
      !object(c) ||
      Object.keys(c).some((k) => !['key', 'label', 'kind', 'unit', 'min', 'max'].includes(k)) ||
      typeof c.key !== 'string' ||
      !/^[a-z][a-z0-9_]{0,39}$/.test(c.key) ||
      keys.has(c.key) ||
      !text(c.label, 200)
    )
      throw new Error(
        'Chaque critère exige une clé unique (lettres minuscules, chiffres, _) et un libellé.',
      );
    keys.add(c.key);
    if (c.kind === 'CHECK') {
      if (c.min !== undefined || c.max !== undefined || c.unit !== undefined)
        throw new Error('Un contrôle conforme/non conforme ne possède pas de bornes ni d’unité.');
      return { key: c.key, label: (c.label as string).trim(), kind: 'CHECK' };
    }
    if (
      c.kind !== 'NUMBER' ||
      !finite(c.min) ||
      !finite(c.max) ||
      c.min > c.max ||
      !text(c.unit, 30)
    )
      throw new Error(
        'Une mesure exige une unité et deux bornes numériques valides, minimum ≤ maximum.',
      );
    return {
      key: c.key,
      label: (c.label as string).trim(),
      kind: 'NUMBER',
      unit: (c.unit as string).trim(),
      min: c.min,
      max: c.max,
    };
  });
}
export function evaluateQualityResults(
  criteria: QualityCriterion[],
  input: unknown,
  requireComplete = false,
) {
  if (!Array.isArray(input) || input.length > 30) throw new Error('Résultats invalides.');
  const seen = new Set<string>();
  const results: QualityResult[] = input.map((r) => {
    if (
      !object(r) ||
      Object.keys(r).some((k) => !['key', 'value', 'note'].includes(k)) ||
      typeof r.key !== 'string' ||
      seen.has(r.key)
    )
      throw new Error('Clé de résultat invalide ou répétée.');
    const c = criteria.find((c) => c.key === r.key);
    seen.add(r.key);
    if (
      !c ||
      (c.kind === 'NUMBER'
        ? !finite(r.value)
        : typeof r.value !== 'string' || !['PASS', 'FAIL'].includes(r.value)) ||
      (r.note !== undefined && (typeof r.note !== 'string' || r.note.length > 2000))
    )
      throw new Error('Une valeur ou sa note ne correspond pas au critère.');
    return {
      key: r.key,
      value: r.value as QualityResult['value'],
      note: typeof r.note === 'string' ? r.note.trim() : '',
    };
  });
  const checks = criteria.map((c) => {
    const r = results.find((r) => r.key === c.key);
    const outcome = !r
      ? null
      : c.kind === 'CHECK'
        ? (r.value as QualityOutcome)
        : Number(r.value) >= c.min! && Number(r.value) <= c.max!
          ? QualityOutcome.PASS
          : QualityOutcome.FAIL;
    return { key: c.key, outcome };
  });
  const missing = checks.filter((c) => !c.outcome).length,
    failed = checks.filter((c) => c.outcome === 'FAIL').length;
  if (requireComplete && missing)
    throw new Error('Renseignez tous les critères avant de terminer le contrôle.');
  return {
    results,
    checks,
    missing,
    failed,
    completed: criteria.length - missing,
    total: criteria.length,
    outcome: missing ? null : failed ? QualityOutcome.FAIL : QualityOutcome.PASS,
  };
}
