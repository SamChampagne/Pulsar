import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  ShipmentStatus,
  TransportOrderStatus,
  canTransitionTransportOrder,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { CreateTransportOrderDto, UpdateTransportOrderDto } from './dto/transport-order.dto';

const orderInclude = {
  customer: { select: { id: true, code: true, name: true } },
  originLocation: { select: { id: true, code: true, name: true, city: true } },
  destinationLocation: { select: { id: true, code: true, name: true, city: true } },
  shipments: { select: { id: true, shipmentNumber: true, status: true, loadId: true } },
} satisfies Prisma.TransportOrderInclude;

@Injectable()
export class TransportOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}

  private async assertReferences(tenantId: string, dto: UpdateTransportOrderDto) {
    await Promise.all([
      this.ownership.assertOwnedIfSet('customer', dto.customerId, tenantId),
      this.ownership.assertOwnedIfSet('location', dto.originLocationId, tenantId),
      this.ownership.assertOwnedIfSet('location', dto.destinationLocationId, tenantId),
    ]);
  }

  async list(tenantId: string, query: ListQueryDto & { status?: TransportOrderStatus }) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.TransportOrderWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { orderNumber: { contains: query.search, mode: 'insensitive' } },
              { customerReference: { contains: query.search, mode: 'insensitive' } },
              { customer: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.transportOrder.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: orderInclude,
      }),
      this.prisma.transportOrder.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const order = await this.prisma.transportOrder.findFirst({
      where: { id, tenantId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Transport order not found');
    return order;
  }

  async create(tenantId: string, userId: string, dto: CreateTransportOrderDto) {
    await this.assertReferences(tenantId, dto);
    const order = await this.prisma.transportOrder.create({
      data: {
        tenantId,
        orderNumber: await this.sequences.nextNumber(tenantId, 'transport-order'),
        createdById: userId,
        ...dto,
        requestedPickupDate: dto.requestedPickupDate ? new Date(dto.requestedPickupDate) : undefined,
        requestedDeliveryDate: dto.requestedDeliveryDate
          ? new Date(dto.requestedDeliveryDate)
          : undefined,
      },
      include: orderInclude,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'transport-order',
      entityId: order.id,
      after: { orderNumber: order.orderNumber, status: order.status },
    });
    return order;
  }

  async update(tenantId: string, id: string, dto: UpdateTransportOrderDto) {
    const order = await this.get(tenantId, id);
    if (order.status !== TransportOrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT orders can be edited');
    }
    await this.assertReferences(tenantId, dto);
    return this.prisma.transportOrder.update({
      where: { id },
      data: {
        ...dto,
        requestedPickupDate: dto.requestedPickupDate ? new Date(dto.requestedPickupDate) : undefined,
        requestedDeliveryDate: dto.requestedDeliveryDate
          ? new Date(dto.requestedDeliveryDate)
          : undefined,
      },
      include: orderInclude,
    });
  }

  confirm(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, TransportOrderStatus.CONFIRMED);
  }

  cancel(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, TransportOrderStatus.CANCELLED);
  }

  close(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, TransportOrderStatus.CLOSED);
  }

  /**
   * Planning step: derives one shipment from the order (1 order = 1 shipment for now;
   * order splitting into multiple freight units is a phase-2 feature).
   */
  async plan(tenantId: string, userId: string, id: string) {
    const order = await this.get(tenantId, id);
    if (order.status !== TransportOrderStatus.CONFIRMED) {
      throw new BadRequestException('Only CONFIRMED orders can be planned');
    }
    await this.prisma.shipment.create({
      data: {
        tenantId,
        shipmentNumber: await this.sequences.nextNumber(tenantId, 'shipment'),
        transportOrderId: order.id,
        status: ShipmentStatus.PENDING,
        originLocationId: order.originLocationId,
        destinationLocationId: order.destinationLocationId,
        weightKg: order.totalWeightKg,
        volumeM3: order.totalVolumeM3,
        palletCount: order.palletCount,
        plannedPickupAt: order.requestedPickupDate,
        plannedDeliveryAt: order.requestedDeliveryDate,
      },
    });
    return this.transition(tenantId, userId, id, TransportOrderStatus.PLANNED);
  }

  async transition(tenantId: string, userId: string, id: string, to: TransportOrderStatus) {
    const order = await this.get(tenantId, id);
    const from = order.status as TransportOrderStatus;
    if (!canTransitionTransportOrder(from, to)) {
      throw new BadRequestException(`Invalid transition ${from} → ${to}`);
    }
    const updated = await this.prisma.transportOrder.update({
      where: { id },
      data: { status: to },
      include: orderInclude,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'transport-order',
      entityId: id,
      before: { status: from },
      after: { status: to },
    });
    return updated;
  }
}
