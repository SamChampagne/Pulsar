import { describe, expect, it } from 'vitest';
import { checkCapacity } from '../capacity';

describe('checkCapacity — 3 axes, unknown axes ignored', () => {
  const capacities = { weightKg: 1000, volumeM3: 50, pallets: 10 };

  it('returns [] when everything fits', () => {
    expect(checkCapacity(capacities, { weightKg: 900, volumeM3: 49.5, pallets: 10 })).toEqual([]);
  });

  it('exactly at capacity is NOT an excess (≤, not <)', () => {
    expect(checkCapacity(capacities, { weightKg: 1000, volumeM3: 50, pallets: 10 })).toEqual([]);
  });

  it('reports every exceeded axis with capacity/requested/excess', () => {
    const excesses = checkCapacity(capacities, { weightKg: 1200, volumeM3: 60, pallets: 12 });
    expect(excesses).toEqual([
      { axis: 'weightKg', capacity: 1000, requested: 1200, excess: 200 },
      { axis: 'volumeM3', capacity: 50, requested: 60, excess: 10 },
      { axis: 'pallets', capacity: 10, requested: 12, excess: 2 },
    ]);
  });

  it('an axis without a capacity OR without a computable total is ignored', () => {
    expect(checkCapacity({ weightKg: null, volumeM3: 50, pallets: null }, { weightKg: 99999, volumeM3: null, pallets: 99 })).toEqual([]);
  });

  it('fractional excess is rounded to 2 decimals', () => {
    expect(checkCapacity({ weightKg: 100, volumeM3: null, pallets: null }, { weightKg: 100.005, volumeM3: null, pallets: null })).toEqual([
      { axis: 'weightKg', capacity: 100, requested: 100.01, excess: 0.01 },
    ]);
  });

  it('sub-rounding overage (< 0.005) is not an excess at all', () => {
    expect(checkCapacity({ weightKg: 100, volumeM3: null, pallets: null }, { weightKg: 100.004, volumeM3: null, pallets: null })).toEqual([]);
  });
});
