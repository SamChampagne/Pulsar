import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuditAction,
  CustomFieldEntity,
  DOMAIN_EVENT_TYPES,
  DockAppointmentStatus,
  YardVisitStatus,
  computeDwell,
  canTransitionDockAppointment,
  canTransitionYardVisit,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AssignSpotDto, CheckInDto, VisitListQueryDto } from './dto/visit.dto';

const VISIT_INCLUDE = {
  trailer: { select: { unitNumber: true, plate: true } },
  carrier: { select: { name: true } },
  spot: { select: { code: true, type: true } },
  appointment: { select: { appointmentNumber: true } },
} as const;

const ACTIVE_STATUSES = [YardVisitStatus.CHECKED_IN, YardVisitStatus.ASSIGNED];

/**
 * The yard spine. A YardVisit moves CHECKED_IN→ASSIGNED→DEPARTED via
 * canTransitionYardVisit (rule 2) with conditional updateMany claims (TOCTOU-safe).
 * Spot occupancy is DERIVED — a spot is occupied iff an active visit (CHECKED_IN/
 * ASSIGNED) points to it (count, never denormalised); an occupied spot rejects a
 * new visit with 409 (BLOCK policy) or warns (WARN policy, rule 35/spotConflictPolicy).
 * Every spotId change writes a YardMove in the SAME transaction
 * (mirrors InventoryService.postMovement). Numbers via SequencesService (YV-, rule 8);
 * tenant-scoped (rule 1); FKs checked (rule 9); audited (rule 6).
 */
