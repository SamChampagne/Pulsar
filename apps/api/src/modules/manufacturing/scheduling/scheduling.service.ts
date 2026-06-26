import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  ManufacturingFirmness,
  ManufacturingOrderStatus,
  ManufacturingPriority,
} from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApsClient } from '../../../core/aps/aps.client';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { buildManufacturingSnapshot } from './snapshot-builder';

export interface RunSchedulingInput {
  strategy?: string;
  horizonStart?: string;
  horizonDays?: number;
  objective?: {
    makespan?: number;
    total_tardiness?: number;
    weighted_tardiness?: number;
    setup_cost?: number;
    idle_penalty?: number;
  };
}

/**
 * Ties Pulsar manufacturing master-data to the APS engine: load → snapshot →
 * run → persist. The engine call is best-effort (ApsClient maps failure to 503);
 * persistence is transactional so a run never leaves partial assignments.
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aps: ApsClient,
    private readonly audit: AuditLogsService,
  ) {}

  /** Passthrough so the UI only offers strategies the engine actually supports. */
  strategies() {
    return this.aps.listStrategies();
  }

  async run(tenantId: string, userId: string, input: RunSchedulingInput) {
    // Load the schedulable slice: active orders (RELEASED + IN_PROGRESS) with ops,
    // all work centers, and the calendars they reference.
    const [calendars, workCenters, orders] = await this.prisma.$transaction([
      this.prisma.workingCalendar.findMany({
        where: { tenantId },
        include: { shifts: true },
      }),
      this.prisma.workCenter.findMany({ where: { tenantId, isActive: true } }),
      this.prisma.manufacturingOrder.findMany({
        where: {
          tenantId,
          status: {
            in: [ManufacturingOrderStatus.RELEASED, ManufacturingOrderStatus.IN_PROGRESS],
          },
        },
        include: { operations: true },
      }),
    ]);

    if (orders.length === 0) {
      throw new BadRequestException(
        'No schedulable manufacturing orders (need at least one RELEASED or IN_PROGRESS order).',
      );
    }

    const { snapshot, warnings, orderCount, operationCount } = buildManufacturingSnapshot({
      exportedAt: new Date(),
      calendars: calendars.map((c) => ({
        id: c.id,
        name: c.name,
        shifts: c.shifts.map((s) => ({
          weekday: s.weekday,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      })),
      workCenters: workCenters.map((w) => ({
        id: w.id,
        name: w.name,
        calendarId: w.calendarId,
        capabilities: w.capabilities,
        efficiency: w.efficiency,
      })),
      orders: orders.map((o) => ({
        id: o.id,
        name: o.name,
        productRef: o.productRef,
        quantity: o.quantity,
        dueDate: o.dueDate,
        releaseDate: o.releaseDate,
        priority: o.priority as unknown as ManufacturingPriority,
        firmness: o.firmness as unknown as ManufacturingFirmness,
        operations: o.operations.map((op) => ({
          id: op.id,
          sequence: op.sequence,
          name: op.name,
          durationMinutes: op.durationMinutes,
          setupMinutes: op.setupMinutes,
          eligibleWorkCenterIds: op.eligibleWorkCenterIds,
          dependsOn: op.dependsOn,
        })),
      })),
    });

    if (orderCount === 0) {
      throw new BadRequestException(
        `Nothing to schedule: ${warnings.join(' ') || 'all orders were skipped'}`,
      );
    }

    // Call the engine (best-effort → 503 on failure, no DB writes yet).
    const result = await this.aps.runFromSnapshot({
      snapshot,
      strategy: input.strategy ?? 'greedy',
      horizon_start: input.horizonStart ?? null,
      horizon_days: input.horizonDays ?? 30,
      objective: input.objective ?? null,
    });

    // Persist the run + its assignments atomically.
    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.schedulingRun.create({
        data: {
          tenantId,
          apsScheduleId: result.schedule_id,
          strategy: result.strategy,
          solverStatus: result.solver_status,
          objectiveValue: result.objective_value,
          wallTimeMs: result.wall_time_ms,
          horizonStart: result.horizon_start ? new Date(result.horizon_start) : null,
          horizonEnd: result.horizon_end ? new Date(result.horizon_end) : null,
          orderCount,
          operationCount,
          assignmentCount: result.assignments.length,
          snapshotHash: snapshot.metadata?.input_snapshot_hash as string | undefined,
          warnings,
          diagnostics: (result.diagnostics ?? undefined) as object | undefined,
          createdById: userId,
        },
      });
      if (result.assignments.length > 0) {
        await tx.scheduledManufacturingOperation.createMany({
          data: result.assignments.map((a) => ({
            tenantId,
            runId: created.id,
            operationId: a.operation_id,
            orderId: a.work_order_id,
            workCenterId: a.machine_id,
            setupStart: new Date(a.setup_start),
            start: new Date(a.start),
            end: new Date(a.end),
          })),
        });
      }
      return created;
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'scheduling-run',
      entityId: run.id,
      after: {
        strategy: run.strategy,
        solverStatus: run.solverStatus,
        objectiveValue: run.objectiveValue,
        assignmentCount: run.assignmentCount,
      },
    });

    return this.get(tenantId, run.id);
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = { tenantId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.schedulingRun.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.schedulingRun.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const run = await this.prisma.schedulingRun.findFirst({
      where: { id, tenantId },
      include: { assignments: { orderBy: { start: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Scheduling run not found');
    return run;
  }

  /** Promote a run to the tenant's single baseline (unset the others atomically). */
  async publish(tenantId: string, userId: string, id: string) {
    const run = await this.prisma.schedulingRun.findFirst({ where: { id, tenantId } });
    if (!run) throw new NotFoundException('Scheduling run not found');
    await this.prisma.$transaction([
      this.prisma.schedulingRun.updateMany({
        where: { tenantId, isBaseline: true },
        data: { isBaseline: false },
      }),
      this.prisma.schedulingRun.update({ where: { id }, data: { isBaseline: true } }),
    ]);
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'scheduling-run',
      entityId: id,
      after: { isBaseline: true },
    });
    return this.get(tenantId, id);
  }

  async baseline(tenantId: string) {
    return this.prisma.schedulingRun.findFirst({
      where: { tenantId, isBaseline: true },
      include: { assignments: { orderBy: { start: 'asc' } } },
    });
  }
}
