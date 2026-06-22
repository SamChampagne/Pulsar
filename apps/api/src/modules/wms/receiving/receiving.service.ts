import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, CustomFieldEntity, DOMAIN_EVENT_TYPES, ReceiptStatus, StockMovementType, canTransitionReceipt } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { InventoryService } from '../inventory/inventory.service';
import { AddReceiptLineDto, CreateReceiptDto, ReceiptListQueryDto, UpdateReceiptDto } from './dto/receipt.dto';

/**
 * Inbound receipts. A DRAFT receipt accumulates lines; posting it turns each
 * line into a RECEIPT movement via InventoryService.postMovement (bumping the
 * destination bin's balance) inside a single transaction. The DRAFT→POSTED flip
 * is a conditional updateMany claim (TOCTOU-safe). Status changes go through
 * canTransitionReceipt (rule 2); tenant-scoped (rule 1); audited (rule 6);
 * numbers via SequencesService (rule 8).
 */
@Injectable()
export class ReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly domainEvents: DomainEventsService,
    private readonly customFields: CustomFieldsService,
  ) {}

  async list(tenantId: string, q: ReceiptListQueryDto) {
    return this.prisma.receipt.findMany({
      where: {
        tenantId,
        ...(q.status ? { status: q.status as ReceiptStatus } : {}),
        ...(q.locationId ? { locationId: q.locationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { lines: true } } },
    });
  }

  async get(tenantId: string, id: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { id, tenantId },
      include: {
        lines: {
          include: {
            item: { select: { sku: true, name: true } },
            toBin: { select: { code: true } },
          },
        },
      },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }

  async create(tenantId: string, userId: string, dto: CreateReceiptDto) {
    const loc = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId },
      select: { id: true, type: true },
    });
    if (!loc) throw new NotFoundException('Location not found');
    if (loc.type !== 'WAREHOUSE') throw new BadRequestException('Receipt requires a WAREHOUSE location');

    const customData = await this.customFields.validateValues(
      'wms', tenantId, CustomFieldEntity.RECEIPT, dto.customData, { partial: false },
    );
    const number = await this.sequences.nextNumber(tenantId, 'receipt');
    const receipt = await this.prisma.receipt.create({
      data: {
        tenantId,
        number,
        locationId: dto.locationId,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
        status: ReceiptStatus.DRAFT,
        createdById: userId,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'wms-receipt',
      entityId: receipt.id,
      after: { number: receipt.number, locationId: receipt.locationId },
    });
    return receipt;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateReceiptDto) {
    const receipt = await this.prisma.receipt.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (receipt.status !== ReceiptStatus.DRAFT) throw new BadRequestException('Receipt is not editable');

    const customData = await this.customFields.validateValues(
      'wms', tenantId, CustomFieldEntity.RECEIPT, dto.customData, { partial: true },
    );
    const updateRes = await this.prisma.receipt.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });
    if (updateRes.count === 0) throw new NotFoundException('Receipt not found');
    const updated = await this.prisma.receipt.findFirstOrThrow({ where: { id, tenantId } });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'wms-receipt',
      entityId: id,
      after: { reference: updated.reference, note: updated.note },
    });
    return this.get(tenantId, id);
  }

  async addLine(tenantId: string, id: string, dto: AddReceiptLineDto) {
    const receipt = await this.prisma.receipt.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (receipt.status !== ReceiptStatus.DRAFT) throw new BadRequestException('Receipt is not editable');

    const item = await this.prisma.wmsItem.findFirst({ where: { id: dto.itemId, tenantId }, select: { id: true } });
    if (!item) throw new NotFoundException('Item not found');
    const bin = await this.prisma.bin.findFirst({ where: { id: dto.toBinId, tenantId }, select: { id: true } });
    if (!bin) throw new NotFoundException('Bin not found');

    await this.prisma.receiptLine.create({
      data: { tenantId, receiptId: id, itemId: dto.itemId, toBinId: dto.toBinId, qty: dto.qty },
    });
    return this.get(tenantId, id);
  }

  async removeLine(tenantId: string, id: string, lineId: string) {
    const receipt = await this.prisma.receipt.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (receipt.status !== ReceiptStatus.DRAFT) throw new BadRequestException('Receipt is not editable');

    await this.prisma.receiptLine.deleteMany({ where: { id: lineId, tenantId, receiptId: id } });
    return this.get(tenantId, id);
  }

  async post(tenantId: string, userId: string, id: string) {
    const receipt = await this.get(tenantId, id);
    if (!canTransitionReceipt(receipt.status as ReceiptStatus, ReceiptStatus.POSTED)) {
      throw new BadRequestException(`Cannot post a receipt in status ${receipt.status}`);
    }
    if (receipt.lines.length === 0) throw new BadRequestException('Receipt has no lines');

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.receipt.updateMany({
        where: { id, tenantId, status: ReceiptStatus.DRAFT },
        data: { status: ReceiptStatus.POSTED, postedAt: new Date() },
      });
      if (claim.count === 0) throw new ConflictException('Receipt already processed');
      for (const line of receipt.lines) {
        await this.inventory.postMovement(tx, {
          tenantId,
          userId,
          type: StockMovementType.RECEIPT,
          itemId: line.itemId,
          toBinId: line.toBinId,
          qty: Number(line.qty),
          refType: 'receipt',
          refId: id,
        });
      }
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'wms-receipt',
      entityId: id,
      before: { status: ReceiptStatus.DRAFT },
      after: { status: ReceiptStatus.POSTED, lines: receipt.lines.length },
    });
    // Best-effort domain event (rule 27).
    await this.domainEvents.emit(
      tenantId,
      DOMAIN_EVENT_TYPES.WMS_RECEIPT_POSTED,
      { type: 'wms-receipt', id },
      { receiptId: id, number: receipt.number },
    );
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const receipt = await this.prisma.receipt.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (!canTransitionReceipt(receipt.status as ReceiptStatus, ReceiptStatus.CANCELLED)) {
      throw new BadRequestException(`Cannot cancel a receipt in status ${receipt.status}`);
    }
    const claim = await this.prisma.receipt.updateMany({
      where: { id, tenantId, status: ReceiptStatus.DRAFT },
      data: { status: ReceiptStatus.CANCELLED },
    });
    if (claim.count === 0) throw new ConflictException('Receipt already processed');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'wms-receipt',
      entityId: id,
      before: { status: ReceiptStatus.DRAFT },
      after: { status: ReceiptStatus.CANCELLED },
    });
    return this.get(tenantId, id);
  }
}
