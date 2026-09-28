export interface SupplierScheduleIntent {
  path: string;
  body: Record<string, unknown> & { operationKey: string };
}
export function readSupplierScheduleIntent(
  key: string,
  invoiceId: string,
): SupplierScheduleIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    throw Error(
      'Demande conservée illisible. Faites vérifier le registre avant toute nouvelle saisie.',
    );
  }
  if (
    !p ||
    p.path !== `/billing/supplier-schedules/invoice/${invoiceId}/confirm` ||
    !p.body ||
    typeof p.body !== 'object' ||
    Array.isArray(p.body) ||
    !/^[-a-zA-Z0-9_]{1,100}$/.test(invoiceId) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      p.body.operationKey,
    )
  )
    throw Error(
      'Demande conservée illisible ou étrangère à cette facture. Faites vérifier le registre.',
    );
  return p;
}
export function rememberSupplierScheduleIntent(
  key: string,
  invoiceId: string,
  p: SupplierScheduleIntent,
) {
  const prior = readSupplierScheduleIntent(key, invoiceId);
  if (prior && JSON.stringify(prior) !== JSON.stringify(p))
    throw Error('Une demande attend déjà confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    throw Error('Impossible de conserver la demande. Rien n’a été envoyé.');
  }
}
