import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@pulsar/database';
import { AuditAction, ShipmentStatus, StopStatus, TrackingEventType } from '@pulsar/shared';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../../core/documents/documents.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RoutesService } from '../routes/routes.service';
import { TrackingService } from '../tracking/tracking.service';
import { DriverAccessService, type DriverLoadAccess } from './driver-access.service';
import { driverReference } from './driver-reference';
import { buildShipmentTrackingView } from './shipment-tracking.view';

/** Public capabilities never authorize internal IDs, private notes or documents outside their load. */
@Injectable()
export class PublicLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routes: RoutesService,
    private readonly tracking: TrackingService,
    private readonly documents: DocumentsService,
    private readonly driverAccess: DriverAccessService,
    private readonly domainEvents: DomainEventsService,
    private readonly audit: AuditLogsService,
  ) {}

  getTracking(token: string) {
    return buildShipmentTrackingView(
      this.prisma,
      { trackingToken: token },
      'Unknown tracking link',
    );
  }

  private async shipmentForReference(
    token: string,
    load: DriverLoadAccess,
    ref: string,
    tx: Prisma.TransactionClient,
  ) {
    const shipments = await tx.shipment.findMany({
      where: { tenantId: load.tenantId, loadId: load.id },
      select: { id: true, status: true },
      take: 201,
    });
    if (shipments.length > 200)
      throw new BadRequestException('Driver access supports up to 200 shipments per load');
    const shipment = shipments.find((s) => driverReference(token, 'shipment', s.id) === ref);
    if (!shipment) throw new NotFoundException('Shipment not on this load');
    return shipment;
  }

  private async stopForReference(
    token: string,
    load: DriverLoadAccess,
    ref: string,
    tx: Prisma.TransactionClient,
  ) {
    const stops = await tx.stop.findMany({
      where: { tenantId: load.tenantId, route: { tenantId: load.tenantId, loadId: load.id } },
      select: { id: true },
      take: 501,
    });
    if (stops.length > 500)
      throw new BadRequestException('Driver access supports up to 500 stops per load');
    const stop = stops.find((s) => driverReference(token, 'stop', s.id) === ref);
    if (!stop) throw new NotFoundException('Stop not on this load');
    return stop;
  }

  async getDriverView(token: string) {
    return this.prisma.$transaction(async (tx) => {
      const load = await this.driverAccess.lock(token, tx);
      const tenant = await tx.tenant.findUnique({
        where: { id: load.tenantId },
        select: { name: true },
      });
      const resources = await tx.load.findFirst({
        where: { id: load.id, tenantId: load.tenantId },
        select: { carrierId: true },
      });
      const carrier = resources?.carrierId
        ? await tx.carrier.findFirst({
            where: { id: resources.carrierId, tenantId: load.tenantId },
            select: { name: true },
          })
        : null;
      const shipments = await tx.shipment.findMany({
        where: { tenantId: load.tenantId, loadId: load.id },
        select: { id: true, shipmentNumber: true, status: true },
        orderBy: [{ shipmentNumber: 'asc' }, { id: 'asc' }],
        take: 201,
      });
      const stops = await tx.stop.findMany({
        where: { tenantId: load.tenantId, route: { tenantId: load.tenantId, loadId: load.id } },
        select: {
          id: true,
          sequence: true,
          type: true,
          status: true,
          plannedArrivalEarly: true,
          plannedArrivalLate: true,
          actualArrivalAt: true,
          actualDepartureAt: true,
          locationId: true,
        },
        orderBy: { sequence: 'asc' },
        take: 501,
      });
      if (shipments.length > 200 || stops.length > 500)
        throw new BadRequestException('This load exceeds the driver workspace limits');
      const pods = await tx.proofOfDelivery.findMany({
        where: { tenantId: load.tenantId, shipmentId: { in: shipments.map((s) => s.id) } },
        select: { shipmentId: true },
      });
      const podIds = new Set(pods.map((p) => p.shipmentId));
      const locations = await tx.location.findMany({
        where: { tenantId: load.tenantId, id: { in: stops.map((s) => s.locationId) } },
        select: { id: true, name: true, addressLine1: true, city: true, state: true },
      });
      return {
        shipper: tenant?.name ?? '',
        carrier: carrier?.name ?? null,
        loadNumber: load.loadNumber,
        status: load.status,
        shipments: shipments.map((s) => ({
          id: driverReference(token, 'shipment', s.id),
          shipmentNumber: s.shipmentNumber,
          status: s.status,
          hasPod: podIds.has(s.id),
          proofOfDelivery: podIds.has(s.id) ? { present: true } : null,
        })),
        stops: stops.map((s) => {
          const location = locations.find((l) => l.id === s.locationId);
          if (!location) throw new ConflictException('A route location is unavailable');
          return {
            id: driverReference(token, 'stop', s.id),
            sequence: s.sequence,
            type: s.type,
            status: s.status,
            plannedArrivalEarly: s.plannedArrivalEarly,
            plannedArrivalLate: s.plannedArrivalLate,
            actualArrivalAt: s.actualArrivalAt,
            actualDepartureAt: s.actualDepartureAt,
            location: {
              name: location.name,
              addressLine1: location.addressLine1,
              city: location.city,
              state: location.state,
            },
          };
        }),
      };
    });
  }

  async driverUpdateStop(token: string, stopRef: string, status: StopStatus) {
    if (status !== StopStatus.ARRIVED && status !== StopStatus.DEPARTED)
      throw new BadRequestException('Drivers can only report ARRIVED or DEPARTED');
    const load = await this.driverAccess.resolve(token);
    this.driverAccess.assertMutable(load.status);
    const stop = await this.stopForReference(token, load, stopRef, this.prisma);
    const updated = await this.routes.updateStopStatus(
      load.tenantId,
      stop.id,
      status,
      undefined,
      async (tx) => {
        const current = await this.driverAccess.resolve(token, tx);
        this.driverAccess.assertMutable(current.status);
        if (current.id !== load.id || current.tenantId !== load.tenantId)
          throw new NotFoundException('Unknown driver link');
        await this.stopForReference(token, current, stopRef, tx);
      },
    );
    if (!updated) throw new NotFoundException('Stop not found');
    return {
      id: driverReference(token, 'stop', updated.id),
      status: updated.status,
      actualArrivalAt: updated.actualArrivalAt,
      actualDepartureAt: updated.actualDepartureAt,
    };
  }

  async driverCreatePod(
    token: string,
    input: { shipmentId: string; signedByName?: string; notes?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const load = await this.driverAccess.lock(token, tx);
      this.driverAccess.assertMutable(load.status);
      const shipment = await this.shipmentForReference(token, load, input.shipmentId, tx);
      await this.tracking.createPod(
        load.tenantId,
        undefined,
        {
          shipmentId: shipment.id,
          signedByName: input.signedByName,
          notes: input.notes,
        },
        tx,
      );
      await this.audit.log(
        {
          tenantId: load.tenantId,
          action: AuditAction.CREATE,
          entityType: 'proof-of-delivery',
          entityId: shipment.id,
          after: { source: 'driver-link', loadId: load.id, driverId: load.driverId },
        },
        tx,
      );
      return { ok: true };
    });
  }

  async driverAttachPodPhoto(
    token: string,
    shipmentRef: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype))
      throw new BadRequestException('Only JPEG/PNG/WebP images or PDF are accepted');
    return this.prisma.$transaction(
      async (tx) => {
        const load = await this.driverAccess.lock(token, tx);
        this.driverAccess.assertMutable(load.status);
        const shipment = await this.shipmentForReference(token, load, shipmentRef, tx);
        const pod = await tx.proofOfDelivery.findFirst({
          where: { tenantId: load.tenantId, shipmentId: shipment.id },
          select: { id: true },
        });
        if (!pod) throw new BadRequestException('Capture the POD before attaching its photo');
        const doc = await this.documents.upload(
          load.tenantId,
          {
            entityType: 'proof-of-delivery',
            entityId: shipment.id,
            fileName: file.originalname,
            mimeType: file.mimetype,
            body: file.buffer,
          },
          undefined,
          tx,
        );
        await this.audit.log(
          {
            tenantId: load.tenantId,
            action: AuditAction.CREATE,
            entityType: 'proof-of-delivery-photo',
            entityId: shipment.id,
            after: {
              source: 'driver-link',
              loadId: load.id,
              driverId: load.driverId,
              documentId: doc.id,
            },
          },
          tx,
        );
        return { ok: true };
      },
      { timeout: 15000 },
    );
  }

  async driverRecordPosition(token: string, latitude: number, longitude: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const load = await this.driverAccess.lock(token, tx);
        this.driverAccess.assertMutable(load.status);
        const last = await tx.trackingEvent.findFirst({
          where: {
            tenantId: load.tenantId,
            loadId: load.id,
            type: TrackingEventType.POSITION_UPDATE,
          },
          orderBy: { occurredAt: 'desc' },
          select: { occurredAt: true },
        });
        if (last && Date.now() - last.occurredAt.getTime() < 60_000) return { recorded: false };
        await tx.trackingEvent.create({
          data: {
            tenantId: load.tenantId,
            type: TrackingEventType.POSITION_UPDATE,
            loadId: load.id,
            latitude,
            longitude,
            dedupKey: `POS:${load.id}:${Math.floor(Date.now() / 60_000)}`,
          },
        });
        return { recorded: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return { recorded: false };
      throw error;
    }
  }

  async driverAttachSignature(
    token: string,
    shipmentRef: string,
    file: Express.Multer.File,
  ): Promise<{ ok: boolean }> {
    if (file.mimetype !== 'image/png')
      throw new BadRequestException('Only PNG signatures are accepted');
    return this.prisma.$transaction(
      async (tx) => {
        const load = await this.driverAccess.lock(token, tx);
        this.driverAccess.assertMutable(load.status);
        const shipment = await this.shipmentForReference(token, load, shipmentRef, tx);
        if (
          ![ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED].includes(
            shipment.status as ShipmentStatus,
          )
        )
          throw new BadRequestException(
            'POD can only be captured for IN_TRANSIT or DELIVERED shipments',
          );
        const doc = await this.documents.upload(
          load.tenantId,
          {
            entityType: 'proof-of-delivery',
            entityId: shipment.id,
            fileName: 'signature.png',
            mimeType: 'image/png',
            body: file.buffer,
          },
          undefined,
          tx,
        );
        const existing = await tx.proofOfDelivery.findFirst({
          where: { shipmentId: shipment.id, tenantId: load.tenantId },
          select: { id: true },
        });
        if (existing)
          await tx.proofOfDelivery.updateMany({
            where: { id: existing.id, shipmentId: shipment.id, tenantId: load.tenantId },
            data: { signatureDocumentId: doc.id },
          });
        else
          await tx.proofOfDelivery.create({
            data: {
              tenantId: load.tenantId,
              shipmentId: shipment.id,
              signatureDocumentId: doc.id,
              signedAt: new Date(),
            },
          });
        await this.audit.log(
          {
            tenantId: load.tenantId,
            action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
            entityType: 'proof-of-delivery-signature',
            entityId: shipment.id,
            after: {
              source: 'driver-link',
              loadId: load.id,
              driverId: load.driverId,
              documentId: doc.id,
            },
          },
          tx,
        );
        return { ok: true };
      },
      { timeout: 15000 },
    );
  }

  async driverReportException(
    token: string,
    dto: { shipmentId?: string; stopId?: string; kind: string; note: string },
  ): Promise<{ ok: boolean }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const load = await this.driverAccess.lock(token, tx);
      this.driverAccess.assertMutable(load.status);
      const shipmentId = dto.shipmentId
        ? (await this.shipmentForReference(token, load, dto.shipmentId, tx)).id
        : undefined;
      const stopId = dto.stopId
        ? (await this.stopForReference(token, load, dto.stopId, tx)).id
        : undefined;
      await tx.trackingEvent.create({
        data: {
          tenantId: load.tenantId,
          type: TrackingEventType.EXCEPTION,
          loadId: load.id,
          shipmentId,
          stopId,
          payload: { kind: dto.kind, note: dto.note, shipmentId, stopId },
        },
      });
      await this.audit.log(
        {
          tenantId: load.tenantId,
          action: AuditAction.CREATE,
          entityType: 'driver-exception',
          entityId: load.id,
          after: {
            source: 'driver-link',
            driverId: load.driverId,
            shipmentId,
            stopId,
            kind: dto.kind,
          },
        },
        tx,
      );
      return { load, shipmentId, stopId };
    });
    void this.domainEvents
      .emit(
        result.load.tenantId,
        'driver.exception',
        { type: 'load', id: result.load.id },
        {
          loadId: result.load.id,
          loadNumber: result.load.loadNumber,
          shipmentId: result.shipmentId,
          stopId: result.stopId,
          kind: dto.kind,
          note: dto.note,
          bucket: new Date().toISOString().slice(0, 16),
        },
      )
      .catch(() => {});
    return { ok: true };
  }
}
