export interface PartIntent {
  jobId: string;
  partId?: string;
  body: {
    operationKey: string;
    expectedUpdatedAt: string;
    catalogItemId?: string;
    binId?: string;
    quantity?: number;
    note?: string;
    reason?: string;
  };
}
const key = (scope: string) => `pulsar.services.parts.v1:${scope}`;
export function readPartIntent(scope: string): PartIntent | null {
  const raw = localStorage.getItem(key(scope));
  if (!raw) return null;
  const v = JSON.parse(raw);
  const b = v?.body;
  if (
    !v ||
    typeof v.jobId !== 'string' ||
    !v.jobId ||
    !b ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      b.operationKey,
    ) ||
    typeof b.expectedUpdatedAt !== 'string' ||
    !Number.isFinite(Date.parse(b.expectedUpdatedAt)) ||
    (v.partId !== undefined
      ? typeof v.partId !== 'string' ||
        !v.partId ||
        typeof b.reason !== 'string' ||
        !b.reason.trim()
      : typeof b.catalogItemId !== 'string' ||
        !b.catalogItemId ||
        typeof b.binId !== 'string' ||
        !b.binId ||
        !Number.isFinite(b.quantity) ||
        b.quantity <= 0 ||
        typeof b.note !== 'string' ||
        !b.note.trim())
  )
    throw new Error(
      'Opération conservée illisible. Faites vérifier le journal avant de réinitialiser le stockage du navigateur.',
    );
  return v;
}
export function rememberPartIntent(scope: string, request: PartIntent) {
  if (readPartIntent(scope)) throw new Error('Une opération attend déjà confirmation.');
  try {
    localStorage.setItem(key(scope), JSON.stringify(request));
  } catch {
    throw new Error('Impossible de conserver la demande. Aucun mouvement envoyé.');
  }
}
export function clearPartIntent(scope: string, operationKey: string) {
  if (readPartIntent(scope)?.body.operationKey === operationKey)
    localStorage.removeItem(key(scope));
}
