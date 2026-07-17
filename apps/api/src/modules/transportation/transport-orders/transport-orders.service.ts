import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  DOMAIN_EVENT_TYPES,
  CustomFieldEntity,
  MODULE_KEYS,
  SalesOrderStatus,
  ShipmentStatus,
  TransportOrderStatus,
  canTransitionTransportOrder,
  deriveSalesOrderFulfillment,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import {
  CreateTransportOrderDto,
  CreateTransportOrderFromSalesOrderDto,
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
  sourceSalesOrder: { select: { id: true, number: true, status: true, companyId: true } },
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
    private readonly modules: TenantModulesCacheService,
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

  async create(
    tenantId: string,
    userId: string,
    dto: CreateTransportOrderDto,
    source?: { sourceSalesOrderId?: string; sourceFulfillmentKey?: string },
  ) {
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
        ...(source?.sourceSalesOrderId
          ? {
              sourceSalesOrderId: source.sourceSalesOrderId,
              sourceFulfillmentKey: source.sourceFulfillmentKey ?? 'primary',
            }
          : {}),
      },
      include: orderInclude,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'transport-order',
      entityId: order.id,
      after: {
        orderNumber: order.orderNumber,
        status: order.status,
        ...(source?.sourceSalesOrderId
          ? {
              sourceSalesOrderId: source.sourceSalesOrderId,
              sourceFulfillmentKey: source.sourceFulfillmentKey ?? 'primary',
            }
          : {}),
      },
    });
    return order;
  }

  /**
   * Fulfillment bridge (CRM → TMS). Creates a transport order from a CONFIRMED
   * sales order. The customer is derived from SalesOrder.customerId (never
   * trusted from the client); logistics data (origin/destination/windows/
   * weight/volume/pallets) is supplied explicitly in the DTO (never inferred
   * from commercial amounts). Idempotent on (tenant, salesOrder, fulfillmentKey)
   * — a retry returns the existing transport order. Reuses create() so
   * sequences (rule 8), ownership (rule 9), custom-field validation (rule 35)
   * and audit (rule 6) all apply. Requires both CRM and Transportation modules.
   */
  async createFromSalesOrder(
    tenantId: string,
    userId: string,
    salesOrderId: string,
    dto: CreateTransportOrderFromSalesOrderDto,
  ) {
    // Both modules must be enabled. The controller already gates Transportation
    // (@RequireModule); CRM is enforced here since this route lives under the
    // Transportation module (rule 15 spirit — re-check in the service).
    const enabled = await this.modules.getEnabledKeys(tenantId).catch(() => new Set<string>());
    if (!enabled.has(MODULE_KEYS.CRM)) {
      throw new BadRequestException('CRM module is not enabled for this tenant');
    }
    if (!enabled.has(MODULE_KEYS.TRANSPORTATION)) {
      throw new BadRequestException('Transportation module is not enabled for this tenant');
    }

    const so = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, tenantId },
      select: { id: true, number: true, status: true, customerId: true },
    });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.status !== SalesOrderStatus.CONFIRMED) {
      throw new BadRequestException(
        `Only a CONFIRMED sales order can request a shipment (current: ${so.status})`,
      );
    }
    if (!so.customerId) {
      throw new BadRequestException(
        'This sales order has no linked customer; link a TMS customer before preparing a shipment',
      );
    }

    const fulfillmentKey = dto.fulfillmentKey?.trim() || 'primary';

    // Idempotent retry: return the transport order already created for this
    // (salesOrder, fulfillmentKey) instead of a duplicate.
    const existing = await this.prisma.transportOrder.findFirst({
      where: { tenantId, sourceSalesOrderId: salesOrderId, sourceFulfillmentKey: fulfillmentKey },
      include: orderInclude,
    });
    if (existing) return existing;

    const orderDto: CreateTransportOrderDto = {
      customerId: so.customerId, // derived, never trusted from the client
      originLocationId: dto.originLocationId,
      destinationLocationId: dto.destinationLocationId,
      customerReference: dto.customerReference ?? so.number, // rule 9-flow: default to SO number
      requestedPickupEarly: dto.requestedPickupEarly,
      requestedPickupLate: dto.requestedPickupLate,
      requestedDeliveryEarly: dto.requestedDeliveryEarly,
      requestedDeliveryLate: dto.requestedDeliveryLate,
      mode: dto.mode,
      totalWeightKg: dto.totalWeightKg,
      totalVolumeM3: dto.totalVolumeM3,
      palletCount: dto.palletCount,
      notes: dto.notes,
      customData: dto.customData,
    };

    let order;
    try {
      order = await this.create(tenantId, userId, orderDto, {
        sourceSalesOrderId: salesOrderId,
        sourceFulfillmentKey: fulfillmentKey,
      });
    } catch (e) {
      // Concurrent retry raced us to the unique (tenant, salesOrder, key) — return the winner.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.transportOrder.findFirst({
          where: { tenantId, sourceSalesOrderId: salesOrderId, sourceFulfillmentKey: fulfillmentKey },
          include: orderInclude,
        });
        if (raced) return raced;
      }
      throw e;
    }

    // Audit the link on the sales-order side too (both entities carry the link).
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-sales-order',
      entityId: salesOrderId,
      after: { transportOrderId: order.id, fulfillmentKey },
    });

    // Explicit cross-module event (best-effort, never blocking — rule 27).
    await this.domainEvents.emit(
      tenantId,
      DOMAIN_EVENT_TYPES.CRM_SALES_ORDER_TRANSPORT_REQUESTED,
      { type: 'sales-order', id: salesOrderId },
      {
        salesOrderId,
        transportOrderId: order.id,
        fulfillmentKey,
        customerId: so.customerId,
      },
    );

    return order;
  }

  /**
   * Read-only fulfillment context for a sales order: the sales order, its linked
   * TMS customer (if any), the transport orders already derived from it, the
   * derived fulfillment decision, and the logistics fields the user must supply
   * (never inferred). Powers the agent READ tool and the "Prepare shipment" UI.
   */
  async getSalesOrderFulfillmentContext(tenantId: string, salesOrderId: string) {
    const so = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, tenantId },
      select: {
        id: true,
        number: true,
        status: true,
        customerId: true,
        currency: true,
        totalAmount: true,
      },
    });
    if (!so) throw new NotFoundException('Sales order not found');

    const customer = so.customerId
      ? await this.prisma.customer.findFirst({
          where: { id: so.customerId, tenantId },
          select: { id: true, code: true, name: true },
        })
      : null;

    const transportOrders = await this.prisma.transportOrder.findMany({
      where: { tenantId, sourceSalesOrderId: salesOrderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        sourceFulfillmentKey: true,
        originLocation: { select: { id: true, name: true, city: true } },
        destinationLocation: { select: { id: true, name: true, city: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const fulfillment = deriveSalesOrderFulfillment(transportOrders.map((t) => t.status));
    const canPrepareShipment =
      so.status === SalesOrderStatus.CONFIRMED && !!so.customerId;

    return {
      salesOrder: so,
      customer,
      transportOrders,
      fulfillment,
      canPrepareShipment,
      // Logistics data must be supplied explicitly — a sales order carries none
      // of it and it must never be inferred from commercial amounts/quantities.
      requiredLogisticsFields: [
        'originLocationId',
        'destinationLocationId',
        'requestedPickupEarly/Late',
        'requestedDeliveryEarly/Late',
        'totalWeightKg',
        'totalVolumeM3',
        'palletCount',
        'mode',
      ],
    };
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
   * Mark an order COMPLETED after all its shipments were delivered on a load.
   * Centralizes the invariants the load-completion path needs (rules 1/2/6):
   *  - tenant-scoped, race-safe conditional claim (IN_EXECUTION → COMPLETED);
   *  - transition guarded by canTransitionTransportOrder;
   *  - STATUS_CHANGE audit with the real actor;
   *  - the fulfillment event (transport-order.completed) emitted exactly once,
   *    ONLY when THIS call won the claim (count === 1) and the order was created
   *    from a sales order — so a retry never double-fires. Costs are never
   *    recomputed here (rule 16 untouched).
   * Returns true iff this call performed the transition.
   */
  async completeFromDelivery(tenantId: string, userId: string, orderId: string): Promise<boolean> {
    if (!canTransitionTransportOrder(TransportOrderStatus.IN_EXECUTION, TransportOrderStatus.COMPLETED)) {
      return false;
    }
    // TOCTOU-safe: only a row still IN_EXECUTION for THIS tenant flips. A
    // CANCELLED/CLOSED/already-COMPLETED order or another tenant's order → 0.
    const { count } = await this.prisma.transportOrder.updateMany({
      where: { id: orderId, tenantId, status: TransportOrderStatus.IN_EXECUTION },
      data: { status: TransportOrderStatus.COMPLETED },
    });
    if (count !== 1) return false;

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'transport-order',
      entityId: orderId,
      before: { status: TransportOrderStatus.IN_EXECUTION },
      after: { status: TransportOrderStatus.COMPLETED },
    });

    const done = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
      select: { sourceSalesOrderId: true, sourceFulfillmentKey: true, customerId: true },
    });
    if (done?.sourceSalesOrderId) {
      await this.domainEvents.emit(
        tenantId,
        DOMAIN_EVENT_TYPES.TRANSPORT_ORDER_COMPLETED,
        { type: 'transport-order', id: orderId },
        {
          transportOrderId: orderId,
          sourceSalesOrderId: done.sourceSalesOrderId,
          sourceFulfillmentKey: done.sourceFulfillmentKey,
          customerId: done.customerId,
        },
      );
    }
    return true;
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
