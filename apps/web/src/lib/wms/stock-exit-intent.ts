export type StockExitIntent = {
  action: 'create' | 'post' | 'cancel';
  id?: string;
  body: Record<string, unknown> & { operationKey: string };
};
export function readStockExitIntent(key: string): StockExitIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const p = JSON.parse(raw);
  const text = (v: unknown, min = 1, max = 2000) =>
    typeof v === 'string' && v.trim().length >= min && v.length <= max;
  const b = p?.body;
  if (
    !p ||
    !['create', 'post', 'cancel'].includes(p.action) ||
    !b ||
    typeof b !== 'object' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      b.operationKey,
    ) ||
    (p.action !== 'create' &&
      (!text(p.id, 1, 100) ||
        !text(b.expectedUpdatedAt) ||
        !Number.isFinite(Date.parse(b.expectedUpdatedAt)))) ||
    (p.action === 'create' &&
      (!['DISPOSAL', 'SUPPLIER_RETURN'].includes(b.kind) ||
        ((b.purchaseSourceId !== undefined || b.purchaseSourceToken !== undefined) &&
          (b.kind !== 'SUPPLIER_RETURN' ||
            !text(b.purchaseSourceId, 1, 100) ||
            !text(b.purchaseSourceToken, 64, 64) ||
            !/^[a-f0-9]{64}$/.test(b.purchaseSourceToken))) ||
        !text(b.itemId, 1, 100) ||
        !text(b.lotId, 1, 100) ||
        !text(b.binId, 1, 100) ||
        typeof b.quantity !== 'string' ||
        !/^\d{1,9}(\.\d{1,3})?$/.test(b.quantity) ||
        Number(b.quantity) <= 0 ||
        !text(b.reason, 3, 1000) ||
        (b.kind === 'SUPPLIER_RETURN' &&
          (!text(b.supplierId, 1, 100) ||
            !text(b.reference, 3, 200) ||
            !text(b.destination, 10, 1000))))) ||
    (p.action === 'post' &&
      (!text(b.completionNote, 10, 2000) ||
        b.confirmed !== true ||
        !text(b.reviewToken, 64, 64) ||
        !/^[a-f0-9]{64}$/.test(b.reviewToken))) ||
    (p.action === 'cancel' && !text(b.reason, 3, 1000))
  )
    throw new Error(
      'Demande de sortie conservée illisible. Faites vérifier le registre avant toute réinitialisation.',
    );
  return p;
}
export function rememberStockExitIntent(key: string, p: StockExitIntent) {
  const old = readStockExitIntent(key);
  if (old && JSON.stringify(old) !== JSON.stringify(p))
    throw new Error('Une sortie attend déjà confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    throw new Error('Impossible de conserver la demande. Aucune sortie envoyée.');
  }
}
