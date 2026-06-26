const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface BudgetVarianceInput {
  accountCode: string;
  name: string;
  budget: number;
  actual: number;
}

export interface BudgetVarianceRow {
  accountCode: string;
  name: string;
  budget: number;
  actual: number;
  variance: number;
  variancePct: number;
}

export function computeBudgetVariance(inputs: BudgetVarianceInput[]): {
  rows: BudgetVarianceRow[];
  totalBudget: number;
  totalActual: number;
  totalVariance: number;
} {
  const rows = inputs.map((i) => {
    const variance = round2(i.budget - i.actual);
    const variancePct = i.budget !== 0 ? round2((variance / Math.abs(i.budget)) * 100) : 0;
    return {
      accountCode: i.accountCode,
      name: i.name,
      budget: round2(i.budget),
      actual: round2(i.actual),
      variance,
      variancePct,
    };
  });

  const totalBudget = round2(rows.reduce((s, r) => s + r.budget, 0));
  const totalActual = round2(rows.reduce((s, r) => s + r.actual, 0));

  return {
    rows,
    totalBudget,
    totalActual,
    totalVariance: round2(totalBudget - totalActual),
  };
}
