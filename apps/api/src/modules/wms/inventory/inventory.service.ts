import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AuditAction, StockMovementType, applyToBalance } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { AdjustStockDto, InventoryListQueryDto, MoveStockDto } from './dto/inventory.dto';

/**
 * The inventory ledger. `postMovement` is the SINGLE place that writes a
 * StockMovement and updates InventoryLevel together — always in the same
 * transaction (never one without the other). ReceivingService / PickingService
 * call it within their own transactions. Outbound legs are availability-checked
 * (409 on short stock via applyToBalance); adjustments never drive a bin
 * negative. Tenant-scoped (rule 1); mutations audited (rule 6).
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /** Read a level qty (0 if absent) within a tx client. qtyOnHand is a Prisma Decimal. */
  private async readQty(tx: any, tenantId: string, itemId: string, binId: string): Promise<number> {
    const lvl = await tx.inventoryLevel.findFirst({ where: { tenantId, itemId, binId } });
    return lvl ? Number(lvl.qtyOnHand) : 0;
  }

  /** Set a level to an absolute qty (upsert) within a tx client. */
  private async setQty(tx: any, tenantId: string, itemId: string, binId: string, qty: number) {
    await tx.inventoryLevel.upsert({
      where: { tenantId_itemId_binId: { tenantId, itemId, binId } },
      create: { tenantId, itemId, binId, qtyOnHand: qty },
      update: { qtyOnHand: qty },
    });
  }

  /**
   * THE single ledger-writing primitive. Call inside a $transaction.
   * Decrements fromBin (availability-checked), increments toBin, writes one StockMovement.
   * Public so ReceivingService / PickingService can call it within their own tx.
   */
  async postMovement(
    tx: any,
    args: {
      tenantId: string;
      userId?: string;
      type: StockMovementType;
      itemId: string;
      fromBinId?: string;
      toBinId?: string;
      qty: number;
      refType?: string;
      refId?: string;
      note?: string;
    },
  ) {
    if (args.fromBinId) {
      const cur = await this.readQty(tx, args.tenantId, args.itemId, args.fromBinId);
      const res = applyToBalance(cur, -args.qty);
      if (!res.ok) throw new ConflictException('Insufficient stock in source bin');
      await this.setQty(tx, args.tenantId, args.itemId, args.fromBinId, res.next);
    }
    if (args.toBinId) {
      const cur = await this.readQty(tx, args.tenantId, args.itemId, args.toBinId);
      await this.setQty(tx, args.tenantId, args.itemId, args.toBinId, cur + args.qty);
    }
    await tx.stockMovement.create({
      data: {
        tenantId: args.tenantId,
        type: args.type,
        itemId: args.itemId,
        fromBinId: args.fromBinId ?? null,
        toBinId: args.toBinId ?? null,
        qty: args.qty,
        refType: args.refType ?? null,
        refId: args.refId ?? null,
        note: args.note ?? null,
        createdById: args.userId ?? null,
      },
    });
  }

  async list(tenantId: string, query: InventoryListQueryDto) {
    const where: any = { tenantId };
    if (query.itemId) where.itemId = query.itemId;
    if (query.binId) where.binId = query.binId;
    if (query.locationId) where.bin = { locationId: query.locationId };
    return this.prisma.inventoryLevel.findMany({
      where,
      orderBy: [{ itemId: 'asc' }],
      take: 500,
      include: {
        item: { select: { id: true, sku: true, name: true, unit: true } },
        bin: { select: { id: true, code: true, kind: true, locationId: true } },
      },
    });
  }

  async move(tenantId: string, userId: string, dto: MoveStockDto) {
    if (dto.fromBinId === dto.toBinId) throw new BadRequestException('Source and destination bins must differ');
    await this.prisma.$transaction(async (tx) => {
      await this.postMovement(tx, {
        tenantId,
        userId,
        type: StockMovementType.MOVE,
        itemId: dto.itemId,
        fromBinId: dto.fromBinId,
        toBinId: dto.toBinId,
        qty: dto.qty,
        note: dto.note,
      });
    });
    await this.audit.log({ tenantId, userId, action: AuditAction.UPDATE, entityType: 'wms-inventory', entityId: dto.itemId, after: { move: dto } });
  }

  async adjust(tenantId: string, userId: string, dto: AdjustStockDto) {
    if (dto.qtyDelta === 0) throw new BadRequestException('qtyDelta must be non-zero');
    await this.prisma.$transaction(async (tx) => {
      const cur = await this.readQty(tx, tenantId, dto.itemId, dto.binId);
      const res = applyToBalance(cur, dto.qtyDelta); // refuses below zero (no override — even adjustments don't go negative)
      if (!res.ok) throw new ConflictException('Adjustment would drive the bin negative');
      await this.setQty(tx, tenantId, dto.itemId, dto.binId, res.next);
      await tx.stockMovement.create({
        data: {
          tenantId,
          type: StockMovementType.ADJUSTMENT,
          itemId: dto.itemId,
          fromBinId: dto.qtyDelta < 0 ? dto.binId : null,
          toBinId: dto.qtyDelta > 0 ? dto.binId : null,
          qty: Math.abs(dto.qtyDelta),
          note: dto.note ?? null,
          createdById: userId,
        },
      });
    });
    await this.audit.log({ tenantId, userId, action: AuditAction.UPDATE, entityType: 'wms-inventory', entityId: dto.itemId, after: { adjust: dto } });
  }
}
