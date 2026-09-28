import { withLotAvailability } from '../wms/lots/lot-availability';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { AuditAction, AuthUser, StockMovementType } from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { InventoryService } from '../wms/inventory/inventory.service';
import { assertLot } from '../wms/lots/lots.service';
import { paginated, paginationArgs } from '../../common/pagination';
import { lockBusinessTenant, nextBusinessVersion } from './business-lock';
import {
  BusinessQueryDto,
  CatalogStockLinkDto,
  ConsumeServicePartDto,
  ReturnServicePartDto,
  ServicePartQueryDto,
} from './business.dto';

const itemSelect = {
  id: true,
  sku: true,
  name: true,
  unit: true,
  isActive: true,
  lotTracked: true,
} as const;
const usageSelect = {
  lotId: true,
  lotSnapshot: true,
  id: true,
  jobId: true,
  catalogItemId: true,
  quantity: true,
  returnedQuantity: true,
  updatedAt: true,
  billingLine: {
    select: {
      id: true,
      credits: {
        where: { creditNote: { status: 'ISSUED' } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          quantity: true,
          creditNote: { select: { number: true } },
          stockReturns: { select: { quantity: true } },
        },
      },
    },
  },
  _count: { select: { returns: true } },
  returns: {
    take: 5,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      quantity: true,
      reason: true,
      createdAt: true,
      createdById: true,
      movementId: true,
    },
  },
  nameSnapshot: true,
  codeSnapshot: true,
  unitSnapshot: true,
  binSnapshot: true,
  note: true,
  createdAt: true,
  createdById: true,
  movementId: true,
  returnMovementId: true,
  returnedAt: true,
  returnReason: true,
  returnedById: true,
} satisfies Prisma.ServicePartUsageSelect;
function presentUsage(row: Prisma.ServicePartUsageGetPayload<{ select: typeof usageSelect }>) {
  const { billingLine, _count, ...usage } = row;
  return {
    ...usage,
    creditReturnOptions: (billingLine?.credits ?? [])
      .map((c) => ({
        id: c.id,
        number: c.creditNote.number,
        available: c.quantity
          .minus(c.stockReturns.reduce((sum, r) => sum.plus(r.quantity), new Prisma.Decimal(0)))
          .toString(),
      }))
      .filter((c) => Number(c.available) > 0),
    remainingQuantity: row.quantity.minus(row.returnedQuantity).toString(),
    billingLocked: !!billingLine,
    returnCount: _count.returns,
  };
}
const fingerprint = (body: unknown) =>
  createHash('sha256').update(JSON.stringify(body)).digest('hex');

