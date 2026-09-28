export interface CreditIntent {
  operationKey: string;
  expectedVersion: number;
  reason: string;
  lines: { invoiceLineId: string; quantity: number }[];
}
export function readCreditIntent(key: string): CreditIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  let v: CreditIntent;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error(
      'Demande d’avoir conservée illisible. Faites vérifier son état avant de réinitialiser le stockage.',
    );
  }
  if (
    !v ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v.operationKey,
    ) ||
    !Number.isInteger(v.expectedVersion) ||
    v.expectedVersion < 0 ||
    typeof v.reason !== 'string' ||
    !v.reason.trim() ||
    v.reason.length > 1000 ||
    !Array.isArray(v.lines) ||
    !v.lines.length ||
    v.lines.length > 100 ||
    v.lines.some(
      (l) =>
        !l ||
        typeof l.invoiceLineId !== 'string' ||
        !l.invoiceLineId ||
        !Number.isFinite(l.quantity) ||
        l.quantity <= 0 ||
        l.quantity > 1e9,
    )
  )
    throw new Error(
      'Demande d’avoir conservée illisible. Faites vérifier son état avant de réinitialiser le stockage.',
    );
  return v;
}
export function rememberCreditIntent(key: string, intent: CreditIntent) {
  if (readCreditIntent(key)) throw new Error('Un brouillon attend déjà confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(intent));
  } catch {
    throw new Error('Impossible de conserver la demande. Aucun avoir envoyé.');
  }
}
