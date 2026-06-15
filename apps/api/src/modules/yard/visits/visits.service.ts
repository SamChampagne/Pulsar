import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  DockAppointmentStatus,
  YardVisitStatus,
  canTransitionDockAppointment,
  canTransitionYardVisit,
} from '@pulsar/shared';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
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
 * new visit with 409. Every spotId change writes a YardMove in the SAME transaction
 * (mirrors InventoryService.postMovement). Numbers via SequencesService (YV-, rule 8);
 * tenant-scoped (rule 1); FKs checked (rule 9); audited (rule 6).
 */
@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}

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
   * derive occupancy (409 if another active visit holds the spot), write the
   * YardMove, then flip the visit. Caller owns the tx (rule: same-tx move log).
   */
  private async assignToSpot(
    tx: any,
    tenantId: string,
    userId: string,
    visit: { id: string; status: string; spotId: string | null },
    toSpotId: string,
    note?: string,
  ) {
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
    if (occ > 0) throw new ConflictException('Spot already occupied');
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
        },
      });

      if (dto.appointmentId) {
        const appt = await tx.dockAppointment.findFirst({
          where: { id: dto.appointmentId, tenantId },
          select: { id: true, status: true },
        });
        if (
          appt &&
          canTransitionDockAppointment(appt.status as DockAppointmentStatus, DockAppointmentStatus.ARRIVED)
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
    return this.get(tenantId, created.id);
  }

  async assign(tenantId: string, userId: string, visitId: string, dto: AssignSpotDto) {
    const visit = await this.assertActiveVisit(tenantId, visitId);
    await this.prisma.$transaction((tx) =>
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
    return this.get(tenantId, visitId);
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
    return this.get(tenantId, visitId);
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
      include: VISIT_INCLUDE,
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
