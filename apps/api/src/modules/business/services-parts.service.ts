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
import { paginated, paginationArgs } from '../../common/pagination';
import { lockBusinessTenant, nextBusinessVersion } from './business-lock';
import {
  BusinessQueryDto,
  CatalogStockLinkDto,
  ConsumeServicePartDto,
  ReturnServicePartDto,
  ServicePartQueryDto,
} from './business.dto';

const itemSelect = { id: true, sku: true, name: true, unit: true, isActive: true } as const;
const usageSelect = {
  id: true,
  jobId: true,
  catalogItemId: true,
  quantity: true,
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
} as const;
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
    return paginated(
      rows.map((r) => ({
        id: r.binId,
        name: `${r.bin.location.name} / ${r.bin.code}`,
        available: r.qtyOnHand.toString(),
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
    return paginated(items, total, page, pageSize);
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
      const movement = await this.inventory.postMovement(tx, {
        tenantId,
        userId: actor.id,
        type: StockMovementType.PICK,
        itemId: link.wmsItemId,
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
      ...(await this.db.servicePartUsage.findFirstOrThrow({
        where: { tenantId, id: result.id },
        select: usageSelect,
      })),
      replayed: result.replayed,
    };
  }
  async returnPart(actor: AuthUser, jobId: string, id: string, dto: ReturnServicePartDto) {
    await this.requireWms(actor.tenantId);
    const tenantId = actor.tenantId;
    const hash = fingerprint(['return-v1', actor.id, jobId, id, dto.reason, dto.expectedUpdatedAt]);
    const result = await this.locked(tenantId, async (tx) => {
      const row = await tx.servicePartUsage.findFirst({ where: { tenantId, jobId, id } });
      if (!row) throw new NotFoundException('Consommation introuvable.');
      if (row.returnMovementId) {
        if (row.returnOperationKey !== dto.operationKey || row.returnFingerprint !== hash)
          throw new ConflictException('Ces pièces ont déjà été retournées.');
        return { replayed: true };
      }
      if (
        await tx.customerInvoiceLine.count({
          where: { servicePartUsageId: id, customerInvoice: { tenantId } },
        })
      )
        throw new ConflictException(
          'Cette pièce est liée à une facture. Supprimez le brouillon ou faites traiter la correction financière avant son retour.',
        );
      if (
        await tx.servicePartUsage.findFirst({
          where: { tenantId, returnOperationKey: dto.operationKey },
        })
      )
        throw new ConflictException('Cette clé désigne un autre retour.');
      const { job, updatedAt } = await this.job(tx, tenantId, jobId, dto.expectedUpdatedAt);
      const item = await tx.wmsItem.findFirstOrThrow({ where: { tenantId, id: row.wmsItemId } });
      if (item.unit !== row.unitSnapshot)
        throw new ConflictException(
          'L’unité de stock a changé. Faites vérifier le référentiel avant retour.',
        );
      // Full return to original bin; current mapping/catalog activation cannot rewrite history.
      const movement = await this.inventory.postMovement(tx, {
        tenantId,
        userId: actor.id,
        type: StockMovementType.RECEIPT,
        itemId: row.wmsItemId,
        toBinId: row.binId,
        qty: Number(row.quantity),
        refType: 'service-job',
        refId: jobId,
        note: `${job.number} · Retour ${id} · ${dto.reason}`,
      });
      await tx.servicePartUsage.updateMany({
        where: { tenantId, id, returnMovementId: null },
        data: {
          returnMovementId: movement.id,
          returnOperationKey: dto.operationKey,
          returnFingerprint: hash,
          returnReason: dto.reason,
          returnedById: actor.id,
          returnedAt: new Date(),
        },
      });
      await tx.serviceJob.updateMany({
        where: { tenantId, id: jobId, updatedAt: job.updatedAt },
        data: { updatedAt },
      });
      return { replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId,
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: 'service-part',
        entityId: id,
        after: { returned: true, ...dto },
      });
    return {
      ...(await this.db.servicePartUsage.findFirstOrThrow({
        where: { tenantId, jobId, id },
        select: usageSelect,
      })),
      replayed: result.replayed,
    };
  }
}
