import { describe, expect, it } from 'vitest';
import { computeReplenishment } from './replenishment';

describe('computeReplenishment', () => {
  it('is OK when no reorder point is set', () => {
    expect(computeReplenishment({ onHand: 0 })).toEqual({
      status: 'OK',
      belowMin: false,
      suggestedQty: 0,
    });
  });

  it('flags BELOW_MIN at/under the reorder point and suggests up to the target', () => {
    const r = computeReplenishment({ onHand: 4, reorderPoint: 10, reorderQty: 50 });
    expect(r.status).toBe('BELOW_MIN');
    expect(r.belowMin).toBe(true);
    expect(r.suggestedQty).toBe(46);
  });

  it('suggests up to the reorder point when no target qty is set', () => {
    const r = computeReplenishment({ onHand: 2, reorderPoint: 10 });
    expect(r.suggestedQty).toBe(8);
  });

  it('is LOW just above the reorder point', () => {
    expect(computeReplenishment({ onHand: 11, reorderPoint: 10 }).status).toBe('LOW');
  });

  it('is OK comfortably above the reorder point', () => {
    expect(computeReplenishment({ onHand: 100, reorderPoint: 10 }).status).toBe('OK');
  });
});
