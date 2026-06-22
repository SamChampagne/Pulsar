import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  CustomFieldEntity,
  LoadStatus,
  ShipmentStatus,
  TenderStatus,
  TrackingEventType,
  TransportOrderStatus,
  canTransitionLoad,
  checkCapacity,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { randomBytes } from 'node:crypto';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { LoadCostService } from './load-cost.service';
import { LoadNotificationsService } from './load-notifications.service';
import { AssignLoadResourcesDto, CreateLoadDto, SetLoadAccessorialsDto } from './dto/load.dto';
import { shipmentWindowWarnings } from '../planning/window-warnings';
import { isLate } from '../exceptions/delay-detection.service';

const loadInclude = {
  carrier: { select: { id: true, code: true, name: true } },
  driver: { select: { id: true, firstName: true, lastName: true } },
  vehicle: { select: { id: true, unitNumber: true } },
  trailer: { select: { id: true, unitNumber: true } },
  rate: { select: { id: true, name: true, rateType: true, baseAmount: true, currency: true } },
  shipments: {
    select: {
      id: true,
      shipmentNumber: true,
      status: true,
      weightKg: true,
      volumeM3: true,
      palletCount: true,
      transportOrderId: true,
      originLocationId: true,
      destinationLocationId: true,
      plannedPickupEarly: true,
      plannedPickupLate: true,
      plannedDeliveryEarly: true,
      plannedDeliveryLate: true,
      proofOfDelivery: { select: { id: true, signedByName: true, signedAt: true } },
      transportOrder: {
        select: {
          requestedPickupEarly: true,
          requestedPickupLate: true,
          requestedDeliveryEarly: true,
          requestedDeliveryLate: true,
        },
      },
    },
  },
  route: { include: { stops: { orderBy: { sequence: 'asc' as const } } } },
  accessorials: {
    select: {
      id: true,
      quantity: true,
      accessorial: { select: { id: true, code: true, name: true, unit: true } },
    },
  },
} satisfies Prisma.LoadInclude;

