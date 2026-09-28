import { AccountType, normalBalance } from './ledger';
import { bucketForAge, type AgingBucket } from './reports';

/** Signed decimal cents, including aggregates above Number.MAX_SAFE_INTEGER. */
export function ledgerCents(value: string): bigint {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw Error('Montant comptable invalide.');
  const negative = value.startsWith('-'),
    [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  // SQL NUMERIC can return trailing zeroes. Never round a nonzero sub-cent.
  if (/[1-9]/.test(fraction.slice(2)))
    throw Error('Montant comptable invalide (2 décimales maximum).');
  const cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
  return negative ? -cents : cents;
}
export function ledgerAmount(cents: bigint): string {
  const n = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}
export function formatLedgerAmount(value: string): string {
  const [whole, fraction] = ledgerAmount(ledgerCents(value)).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')},${fraction}`;
}
export function validateLedgerLines(
  lines: {
    accountCode: string;
    debit?: string | number;
    credit?: string | number;
    memo?: string;
  }[],
) {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 200)
    throw Error('Une écriture exige de 2 à 200 lignes.');
  let debits = 0n,
    credits = 0n;
  const normalized = lines.map((l) => {
    if (!l || [l.debit ?? 0, l.credit ?? 0].some((v) => !/^\d+(?:\.\d{1,2})?$/.test(String(v))))
      throw Error('Montant de ligne invalide (2 décimales maximum).');
    const d = ledgerCents(String(l.debit ?? 0)),
      c = ledgerCents(String(l.credit ?? 0));
    if (d < 0n || c < 0n || (d === 0n) === (c === 0n))
      throw Error('Chaque ligne doit porter un montant positif au débit OU au crédit.');
    if (d > 999999999999n || c > 999999999999n)
      throw Error('Montant de ligne supérieur à 9 999 999 999,99.');
    if (!l.accountCode?.trim()) throw Error('Compte obligatoire pour chaque ligne.');
    debits += d;
    credits += c;
    return {
      ...l,
      accountCode: l.accountCode.trim(),
      debit: ledgerAmount(d),
      credit: ledgerAmount(c),
    };
  });
  if (debits !== credits)
    throw Error(
      'Écriture non équilibrée : les débits et crédits doivent être identiques au cent près.',
    );
  return normalized;
}
export interface ExactAccountRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
}
export function exactTrialBalance(rows: ExactAccountRow[]) {
  const totalDebit = ledgerAmount(rows.reduce((n, r) => n + ledgerCents(r.debit), 0n));
  const totalCredit = ledgerAmount(rows.reduce((n, r) => n + ledgerCents(r.credit), 0n));
  return {
    rows: rows.map((r) => ({
      ...r,
      balance: ledgerAmount(ledgerCents(r.debit) - ledgerCents(r.credit)),
    })),
    totalDebit,
    totalCredit,
    balanced: totalDebit === totalCredit,
  };
}
const natural = (r: ExactAccountRow) =>
  normalBalance(r.type as AccountType) === 'DEBIT'
    ? ledgerCents(r.debit) - ledgerCents(r.credit)
    : ledgerCents(r.credit) - ledgerCents(r.debit);
const reportLines = (rows: ExactAccountRow[], type: string) =>
  rows
    .filter((r) => r.type === type)
    .map((r) => ({ code: r.code, name: r.name, amount: ledgerAmount(natural(r)) }));
const sum = (rows: { amount: string }[]) => rows.reduce((n, r) => n + ledgerCents(r.amount), 0n);
export function exactProfitAndLoss(rows: ExactAccountRow[]) {
  const revenue = reportLines(rows, 'REVENUE'),
    expense = reportLines(rows, 'EXPENSE');
  return {
    revenue,
    expense,
    totalRevenue: ledgerAmount(sum(revenue)),
    totalExpense: ledgerAmount(sum(expense)),
    netIncome: ledgerAmount(sum(revenue) - sum(expense)),
  };
}
export function exactBalanceSheet(rows: ExactAccountRow[]) {
  const assets = reportLines(rows, 'ASSET'),
    liabilities = reportLines(rows, 'LIABILITY'),
    equity = reportLines(rows, 'EQUITY');
  const { netIncome } = exactProfitAndLoss(rows),
    totalLiabilitiesAndEquity = ledgerAmount(
      sum(liabilities) + sum(equity) + ledgerCents(netIncome),
    );
  return {
    assets,
    liabilities,
    equity,
    totalAssets: ledgerAmount(sum(assets)),
    totalLiabilities: ledgerAmount(sum(liabilities)),
    totalEquity: ledgerAmount(sum(equity)),
    netIncome,
    totalLiabilitiesAndEquity,
    balanced: ledgerAmount(sum(assets)) === totalLiabilitiesAndEquity,
  };
}
export function exactCashFlow(rows: ExactAccountRow[], codes: string[]) {
  const accounts = rows
    .filter((r) => codes.includes(r.code))
    .map((r) => ({ code: r.code, name: r.name, amount: ledgerAmount(natural(r)) }));
  return { accounts, netChange: ledgerAmount(sum(accounts)) };
}
/** Current balances classified by approval/creation date; NOT historical aging or due-date aging. */
export function exactCurrentAging(
  items: { partyId: string; partyName: string; date: Date; outstanding: string }[],
  ref: Date,
) {
  const buckets: AgingBucket[] = ['0-30', '31-60', '61-90', '91-120', '120+'];
  const empty = () =>
    Object.fromEntries(buckets.map((b) => [b, 0n])) as Record<AgingBucket, bigint>;
  const map = new Map<
      string,
      { partyId: string; partyName: string; buckets: Record<AgingBucket, bigint>; total: bigint }
    >(),
    totals = empty();
  for (const item of items) {
    const n = ledgerCents(item.outstanding);
    if (n <= 0n) continue;
    const b = bucketForAge(
      Math.max(0, Math.floor((ref.getTime() - item.date.getTime()) / 86400000)),
    );
    const row = map.get(item.partyId) ?? {
      partyId: item.partyId,
      partyName: item.partyName,
      buckets: empty(),
      total: 0n,
    };
    row.buckets[b] += n;
    row.total += n;
    totals[b] += n;
    map.set(item.partyId, row);
  }
  const serialize = (v: Record<AgingBucket, bigint>) =>
    Object.fromEntries(buckets.map((b) => [b, ledgerAmount(v[b])])) as Record<AgingBucket, string>;
  return {
    rows: [...map.values()]
      .sort((a, b) => a.partyName.localeCompare(b.partyName) || a.partyId.localeCompare(b.partyId))
      .map((r) => ({ ...r, buckets: serialize(r.buckets), total: ledgerAmount(r.total) })),
    totals: serialize(totals),
    grandTotal: ledgerAmount(buckets.reduce((n, b) => n + totals[b], 0n)),
  };
}
