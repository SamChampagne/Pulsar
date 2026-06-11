import { RatingService, compareRateOptions, RateOption } from './rating.service';

describe('RatingService (pure helpers)', () => {
  const service = new RatingService(null as never);

  describe('referenceDate', () => {
    it('uses the earliest planned pickup of the shipments', () => {
      const date = service.referenceDate([
        { plannedPickupEarly: new Date('2026-07-02') },
        { plannedPickupEarly: new Date('2026-07-01') },
        { plannedPickupEarly: null },
      ]);
      expect(date.toISOString()).toBe(new Date('2026-07-01').toISOString());
    });

    it('falls back to now when no shipment has a planned pickup', () => {
      const before = Date.now();
      const date = service.referenceDate([{ plannedPickupEarly: null }]);
      expect(date.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('isValidAt — same reference date governs validFrom/validTo AND fuel entries', () => {
    const date = new Date('2026-07-01');
    it('open-ended rates are valid', () => {
      expect(service.isValidAt({ validFrom: null, validTo: null }, date)).toBe(true);
    });
    it('bounded rates honour both bounds', () => {
      expect(service.isValidAt({ validFrom: new Date('2026-06-01'), validTo: new Date('2026-06-30') }, date)).toBe(false);
      expect(service.isValidAt({ validFrom: new Date('2026-07-01'), validTo: null }, date)).toBe(true);
      expect(service.isValidAt({ validFrom: null, validTo: new Date('2026-07-01') }, date)).toBe(true);
    });

    it('returns false when rate has not yet started at reference date', () => {
      expect(service.isValidAt({ validFrom: new Date('2026-08-01'), validTo: null }, date)).toBe(false);
    });

    it('returns false when rate has already expired at reference date', () => {
      expect(service.isValidAt({ validFrom: null, validTo: new Date('2026-06-30') }, date)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// compareRateOptions — deterministic ordering for rate shopping results
// ---------------------------------------------------------------------------

function makeOption(overrides: Partial<RateOption> & { rateId: string }): RateOption {
  return {
    rateId: overrides.rateId,
    currency: overrides.currency ?? 'CAD',
    breakdown: overrides.breakdown ?? { total: 100 },
    missingAccessorials: overrides.missingAccessorials ?? [],
    laneSpecificity: overrides.laneSpecificity ?? null,
  };
}

describe('compareRateOptions', () => {
  it('sorts by total asc when currency and completeness tie', () => {
    const cheap = makeOption({ rateId: 'r1', breakdown: { total: 50 } });
    const expensive = makeOption({ rateId: 'r2', breakdown: { total: 200 } });
    expect([expensive, cheap].sort(compareRateOptions)).toEqual([cheap, expensive]);
  });

  it('breaks equal totals by laneSpecificity desc (more specific wins)', () => {
    const catchAll = makeOption({ rateId: 'r-catchall', breakdown: { total: 100 }, laneSpecificity: null });
    const specific = makeOption({ rateId: 'r-specific', breakdown: { total: 100 }, laneSpecificity: { total: 5 } });
    const result = [catchAll, specific].sort(compareRateOptions);
    // specific (total=5) should come before catch-all (total=-1)
    expect(result[0].rateId).toBe('r-specific');
    expect(result[1].rateId).toBe('r-catchall');
  });

  it('breaks full ties (same total, same specificity) by rateId asc', () => {
    const rZ = makeOption({ rateId: 'rate-Z', breakdown: { total: 100 }, laneSpecificity: { total: 3 } });
    const rA = makeOption({ rateId: 'rate-A', breakdown: { total: 100 }, laneSpecificity: { total: 3 } });
    const result = [rZ, rA].sort(compareRateOptions);
    expect(result[0].rateId).toBe('rate-A');
    expect(result[1].rateId).toBe('rate-Z');
  });

  it('puts incomplete options (missing accessorials) after complete ones', () => {
    const incomplete = makeOption({ rateId: 'r-inc', missingAccessorials: ['LIFT'] });
    const complete = makeOption({ rateId: 'r-cmp', breakdown: { total: 999 } }); // higher total
    const result = [incomplete, complete].sort(compareRateOptions);
    expect(result[0].rateId).toBe('r-cmp');
    expect(result[1].rateId).toBe('r-inc');
  });

  it('sorts by currency asc before everything else', () => {
    const cad = makeOption({ rateId: 'r-cad', currency: 'CAD', breakdown: { total: 1 } });
    const usd = makeOption({ rateId: 'r-usd', currency: 'USD', breakdown: { total: 1000 } });
    const result = [usd, cad].sort(compareRateOptions);
    expect(result[0].currency).toBe('CAD');
  });
});
