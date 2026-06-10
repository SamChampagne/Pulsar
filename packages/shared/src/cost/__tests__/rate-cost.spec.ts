import { describe, expect, it } from 'vitest';
import { RateType } from '../../enums/transportation';
import { calculateRateCost } from '../rate-cost';

describe('calculateRateCost', () => {
  it('FLAT: base amount + fuel surcharge', () => {
    const cost = calculateRateCost(
      { rateType: RateType.FLAT, baseAmount: 1000, fuelSurchargePct: 12 },
      {},
    );
    expect(cost).toEqual({ base: 1000, fuelSurcharge: 120, total: 1120 });
  });

  it('PER_KM: multiplies by route distance', () => {
    const cost = calculateRateCost(
      { rateType: RateType.PER_KM, baseAmount: 2.5 },
      { distanceKm: 250 },
    );
    expect(cost).toEqual({ base: 625, fuelSurcharge: 0, total: 625 });
  });

  it('PER_KM without distance → null (cannot estimate)', () => {
    expect(calculateRateCost({ rateType: RateType.PER_KM, baseAmount: 2.5 }, {})).toBeNull();
  });

  it('PER_HUNDREDWEIGHT: converts kg to CWT (100 lb)', () => {
    // 4535.9237 kg = exactly 100 CWT
    const cost = calculateRateCost(
      { rateType: RateType.PER_HUNDREDWEIGHT, baseAmount: 10 },
      { weightKg: 4535.9237 },
    );
    expect(cost?.total).toBe(1000);
  });

  it('PER_PALLET: multiplies by pallet count', () => {
    const cost = calculateRateCost(
      { rateType: RateType.PER_PALLET, baseAmount: 45, fuelSurchargePct: 10 },
      { palletCount: 20 },
    );
    expect(cost).toEqual({ base: 900, fuelSurcharge: 90, total: 990 });
  });

  it('applies the minimum charge when the computed total is below it', () => {
    const cost = calculateRateCost(
      { rateType: RateType.PER_KM, baseAmount: 1, minCharge: 500 },
      { distanceKm: 100 },
    );
    expect(cost?.total).toBe(500);
  });

  it('SPOT behaves like FLAT', () => {
    expect(calculateRateCost({ rateType: RateType.SPOT, baseAmount: 850 }, {})?.total).toBe(850);
  });
});
