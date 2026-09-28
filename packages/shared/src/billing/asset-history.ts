import { isCalendarDate } from '../calendar-date';
import { ledgerAmount, ledgerCents, validateLedgerLines } from './ledger-exact';
import type { InvoiceLedgerLine } from './invoice-ledger';

/** Reconcile recorded facts only. Never rebuild a historical or future depreciation plan. */
export function reconcileAssetHistory(input: {
  cost: string;
  salvage: string;
  accumulated: string;
  acquisitionDate: string;
  throughMonth: string;
  periods: { period: string; amount: string; lines: InvoiceLedgerLine[] }[];
}) {
  const cost = ledgerCents(input.cost),
    salvage = ledgerCents(input.salvage),
    accumulated = ledgerCents(input.accumulated);
  if (
    cost <= 0n ||
    salvage < 0n ||
    salvage > cost ||
    accumulated <= 0n ||
    accumulated > cost - salvage
  )
    throw Error('Coût, résiduel ou cumul historique incohérent.');
  if (
    !isCalendarDate(input.acquisitionDate) ||
    !isCalendarDate(input.throughMonth + '-01') ||
    !input.periods.length ||
    input.periods.length > 1200
  )
    throw Error('Dates ou nombre de dotations historiques invalides.');
  const periods = [...input.periods].sort((a, b) => a.period.localeCompare(b.period));
  let sum = 0n;
  for (const [i, p] of periods.entries()) {
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.period) ||
      !isCalendarDate(p.period + '-01') ||
      p.period < input.acquisitionDate.slice(0, 7) ||
      p.period > input.throughMonth ||
      periods[i - 1]?.period === p.period
    )
      throw Error('Période historique invalide, future, dupliquée ou antérieure à l’acquisition.');
    const amount = ledgerCents(p.amount);
    if (amount <= 0n) throw Error('Une dotation historique doit être strictement positive.');
    const lines = validateLedgerLines(p.lines);
    if (
      lines.length !== 2 ||
      lines[0].accountCode === lines[1].accountCode ||
      !p.lines.some((l) => l.accountType === 'EXPENSE' && ledgerCents(l.debit) === amount) ||
      !p.lines.some((l) => l.accountType === 'ASSET' && ledgerCents(l.credit) === amount)
    )
      throw Error('La dotation ne correspond pas à ses comptes et montants réellement postés.');
    sum += amount;
  }
  if (sum !== accumulated) throw Error('Le cumul de l’actif diffère des dotations enregistrées.');
  const ordinal = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5));
  return {
    cost: ledgerAmount(cost),
    salvageValue: ledgerAmount(salvage),
    accumulatedAmount: ledgerAmount(sum),
    recordedBookValue: ledgerAmount(cost - sum),
    periodCount: periods.length,
    firstPeriod: periods[0].period,
    lastPeriod: periods.at(-1)!.period,
    unrecordedMonthCount:
      ordinal(periods.at(-1)!.period) - ordinal(periods[0].period) + 1 - periods.length,
  };
}
