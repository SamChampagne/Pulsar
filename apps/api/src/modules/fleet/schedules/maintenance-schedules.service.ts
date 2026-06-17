import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuditAction,
  MaintenanceOrderStatus,
  MaintenanceType,
  computeScheduleDue,
  type ScheduleDue,
} from '@pulsar/shared';
import type { MaintenanceSchedule } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import {
  CreateMaintenanceScheduleDto,
  ScheduleListQueryDto,
  UpdateMaintenanceScheduleDto,
} from './dto/schedule.dto';

/**
 * Preventive-maintenance schedules — the continuity layer of the Fleet module.
 * An interval (days and/or km) per asset; the due status is COMPUTED on read
 * (computeScheduleDue, pure @pulsar/shared — never persisted). A cron emits
 * `fleet.maintenance.due` for due/overdue schedules (best-effort, idempotent per
 * cycle via the event→task dedupKey) and completing a linked work order advances
 * the anchor (in MaintenanceService.complete) so the cycle continues.
 * Tenant-scoped (rule 1); FK ownership checked (rule 9); audited (rule 6).
 */
@Injectable()
export class MaintenanceSchedulesService {
  private readonly logger = new Logger(MaintenanceSchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly domainEvents: DomainEventsService,
    private readonly maintenance: MaintenanceService,
  ) {}

  private assertExactlyOneAsset(vehicleId?: string | null, trailerId?: string | null) {
    if (!!vehicleId === !!trailerId) {
      throw new BadRequestException('Exactly one of vehicleId or trailerId is required');
    }
  }

  /** Latest completed-WO odometer reading for an asset (the km axis "current"). */
  private async currentOdometer(
    tenantId: string,
    vehicleId: string | null,
    trailerId: string | null,
  ): Promise<number | null> {
    const wo = await this.prisma.maintenanceOrder.findFirst({
      where: {
        tenantId,
        ...(vehicleId ? { vehicleId } : { trailerId }),
        status: MaintenanceOrderStatus.COMPLETED,
        odometerKm: { not: null },
      },
      orderBy: { completedAt: 'desc' },
      select: { odometerKm: true },
    });
    return wo?.odometerKm ?? null;
  }

  private cycleKey(s: MaintenanceSchedule, due: ScheduleDue): string {
    return due.nextDueDate ?? `${new Date(s.anchorDate).toISOString()}:${s.intervalKm ?? 0}`;
  }

