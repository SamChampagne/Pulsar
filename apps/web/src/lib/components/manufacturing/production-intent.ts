export interface ProductionIntent {
  operationKey: string;
  expectedUpdatedAt: string;
  goodQuantity: number;
  scrapQuantity: number;
  toBinId: string;
  outputLotId?: string;
  note: string;
  consumptions: { itemId: string; fromBinId: string; quantity: string; lotId?: string }[];
}
const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100;
export function readProductionIntent(key: string): ProductionIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const p = JSON.parse(raw);
  if (
    !p ||
    typeof p.operationKey !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.operationKey) ||
    typeof p.expectedUpdatedAt !== 'string' ||
    !Number.isFinite(Date.parse(p.expectedUpdatedAt)) ||
    ![p.goodQuantity, p.scrapQuantity].every((n) => Number.isInteger(n) && n >= 0 && n <= 1e9) ||
    p.goodQuantity + p.scrapQuantity <= 0 ||
    !id(p.toBinId) ||
    typeof p.note !== 'string' ||
    p.note.trim().length < 3 ||
    (p.outputLotId !== undefined && (!id(p.outputLotId) || p.goodQuantity === 0)) ||
    !Array.isArray(p.consumptions) ||
    p.consumptions.length < 1 ||
    p.consumptions.length > 200 ||
    p.consumptions.some(
      (c: ProductionIntent['consumptions'][number]) =>
        !c ||
        !id(c.itemId) ||
        !id(c.fromBinId) ||
        typeof c.quantity !== 'string' ||
        !/^\d{1,9}(\.\d{1,3})?$/.test(c.quantity) ||
        (c.lotId !== undefined && (!id(c.lotId) || Number(c.quantity) === 0)),
    )
  )
    throw new Error(
      'Déclaration conservée illisible. Faites vérifier le journal avant de réinitialiser le stockage.',
    );
  return p;
}
export function rememberProductionIntent(key: string, request: ProductionIntent) {
  const previous = readProductionIntent(key);
  if (previous && JSON.stringify(previous) !== JSON.stringify(request))
    throw new Error('Une autre déclaration attend confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(request));
  } catch {
    throw new Error('Impossible de conserver la déclaration. Aucun mouvement envoyé.');
  }
}
