import { describe, it, expect } from 'vitest';
import { fiscalYearBounds } from './fiscal';
describe('fiscalYearBounds', () => {
  it('startMonth=1 → Jan 1 .. Dec 31 end-of-day (same as calendar)', () => {
    const { from, to } = fiscalYearBounds(2026, 1);
    expect(from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });
  it('startMonth=4 (April) → Apr 1 fy .. Mar 31 fy+1 end-of-day', () => {
    const { from, to } = fiscalYearBounds(2026, 4);
    expect(from.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2027-03-31T23:59:59.999Z');
  });
  it('clamps out-of-range startMonth to 1', () => {
    expect(fiscalYearBounds(2026, 0).from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(fiscalYearBounds(2026, 13).from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
