import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WmsStockExit } from '@pulsar/database';
import {
  AuditAction,
  type AuthUser,
  StockExitKind,
  StockExitStatus,
  StockMovementType,
  canTransitionStockExit,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import {
  lockBusinessTenant,
  nextBusinessVersion,
  assertServicePerson,
} from '../../business/business-lock';
import { InventoryService } from '../inventory/inventory.service';
import { assertLot } from '../lots/lots.service';
import { StockExitPurchasesService } from './stock-exit-purchases.service';
import { paginationArgs, paginated } from '../../../common/pagination';
import {
  StockExitCreateDto,
  StockExitPostDto,
  StockExitCancelDto,
  StockExitQueryDto,
  StockExitSourcesDto,
} from './stock-exits.dto';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const person = { firstName: true, lastName: true } as const;
const viewSelect = {
  id: true,
  number: true,
  kind: true,
  status: true,
  itemId: true,
  lotId: true,
  binId: true,
  quantity: true,
  unitSnapshot: true,
  reason: true,
  supplierId: true,
  reference: true,
  destination: true,
  snapshot: true,
  evidence: true,
  completionNote: true,
  cancellationReason: true,
  movementId: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
  createdBy: { select: person },
  closedBy: { select: person },
} as const;
@Injectable()
export class StockExitsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditLogsService,
    private readonly purchases: StockExitPurchasesService,
  ) {}
  private async lock(tx: Prisma.TransactionClient, tenantId: string) {
    await lockBusinessTenant(tx, tenantId); // Supplier identity writers use the same lock, always before WMS.
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
  }
  private async find(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const d = await tx.wmsStockExit.findFirst({ where: { tenantId, id } });
    if (!d) throw new NotFoundException('Dossier de sortie introuvable.');
    return d;
  }
  private requirePost(u: AuthUser, kind: StockExitKind) {
    const key = kind === StockExitKind.DISPOSAL ? 'wms.stock.dispose' : 'wms.stock.return';
    if (!u.permissions.includes(key))
      throw new ForbiddenException(`Droit ${key} requis pour confirmer cette sortie.`);
  }
  async list(u: AuthUser, q: StockExitQueryDto) {
    const tenantId = u.tenantId;
    if (q.purchaseOrderId) await this.purchases.requireRead(u);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.WmsStockExitWhereInput = {
      tenantId,
      ...(q.purchaseOrderId
        ? { purchaseSource: { tenantId, orderLine: { tenantId, orderId: q.purchaseOrderId } } }
        : {}),
      ...(q.lotId ? { lotId: q.lotId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search?.trim()
        ? {
            OR: [
              { number: { contains: q.search.trim().slice(0, 120), mode: 'insensitive' } },
              { reason: { contains: q.search.trim().slice(0, 120), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.db.$transaction(
      async (tx) =>
        paginated(
          await tx.wmsStockExit.findMany({
            where,
            skip,
            take,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: viewSelect,
          }),
          await tx.wmsStockExit.count({ where }),
          page,
          pageSize,
        ),
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async get(tenantId: string, id: string) {
    const d = await this.db.wmsStockExit.findFirst({ where: { tenantId, id }, select: viewSelect });
    if (!d) throw new NotFoundException('Dossier de sortie introuvable.');
    return d;
  }
  async sources(tenantId: string, q: StockExitSourcesDto) {
    const lot = await this.db.wmsLot.findFirst({
      where: { tenantId, id: q.lotId, itemId: q.itemId },
      select: { item: { select: { unit: true } } },
    });
    if (!lot) throw new NotFoundException('Lot introuvable.');
    const { page, pageSize, skip, take } = paginationArgs(q);
    const search = q.search?.trim().slice(0, 120);
    const where: Prisma.WmsLotBalanceWhereInput = {
      tenantId,
      itemId: q.itemId,
      lotId: q.lotId,
      qtyOnHand: { gt: 0 },
      bin: {
        tenantId,
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { location: { tenantId, name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
    };
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.wmsLotBalance.findMany({
          where,
          skip,
          take,
          orderBy: { binId: 'asc' },
          select: {
            qtyOnHand: true,
            bin: {
              select: {
                id: true,
                code: true,
                isActive: true,
                location: { select: { name: true } },
              },
            },
          },
        });
        return paginated(
          rows.map((r) => ({
            id: r.bin.id,
            name: `${r.bin.code} · ${r.bin.location.name} · ${r.qtyOnHand.toFixed()} ${lot.item.unit}${r.bin.isActive ? '' : ' · Inactif'}`,
          })),
          await tx.wmsLotBalance.count({ where }),
          page,
          pageSize,
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async create(u: AuthUser, d: StockExitCreateDto) {
    if (d.purchaseSourceId || d.purchaseSourceToken) await this.purchases.requireRead(u);
    if (new Prisma.Decimal(d.quantity).lte(0) || d.reason.trim().length < 3)
      throw new BadRequestException('Quantité positive et motif explicite requis.');
    const returning = d.kind === StockExitKind.SUPPLIER_RETURN;
    if (
      returning
        ? !d.supplierId ||
          (d.reference?.trim().length ?? 0) < 3 ||
          (d.destination?.trim().length ?? 0) < 10
        : d.supplierId !== undefined || d.reference !== undefined || d.destination !== undefined
    )
      throw new BadRequestException(
        'Le retour exige fournisseur, référence et destination; ces champs ne concernent pas la destruction.',
      );
    const fingerprint = hash([
      'stock-exit-create-v1',
      u.id,
      d.kind,
      d.itemId,
      d.lotId,
      d.binId,
      new Prisma.Decimal(d.quantity).toFixed(),
      d.reason,
      d.supplierId ?? null,
      d.reference ?? null,
      d.destination ?? null,
      ...(d.purchaseSourceId || d.purchaseSourceToken
        ? [{ purchaseSourceId: d.purchaseSourceId, purchaseSourceToken: d.purchaseSourceToken }]
        : []),
    ]);
    const r = await this.db.$transaction(async (tx) => {
      await this.lock(tx, u.tenantId);
      const previous = await tx.wmsStockExit.findFirst({
        where: { tenantId: u.tenantId, operationKey: d.operationKey },
      });
      if (previous) {
        if (previous.requestFingerprint !== fingerprint)
          throw new ConflictException('Clé déjà utilisée pour une autre préparation.');
        return { id: previous.id, replayed: true };
      }
      for (const [entity, id] of [
        ['wmsItem', d.itemId],
        ['wmsLot', d.lotId],
        ['bin', d.binId],
      ] as const)
        await this.ownership.assertOwned(entity, id, u.tenantId, tx);
      if (d.supplierId)
        await this.ownership.assertOwned('businessPartner', d.supplierId, u.tenantId, tx);
      const lot = await assertLot(tx, u.tenantId, d.itemId, d.lotId);
      const item = await tx.wmsItem.findFirstOrThrow({
        where: { tenantId: u.tenantId, id: d.itemId },
      });
      const bin = await tx.bin.findFirstOrThrow({
        where: { tenantId: u.tenantId, id: d.binId },
        include: { location: true },
      });
      if (!item.isActive || !bin.isActive || bin.location.tenantId !== u.tenantId)
        throw new ConflictException('Article et emplacement actifs de cette entreprise requis.');
      const supplier = d.supplierId
        ? await tx.businessPartner.findFirst({
            where: { tenantId: u.tenantId, id: d.supplierId, isSupplier: true, active: true },
            select: { id: true, code: true, name: true, updatedAt: true },
          })
        : null;
      if (returning && !supplier) throw new BadRequestException('Fournisseur actif requis.');
      const purchaseSnapshot = await this.purchases.capture(tx, u, d, bin.locationId, item.unit);
      const row = await tx.wmsStockExit.create({
        data: {
          tenantId: u.tenantId,
          number: await this.sequences.nextNumber(u.tenantId, 'stock-exit', tx),
          purchaseSourceId: d.purchaseSourceId,
          purchaseSnapshot: purchaseSnapshot ?? undefined,
          kind: d.kind,
          itemId: d.itemId,
          lotId: d.lotId,
          binId: d.binId,
          quantity: d.quantity,
          unitSnapshot: item.unit,
          reason: d.reason,
          supplierId: d.supplierId,
          reference: d.reference,
          destination: d.destination,
          operationKey: d.operationKey,
          requestFingerprint: fingerprint,
          createdById: u.id,
          snapshot: {
            item: { sku: item.sku, name: item.name },
            lot: { id: lot!.id, code: lot!.code, supplierLot: lot!.supplierLot },
            bin: { code: bin.code, locationId: bin.locationId, locationName: bin.location.name },
            supplier: supplier
              ? { ...supplier, updatedAt: supplier.updatedAt.toISOString() }
              : null,
          },
        },
      });
      return { id: row.id, replayed: false };
    });
    if (!r.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'wms-stock-exit',
        entityId: r.id,
        action: AuditAction.CREATE,
        after: { kind: d.kind, status: 'DRAFT' },
      });
    return r;
  }
  private async assess(tx: Prisma.TransactionClient, d: WmsStockExit, u: AuthUser) {
    const purchaseToken = await this.purchases.verify(tx, u, d);
    const where = { tenantId: d.tenantId, itemId: d.itemId, lotId: d.lotId };
    const [lot, item, bin, balance, movementCount, supplier] = await Promise.all([
      tx.wmsLot.findFirst({ where: { tenantId: d.tenantId, itemId: d.itemId, id: d.lotId } }),
      tx.wmsItem.findFirst({ where: { tenantId: d.tenantId, id: d.itemId } }),
      tx.bin.findFirst({ where: { tenantId: d.tenantId, id: d.binId } }),
      tx.wmsLotBalance.findFirst({ where: { ...where, binId: d.binId } }),
      tx.stockMovement.count({ where }),
      d.supplierId
        ? tx.businessPartner.findFirst({
            where: { tenantId: d.tenantId, id: d.supplierId },
            select: { active: true, isSupplier: true, updatedAt: true },
          })
        : null,
    ]);
    const snap = d.snapshot as any,
      blockedReasons: string[] = [];
    const onHand = new Prisma.Decimal(balance?.qtyOnHand ?? 0);
    if (d.status !== 'DRAFT')
      blockedReasons.push('Dossier déjà fermé; aucune nouvelle sortie possible.');
    if (!item?.isActive || item.unit !== d.unitSnapshot)
      blockedReasons.push('Article inactif ou unité modifiée depuis la préparation.');
    if (!bin?.isActive || bin.locationId !== snap.bin.locationId)
      blockedReasons.push('Emplacement inactif ou contexte de site incohérent.');
    if (!lot) blockedReasons.push('Lot introuvable.');
    if (onHand.lt(d.quantity))
      blockedReasons.push(
        'Stock insuffisant dans ce lot et cet emplacement; aucun autre lot ne sera prélevé.',
      );
    if (
      d.supplierId &&
      (!supplier?.active ||
        !supplier.isSupplier ||
        supplier.updatedAt.toISOString() !== snap.supplier?.updatedAt)
    )
      blockedReasons.push(
        'Le fournisseur a changé ou est inactif. Annulez et préparez un nouveau dossier après vérification.',
      );
    const context = {
      expectedUpdatedAt: d.updatedAt.toISOString(),
      blockedReasons,
      quantity: d.quantity.toFixed(),
      onHand: onHand.toFixed(),
      remaining: onHand.minus(d.quantity).toFixed(),
      unit: d.unitSnapshot,
      disposition: lot?.disposition ?? 'UNKNOWN',
      dispositionRevision: lot?.dispositionRevision ?? -1,
      movementCount,
    };
    return {
      ...context,
      reviewToken: hash([
        'stock-exit-review-v1',
        d.tenantId,
        d.id,
        d.snapshot,
        d.kind,
        d.reason,
        d.reference,
        d.destination,
        context,
        ...(purchaseToken ? [{ purchaseToken }] : []),
      ]),
    };
  }
  async review(u: AuthUser, id: string) {
    return this.db.$transaction(
      async (tx) => this.assess(tx, await this.find(tx, u.tenantId, id), u),
      {
        isolationLevel: 'RepeatableRead',
      },
    );
  }
  async post(u: AuthUser, id: string, d: StockExitPostDto) {
    if (d.completionNote.trim().length < 10)
      throw new BadRequestException('Compte rendu de sortie physique requis.');
    const fingerprint = hash([
      'stock-exit-post-v1',
      u.id,
      id,
      d.expectedUpdatedAt,
      d.reviewToken,
      d.completionNote,
      d.confirmed,
    ]);
    const r = await this.db.$transaction(async (tx) => {
      await this.lock(tx, u.tenantId);
      const row = await this.find(tx, u.tenantId, id);
      this.requirePost(u, row.kind as StockExitKind);
      if (row.purchaseSourceId) await this.purchases.requireRead(u);
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id); // No service account or agent execution.
      if (row.resolutionKey) {
        if (
          row.status === 'POSTED' &&
          row.resolutionKey === d.operationKey &&
          row.resolutionFingerprint === fingerprint
        )
          return { id: row.id, movementId: row.movementId, replayed: true };
        throw new ConflictException('Dossier déjà fermé ou autre demande de clôture.');
      }
      if (!canTransitionStockExit(row.status as StockExitStatus, StockExitStatus.POSTED))
        throw new ConflictException('Transition impossible.');
      const updatedAt = nextBusinessVersion(row, d.expectedUpdatedAt),
        review = await this.assess(tx, row, u);
      if (review.blockedReasons.length)
        throw new ConflictException(review.blockedReasons.join(' '));
      if (review.reviewToken !== d.reviewToken)
        throw new ConflictException(
          'Le contexte de stock a changé. Relisez les effets avant confirmation.',
        );
      const duplicate = await tx.wmsStockExit.findFirst({
        where: { tenantId: u.tenantId, resolutionKey: d.operationKey },
      });
      if (duplicate) throw new ConflictException('Cette clé de clôture est déjà utilisée.');
      const movement = await this.inventory.postMovement(tx, {
        tenantId: u.tenantId,
        userId: u.id,
        type: row.kind as unknown as StockMovementType,
        itemId: row.itemId,
        lotId: row.lotId,
        fromBinId: row.binId,
        qty: row.quantity.toNumber(),
        refType: 'stock-exit',
        refId: row.id,
        note: row.reason,
        locationId: (row.snapshot as any).bin.locationId,
      });
      const changed = await tx.wmsStockExit.updateMany({
        where: { tenantId: u.tenantId, id, status: 'DRAFT', updatedAt: row.updatedAt },
        data: {
          status: 'POSTED',
          updatedAt,
          closedAt: updatedAt,
          closedById: u.id,
          resolutionKey: d.operationKey,
          resolutionFingerprint: fingerprint,
          completionNote: d.completionNote,
          movementId: movement.id,
          evidence: {
            version: 1,
            review,
            movementId: movement.id,
            confirmed: true,
            recordedAt: updatedAt.toISOString(),
          },
        },
      });
      if (changed.count !== 1) throw new ConflictException('Dossier modifié simultanément.');
      return { id: row.id, movementId: movement.id, replayed: false };
    });
    if (!r.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'wms-stock-exit',
        entityId: id,
        action: AuditAction.UPDATE,
        before: { status: 'DRAFT' },
        after: { status: 'POSTED', movementId: r.movementId, completionNote: d.completionNote },
      });
    return r;
  }
  async cancel(u: AuthUser, id: string, d: StockExitCancelDto) {
    if (d.reason.trim().length < 3) throw new BadRequestException('Motif d’annulation requis.');
    const fingerprint = hash(['stock-exit-cancel-v1', u.id, id, d.expectedUpdatedAt, d.reason]);
    const r = await this.db.$transaction(async (tx) => {
      await this.lock(tx, u.tenantId);
      const row = await this.find(tx, u.tenantId, id);
      if (row.resolutionKey) {
        if (
          row.status === 'CANCELLED' &&
          row.resolutionKey === d.operationKey &&
          row.resolutionFingerprint === fingerprint
        )
          return { id, replayed: true };
        throw new ConflictException('Dossier déjà fermé ou autre demande.');
      }
      if (!canTransitionStockExit(row.status as StockExitStatus, StockExitStatus.CANCELLED))
        throw new ConflictException('Transition impossible.');
      const updatedAt = nextBusinessVersion(row, d.expectedUpdatedAt);
      if (
        await tx.wmsStockExit.count({
          where: { tenantId: u.tenantId, resolutionKey: d.operationKey },
        })
      )
        throw new ConflictException('Clé de clôture déjà utilisée.');
      const changed = await tx.wmsStockExit.updateMany({
        where: { tenantId: u.tenantId, id, status: 'DRAFT', updatedAt: row.updatedAt },
        data: {
          status: 'CANCELLED',
          updatedAt,
          closedAt: updatedAt,
          closedById: u.id,
          resolutionKey: d.operationKey,
          resolutionFingerprint: fingerprint,
          cancellationReason: d.reason,
        },
      });
      if (changed.count !== 1) throw new ConflictException('Dossier modifié simultanément.');
      return { id, replayed: false };
    });
    if (!r.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'wms-stock-exit',
        entityId: id,
        action: AuditAction.UPDATE,
        before: { status: 'DRAFT' },
        after: { status: 'CANCELLED', reason: d.reason },
      });
    return r;
  }
}
