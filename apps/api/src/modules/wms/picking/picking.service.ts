import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CustomFieldEntity,
  PickOrderStatus,
  StockMovementType,
  canTransitionPickOrder,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  assertWmsLine,
  lockWmsDocument,
  nextWmsVersion,
  readWmsDocument,
} from '../document-operations';
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
    private readonly customFields: CustomFieldsService,
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
    return this.prisma.$transaction((tx) => readWmsDocument(tx, tenantId, 'pickOrder', id), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
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

    const customData = await this.customFields.validateValues(
      'wms',
      tenantId,
      CustomFieldEntity.PICK_ORDER,
      dto.customData,
      { partial: false },
    );
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
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
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
    return this.writeLine(tenantId, id, dto);
  }

  async updateLine(tenantId: string, id: string, lineId: string, dto: AddPickLineDto) {
    return this.writeLine(tenantId, id, dto, lineId);
  }

  private async writeLine(tenantId: string, id: string, dto: AddPickLineDto, lineId?: string) {
    await this.ownership.assertOwned('wmsItem', dto.itemId, tenantId);
    await this.ownership.assertOwned('bin', dto.fromBinId, tenantId);
    await this.prisma.$transaction(async (tx) => {
      const doc = await lockWmsDocument(tx, tenantId, 'pickOrder', id, dto.expectedUpdatedAt);
      if (doc.status !== 'OPEN') throw new ConflictException('Ce document n’est plus modifiable.');
      await assertWmsLine(tx, tenantId, doc.locationId, dto.itemId, dto.fromBinId, dto.qty);
      const data = { itemId: dto.itemId, fromBinId: dto.fromBinId, qty: dto.qty };
      if (lineId) {
        const result = await tx.pickLine.updateMany({
          where: { id: lineId, tenantId, pickOrderId: id },
          data,
        });
        if (!result.count) throw new NotFoundException('Ligne introuvable dans ce document.');
      } else {
        await tx.pickLine.create({ data: { ...data, tenantId, pickOrderId: id } });
      }
      await tx.pickOrder.updateMany({
        where: { id, tenantId, status: 'OPEN' },
        data: { updatedAt: nextWmsVersion(doc.updatedAt) },
      });
    });
    return this.get(tenantId, id);
  }

  async removeLine(tenantId: string, id: string, lineId: string, expectedUpdatedAt?: string) {
    await this.prisma.$transaction(async (tx) => {
      const doc = await lockWmsDocument(tx, tenantId, 'pickOrder', id, expectedUpdatedAt);
      if (doc.status !== 'OPEN') throw new ConflictException('Ce document n’est plus modifiable.');
      const result = await tx.pickLine.deleteMany({
        where: { id: lineId, tenantId, pickOrderId: id },
      });
      if (!result.count) throw new NotFoundException('Ligne introuvable dans ce document.');
      await tx.pickOrder.updateMany({
        where: { id, tenantId, status: 'OPEN' },
        data: { updatedAt: nextWmsVersion(doc.updatedAt) },
      });
    });
    return this.get(tenantId, id);
  }

  async complete(tenantId: string, userId: string, id: string, expectedUpdatedAt?: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      await lockWmsDocument(tx, tenantId, 'pickOrder', id, expectedUpdatedAt);
      const order = await tx.pickOrder.findFirstOrThrow({
        where: { id, tenantId },
        include: { lines: true, shipment: { select: { id: true, shipmentNumber: true } } },
      });
      if (!canTransitionPickOrder(order.status as PickOrderStatus, PickOrderStatus.COMPLETED)) {
        throw new BadRequestException(`Cannot complete a pick order in status ${order.status}`);
      }
      if (order.lines.length === 0) throw new BadRequestException('Pick order has no lines');
      for (const line of order.lines) {
        await assertWmsLine(
          tx,
          tenantId,
          order.locationId,
          line.itemId,
          line.fromBinId,
          Number(line.qty),
        );
      }
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
          locationId: order.locationId,
          refType: 'pick-order',
          refId: id,
        });
      }
      return order;
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

  async cancel(tenantId: string, userId: string, id: string, expectedUpdatedAt?: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await lockWmsDocument(tx, tenantId, 'pickOrder', id, expectedUpdatedAt);
      if (!canTransitionPickOrder(order.status as PickOrderStatus, PickOrderStatus.CANCELLED)) {
        throw new BadRequestException(`Cannot cancel a pick order in status ${order.status}`);
      }
      const claim = await tx.pickOrder.updateMany({
        where: { id, tenantId, status: { in: [PickOrderStatus.OPEN, PickOrderStatus.PICKED] } },
        data: { status: PickOrderStatus.CANCELLED },
      });
      if (claim.count === 0) throw new ConflictException('Pick order already processed');
      return order;
    });
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
