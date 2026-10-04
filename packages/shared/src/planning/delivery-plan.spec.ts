import { describe, expect, it } from 'vitest';
import {
  buildDeliveryPlan,
  deliveryCoverageError,
  deliveryOrderError,
  suggestDeliveryOrder,
  type DeliveryStopInput,
} from './delivery-plan';
import { canTransitionStop } from '../workflows/stop.workflow';
import { StopStatus } from '../enums/transportation';
const stops: DeliveryStopInput[] = [
  { sequence: 1, type: 'PICKUP', locationId: 'a', shipmentId: 's' },
  {
    sequence: 2,
    type: 'DELIVERY',
    locationId: 'b',
    shipmentId: 's',
    plannedArrivalEarly: '2026-10-01T10:00:00Z',
    plannedArrivalLate: '2026-10-01T10:15:00Z',
    idleMinutes: 10,
  },
];
const options = {
  startAt: '2026-10-01T08:00:00Z',
  serviceMinutes: 20,
  loadedLitersPer100Km: 30,
  emptyLitersPer100Km: 20,
  idleLitersPerHour: 3,
  pricePerLiter: 1.6,
  currency: 'CAD',
  returnToStart: true,
};
const legs = [
  { distanceKm: 100, durationMin: 60, source: 'OSRM' as const },
  { distanceKm: 80, durationMin: 50, source: 'OSRM' as const },
];
describe('delivery itinerary and fuel', () => {
  it('counts loaded outbound, empty return, explicit idle and waiting separately', () => {
    const p = buildDeliveryPlan(stops, legs, options);
    expect(p.totals).toMatchObject({
      distanceKm: 180,
      drivingMinutes: 110,
      serviceMinutes: 40,
      waitingMinutes: 40,
      idleMinutes: 10,
      liters: 46.5,
      fuelCost: 74.4,
      finishAt: '2026-10-01T11:10:00.000Z',
    });
    expect(p.legs.map((l) => l.empty)).toEqual([false, true]);
    expect(p.schedule[1].arrivalAt).toBe('2026-10-01T09:20:00.000Z');
  });
  it('does not invent a fuel total when empty consumption is absent', () => {
    expect(
      buildDeliveryPlan(stops, legs, { ...options, emptyLitersPer100Km: undefined }).totals.liters,
    ).toBeNull();
  });
  it('does not invent time or a complete total across missing locations', () => {
    const p = buildDeliveryPlan(
      stops,
      [{ distanceKm: null, durationMin: null, source: 'UNKNOWN' }],
      { ...options, returnToStart: false },
    );
    expect(p.totals.distanceKm).toBeNull();
    expect(p.totals.fuelCost).toBeNull();
    expect(p.schedule[1].arrivalAt).toBeNull();
  });
  it('flags straight-line estimates and leaves their ETA unknown', () => {
    const p = buildDeliveryPlan(
      stops,
      [{ distanceKm: 80, durationMin: null, source: 'HAVERSINE' }],
      { ...options, returnToStart: false },
    );
    expect(p.totals.finishAt).toBeNull();
    expect(p.warnings.join(' ')).toContain('vol d’oiseau');
  });
  it('keeps no-price and explicit zero distinct', () => {
    expect(
      buildDeliveryPlan(stops, legs, { ...options, pricePerLiter: undefined }).totals.fuelCost,
    ).toBeNull();
    expect(buildDeliveryPlan(stops, legs, { ...options, pricePerLiter: 0 }).totals.fuelCost).toBe(
      0,
    );
  });
  it('does not infer the charge on legacy unlinked stops', () => {
    const p = buildDeliveryPlan(
      stops.map((s) => ({ ...s, shipmentId: null })),
      legs,
      options,
    );
    expect(p.totals.liters).toBeNull();
    expect(p.legs[0].empty).toBeNull();
  });
  it('respects per-stop service and declared not-before departure', () => {
    const p = buildDeliveryPlan(
      [{ ...stops[0], serviceMinutes: 5, plannedDepartureAt: '2026-10-01T09:00:00Z' }, stops[1]],
      legs,
      options,
    );
    expect(p.schedule[0].departureAt).toBe('2026-10-01T09:00:00.000Z');
    expect(p.totals.waitingMinutes).toBe(55);
  });
  it('marks missed delivery windows without treating estimates as actuals', () => {
    const p = buildDeliveryPlan(stops, legs, { ...options, startAt: '2026-10-01T10:00:00Z' });
    expect(p.schedule[1].lateMin).toBe(65);
    expect(p.schedule[1]).not.toHaveProperty('actualArrivalAt');
  });
  it('rejects an incomplete segment set', () =>
    expect(() => buildDeliveryPlan(stops, [], options)).toThrow());
  it('validates pairing, duplicates, ownership and full coverage', () => {
    expect(deliveryOrderError([...stops].reverse())).toBeTruthy();
    expect(deliveryOrderError([stops[0], ...stops])).toBeTruthy();
    expect(deliveryOrderError([stops[0]])).toBeTruthy();
    expect(
      deliveryCoverageError(stops, [
        { id: 's', originLocationId: 'a', destinationLocationId: 'b' },
      ]),
    ).toBeNull();
    expect(deliveryCoverageError(stops, [])).toBeTruthy();
    expect(
      deliveryCoverageError(stops, [
        { id: 's', originLocationId: 'a', destinationLocationId: 'c' },
      ]),
    ).toBeTruthy();
  });
  it('never reopens completed/skipped stops or departs before arriving', () => {
    expect(canTransitionStop(StopStatus.PENDING, StopStatus.DEPARTED)).toBe(false);
    expect(canTransitionStop(StopStatus.ARRIVED, StopStatus.DEPARTED)).toBe(true);
    expect(canTransitionStop(StopStatus.COMPLETED, StopStatus.ARRIVED)).toBe(false);
    expect(canTransitionStop(StopStatus.SKIPPED, StopStatus.ARRIVED)).toBe(false);
  });
});
describe('bounded directed-road order proposal', () => {
  const input = [
    stops[0],
    { ...stops[0], shipmentId: 't', locationId: 'a', sequence: 2 },
    { ...stops[1], plannedArrivalEarly: null, plannedArrivalLate: null, sequence: 3 },
    {
      ...stops[1],
      shipmentId: 't',
      locationId: 'c',
      plannedArrivalEarly: null,
      plannedArrivalLate: null,
      sequence: 4,
    },
  ];
  const distancesKm = [
    [0, 0, 100, 10],
    [0, 0, 100, 10],
    [100, 100, 0, 90],
    [10, 10, 90, 0],
  ];
  const matrix = { distancesKm, durationsMin: distancesKm };
  it('shortens the path without delivery before pickup or moving the first stop', () => {
    const order = suggestDeliveryOrder(input, matrix, { startAt: options.startAt });
    expect(order).toEqual([0, 1, 3, 2]);
    expect(deliveryOrderError(order.map((i) => input[i]))).toBeNull();
  });
  it('does not worsen tardiness to reduce kilometers', () => {
    const timed = input.map((s) => ({ ...s }));
    timed[2].plannedArrivalLate = '2026-10-01T09:45:00Z';
    // Going through c costs 30+90 min, direct to b is 100 min.
    const durationsMin = matrix.durationsMin.map((row) => [...row]);
    durationsMin[1][3] = 30;
    expect(
      suggestDeliveryOrder(timed, { ...matrix, durationsMin }, { startAt: options.startAt }),
    ).toEqual([0, 1, 2, 3]);
  });
  it('leaves an unreachable baseline unchanged rather than ignoring a destination', () => {
    const broken = matrix.distancesKm.map((row) => [...row] as (number | null)[]);
    broken[1][2] = null;
    expect(suggestDeliveryOrder(input, { ...matrix, distancesKm: broken }, {})).toEqual([
      0, 1, 2, 3,
    ]);
  });
});
