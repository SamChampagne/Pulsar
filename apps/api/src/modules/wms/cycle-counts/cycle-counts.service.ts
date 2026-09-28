import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CycleCountStatus,
  StockMovementType,
  canTransitionCycleCount,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { InventoryService } from '../inventory/inventory.service';
import { nextWmsVersion } from '../document-operations';
import {
  CreateCycleCountDto,
  CycleCountListQueryDto,
  RecordCountsDto,
  CountActionDto,
} from './dto/cycle-count.dto';

const detail = {
  bin: { select: { code: true } },
  lines: {
    include: {
      item: { select: { sku: true, name: true, unit: true, lotTracked: true } },
      lot: { select: { id: true, code: true, expiresOn: true } },
    },
    orderBy: [{ itemId: 'asc' }, { lotId: 'asc' }],
  },
} satisfies Prisma.CycleCountInclude;
type Count = Prisma.CycleCountGetPayload<{ include: typeof detail }>;

/** No reservation or stock freeze. Writers take the shared tenant mutex before
 * reading state. The append-only ledger watermark catches even net-zero changes. */
@Injectable()
export class CycleCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly inventory: InventoryService,
    private readonly domainEvents: DomainEventsService,
  ) {}
  private async locked<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      return fn(tx);
    });
  }
  private async read(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const count = await tx.cycleCount.findFirst({ where: { tenantId, id }, include: detail });
    if (!count) throw new NotFoundException('Comptage introuvable.');
    return count;
  }
  private ledgerCount(tx: Prisma.TransactionClient, tenantId: string, binId: string) {
    return tx.stockMovement.count({
      where: { tenantId, OR: [{ fromBinId: binId }, { toBinId: binId }] },
    });
  }
  private async freshness(tx: Prisma.TransactionClient, count: Count) {
    if (count.stockMovementCount === null || count.lines.some((l) => l.unitSnapshot === null))
      return {
        valid: false,
        reason:
          'Comptage historique sans instantané sécurisé. Annulez-le et démarrez un nouveau comptage.',
      };
    if (count.lines.some((l) => l.unitSnapshot !== l.item.unit || l.item.lotTracked !== !!l.lotId))
      return {
        valid: false,
        reason: 'Une unité ou le suivi d’un article a changé. Démarrez un nouveau comptage.',
      };
    if ((await this.ledgerCount(tx, count.tenantId, count.binId)) !== count.stockMovementCount)
      return {
        valid: false,
        reason:
          'Le stock de cet emplacement a bougé depuis le démarrage. Annulez ce comptage et recomptez sur un nouvel instantané.',
      };
    return { valid: true, reason: null };
  }
  private async assertFresh(tx: Prisma.TransactionClient, count: Count) {
    const check = await this.freshness(tx, count);
    if (!check.valid) throw new ConflictException(check.reason!);
  }
  private assertVersion(count: Count, dto: CountActionDto) {
    if (
      dto.expectedUpdatedAt &&
      new Date(dto.expectedUpdatedAt).getTime() !== count.updatedAt.getTime()
    )
      throw new ConflictException('Le comptage a changé. Rouvrez le dossier avant de continuer.');
  }
  async list(tenantId: string, q: CycleCountListQueryDto) {
    return this.prisma.cycleCount.findMany({
      where: {
        tenantId,
        ...(q.status ? { status: q.status as CycleCountStatus } : {}),
        ...(q.binId ? { binId: q.binId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { bin: { select: { code: true } }, _count: { select: { lines: true } } },
    });
  }
  async get(tenantId: string, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const count = await this.read(tx, tenantId, id);
        const freshness = ['OPEN', 'COUNTED'].includes(count.status)
          ? await this.freshness(tx, count)
          : null;
        return { ...count, freshness };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async create(tenantId: string, userId: string, dto: CreateCycleCountDto) {
    const count = await this.locked(tenantId, async (tx) => {
      const bin = await tx.bin.findFirst({ where: { tenantId, id: dto.binId } });
      if (!bin) throw new NotFoundException('Emplacement introuvable.');
      if (!bin.isActive) throw new ConflictException('Cet emplacement est inactif.');
      const levels = await tx.inventoryLevel.findMany({
        where: { tenantId, binId: bin.id },
        include: { item: { select: { unit: true, lotTracked: true } } },
      });
      const lots = await tx.wmsLotBalance.findMany({
        where: { tenantId, binId: bin.id },
        include: { lot: { include: { item: { select: { unit: true } } } } },
      });
      if (lots.some((l) => !levels.some((v) => v.itemId === l.itemId && v.item.lotTracked)))
        throw new ConflictException(
          'Stock par lot sans solde agrégé cohérent. Faites vérifier le registre.',
        );
      for (const level of levels.filter((l) => l.item.lotTracked)) {
        const sum = lots
          .filter((l) => l.itemId === level.itemId)
          .reduce((n, l) => n.plus(l.qtyOnHand), new Prisma.Decimal(0));
        if (!sum.eq(level.qtyOnHand))
          throw new ConflictException(
            'Stock par lot incohérent. Faites vérifier le registre avant de compter.',
          );
      }
      const lines = [
        ...levels
          .filter((l) => !l.item.lotTracked)
          .map((l) => ({
            tenantId,
            itemId: l.itemId,
            lotId: null,
            unitSnapshot: l.item.unit,
            systemQty: l.qtyOnHand,
          })),
        ...lots.map((l) => ({
          tenantId,
          itemId: l.itemId,
          lotId: l.lotId,
          unitSnapshot: l.lot.item.unit,
          systemQty: l.qtyOnHand,
        })),
      ];
      if (!lines.length)
        throw new ConflictException(
          'Aucun stock connu dans cet emplacement. Un article ou lot trouvé doit d’abord être identifié et ajusté explicitement.',
        );
      return tx.cycleCount.create({
        data: {
          tenantId,
          number: await this.sequences.nextNumber(tenantId, 'cycle-count', tx),
          binId: bin.id,
          status: CycleCountStatus.OPEN,
          note: dto.note ?? null,
          createdById: userId,
          stockMovementCount: await this.ledgerCount(tx, tenantId, bin.id),
          lines: { create: lines },
        },
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'wms-cycle-count',
      entityId: count.id,
      after: { number: count.number, binId: count.binId },
    });
    return this.get(tenantId, count.id);
  }
  async recordCounts(tenantId: string, userId: string, id: string, dto: RecordCountsDto) {
    await this.locked(tenantId, async (tx) => {
      const count = await this.read(tx, tenantId, id);
      this.assertVersion(count, dto);
      if (!canTransitionCycleCount(count.status as CycleCountStatus, CycleCountStatus.COUNTED))
        throw new BadRequestException('Seul un comptage ouvert accepte une saisie.');
      await this.assertFresh(tx, count);
      const ids = dto.counts.map((c) => c.lineId);
      if (
        !ids.length ||
        new Set(ids).size !== ids.length ||
        ids.length !== count.lines.length ||
        count.lines.some((l) => !ids.includes(l.id))
      )
        throw new BadRequestException(
          'Comptez chaque ligne une seule fois, y compris les quantités zéro. Une case vide ne signifie pas zéro.',
        );
      for (const c of dto.counts) {
        if (
          !Number.isFinite(c.countedQty) ||
          c.countedQty < 0 ||
          new Prisma.Decimal(c.countedQty).decimalPlaces() > 3 ||
          c.countedQty >= 1e11
        )
          throw new BadRequestException(
            'Quantité invalide : positive ou zéro, trois décimales maximum.',
          );
        await tx.cycleCountLine.updateMany({
          where: { tenantId, cycleCountId: id, id: c.lineId },
          data: { countedQty: c.countedQty },
        });
      }
      const claim = await tx.cycleCount.updateMany({
        where: { tenantId, id, status: CycleCountStatus.OPEN, updatedAt: count.updatedAt },
        data: {
          status: CycleCountStatus.COUNTED,
          countedAt: new Date(),
          updatedAt: nextWmsVersion(count.updatedAt),
        },
      });
      if (!claim.count) throw new ConflictException('Ce comptage a déjà changé.');
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'wms-cycle-count',
      entityId: id,
      before: { status: CycleCountStatus.OPEN },
      after: { status: CycleCountStatus.COUNTED, lines: dto.counts.length },
    });
    return this.get(tenantId, id);
  }
  async reconcile(tenantId: string, userId: string, id: string, dto: CountActionDto = {}) {
    const result = await this.locked(tenantId, async (tx) => {
      const count = await this.read(tx, tenantId, id);
      this.assertVersion(count, dto);
      if (!canTransitionCycleCount(count.status as CycleCountStatus, CycleCountStatus.RECONCILED))
        throw new BadRequestException(`Impossible de réconcilier un comptage ${count.status}.`);
      await this.assertFresh(tx, count);
      if (!count.lines.length || count.lines.some((l) => l.countedQty === null))
        throw new ConflictException('Chaque ligne doit avoir une quantité comptée explicite.');
      let variances = 0;
      for (const line of count.lines) {
        const delta = line.countedQty!.minus(line.systemQty);
        if (delta.isZero()) continue;
        variances++;
        await this.inventory.postMovement(tx, {
          tenantId,
          userId,
          type: StockMovementType.ADJUSTMENT,
          itemId: line.itemId,
          lotId: line.lotId,
          ...(delta.gt(0) ? { toBinId: count.binId } : { fromBinId: count.binId }),
          qty: delta.abs().toNumber(),
          refType: 'cycle-count',
          refId: id,
        });
      }
      const claim = await tx.cycleCount.updateMany({
        where: { tenantId, id, status: CycleCountStatus.COUNTED, updatedAt: count.updatedAt },
        data: {
          status: CycleCountStatus.RECONCILED,
          reconciledAt: new Date(),
          updatedAt: nextWmsVersion(count.updatedAt),
        },
      });
      if (!claim.count) throw new ConflictException('Ce comptage a déjà changé.');
      return { count, variances };
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'wms-cycle-count',
      entityId: id,
      before: { status: CycleCountStatus.COUNTED },
      after: { status: CycleCountStatus.RECONCILED, variances: result.variances },
    });
    if (result.variances)
      await this.domainEvents.emit(
        tenantId,
        'wms.cycle-count.variance',
        { type: 'wms-cycle-count', id },
        {
          cycleCountId: id,
          number: result.count.number,
          binCode: result.count.bin.code,
          variances: result.variances,
        },
      );
    return this.get(tenantId, id);
  }
  async cancel(tenantId: string, userId: string, id: string, dto: CountActionDto = {}) {
    await this.locked(tenantId, async (tx) => {
      const count = await this.read(tx, tenantId, id);
      this.assertVersion(count, dto);
      if (!canTransitionCycleCount(count.status as CycleCountStatus, CycleCountStatus.CANCELLED))
        throw new BadRequestException(`Impossible d’annuler un comptage ${count.status}.`);
      const claim = await tx.cycleCount.updateMany({
        where: { tenantId, id, status: count.status, updatedAt: count.updatedAt },
        data: { status: CycleCountStatus.CANCELLED, updatedAt: nextWmsVersion(count.updatedAt) },
      });
      if (!claim.count) throw new ConflictException('Ce comptage a déjà changé.');
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'wms-cycle-count',
      entityId: id,
      after: { status: CycleCountStatus.CANCELLED },
    });
    return this.get(tenantId, id);
  }
}
