import { buildExactAssetPlan, type AssetPlanInput } from '@pulsar/shared';
export interface AssetIntent {
  path: string;
  method: 'POST' | 'PATCH';
  body: Record<string, unknown> & { operationKey: string };
}
export function validateAssetIntent(p: AssetIntent): AssetIntent {
  if (
    !p ||
    !p.body ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      p.body.operationKey,
    )
  )
    throw Error('Clé invalide.');
  const create = p.path === '/billing/fixed-assets' && p.method === 'POST';
  const update = /^\/billing\/fixed-assets\/[a-zA-Z0-9_-]+$/.test(p.path) && p.method === 'PATCH';
  const action =
    p.method === 'POST'
      ? /^\/billing\/fixed-assets\/[a-zA-Z0-9_-]+\/(activate|depreciate|dispose)$/.exec(p.path)?.[1]
      : null;
  if (!create && !update && !action) throw Error('Chemin invalide.');
  const b = p.body;
  if (!create && (!Number.isInteger(b.expectedVersion) || Number(b.expectedVersion) < 1))
    throw Error('Version invalide.');
  let allowed = ['operationKey', 'expectedVersion'];
  if (create || update) {
    for (const [field, max, required] of [
      ['assetCode', 40, true],
      ['name', 120, true],
      ['category', 80, false],
      ['acquisitionReference', 200, false],
    ] as const)
      if (
        typeof b[field] !== 'string' ||
        (b[field] as string).length > max ||
        (required && !(b[field] as string).trim())
      )
        throw Error('Identification invalide.');
    buildExactAssetPlan(b as unknown as AssetPlanInput);
    allowed.push(
      'assetCode',
      'name',
      'category',
      'acquisitionReference',
      'currency',
      'acquisitionDate',
      'depreciationStartMonth',
      'cost',
      'salvageValue',
      'usefulLifeMonths',
      'depreciationExpenseAccountCode',
      'accumulatedDepreciationAccountCode',
    );
    if (create) allowed = allowed.filter((k) => k !== 'expectedVersion');
  } else {
    if (b.confirmed !== true) throw Error('Confirmation obligatoire.');
    allowed.push('confirmed');
    if (action === 'activate') {
      allowed.push('reviewToken');
      if (typeof b.reviewToken !== 'string' || !/^[a-f0-9]{64}$/.test(b.reviewToken))
        throw Error('Revue invalide.');
    }
    if (action === 'depreciate') {
      allowed.push('period');
      if (typeof b.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.period))
        throw Error('Période invalide.');
    }
    if (action === 'dispose') {
      allowed.push('reason');
      if (typeof b.reason !== 'string' || b.reason.trim().length < 3 || b.reason.length > 500)
        throw Error('Motif requis.');
    }
  }
  if (Object.keys(b).some((k) => !allowed.includes(k))) throw Error('Champ inattendu.');
  return p;
}
export function readAssetIntent(key: string): AssetIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return validateAssetIntent(JSON.parse(raw));
  } catch {
    throw Error(
      'Demande conservée illisible. Faites vérifier son résultat avant toute nouvelle saisie.',
    );
  }
}
export function rememberAssetIntent(key: string, p: AssetIntent) {
  validateAssetIntent(p);
  const prior = readAssetIntent(key);
  if (prior && JSON.stringify(prior) !== JSON.stringify(p))
    throw Error('Une demande attend déjà confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    throw Error('Impossible de conserver la demande. Rien n’a été envoyé.');
  }
}
