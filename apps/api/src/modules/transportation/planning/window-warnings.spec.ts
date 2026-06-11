import { shipmentWindowWarnings } from './window-warnings';

describe('shipmentWindowWarnings', () => {
  const order = {
    requestedPickupEarly: new Date('2026-07-01T08:00Z'),
    requestedPickupLate: new Date('2026-07-01T12:00Z'),
    requestedDeliveryEarly: null,
    requestedDeliveryLate: new Date('2026-07-02T17:00Z'),
  };

  it('returns [] when shipments are inside the requested windows', () => {
    expect(
      shipmentWindowWarnings(order, [
        {
          shipmentNumber: 'SH-1',
          plannedPickupEarly: new Date('2026-07-01T09:00Z'),
          plannedPickupLate: new Date('2026-07-01T11:00Z'),
          plannedDeliveryEarly: new Date('2026-07-02T08:00Z'),
          plannedDeliveryLate: new Date('2026-07-02T16:00Z'),
        },
      ]),
    ).toEqual([]);
  });

  it('tags each violation with the shipment number and the window field', () => {
    const warnings = shipmentWindowWarnings(order, [
      {
        shipmentNumber: 'SH-2',
        plannedPickupEarly: new Date('2026-07-01T14:00Z'), // after pickup late
        plannedPickupLate: null,
        plannedDeliveryEarly: null,
        plannedDeliveryLate: new Date('2026-07-03T08:00Z'), // after delivery late
      },
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({ shipmentNumber: 'SH-2', field: 'pickup', kind: 'AFTER_LATE' });
    expect(warnings[1]).toMatchObject({ shipmentNumber: 'SH-2', field: 'delivery', kind: 'AFTER_LATE' });
  });
});
