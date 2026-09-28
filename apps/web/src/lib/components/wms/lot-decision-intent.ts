export interface LotDecisionIntent {
  action: 'quarantine' | 'release';
  body: {
    operationKey: string;
    expectedRevision: number;
    reason: string;
    controlNote?: string;
    qualityInspectionId?: string;
    expectedInspectionUpdatedAt?: string;
  };
}
export function readLotDecisionIntent(key: string): LotDecisionIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const p = JSON.parse(raw);
  if (
    !p ||
    !['quarantine', 'release'].includes(p.action) ||
    !p.body ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      p.body.operationKey,
    ) ||
    !Number.isSafeInteger(p.body.expectedRevision) ||
    p.body.expectedRevision < 0 ||
    typeof p.body.reason !== 'string' ||
    p.body.reason.trim().length < 3 ||
    p.body.reason.length > 1000 ||
    ((p.body.qualityInspectionId !== undefined ||
      p.body.expectedInspectionUpdatedAt !== undefined) &&
      (p.action !== 'release' ||
        typeof p.body.qualityInspectionId !== 'string' ||
        !p.body.qualityInspectionId ||
        p.body.qualityInspectionId.length > 100 ||
        typeof p.body.expectedInspectionUpdatedAt !== 'string' ||
        !Number.isFinite(Date.parse(p.body.expectedInspectionUpdatedAt)))) ||
    (p.action === 'release' &&
      (typeof p.body.controlNote !== 'string' ||
        p.body.controlNote.trim().length < 10 ||
        p.body.controlNote.length > 2000))
  )
    throw new Error(
      'Décision conservée illisible. Faites vérifier l’historique avant toute réinitialisation.',
    );
  return p;
}
export function rememberLotDecisionIntent(key: string, value: LotDecisionIntent) {
  const previous = readLotDecisionIntent(key);
  if (previous && JSON.stringify(previous) !== JSON.stringify(value))
    throw new Error('Une décision attend déjà confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('Impossible de conserver la décision. Aucune demande envoyée.');
  }
}
