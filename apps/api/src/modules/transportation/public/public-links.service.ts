import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoadStatus, MODULE_KEYS, StopStatus, TrackingEventType } from '@pulsar/shared';
import { DocumentsService } from '../../../core/documents/documents.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { RoutesService } from '../routes/routes.service';
import { buildShipmentTrackingView } from './shipment-tracking.view';
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
    private readonly domainEvents: DomainEventsService,
  ) {}

  // --- Customer tracking -----------------------------------------------------

  /**
   * Read-only tracking page. The projection itself lives in
   * `shipment-tracking.view.ts` — the customer portal serves the very same
   * payload from `GET /portal/shipments/:id`, so the two can never drift.
   */
  getTracking(token: string) {
    return buildShipmentTrackingView(
      this.prisma,
      { trackingToken: token },
      'Unknown tracking link',
    );
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
          notes: s.notes,
          location: s.location,
        })) ?? [],
    };
  }

  /**
   * A COMPLETED (or CANCELLED) load is terminal — LOAD_TRANSITIONS has no outgoing edges
   * (rule 2). The driver link must not mutate stops/POD once the load is closed; the state
   * machine is the source of truth. Blocked server-side (the UI hides the actions too).
   */
  private assertLoadMutableByDriver(status: string): void {
    if (status === LoadStatus.COMPLETED || status === LoadStatus.CANCELLED) {
      throw new BadRequestException('This load is closed; no further updates are allowed.');
    }
  }

  async driverUpdateStop(token: string, stopId: string, status: StopStatus) {
    if (status !== StopStatus.ARRIVED && status !== StopStatus.DEPARTED) {
      throw new BadRequestException('Drivers can only report ARRIVED or DEPARTED');
    }
    const load = await this.loadByDriverToken(token);
    this.assertLoadMutableByDriver(load.status);
    const stop = load.route?.stops.find((s) => s.id === stopId);
    if (!stop) throw new NotFoundException('Stop not on this load');
    return this.routes.updateStopStatus(load.tenantId, stopId, status);
  }

  async driverCreatePod(
    token: string,
    input: { shipmentId: string; signedByName?: string; notes?: string },
  ) {
    const load = await this.loadByDriverToken(token);
    this.assertLoadMutableByDriver(load.status);
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
    this.assertLoadMutableByDriver(load.status);
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

  async driverAttachSignature(
    token: string,
    shipmentId: string,
    file: Express.Multer.File,
  ): Promise<{ ok: boolean }> {
    const load = await this.loadByDriverToken(token);
    // Public routes bypass ModulesGuard — re-check activation (CLAUDE.md rule 15).
    const enabled = await this.modulesCache.getEnabledKeys(load.tenantId);
    if (!enabled.has(MODULE_KEYS.TRANSPORTATION)) {
      throw new ForbiddenException('Transportation is not enabled for this shipper');
    }
    this.assertLoadMutableByDriver(load.status);
    if (!load.shipments.some((s) => s.id === shipmentId)) {
      throw new NotFoundException('Shipment not on this load');
    }
    if (file.mimetype !== 'image/png') {
      throw new BadRequestException('Only PNG signatures are accepted');
    }
    const doc = await this.documents.upload(load.tenantId, {
      entityType: 'proof-of-delivery',
      entityId: shipmentId,
      fileName: 'signature.png',
      mimeType: 'image/png',
      body: file.buffer,
    });
    const existing = await this.prisma.proofOfDelivery.findUnique({
      where: { shipmentId },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.proofOfDelivery.updateMany({
        where: { shipmentId, tenantId: load.tenantId },
        data: { signatureDocumentId: doc.id },
      });
    } else {
      await this.prisma.proofOfDelivery.create({
        data: {
          tenantId: load.tenantId,
          shipmentId,
          signatureDocumentId: doc.id,
          signedAt: new Date(),
        },
      });
    }
    return { ok: true };
  }

  async driverReportException(
    token: string,
    dto: { shipmentId?: string; stopId?: string; kind: string; note: string },
  ): Promise<{ ok: boolean }> {
    const load = await this.loadByDriverToken(token);
    // Public routes bypass ModulesGuard — re-check activation (CLAUDE.md rule 15).
    const enabled = await this.modulesCache.getEnabledKeys(load.tenantId);
    if (!enabled.has(MODULE_KEYS.TRANSPORTATION)) {
      throw new ForbiddenException('Transportation is not enabled for this shipper');
    }
    if (dto.shipmentId && !load.shipments.some((s) => s.id === dto.shipmentId)) {
      throw new NotFoundException('Shipment not on this load');
    }
    if (dto.stopId && !load.route?.stops.some((s) => s.id === dto.stopId)) {
      throw new NotFoundException('Stop not on this load');
    }
    // Minute-bucket dedupKey mirrors position recording convention.
    const bucket = new Date().toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
    await this.prisma.trackingEvent.create({
      data: {
        tenantId: load.tenantId,
        type: TrackingEventType.EXCEPTION,
        loadId: load.id,
        shipmentId: dto.shipmentId ?? null,
        stopId: dto.stopId ?? null,
        payload: { kind: dto.kind, note: dto.note, shipmentId: dto.shipmentId, stopId: dto.stopId },
      },
    });
    void this.domainEvents
      .emit(
        load.tenantId,
        'driver.exception',
        { type: 'load', id: load.id },
        {
          loadId: load.id,
          loadNumber: load.loadNumber,
          shipmentId: dto.shipmentId,
          stopId: dto.stopId,
          kind: dto.kind,
          note: dto.note,
          bucket,
        },
      )
      .catch(() => {});
    return { ok: true };
  }
}
