import { BadRequestException } from '@nestjs/common';
import { assertWindowCoherence, resolveSplitWindows } from './window-validation';

describe('assertWindowCoherence', () => {
  it('passes coherent and open windows', () => {
    expect(() =>
      assertWindowCoherence({ pickupEarly: new Date('2026-07-01'), deliveryLate: new Date('2026-07-02') }),
    ).not.toThrow();
    expect(() => assertWindowCoherence({})).not.toThrow();
  });
  it('rejects early > late within a pair', () => {
    expect(() =>
      assertWindowCoherence({ pickupEarly: new Date('2026-07-02'), pickupLate: new Date('2026-07-01') }),
    ).toThrow(BadRequestException);
  });
  it('rejects pickupEarly after deliveryLate, allows overlapping windows', () => {
    expect(() =>
      assertWindowCoherence({ pickupEarly: new Date('2026-07-03'), deliveryLate: new Date('2026-07-02') }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertWindowCoherence({
        pickupEarly: new Date('2026-07-01T08:00Z'),
        pickupLate: new Date('2026-07-01T17:00Z'),
        deliveryEarly: new Date('2026-07-01T14:00Z'),
        deliveryLate: new Date('2026-07-01T18:00Z'),
      }),
    ).not.toThrow();
  });
});

describe('resolveSplitWindows', () => {
  const order = {
    requestedPickupEarly: new Date('2026-07-01T08:00Z'),
    requestedPickupLate: new Date('2026-07-01T12:00Z'),
    requestedDeliveryEarly: null,
    requestedDeliveryLate: null,
  };
  it('absent fields inherit the requested bounds', () => {
    const w = resolveSplitWindows(order, {});
    expect(w.plannedPickupEarly).toEqual(order.requestedPickupEarly);
    expect(w.plannedPickupLate).toEqual(order.requestedPickupLate);
  });
  it('an EXPLICIT null stays null (open bound), not inherited', () => {
    const w = resolveSplitWindows(order, { plannedPickupLate: null });
    expect(w.plannedPickupLate).toBeNull();
  });
  it('provided strings win', () => {
    const w = resolveSplitWindows(order, { plannedPickupEarly: '2026-07-01T09:00:00.000Z' });
    expect(w.plannedPickupEarly).toEqual(new Date('2026-07-01T09:00:00.000Z'));
  });
});
