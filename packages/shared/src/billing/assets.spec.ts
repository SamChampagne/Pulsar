import { describe, it, expect } from 'vitest';
import { buildDepreciationSchedule, depreciationForNextPeriod, canTransitionFixedAsset, FixedAssetStatus } from './assets';

describe('buildDepreciationSchedule', () => {
  it('straight-line sums to cost − salvage; last period absorbs rounding; bookValue tracks', () => {
    const s = buildDepreciationSchedule({ cost: 1200, salvageValue: 0, usefulLifeMonths: 12 });
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ period: 1, amount: 100, accumulated: 100, bookValue: 1100 });
    expect(s[11].bookValue).toBe(0);
    expect(Math.round(s.reduce((a, r) => a + r.amount, 0) * 100) / 100).toBe(1200);
  });
  it('absorbs rounding on the last period', () => {
    const s = buildDepreciationSchedule({ cost: 100, salvageValue: 0, usefulLifeMonths: 3 }); // 33.33×2 + 33.34
    expect(Math.round(s.reduce((a, r) => a + r.amount, 0) * 100) / 100).toBe(100);
    expect(s[2].bookValue).toBe(0);
  });
});

describe('depreciationForNextPeriod', () => {
  it('caps so accumulated never exceeds cost − salvage', () => {
    expect(depreciationForNextPeriod({ cost: 1200, salvageValue: 0, usefulLifeMonths: 12, accumulated: 0 })).toBe(100);
    expect(depreciationForNextPeriod({ cost: 1200, salvageValue: 0, usefulLifeMonths: 12, accumulated: 1150 })).toBe(50);
    expect(depreciationForNextPeriod({ cost: 1200, salvageValue: 0, usefulLifeMonths: 12, accumulated: 1200 })).toBe(0);
  });
});

describe('canTransitionFixedAsset', () => {
  it('DRAFT→ACTIVE/DISPOSED, ACTIVE→DISPOSED, DISPOSED terminal', () => {
    expect(canTransitionFixedAsset(FixedAssetStatus.DRAFT, FixedAssetStatus.ACTIVE)).toBe(true);
    expect(canTransitionFixedAsset(FixedAssetStatus.ACTIVE, FixedAssetStatus.DISPOSED)).toBe(true);
    expect(canTransitionFixedAsset(FixedAssetStatus.DISPOSED, FixedAssetStatus.ACTIVE)).toBe(false);
    expect(canTransitionFixedAsset(FixedAssetStatus.ACTIVE, FixedAssetStatus.DRAFT)).toBe(false);
  });
});