@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly domainEvents: DomainEventsService,
    private readonly moduleSettings: ModuleSettingsService,
    private readonly customFields: CustomFieldsService,
  ) {}

  /**
   * Continuity cron: active visits past their free dwell window accrue detention →
   * yard.visit.detention (idempotent per visit). Best-effort, never throws (rule 24).
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async runDwellCheck(): Promise<void> {
    try {
      const now = new Date();
      const active = await this.prisma.yardVisit.findMany({
        where: { status: { in: ACTIVE_STATUSES }, checkOutAt: null },
        take: 500,
        include: { trailer: { select: { unitNumber: true } } },
      });
      for (const v of active) {
        try {
          const dwell = computeDwell({ checkInAt: v.checkInAt }, now);
          if (dwell.status !== 'DETENTION') continue;
          await this.domainEvents.emit(
            v.tenantId,
            'yard.visit.detention',
            { type: 'yard-visit', id: v.id },
            {
              visitId: v.id,
              visitNumber: v.visitNumber,
              trailerLabel: v.trailer?.unitNumber ?? v.trailerRef ?? '',
              dwellMinutes: dwell.minutes,
              detentionMinutes: dwell.detentionMinutes,
            },
          );
        } catch (err) {
          this.logger.error(
            `dwell-check failed for visit ${v.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `runDwellCheck failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async assertActiveVisit(tenantId: string, id: string) {
    const visit = await this.prisma.yardVisit.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, spotId: true },
    });
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }

  /**
   * Assign a visit to a spot inside an existing transaction: guard the transition,
   * derive occupancy (409 if BLOCK policy; warning if WARN policy and another active
   * visit holds the spot), write the YardMove, then flip the visit.
   * Caller owns the tx (rule: same-tx move log).
   * Returns spotWarnings (non-empty only when policy=WARN and spot is occupied).
   */
  private async assignToSpot(
    tx: any,
    tenantId: string,
    userId: string,
    visit: { id: string; status: string; spotId: string | null },
    toSpotId: string,
    note?: string,
  ): Promise<string[]> {
    if (!canTransitionYardVisit(visit.status as YardVisitStatus, YardVisitStatus.ASSIGNED)) {
      throw new BadRequestException(`Cannot assign a visit in status ${visit.status}`);
    }
    const occ = await tx.yardVisit.count({
      where: {
        tenantId,
        spotId: toSpotId,
        status: { in: ACTIVE_STATUSES },
        id: { not: visit.id },
      },
    });

    const settings = await this.moduleSettings.resolve(tenantId, 'yard');
    const policy = (settings.spotConflictPolicy as 'BLOCK' | 'WARN') ?? 'BLOCK';
    const spotWarnings: string[] = [];
    if (occ > 0) {
      if (policy === 'BLOCK') throw new ConflictException('Spot already occupied');
      spotWarnings.push('Spot already occupied');
    }

    await tx.yardMove.create({
      data: {
        tenantId,
        visitId: visit.id,
        fromSpotId: visit.spotId ?? null,
        toSpotId,
        createdById: userId,
        note: note ?? null,
      },
    });
    await tx.yardVisit.updateMany({
      where: { id: visit.id, tenantId },
      data: { spotId: toSpotId, status: YardVisitStatus.ASSIGNED },
    });

    return spotWarnings;
  }

  async checkIn(tenantId: string, userId: string, dto: CheckInDto) {
    const loc = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId },
      select: { id: true },
    });
    if (!loc) throw new NotFoundException('Location not found');

    await this.ownership.assertOwnedIfSet('trailer', dto.trailerId, tenantId);
    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);
    if (dto.spotId) {
      const spot = await this.prisma.yardSpot.findFirst({
        where: { id: dto.spotId, tenantId },
        select: { id: true },
      });
      if (!spot) throw new NotFoundException('Spot not found');
    }
    if (dto.appointmentId) {
      const appt = await this.prisma.dockAppointment.findFirst({
        where: { id: dto.appointmentId, tenantId },
        select: { id: true },
      });
      if (!appt) throw new NotFoundException('Appointment not found');
    }

    const customData = await this.customFields.validateValues(
      'yard',
      tenantId,
      CustomFieldEntity.YARD_VISIT,
      dto.customData,
      { partial: false },
    );

    const visitNumber = await this.sequences.nextNumber(tenantId, 'yard-visit');

    const created = await this.prisma.$transaction(async (tx) => {
      const visit = await tx.yardVisit.create({
        data: {
          tenantId,
          visitNumber,
          locationId: dto.locationId,
          trailerId: dto.trailerId ?? null,
          trailerRef: dto.trailerRef ?? null,
          carrierId: dto.carrierId ?? null,
          driverName: dto.driverName ?? null,
          direction: dto.direction ?? undefined,
          status: YardVisitStatus.CHECKED_IN,
          appointmentId: dto.appointmentId ?? null,
          checkInAt: new Date(),
          notes: dto.notes ?? null,
          createdById: userId,
          ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
        },
      });

      if (dto.appointmentId) {
        const appt = await tx.dockAppointment.findFirst({
          where: { id: dto.appointmentId, tenantId },
          select: { id: true, status: true },
        });
        if (
          appt &&
          canTransitionDockAppointment(
            appt.status as DockAppointmentStatus,
            DockAppointmentStatus.ARRIVED,
          )
        ) {
          // ignore count race: a concurrent arrival is acceptable
          await tx.dockAppointment.updateMany({
            where: { id: dto.appointmentId, tenantId, status: DockAppointmentStatus.SCHEDULED },
            data: { status: DockAppointmentStatus.ARRIVED },
          });
        }
      }

      if (dto.spotId) {
        await this.assignToSpot(
          tx,
          tenantId,
          userId,
          { id: visit.id, status: YardVisitStatus.CHECKED_IN, spotId: null },
          dto.spotId,
        );
      }

      return visit;
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'yard-visit',
      entityId: created.id,
      after: { visitNumber: created.visitNumber, locationId: created.locationId },
    });

    // Cross-module spine (best-effort): a gate check-in is operational context for dispatch.
    await this.domainEvents.emit(
      tenantId,
      'yard.visit.checked-in',
      { type: 'yard-visit', id: created.id },
      {
        visitId: created.id,
        visitNumber: created.visitNumber,
        locationId: created.locationId,
        trailerLabel: created.trailerRef ?? null,
        trailerId: created.trailerId,
        carrierId: created.carrierId,
        direction: created.direction,
      },
    );
    return this.get(tenantId, created.id);
  }

  async assign(tenantId: string, userId: string, visitId: string, dto: AssignSpotDto) {
    const visit = await this.assertActiveVisit(tenantId, visitId);
    const spotWarnings = await this.prisma.$transaction((tx) =>
      this.assignToSpot(tx, tenantId, userId, visit, dto.spotId, dto.note),
    );
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'yard-visit',
      entityId: visitId,
      before: { spotId: visit.spotId, status: visit.status },
      after: { spotId: dto.spotId, status: YardVisitStatus.ASSIGNED },
    });
    const result = await this.get(tenantId, visitId);
    return { ...result, ...(spotWarnings.length ? { spotWarnings } : {}) };
  }

  /** Moving = assigning to a new spot; the from/to are captured in the YardMove. */
  move(tenantId: string, userId: string, visitId: string, dto: AssignSpotDto) {
    return this.assign(tenantId, userId, visitId, dto);
  }

  async checkOut(tenantId: string, userId: string, visitId: string) {
    const visit = await this.assertActiveVisit(tenantId, visitId);
    if (!canTransitionYardVisit(visit.status as YardVisitStatus, YardVisitStatus.DEPARTED)) {
      throw new BadRequestException(`Cannot check out a visit in status ${visit.status}`);
    }
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.yardVisit.updateMany({
        where: { id: visitId, tenantId, status: { in: ACTIVE_STATUSES } },
        data: { status: YardVisitStatus.DEPARTED, checkOutAt: new Date(), spotId: null },
      });
      if (claim.count === 0) throw new ConflictException('Visit already processed');
      await tx.yardMove.create({
        data: {
          tenantId,
          visitId,
          fromSpotId: visit.spotId ?? null,
          toSpotId: null,
          createdById: userId,
        },
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'yard-visit',
      entityId: visitId,
      before: { status: visit.status, spotId: visit.spotId },
      after: { status: YardVisitStatus.DEPARTED, spotId: null },
    });
    const result = await this.get(tenantId, visitId);
    // Best-effort domain event (rule 27).
    await this.domainEvents.emit(
      tenantId,
      DOMAIN_EVENT_TYPES.YARD_VISIT_CHECKED_OUT,
      { type: 'yard-visit', id: visitId },
      { visitId, visitNumber: result.visitNumber },
    );
    return result;
  }

  async cancel(tenantId: string, userId: string, visitId: string) {
    const visit = await this.assertActiveVisit(tenantId, visitId);
    if (!canTransitionYardVisit(visit.status as YardVisitStatus, YardVisitStatus.CANCELLED)) {
      throw new BadRequestException(`Cannot cancel a visit in status ${visit.status}`);
    }
    const claim = await this.prisma.yardVisit.updateMany({
      where: { id: visitId, tenantId, status: { in: ACTIVE_STATUSES } },
      data: { status: YardVisitStatus.CANCELLED, spotId: null },
    });
    if (claim.count === 0) throw new ConflictException('Visit already processed');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'yard-visit',
      entityId: visitId,
      before: { status: visit.status, spotId: visit.spotId },
      after: { status: YardVisitStatus.CANCELLED, spotId: null },
    });
    return this.get(tenantId, visitId);
  }

  async get(tenantId: string, id: string) {
    const visit = await this.prisma.yardVisit.findFirst({
      where: { id, tenantId },
      include: {
        ...VISIT_INCLUDE,
        moves: {
          orderBy: { movedAt: 'asc' },
          include: {
            fromSpot: { select: { code: true } },
            toSpot: { select: { code: true } },
          },
        },
      },
    });
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }

  async list(tenantId: string, q: VisitListQueryDto) {
    return this.prisma.yardVisit.findMany({
      where: {
        tenantId,
        ...(q.status ? { status: q.status as YardVisitStatus } : {}),
        ...(q.locationId ? { locationId: q.locationId } : {}),
        ...(q.spotId ? { spotId: q.spotId } : {}),
      },
      orderBy: { checkInAt: 'desc' },
      take: 100,
      include: VISIT_INCLUDE,
    });
  }
}
