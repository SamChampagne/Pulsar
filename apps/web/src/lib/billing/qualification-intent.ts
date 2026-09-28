import { validateLedgerQualification } from '@pulsar/shared';
export interface QualificationIntent {
  entryId: string;
  body: {
    action: 'QUALIFY' | 'WITHDRAW';
    currency: string;
    reason: string;
    evidenceId: string;
    expectedVersion: number;
    operationKey: string;
    reviewToken: string;
    confirmed: true;
  };
}
export function validateQualificationIntent(p: QualificationIntent): QualificationIntent {
  if (
    !p ||
    Object.keys(p).some((k) => !['entryId', 'body'].includes(k)) ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(p.entryId) ||
    !p.body
  )
    throw Error('Dossier invalide.');
  validateLedgerQualification(p.body);
  if (
    Object.keys(p.body).some(
      (k) =>
        ![
          'action',
          'currency',
          'reason',
          'evidenceId',
          'expectedVersion',
          'operationKey',
          'reviewToken',
          'confirmed',
        ].includes(k),
    )
  )
    throw Error('Champ inattendu.');
  if (
    p.body.confirmed !== true ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      p.body.operationKey,
    ) ||
    !/^[a-f0-9]{64}$/.test(p.body.reviewToken)
  )
    throw Error('Confirmation invalide.');
  return p;
}
export function readQualificationIntent(key: string): QualificationIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return validateQualificationIntent(JSON.parse(raw));
  } catch {
    throw Error('Demande conservée illisible. Faites vérifier son résultat avant de poursuivre.');
  }
}
export function rememberQualificationIntent(key: string, p: QualificationIntent) {
  validateQualificationIntent(p);
  const prior = readQualificationIntent(key);
  if (prior && JSON.stringify(prior) !== JSON.stringify(p))
    throw Error('Une confirmation est déjà en attente.');
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    throw Error('Impossible de conserver la demande; rien n’a été envoyé.');
  }
}
