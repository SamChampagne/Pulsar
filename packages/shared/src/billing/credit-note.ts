/** Browser-safe, integer arithmetic. Credits reverse frozen amounts, never today's prices/rates. */
export enum CustomerCreditStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  CANCELLED = 'CANCELLED',
}
export function canTransitionCustomerCredit(from: CustomerCreditStatus, to: CustomerCreditStatus) {
  return (
    from === CustomerCreditStatus.DRAFT &&
    [CustomerCreditStatus.ISSUED, CustomerCreditStatus.CANCELLED].includes(to)
  );
}
export function invoiceBalance(
  total: number | string,
  paid: number | string,
  credited: number | string = 0,
) {
  const net = Math.round((Number(total) - Number(paid) - Number(credited)) * 100) / 100;
  return { outstanding: Math.max(0, net), customerCredit: Math.max(0, -net) };
}
function integer(value: number | string, scale: number) {
  const n = Number(value),
    scaled = Math.round(n * scale);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    !Number.isSafeInteger(scaled) ||
    Math.abs(n * scale - scaled) > 0.01
  )
    throw new Error('Montant ou quantité hors précision.');
  return BigInt(scaled);
}
const roundRatio = (amount: bigint, numerator: bigint, denominator: bigint) =>
  (amount * numerator * 2n + denominator) / (2n * denominator);
/** Largest remainder, tie broken by stable invoice-line id. */
function distribute(amount: bigint, weights: bigint[], total: bigint) {
  const values = weights.map((w) => (amount * w) / total);
  let left = amount - values.reduce((s, v) => s + v, 0n);
  const order = weights
    .map((w, i) => ({ i, rest: (amount * w) % total }))
    .sort((a, b) => (a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1));
  for (const { i } of order) {
    if (left === 0n) break;
    values[i]++;
    left--;
  }
  return values;
}
export interface CreditSource {
  id: string;
  amount: string | number;
  quantity: string | number | null;
  creditedQuantity: string | number;
}
export interface FrozenCreditTax {
  description: string;
  rate: number;
  accountCode: string;
  amount: number | string;
}
export function calculateCustomerCredit(input: {
  totalAmount: string | number;
  taxAmount: string | number;
  taxes: FrozenCreditTax[];
  lines: CreditSource[];
  requested: { invoiceLineId: string; quantity: number | string }[];
}) {
  const sources = [...input.lines].sort((a, b) => a.id.localeCompare(b.id));
  const weights = sources.map((l) => integer(l.amount, 100));
  const net = weights.reduce((s, v) => s + v, 0n),
    tax = integer(input.taxAmount, 100);
  if (
    net <= 0n ||
    integer(input.totalAmount, 100) !== net + tax ||
    input.taxes.reduce((s, t) => s + integer(t.amount, 100), 0n) !== tax
  )
    throw new Error(
      'Instantané de facture ou de taxes incohérent : vérification comptable requise.',
    );
  const shares = input.taxes.map((t) => distribute(integer(t.amount, 100), weights, net));
  const seen = new Set<string>();
  const lines = input.requested.map((request) => {
    const i = sources.findIndex((l) => l.id === request.invoiceLineId);
    if (i < 0 || seen.has(request.invoiceLineId)) throw new Error('Ligne inconnue ou répétée.');
    seen.add(request.invoiceLineId);
    const source = sources[i],
      all = integer(source.quantity ?? 1, 10000),
      before = integer(source.creditedQuantity, 10000),
      qty = integer(request.quantity, 10000);
    if (all <= 0n || qty <= 0n || before + qty > all)
      throw new Error('Quantité supérieure au restant créditable.');
    const delta = (amount: bigint) =>
      Number(roundRatio(amount, before + qty, all) - roundRatio(amount, before, all)) / 100;
    const taxes = input.taxes.map((t, j) => ({ ...t, amount: delta(shares[j][i]) }));
    const netAmount = delta(weights[i]),
      taxAmount = Math.round(taxes.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    return {
      invoiceLineId: source.id,
      quantity: Number(request.quantity),
      netAmount,
      taxAmount,
      totalAmount: Math.round((netAmount + taxAmount) * 100) / 100,
      taxes,
    };
  });
  const sum = (key: 'netAmount' | 'taxAmount' | 'totalAmount') =>
    Math.round(lines.reduce((s, l) => s + l[key], 0) * 100) / 100;
  if (!lines.length || sum('totalAmount') <= 0)
    throw new Error('Avoir nul : regroupez les quantités avant validation.');
  return {
    lines,
    netAmount: sum('netAmount'),
    taxAmount: sum('taxAmount'),
    totalAmount: sum('totalAmount'),
  };
}