@Injectable()
export class LoadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly cost: LoadCostService,
    private readonly config: ConfigService,
    private readonly moduleSettings: ModuleSettingsService,
    private readonly customFields: CustomFieldsService,
    private readonly notifications: LoadNotificationsService,
  ) {}

  async list(tenantId: string, query: ListQueryDto & { status?: LoadStatus }) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.LoadWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { loadNumber: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.load.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: loadInclude,
      }),
      this.prisma.load.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  /**
   * Aggregated payload for the operational dashboard map. Markers only — the
   * route geometry is deliberately NOT included (heavy, re-fetched every poll;
   * it stays on the load detail). Lateness reuses the exception engine's pure
   * isLate — no duplicated logic.
   */
  async activeMap(tenantId: string) {
    const loads = await this.prisma.load.findMany({
      where: { tenantId, status: { in: [LoadStatus.DISPATCHED, LoadStatus.IN_TRANSIT] } },
      orderBy: { dispatchedAt: 'desc' },
      include: {
        carrier: { select: { name: true } },
        route: {
          select: {
            stops: {
              orderBy: { sequence: 'asc' },
              select: {
                sequence: true,
                type: true,
                status: true,
                plannedArrivalEarly: true,
                plannedArrivalLate: true,
                actualArrivalAt: true,
                location: { select: { name: true, city: true, latitude: true, longitude: true } },
              },
            },
          },
        },
      },
    });

    if (loads.length === 0) return [];

    // Latest POSITION_UPDATE per load — one query for the whole board.
    const positions = await this.prisma.trackingEvent.findMany({
      where: {
        tenantId,
        loadId: { in: loads.map((l) => l.id) },
        type: TrackingEventType.POSITION_UPDATE,
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: { occurredAt: 'desc' },
      select: { loadId: true, latitude: true, longitude: true, occurredAt: true },
    });
    const lastByLoad = new Map<string, (typeof positions)[number]>();
    for (const p of positions) {
      if (p.loadId && !lastByLoad.has(p.loadId)) lastByLoad.set(p.loadId, p);
    }

    const now = new Date();
    return loads.map((load) => {
      const stops = load.route?.stops ?? [];
      const pos = lastByLoad.get(load.id);
      return {
        id: load.id,
        loadNumber: load.loadNumber,
        status: load.status,
        carrier: load.carrier?.name ?? null,
        isLate: stops.some((s) => isLate(s, now).late),
        lastPosition: pos
          ? { latitude: pos.latitude!, longitude: pos.longitude!, occurredAt: pos.occurredAt }
          : null,
        stops: stops.map((s) => ({
          sequence: s.sequence,
          type: s.type,
          status: s.status,
          name: s.location.name,
          city: s.location.city,
          latitude: s.location.latitude,
          longitude: s.location.longitude,
        })),
      };
    });
  }

  async get(tenantId: string, id: string) {
    const load = await this.prisma.load.findFirst({ where: { id, tenantId }, include: loadInclude });
    if (!load) throw new NotFoundException('Load not found');
    return {
      ...load,
      windowWarnings: load.shipments.flatMap((s) => shipmentWindowWarnings(s.transportOrder, [s])),
    };
  }

  async create(tenantId: string, userId: string, dto: CreateLoadDto) {
    const customData = await this.customFields.validateValues(
      'transportation', tenantId, CustomFieldEntity.LOAD, dto.customData, { partial: false },
    );
    const load = await this.prisma.load.create({
      data: {
        tenantId,
        loadNumber: await this.sequences.nextNumber(tenantId, 'load'),
        notes: dto.notes,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
      include: loadInclude,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'load',
      entityId: load.id,
      after: { loadNumber: load.loadNumber },
    });
    return load;
  }

  /**
   * Dispatch-workbench consolidation: create a fresh load from a set of currently
   * unassigned, planifiable shipments in ONE transaction. Mirrors `assignToLoad`'s
   * sequencing — shipment.loadId + status:PLANNED + ShipmentLoadLeg(seq 1) written
   * together (rule 18) — but for N shipments onto a brand-new load. Validate ALL
   * shipments up front so a validation failure never leaves a half-built load.
   * Cost recompute (rule 11) runs once after the transaction commits, exactly like
   * `assignToLoad`. A fresh load has no trailer → no capacity excess to surface.
   */
  async consolidate(tenantId: string, userId: string, shipmentIds: string[]) {
    if (!shipmentIds || shipmentIds.length === 0) {
      throw new BadRequestException('shipmentIds must not be empty');
    }
    const ids = [...new Set(shipmentIds)];

    // --- Validate ALL up front (no partial load on failure) ---
    const shipments = await this.prisma.shipment.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, status: true, loadId: true },
    });
    if (shipments.length !== ids.length) {
      throw new BadRequestException('One or more shipments could not be found');
    }
    for (const s of shipments) {
      if (s.loadId !== null) {
        throw new BadRequestException(`Shipment ${s.id} is already assigned to a load`);
      }
      // Same gate as assignToLoad: only PENDING (unassigned, planifiable) shipments.
      if (s.status !== ShipmentStatus.PENDING) {
        throw new BadRequestException(`Shipment ${s.id} is not PENDING and cannot be consolidated`);
      }
    }

    const loadNumber = await this.sequences.nextNumber(tenantId, 'load');

    // --- Create the load + assign all shipments atomically (rule 18) ---
    const load = await this.prisma.$transaction(async (tx) => {
      const created = await tx.load.create({ data: { tenantId, loadNumber } });
      for (const id of ids) {
        await tx.shipment.updateMany({
          where: { id, tenantId },
          data: { loadId: created.id, status: ShipmentStatus.PLANNED },
        });
        // Junction mirrors the denormalized loadId in the SAME transaction (spec invariant).
        await tx.shipmentLoadLeg.upsert({
          where: { shipmentId_sequence: { shipmentId: id, sequence: 1 } },
          update: { loadId: created.id },
          create: { tenantId, shipmentId: id, loadId: created.id, sequence: 1 },
        });
      }
      return created;
    });

    // Cost recompute runs after the assignment writes commit — same as assignToLoad (rule 11).
    await this.cost.recompute(tenantId, load.id);

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'load',
      entityId: load.id,
      after: { loadNumber: load.loadNumber, consolidatedShipments: ids.length },
    });

    return this.get(tenantId, load.id);
  }

  /** Carrier selection: assigning resources moves an OPEN load to PLANNED. */
  async assignResources(tenantId: string, userId: string, id: string, dto: AssignLoadResourcesDto) {
    const load = await this.get(tenantId, id);
    if (load.status !== LoadStatus.OPEN && load.status !== LoadStatus.PLANNED) {
      throw new BadRequestException('Resources can only be assigned to OPEN or PLANNED loads');
    }
    await Promise.all([
      this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId),
      this.ownership.assertOwnedIfSet('driver', dto.driverId, tenantId),
      this.ownership.assertOwnedIfSet('vehicle', dto.vehicleId, tenantId),
      this.ownership.assertOwnedIfSet('trailer', dto.trailerId, tenantId),
      this.ownership.assertOwnedIfSet('rate', dto.rateId, tenantId),
    ]);
    const { force, ...resources } = dto;
    let capacityOverride: { capacityOverride: true; excesses: unknown } | undefined;
    if (dto.trailerId) {
      const trailer = await this.prisma.trailer.findFirst({
        where: { id: dto.trailerId, tenantId },
        select: { capacityWeightKg: true, capacityVolumeM3: true, capacityPallets: true },
      });
      const shipments = await this.prisma.shipment.findMany({
        where: { loadId: id, tenantId },
        select: { weightKg: true, volumeM3: true, palletCount: true },
      });
      const sum = (values: (number | null)[]) =>
        values.some((v) => v !== null) ? values.reduce<number>((acc, v) => acc + (v ?? 0), 0) : null;
      const excesses = trailer
        ? checkCapacity(
            {
              weightKg: trailer.capacityWeightKg,
              volumeM3: trailer.capacityVolumeM3,
              pallets: trailer.capacityPallets,
            },
            {
              weightKg: sum(shipments.map((s) => s.weightKg)),
              volumeM3: sum(shipments.map((s) => s.volumeM3)),
              pallets: sum(shipments.map((s) => s.palletCount)),
            },
          )
        : [];
      if (excesses.length > 0) {
        const tmsSettings = await this.moduleSettings.resolve(tenantId, 'transportation');
        const overage = tmsSettings['capacityOverage'] as string;
        if (overage === 'BLOCK') {
          throw new ConflictException({ message: 'Trailer capacity exceeded (blocked by tenant policy)', excesses });
        }
        if (!force) {
          throw new BadRequestException({ message: 'Trailer capacity exceeded', excesses });
        }
        // WARN + force: record the override
        capacityOverride = { capacityOverride: true, excesses };
      }
    }
    await this.prisma.load.update({
      where: { id },
      data: {
        ...resources,
        status: load.status === LoadStatus.OPEN ? LoadStatus.PLANNED : undefined,
      },
    });
    await this.cost.recompute(tenantId, id);
    // Single audit entry: the resource change and (when forced) the override reason together.
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'load',
      entityId: id,
      after: { ...resources, ...capacityOverride },
    });
    return this.get(tenantId, id);
  }

  /** Replaces the load's accessorial flags and recomputes the cost snapshot. */
  async setAccessorials(tenantId: string, userId: string, id: string, dto: SetLoadAccessorialsDto) {
    const load = await this.get(tenantId, id);
    if (load.status === LoadStatus.COMPLETED || load.status === LoadStatus.CANCELLED) {
      throw new BadRequestException('Accessorials cannot be changed on a COMPLETED or CANCELLED load');
    }
    const ids = dto.items.map((i) => i.accessorialId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate accessorials in the list');
    }
    await Promise.all(ids.map((aid) => this.ownership.assertOwned('accessorial', aid, tenantId)));

    const catalog = await this.prisma.accessorial.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, unit: true },
    });
    if (catalog.length !== ids.length) {
      // Deleted between the ownership check and here — 400 instead of an FK 500.
      throw new BadRequestException('One or more accessorials could not be found');
    }
    const unitOf = new Map(catalog.map((a) => [a.id, a.unit]));

    await this.prisma.$transaction([
      this.prisma.loadAccessorial.deleteMany({ where: { loadId: id } }),
      this.prisma.loadAccessorial.createMany({
        data: dto.items.map((i) => ({
          loadId: id,
          accessorialId: i.accessorialId,
          quantity: unitOf.get(i.accessorialId) === 'FLAT' ? 1 : (i.quantity ?? 1),
        })),
      }),
    ]);
    await this.cost.recompute(tenantId, id);
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'load',
      entityId: id,
      after: { accessorials: dto.items },
    });
    return this.get(tenantId, id);
  }

  /**
   * Generates (or returns) the public driver link for mobile stop check-in/out
   * and POD capture. Revocable at any time.
   */
  async generateDriverLink(tenantId: string, id: string) {
    const load = await this.get(tenantId, id);
    const allowed: LoadStatus[] = [
      LoadStatus.PLANNED,
      LoadStatus.TENDERED,
      LoadStatus.DISPATCHED,
      LoadStatus.IN_TRANSIT,
    ];
    if (!allowed.includes(load.status as LoadStatus)) {
      throw new BadRequestException('Driver links are only available for active loads');
    }
    let token = load.driverToken;
    if (!token) {
      token = randomBytes(24).toString('base64url');
      await this.prisma.load.update({ where: { id }, data: { driverToken: token } });
    }
    return { url: `${this.config.get('WEB_URL', 'http://localhost:5173')}/driver/${token}` };
  }

  async revokeDriverLink(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.load.update({ where: { id }, data: { driverToken: null } });
    return { revoked: true };
  }

  /** Dispatch: load + its shipments go to DISPATCHED, parent orders to IN_EXECUTION. */
  async dispatch(tenantId: string, userId: string, id: string) {
    const load = await this.get(tenantId, id);
    this.assertTransition(load.status as LoadStatus, LoadStatus.DISPATCHED);
    if (!load.carrierId && !load.driverId) {
      throw new BadRequestException('Assign a carrier or driver before dispatching');
    }
    if (load.shipments.length === 0) {
      throw new BadRequestException('Cannot dispatch a load without shipments');
    }
    if (load.status === LoadStatus.TENDERED) {
      const accepted = await this.prisma.tender.findFirst({
        where: { tenantId, loadId: id, status: TenderStatus.ACCEPTED },
      });
      if (!accepted) {
        throw new BadRequestException('Cannot dispatch: the tender has not been accepted yet');
      }
    }

    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    if (tms['requireTendering'] === 'REQUIRED' && load.status !== LoadStatus.TENDERED) {
      const accepted = await this.prisma.tender.findFirst({
        where: { tenantId, loadId: id, status: TenderStatus.ACCEPTED },
      });
      if (!accepted) {
        throw new BadRequestException('Tenant policy requires an accepted tender before dispatch');
      }
    }
    if (tms['bolRequiredBeforeDispatch'] === true) {
      const bol = await this.prisma.document.findFirst({
        where: { tenantId, entityType: 'bill-of-lading', entityId: id },
      });
      if (!bol) {
        throw new BadRequestException('Tenant policy requires a generated BOL before dispatch');
      }
    }

    const orderIds = [...new Set(load.shipments.map((s) => s.transportOrderId))];
    const [updated] = await this.prisma.$transaction([
      this.prisma.load.update({
        where: { id },
        data: { status: LoadStatus.DISPATCHED, dispatchedAt: new Date() },
        include: loadInclude,
      }),
      this.prisma.shipment.updateMany({
        where: { loadId: id },
        data: { status: ShipmentStatus.DISPATCHED },
      }),
      this.prisma.transportOrder.updateMany({
        where: { id: { in: orderIds }, status: TransportOrderStatus.PLANNED },
        data: { status: TransportOrderStatus.IN_EXECUTION },
      }),
      this.prisma.trackingEvent.create({
        data: {
          tenantId,
          loadId: id,
          type: TrackingEventType.DISPATCHED,
          message: `Load ${load.loadNumber} dispatched`,
          recordedById: userId,
        },
      }),
    ]);
    await this.logStatusChange(tenantId, userId, id, load.status, LoadStatus.DISPATCHED);
    await this.notifications.onDispatched(tenantId, { id, loadNumber: load.loadNumber, carrierId: load.carrierId });
    return updated;
  }

  async startTransit(tenantId: string, userId: string, id: string) {
    const load = await this.get(tenantId, id);
    this.assertTransition(load.status as LoadStatus, LoadStatus.IN_TRANSIT);
    const [updated] = await this.prisma.$transaction([
      this.prisma.load.update({
        where: { id },
        data: { status: LoadStatus.IN_TRANSIT },
        include: loadInclude,
      }),
      this.prisma.shipment.updateMany({
        where: { loadId: id },
        data: { status: ShipmentStatus.IN_TRANSIT, actualPickupAt: new Date() },
      }),
      this.prisma.trackingEvent.create({
        data: {
          tenantId,
          loadId: id,
          type: TrackingEventType.DEPARTED_STOP,
          message: `Load ${load.loadNumber} in transit`,
          recordedById: userId,
        },
      }),
    ]);
    await this.logStatusChange(tenantId, userId, id, load.status, LoadStatus.IN_TRANSIT);
    return updated;
  }

  /** Delivery: shipments DELIVERED; orders whose shipments are all delivered go to COMPLETED. */
  async complete(tenantId: string, userId: string, id: string) {
    const load = await this.get(tenantId, id);
    this.assertTransition(load.status as LoadStatus, LoadStatus.COMPLETED);
    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    if (tms['podRequiredBeforeCompletion'] === true) {
      const shipmentsWithoutPod = await this.prisma.shipment.count({
        where: { tenantId, loadId: id, proofOfDelivery: null },
      });
      if (shipmentsWithoutPod > 0) {
        throw new BadRequestException('Tenant policy requires a POD on every shipment before completion');
      }
    }
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.load.update({
        where: { id },
        data: { status: LoadStatus.COMPLETED, completedAt: now },
      }),
      this.prisma.shipment.updateMany({
        where: { loadId: id },
        data: { status: ShipmentStatus.DELIVERED, actualDeliveryAt: now },
      }),
      this.prisma.trackingEvent.create({
        data: {
          tenantId,
          loadId: id,
          type: TrackingEventType.DELIVERED,
          message: `Load ${load.loadNumber} delivered`,
          recordedById: userId,
        },
      }),
    ]);

    // Complete parent orders whose shipments are now all delivered.
    const orderIds = [...new Set(load.shipments.map((s) => s.transportOrderId))];
    for (const orderId of orderIds) {
      const open = await this.prisma.shipment.count({
        where: {
          transportOrderId: orderId,
          status: { notIn: [ShipmentStatus.DELIVERED, ShipmentStatus.CLOSED, ShipmentStatus.CANCELLED] },
        },
      });
      if (open === 0) {
        await this.prisma.transportOrder.updateMany({
          where: { id: orderId, status: TransportOrderStatus.IN_EXECUTION },
          data: { status: TransportOrderStatus.COMPLETED },
        });
      }
    }

    await this.logStatusChange(tenantId, userId, id, load.status, LoadStatus.COMPLETED);
    await this.notifications.onCompleted(tenantId, { id, loadNumber: load.loadNumber, carrierId: load.carrierId });
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const load = await this.get(tenantId, id);
    this.assertTransition(load.status as LoadStatus, LoadStatus.CANCELLED);
    const [updated] = await this.prisma.$transaction([
      this.prisma.load.update({
        where: { id },
        data: { status: LoadStatus.CANCELLED },
        include: loadInclude,
      }),
      // Shipments go back to the planning pool.
      this.prisma.shipment.updateMany({
        where: { loadId: id },
        data: { status: ShipmentStatus.PENDING, loadId: null },
      }),
      // Any pending tender dies with the load.
      this.prisma.tender.updateMany({
        where: { loadId: id, status: TenderStatus.PENDING },
        data: { status: TenderStatus.CANCELLED, respondedAt: new Date() },
      }),
      // Junction follows the pool return (spec invariant: legs stay in sync with Shipment.loadId).
      this.prisma.shipmentLoadLeg.deleteMany({ where: { loadId: id } }),
    ]);
    await this.logStatusChange(tenantId, userId, id, load.status, LoadStatus.CANCELLED);
    return updated;
  }

  private assertTransition(from: LoadStatus, to: LoadStatus) {
    if (!canTransitionLoad(from, to)) {
      throw new BadRequestException(`Invalid transition ${from} → ${to}`);
    }
  }

  private logStatusChange(tenantId: string, userId: string, id: string, from: string, to: string) {
    return this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'load',
      entityId: id,
      before: { status: from },
      after: { status: to },
    });
  }
}
