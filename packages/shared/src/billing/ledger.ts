export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
}

export function normalBalance(type: AccountType): 'DEBIT' | 'CREDIT' {
  return type === AccountType.ASSET || type === AccountType.EXPENSE ? 'DEBIT' : 'CREDIT';
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Balanced double-entry: ≥2 lines, each line exactly one-sided, Σdebit === Σcredit (2-dec). */
export function isBalanced(lines: { debit: number; credit: number }[]): boolean {
  if (lines.length < 2) return false;
  for (const l of lines) {
    const d = l.debit || 0, c = l.credit || 0;
    if (d < 0 || c < 0) return false;
    if ((d > 0 && c > 0) || (d === 0 && c === 0)) return false; // exactly one side non-zero
  }
  const totalD = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const totalC = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
  return totalD === totalC;
}

export const DEFAULT_CHART: { code: string; name: string; type: AccountType }[] = [
  { code: '1000', name: 'Encaisse', type: AccountType.ASSET },
  { code: '1010', name: 'Banque', type: AccountType.ASSET },
  { code: '1100', name: 'Comptes clients', type: AccountType.ASSET },
  { code: '1150', name: 'Taxes à recouvrer', type: AccountType.ASSET },
  { code: '1500', name: 'Immobilisations', type: AccountType.ASSET },
  { code: '1590', name: 'Amortissement cumulé', type: AccountType.ASSET },
  { code: '2000', name: 'Comptes fournisseurs', type: AccountType.LIABILITY },
  { code: '2100', name: 'Taxes à payer', type: AccountType.LIABILITY },
  { code: '3000', name: 'Capital', type: AccountType.EQUITY },
  { code: '4000', name: 'Revenus de transport', type: AccountType.REVENUE },
  { code: '5000', name: 'Charges transporteurs', type: AccountType.EXPENSE },
  { code: '5100', name: 'Dotation aux amortissements', type: AccountType.EXPENSE },
];
