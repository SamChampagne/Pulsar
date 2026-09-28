export interface SupplierCreditIntent {
  method: 'POST' | 'PUT';
  path: string;
  body: Record<string, unknown> & { operationKey: string };
}
export function readSupplierCreditIntent(key: string): SupplierCreditIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const p = JSON.parse(raw);
  if (
    !p ||
    !['POST', 'PUT'].includes(p.method) ||
    typeof p.path !== 'string' ||
    !/^\/billing\/supplier-credits(?:\/[a-zA-Z0-9_-]{1,100}(?:\/(?:qualify|cancel))?)?$/.test(
      p.path,
    ) ||
    !p.body ||
    typeof p.body !== 'object' ||
    Array.isArray(p.body) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      p.body.operationKey,
    )
  )
    throw Error(
      'Demande conservée illisible. Faites vérifier le registre avant toute nouvelle saisie.',
    );
  return p;
}
export function rememberSupplierCreditIntent(key: string, p: SupplierCreditIntent) {
  const prior = readSupplierCreditIntent(key);
  if (prior && JSON.stringify(prior) !== JSON.stringify(p))
    throw Error('Une demande attend déjà confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    throw Error('Impossible de conserver la demande. Rien n’a été envoyé.');
  }
}
