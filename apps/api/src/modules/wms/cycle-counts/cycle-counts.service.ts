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
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  CreateCycleCountDto,
  CycleCountListQueryDto,
  RecordCountsDto,
} from './dto/cycle-count.dto';

/**
 * Cycle counts — the WMS inventory-accuracy loop. Creating one snapshots the
 * bin's per-item system qty; the operator records the physical count; reconciling
 * posts an ADJUSTMENT movement for each variance via InventoryService (rule 33;
 * never below 0) and emits `wms.cycle-count.variance` when discrepancies exist.
 * Status moves through canTransitionCycleCount (rule 2) with conditional updateMany
 * claims (TOCTOU). Numbers via SequencesService (CC-, rule 8); tenant-scoped (rule 1);
 * FK ownership checked (rule 9); audited (rule 6).
 */
@Injectable()
export class CycleCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly inventory: InventoryService,
    private readonly domainEvents: DomainEventsService,
  ) {}

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
    const count = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId },
      include: {
        bin: { select: { code: true } },
        lines: { include: { item: { select: { sku: true, name: true } } } },
      },
    });
    if (!count) throw new NotFoundException('Cycle count not found');
    return count;
  }

  async create(tenantId: string, userId: string, dto: CreateCycleCountDto) {
    const bin = await this.prisma.bin.findFirst({
      where: { id: dto.binId, tenantId },
      select: { id: true },
    });
    if (!bin) throw new NotFoundException('Bin not found');
    // Snapshot the current per-item system qty in this bin.
    const levels = await this.prisma.inventoryLevel.findMany({
      where: { tenantId, binId: dto.binId },
      select: { itemId: true, qtyOnHand: true },
    });

    const number = await this.sequences.nextNumber(tenantId, 'cycle-count');
    const count = await this.prisma.cycleCount.create({
      data: {
        tenantId,
        number,
        binId: dto.binId,
        status: CycleCountStatus.OPEN,
        note: dto.note ?? null,
        createdById: userId,
        lines: {
          create: levels.map((l) => ({
            tenantId,
            itemId: l.itemId,
            systemQty: l.qtyOnHand,
          })),
        },
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'wms-cycle-count',
      entityId: count.id,
      after: { number: count.number, binId: count.binId, lines: levels.length },
    });
    return this.get(tenantId, count.id);
  }

  async recordCounts(tenantId: string, userId: string, id: string, dto: RecordCountsDto) {
    const count = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!count) throw new NotFoundException('Cycle count not found');
    if (count.status !== CycleCountStatus.OPEN) {
      throw new BadRequestException('Only an OPEN cycle count can record counts');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const c of dto.counts) {
        await tx.cycleCountLine.updateMany({
          where: { id: c.lineId, tenantId, cycleCountId: id },
          data: { countedQty: c.countedQty },
        });
      }
      const claim = await tx.cycleCount.updateMany({
        where: { id, tenantId, status: CycleCountStatus.OPEN },
        data: { status: CycleCountStatus.COUNTED, countedAt: new Date() },
      });
      if (claim.count === 0) throw new ConflictException('Cycle count already processed');
    });
    return this.get(tenantId, id);
  }

  async reconcile(tenantId: string, userId: string, id: string) {
    const count = await this.get(tenantId, id);
    if (!canTransitionCycleCount(count.status as CycleCountStatus, CycleCountStatus.RECONCILED)) {
      throw new BadRequestException(`Cannot reconcile a ${count.status} cycle count`);
    }

    let variances = 0;
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.cycleCount.updateMany({
        where: { id, tenantId, status: CycleCountStatus.COUNTED },
        data: { status: CycleCountStatus.RECONCILED, reconciledAt: new Date() },
      });
      if (claim.count === 0)
        throw new ConflictException('Only a COUNTED cycle count can reconcile');

      for (const line of count.lines) {
        if (line.countedQty == null) continue;
        const delta = Number(line.countedQty) - Number(line.systemQty);
        if (delta === 0) continue;
        variances++;
        await this.inventory.postMovement(tx, {
          tenantId,
          userId,
          type: StockMovementType.ADJUSTMENT,
          itemId: line.itemId,
          ...(delta > 0 ? { toBinId: count.binId } : { fromBinId: count.binId }),
          qty: Math.abs(delta),
          refType: 'cycle-count',
          refId: id,
        });
      }
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'wms-cycle-count',
      entityId: id,
      before: { status: count.status },
      after: { status: CycleCountStatus.RECONCILED, variances },
    });

    // Continuity: surface accuracy gaps to the workbench (best-effort).
    if (variances > 0) {
      await this.domainEvents.emit(
        tenantId,
        'wms.cycle-count.variance',
        { type: 'wms-cycle-count', id },
        { cycleCountId: id, number: count.number, binCode: count.bin.code, variances },
      );
    }
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const count = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId },
      select: { status: true },
    });
    if (!count) throw new NotFoundException('Cycle count not found');
    if (!canTransitionCycleCount(count.status as CycleCountStatus, CycleCountStatus.CANCELLED)) {
      throw new BadRequestException(`Cannot cancel a ${count.status} cycle count`);
    }
    const { count: n } = await this.prisma.cycleCount.updateMany({
      where: { id, tenantId, status: { in: [CycleCountStatus.OPEN, CycleCountStatus.COUNTED] } },
      data: { status: CycleCountStatus.CANCELLED },
    });
    if (n === 0) throw new ConflictException('Cycle count already processed');
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
