import { describe, expect, it } from 'vitest';
import { AccessorialUnit, RateType } from '../../enums/transportation';
import { calculateRateCost, pickFuelEntry } from '../rate-cost';

describe('calculateRateCost — v1 behaviours kept', () => {
  it('FLAT: base + fuel surcharge', () => {
    const cost = calculateRateCost({ rateType: RateType.FLAT, baseAmount: 1000, fuelSurchargePct: 12 }, {});
    expect(cost?.base).toBe(1000);
    expect(cost?.fuelSurcharge).toBe(120);
    expect(cost?.total).toBe(1120);
    expect(cost?.lines.map((l) => l.type)).toEqual(['BASE', 'FUEL']);
  });

  it('PER_KM multiplies by distance; null without distance', () => {
    expect(calculateRateCost({ rateType: RateType.PER_KM, baseAmount: 2.5 }, { distanceKm: 250 })?.total).toBe(625);
    expect(calculateRateCost({ rateType: RateType.PER_KM, baseAmount: 2.5 }, {})).toBeNull();
  });

  it('PER_HUNDREDWEIGHT without breaks uses baseAmount per CWT', () => {
    // 4535.9237 kg = exactly 100 CWT
    expect(
      calculateRateCost({ rateType: RateType.PER_HUNDREDWEIGHT, baseAmount: 10 }, { weightKg: 4535.9237 })?.total,
    ).toBe(1000);
  });

  it('PER_PALLET multiplies by pallet count', () => {
    expect(
      calculateRateCost({ rateType: RateType.PER_PALLET, baseAmount: 45, fuelSurchargePct: 10 }, { palletCount: 20 })
        ?.total,
    ).toBe(990);
  });

  it('SPOT behaves like FLAT', () => {
    expect(calculateRateCost({ rateType: RateType.SPOT, baseAmount: 850 }, {})?.total).toBe(850);
  });
});

describe('weight breaks + as-if (deficit weight)', () => {
  const rate = {
    rateType: RateType.PER_HUNDREDWEIGHT,
    baseAmount: 999, // ignored when breaks exist
    breaks: [
      { upToKg: 500, amount: 20 },
      { upToKg: 1000, amount: 15 },
      { upToKg: 5000, amount: 10 },
    ],
  };

  it('picks the bracket containing the weight (own bracket cheaper → no as-if)', () => {
    const cost = calculateRateCost(rate, { weightKg: 660 });
    // 660 kg = 14.5505 CWT × 15 = 218.26 < as-if cwt(1000)×10 = 220.46
    expect(cost?.total).toBe(218.26);
    expect(cost?.appliedBreak).toEqual({ upToKg: 1000, amount: 15, asIfApplied: false });
  });

  it('as-if applies in middle brackets too, not only the first one', () => {
    const cost = calculateRateCost(rate, { weightKg: 900 });
    // own: cwt(900)×15 = 297.62 ; as-if: cwt(1000)×10 = 220.46 → min wins
    expect(cost?.total).toBe(220.46);
    expect(cost?.appliedBreak).toEqual({ upToKg: 5000, amount: 10, asIfApplied: true, asIfWeightKg: 1000 });
  });

  it('weights beyond the last bracket use the last bracket', () => {
    const cost = calculateRateCost(rate, { weightKg: 9000 });
    expect(cost?.appliedBreak).toEqual({ upToKg: 5000, amount: 10, asIfApplied: false });
  });

  it('as-if: 480 kg must not cost more than 500 kg (spec demo case)', () => {
    const at480 = calculateRateCost(rate, { weightKg: 480 });
    const at500 = calculateRateCost(rate, { weightKg: 500 });
    // 480 kg in bracket ≤500 @20 = 211.65 ; as-if 500 kg in bracket ≤1000 @15 = 165.35 → min wins
    expect(at480?.total).toBe(165.35);
    expect(at480?.appliedBreak).toEqual({ upToKg: 1000, amount: 15, asIfApplied: true, asIfWeightKg: 500 });
    expect(at480!.total).toBeLessThanOrEqual(at500!.total!);
  });

  it('as-if is not applied when the own bracket is cheaper', () => {
    const cost = calculateRateCost(rate, { weightKg: 100 });
    // 100 kg @20 = 44.09 < as-if 500 kg @15 = 165.35
    expect(cost?.appliedBreak?.asIfApplied).toBe(false);
  });

  it('as-if scans ALL higher brackets, not only the adjacent one (valley tables)', () => {
    const valley = {
      rateType: RateType.PER_HUNDREDWEIGHT,
      baseAmount: 999,
      breaks: [
        { upToKg: 100, amount: 50 },
        { upToKg: 300, amount: 45 },
        { upToKg: 5000, amount: 3 },
      ],
    };
    const cost = calculateRateCost(valley, { weightKg: 80 });
    // own: cwt(80)×50 = 88.18 ; adjacent as-if: cwt(100)×45 = 99.21 (worse) ; cwt(300)×3 = 19.84 (best)
    expect(cost?.total).toBe(19.84);
    expect(cost?.appliedBreak).toEqual({ upToKg: 5000, amount: 3, asIfApplied: true, asIfWeightKg: 300 });
  });
});

