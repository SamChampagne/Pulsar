const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export enum DepreciationMethod {
  STRAIGHT_LINE = 'STRAIGHT_LINE',
}

export enum FixedAssetStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  DISPOSED = 'DISPOSED',
}

export const FIXED_ASSET_TRANSITIONS: Record<FixedAssetStatus, FixedAssetStatus[]> = {
  [FixedAssetStatus.DRAFT]: [FixedAssetStatus.ACTIVE, FixedAssetStatus.DISPOSED],
  [FixedAssetStatus.ACTIVE]: [FixedAssetStatus.DISPOSED],
  [FixedAssetStatus.DISPOSED]: [],
};

export function canTransitionFixedAsset(from: FixedAssetStatus, to: FixedAssetStatus): boolean {
  return FIXED_ASSET_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface DepreciationScheduleRow {
  period: number;
  amount: number;
  accumulated: number;
  bookValue: number;
}

export function buildDepreciationSchedule(input: {
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
}): DepreciationScheduleRow[] {
  const { cost, salvageValue, usefulLifeMonths } = input;
  const depreciable = round2(cost - salvageValue);
  const life = Math.max(1, Math.floor(usefulLifeMonths));
  const monthly = round2(depreciable / life);
  const rows: DepreciationScheduleRow[] = [];
  let accumulated = 0;
  for (let p = 1; p <= life; p++) {
    const amount = p < life ? monthly : round2(depreciable - accumulated); // last absorbs rounding
    accumulated = round2(accumulated + amount);
    rows.push({ period: p, amount, accumulated, bookValue: round2(cost - accumulated) });
  }
  return rows;
}

export function depreciationForNextPeriod(input: {
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  accumulated: number;
}): number {
  const depreciable = round2(input.cost - input.salvageValue);
  const remaining = round2(depreciable - input.accumulated);
  if (remaining <= 0) return 0;
  const life = Math.max(1, Math.floor(input.usefulLifeMonths));
  const monthly = round2(depreciable / life);
  return round2(Math.min(monthly, remaining));
}
