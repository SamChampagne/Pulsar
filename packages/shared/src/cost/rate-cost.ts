import { RateType } from '../enums/transportation';

export interface RateLike {
  rateType: RateType;
  /** Base amount in the rate's currency. */
  baseAmount: number;
  fuelSurchargePct?: number | null;
  minCharge?: number | null;
}

export interface CostMetrics {
  distanceKm?: number | null;
  weightKg?: number | null;
  palletCount?: number | null;
}

export interface CostBreakdown {
  base: number;
  fuelSurcharge: number;
  total: number;
}

const KG_PER_CWT = 45.359237; // 1 hundredweight (CWT) = 100 lb

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Computes the estimated cost of a load for a given rate.
 * Returns null when the metric required by the rate type is missing
 * (e.g. PER_KM without a route distance) — callers should treat null as
 * "cannot estimate yet", not as zero.
 */
export function calculateRateCost(rate: RateLike, metrics: CostMetrics): CostBreakdown | null {
  let base: number;
  switch (rate.rateType) {
    case RateType.FLAT:
    case RateType.SPOT:
      base = rate.baseAmount;
      break;
    case RateType.PER_KM:
      if (metrics.distanceKm == null) return null;
      base = rate.baseAmount * metrics.distanceKm;
      break;
    case RateType.PER_HUNDREDWEIGHT:
      if (metrics.weightKg == null) return null;
      base = rate.baseAmount * (metrics.weightKg / KG_PER_CWT);
      break;
    case RateType.PER_PALLET:
      if (metrics.palletCount == null) return null;
      base = rate.baseAmount * metrics.palletCount;
      break;
  }

  const fuelSurcharge = base * ((rate.fuelSurchargePct ?? 0) / 100);
  let total = base + fuelSurcharge;
  if (rate.minCharge != null && total < rate.minCharge) {
    total = rate.minCharge;
  }
  return { base: round2(base), fuelSurcharge: round2(fuelSurcharge), total: round2(total) };
}
