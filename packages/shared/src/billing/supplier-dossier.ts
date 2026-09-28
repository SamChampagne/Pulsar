export type SupplierDocumentKind = 'INVOICE' | 'CREDIT';
export type SupplierDocumentStatus = 'DRAFT' | 'QUALIFIED' | 'CANCELLED';
export interface SupplierDossierGroup {
  currency: string;
  kind: SupplierDocumentKind;
  status: SupplierDocumentStatus;
  count: number;
  amount: string;
}
/** Aggregates may exceed a single document's Decimal(12,2). Never use Number for money. */
function cents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error('Montant documentaire invalide.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function money(value: bigint) {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
export function summarizeSupplierDossier(groups: SupplierDossierGroup[]) {
  const currencies = new Map<
    string,
    { invoices: bigint; credits: bigint; invoiceCount: number; creditCount: number }
  >();
  const counts = {
    invoiceDraft: 0,
    invoiceQualified: 0,
    invoiceCancelled: 0,
    creditDraft: 0,
    creditQualified: 0,
    creditCancelled: 0,
  };
  for (const g of groups) {
    if (
      !['INVOICE', 'CREDIT'].includes(g.kind) ||
      !['DRAFT', 'QUALIFIED', 'CANCELLED'].includes(g.status) ||
      !Number.isSafeInteger(g.count) ||
      g.count < 0 ||
      !g.currency
    )
      throw Error('Groupe documentaire invalide.');
    const n = cents(g.amount);
    const prefix = g.kind === 'INVOICE' ? 'invoice' : 'credit';
    const suffix =
      g.status === 'DRAFT' ? 'Draft' : g.status === 'QUALIFIED' ? 'Qualified' : 'Cancelled';
    counts[`${prefix}${suffix}`] += g.count;
    if (g.status !== 'QUALIFIED') continue;
    const row = currencies.get(g.currency) ?? {
      invoices: 0n,
      credits: 0n,
      invoiceCount: 0,
      creditCount: 0,
    };
    if (g.kind === 'INVOICE') {
      row.invoices += n;
      row.invoiceCount += g.count;
    } else {
      row.credits += n;
      row.creditCount += g.count;
    }
    currencies.set(g.currency, row);
  }
  return {
    counts,
    currencies: [...currencies]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, r]) => ({
        currency,
        invoiceCount: r.invoiceCount,
        creditCount: r.creditCount,
        qualifiedInvoices: money(r.invoices),
        qualifiedCredits: money(r.credits),
        documentaryRemaining: r.credits > r.invoices ? null : money(r.invoices - r.credits),
        inconsistent: r.credits > r.invoices,
      })),
  };
}
/** Exact display of aggregated amounts, without currency conversion or a payable balance. */
export function formatSupplierDossierMoney(value: string, currency: string) {
  const exact = money(cents(value));
  const [whole, fraction] = exact.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')},${fraction} ${currency}`;
}
