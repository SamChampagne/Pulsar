export enum TaxTemplateType {
  SALES = 'SALES',
  PURCHASE = 'PURCHASE',
}

export interface TaxLineInput {
  description: string;
  rate: number;
  accountCode: string;
}

export interface TaxBreakdownLine {
  description: string;
  rate: number;
  accountCode: string;
  amount: number;
}

export interface TaxComputation {
  taxAmount: number;
  lines: TaxBreakdownLine[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** v1: every rate applied to the same net base (flat). Each line amount rounded to 2dp. */
export function computeTax(net: number, lines: TaxLineInput[]): TaxComputation {
  const out: TaxBreakdownLine[] = lines.map((l) => ({
    description: l.description,
    rate: l.rate,
    accountCode: l.accountCode,
    amount: round2((net * l.rate) / 100),
  }));
  const taxAmount = round2(out.reduce((s, l) => s + l.amount, 0));
  return { taxAmount, lines: out };
}
