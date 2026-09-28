import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  canTransitionLotDisposition,
  LotDisposition,
  type AuthUser,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { paginationArgs, paginated } from '../../../common/pagination';
import { CreateLotDto, LotQueryDto, HoldLotDto, ReleaseLotDto } from './lots.dto';

const decisionSelect = {
  id: true,
  revision: true,
  fromDisposition: true,
  toDisposition: true,
  reason: true,
  controlNote: true,
  createdAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
} as const;

/** Central intake check. Call under the WMS tenant mutex for mutations. */
export async function assertLot(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemId: string,
  lotId?: string | null,
) {
  const item = await tx.wmsItem.findFirst({
    where: { tenantId, id: itemId },
    select: { lotTracked: true },
  });
  if (!item) throw new BadRequestException('Article introuvable.');
  if (item.lotTracked && !lotId)
    throw new ConflictException(
      'Cet article exige un lot explicite. Utilisez un parcours qui permet de choisir son lot.',
    );
  if (!item.lotTracked && lotId) throw new BadRequestException('Cet article ne suit pas les lots.');
  if (!lotId) return null;
  const lot = await tx.wmsLot.findFirst({ where: { tenantId, itemId, id: lotId } });
  if (!lot)
    throw new BadRequestException('Lot introuvable pour cet article dans cette entreprise.');
  return lot;
}

