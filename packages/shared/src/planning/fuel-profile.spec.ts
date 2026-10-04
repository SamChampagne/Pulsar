import { describe, expect, it } from 'vitest';
import {
  applyDeliveryFuelParameters,
  compareDeliveryFuel,
  deliveryFuelDate,
  deliveryFuelRange,
  validateDeliveryFuelActual,
  validateDeliveryFuelPrice,
  validateDeliveryFuelProfile,
  validateDeliveryFuelSource,
} from './fuel-profile';

const profile = {
  loadedLitersPer100Km: 35,
  emptyLitersPer100Km: 25,
  idleLitersPerHour: 3,
  tankCapacityLitres: 600,
  reserveLitres: 60,
};
const price = {
  effectiveOn: '2026-10-02',
  pricePerLitre: '001.6500',
  currency: 'CAD',
  reference: 'Prix déclaré localement',
};
const actual = {
  distanceKm: '125.500',
  consumedLitres: '40',
  costAmount: '66.00',
  currency: 'CAD',
  measuredAt: '2026-10-02T08:30:00-04:00',
  note: 'Total compteur et relevé manuel',
};
describe('delivery fuel profiles', () => {
  it('validates a closed explicit profile without mutating it', () => {
    expect(validateDeliveryFuelProfile(profile)).toEqual(profile);
    expect(() => validateDeliveryFuelProfile({ ...profile, telemetry: true })).toThrow();
  });
  it.each([
    { reserveLitres: 600 },
    { tankCapacityLitres: 0 },
    { loadedLitersPer100Km: 0 },
    { emptyLitersPer100Km: Infinity },
    { idleLitersPerHour: 101 },
    { loadedLitersPer100Km: 20.1234 },
  ])('rejects invalid capacities/consumption %j', (change) => {
    expect(() => validateDeliveryFuelProfile({ ...profile, ...change })).toThrow();
  });
  it('normalizes declared prices without converting currencies', () => {
    expect(validateDeliveryFuelPrice(price).pricePerLitre).toBe('1.65');
    expect(() => validateDeliveryFuelPrice({ ...price, currency: 'BTC' })).toThrow();
    expect(() => validateDeliveryFuelPrice({ ...price, pricePerLitre: '0' })).toThrow();
  });
  it.each(['2026-02-29', '2026-10-32', '2026-01-01T00:00:00Z', '10/02/2026'])(
    'rejects an invalid civil date %s',
    (date) => {
      expect(() => deliveryFuelDate(date)).toThrow();
    },
  );
  it('accepts leap dates and explicitly dated future records, without selecting them', () => {
    expect(deliveryFuelDate('2028-02-29')).toBe('2028-02-29');
    expect(validateDeliveryFuelPrice({ ...price, effectiveOn: '2028-02-29' }).effectiveOn).toBe(
      '2028-02-29',
    );
  });
  it('keeps exact declared decimal strings and UTC timestamps', () => {
    expect(validateDeliveryFuelActual(actual)).toEqual({
      ...actual,
      distanceKm: '125.5',
      costAmount: '66',
      measuredAt: '2026-10-02T12:30:00.000Z',
    });
  });
  it('distinguishes unknown costs from explicit zero, and requires currency only with cost', () => {
    expect(
      validateDeliveryFuelActual({ ...actual, costAmount: null, currency: null }).costAmount,
    ).toBeNull();
    expect(validateDeliveryFuelActual({ ...actual, costAmount: '0' }).costAmount).toBe('0');
    expect(() => validateDeliveryFuelActual({ ...actual, costAmount: null })).toThrow();
    expect(() => validateDeliveryFuelActual({ ...actual, costAmount: '3.111' })).toThrow();
  });
  it('rejects unbounded/negative/fractionally invalid measurements and local timestamps', () => {
    for (const change of [
      { distanceKm: '-1' },
      { consumedLitres: '1e4' },
      { distanceKm: '1000001' },
      { measuredAt: '2026-10-02T08:30:00' },
      { measuredAt: '2026-02-30T08:30:00Z' },
      { measuredAt: '2026-10-02T24:30:00Z' },
      { note: 'x' },
    ])
      expect(() => validateDeliveryFuelActual({ ...actual, ...change })).toThrow();
  });
  it('requires explicit source revisions and rejects client snapshots', () => {
    const source = {
      vehicleId: 'v',
      profileRevision: 1,
      priceRevision: 3,
      currency: 'CAD',
      asOf: '2026-10-02',
    };
    expect(validateDeliveryFuelSource(source)).toEqual(source);
    expect(() => validateDeliveryFuelSource({ ...source, profileRevision: 0 })).toThrow();
    expect(() => validateDeliveryFuelSource({ ...source, profile })).toThrow();
  });
  it('copies exactly the five plan parameters; tank data is not injected as an option', () => {
    expect(applyDeliveryFuelParameters(profile, validateDeliveryFuelPrice(price))).toEqual({
      loadedLitersPer100Km: 35,
      emptyLitersPer100Km: 25,
      idleLitersPerHour: 3,
      pricePerLiter: 1.65,
      currency: 'CAD',
    });
  });
  it('computes only theoretical tank-full range and never turns an unknown plan into zero', () => {
    expect(deliveryFuelRange(profile, null)).toEqual({
      usableLitres: 540,
      loadedRangeKm: 1542.86,
      emptyRangeKm: 2160,
      exceedsUsableTank: null,
    });
    expect(deliveryFuelRange(profile, 541).exceedsUsableTank).toBe(true);
  });
  it('compares against captured totals and never changes them', () => {
    const baseline = { totals: { distanceKm: 120, liters: 38, fuelCost: 62.7, currency: 'CAD' } };
    const saved = JSON.stringify(baseline);
    expect(compareDeliveryFuel(validateDeliveryFuelActual(actual), baseline)).toMatchObject({
      deltaDistanceKm: 5.5,
      deltaLitres: 2,
      deltaCostAmount: 3.3,
      costComparable: true,
    });
    expect(JSON.stringify(baseline)).toBe(saved);
  });
  it('never compares currencies or absent plan totals as zero', () => {
    expect(compareDeliveryFuel(validateDeliveryFuelActual(actual), null)).toMatchObject({
      deltaDistanceKm: null,
      deltaLitres: null,
      deltaCostAmount: null,
    });
    expect(
      compareDeliveryFuel(validateDeliveryFuelActual(actual), {
        totals: { distanceKm: 0, liters: 0, fuelCost: 0, currency: 'USD' },
      }),
    ).toMatchObject({
      deltaDistanceKm: 125.5,
      deltaLitres: 40,
      deltaCostAmount: null,
      costComparable: false,
    });
  });
});
