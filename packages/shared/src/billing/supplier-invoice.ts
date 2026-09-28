import { isCalendarDate } from '../calendar-date';
import { CURRENCIES } from '../reference/currencies';

export enum SupplierInvoiceStatus {
  DRAFT = 'DRAFT',
  QUALIFIED = 'QUALIFIED',
  CANCELLED = 'CANCELLED',
}
export function canTransitionSupplierInvoice(from: string, to: string) {
  return (
    from === SupplierInvoiceStatus.DRAFT &&
    [SupplierInvoiceStatus.QUALIFIED, SupplierInvoiceStatus.CANCELLED].includes(
      to as SupplierInvoiceStatus,
    )
  );
}
export const SUPPLIER_INVOICE_AMOUNT = /^\d{1,10}(?:\.\d{1,2})?$/;
export const SUPPLIER_INVOICE_QUANTITY = /^\d{1,9}(?:\.\d{1,4})?$/;
export interface SupplierInvoiceLineInput {
  description: string;
  quantity: string;
  unit: string;
  netAmount: string;
  purchaseLineId?: string;
}
export interface SupplierInvoiceTaxInput {
  label: string;
  amount: string;
}
export interface SupplierInvoiceInput {
  supplierId: string;
  externalNumber: string;
  invoiceDate: string;
  dueDate?: string;
  currency: string;
  notes: string;
  lines: SupplierInvoiceLineInput[];
  taxes: SupplierInvoiceTaxInput[];
}
export function supplierInvoiceNumberKey(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
}
function cents(value: string) {
  if (typeof value !== 'string' || !SUPPLIER_INVOICE_AMOUNT.test(value))
    throw Error('Montant positif ou nul, avec deux décimales maximum, requis.');
  const [a, b = ''] = value.split('.');
  return BigInt(a) * 100n + BigInt(b.padEnd(2, '0'));
}
function amount(value: bigint) {
  if (value > 999999999999n) throw Error('Le total dépasse la limite de ce registre.');
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
/** Declared amounts only. Never derives taxes or a price from an order/physical return. */
export function supplierInvoiceTotals(input: Pick<SupplierInvoiceInput, 'lines' | 'taxes'>) {
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100)
    throw Error('Une à cent lignes sont requises.');
  if (!Array.isArray(input.taxes) || input.taxes.length > 20)
    throw Error('Vingt composantes de taxe maximum.');
  const net = input.lines.reduce((n, l) => n + cents(l.netAmount), 0n);
  const tax = input.taxes.reduce((n, t) => n + cents(t.amount), 0n);
  return { netAmount: amount(net), taxAmount: amount(tax), totalAmount: amount(net + tax) };
}
export function validateSupplierInvoice(input: SupplierInvoiceInput) {
  const text = (v: unknown, max: number, min = 1) =>
    typeof v === 'string' && v.trim().length >= min && v.length <= max;
  if (
    !text(input.supplierId, 100) ||
    !text(input.externalNumber, 100) ||
    supplierInvoiceNumberKey(input.externalNumber).length > 100
  )
    throw Error('Fournisseur et numéro de facture explicite requis.');
  if (
    !isCalendarDate(input.invoiceDate) ||
    (input.dueDate !== undefined &&
      (!isCalendarDate(input.dueDate) || input.dueDate < input.invoiceDate))
  )
    throw Error('Dates civiles invalides : l’échéance ne peut pas précéder la facture.');
  if (!CURRENCIES.some((c) => c.code === input.currency))
    throw Error('Devise non prise en charge.');
  if (!text(input.notes, 4000, 0)) throw Error('Notes limitées à 4 000 caractères.');
  const totals = supplierInvoiceTotals(input);
  const linked = new Set<string>();
  for (const l of input.lines) {
    if (
      !text(l.description, 500) ||
      !text(l.unit, 30) ||
      typeof l.quantity !== 'string' ||
      !SUPPLIER_INVOICE_QUANTITY.test(l.quantity) ||
      !/[1-9]/.test(l.quantity)
    )
      throw Error(
        'Chaque ligne exige un libellé, une unité et une quantité strictement positive (4 décimales maximum).',
      );
    if (l.purchaseLineId !== undefined) {
      if (!text(l.purchaseLineId, 100) || linked.has(l.purchaseLineId))
        throw Error('Une ligne d’achat ne peut être liée qu’une fois dans cette facture.');
      linked.add(l.purchaseLineId);
    }
  }
  for (const t of input.taxes)
    if (!text(t.label, 100)) throw Error('Nommez chaque composante de taxe.');
  return totals;
}
