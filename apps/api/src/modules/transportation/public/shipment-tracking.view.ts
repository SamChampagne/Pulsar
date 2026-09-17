import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ShipmentStatus, TrackingEventType } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * The one shipment-tracking projection, shared by the public tracking link
 * (`GET /public/tracking/:token`) and the customer portal
 * (`GET /portal/shipments/:id`) so the two can never drift.
 *
 * Rule 10/20: no `tenantId`, no internal location/load/carrier reference, no
 * cost; a single position (the last one), never a history, and never the other
 * stops of a multi-customer load.
 */

export interface LastPosition {
  latitude: number;
  longitude: number;
  occurredAt: Date;
}

/**
 * Last known position of each of the given loads — one point per load, never a
 * history (rule 20). Batched: two queries whatever the number of loads, so a
 * dashboard listing 50 orders does not fan out into 50 round-trips.
 */
export async function lastPositionsByLoad(
  prisma: PrismaService,
  tenantId: string,
  loadIds: Array<string | null | undefined>,
): Promise<Map<string, LastPosition>> {
  const wanted = [...new Set(loadIds.filter((id): id is string => !!id))];
  const positions = new Map<string, LastPosition>();
  if (wanted.length === 0) return positions;

  const where: Prisma.TrackingEventWhereInput = {
    tenantId,
    loadId: { in: wanted },
    type: TrackingEventType.POSITION_UPDATE,
    latitude: { not: null },
    longitude: { not: null },
  };

  // 1. newest timestamp per load, 2. the matching rows. Two queries, no history
  // ever loaded into memory.
  const latest = await prisma.trackingEvent.groupBy({
    by: ['loadId'],
    where,
    _max: { occurredAt: true },
  });
  const pairs = latest
    .filter((group) => !!group.loadId && !!group._max.occurredAt)
    .map((group) => ({
      loadId: group.loadId as string,
      occurredAt: group._max.occurredAt as Date,
    }));
  if (pairs.length === 0) return positions;

  const events = await prisma.trackingEvent.findMany({
    where: { ...where, OR: pairs },
    select: { loadId: true, latitude: true, longitude: true, occurredAt: true },
  });
  for (const event of events) {
    if (!event.loadId || event.latitude === null || event.longitude === null) continue;
    const known = positions.get(event.loadId);
    // Two events can share the exact same timestamp — keep one, deterministically.
    if (!known || known.occurredAt < event.occurredAt) {
      positions.set(event.loadId, {
        latitude: event.latitude,
        longitude: event.longitude,
        occurredAt: event.occurredAt,
      });
    }
  }
  return positions;
}

/** A delivered (or closed) shipment stops publishing a position — rule 20. */
export function trackingPositionVisible(status: string): boolean {
  return status !== ShipmentStatus.DELIVERED && status !== ShipmentStatus.CLOSED;
}

const trackingInclude = {
  tenant: { select: { name: true } },
  originLocation: { select: { city: true, state: true, latitude: true, longitude: true } },
  destinationLocation: { select: { city: true, state: true, latitude: true, longitude: true } },
  proofOfDelivery: { select: { signedByName: true, signedAt: true } },
  trackingEvents: {
    orderBy: { occurredAt: 'desc' },
    take: 50,
    select: { id: true, type: true, message: true, occurredAt: true },
  },
} satisfies Prisma.ShipmentInclude;

/**
 * Builds the tracking payload of the single shipment matching `where`.
 *
 * `where` is the caller's scope: the capability token for the public page, and
 * `{ id, tenantId }` (after an ownership check) for the portal. `notFoundMessage`
 * is the caller's wording — it must never reveal that a shipment of another
 * customer exists.
 */
export async function buildShipmentTrackingView(
  prisma: PrismaService,
  where: Prisma.ShipmentWhereInput,
  notFoundMessage: string,
) {
  const shipment = await prisma.shipment.findFirst({ where, include: trackingInclude });
  if (!shipment) throw new NotFoundException(notFoundMessage);

  let lastPosition: LastPosition | null = null;
  if (trackingPositionVisible(shipment.status) && shipment.loadId) {
    const positions = await lastPositionsByLoad(prisma, shipment.tenantId, [shipment.loadId]);
    lastPosition = positions.get(shipment.loadId) ?? null;
  }

  return {
    shipper: shipment.tenant.name,
    shipmentNumber: shipment.shipmentNumber,
    status: shipment.status,
    origin: shipment.originLocation,
    destination: shipment.destinationLocation,
    plannedPickupEarly: shipment.plannedPickupEarly,
    plannedPickupLate: shipment.plannedPickupLate,
    plannedDeliveryEarly: shipment.plannedDeliveryEarly,
    plannedDeliveryLate: shipment.plannedDeliveryLate,
    actualPickupAt: shipment.actualPickupAt,
    actualDeliveryAt: shipment.actualDeliveryAt,
    proofOfDelivery: shipment.proofOfDelivery,
    events: shipment.trackingEvents,
    lastPosition,
  };
}
