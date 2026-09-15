import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  canTransitionMaterialPurchase,
  MaterialPurchaseStatus,
  materialPurchaseSubtotal,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { MrpService } from '../mrp/mrp.service';
import { ReceivingService } from '../../wms/receiving/receiving.service';
import { assertMaterialReceipt } from '../../wms/receiving/material-purchase-receipt';
import { nextWmsVersion } from '../../wms/document-operations';
import { artifactHash } from '../scheduling/aps-artifact';
import { paginated, paginationArgs } from '../../../common/pagination';
import {
  SupplierDto,
  CreatePurchaseDto,
  UpdatePurchaseDto,
  ConfirmPurchaseDto,
  PurchaseReceiptDto,
  PurchaseListDto,
  PurchaseVersionDto,
} from './material-purchases.dto';

const supplierSelect = {
  id: true,
  code: true,
  name: true,
  email: true,
  terms: true,
  isActive: true,
  updatedAt: true,
} as const;
const preparationSelect = {
  id: true,
  number: true,
  runId: true,
  proposalId: true,
  itemId: true,
  locationId: true,
  quantity: true,
  unitSnapshot: true,
  dueDate: true,
  status: true,
  updatedAt: true,
  item: { select: { sku: true, name: true } },
  location: { select: { code: true, name: true } },
  purchaseOrder: { select: { id: true, number: true, status: true } },
} as const;