describe('accessorials', () => {
  const rate = {
    rateType: RateType.FLAT,
    baseAmount: 1000,
    accessorialPrices: [
      { code: 'TAILGATE', amount: 75 },
      { code: 'WAIT_HOUR', amount: 60 },
    ],
  };

  it('FLAT unit ignores quantity; PER_HOUR/PER_UNIT multiply', () => {
    const cost = calculateRateCost(rate, {}, [
      { code: 'TAILGATE', unit: AccessorialUnit.FLAT, quantity: 3 },
      { code: 'WAIT_HOUR', unit: AccessorialUnit.PER_HOUR, quantity: 2.5 },
    ]);
    expect(cost?.accessorialsTotal).toBe(225); // 75 + 60×2.5
    expect(cost?.total).toBe(1225);
    expect(cost?.missingAccessorials).toEqual([]);
  });

  it('unpriced requested accessorials are flagged, total still computed', () => {
    const cost = calculateRateCost(rate, {}, [
      { code: 'RESIDENTIAL', unit: AccessorialUnit.FLAT, quantity: 1 },
    ]);
    expect(cost?.total).toBe(1000);
    expect(cost?.missingAccessorials).toEqual(['RESIDENTIAL']);
  });
});

describe('minimum charge', () => {
  it('applies after fuel AND accessorials, as an adjustment line', () => {
    const cost = calculateRateCost(
      {
        rateType: RateType.FLAT,
        baseAmount: 100,
        fuelSurchargePct: 10,
        minCharge: 500,
        accessorialPrices: [{ code: 'TAILGATE', amount: 50 }],
      },
      {},
      [{ code: 'TAILGATE', unit: AccessorialUnit.FLAT, quantity: 1 }],
    );
    // 100 + 10 + 50 = 160 → adjusted to 500
    expect(cost?.total).toBe(500);
    expect(cost?.lines.at(-1)).toEqual({
      type: 'MIN_CHARGE_ADJUSTMENT',
      label: 'Minimum charge adjustment',
      amount: 340,
    });
  });
});

describe('lines-sum invariant', () => {
  it('sum of line amounts always equals the total (billing snapshot invariant)', () => {
    const cost = calculateRateCost(
      { rateType: RateType.PER_KM, baseAmount: 1.111, fuelSurchargePct: 7.3, minCharge: 500 },
      { distanceKm: 123.4 },
    );
    const sum = cost!.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(cost!.total);
  });
});

describe('pickFuelEntry', () => {
  const entries = [
    { effectiveFrom: new Date('2026-01-01'), pct: 8 },
    { effectiveFrom: new Date('2026-06-01'), pct: 12 },
  ];

  it('picks the latest entry effective at the reference date', () => {
    expect(pickFuelEntry(entries, new Date('2026-03-15'))?.pct).toBe(8);
    expect(pickFuelEntry(entries, new Date('2026-06-01'))?.pct).toBe(12);
  });

  it('returns null when no entry is effective yet', () => {
    expect(pickFuelEntry(entries, new Date('2025-12-31'))).toBeNull();
  });
});
