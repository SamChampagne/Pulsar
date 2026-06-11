import { AccessorialUnit, RateType } from '../enums/transportation';

export interface RateBreakLike {
  /** Bracket upper bound in kg (inclusive). The last bracket also covers heavier weights. */
  upToKg: number;
  /** Amount per CWT inside this bracket. */
  amount: number;
}

export interface AccessorialPriceLike {
  code: string;
  amount: number;
}

export interface RateLike {
  rateType: RateType;
  /** Base amount in the rate's currency (ignored for PER_HUNDREDWEIGHT when breaks exist). */
  baseAmount: number;
  /** Resolved upstream: dated fuel-table entry when the rate has one, static pct otherwise. */
  fuelSurchargePct?: number | null;
  minCharge?: number | null;
  breaks?: RateBreakLike[];
  accessorialPrices?: AccessorialPriceLike[];
}

export interface RequestedAccessorial {
  code: string;
  unit: AccessorialUnit;
  quantity: number;
}

export interface CostMetrics {
  distanceKm?: number | null;
  weightKg?: number | null;
  palletCount?: number | null;
}

export type CostLineType = 'BASE' | 'FUEL' | 'ACCESSORIAL' | 'MIN_CHARGE_ADJUSTMENT';

export interface CostLine {
  type: CostLineType;
  /** Accessorial code, for ACCESSORIAL lines. */
  code?: string;
  label: string;
  amount: number;
}

export interface AppliedBreak {
  upToKg: number;
  amount: number;
  /** True when the deficit-weight ("as-if") rule priced the next bracket cheaper. */
  asIfApplied: boolean;
}

export interface CostBreakdown {
  lines: CostLine[];
  base: number;
  fuelSurcharge: number;
  accessorialsTotal: number;
  total: number;
  appliedBreak: AppliedBreak | null;
  /** Requested accessorial codes the rate does not price — total still computed. */
  missingAccessorials: string[];
}

const KG_PER_CWT = 45.359237; // 1 hundredweight (CWT) = 100 lb

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function cwtOf(weightKg: number): number {
  return weightKg / KG_PER_CWT;
}

/** Bracket selection + deficit-weight ("as-if") rule for PER_HUNDREDWEIGHT rates. */
function weightBase(rate: RateLike, weightKg: number): { base: number; appliedBreak: AppliedBreak | null } {
  const breaks = [...(rate.breaks ?? [])].sort((a, b) => a.upToKg - b.upToKg);
  if (breaks.length === 0) {
    return { base: cwtOf(weightKg) * rate.baseAmount, appliedBreak: null };
  }
  const index = breaks.findIndex((b) => weightKg <= b.upToKg);
  const applied = index === -1 ? breaks.length - 1 : index;
  let base = cwtOf(weightKg) * breaks[applied].amount;
  let appliedBreak: AppliedBreak = { upToKg: breaks[applied].upToKg, amount: breaks[applied].amount, asIfApplied: false };
  // As-if (deficit weight): only for the first bracket.
  // When weight is strictly less than the bracket's upper bound,
  // check if pricing at the bracket's upper bound with the next bracket's rate is cheaper.
  if (applied === 0 && weightKg < breaks[applied].upToKg && applied < breaks.length - 1) {
    const next = breaks[applied + 1];
    const asIf = cwtOf(breaks[applied].upToKg) * next.amount;
    if (asIf < base) {
      base = asIf;
      appliedBreak = { upToKg: next.upToKg, amount: next.amount, asIfApplied: true };
    }
  }
  return { base, appliedBreak };
}

/**
 * Computes the cost of a load for a given rate. Pure arithmetic only — lane matching,
 * date validity and fuel-entry selection are resolved by the caller (RatingService).
 * Returns null when the metric required by the rate type is missing ("cannot estimate yet").
 */
export function calculateRateCost(
  rate: RateLike,
  metrics: CostMetrics,
  accessorials: RequestedAccessorial[] = [],
): CostBreakdown | null {
  let base: number;
  let appliedBreak: AppliedBreak | null = null;
  switch (rate.rateType) {
    case RateType.FLAT:
    case RateType.SPOT:
      base = rate.baseAmount;
      break;
    case RateType.PER_KM:
      if (metrics.distanceKm == null) return null;
      base = rate.baseAmount * metrics.distanceKm;
      break;
    case RateType.PER_HUNDREDWEIGHT: {
      if (metrics.weightKg == null) return null;
      ({ base, appliedBreak } = weightBase(rate, metrics.weightKg));
      break;
    }
    case RateType.PER_PALLET:
      if (metrics.palletCount == null) return null;
      base = rate.baseAmount * metrics.palletCount;
      break;
  }

  const fuelSurcharge = base * ((rate.fuelSurchargePct ?? 0) / 100);

  const prices = new Map((rate.accessorialPrices ?? []).map((p) => [p.code, p.amount]));
  const missingAccessorials: string[] = [];
  const accessorialLines: CostLine[] = [];
  for (const req of accessorials) {
    const price = prices.get(req.code);
    if (price === undefined) {
      missingAccessorials.push(req.code);
      continue;
    }
    const quantity = req.unit === AccessorialUnit.FLAT ? 1 : req.quantity;
    accessorialLines.push({
      type: 'ACCESSORIAL',
      code: req.code,
      label: quantity === 1 ? req.code : `${req.code} × ${quantity}`,
      amount: round2(price * quantity),
    });
  }
  const accessorialsTotal = accessorialLines.reduce((acc, l) => acc + l.amount, 0);

  const lines: CostLine[] = [
    {
      type: 'BASE',
      label: appliedBreak
        ? `Base (bracket ≤ ${appliedBreak.upToKg} kg${appliedBreak.asIfApplied ? ', as-if' : ''})`
        : 'Base',
      amount: round2(base),
    },
  ];
  if (fuelSurcharge > 0) {
    lines.push({ type: 'FUEL', label: `Fuel surcharge ${rate.fuelSurchargePct}%`, amount: round2(fuelSurcharge) });
  }
  lines.push(...accessorialLines);

  let total = base + fuelSurcharge + accessorialsTotal;
  if (rate.minCharge != null && total < rate.minCharge) {
    lines.push({
      type: 'MIN_CHARGE_ADJUSTMENT',
      label: 'Minimum charge adjustment',
      amount: round2(rate.minCharge - total),
    });
    total = rate.minCharge;
  }

  return {
    lines,
    base: round2(base),
    fuelSurcharge: round2(fuelSurcharge),
    accessorialsTotal: round2(accessorialsTotal),
    total: round2(total),
    appliedBreak,
    missingAccessorials,
  };
}

/** Fuel-table entry in force at the reference date: latest effectiveFrom ≤ date, else null. */
export function pickFuelEntry<T extends { effectiveFrom: Date; pct: number }>(
  entries: T[],
  referenceDate: Date,
): T | null {
  return (
    [...entries]
      .filter((e) => e.effectiveFrom.getTime() <= referenceDate.getTime())
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
  );
}
