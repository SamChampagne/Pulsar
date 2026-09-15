import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AuditAction, StockMovementType, applyToBalance } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { Prisma } from '@pulsar/database';
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
    private readonly ownership: OwnershipService,
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
      locationId?: string;
    },
  ) {
    if (
      !Number.isFinite(args.qty) ||
      args.qty <= 0 ||
      new Prisma.Decimal(args.qty).decimalPlaces() > 3
    )
      throw new BadRequestException('Quantité positive requise, avec au plus trois décimales.');
    // One tenant mutex also covers absent inventory rows and multi-line posting.
    // All stock writers (receipt, pick, count, move, adjustment) use this primitive.
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${args.tenantId} FOR UPDATE`;
    const item = await tx.wmsItem.findFirst({
      where: { id: args.itemId, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!item) throw new BadRequestException('Article introuvable dans cette entreprise.');
    const ids = [...new Set([args.fromBinId, args.toBinId].filter(Boolean))];
    if (!ids.length || (args.fromBinId && args.fromBinId === args.toBinId))
      throw new BadRequestException('Emplacements de mouvement invalides.');
    const bins = await tx.bin.findMany({
      where: { tenantId: args.tenantId, id: { in: ids } },
      select: { id: true, isActive: true, locationId: true },
    });
    if (bins.length !== ids.length)
      throw new BadRequestException('Emplacement introuvable dans cette entreprise.');
    if (args.type !== StockMovementType.ADJUSTMENT && bins.some((b: any) => !b.isActive))
      throw new ConflictException('Un emplacement du mouvement est inactif.');
    if (args.locationId && bins.some((b: any) => b.locationId !== args.locationId))
      throw new BadRequestException('Les emplacements doivent correspondre au site sélectionné.');
    if (args.fromBinId) {
      const cur = await this.readQty(tx, args.tenantId, args.itemId, args.fromBinId);
      const res = applyToBalance(cur, -args.qty);
      if (!res.ok) throw new ConflictException('Insufficient stock in source bin');
      await this.setQty(tx, args.tenantId, args.itemId, args.fromBinId, res.next);
    }
    if (args.toBinId) {
      const cur = await this.readQty(tx, args.tenantId, args.itemId, args.toBinId);
      const res = applyToBalance(cur, args.qty);
      if (!res.ok) throw new ConflictException('Le mouvement laisserait un stock négatif.');
      await this.setQty(tx, args.tenantId, args.itemId, args.toBinId, res.next);
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
    if (dto.fromBinId === dto.toBinId)
      throw new BadRequestException('Source and destination bins must differ');
    await this.ownership.assertOwned('wmsItem', dto.itemId, tenantId);
    await this.ownership.assertOwned('bin', dto.fromBinId, tenantId);
    await this.ownership.assertOwned('bin', dto.toBinId, tenantId);
    await this.ownership.assertOwnedIfSet('location', dto.locationId, tenantId);
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
        locationId: dto.locationId,
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'wms-inventory',
      entityId: dto.itemId,
      after: { move: dto },
    });
  }

  async adjust(tenantId: string, userId: string, dto: AdjustStockDto) {
    if (dto.qtyDelta === 0) throw new BadRequestException('qtyDelta must be non-zero');
    await this.ownership.assertOwned('wmsItem', dto.itemId, tenantId);
    await this.ownership.assertOwned('bin', dto.binId, tenantId);
    await this.prisma.$transaction(async (tx) => {
      await this.postMovement(tx, {
        tenantId,
        userId,
        type: StockMovementType.ADJUSTMENT,
        itemId: dto.itemId,
        fromBinId: dto.qtyDelta < 0 ? dto.binId : undefined,
        toBinId: dto.qtyDelta > 0 ? dto.binId : undefined,
        qty: Math.abs(dto.qtyDelta),
        note: dto.note,
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'wms-inventory',
      entityId: dto.itemId,
      after: { adjust: dto },
    });
  }
}
