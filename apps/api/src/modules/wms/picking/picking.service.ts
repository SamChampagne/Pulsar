import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  PickOrderStatus,
  StockMovementType,
  canTransitionPickOrder,
} from '@pulsar/shared';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { InventoryService } from '../inventory/inventory.service';
import { AddPickLineDto, CreatePickOrderDto, PickListQueryDto } from './dto/pick.dto';

/**
 * Outbound pick orders — the symmetric mirror of ReceivingService. An OPEN pick
 * order accumulates lines; completing it turns each line into a PICK movement via
 * InventoryService.postMovement (decrementing the source bin's balance, which
 * enforces availability → ConflictException if short, rolling back the whole tx)
 * inside a single transaction. The OPEN|PICKED→COMPLETED flip is a conditional
 * updateMany claim (TOCTOU-safe). Status changes go through canTransitionPickOrder
 * (rule 2); tenant-scoped (rule 1); audited (rule 6); numbers via SequencesService
 * (rule 8).
 */
@Injectable()
export class PickingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  async list(tenantId: string, q: PickListQueryDto) {
    return this.prisma.pickOrder.findMany({
      where: {
        tenantId,
        ...(q.status ? { status: q.status as PickOrderStatus } : {}),
        ...(q.locationId ? { locationId: q.locationId } : {}),
        ...(q.shipmentId ? { shipmentId: q.shipmentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        _count: { select: { lines: true } },
        shipment: { select: { id: true, shipmentNumber: true, status: true } },
      },
    });
  }

  async get(tenantId: string, id: string) {
    const order = await this.prisma.pickOrder.findFirst({
      where: { id, tenantId },
      include: {
        lines: {
          include: {
            item: { select: { sku: true, name: true } },
            fromBin: { select: { code: true } },
          },
        },
        shipment: { select: { id: true, shipmentNumber: true, status: true } },
      },
    });
    if (!order) throw new NotFoundException('Pick order not found');
    return order;
  }

  async create(tenantId: string, userId: string, dto: CreatePickOrderDto) {
    const loc = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId },
      select: { id: true, type: true },
    });
    if (!loc) throw new NotFoundException('Location not found');
    if (loc.type !== 'WAREHOUSE')
      throw new BadRequestException('Pick order requires a WAREHOUSE location');

    if (dto.shipmentId) {
      const shipment = await this.prisma.shipment.findFirst({
        where: { id: dto.shipmentId, tenantId },
        select: { id: true, originLocationId: true },
      });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (shipment.originLocationId !== dto.locationId) {
        throw new BadRequestException(
          'Pick order location must match the shipment origin warehouse',
        );
      }
    }

    const number = await this.sequences.nextNumber(tenantId, 'pick-order');
    const order = await this.prisma.pickOrder.create({
      data: {
        tenantId,
        number,
        locationId: dto.locationId,
        shipmentId: dto.shipmentId ?? null,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
        status: PickOrderStatus.OPEN,
        createdById: userId,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'wms-pick-order',
      entityId: order.id,
      after: { number: order.number, locationId: order.locationId },
    });
    return order;
  }

  async addLine(tenantId: string, id: string, dto: AddPickLineDto) {
    const order = await this.prisma.pickOrder.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('Pick order not found');
    if (order.status !== PickOrderStatus.OPEN)
      throw new BadRequestException('Pick order is not editable');

    const item = await this.prisma.wmsItem.findFirst({
      where: { id: dto.itemId, tenantId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    const bin = await this.prisma.bin.findFirst({
      where: { id: dto.fromBinId, tenantId },
      select: { id: true },
    });
    if (!bin) throw new NotFoundException('Bin not found');

    await this.prisma.pickLine.create({
      data: {
        tenantId,
        pickOrderId: id,
        itemId: dto.itemId,
        fromBinId: dto.fromBinId,
        qty: dto.qty,
      },
    });
    return this.get(tenantId, id);
  }

  async removeLine(tenantId: string, id: string, lineId: string) {
    const order = await this.prisma.pickOrder.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('Pick order not found');
    if (order.status !== PickOrderStatus.OPEN)
      throw new BadRequestException('Pick order is not editable');

    await this.prisma.pickLine.deleteMany({ where: { id: lineId, tenantId, pickOrderId: id } });
    return this.get(tenantId, id);
  }

  async complete(tenantId: string, userId: string, id: string) {
    const order = await this.get(tenantId, id);
    if (!canTransitionPickOrder(order.status as PickOrderStatus, PickOrderStatus.COMPLETED)) {
      throw new BadRequestException(`Cannot complete a pick order in status ${order.status}`);
    }
    if (order.lines.length === 0) throw new BadRequestException('Pick order has no lines');

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.pickOrder.updateMany({
        where: { id, tenantId, status: { in: [PickOrderStatus.OPEN, PickOrderStatus.PICKED] } },
        data: { status: PickOrderStatus.COMPLETED, completedAt: new Date() },
      });
      if (claim.count === 0) throw new ConflictException('Pick order already processed');
      for (const line of order.lines) {
        await this.inventory.postMovement(tx, {
          tenantId,
          userId,
          type: StockMovementType.PICK,
          itemId: line.itemId,
          fromBinId: line.fromBinId,
          qty: Number(line.qty),
          refType: 'pick-order',
          refId: id,
        });
      }
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'wms-pick-order',
      entityId: id,
      before: { status: order.status },
      after: { status: PickOrderStatus.COMPLETED, lines: order.lines.length },
    });

    // Cross-module spine (best-effort): a pick tied to a shipment means freight is
    // prepared and ready to ship — surface it to the operating workbench / dispatch.
    if (order.shipment) {
      await this.domainEvents.emit(
        tenantId,
        'wms.pick.completed',
        { type: 'shipment', id: order.shipment.id },
        {
          shipmentId: order.shipment.id,
          shipmentNumber: order.shipment.shipmentNumber,
          pickOrderId: id,
          pickOrderNumber: order.number,
        },
      );
    }
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const order = await this.prisma.pickOrder.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('Pick order not found');
    if (!canTransitionPickOrder(order.status as PickOrderStatus, PickOrderStatus.CANCELLED)) {
      throw new BadRequestException(`Cannot cancel a pick order in status ${order.status}`);
    }
    const claim = await this.prisma.pickOrder.updateMany({
      where: { id, tenantId, status: { in: [PickOrderStatus.OPEN, PickOrderStatus.PICKED] } },
      data: { status: PickOrderStatus.CANCELLED },
    });
    if (claim.count === 0) throw new ConflictException('Pick order already processed');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'wms-pick-order',
      entityId: id,
      before: { status: order.status },
      after: { status: PickOrderStatus.CANCELLED },
    });
    return this.get(tenantId, id);
  }
}