@Injectable()
export class MaterialPurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
    private readonly mrp: MrpService,
    private readonly receiving: ReceivingService,
  ) {}

  private async gate(tenantId: string) {
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has('manufacturing') || !enabled.has('wms'))
      throw new ForbiddenException('Fabrication et WMS requis.');
  }
  private version(current: Date, expected: string | undefined) {
    if (!expected || current.getTime() !== new Date(expected).getTime())
      throw new ConflictException('Le dossier a changé. Rechargez avant de confirmer.');
  }
  private async locked<T>(tenantId: string, action: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        return action(tx);
      },
      { timeout: 20000 },
    );
  }
  private async accessPreparation(tenantId: string, id: string, permissions: readonly string[]) {
    const prep = await this.prisma.mrpPreparation.findFirst({
      where: { tenantId, id, method: 'BUY' },
      select: preparationSelect,
    });
    if (!prep) throw new NotFoundException('Demande d’achat introuvable.');
    await this.mrp.assertRunAccess(tenantId, prep.runId, permissions);
    return prep;
  }
  private async access(tenantId: string, id: string, permissions: readonly string[]) {
    await this.gate(tenantId);
    const order = await this.prisma.materialPurchaseOrder.findFirst({
      where: { id, tenantId },
      select: { preparationId: true },
    });
    if (!order) throw new NotFoundException('Commande matières introuvable.');
    await this.accessPreparation(tenantId, order.preparationId, permissions);
  }
  async suppliers(tenantId: string, query: PurchaseListDto) {
    await this.gate(tenantId);
    const { skip, take, page, pageSize } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' as const } },
              { name: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.materialSupplier.findMany({
        where,
        select: supplierSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.materialSupplier.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async saveSupplier(tenantId: string, id: string | null, dto: SupplierDto) {
    await this.gate(tenantId);
    if (!dto.name.trim()) throw new BadRequestException('Nom requis.');
    return this.locked(tenantId, async (tx) => {
      const existing = id ? await tx.materialSupplier.findFirst({ where: { tenantId, id } }) : null;
      if (id && !existing) throw new NotFoundException('Fournisseur introuvable.');
      if (existing) this.version(existing.updatedAt, dto.expectedUpdatedAt);
      const code = dto.code.toUpperCase();
      if (
        await tx.materialSupplier.count({
          where: { tenantId, code, ...(id ? { id: { not: id } } : {}) },
        })
      )
        throw new ConflictException('Code fournisseur déjà utilisé.');
      const data = {
        code,
        name: dto.name.trim(),
        email: dto.email ?? null,
        terms: dto.terms ?? null,
        isActive: dto.isActive ?? true,
      };
      return existing
        ? tx.materialSupplier.update({
            where: { id: existing.id, tenantId },
            data: { ...data, updatedAt: nextWmsVersion(existing.updatedAt) },
            select: supplierSelect,
          })
        : tx.materialSupplier.create({ data: { tenantId, ...data }, select: supplierSelect });
    });
  }
  async requests(tenantId: string, permissions: readonly string[], query: PurchaseListDto) {
    await this.gate(tenantId);
    const { skip, take, page, pageSize } = paginationArgs(query);
    const where = {
      tenantId,
      method: 'BUY' as const,
      ...(query.locationId ? { locationId: query.locationId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mrpPreparation.findMany({
        where,
        select: preparationSelect,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.mrpPreparation.count({ where }),
    ]);
    // Fail closed if a page includes CRM-backed calculations the caller cannot read.
    for (const runId of new Set(items.map((p) => p.runId)))
      await this.mrp.assertRunAccess(tenantId, runId, permissions);
    return paginated(items, total, page, pageSize);
  }
  async preparation(tenantId: string, id: string, permissions: readonly string[]) {
    return this.accessPreparation(tenantId, id, permissions);
  }
  async get(tenantId: string, id: string, permissions: readonly string[]) {
    await this.access(tenantId, id, permissions);
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.materialPurchaseOrder.findFirstOrThrow({
          where: { tenantId, id },
          include: {
            preparation: { select: preparationSelect },
            receipts: {
              where: { tenantId },
              orderBy: { createdAt: 'asc' },
              include: { receipt: { include: { lines: { where: { tenantId } } } } },
            },
          },
        });
        const received = order.receipts
          .filter((r) => r.receipt.status === 'POSTED')
          .reduce(
            (sum, r) =>
              sum.plus(
                r.receipt.lines
                  .filter((l) => l.itemId === order.preparation.itemId)
                  .reduce((s, l) => s.plus(l.qty), new Prisma.Decimal(0)),
              ),
            new Prisma.Decimal(0),
          );
        const remaining = Prisma.Decimal.max(0, order.preparation.quantity.minus(received));
        return {
          id: order.id,
          number: order.number,
          status: order.status,
          preparation: order.preparation,
          supplierId: order.supplierId,
          supplier: order.supplierSnapshot,
          unitPrice: order.unitPrice.toFixed(),
          currency: order.currency,
          subtotal: materialPurchaseSubtotal(
            order.preparation.quantity.toFixed(),
            order.unitPrice.toFixed(),
          ),
          expectedDate: order.expectedDate,
          terms: order.terms,
          supplierReference: order.supplierReference,
          confirmedAt: order.confirmedAt,
          updatedAt: order.updatedAt,
          received: received.toFixed(),
          remaining: remaining.toFixed(),
          fulfillment: received.isZero() ? 'NONE' : remaining.isZero() ? 'FULL' : 'PARTIAL',
          receipts: order.receipts.map((r) => ({
            id: r.receipt.id,
            number: r.receipt.number,
            status: r.receipt.status,
            postedAt: r.receipt.postedAt,
            quantity: r.receipt.lines
              .filter((l) => l.itemId === order.preparation.itemId)
              .reduce((s, l) => s.plus(l.qty), new Prisma.Decimal(0))
              .toFixed(),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private async terms(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: UpdatePurchaseDto | CreatePurchaseDto,
  ) {
    const supplier = await tx.materialSupplier.findFirst({
      where: { tenantId, id: dto.supplierId, isActive: true },
      select: supplierSelect,
    });
    if (!supplier) throw new BadRequestException('Choisir un fournisseur actif.');
    const price = new Prisma.Decimal(dto.unitPrice);
    if (price.lt(0) || price.gt(1e9) || price.decimalPlaces() > 6)
      throw new BadRequestException('Prix invalide.');
    return {
      supplierId: supplier.id,
      supplierSnapshot: { code: supplier.code, name: supplier.name, email: supplier.email },
      unitPrice: price,
      currency: dto.currency,
      expectedDate: new Date(dto.expectedDate),
      terms: dto.terms ?? supplier.terms,
    };
  }
  async create(
    tenantId: string,
    userId: string,
    permissions: readonly string[],
    dto: CreatePurchaseDto,
  ) {
    await this.accessPreparation(tenantId, dto.preparationId, permissions);
    await this.ownership.assertOwned('mrpPreparation', dto.preparationId, tenantId);
    await this.ownership.assertOwned('materialSupplier', dto.supplierId, tenantId);
    const fingerprint = artifactHash({ userId, ...dto });
    const result = await this.locked(tenantId, async (tx) => {
      const replay = await tx.materialPurchaseOrder.findFirst({
        where: { tenantId, operationKey: dto.operationKey },
      });
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw new ConflictException('Clé utilisée pour une autre demande.');
        return { id: replay.id, created: false };
      }
      const prep = await tx.mrpPreparation.findFirstOrThrow({
        where: { tenantId, id: dto.preparationId },
        include: { item: true, location: true, purchaseOrder: true },
      });
      this.version(prep.updatedAt, dto.expectedUpdatedAt);
      if (
        prep.method !== 'BUY' ||
        prep.status !== 'DRAFT' ||
        prep.purchaseOrder ||
        !prep.item.isActive ||
        !prep.location.isActive ||
        prep.unitSnapshot !== prep.item.unit
      )
        throw new ConflictException('Demande inactive, incompatible ou déjà convertie.');
      const order = await tx.materialPurchaseOrder.create({
        data: {
          tenantId,
          preparationId: prep.id,
          ...(await this.terms(tx, tenantId, dto)),
          number: await this.sequences.nextNumber(tenantId, 'material-purchase', tx),
          operationKey: dto.operationKey,
          fingerprint,
          createdById: userId,
        },
      });
      await tx.mrpPreparation.update({
        where: { id: prep.id, tenantId },
        data: { updatedAt: nextWmsVersion(prep.updatedAt) },
      });
      return { id: order.id, created: true };
    });
    if (result.created)
      await this.audit.log({
        tenantId,
        userId,
        entityType: 'material-purchase',
        entityId: result.id,
        action: AuditAction.CREATE,
        after: { preparationId: dto.preparationId, status: 'DRAFT' },
      });
    return this.get(tenantId, result.id, permissions);
  }
  async update(
    tenantId: string,
    userId: string,
    id: string,
    permissions: readonly string[],
    dto: UpdatePurchaseDto,
  ) {
    await this.access(tenantId, id, permissions);
    await this.ownership.assertOwned('materialSupplier', dto.supplierId, tenantId);
    await this.locked(tenantId, async (tx) => {
      const order = await tx.materialPurchaseOrder.findFirstOrThrow({ where: { tenantId, id } });
      this.version(order.updatedAt, dto.expectedUpdatedAt);
      if (order.status !== 'DRAFT')
        throw new ConflictException('Seul un brouillon peut être modifié.');
      await tx.materialPurchaseOrder.update({
        where: { id, tenantId },
        data: {
          ...(await this.terms(tx, tenantId, dto)),
          updatedAt: nextWmsVersion(order.updatedAt),
        },
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      entityType: 'material-purchase',
      entityId: id,
      action: AuditAction.UPDATE,
      after: {
        supplierId: dto.supplierId,
        unitPrice: dto.unitPrice,
        currency: dto.currency,
        expectedDate: dto.expectedDate,
      },
    });
    return this.get(tenantId, id, permissions);
  }
  async transition(
    tenantId: string,
    userId: string,
    id: string,
    permissions: readonly string[],
    target: MaterialPurchaseStatus,
    dto: ConfirmPurchaseDto | PurchaseVersionDto,
  ) {
    await this.access(tenantId, id, permissions);
    const before = await this.locked(tenantId, async (tx) => {
      const order = await tx.materialPurchaseOrder.findFirstOrThrow({
        where: { tenantId, id },
        include: { preparation: { include: { item: true, location: true } }, supplier: true },
      });
      this.version(order.updatedAt, dto.expectedUpdatedAt);
      if (!canTransitionMaterialPurchase(order.status as MaterialPurchaseStatus, target))
        throw new ConflictException('Transition indisponible.');
      const supplierReference = 'supplierReference' in dto ? dto.supplierReference.trim() : '';
      if (
        target === MaterialPurchaseStatus.CONFIRMED &&
        (!supplierReference ||
          !order.supplier.isActive ||
          order.preparation.status !== 'DRAFT' ||
          !order.preparation.item.isActive ||
          !order.preparation.location.isActive ||
          order.preparation.unitSnapshot !== order.preparation.item.unit)
      )
        throw new ConflictException('Référence fournisseur et contexte matières actifs requis.');
      if (
        target === MaterialPurchaseStatus.CANCELLED &&
        (await tx.materialPurchaseReceipt.count({
          where: {
            tenantId,
            purchaseOrderId: id,
            receipt: { tenantId, status: { not: 'CANCELLED' } },
          },
        }))
      )
        throw new ConflictException(
          'Annulez les réceptions brouillon avant la commande. Une réception validée interdit l’annulation.',
        );
      await tx.materialPurchaseOrder.updateMany({
        where: { tenantId, id, status: order.status, updatedAt: order.updatedAt },
        data: {
          status: target,
          updatedAt: nextWmsVersion(order.updatedAt),
          ...(target === MaterialPurchaseStatus.CONFIRMED
            ? { confirmedAt: new Date(), supplierReference }
            : {}),
        },
      });
      return order.status;
    });
    await this.audit.log({
      tenantId,
      userId,
      entityType: 'material-purchase',
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      before: { status: before },
      after: {
        status: target,
        ...('supplierReference' in dto ? { supplierReference: dto.supplierReference } : {}),
      },
    });
    return this.get(tenantId, id, permissions);
  }
  async receive(
    tenantId: string,
    userId: string,
    id: string,
    permissions: readonly string[],
    dto: PurchaseReceiptDto,
  ) {
    await this.access(tenantId, id, permissions);
    await this.ownership.assertOwned('bin', dto.toBinId, tenantId);
    const fingerprint = artifactHash({ userId, purchaseOrderId: id, ...dto });
    const result = await this.locked(tenantId, async (tx) => {
      const replay = await tx.materialPurchaseReceipt.findFirst({
        where: { tenantId, operationKey: dto.operationKey },
      });
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw new ConflictException('Clé utilisée pour une autre réception.');
        return { id: replay.receiptId, created: false };
      }
      const order = await tx.materialPurchaseOrder.findFirstOrThrow({
        where: { tenantId, id },
        include: { preparation: true },
      });
      this.version(order.updatedAt, dto.expectedUpdatedAt);
      if (order.status !== 'CONFIRMED')
        throw new ConflictException('Confirmer la commande avant de recevoir.');
      const quantity = new Prisma.Decimal(dto.quantity);
      if (
        quantity.lte(0) ||
        quantity.gt(order.preparation.quantity) ||
        quantity.decimalPlaces() > 3
      )
        throw new BadRequestException('Quantité de réception invalide.');
      const receipt = await this.receiving.createPurchaseDraft(tx, tenantId, userId, {
        locationId: order.preparation.locationId,
        itemId: order.preparation.itemId,
        toBinId: dto.toBinId,
        quantity: dto.quantity,
        reference: order.number,
      });
      await tx.materialPurchaseReceipt.create({
        data: {
          tenantId,
          purchaseOrderId: id,
          receiptId: receipt.id,
          operationKey: dto.operationKey,
          fingerprint,
        },
      });
      await assertMaterialReceipt(tx, tenantId, receipt, [
        { itemId: order.preparation.itemId, qty: quantity },
      ]);
      // Version advances on receipt creation; posting rechecks cumulative quantities under the same mutex.
      await tx.materialPurchaseOrder.update({
        where: { tenantId, id },
        data: { updatedAt: nextWmsVersion(order.updatedAt) },
      });
      return { id: receipt.id, created: true };
    });
    if (result.created)
      await this.audit.log({
        tenantId,
        userId,
        entityType: 'wms-receipt',
        entityId: result.id,
        action: AuditAction.CREATE,
        after: { purchaseOrderId: id, quantity: dto.quantity, status: 'DRAFT' },
      });
    return { receiptId: result.id };
  }
}