  async create(tenantId: string, userId: string, dto: CreateMaintenanceScheduleDto) {
    this.assertExactlyOneAsset(dto.vehicleId, dto.trailerId);
    await this.ownership.assertOwnedIfSet('vehicle', dto.vehicleId, tenantId);
    await this.ownership.assertOwnedIfSet('trailer', dto.trailerId, tenantId);
    if (!dto.intervalDays && !dto.intervalKm) {
      throw new BadRequestException('Provide at least one interval (intervalDays or intervalKm)');
    }

    const schedule = await this.prisma.maintenanceSchedule.create({
      data: {
        tenantId,
        vehicleId: dto.vehicleId ?? null,
        trailerId: dto.trailerId ?? null,
        name: dto.name,
        type: dto.type ?? MaintenanceType.PREVENTIVE,
        intervalDays: dto.intervalDays ?? null,
        intervalKm: dto.intervalKm ?? null,
        anchorOdometerKm: dto.anchorOdometerKm ?? null,
        leadDays: dto.leadDays ?? 7,
        anchorDate: new Date(),
        createdById: userId,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'maintenance-schedule',
      entityId: schedule.id,
      after: { name: schedule.name, vehicleId: schedule.vehicleId, trailerId: schedule.trailerId },
    });
    return this.withDue(tenantId, schedule);
  }

  /** Attach the computed due status to a schedule row. */
  private async withDue(tenantId: string, s: MaintenanceSchedule) {
    const odo = s.intervalKm
      ? await this.currentOdometer(tenantId, s.vehicleId, s.trailerId)
      : null;
    return { ...s, currentOdometerKm: odo, due: computeScheduleDue(s, new Date(), odo) };
  }

  async list(tenantId: string, q: ScheduleListQueryDto) {
    const schedules = await this.prisma.maintenanceSchedule.findMany({
      where: {
        tenantId,
        ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
        ...(q.trailerId ? { trailerId: q.trailerId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    // Batch the km "current odometer" per asset to avoid N queries.
    const odoMap = await this.odometerMap(tenantId, schedules);
    return schedules.map((s) => {
      const odo = s.intervalKm ? (odoMap.get(s.vehicleId ?? s.trailerId ?? '') ?? null) : null;
      return { ...s, currentOdometerKm: odo, due: computeScheduleDue(s, new Date(), odo) };
    });
  }

  private async odometerMap(tenantId: string, schedules: MaintenanceSchedule[]) {
    const vIds = schedules.map((s) => s.vehicleId).filter((x): x is string => !!x);
    const tIds = schedules.map((s) => s.trailerId).filter((x): x is string => !!x);
    const map = new Map<string, number>();
    if (vIds.length > 0) {
      const rows = await this.prisma.maintenanceOrder.groupBy({
        by: ['vehicleId'],
        where: {
          tenantId,
          vehicleId: { in: vIds },
          status: MaintenanceOrderStatus.COMPLETED,
          odometerKm: { not: null },
        },
        _max: { odometerKm: true },
      });
      for (const r of rows)
        if (r.vehicleId && r._max.odometerKm != null) map.set(r.vehicleId, r._max.odometerKm);
    }
    if (tIds.length > 0) {
      const rows = await this.prisma.maintenanceOrder.groupBy({
        by: ['trailerId'],
        where: {
          tenantId,
          trailerId: { in: tIds },
          status: MaintenanceOrderStatus.COMPLETED,
          odometerKm: { not: null },
        },
        _max: { odometerKm: true },
      });
      for (const r of rows)
        if (r.trailerId && r._max.odometerKm != null) map.set(r.trailerId, r._max.odometerKm);
    }
    return map;
  }

  async get(tenantId: string, id: string) {
    const s = await this.prisma.maintenanceSchedule.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException('Maintenance schedule not found');
    return this.withDue(tenantId, s);
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateMaintenanceScheduleDto) {
    const existing = await this.prisma.maintenanceSchedule.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Maintenance schedule not found');
    const updated = await this.prisma.maintenanceSchedule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.intervalDays !== undefined ? { intervalDays: dto.intervalDays } : {}),
        ...(dto.intervalKm !== undefined ? { intervalKm: dto.intervalKm } : {}),
        ...(dto.anchorOdometerKm !== undefined ? { anchorOdometerKm: dto.anchorOdometerKm } : {}),
        ...(dto.leadDays !== undefined ? { leadDays: dto.leadDays } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'maintenance-schedule',
      entityId: id,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
    });
    return this.withDue(tenantId, updated);
  }

  async remove(tenantId: string, userId: string, id: string) {
    const existing = await this.prisma.maintenanceSchedule.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Maintenance schedule not found');
    await this.prisma.maintenanceSchedule.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'maintenance-schedule',
      entityId: id,
      before: { name: existing.name },
    });
    return { deleted: true };
  }

  /** Open a work order from a schedule (links it; the WO advances the anchor on completion). */
  async generateOrder(tenantId: string, userId: string, id: string) {
    const s = await this.prisma.maintenanceSchedule.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException('Maintenance schedule not found');
    return this.maintenance.create(
      tenantId,
      userId,
      {
        vehicleId: s.vehicleId ?? undefined,
        trailerId: s.trailerId ?? undefined,
        type: s.type as MaintenanceType,
        description: `Entretien préventif — ${s.name}`,
      },
      s.id,
    );
  }

  /**
   * Cron: emit a domain event for each due/overdue schedule that isn't already
   * being serviced. Best-effort and fully isolated — never throws (rule 24).
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async runDueCheck(): Promise<void> {
    try {
      const schedules = await this.prisma.maintenanceSchedule.findMany({
        where: { isActive: true },
        take: 500,
      });
      const now = new Date();
      for (const s of schedules) {
        try {
          const odo = s.intervalKm
            ? await this.currentOdometer(s.tenantId, s.vehicleId, s.trailerId)
            : null;
          const due = computeScheduleDue(s, now, odo);
          if (!due.isDue) continue;

          // Don't nag while a work order for this schedule is already open.
          const active = await this.prisma.maintenanceOrder.count({
            where: {
              tenantId: s.tenantId,
              scheduleId: s.id,
              status: { in: [MaintenanceOrderStatus.OPEN, MaintenanceOrderStatus.IN_PROGRESS] },
            },
          });
          if (active > 0) continue;

          const label =
            (
              await this.prisma.vehicle.findFirst({
                where: { id: s.vehicleId ?? '', tenantId: s.tenantId },
                select: { unitNumber: true },
              })
            )?.unitNumber ??
            (
              await this.prisma.trailer.findFirst({
                where: { id: s.trailerId ?? '', tenantId: s.tenantId },
                select: { unitNumber: true },
              })
            )?.unitNumber ??
            '';

          await this.domainEvents.emit(
            s.tenantId,
            'fleet.maintenance.due',
            { type: 'maintenance-schedule', id: s.id },
            {
              scheduleId: s.id,
              name: s.name,
              assetKind: s.vehicleId ? 'vehicle' : 'trailer',
              assetId: s.vehicleId ?? s.trailerId,
              assetLabel: label,
              status: due.status,
              nextDueDate: due.nextDueDate,
              nextDueKm: due.nextDueKm,
              cycle: this.cycleKey(s, due),
            },
          );
        } catch (err) {
          this.logger.error(
            `due-check failed for schedule ${s.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`runDueCheck failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
