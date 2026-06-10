import { TransportOrderStatus } from '../enums/transportation';

/**
 * Allowed status transitions for a TransportOrder.
 * Enforced in apps/api TransportOrdersService — never bypass with raw updates.
 */
export const TRANSPORT_ORDER_TRANSITIONS: Record<TransportOrderStatus, TransportOrderStatus[]> = {
  [TransportOrderStatus.DRAFT]: [TransportOrderStatus.CONFIRMED, TransportOrderStatus.CANCELLED],
  [TransportOrderStatus.CONFIRMED]: [TransportOrderStatus.PLANNED, TransportOrderStatus.CANCELLED],
  [TransportOrderStatus.PLANNED]: [
    TransportOrderStatus.IN_EXECUTION,
    TransportOrderStatus.CONFIRMED,
    TransportOrderStatus.CANCELLED,
  ],
  [TransportOrderStatus.IN_EXECUTION]: [TransportOrderStatus.COMPLETED],
  [TransportOrderStatus.COMPLETED]: [TransportOrderStatus.CLOSED],
  [TransportOrderStatus.CLOSED]: [],
  [TransportOrderStatus.CANCELLED]: [],
};

export function canTransitionTransportOrder(
  from: TransportOrderStatus,
  to: TransportOrderStatus,
): boolean {
  return TRANSPORT_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
