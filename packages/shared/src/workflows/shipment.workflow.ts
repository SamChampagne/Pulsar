import { ShipmentStatus } from '../enums/transportation';

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  [ShipmentStatus.PENDING]: [ShipmentStatus.PLANNED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.PLANNED]: [
    ShipmentStatus.DISPATCHED,
    ShipmentStatus.PENDING,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.DISPATCHED]: [ShipmentStatus.IN_TRANSIT, ShipmentStatus.CANCELLED],
  [ShipmentStatus.IN_TRANSIT]: [ShipmentStatus.DELIVERED],
  [ShipmentStatus.DELIVERED]: [ShipmentStatus.CLOSED],
  [ShipmentStatus.CLOSED]: [],
  [ShipmentStatus.CANCELLED]: [],
};

export function canTransitionShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[from]?.includes(to) ?? false;
}
