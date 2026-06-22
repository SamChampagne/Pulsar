import { BadRequestException } from '@nestjs/common';
import { validateWindowPair } from '@pulsar/shared';

export const toDate = (value?: string | null): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(value);

/** 400 on incoherent windows: early ≤ late per pair, pickupEarly ≤ deliveryLate. */
export function assertWindowCoherence(windows: {
  pickupEarly?: Date | null;
  pickupLate?: Date | null;
  deliveryEarly?: Date | null;
  deliveryLate?: Date | null;
}) {
  const pickupError = validateWindowPair({ early: windows.pickupEarly ?? null, late: windows.pickupLate ?? null });
  if (pickupError) throw new BadRequestException(`Pickup window: ${pickupError}`);
  const deliveryError = validateWindowPair({ early: windows.deliveryEarly ?? null, late: windows.deliveryLate ?? null });
  if (deliveryError) throw new BadRequestException(`Delivery window: ${deliveryError}`);
  if (
    windows.pickupEarly &&
    windows.deliveryLate &&
    windows.pickupEarly.getTime() > windows.deliveryLate.getTime()
  ) {
    throw new BadRequestException('Pickup window must start before the delivery window ends');
  }
  // Deliberately NOT validating pickupLate ≤ deliveryEarly: overlapping windows are legitimate.
}

interface RequestedWindows {
  requestedPickupEarly: Date | null;
  requestedPickupLate: Date | null;
  requestedDeliveryEarly: Date | null;
  requestedDeliveryLate: Date | null;
}

interface SplitWindowInput {
  plannedPickupEarly?: string | null;
  plannedPickupLate?: string | null;
  plannedDeliveryEarly?: string | null;
  plannedDeliveryLate?: string | null;
}

/**
 * Resolves a split's planned windows: absent (undefined) fields inherit the order's
 * requested bound; an EXPLICIT null stays null (open bound). Validates coherence
 * unless `strict` is false (LENIENT mode — warnings surfaced on GET instead).
 */
export function resolveSplitWindows(order: RequestedWindows, split: SplitWindowInput, strict = true) {
  const resolve = (value: string | null | undefined, fallback: Date | null) =>
    value !== undefined ? (value ? new Date(value) : null) : fallback;
  const windows = {
    plannedPickupEarly: resolve(split.plannedPickupEarly, order.requestedPickupEarly),
    plannedPickupLate: resolve(split.plannedPickupLate, order.requestedPickupLate),
    plannedDeliveryEarly: resolve(split.plannedDeliveryEarly, order.requestedDeliveryEarly),
    plannedDeliveryLate: resolve(split.plannedDeliveryLate, order.requestedDeliveryLate),
  };
  if (strict) {
    assertWindowCoherence({
      pickupEarly: windows.plannedPickupEarly,
      pickupLate: windows.plannedPickupLate,
      deliveryEarly: windows.plannedDeliveryEarly,
      deliveryLate: windows.plannedDeliveryLate,
    });
  }
  return windows;
}
