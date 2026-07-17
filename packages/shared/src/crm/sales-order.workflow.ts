// Pure, browser-safe. No Node imports.
export enum SalesOrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  FULFILLED = 'FULFILLED',
  INVOICED = 'INVOICED',
  CANCELLED = 'CANCELLED',
}

const TRANSITIONS: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  [SalesOrderStatus.DRAFT]: [SalesOrderStatus.CONFIRMED, SalesOrderStatus.CANCELLED],
  [SalesOrderStatus.CONFIRMED]: [SalesOrderStatus.FULFILLED, SalesOrderStatus.CANCELLED],
  [SalesOrderStatus.FULFILLED]: [SalesOrderStatus.INVOICED],
  [SalesOrderStatus.INVOICED]: [],
  [SalesOrderStatus.CANCELLED]: [],
};

export function canTransitionSalesOrder(from: SalesOrderStatus, to: SalesOrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Open = not in a terminal state (INVOICED/CANCELLED). */
export function isSalesOrderOpen(s: SalesOrderStatus): boolean {
  return s !== SalesOrderStatus.INVOICED && s !== SalesOrderStatus.CANCELLED;
}

/**
 * Pure decision: should a sales order be auto-fulfilled given the statuses of
 * the transport orders derived from it?
 *
 * A sales order is fulfilled once every linked transport order is terminal AND
 * at least one was actually delivered (COMPLETED/CLOSED). A cancelled transport
 * order neither blocks fulfillment nor counts as a delivery — a sales order
 * whose only transport order was cancelled stays CONFIRMED. Transport-order
 * statuses are passed as strings to keep this helper decoupled from the TMS
 * enum (it is consumed by the CRM ⇄ TMS fulfillment reaction). Idempotent by
 * construction — the caller still guards the actual transition with
 * canTransitionSalesOrder + a conditional claim.
 */
export type FulfillmentReason =
  | 'no-transport-orders'
  | 'active-remaining'
  | 'all-cancelled'
  | 'all-delivered';

const TO_DELIVERED = new Set(['COMPLETED', 'CLOSED']);
const TO_CANCELLED = 'CANCELLED';

export function deriveSalesOrderFulfillment(
  transportOrderStatuses: readonly string[],
): { fulfill: boolean; reason: FulfillmentReason } {
  if (transportOrderStatuses.length === 0) {
    return { fulfill: false, reason: 'no-transport-orders' };
  }
  const active = transportOrderStatuses.filter(
    (s) => !TO_DELIVERED.has(s) && s !== TO_CANCELLED,
  );
  if (active.length > 0) return { fulfill: false, reason: 'active-remaining' };
  const delivered = transportOrderStatuses.filter((s) => TO_DELIVERED.has(s));
  if (delivered.length === 0) return { fulfill: false, reason: 'all-cancelled' };
  return { fulfill: true, reason: 'all-delivered' };
}
