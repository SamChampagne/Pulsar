import { PrismaService } from '../../../prisma/prisma.service';

export interface PhysicalEndpoint {
  id: string;
  city: string;
  state: string | null;
  country: string;
}

export interface LoadEndpoints {
  origin: PhysicalEndpoint;
  destination: PhysicalEndpoint;
}

const endpointSelect = { id: true, city: true, state: true, country: true } as const;

/**
 * Physical origin/destination of a load: first pickup / last delivery via the route's
 * stops when a route exists, else the shipments' shared O/D. Returns null when
 * indeterminable (multi-origin without a route) — only catch-all rates apply then.
 */
export async function resolveLoadEndpoints(
  prisma: PrismaService,
  tenantId: string,
  loadId: string,
): Promise<LoadEndpoints | null> {
  const load = await prisma.load.findFirst({
    where: { id: loadId, tenantId },
    select: {
      route: {
        select: {
          stops: {
            orderBy: { sequence: 'asc' },
            select: { type: true, location: { select: endpointSelect } },
          },
        },
      },
      shipments: {
        select: {
          originLocationId: true,
          destinationLocationId: true,
          originLocation: { select: endpointSelect },
          destinationLocation: { select: endpointSelect },
        },
      },
    },
  });
  if (!load) return null;

  const stops = load.route?.stops ?? [];
  const pickups = stops.filter((s) => s.type === 'PICKUP');
  const deliveries = stops.filter((s) => s.type === 'DELIVERY');
  if (pickups.length > 0 && deliveries.length > 0) {
    return { origin: pickups[0].location, destination: deliveries[deliveries.length - 1].location };
  }

  if (load.shipments.length === 0) return null;
  const origins = new Set(load.shipments.map((s) => s.originLocationId));
  const destinations = new Set(load.shipments.map((s) => s.destinationLocationId));
  if (origins.size === 1 && destinations.size === 1) {
    return {
      origin: load.shipments[0].originLocation,
      destination: load.shipments[0].destinationLocation,
    };
  }
  return null;
}
