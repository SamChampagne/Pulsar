/** Cumulative supplier statements, never stock or financial quantities. */
export interface SupplierReturnTotals {
  received: string;
  accepted: string;
  refused: string;
}
export interface SupplierReturnReportInput extends SupplierReturnTotals {
  operationKey: string;
  expectedRevision: number;
  evidenceId: string;
  reportedAt: string;
  reference: string;
  note: string;
  correctionReason?: string;
}
export interface SupplierReturnReportView extends SupplierReturnTotals {
  id: string;
  revision: number;
  evidenceId: string;
  reportedAt: string;
  reference: string;
  note: string;
  correctionReason: string | null;
  createdAt: string;
  createdBy: { firstName: string; lastName: string };
}
export const SUPPLIER_RETURN_QUANTITY = /^\d{1,9}(\.\d{1,3})?$/;
function exact(value: string): bigint {
  if (typeof value !== 'string' || !SUPPLIER_RETURN_QUANTITY.test(value))
    throw Error('Quantité invalide : neuf chiffres et trois décimales maximum.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
function display(value: bigint): string {
  return `${value / 1000n}.${(value % 1000n).toString().padStart(3, '0')}`.replace(/\.?0+$/, '');
}
export function deriveSupplierReturnBalance(sent: string, totals: SupplierReturnTotals) {
  const s = exact(sent),
    r = exact(totals.received),
    a = exact(totals.accepted),
    f = exact(totals.refused);
  if (r > s) throw Error('La quantité reçue dépasse la quantité physiquement retournée.');
  if (a + f > r) throw Error('Le total accepté et refusé dépasse la quantité reçue.');
  return { awaitingReceipt: display(s - r), awaitingDecision: display(r - a - f) };
}
export function supplierReturnDecreased(
  previous: SupplierReturnTotals,
  next: SupplierReturnTotals,
) {
  return (['received', 'accepted', 'refused'] as const).some(
    (k) => exact(next[k]) < exact(previous[k]),
  );
}
