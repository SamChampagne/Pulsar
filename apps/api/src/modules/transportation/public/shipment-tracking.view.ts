import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { MODULE_KEYS, ShipmentStatus, TrackingEventType } from '@pulsar/shared';
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

export const RECIPIENT_PACKAGE_LIMIT = 200;
export const RECIPIENT_EVENT_LIMIT = 500;

const trackingSelect = {
  id: true,
  tenantId: true,
  loadId: true,
  shipmentNumber: true,
  status: true,
  packageTrackingEnabledAt: true,
  plannedPickupEarly: true,
  plannedPickupLate: true,
  plannedDeliveryEarly: true,
  plannedDeliveryLate: true,
  actualPickupAt: true,
  actualDeliveryAt: true,
  tenant: { select: { name: true } },
  originLocation: { select: { city: true, state: true, latitude: true, longitude: true } },
  destinationLocation: { select: { city: true, state: true, latitude: true, longitude: true } },
  proofOfDelivery: { select: { signedByName: true, signedAt: true } },
} satisfies Prisma.ShipmentSelect;

/** Public messages never interpolate operational comments, package contents or incident notes. */
function recipientEventMessage(type: string): string {
  const labels: Record<string, string> = {
    DISPATCHED: 'Expédition répartie.',
    ARRIVED_STOP: 'Arrivée enregistrée.',
    DEPARTED_STOP: 'Départ enregistré.',
    DELIVERED: 'Livraison enregistrée.',
    POD_RECEIVED: 'Preuve de livraison enregistrée.',
    DELAYED: 'Retard signalé.',
    EXCEPTION: 'Un incident a été signalé.',
  };
  return Object.hasOwn(labels, type) ? labels[type] : 'Événement de suivi enregistré.';
}

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
  // A capability is the sole bootstrap query. Once resolved, every related
  // read is tenant-scoped. Public routes cannot rely on JWT ModulesGuard/cache.
  const identity = await prisma.shipment.findFirst({
    where,
    select: { id: true, tenantId: true, tenant: { select: { status: true } } },
  });
  if (!identity) throw new NotFoundException(notFoundMessage);
  if (!['ACTIVE', 'TRIAL'].includes(identity.tenant.status))
    throw new ForbiddenException('Ce suivi est indisponible pour cet expéditeur.');
  const enabled = await prisma.tenantModule.findFirst({
    where: {
      tenantId: identity.tenantId,
      enabled: true,
      module: { key: MODULE_KEYS.TRANSPORTATION },
    },
    select: { moduleId: true },
  });
  if (!enabled)
    throw new ForbiddenException('Le module Transport est désactivé pour cet expéditeur.');
  const shipment = await prisma.shipment.findFirst({
    // Keep the original capability/customer ownership predicate on the final read.
    where: { ...where, id: identity.id, tenantId: identity.tenantId },
    select: {
      ...trackingSelect,
      deliveryPackages: {
        where: { tenantId: identity.tenantId },
        orderBy: { code: 'asc' },
        take: RECIPIENT_PACKAGE_LIMIT + 1,
        select: { code: true, status: true, loadedAt: true, deliveredAt: true },
      },
      trackingEvents: {
        where: { tenantId: identity.tenantId, type: { not: TrackingEventType.POSITION_UPDATE } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
        take: RECIPIENT_EVENT_LIMIT + 1,
        select: { type: true, occurredAt: true },
      },
    },
  });
  if (!shipment) throw new NotFoundException(notFoundMessage);
  if (
    shipment.deliveryPackages.length > RECIPIENT_PACKAGE_LIMIT ||
    shipment.trackingEvents.length > RECIPIENT_EVENT_LIMIT
  )
    throw new BadRequestException('Cette expédition dépasse les limites du suivi destinataire.');
  const packageTrackingEnabled = shipment.packageTrackingEnabledAt !== null;
  if (!packageTrackingEnabled && shipment.deliveryPackages.length)
    throw new BadRequestException('Le suivi des colis de cette expédition est incohérent.');
  const counts = packageTrackingEnabled
    ? {
        total: shipment.deliveryPackages.length,
        active: shipment.deliveryPackages.filter((p) => p.status !== 'CANCELLED').length,
        prepared: shipment.deliveryPackages.filter((p) => p.status === 'PREPARED').length,
        loaded: shipment.deliveryPackages.filter((p) => p.status === 'LOADED').length,
        delivered: shipment.deliveryPackages.filter((p) => p.status === 'DELIVERED').length,
        cancelled: shipment.deliveryPackages.filter((p) => p.status === 'CANCELLED').length,
      }
    : null;

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
    proofOfDelivery: shipment.proofOfDelivery
      ? {
          signedByName: shipment.proofOfDelivery.signedByName,
          signedAt: shipment.proofOfDelivery.signedAt,
        }
      : null,
    packageTracking: {
      enabled: packageTrackingEnabled,
      counts,
      packages: shipment.deliveryPackages.map(({ code, status, loadedAt, deliveredAt }) => ({
        code,
        status,
        loadedAt,
        deliveredAt,
      })),
    },
    events: shipment.trackingEvents.map((event, index) => ({
      id: `event-${index + 1}`,
      type: event.type,
      message: recipientEventMessage(event.type),
      occurredAt: event.occurredAt,
    })),
    lastPosition,
  };
}
