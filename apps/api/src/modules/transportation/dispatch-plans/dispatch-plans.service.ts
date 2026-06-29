import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, DispatchPlanStatus, canTransitionDispatchPlan } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { LoadsService } from '../loads/loads.service';

interface CreateItemInput {
  shipmentIds: string[];
}
interface CreatePlanInput {
  items: CreateItemInput[];
  engine?: string;
  note?: string;
}

@Injectable()
export class DispatchPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly loads: LoadsService,
  ) {}

  /** Create a DRAFT plan of proposed consolidations. Validates shipment ownership up front. */
  async create(tenantId: string, userId: string, input: CreatePlanInput) {
    const items = (input.items ?? []).map((i) => ({
      shipmentIds: [...new Set(i.shipmentIds ?? [])],
    }));
    if (items.length === 0) {
      throw new BadRequestException('A plan needs at least one item');
    }
    for (const it of items) {
      if (it.shipmentIds.length === 0) {
        throw new BadRequestException('Each plan item needs at least one shipment');
      }
    }
    // Ownership (rule 9): every referenced shipment must belong to the tenant.
    const allIds = [...new Set(items.flatMap((i) => i.shipmentIds))];
    const owned = await this.prisma.shipment.count({
      where: { id: { in: allIds }, tenantId },
    });
    if (owned !== allIds.length) {
      throw new BadRequestException('One or more shipments could not be found');
    }

    const planNumber = await this.sequences.nextNumber(tenantId, 'dispatch-plan');
    const plan = await this.prisma.dispatchPlan.create({
      data: {
        tenantId,
        planNumber,
        engine: input.engine?.trim() || 'MANUAL',
        note: input.note?.trim() || null,
        createdById: userId,
        items: { create: items.map((i) => ({ tenantId, shipmentIds: i.shipmentIds })) },
      },
      include: { items: true },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'dispatch-plan',
      entityId: plan.id,
      after: { planNumber: plan.planNumber, status: plan.status, itemCount: items.length },
    });
    return plan;
  }

  async list(tenantId: string, query: ListQueryDto) {
    const where = { tenantId };
    const { page, pageSize, skip, take } = paginationArgs(query);
    const [items, total] = await Promise.all([
      this.prisma.dispatchPlan.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.dispatchPlan.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const plan = await this.prisma.dispatchPlan.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!plan) throw new NotFoundException('Dispatch plan not found');
    return plan;
  }

  /**
   * Read-only preview: for each item, the current state of its shipments and whether
   * the consolidation is still committable (all PENDING + unassigned). No side effects.
   */
  async diff(tenantId: string, id: string) {
    const plan = await this.get(tenantId, id);
    const allIds = [...new Set(plan.items.flatMap((i) => i.shipmentIds))];
    const shipments = await this.prisma.shipment.findMany({
      where: { id: { in: allIds }, tenantId },
      select: { id: true, shipmentNumber: true, status: true, loadId: true },
    });
    const byId = new Map(shipments.map((s) => [s.id, s]));
    const itemsDiff = plan.items.map((item) => {
      const shipmentStates = item.shipmentIds.map((sid) => {
        const s = byId.get(sid);
        const found = !!s;
        const committable = found && s!.status === 'PENDING' && s!.loadId === null;
        return {
          shipmentId: sid,
          shipmentNumber: s?.shipmentNumber ?? null,
          found,
          status: s?.status ?? null,
          alreadyAssigned: found ? s!.loadId !== null : false,
          committable,
        };
      });
      return {
        itemId: item.id,
        resultLoadId: item.resultLoadId,
        error: item.error,
        shipments: shipmentStates,
        committable: shipmentStates.length > 0 && shipmentStates.every((s) => s.committable),
      };
    });
    return {
      planId: plan.id,
      status: plan.status,
      committable: itemsDiff.length > 0 && itemsDiff.every((i) => i.committable),
      items: itemsDiff,
    };
  }

  async propose(tenantId: string, userId: string, id: string) {
    const plan = await this.get(tenantId, id);
    if (!canTransitionDispatchPlan(plan.status as DispatchPlanStatus, DispatchPlanStatus.PROPOSED)) {
      throw new ConflictException(`Cannot propose a plan in status ${plan.status}`);
    }
    // Claim-guarded transition (TOCTOU): only flips a still-DRAFT plan.
    const claim = await this.prisma.dispatchPlan.updateMany({
      where: { id, tenantId, status: DispatchPlanStatus.DRAFT },
      data: { status: DispatchPlanStatus.PROPOSED },
    });
    if (claim.count !== 1) throw new ConflictException('Plan is no longer in DRAFT');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'dispatch-plan',
      entityId: id,
      before: { status: DispatchPlanStatus.DRAFT },
      after: { status: DispatchPlanStatus.PROPOSED },
    });
    return this.get(tenantId, id);
  }

  /**
   * Commit a PROPOSED plan: claim it atomically (anti double-commit), then apply each item
   * via the existing atomic LoadsService.consolidate (rules 8/9/11/18 honored there).
   * Best-effort per item — a stale item (shipment no longer PENDING) records an error
   * without breaking the others; each consolidate is atomic on its own.
   */
  async commit(tenantId: string, userId: string, id: string) {
    const plan = await this.get(tenantId, id);
    if (!canTransitionDispatchPlan(plan.status as DispatchPlanStatus, DispatchPlanStatus.COMMITTED)) {
      throw new ConflictException(`Cannot commit a plan in status ${plan.status}`);
    }
    const claim = await this.prisma.dispatchPlan.updateMany({
      where: { id, tenantId, status: DispatchPlanStatus.PROPOSED },
      data: {
        status: DispatchPlanStatus.COMMITTED,
        committedById: userId,
        committedAt: new Date(),
      },
    });
    if (claim.count !== 1) throw new ConflictException('Plan is no longer PROPOSED');

    let applied = 0;
    let failed = 0;
    for (const item of plan.items) {
      try {
        const load = await this.loads.consolidate(tenantId, userId, item.shipmentIds);
        await this.prisma.dispatchPlanItem.update({
          where: { id: item.id },
          data: { resultLoadId: load.id, error: null },
        });
        applied += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Consolidation failed';
        await this.prisma.dispatchPlanItem.update({
          where: { id: item.id },
          data: { error: message },
        });
        failed += 1;
      }
    }

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'dispatch-plan',
      entityId: id,
      before: { status: DispatchPlanStatus.PROPOSED },
      after: { status: DispatchPlanStatus.COMMITTED, applied, failed },
    });
    return this.get(tenantId, id);
  }

  async discard(tenantId: string, userId: string, id: string) {
    const plan = await this.get(tenantId, id);
    if (!canTransitionDispatchPlan(plan.status as DispatchPlanStatus, DispatchPlanStatus.DISCARDED)) {
      throw new ConflictException(`Cannot discard a plan in status ${plan.status}`);
    }
    const claim = await this.prisma.dispatchPlan.updateMany({
      where: {
        id,
        tenantId,
        status: { in: [DispatchPlanStatus.DRAFT, DispatchPlanStatus.PROPOSED] },
      },
      data: { status: DispatchPlanStatus.DISCARDED },
    });
    if (claim.count !== 1) throw new ConflictException('Plan can no longer be discarded');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'dispatch-plan',
      entityId: id,
      after: { status: DispatchPlanStatus.DISCARDED },
    });
    return this.get(tenantId, id);
  }
}
