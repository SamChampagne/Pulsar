import { isCalendarDate } from '../calendar-date';
import { supplierCreditAmount, supplierCreditCents } from './supplier-credit';

export enum SupplierScheduleStatus {
  CONFIRMED = 'CONFIRMED',
  WITHDRAWN = 'WITHDRAWN',
}
export interface SupplierScheduleInput {
  status: SupplierScheduleStatus;
  installments: { dueDate: string; amount: string; note: string }[];
  note: string;
}
/** A revision replaces the plan, never the source invoice or a payment. */
export function canTransitionSupplierSchedule(from: string | null, to: string) {
  return (
    (from === null || from === 'CONFIRMED' || from === 'WITHDRAWN') &&
    (to === 'CONFIRMED' || (from === 'CONFIRMED' && to === 'WITHDRAWN'))
  );
}
export function validateSupplierSchedule(
  d: SupplierScheduleInput,
  remaining: string,
  invoiceDate: string,
) {
  if (!Object.values(SupplierScheduleStatus).includes(d.status))
    throw Error('Statut d’échéancier invalide.');
  if (typeof d.note !== 'string' || d.note.trim().length < 10 || d.note.length > 2000)
    throw Error('Expliquez la révision (10 à 2 000 caractères).');
  if (!isCalendarDate(invoiceDate)) throw Error('Date de facture invalide.');
  const target = supplierCreditCents(remaining);
  if (!Array.isArray(d.installments) || d.installments.length > 60)
    throw Error('Maximum de 60 échéances.');
  if (d.status === 'WITHDRAWN') {
    if (d.installments.length) throw Error('Un retrait ne comporte pas d’échéances.');
    return { status: d.status, note: d.note.trim(), installments: [] };
  }
  let sum = 0n,
    prior = '';
  const installments = d.installments.map((row) => {
    if (!isCalendarDate(row.dueDate) || row.dueDate < invoiceDate || row.dueDate <= prior)
      throw Error(
        'Dates réelles, distinctes, en ordre croissant et à partir de la date de facture.',
      );
    prior = row.dueDate;
    const amount = supplierCreditCents(row.amount);
    if (amount === 0n) throw Error('Chaque échéance doit avoir un montant strictement positif.');
    if (typeof row.note !== 'string' || row.note.length > 200)
      throw Error('Description d’échéance limitée à 200 caractères.');
    sum += amount;
    return { dueDate: row.dueDate, amount: supplierCreditAmount(amount), note: row.note.trim() };
  });
  if (sum !== target)
    throw Error(
      `Répartissez exactement le reste documentaire de ${remaining}. Aucun règlement n’est déduit.`,
    );
  return { status: d.status, installments, note: d.note.trim() };
}
export function supplierScheduleBucket(dueDate: string, referenceDate: string) {
  if (!isCalendarDate(dueDate) || !isCalendarDate(referenceDate))
    throw Error('Dates civiles invalides.');
  const days =
    (Date.parse(dueDate + 'T00:00:00Z') - Date.parse(referenceDate + 'T00:00:00Z')) / 86400000;
  return days < 0
    ? 'OVERDUE'
    : days === 0
      ? 'TODAY'
      : days <= 7
        ? 'WITHIN_7'
        : days <= 30
          ? 'WITHIN_30'
          : 'LATER';
}
