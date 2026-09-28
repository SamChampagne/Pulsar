import { CURRENCIES } from '../reference/currencies';
export enum LedgerCurrencyState {
  QUALIFIED = 'QUALIFIED',
  WITHDRAWN = 'WITHDRAWN',
}
export function canTransitionLedgerCurrency(
  from: LedgerCurrencyState | null,
  to: LedgerCurrencyState,
): boolean {
  return to === LedgerCurrencyState.QUALIFIED
    ? from === null || from === LedgerCurrencyState.WITHDRAWN
    : to === LedgerCurrencyState.WITHDRAWN && from === LedgerCurrencyState.QUALIFIED;
}
export function isHistoricalManualEntry(entry: {
  currency: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceKind: string | null;
}): boolean {
  return (
    entry.currency === null &&
    ((entry.sourceType === null && entry.sourceId === null && entry.sourceKind === null) ||
      (entry.sourceType === 'manual' &&
        (entry.sourceKind === null || entry.sourceKind === 'posted')))
  );
}
export function validateLedgerQualification(input: {
  action: string;
  currency: string;
  reason: string;
  expectedVersion: number;
  evidenceId: string;
}) {
  if (!['QUALIFY', 'WITHDRAW'].includes(input.action)) throw Error('Action invalide.');
  if (
    input.action === 'QUALIFY'
      ? !CURRENCIES.some((c) => c.code === input.currency)
      : input.currency !== ''
  )
    throw Error('Devise explicite requise pour qualifier; aucune devise sur un retrait.');
  if (
    typeof input.reason !== 'string' ||
    input.reason.trim().length < 10 ||
    input.reason.length > 2000
  )
    throw Error('Expliquez la décision (10 à 2000 caractères).');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)
    throw Error('Version invalide.');
  if (typeof input.evidenceId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.evidenceId))
    throw Error('Choisissez un justificatif de cette écriture.');
}
