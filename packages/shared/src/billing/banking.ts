export enum BankTxnStatus {
  UNRECONCILED = 'UNRECONCILED',
  RECONCILED = 'RECONCILED',
}

export interface CsvBankRow {
  date: string;
  description: string;
  amount: number;
  reference?: string;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Parse a simple bank CSV. Header: date,description,amount[,reference]. Accepts ',' or ';'. Skips blank lines. */
export function parseBankCsv(text: string): { rows: CsvBankRow[]; errors: string[] } {
  const rows: CsvBankRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { rows, errors };
  const delim = lines[0].includes(';') ? ';' : ',';
  // drop header if it looks like one
  const start = /date/i.test(lines[0]) && /amount|montant/i.test(lines[0]) ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(delim).map((p) => p.trim());
    const [date, description, amountRaw, reference] = parts;
    const amount = Number(amountRaw);
    if (!date || !description || amountRaw === undefined || amountRaw === '' || !Number.isFinite(amount)) {
      errors.push(`Line ${i + 1}: invalid (date/description/amount required, amount numeric)`);
      continue;
    }
    rows.push({ date, description, amount: round2(amount), reference: reference || undefined });
  }
  return { rows, errors };
}

export function maskAccountNumber(n?: string | null): string {
  if (!n) return '—';
  return `•••• ${n.slice(-4)}`;
}

export function bankBalance(amounts: number[]): number {
  return round2(amounts.reduce((s, a) => s + a, 0));
}