@Injectable()
export class ServicesPartsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
    private readonly inventory: InventoryService,
  ) {}

  async requireWms(tenantId: string) {
    if (!(await this.modules.getEnabledKeys(tenantId)).has('wms'))
      throw new ForbiddenException('Activez Entrepôt pour utiliser cette connexion au stock.');
  }
  private async locked<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      // Fixed order: business mutex, then the shared WMS tenant row. Never the reverse.
      await lockBusinessTenant(tx, tenantId);
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      return fn(tx);
    });
  }
  async link(tenantId: string, id: string) {
    await this.requireWms(tenantId);
    const item = await this.db.catalogItem.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        updatedAt: true,
        stockLink: { select: { wmsItem: { select: itemSelect } } },
      },
    });
    if (!item) throw new NotFoundException('Article introuvable.');
    return item;
  }
  async setLink(tenantId: string, id: string, dto: CatalogStockLinkDto) {
    await this.requireWms(tenantId);
    await this.locked(tenantId, async (tx) => {
      const item = await tx.catalogItem.findFirst({ where: { tenantId, id } });
      if (!item) throw new NotFoundException('Article introuvable.');
      const updatedAt = nextBusinessVersion(item, dto.expectedUpdatedAt);
      if (dto.wmsItemId) {
        await this.ownership.assertOwned('wmsItem', dto.wmsItemId, tenantId, tx);
        const wms = await tx.wmsItem.findFirstOrThrow({ where: { tenantId, id: dto.wmsItemId } });
        if (!item.active || item.kind !== 'GOODS' || !wms.isActive || item.unit !== wms.unit)
          throw new BadRequestException(
            'Reliez un produit actif à un article WMS actif de même unité exacte. Aucune conversion automatique.',
          );
        const used = await tx.catalogStockLink.findFirst({
          where: { tenantId, wmsItemId: wms.id, catalogItemId: { not: id } },
        });
        if (used)
          throw new ConflictException(
            'Cet article WMS est déjà relié à un autre produit du Catalogue.',
          );
        await tx.catalogStockLink.upsert({
          where: { tenantId_catalogItemId: { tenantId, catalogItemId: id } },
          create: { tenantId, catalogItemId: id, wmsItemId: wms.id },
          update: { wmsItemId: wms.id },
        });
      } else await tx.catalogStockLink.deleteMany({ where: { tenantId, catalogItemId: id } });
      await tx.catalogItem.updateMany({
        where: { tenantId, id, updatedAt: item.updatedAt },
        data: { updatedAt },
      });
    });
    return this.link(tenantId, id);
  }
  async products(tenantId: string, q: BusinessQueryDto) {
    await this.requireWms(tenantId);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.CatalogItemWhereInput = {
      tenantId,
      active: true,
      kind: 'GOODS',
      stockLink: { is: { tenantId, wmsItem: { tenantId, isActive: true } } },
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { code: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.catalogItem.findMany({
        where,
        skip,
        take,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, code: true, name: true, unit: true },
      }),
      this.db.catalogItem.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async bins(tenantId: string, q: ServicePartQueryDto) {
    await this.requireWms(tenantId);
    if (!q.catalogItemId) throw new BadRequestException('Choisissez un produit relié au WMS.');
    const link = await this.db.catalogStockLink.findFirst({
      where: {
        tenantId,
        catalogItemId: q.catalogItemId,
        catalogItem: { active: true },
        wmsItem: { isActive: true },
      },
    });
    const { page, pageSize, skip, take } = paginationArgs(q);
    if (!link) return paginated([], 0, page, pageSize);
    const where: Prisma.InventoryLevelWhereInput = {
      tenantId,
      itemId: link.wmsItemId,
      qtyOnHand: { gt: 0 },
      bin: {
        tenantId,
        isActive: true,
        location: { tenantId, type: 'WAREHOUSE' },
        ...(q.search
          ? {
              OR: [
                { code: { contains: q.search, mode: 'insensitive' } },
                { location: { name: { contains: q.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
    };
    const [rows, total] = await this.db.$transaction([
      this.db.inventoryLevel.findMany({
        where,
        skip,
        take,
        orderBy: { binId: 'asc' },
        include: { bin: { include: { location: { select: { name: true } } } } },
      }),
      this.db.inventoryLevel.count({ where }),
    ]);
    const available = await withLotAvailability(this.db, tenantId, rows);
    return paginated(
      available.map((r) => ({
        id: r.binId,
        name: `${r.bin.location.name} / ${r.bin.code}`,
        available: r.availableQty,
        physical: r.qtyOnHand.toString(),
        quarantined: r.quarantinedQty,
      })),
      total,
      page,
      pageSize,
    );
  }
  async list(tenantId: string, jobId: string, q: BusinessQueryDto) {
    if (
      !(await this.db.serviceJob.findFirst({
        where: { tenantId, id: jobId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Intervention introuvable.');
    // Historical snapshots are Services data, even after WMS is disabled.
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where = { tenantId, jobId };
    const [items, total] = await this.db.$transaction([
      this.db.servicePartUsage.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: usageSelect,
      }),
      this.db.servicePartUsage.count({ where }),
    ]);
    return paginated(items.map(presentUsage), total, page, pageSize);
  }
  private async job(tx: Prisma.TransactionClient, tenantId: string, id: string, expected: string) {
    const job = await tx.serviceJob.findFirst({
      where: { tenantId, id },
      include: { project: true },
    });
    if (!job) throw new NotFoundException('Intervention introuvable.');
    const updatedAt = nextBusinessVersion(job, expected);
    if (job.project.status !== 'ACTIVE')
      throw new ConflictException('Le projet fermé fige les pièces.');
    return { job, updatedAt };
  }
  async consume(actor: AuthUser, jobId: string, dto: ConsumeServicePartDto) {
    await this.requireWms(actor.tenantId);
    const tenantId = actor.tenantId;
    const hash = fingerprint([
      'consume-v1',
      actor.id,
      jobId,
      dto.catalogItemId,
      dto.binId,
      new Prisma.Decimal(dto.quantity).toString(),
      dto.note,
      dto.expectedUpdatedAt,
      // Preserve the exact fingerprint of existing no-lot requests.
      ...(dto.lotId ? [{ lotId: dto.lotId }] : []),
    ]);
    const result = await this.locked(tenantId, async (tx) => {
      const previous = await tx.servicePartUsage.findFirst({
        where: { tenantId, operationKey: dto.operationKey },
      });
      if (previous) {
        if (previous.requestFingerprint !== hash)
          throw new ConflictException('Cette clé désigne une autre consommation.');
        return { id: previous.id, replayed: true };
      }
      const { job, updatedAt } = await this.job(tx, tenantId, jobId, dto.expectedUpdatedAt);
      if (job.status !== 'IN_PROGRESS')
        throw new ConflictException('Démarrez l’intervention avant de consommer des pièces.');
      await this.ownership.assertOwned('catalogItem', dto.catalogItemId, tenantId, tx);
      await this.ownership.assertOwned('bin', dto.binId, tenantId, tx);
      const link = await tx.catalogStockLink.findFirst({
        where: { tenantId, catalogItemId: dto.catalogItemId },
        include: { catalogItem: true, wmsItem: true },
      });
      if (
        !link ||
        !link.catalogItem.active ||
        !link.wmsItem.isActive ||
        link.catalogItem.kind !== 'GOODS' ||
        link.catalogItem.unit !== link.wmsItem.unit
      )
        throw new ConflictException(
          'Produit non relié, inactif ou unité incompatible. Vérifiez Catalogue et WMS.',
        );
      const bin = await tx.bin.findFirstOrThrow({
        where: { tenantId, id: dto.binId },
        include: { location: true },
      });
      if (!bin.isActive || bin.location.type !== 'WAREHOUSE' || bin.location.tenantId !== tenantId)
        throw new ConflictException('Choisissez un emplacement actif dans un entrepôt.');
      const lot = await assertLot(tx, tenantId, link.wmsItemId, dto.lotId);
      const movement = await this.inventory.postMovement(tx, {
        tenantId,
        userId: actor.id,
        type: StockMovementType.PICK,
        itemId: link.wmsItemId,
        lotId: lot?.id,
        fromBinId: bin.id,
        locationId: bin.locationId,
        qty: dto.quantity,
        refType: 'service-job',
        refId: jobId,
        note: `${job.number} · ${dto.note}`,
      });
      const usage = await tx.servicePartUsage.create({
        data: {
          tenantId,
          jobId,
          catalogItemId: dto.catalogItemId,
          wmsItemId: link.wmsItemId,
          lotId: lot?.id,
          ...(lot
            ? {
                lotSnapshot: {
                  code: lot.code,
                  supplierLot: lot.supplierLot,
                  manufacturedOn: lot.manufacturedOn?.toISOString().slice(0, 10) ?? null,
                  expiresOn: lot.expiresOn?.toISOString().slice(0, 10) ?? null,
                },
              }
            : {}),
          binId: bin.id,
          quantity: dto.quantity,
          nameSnapshot: link.catalogItem.name,
          codeSnapshot: link.catalogItem.code,
          unitSnapshot: link.wmsItem.unit,
          binSnapshot: `${bin.location.name} / ${bin.code}`,
          note: dto.note,
          createdById: actor.id,
          operationKey: dto.operationKey,
          requestFingerprint: hash,
          movementId: movement.id,
        },
      });
      await tx.serviceJob.updateMany({
        where: { tenantId, id: jobId, updatedAt: job.updatedAt },
        data: { updatedAt },
      });
      return { id: usage.id, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId,
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: 'service-part',
        entityId: result.id,
        after: { jobId, ...dto },
      });
    return {
      ...presentUsage(
        await this.db.servicePartUsage.findFirstOrThrow({
          where: { tenantId, id: result.id },
          select: usageSelect,
        }),
      ),
      replayed: result.replayed,
    };
  }
  async returnPart(actor: AuthUser, jobId: string, id: string, dto: ReturnServicePartDto) {
    await this.requireWms(actor.tenantId);
    const tenantId = actor.tenantId;
    const hash = fingerprint(
      dto.creditLineId
        ? [
            'return-credit-v1',
            actor.id,
            jobId,
            id,
            dto.creditLineId,
            dto.quantity,
            dto.reason,
            dto.expectedUpdatedAt,
          ]
        : dto.quantity === undefined
          ? ['return-v1', actor.id, jobId, id, dto.reason, dto.expectedUpdatedAt]
          : [
              'return-v2',
              actor.id,
              jobId,
              id,
              new Prisma.Decimal(dto.quantity).toString(),
              dto.reason,
              dto.expectedUpdatedAt,
            ],
    );
    const result = await this.locked(tenantId, async (tx) => {
      // Replay before mutable job, billing and stock checks, including migrated v1 returns.
      const previous = await tx.servicePartReturn.findFirst({
        where: { tenantId, operationKey: dto.operationKey },
      });
      if (previous) {
        if (previous.usageId !== id || previous.requestFingerprint !== hash)
          throw new ConflictException('Cette clé désigne un autre retour.');
        return { replayed: true, returnId: previous.id };
      }
      const row = await tx.servicePartUsage.findFirst({ where: { tenantId, jobId, id } });
      if (!row) throw new NotFoundException('Consommation introuvable.');
      const quantity = new Prisma.Decimal(dto.quantity ?? row.quantity);
      const remaining = row.quantity.minus(row.returnedQuantity);
      if (
        !quantity.isFinite() ||
        quantity.lte(0) ||
        quantity.decimalPlaces() > 3 ||
        quantity.gt(remaining)
      )
        throw new ConflictException(
          `Quantité de retour invalide. Restant : ${remaining.toString()} ${row.unitSnapshot}.`,
        );
      const billingLine = await tx.customerInvoiceLine.findFirst({
        where: { servicePartUsageId: id, customerInvoice: { tenantId } },
      });
      if (billingLine) {
        if (!dto.creditLineId || dto.quantity === undefined)
          throw new ConflictException(
            'Pièce facturée : validez un avoir sur cette ligne avant le retour, ou supprimez la facture si elle est encore brouillon.',
          );
        await this.ownership.assertOwned('customerCreditLine', dto.creditLineId, tenantId, tx);
        const credit = await tx.customerCreditLine.findFirst({
          where: {
            tenantId,
            id: dto.creditLineId,
            invoiceLineId: billingLine.id,
            creditNote: { tenantId, status: 'ISSUED' },
          },
          include: { stockReturns: { where: { tenantId }, select: { quantity: true } } },
        });
        if (!credit)
          throw new ConflictException('Avoir validé correspondant à cette pièce requis.');
        const used = credit.stockReturns.reduce(
          (s, r) => s.plus(r.quantity),
          new Prisma.Decimal(0),
        );
        if (quantity.gt(credit.quantity.minus(used)))
          throw new ConflictException('Le retour dépasse la quantité autorisée par cet avoir.');
      } else if (dto.creditLineId)
        throw new ConflictException('Cette consommation ne correspond pas à un avoir.');
      const { job, updatedAt } = await this.job(tx, tenantId, jobId, dto.expectedUpdatedAt);
      const item = await tx.wmsItem.findFirstOrThrow({ where: { tenantId, id: row.wmsItemId } });
      if (item.unit !== row.unitSnapshot)
        throw new ConflictException(
          'L’unité de stock a changé. Faites vérifier le référentiel avant retour.',
        );
      if (row.lotId) {
        // A physical return follows the original issue, never a current catalog mapping.
        const source = await tx.stockMovement.findFirst({
          where: { tenantId, id: row.movementId },
        });
        if (
          !row.lotSnapshot ||
          !source ||
          source.type !== StockMovementType.PICK ||
          source.itemId !== row.wmsItemId ||
          source.lotId !== row.lotId ||
          source.fromBinId !== row.binId ||
          !source.qty.eq(row.quantity) ||
          source.unitSnapshot !== row.unitSnapshot
        )
          throw new ConflictException(
            'La preuve de sortie du lot est incohérente. Faites vérifier le dossier avant retour.',
          );
      }
      // Return to the original bin; current mapping/catalog activation cannot rewrite history.
      const movement = await this.inventory.postMovement(tx, {
        tenantId,
        userId: actor.id,
        type: StockMovementType.RECEIPT,
        itemId: row.wmsItemId,
        lotId: row.lotId,
        toBinId: row.binId,
        qty: quantity.toNumber(),
        refType: 'service-job',
        refId: jobId,
        note: `${job.number} · Retour ${id} · ${dto.reason}`,
      });
      const entry = await tx.servicePartReturn.create({
        data: {
          tenantId,
          usageId: id,
          quantity,
          movementId: movement.id,
          operationKey: dto.operationKey,
          requestFingerprint: hash,
          reason: dto.reason,
          createdById: actor.id,
          creditLineId: dto.creditLineId,
        },
      });
      await tx.servicePartUsage.updateMany({
        where: { tenantId, id, updatedAt: row.updatedAt },
        data: {
          returnedQuantity: row.returnedQuantity.plus(quantity),
          updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)),
        },
      });
      await tx.serviceJob.updateMany({
        where: { tenantId, id: jobId, updatedAt: job.updatedAt },
        data: { updatedAt },
      });
      return { replayed: false, returnId: entry.id };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId,
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: 'service-part',
        entityId: id,
        after: { returnId: result.returnId, ...dto },
      });
    return {
      ...presentUsage(
        await this.db.servicePartUsage.findFirstOrThrow({
          where: { tenantId, jobId, id },
          select: usageSelect,
        }),
      ),
      replayed: result.replayed,
      returnId: result.returnId,
    };
  }
}
