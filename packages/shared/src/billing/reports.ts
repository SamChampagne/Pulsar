import { AccountType, normalBalance } from './ledger';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface AccountBalanceInput { code: string; name: string; type: AccountType | string; debit: number; credit: number }
export interface ReportLine { code: string; name: string; amount: number }
export interface ProfitAndLoss { revenue: ReportLine[]; expense: ReportLine[]; totalRevenue: number; totalExpense: number; netIncome: number }
export interface BalanceSheet { assets: ReportLine[]; liabilities: ReportLine[]; equity: ReportLine[]; totalAssets: number; totalLiabilities: number; totalEquity: number; netIncome: number; balanced: boolean }

export function naturalBalance(input: AccountBalanceInput): number {
  const nb = normalBalance(input.type as AccountType);
  return round2(nb === 'DEBIT' ? input.debit - input.credit : input.credit - input.debit);
}

export function buildProfitAndLoss(rows: AccountBalanceInput[]): ProfitAndLoss {
  const revenue: ReportLine[] = [];
  const expense: ReportLine[] = [];
  for (const r of rows) {
    if (r.type === AccountType.REVENUE) revenue.push({ code: r.code, name: r.name, amount: naturalBalance(r) });
    else if (r.type === AccountType.EXPENSE) expense.push({ code: r.code, name: r.name, amount: naturalBalance(r) });
  }
  const totalRevenue = round2(revenue.reduce((s, l) => s + l.amount, 0));
  const totalExpense = round2(expense.reduce((s, l) => s + l.amount, 0));
  return { revenue, expense, totalRevenue, totalExpense, netIncome: round2(totalRevenue - totalExpense) };
}

export function buildBalanceSheet(rows: AccountBalanceInput[], netIncome: number): BalanceSheet {
  const assets: ReportLine[] = [];
  const liabilities: ReportLine[] = [];
  const equity: ReportLine[] = [];
  for (const r of rows) {
    const line = { code: r.code, name: r.name, amount: naturalBalance(r) };
    if (r.type === AccountType.ASSET) assets.push(line);
    else if (r.type === AccountType.LIABILITY) liabilities.push(line);
    else if (r.type === AccountType.EQUITY) equity.push(line);
  }
  const totalAssets = round2(assets.reduce((s, l) => s + l.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, l) => s + l.amount, 0));
  const totalEquity = round2(equity.reduce((s, l) => s + l.amount, 0));
  const balanced = round2(totalAssets) === round2(totalLiabilities + totalEquity + netIncome);
  return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, netIncome: round2(netIncome), balanced };
}

export type AgingBucket = '0-30' | '31-60' | '61-90' | '91-120' | '120+';
export interface AgingItemInput { partyId: string; partyName: string; reference: string; date: string | Date; outstanding: number }
export interface AgingPartyRow { partyId: string; partyName: string; buckets: Record<AgingBucket, number>; total: number }
export interface AgingReport { rows: AgingPartyRow[]; totals: Record<AgingBucket, number>; grandTotal: number }

const BUCKETS: AgingBucket[] = ['0-30', '31-60', '61-90', '91-120', '120+'];
const emptyBuckets = (): Record<AgingBucket, number> => ({ '0-30': 0, '31-60': 0, '61-90': 0, '91-120': 0, '120+': 0 });

export function bucketForAge(days: number): AgingBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  if (days <= 120) return '91-120';
  return '120+';
}

export function buildAging(items: AgingItemInput[], asOf: Date): AgingReport {
  const byParty = new Map<string, AgingPartyRow>();
  const totals = emptyBuckets();
  for (const it of items) {
    const d = new Date(it.date);
    const days = Math.floor((asOf.getTime() - d.getTime()) / 86400000);
    const bucket = bucketForAge(days < 0 ? 0 : days);
    let row = byParty.get(it.partyId);
    if (!row) { row = { partyId: it.partyId, partyName: it.partyName, buckets: emptyBuckets(), total: 0 }; byParty.set(it.partyId, row); }
    row.buckets[bucket] = round2(row.buckets[bucket] + it.outstanding);
    row.total = round2(row.total + it.outstanding);
    totals[bucket] = round2(totals[bucket] + it.outstanding);
  }
  const grandTotal = round2(BUCKETS.reduce((s, b) => s + totals[b], 0));
  return { rows: [...byParty.values()], totals, grandTotal };
}
