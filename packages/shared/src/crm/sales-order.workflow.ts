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

/**
 * Logistics contract for preparing a shipment from a sales order. Pure and
 * browser-safe so the API service (source of truth), the agent tool and the
 * SvelteKit wizard all validate identically. The rule (product decision):
 * origin, destination and mode are required, AND at least one physical measure
 * must be STRICTLY positive — zeros never satisfy it, and nothing is inferred
 * from commercial amounts/quantities. Time windows stay optional.
 */
export interface FulfillmentLogisticsInput {
  originLocationId?: string | null;
  destinationLocationId?: string | null;
  mode?: string | null;
  totalWeightKg?: number | null;
  totalVolumeM3?: number | null;
  palletCount?: number | null;
}

/** The fields a shipment always requires (for UI hints and the READ context tool). */
export const FULFILLMENT_REQUIRED_LOGISTICS = [
  'originLocationId',
  'destinationLocationId',
  'mode',
  'at least one of: totalWeightKg, totalVolumeM3, palletCount (> 0)',
] as const;

export function hasPositivePhysicalMeasure(input: FulfillmentLogisticsInput): boolean {
  return [input.totalWeightKg, input.totalVolumeM3, input.palletCount].some(
    (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
  );
}

/** Machine-readable failure code so callers can localize the message (UI in FR). */
export type FulfillmentLogisticsError = 'origin' | 'destination' | 'mode' | 'measure';

export function validateFulfillmentLogistics(
  input: FulfillmentLogisticsInput,
): { ok: true } | { ok: false; code: FulfillmentLogisticsError; error: string } {
  if (!input.originLocationId) {
    return { ok: false, code: 'origin', error: 'An origin location is required.' };
  }
  if (!input.destinationLocationId) {
    return { ok: false, code: 'destination', error: 'A destination location is required.' };
  }
  if (!input.mode) return { ok: false, code: 'mode', error: 'A transport mode is required.' };
  if (!hasPositivePhysicalMeasure(input)) {
    return {
      ok: false,
      code: 'measure',
      error:
        'At least one physical measure (weight, volume or pallet count) greater than 0 is required — never inferred from amounts or quantities.',
    };
  }
  return { ok: true };
}

export function deriveSalesOrderFulfillment(transportOrderStatuses: readonly string[]): {
  fulfill: boolean;
  reason: FulfillmentReason;
} {
  if (transportOrderStatuses.length === 0) {
    return { fulfill: false, reason: 'no-transport-orders' };
  }
  const active = transportOrderStatuses.filter((s) => !TO_DELIVERED.has(s) && s !== TO_CANCELLED);
  if (active.length > 0) return { fulfill: false, reason: 'active-remaining' };
  const delivered = transportOrderStatuses.filter((s) => TO_DELIVERED.has(s));
  if (delivered.length === 0) return { fulfill: false, reason: 'all-cancelled' };
  return { fulfill: true, reason: 'all-delivered' };
}
