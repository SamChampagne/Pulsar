export interface ReceiptIntent {
  orderId: string;
  body: {
    operationKey: string;
    expectedUpdatedAt: string;
    locationId: string;
    reference: string;
    customData?: Record<string, unknown>;
    lines: {
      orderLineId: string;
      binId: string;
      quantity: number;
      packageCount?: string;
      lotId?: string;
    }[];
  };
}
const key = (scope: string) => `pulsar.purchasing.receipts.v1:${scope}`;
export function readReceiptIntent(scope: string): ReceiptIntent | null {
  const raw = localStorage.getItem(key(scope));
  if (!raw) return null;
  const v = JSON.parse(raw),
    b = v?.body;
  if (
    !v?.orderId ||
    !b ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      b.operationKey,
    ) ||
    !Number.isFinite(Date.parse(b.expectedUpdatedAt)) ||
    !b.locationId ||
    typeof b.reference !== 'string' ||
    !Array.isArray(b.lines) ||
    !b.lines.length ||
    b.lines.some(
      (l: ReceiptIntent['body']['lines'][number]) =>
        !l.orderLineId ||
        !l.binId ||
        !Number.isFinite(l.quantity) ||
        l.quantity <= 0 ||
        (l.lotId !== undefined && (typeof l.lotId !== 'string' || !l.lotId.trim())) ||
        (l.packageCount !== undefined &&
          (typeof l.packageCount !== 'string' ||
            !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(l.packageCount))),
    )
  )
    throw new Error(
      'Réception conservée illisible. Faites vérifier le journal avant de réinitialiser le stockage.',
    );
  return v;
}
export function rememberReceiptIntent(scope: string, request: ReceiptIntent) {
  if (readReceiptIntent(scope))
    throw new Error('Une réception est déjà en attente de confirmation.');
  localStorage.setItem(key(scope), JSON.stringify(request));
}
export function clearReceiptIntent(scope: string, operationKey: string) {
  if (readReceiptIntent(scope)?.body.operationKey === operationKey)
    localStorage.removeItem(key(scope));
}
