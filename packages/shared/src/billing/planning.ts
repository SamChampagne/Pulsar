import { CURRENCIES } from '../reference/currencies';
import { isCalendarDate } from '../calendar-date';
import { ledgerAmount, ledgerCents, type ExactAccountRow } from './ledger-exact';

export const ACCOUNTING_TARGETS = ['NATIVE', 'EXTERNAL'] as const;
export type AccountingTarget = (typeof ACCOUNTING_TARGETS)[number];
export function validateAccountingTarget(target: string, currency: string, system: string) {
  if (!ACCOUNTING_TARGETS.includes(target as AccountingTarget))
    throw Error('Cible comptable invalide.');
  if (!CURRENCIES.some((c) => c.code === currency)) throw Error('Devise cible invalide.');
  if (target === 'EXTERNAL' && !system.trim())
    throw Error('Indiquez le logiciel comptable de référence.');
  if (target === 'NATIVE' && system.trim())
    throw Error('Le logiciel externe doit être vide pour la cible Pulsar.');
}
export function validateBudgetPeriod(from: string, to: string, fiscalYear: number) {
  if (!isCalendarDate(from) || !isCalendarDate(to))
    throw Error('Choisissez des dates civiles réelles.');
  const start = Date.parse(from + 'T00:00:00Z'),
    end = Date.parse(to + 'T00:00:00Z');
  if (start > end || (end - start) / 86400000 >= 366 || Number(from.slice(0, 4)) !== fiscalYear)
    throw Error('La période doit commencer dans l’exercice indiqué et couvrir au plus 366 jours.');
}
export function validateBudgetLines(lines: { accountCode: string; amount: string }[]) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 200)
    throw Error('Ajoutez de 1 à 200 lignes.');
  const codes = new Set<string>();
  return lines.map((l) => {
    if (!/^[0-9A-Z]{1,10}$/.test(l.accountCode) || codes.has(l.accountCode))
      throw Error('Comptes invalides ou en double.');
    codes.add(l.accountCode);
    if (typeof l.amount !== 'string' || !/^-?\d{1,10}(\.\d{1,2})?$/.test(l.amount))
      throw Error('Montant exact requis, au plus deux décimales.');
    return { accountCode: l.accountCode, amount: ledgerAmount(ledgerCents(l.amount)) };
  });
}
export function exactBudgetVariance(
  lines: { accountCode: string; amount: string }[],
  accounts: ExactAccountRow[],
) {
  return {
    rows: lines.map((l) => {
      const a = accounts.find((a) => a.code === l.accountCode);
      if (!a) throw Error('Un compte du budget est introuvable.');
      const actual = ['LIABILITY', 'EQUITY', 'REVENUE'].includes(a.type)
        ? ledgerCents(a.credit) - ledgerCents(a.debit)
        : ledgerCents(a.debit) - ledgerCents(a.credit);
      return {
        accountCode: l.accountCode,
        name: a.name,
        type: a.type,
        budget: ledgerAmount(ledgerCents(l.amount)),
        actual: ledgerAmount(actual),
        variance: ledgerAmount(ledgerCents(l.amount) - actual),
      };
    }),
  };
}
