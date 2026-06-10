import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  LoadStatus,
  ShipmentStatus,
  TrackingEventType,
  TransportOrderStatus,
  canTransitionLoad,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { AssignLoadResourcesDto, CreateLoadDto } from './dto/load.dto';

const loadInclude = {
  carrier: { select: { id: true, code: true, name: true } },
  driver: { select: { id: true, firstName: true, lastName: true } },
  vehicle: { select: { id: true, unitNumber: true } },
  trailer: { select: { id: true, unitNumber: true } },
  rate: { select: { id: true, name: true, rateType: true, baseAmount: true, currency: true } },
  shipments: { select: { id: true, shipmentNumber: true, status: true, transportOrderId: true } },
  route: { include: { stops: { orderBy: { sequence: 'asc' as const } } } },
} satisfies Prisma.LoadInclude;

@Injectable()
export class LoadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
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
    const count = await this.prisma.load.count({ where: { tenantId } });
    const load = await this.prisma.load.create({
      data: {
        tenantId,
        loadNumber: `LD-${String(count + 1).padStart(6, '0')}`,
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
    const updated = await this.prisma.load.update({
      where: { id },
      data: {
        ...dto,
        status: load.status === LoadStatus.OPEN ? LoadStatus.PLANNED : undefined,
      },
      include: loadInclude,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'load',
      entityId: id,
      after: dto,
    });
    return updated;
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
