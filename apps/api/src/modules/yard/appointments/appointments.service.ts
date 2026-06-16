import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, DockAppointmentStatus, canTransitionDockAppointment } from '@pulsar/shared';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AppointmentListQueryDto, CreateAppointmentDto } from './dto/appointment.dto';

/**
 * Dock appointments — scheduled inbound/outbound slots a yard visit can fulfill.
 * Status changes go through canTransitionDockAppointment (rule 2) with a
 * conditional updateMany claim (TOCTOU-safe); numbers via SequencesService
 * (rule 8, key 'dock-appointment'→DA-); tenant-scoped (rule 1); FKs checked
 * (rule 9); audited (rule 6).
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(tenantId: string, q: AppointmentListQueryDto) {
    return this.prisma.dockAppointment.findMany({
      where: {
        tenantId,
        ...(q.status ? { status: q.status as DockAppointmentStatus } : {}),
        ...(q.locationId ? { locationId: q.locationId } : {}),
      },
      orderBy: { windowStart: 'asc' },
      take: 100,
      include: {
        spot: { select: { id: true, code: true, type: true } },
        carrier: { select: { id: true, name: true } },
        location: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async get(tenantId: string, id: string) {
    const appt = await this.prisma.dockAppointment.findFirst({
      where: { id, tenantId },
      include: {
        spot: { select: { id: true, code: true, type: true } },
        carrier: { select: { id: true, name: true } },
        location: { select: { id: true, code: true, name: true } },
      },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    return appt;
  }

  async create(tenantId: string, userId: string, dto: CreateAppointmentDto) {
    const loc = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId },
      select: { id: true },
    });
    if (!loc) throw new NotFoundException('Location not found');

    if (dto.windowEnd <= dto.windowStart) {
      throw new BadRequestException('windowEnd must be after windowStart');
    }

    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);
    if (dto.spotId) {
      const spot = await this.prisma.yardSpot.findFirst({
        where: { id: dto.spotId, tenantId },
        select: { id: true },
      });
      if (!spot) throw new NotFoundException('Spot not found');
    }

    const appointmentNumber = await this.sequences.nextNumber(tenantId, 'dock-appointment');
    const appt = await this.prisma.dockAppointment.create({
      data: {
        tenantId,
        appointmentNumber,
        locationId: dto.locationId,
        spotId: dto.spotId ?? null,
        carrierId: dto.carrierId ?? null,
        direction: dto.direction ?? undefined,
        windowStart: dto.windowStart,
        windowEnd: dto.windowEnd,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        status: DockAppointmentStatus.SCHEDULED,
        createdById: userId,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'dock-appointment',
      entityId: appt.id,
      after: { appointmentNumber: appt.appointmentNumber, locationId: appt.locationId },
    });
    return appt;
  }

  private async transition(
    tenantId: string,
    userId: string,
    id: string,
    to: DockAppointmentStatus,
    extra?: Record<string, unknown>,
  ) {
    const appt = await this.prisma.dockAppointment.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (!canTransitionDockAppointment(appt.status as DockAppointmentStatus, to)) {
      throw new BadRequestException(`Cannot transition appointment from ${appt.status} to ${to}`);
    }
    const claim = await this.prisma.dockAppointment.updateMany({
      where: { id, tenantId, status: appt.status as DockAppointmentStatus },
      data: { status: to, ...(extra ?? {}) },
    });
    if (claim.count === 0) throw new ConflictException('Appointment already processed');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'dock-appointment',
      entityId: id,
      before: { status: appt.status },
      after: { status: to },
    });
    return this.get(tenantId, id);
  }

  arrive(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, DockAppointmentStatus.ARRIVED);
  }

  complete(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, DockAppointmentStatus.COMPLETED);
  }

  cancel(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, DockAppointmentStatus.CANCELLED);
  }

  noShow(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, DockAppointmentStatus.NO_SHOW);
  }
}
