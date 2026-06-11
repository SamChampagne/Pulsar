import { WindowViolation, windowViolations } from '@pulsar/shared';

interface RequestedWindows {
  requestedPickupEarly: Date | null;
  requestedPickupLate: Date | null;
  requestedDeliveryEarly: Date | null;
  requestedDeliveryLate: Date | null;
}

interface PlannedShipmentWindows {
  shipmentNumber: string;
  plannedPickupEarly: Date | null;
  plannedPickupLate: Date | null;
  plannedDeliveryEarly: Date | null;
  plannedDeliveryLate: Date | null;
}

export interface ShipmentWindowWarning extends WindowViolation {
  shipmentNumber: string;
}

/** Advisory: planned shipment windows vs the order's requested windows. Never blocking. */
export function shipmentWindowWarnings(
  order: RequestedWindows,
  shipments: PlannedShipmentWindows[],
): ShipmentWindowWarning[] {
  return shipments.flatMap((s) =>
    [
      ...windowViolations(
        'pickup',
        { early: order.requestedPickupEarly, late: order.requestedPickupLate },
        { early: s.plannedPickupEarly, late: s.plannedPickupLate },
      ),
      ...windowViolations(
        'delivery',
        { early: order.requestedDeliveryEarly, late: order.requestedDeliveryLate },
        { early: s.plannedDeliveryEarly, late: s.plannedDeliveryLate },
      ),
    ].map((v) => ({ ...v, shipmentNumber: s.shipmentNumber })),
  );
}
