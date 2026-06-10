import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  LoadStatus,
  ShipmentStatus,
  TenderStatus,
  TrackingEventType,
  TransportOrderStatus,
  canTransitionLoad,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { randomBytes } from 'node:crypto';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { WebhooksService } from '../../../core/integrations/webhooks.service';
import { LoadCostService } from './load-cost.service';
import { AssignLoadResourcesDto, CreateLoadDto } from './dto/load.dto';

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
      transportOrderId: true,
      originLocationId: true,
      destinationLocationId: true,
      proofOfDelivery: { select: { id: true, signedByName: true, signedAt: true } },
    },
  },
  route: { include: { stops: { orderBy: { sequence: 'asc' as const } } } },
} satisfies Prisma.LoadInclude;

@Injectable()
export class LoadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly cost: LoadCostService,
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService,
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

  async get(tenantId: string, id: string) {
    const load = await this.prisma.load.findFirst({ where: { id, tenantId }, include: loadInclude });
    if (!load) throw new NotFoundException('Load not found');
    return load;
  }

  async create(tenantId: string, userId: string, dto: CreateLoadDto) {
    const load = await this.prisma.load.create({
      data: {
        tenantId,
        loadNumber: await this.sequences.nextNumber(tenantId, 'load'),
        notes: dto.notes,
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
    await this.prisma.load.update({
      where: { id },
      data: {
        ...dto,
        status: load.status === LoadStatus.OPEN ? LoadStatus.PLANNED : undefined,
      },
    });
    await this.cost.recompute(tenantId, id);
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'load',
      entityId: id,
      after: dto,
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
    await this.webhooks.emit(tenantId, 'load.dispatched', {
      loadId: id,
      loadNumber: load.loadNumber,
      carrierId: load.carrierId,
    });
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
    await this.webhooks.emit(tenantId, 'load.completed', {
      loadId: id,
      loadNumber: load.loadNumber,
      carrierId: load.carrierId,
    });
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
