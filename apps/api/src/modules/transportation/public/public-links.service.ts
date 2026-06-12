import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LoadStatus,
  MODULE_KEYS,
  ShipmentStatus,
  StopStatus,
  TrackingEventType,
} from '@pulsar/shared';
import { DocumentsService } from '../../../core/documents/documents.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { RoutesService } from '../routes/routes.service';
import { TrackingService } from '../tracking/tracking.service';

/**
 * Token-based access for external actors (customers, drivers) — no account, no JWT.
 * Each token grants the narrowest possible scope:
 *  - trackingToken (Shipment): read-only status page
 *  - driverToken (Load): stop check-in/out + POD capture on that load only
 * Payloads must never leak tenant ids or internal references.
 */
@Injectable()
export class PublicLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routes: RoutesService,
    private readonly tracking: TrackingService,
    private readonly documents: DocumentsService,
    private readonly modulesCache: TenantModulesCacheService,
  ) {}

  // --- Customer tracking -----------------------------------------------------

  async getTracking(token: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { trackingToken: token },
      include: {
        tenant: { select: { name: true } },
        originLocation: { select: { city: true, state: true } },
        destinationLocation: { select: { city: true, state: true } },
        proofOfDelivery: { select: { signedByName: true, signedAt: true } },
        trackingEvents: {
          orderBy: { occurredAt: 'desc' },
          take: 50,
          select: { id: true, type: true, message: true, occurredAt: true },
        },
      },
    });
    if (!shipment) throw new NotFoundException('Unknown tracking link');

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
    };
  }

  // --- Driver page -------------------------------------------------------------

  private async loadByDriverToken(token: string) {
    const load = await this.prisma.load.findUnique({
      where: { driverToken: token },
      include: {
        tenant: { select: { name: true } },
        carrier: { select: { name: true } },
        shipments: {
          select: {
            id: true,
            shipmentNumber: true,
            status: true,
            proofOfDelivery: { select: { id: true } },
          },
        },
        route: {
          include: {
            stops: {
              orderBy: { sequence: 'asc' },
              include: {
                location: {
                  select: { name: true, addressLine1: true, city: true, state: true },
                },
              },
            },
          },
        },
      },
    });
    if (!load) throw new NotFoundException('Unknown driver link');
    return load;
  }

  async getDriverView(token: string) {
    const load = await this.loadByDriverToken(token);
    return {
      shipper: load.tenant.name,
      carrier: load.carrier?.name ?? null,
      loadNumber: load.loadNumber,
      status: load.status,
      notes: load.notes,
      shipments: load.shipments,
      stops:
        load.route?.stops.map((s) => ({
          id: s.id,
          sequence: s.sequence,
          type: s.type,
          status: s.status,
          plannedArrivalEarly: s.plannedArrivalEarly,
          plannedArrivalLate: s.plannedArrivalLate,
          actualArrivalAt: s.actualArrivalAt,
          actualDepartureAt: s.actualDepartureAt,
          location: s.location,
        })) ?? [],
    };
  }

  async driverUpdateStop(token: string, stopId: string, status: StopStatus) {
    if (status !== StopStatus.ARRIVED && status !== StopStatus.DEPARTED) {
      throw new BadRequestException('Drivers can only report ARRIVED or DEPARTED');
    }
    const load = await this.loadByDriverToken(token);
    const stop = load.route?.stops.find((s) => s.id === stopId);
    if (!stop) throw new NotFoundException('Stop not on this load');
    return this.routes.updateStopStatus(load.tenantId, stopId, status);
  }

  async driverCreatePod(
    token: string,
    input: { shipmentId: string; signedByName?: string; notes?: string },
  ) {
    const load = await this.loadByDriverToken(token);
    if (!load.shipments.some((s) => s.id === input.shipmentId)) {
      throw new NotFoundException('Shipment not on this load');
    }
    return this.tracking.createPod(load.tenantId, undefined, input);
  }

  async driverAttachPodPhoto(
    token: string,
    shipmentId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    const load = await this.loadByDriverToken(token);
    const shipment = load.shipments.find((s) => s.id === shipmentId);
    if (!shipment) throw new NotFoundException('Shipment not on this load');
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG/PNG/WebP images or PDF are accepted');
    }
    return this.documents.upload(load.tenantId, {
      entityType: 'proof-of-delivery',
      entityId: shipmentId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      body: file.buffer,
    });
  }

  /** Driver position ping. Bounded DTO upstream, deduped 60s here. */
  async driverRecordPosition(token: string, latitude: number, longitude: number) {
    const load = await this.loadByDriverToken(token);
    // Public routes bypass ModulesGuard — re-check activation (CLAUDE.md rule 15).
    const enabled = await this.modulesCache.getEnabledKeys(load.tenantId);
    if (!enabled.has(MODULE_KEYS.TRANSPORTATION)) {
      throw new ForbiddenException('Transportation is not enabled for this shipper');
    }
    if (load.status !== LoadStatus.DISPATCHED && load.status !== LoadStatus.IN_TRANSIT) {
      throw new BadRequestException(
        'Positions can only be recorded on DISPATCHED or IN_TRANSIT loads',
      );
    }
    const last = await this.prisma.trackingEvent.findFirst({
      where: { tenantId: load.tenantId, loadId: load.id, type: TrackingEventType.POSITION_UPDATE },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    if (last && Date.now() - last.occurredAt.getTime() < 60_000) {
      return { recorded: false }; // at most one stored position per minute per load
    }
    // Minute-bucket dedupKey closes the findFirst→create race (concurrent pings).
    const dedupKey = `POS:${load.id}:${Math.floor(Date.now() / 60_000)}`;
    try {
      await this.prisma.trackingEvent.create({
        data: {
          tenantId: load.tenantId,
          type: TrackingEventType.POSITION_UPDATE,
          loadId: load.id,
          latitude,
          longitude,
          dedupKey,
        },
      });
    } catch (err: unknown) {
      // P2002 = unique violation — a concurrent ping won the bucket.
      if ((err as { code?: string }).code === 'P2002') return { recorded: false };
      throw err;
    }
    return { recorded: true };
  }
}
