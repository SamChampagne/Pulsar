import { RatingService } from './rating.service';

describe('RatingService (pure helpers)', () => {
  const service = new RatingService(null as never);

  describe('referenceDate', () => {
    it('uses the earliest planned pickup of the shipments', () => {
      const date = service.referenceDate([
        { plannedPickupAt: new Date('2026-07-02') },
        { plannedPickupAt: new Date('2026-07-01') },
        { plannedPickupAt: null },
      ]);
      expect(date.toISOString()).toBe(new Date('2026-07-01').toISOString());
    });

    it('falls back to now when no shipment has a planned pickup', () => {
      const before = Date.now();
      const date = service.referenceDate([{ plannedPickupAt: null }]);
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
  });
});
