import { CURRENCIES, isCalendarDate, validateLedgerLines } from '@pulsar/shared';
export interface LedgerIntent {
  operationKey: string;
  currency: string;
  date: string;
  memo?: string;
  lines: { accountCode: string; debit?: string; credit?: string; memo?: string }[];
}
export function readLedgerIntent(key: string): LedgerIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (
      !v ||
      !isCalendarDate(v.date) ||
      !CURRENCIES.some((c) => c.code === v.currency) ||
      typeof v.operationKey !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v.operationKey)
    )
      throw Error();
    validateLedgerLines(v.lines);
    return v;
  } catch {
    throw Error(
      'Demande comptable conservée illisible. Faites vérifier le journal avant toute nouvelle saisie.',
    );
  }
}
export function rememberLedgerIntent(key: string, p: LedgerIntent) {
  const prior = readLedgerIntent(key);
  if (prior && JSON.stringify(prior) !== JSON.stringify(p))
    throw Error('Une écriture attend déjà confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    throw Error('Impossible de conserver la demande. Rien n’a été envoyé.');
  }
}
