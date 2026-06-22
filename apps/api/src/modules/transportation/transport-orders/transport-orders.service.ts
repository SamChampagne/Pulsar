import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  DOMAIN_EVENT_TYPES,
  CustomFieldEntity,
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
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import {
  CreateTransportOrderDto,
  PlanTransportOrderDto,
  ShipmentSplitDto,
  UpdateTransportOrderDto,
} from './dto/transport-order.dto';
import { toDate, assertWindowCoherence, resolveSplitWindows } from '../planning/window-validation';
import { shipmentWindowWarnings } from '../planning/window-warnings';

const orderInclude = {
  customer: { select: { id: true, code: true, name: true } },
  originLocation: { select: { id: true, code: true, name: true, city: true } },
  destinationLocation: { select: { id: true, code: true, name: true, city: true } },
  shipments: {
    select: {
      id: true,
      shipmentNumber: true,
      status: true,
      loadId: true,
      plannedPickupEarly: true,
      plannedPickupLate: true,
      plannedDeliveryEarly: true,
      plannedDeliveryLate: true,
    },
  },
} satisfies Prisma.TransportOrderInclude;

@Injectable()
export class TransportOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly domainEvents: DomainEventsService,
    private readonly moduleSettings: ModuleSettingsService,
    private readonly customFields: CustomFieldsService,
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
    return { ...order, windowWarnings: shipmentWindowWarnings(order, order.shipments) };
  }

  async create(tenantId: string, userId: string, dto: CreateTransportOrderDto) {
    await this.assertReferences(tenantId, dto);
    const pickupEarly = toDate(dto.requestedPickupEarly);
    const pickupLate = toDate(dto.requestedPickupLate);
    const deliveryEarly = toDate(dto.requestedDeliveryEarly);
    const deliveryLate = toDate(dto.requestedDeliveryLate);
    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    if (tms['windowCoherence'] !== 'LENIENT') {
      assertWindowCoherence({ pickupEarly, pickupLate, deliveryEarly, deliveryLate });
    }
    const customData = await this.customFields.validateValues(
      'transportation', tenantId, CustomFieldEntity.TRANSPORT_ORDER, dto.customData, { partial: false },
    );
    const { customData: _cd, ...dtoWithout } = dto;
    const order = await this.prisma.transportOrder.create({
      data: {
        tenantId,
        orderNumber: await this.sequences.nextNumber(tenantId, 'transport-order'),
        createdById: userId,
        ...dtoWithout,
        requestedPickupEarly: pickupEarly,
        requestedPickupLate: pickupLate,
        requestedDeliveryEarly: deliveryEarly,
        requestedDeliveryLate: deliveryLate,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
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
    const pickupEarly = dto.requestedPickupEarly !== undefined ? toDate(dto.requestedPickupEarly) : order.requestedPickupEarly;
    const pickupLate = dto.requestedPickupLate !== undefined ? toDate(dto.requestedPickupLate) : order.requestedPickupLate;
    const deliveryEarly = dto.requestedDeliveryEarly !== undefined ? toDate(dto.requestedDeliveryEarly) : order.requestedDeliveryEarly;
    const deliveryLate = dto.requestedDeliveryLate !== undefined ? toDate(dto.requestedDeliveryLate) : order.requestedDeliveryLate;
    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    if (tms['windowCoherence'] !== 'LENIENT') {
      assertWindowCoherence({ pickupEarly, pickupLate, deliveryEarly, deliveryLate });
    }
    const customData = await this.customFields.validateValues(
      'transportation', tenantId, CustomFieldEntity.TRANSPORT_ORDER, dto.customData, { partial: true },
    );
    const { customData: _cd, ...dtoWithout } = dto;
    return this.prisma.transportOrder.update({
      where: { id },
      data: {
        ...dtoWithout,
        requestedPickupEarly: pickupEarly,
        requestedPickupLate: pickupLate,
        requestedDeliveryEarly: deliveryEarly,
        requestedDeliveryLate: deliveryLate,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
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
   * Planning step: derives shipments (freight units) from the order. Without a
   * split, one shipment carries the full order; with `dto.shipments`, one
   * shipment is created per entry (order splitting).
   */
  async plan(tenantId: string, userId: string, id: string, dto?: PlanTransportOrderDto) {
    const order = await this.get(tenantId, id);
    if (order.status !== TransportOrderStatus.CONFIRMED) {
      throw new BadRequestException('Only CONFIRMED orders can be planned');
    }

    const splits = dto?.shipments ?? [
      {
        weightKg: order.totalWeightKg ?? undefined,
        volumeM3: order.totalVolumeM3 ?? undefined,
        palletCount: order.palletCount ?? undefined,
      },
    ];

    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    const strict = tms['windowCoherence'] !== 'LENIENT';
    for (const split of splits) {
      const windows = resolveSplitWindows(order, split, strict);
      const shipmentCustomData = await this.customFields.validateValues(
        'transportation', tenantId, CustomFieldEntity.SHIPMENT, split.customData, { partial: false },
      );
      await this.prisma.shipment.create({
        data: {
          tenantId,
          shipmentNumber: await this.sequences.nextNumber(tenantId, 'shipment'),
          transportOrderId: order.id,
          status: ShipmentStatus.PENDING,
          originLocationId: order.originLocationId,
          destinationLocationId: order.destinationLocationId,
          weightKg: split.weightKg,
          volumeM3: split.volumeM3,
          palletCount: split.palletCount,
          ...windows,
          ...(shipmentCustomData !== undefined ? { customData: shipmentCustomData as Prisma.InputJsonValue } : {}),
        },
      });
    }
    const planned = await this.transition(tenantId, userId, id, TransportOrderStatus.PLANNED);
    // Best-effort: emit after state change succeeds (never blocking — rule 27).
    await this.domainEvents.emit(
      tenantId,
      DOMAIN_EVENT_TYPES.TRANSPORT_ORDER_PLANNED,
      { type: 'transport-order', id: order.id },
      { orderId: order.id, orderNumber: order.orderNumber, shipmentCount: splits.length },
    );
    return planned;
  }

  /** Post-planning re-split: appends one more PENDING shipment to a PLANNED order. */
  async addShipment(tenantId: string, userId: string, id: string, split: ShipmentSplitDto) {
    const order = await this.get(tenantId, id);
    if (order.status !== TransportOrderStatus.PLANNED) {
      throw new BadRequestException('Shipments can only be added to PLANNED orders');
    }
    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    const windows = resolveSplitWindows(order, split, tms['windowCoherence'] !== 'LENIENT');
    const shipmentCustomData = await this.customFields.validateValues(
      'transportation', tenantId, CustomFieldEntity.SHIPMENT, split.customData, { partial: false },
    );
    const shipment = await this.prisma.shipment.create({
      data: {
        tenantId,
        shipmentNumber: await this.sequences.nextNumber(tenantId, 'shipment'),
        transportOrderId: order.id,
        status: ShipmentStatus.PENDING,
        originLocationId: order.originLocationId,
        destinationLocationId: order.destinationLocationId,
        weightKg: split.weightKg,
        volumeM3: split.volumeM3,
        palletCount: split.palletCount,
        ...windows,
        ...(shipmentCustomData !== undefined ? { customData: shipmentCustomData as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'shipment',
      entityId: shipment.id,
      after: { shipmentNumber: shipment.shipmentNumber, transportOrderId: order.id },
    });
    return shipment;
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
