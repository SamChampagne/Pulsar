import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CustomFieldEntity,
  DOMAIN_EVENT_TYPES,
  ReceiptStatus,
  StockMovementType,
  canTransitionReceipt,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  assertWmsLine,
  lockWmsDocument,
  nextWmsVersion,
  readWmsDocument,
} from '../document-operations';
import {
  AddReceiptLineDto,
  CreateReceiptDto,
  ReceiptListQueryDto,
  UpdateReceiptDto,
} from './dto/receipt.dto';

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
    return this.prisma.$transaction((tx) => readWmsDocument(tx, tenantId, 'receipt', id), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  async create(tenantId: string, userId: string, dto: CreateReceiptDto) {
    const loc = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId },
      select: { id: true, type: true },
    });
    if (!loc) throw new NotFoundException('Location not found');
    if (loc.type !== 'WAREHOUSE')
      throw new BadRequestException('Receipt requires a WAREHOUSE location');

    const customData = await this.customFields.validateValues(
      'wms',
      tenantId,
      CustomFieldEntity.RECEIPT,
      dto.customData,
      { partial: false },
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
    await this.prisma.$transaction(async (tx) => {
      const receipt = await lockWmsDocument(tx, tenantId, 'receipt', id, dto.expectedUpdatedAt);
      if (receipt.status !== ReceiptStatus.DRAFT)
        throw new ConflictException('Cette réception n’est plus modifiable.');
      const customData = await this.customFields.validateValues(
        'wms',
        tenantId,
        CustomFieldEntity.RECEIPT,
        dto.customData,
        { partial: true },
      );
      const updateRes = await tx.receipt.updateMany({
        where: { id, tenantId, status: ReceiptStatus.DRAFT },
        data: {
          updatedAt: nextWmsVersion(receipt.updatedAt),
          ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
        },
      });
      if (updateRes.count === 0) throw new NotFoundException('Receipt not found');
    });
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
    return this.writeLine(tenantId, id, dto);
  }

  async updateLine(tenantId: string, id: string, lineId: string, dto: AddReceiptLineDto) {
    return this.writeLine(tenantId, id, dto, lineId);
  }

  private async writeLine(tenantId: string, id: string, dto: AddReceiptLineDto, lineId?: string) {
    await this.ownership.assertOwned('wmsItem', dto.itemId, tenantId);
    await this.ownership.assertOwned('bin', dto.toBinId, tenantId);
    await this.prisma.$transaction(async (tx) => {
      const doc = await lockWmsDocument(tx, tenantId, 'receipt', id, dto.expectedUpdatedAt);
      if (doc.status !== 'DRAFT') throw new ConflictException('Ce document n’est plus modifiable.');
      await assertWmsLine(tx, tenantId, doc.locationId, dto.itemId, dto.toBinId, dto.qty);
      const data = { itemId: dto.itemId, toBinId: dto.toBinId, qty: dto.qty };
      if (lineId) {
        const result = await tx.receiptLine.updateMany({
          where: { id: lineId, tenantId, receiptId: id },
          data,
        });
        if (!result.count) throw new NotFoundException('Ligne introuvable dans ce document.');
      } else {
        await tx.receiptLine.create({ data: { ...data, tenantId, receiptId: id } });
      }
      await tx.receipt.updateMany({
        where: { id, tenantId, status: 'DRAFT' },
        data: { updatedAt: nextWmsVersion(doc.updatedAt) },
      });
    });
    return this.get(tenantId, id);
  }

  async removeLine(tenantId: string, id: string, lineId: string, expectedUpdatedAt?: string) {
    await this.prisma.$transaction(async (tx) => {
      const doc = await lockWmsDocument(tx, tenantId, 'receipt', id, expectedUpdatedAt);
      if (doc.status !== 'DRAFT') throw new ConflictException('Ce document n’est plus modifiable.');
      const result = await tx.receiptLine.deleteMany({
        where: { id: lineId, tenantId, receiptId: id },
      });
      if (!result.count) throw new NotFoundException('Ligne introuvable dans ce document.');
      await tx.receipt.updateMany({
        where: { id, tenantId, status: 'DRAFT' },
        data: { updatedAt: nextWmsVersion(doc.updatedAt) },
      });
    });
    return this.get(tenantId, id);
  }

  async post(tenantId: string, userId: string, id: string, expectedUpdatedAt?: string) {
    const receipt = await this.prisma.$transaction((tx) =>
      this.postInTransaction(tx, tenantId, userId, id, expectedUpdatedAt),
    );
    await this.afterPost(tenantId, userId, receipt);
    return this.get(tenantId, id);
  }

  /** Upstream workflows must also honor required WMS receipt custom fields. */
  validateCreateFields(tenantId: string, data?: Record<string, unknown>) {
    return this.customFields.validateValues('wms', tenantId, CustomFieldEntity.RECEIPT, data, {
      partial: false,
    });
  }

  /** Shared writer for a receipt and its upstream supplier allocation in one transaction. */
  async postInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    id: string,
    expectedUpdatedAt?: string,
  ) {
    await lockWmsDocument(tx, tenantId, 'receipt', id, expectedUpdatedAt);
    const receipt = await tx.receipt.findFirstOrThrow({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!canTransitionReceipt(receipt.status as ReceiptStatus, ReceiptStatus.POSTED)) {
      throw new BadRequestException(`Cannot post a receipt in status ${receipt.status}`);
    }
    if (receipt.lines.length === 0) throw new BadRequestException('Receipt has no lines');
    for (const line of receipt.lines) {
      await assertWmsLine(
        tx,
        tenantId,
        receipt.locationId,
        line.itemId,
        line.toBinId,
        Number(line.qty),
      );
    }
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
        locationId: receipt.locationId,
        refType: 'receipt',
        refId: id,
      });
    }
    return receipt;
  }

  async afterPost(
    tenantId: string,
    userId: string,
    receipt: { id: string; number: string; lines: unknown[] },
  ) {
    const id = receipt.id;
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
  }

  async cancel(tenantId: string, userId: string, id: string, expectedUpdatedAt?: string) {
    const receipt = await this.prisma.$transaction(async (tx) => {
      const receipt = await lockWmsDocument(tx, tenantId, 'receipt', id, expectedUpdatedAt);
      if (!canTransitionReceipt(receipt.status as ReceiptStatus, ReceiptStatus.CANCELLED)) {
        throw new BadRequestException(`Cannot cancel a receipt in status ${receipt.status}`);
      }
      const claim = await tx.receipt.updateMany({
        where: { id, tenantId, status: ReceiptStatus.DRAFT },
        data: { status: ReceiptStatus.CANCELLED },
      });
      if (claim.count === 0) throw new ConflictException('Receipt already processed');
      return receipt;
    });
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
