export interface ReversalIntent {
  declarationId: string;
  body: { operationKey: string; expectedUpdatedAt: string; reviewToken: string; reason: string };
}
export function readReversalIntent(key: string): ReversalIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const p = JSON.parse(raw);
  if (
    !p ||
    typeof p.declarationId !== 'string' ||
    !p.declarationId ||
    p.declarationId.length > 100 ||
    !p.body ||
    typeof p.body.operationKey !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.body.operationKey) ||
    typeof p.body.expectedUpdatedAt !== 'string' ||
    !Number.isFinite(Date.parse(p.body.expectedUpdatedAt)) ||
    typeof p.body.reviewToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(p.body.reviewToken) ||
    typeof p.body.reason !== 'string' ||
    p.body.reason.trim().length < 3 ||
    p.body.reason.length > 1000
  )
    throw new Error(
      'Correction conservée illisible. Faites vérifier le journal avant toute réinitialisation.',
    );
  return p;
}
export function rememberReversalIntent(key: string, request: ReversalIntent) {
  const old = readReversalIntent(key);
  if (old && JSON.stringify(old) !== JSON.stringify(request))
    throw new Error('Une correction attend déjà confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(request));
  } catch {
    throw new Error('Impossible de conserver la correction. Aucun mouvement envoyé.');
  }
}
