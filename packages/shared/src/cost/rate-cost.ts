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
  /** True when the deficit-weight ("as-if") rule priced a higher bracket cheaper. */
  asIfApplied: boolean;
  /** The phantom weight used when asIfApplied (the bracket-entry weight), absent otherwise. */
  asIfWeightKg?: number;
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
  if (index !== -1) {
    // Deficit-weight ("as-if") rule: price as the minimum weight of any higher bracket
    // (= the previous bracket's bound at that bracket's rate); keep the global minimum.
    for (let i = index + 1; i < breaks.length; i++) {
      const asIfWeightKg = breaks[i - 1].upToKg;
      const candidate = cwtOf(asIfWeightKg) * breaks[i].amount;
      if (candidate < base) {
        base = candidate;
        appliedBreak = { upToKg: breaks[i].upToKg, amount: breaks[i].amount, asIfApplied: true, asIfWeightKg };
      }
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
  let rawBase: number;
  let appliedBreak: AppliedBreak | null = null;
  switch (rate.rateType) {
    case RateType.FLAT:
    case RateType.SPOT:
      rawBase = rate.baseAmount;
      break;
    case RateType.PER_KM:
      if (metrics.distanceKm == null) return null;
      rawBase = rate.baseAmount * metrics.distanceKm;
      break;
    case RateType.PER_HUNDREDWEIGHT: {
      if (metrics.weightKg == null) return null;
      ({ base: rawBase, appliedBreak } = weightBase(rate, metrics.weightKg));
      break;
    }
    case RateType.PER_PALLET:
      if (metrics.palletCount == null) return null;
      rawBase = rate.baseAmount * metrics.palletCount;
      break;
    default:
      // Unknown rate types (e.g. stale DB values) mean "cannot estimate", not NaN.
      return null;
  }

  // Round base and fuel once before assembling lines so sum(lines[].amount) === total.
  const baseRounded = round2(rawBase);
  const rawFuel = rawBase * ((rate.fuelSurchargePct ?? 0) / 100);
  const fuelRounded = round2(rawFuel);

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
      amount: baseRounded,
    },
  ];
  /** A FUEL line is emitted only when the surcharge is non-zero. */
  if (fuelRounded > 0) {
    lines.push({ type: 'FUEL', label: `Fuel surcharge ${rate.fuelSurchargePct}%`, amount: fuelRounded });
  }
  lines.push(...accessorialLines);

  let total = baseRounded + fuelRounded + accessorialsTotal;
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
    base: baseRounded,
    fuelSurcharge: fuelRounded,
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
