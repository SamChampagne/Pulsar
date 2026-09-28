import { SUPPLIER_RETURN_QUANTITY, type SupplierReturnReportInput } from '@pulsar/shared';
export function readSupplierReportIntent(key: string): SupplierReturnReportInput | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const p = JSON.parse(raw);
  const text = (v: unknown, min: number, max: number) =>
    typeof v === 'string' && v.trim().length >= min && v.length <= max;
  if (
    !p ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      p.operationKey,
    ) ||
    !Number.isSafeInteger(p.expectedRevision) ||
    p.expectedRevision < 0 ||
    p.expectedRevision > 2147483646 ||
    !['received', 'accepted', 'refused'].every(
      (k) => typeof p[k] === 'string' && SUPPLIER_RETURN_QUANTITY.test(p[k]),
    ) ||
    !text(p.evidenceId, 1, 100) ||
    !text(p.reference, 3, 200) ||
    !text(p.note, 10, 2000) ||
    typeof p.reportedAt !== 'string' ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(p.reportedAt) ||
    !Number.isFinite(Date.parse(p.reportedAt)) ||
    (p.correctionReason !== undefined && !text(p.correctionReason, 10, 1000))
  )
    throw Error(
      'Déclaration conservée illisible. Faites vérifier le suivi avant de la réinitialiser.',
    );
  return p;
}
export function rememberSupplierReportIntent(key: string, p: SupplierReturnReportInput) {
  const previous = readSupplierReportIntent(key);
  if (previous && JSON.stringify(previous) !== JSON.stringify(p))
    throw Error('Une déclaration attend déjà confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    throw Error('Impossible de conserver la demande. Aucune déclaration envoyée.');
  }
}
