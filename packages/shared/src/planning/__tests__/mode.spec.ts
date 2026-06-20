import { describe, expect, it } from 'vitest';
import { TransportMode } from '../../enums/transportation';
import { suggestMode } from '../mode';

describe('suggestMode — non-binding weight-threshold hint', () => {
  it('suggests PARCEL up to 30 kg, LTL up to 4000 kg, FTL beyond', () => {
    expect(suggestMode(10)).toBe(TransportMode.PARCEL);
    expect(suggestMode(30)).toBe(TransportMode.PARCEL);
    expect(suggestMode(31)).toBe(TransportMode.LTL);
    expect(suggestMode(4000)).toBe(TransportMode.LTL);
    expect(suggestMode(4001)).toBe(TransportMode.FTL);
  });
  it('returns null when weight is unknown', () => {
    expect(suggestMode(null)).toBeNull();
    expect(suggestMode(undefined)).toBeNull();
  });
  it('reclassifies when custom thresholds are provided', () => {
    // 50 kg is LTL at defaults (>30), but PARCEL at parcelMax=100
    expect(suggestMode(50, 100, 4000)).toBe(TransportMode.PARCEL);
    // 5000 kg is FTL at defaults (>4000), but LTL at ltlMax=6000
    expect(suggestMode(5000, 30, 6000)).toBe(TransportMode.LTL);
  });
});
