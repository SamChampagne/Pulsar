import { isCalendarDate } from '../calendar-date';
import { SUPPLIER_INVOICE_AMOUNT, supplierInvoiceNumberKey } from './supplier-invoice';

export enum SupplierCreditStatus {
  DRAFT = 'DRAFT',
  QUALIFIED = 'QUALIFIED',
  CANCELLED = 'CANCELLED',
}
export function canTransitionSupplierCredit(from: string, to: string) {
  return from === 'DRAFT' && ['QUALIFIED', 'CANCELLED'].includes(to);
}
export interface SupplierCreditAmounts {
  lines: { invoiceLineId: string; netAmount: string }[];
  taxes: { position: number; amount: string }[];
}
export interface SupplierCreditInput extends SupplierCreditAmounts {
  invoiceId: string;
  externalNumber: string;
  creditDate: string;
  reason: string;
  returnReportId?: string;
}
export function supplierCreditCents(value: string): bigint {
  if (typeof value !== 'string' || !SUPPLIER_INVOICE_AMOUNT.test(value))
    throw Error('Montant positif ou nul à deux décimales maximum requis.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function supplierCreditAmount(value: bigint): string {
  if (value < 0n || value > 999999999999n) throw Error('Montant hors limites.');
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
export function supplierCreditTotals(d: SupplierCreditAmounts) {
  if (
    !Array.isArray(d.lines) ||
    d.lines.length > 100 ||
    !Array.isArray(d.taxes) ||
    d.taxes.length > 20
  )
    throw Error('Maximum de 100 lignes et 20 taxes.');
  const ids = new Set<string>(),
    positions = new Set<number>();
  let net = 0n,
    tax = 0n;
  for (const l of d.lines) {
    if (!l.invoiceLineId || ids.has(l.invoiceLineId)) throw Error('Ligne source unique requise.');
    ids.add(l.invoiceLineId);
    net += supplierCreditCents(l.netAmount);
  }
  for (const t of d.taxes) {
    if (
      !Number.isInteger(t.position) ||
      t.position < 0 ||
      t.position > 19 ||
      positions.has(t.position)
    )
      throw Error('Composante de taxe source unique requise.');
    positions.add(t.position);
    tax += supplierCreditCents(t.amount);
  }
  if (net + tax === 0n) throw Error('Un avoir doit comporter un montant strictement positif.');
  return {
    netAmount: supplierCreditAmount(net),
    taxAmount: supplierCreditAmount(tax),
    totalAmount: supplierCreditAmount(net + tax),
  };
}
export function validateSupplierCredit(d: SupplierCreditInput) {
  if (
    !d.invoiceId ||
    typeof d.externalNumber !== 'string' ||
    !d.externalNumber.trim() ||
    supplierInvoiceNumberKey(d.externalNumber).length > 100 ||
    d.externalNumber.length > 100
  )
    throw Error('Facture et numéro de l’avoir requis.');
  if (!isCalendarDate(d.creditDate)) throw Error('Date civile invalide.');
  if (typeof d.reason !== 'string' || d.reason.trim().length < 10 || d.reason.length > 2000)
    throw Error('Expliquez le motif de l’avoir (10 à 2 000 caractères).');
  return supplierCreditTotals(d);
}
/** Documentary money balance only: no allocation of physical quantities or tax rates. */
export function supplierCreditBalance(
  invoice: {
    lines: { id: string; netAmount: string }[];
    taxes: { label: string; amount: string }[];
  },
  qualified: SupplierCreditAmounts[],
) {
  const lines = invoice.lines.map((l) => ({
    invoiceLineId: l.id,
    original: supplierCreditCents(l.netAmount),
    credited: 0n,
  }));
  const taxes = invoice.taxes.map((t, position) => ({
    position,
    label: t.label,
    original: supplierCreditCents(t.amount),
    credited: 0n,
  }));
  for (const c of qualified) {
    supplierCreditTotals(c);
    for (const l of c.lines) {
      const target = lines.find((x) => x.invoiceLineId === l.invoiceLineId);
      if (!target) throw Error('Ligne étrangère à la facture source.');
      target.credited += supplierCreditCents(l.netAmount);
    }
    for (const t of c.taxes) {
      if (!taxes[t.position]) throw Error('Taxe étrangère à la facture source.');
      taxes[t.position].credited += supplierCreditCents(t.amount);
    }
  }
  const amounts = <T extends { original: bigint; credited: bigint }>(r: T) => {
    if (r.credited > r.original)
      throw Error('Le cumul des avoirs dépasse une ligne ou une taxe de la facture.');
    return {
      ...r,
      original: supplierCreditAmount(r.original),
      credited: supplierCreditAmount(r.credited),
      remaining: supplierCreditAmount(r.original - r.credited),
    };
  };
  const all = [...lines, ...taxes];
  return {
    lines: lines.map(amounts),
    taxes: taxes.map(amounts),
    ...amounts({
      original: all.reduce((n, r) => n + r.original, 0n),
      credited: all.reduce((n, r) => n + r.credited, 0n),
    }),
  };
}