@Injectable()
export class LotsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly modules: TenantModulesCacheService,
    private readonly ownership: OwnershipService,
  ) {}
  private async qualityAccess(u: AuthUser, required = true) {
    const allowed =
      u.permissions.includes('quality.read') &&
      (await this.modules.getEnabledKeys(u.tenantId)).has('quality');
    if (!allowed && required)
      throw new ForbiddenException(
        'Qualité activée et quality.read requis pour citer ou consulter ce contrôle.',
      );
    return allowed;
  }
  async qualityInspections(u: AuthUser, itemId: string, lotId: string, q: LotQueryDto) {
    await this.qualityAccess(u);
    const lot = await this.get(u.tenantId, itemId, lotId);
    const movementCount = await this.db.stockMovement.count({
      where: { tenantId: u.tenantId, itemId, lotId },
    });
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.QualityInspectionWhereInput = {
      tenantId: u.tenantId,
      lotId,
      lotItemId: itemId,
      ...(q.releaseEligible
        ? {
            status: 'COMPLETED',
            outcome: 'PASS',
            lotDispositionRevision: lot.dispositionRevision,
            lotMovementCount: movementCount,
            ...(lot.disposition !== 'QUARANTINED' ? { id: { in: [] } } : {}),
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: 'insensitive' } },
              { title: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.qualityInspection.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          outcome: true,
          planName: true,
          planRevision: true,
          completedAt: true,
          updatedAt: true,
          lotDispositionRevision: true,
          lotMovementCount: true,
        },
      }),
      this.db.qualityInspection.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({
        ...r,
        name: `${r.number} · ${r.title}`,
        eligibleForRelease:
          lot.disposition === 'QUARANTINED' &&
          r.status === 'COMPLETED' &&
          r.outcome === 'PASS' &&
          r.lotDispositionRevision === lot.dispositionRevision &&
          r.lotMovementCount === movementCount,
      })),
      total,
      page,
      pageSize,
    );
  }
  async affectedPreparations(tenantId: string, itemId: string, lotId: string, q: LotQueryDto) {
    await this.get(tenantId, itemId, lotId);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.PickOrderWhereInput = {
      tenantId,
      status: { in: ['OPEN', 'PICKED'] },
      lines: { some: { tenantId, itemId, lotId } },
    };
    const [rows, total] = await this.db.$transaction([
      this.db.pickOrder.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          number: true,
          status: true,
          location: { select: { name: true } },
          lines: {
            where: { tenantId, itemId, lotId },
            select: { id: true, qty: true, fromBin: { select: { code: true } } },
          },
        },
      }),
      this.db.pickOrder.count({ where }),
    ]);
    return paginated(rows, total, page, pageSize);
  }
  async decisions(u: AuthUser, itemId: string, lotId: string, q: LotQueryDto) {
    const tenantId = u.tenantId;
    const quality = await this.qualityAccess(u, false);
    await this.get(tenantId, itemId, lotId);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where = { tenantId, itemId, lotId };
    const [rows, total] = await this.db.$transaction([
      this.db.wmsLotDecision.findMany({
        where,
        skip,
        take,
        orderBy: { revision: 'desc' },
        select: { ...decisionSelect, ...(quality ? { qualitySnapshot: true } : {}) },
      }),
      this.db.wmsLotDecision.count({ where }),
    ]);
    return paginated(rows, total, page, pageSize);
  }
  async decide(
    u: AuthUser,
    itemId: string,
    lotId: string,
    to: LotDisposition,
    dto: HoldLotDto | ReleaseLotDto,
  ) {
    const controlNote = 'controlNote' in dto ? dto.controlNote : null;
    const reference =
      'qualityInspectionId' in dto && dto.qualityInspectionId
        ? { id: dto.qualityInspectionId, expectedUpdatedAt: dto.expectedInspectionUpdatedAt! }
        : null;
    if (reference) {
      if (to !== LotDisposition.UNRESTRICTED)
        throw new BadRequestException('Un contrôle ne peut justifier qu’une libération.');
      await this.qualityAccess(u);
    }
    if (to === LotDisposition.UNRESTRICTED && (!controlNote || controlNote.trim().length < 10))
      throw new BadRequestException('Documentez le contrôle réalisé avant de libérer le lot.');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          u.tenantId,
          u.id,
          itemId,
          lotId,
          to,
          dto.expectedRevision,
          dto.reason,
          controlNote,
          ...(reference ? [reference] : []),
        ]),
      )
      .digest('hex');
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${u.tenantId} FOR UPDATE`;
      const previous = await tx.wmsLotDecision.findFirst({
        where: { tenantId: u.tenantId, operationKey: dto.operationKey },
      });
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ConflictException('Cette clé correspond à une autre décision.');
        return { decisionId: previous.id, revision: previous.revision, replayed: true };
      }
      const lot = await tx.wmsLot.findFirst({ where: { tenantId: u.tenantId, itemId, id: lotId } });
      if (!lot) throw new NotFoundException('Lot introuvable.');
      if (lot.dispositionRevision !== dto.expectedRevision)
        throw new ConflictException(
          'La situation de ce lot a changé. Relisez sa fiche et son historique.',
        );
      if (!canTransitionLotDisposition(lot.disposition as LotDisposition, to))
        throw new ConflictException('Cette transition de quarantaine est impossible.');
      let qualitySnapshot: Prisma.InputJsonValue | undefined;
      if (reference) {
        await this.ownership.assertOwned('qualityInspection', reference.id, u.tenantId, tx);
        const inspection = await tx.qualityInspection.findFirst({
          where: { tenantId: u.tenantId, id: reference.id, lotId, lotItemId: itemId },
        });
        if (!inspection)
          throw new NotFoundException('Contrôle introuvable pour ce lot dans cette entreprise.');
        const count = await tx.stockMovement.count({
          where: { tenantId: u.tenantId, itemId, lotId },
        });
        if (
          inspection.status !== 'COMPLETED' ||
          inspection.outcome !== 'PASS' ||
          inspection.updatedAt.toISOString() !==
            new Date(reference.expectedUpdatedAt).toISOString() ||
          inspection.lotDispositionRevision !== lot.dispositionRevision ||
          inspection.lotMovementCount !== count
        )
          throw new ConflictException(
            'Contrôle non conforme, non terminé ou périmé pour cette quarantaine. Préparez un nouveau contrôle si le lot ou ses mouvements ont changé.',
          );
        qualitySnapshot = {
          id: inspection.id,
          number: inspection.number,
          title: inspection.title,
          planName: inspection.planName,
          planRevision: inspection.planRevision,
          outcome: inspection.outcome,
          completedAt: inspection.completedAt!.toISOString(),
          updatedAt: inspection.updatedAt.toISOString(),
          lotDispositionRevision: inspection.lotDispositionRevision!,
          lotMovementCount: count,
        };
      }
      const revision = lot.dispositionRevision + 1;
      const decision = await tx.wmsLotDecision.create({
        data: {
          tenantId: u.tenantId,
          itemId,
          lotId,
          revision,
          fromDisposition: lot.disposition,
          toDisposition: to,
          reason: dto.reason,
          controlNote,
          operationKey: dto.operationKey,
          fingerprint,
          createdById: u.id,
          ...(reference ? { qualityInspectionId: reference.id, qualitySnapshot } : {}),
        },
      });
      await tx.wmsLot.update({
        where: { tenantId_itemId_id: { tenantId: u.tenantId, itemId, id: lotId } },
        data: { disposition: to, dispositionRevision: revision, dispositionReason: dto.reason },
      });
      return { decisionId: decision.id, revision, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'wms-lot',
        entityId: lotId,
        action: AuditAction.UPDATE,
        after: {
          decisionId: result.decisionId,
          revision: result.revision,
          disposition: to,
          reason: dto.reason,
        },
      });
    return result;
  }
  private async item(tenantId: string, id: string) {
    const item = await this.db.wmsItem.findFirst({ where: { tenantId, id } });
    if (!item) throw new NotFoundException('Article introuvable.');
    return item;
  }
  async list(tenantId: string, itemId: string, q: LotQueryDto) {
    const item = await this.item(tenantId, itemId);
    if (q.binId && !(await this.db.bin.findFirst({ where: { tenantId, id: q.binId } })))
      throw new NotFoundException('Emplacement introuvable.');
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.WmsLotWhereInput = {
      tenantId,
      itemId,
      ...(q.lotId ? { id: q.lotId } : {}),
      ...(q.search ? { code: { contains: q.search, mode: 'insensitive' } } : {}),
      ...(q.binId
        ? { balances: { some: { tenantId, binId: q.binId, qtyOnHand: { gt: 0 } } } }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.wmsLot.findMany({
        where,
        skip,
        take,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        include: {
          balances: {
            where: { tenantId, ...(q.binId ? { binId: q.binId } : {}) },
            select: { binId: true, qtyOnHand: true },
          },
        },
      }),
      this.db.wmsLot.count({ where }),
    ]);
    return {
      ...paginated(
        rows.map((l) => ({
          ...l,
          name: `${l.code}${l.disposition === 'QUARANTINED' ? ' · Quarantaine' : ''}`,
          qtyOnHand: l.balances
            .reduce((n, b) => n.plus(b.qtyOnHand), new Prisma.Decimal(0))
            .toString(),
        })),
        total,
        page,
        pageSize,
      ),
      lotTracked: item.lotTracked,
      unit: item.unit,
    };
  }
  async get(tenantId: string, itemId: string, id: string) {
    await this.item(tenantId, itemId);
    const lot = await this.db.wmsLot.findFirst({
      where: { tenantId, itemId, id },
      include: {
        balances: {
          where: { tenantId },
          include: { bin: { select: { id: true, code: true, locationId: true } } },
        },
      },
    });
    if (!lot) throw new NotFoundException('Lot introuvable.');
    return { ...lot, name: lot.code };
  }
  async create(tenantId: string, itemId: string, d: CreateLotDto) {
    if (d.manufacturedOn && d.expiresOn && d.expiresOn < d.manufacturedOn)
      throw new BadRequestException('La péremption doit suivre la fabrication.');
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        const item = await tx.wmsItem.findFirst({ where: { tenantId, id: itemId } });
        if (!item) throw new NotFoundException('Article introuvable.');
        if (!item.lotTracked || !item.isActive)
          throw new ConflictException('Choisissez un article actif suivi par lot.');
        return tx.wmsLot.create({
          data: {
            tenantId,
            itemId,
            code: d.code,
            supplierLot: d.supplierLot,
            manufacturedOn: d.manufacturedOn ? new Date(d.manufacturedOn) : null,
            expiresOn: d.expiresOn ? new Date(d.expiresOn) : null,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException(
          'Ce lot existe déjà pour cet article. Relisez le registre avant toute nouvelle saisie.',
        );
      throw e;
    }
  }
}
