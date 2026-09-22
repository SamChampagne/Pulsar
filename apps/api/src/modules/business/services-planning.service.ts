import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  AuthUser,
  connectedOperationsSettings,
  hrAvailabilityDate,
  PERMISSIONS,
  serviceLocalToInstant,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import {
  assertServicePerson,
  lockBusinessTenant,
  nextBusinessVersion,
  servicePersonSelect,
} from './business-lock';
import { assertServiceSlot } from './service-scheduling';
import {
  PlanningQueryDto,
  ScheduleServiceJobDto,
  ServiceRequirementsDto,
} from './services-planning.dto';
import { BusinessQueryDto } from './business.dto';
import { paginationArgs, paginated } from '../../common/pagination';

@Injectable()
export class ServicesPlanningService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
  ) {}
  private async access(actor: AuthUser, manage = false) {
    if (
      !actor.permissions.includes(PERMISSIONS.SERVICES.READ) ||
      (manage && !actor.permissions.includes(PERMISSIONS.SERVICES.MANAGE)) ||
      !(await this.modules.getEnabledKeys(actor.tenantId)).has('services')
    )
      throw new ForbiddenException();
  }
  async settings(tenantId: string) {
    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    return connectedOperationsSettings(
      (tenant.settings as Record<string, unknown>).connectedOperations,
    );
  }
  async teams(actor: AuthUser, query: BusinessQueryDto) {
    await this.access(actor);
    if (
      !actor.permissions.includes(PERMISSIONS.HR.AVAILABILITY_READ) ||
      !(await this.modules.getEnabledKeys(actor.tenantId)).has('hr')
    )
      throw new ForbiddenException();
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.HrTeamWhereInput = {
      tenantId: actor.tenantId,
      active: true,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.hrTeam.findMany({
        where,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.db.hrTeam.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async skills(actor: AuthUser, query: BusinessQueryDto) {
    await this.access(actor);
    if (
      !actor.permissions.includes(PERMISSIONS.HR.QUALIFICATIONS_READ) ||
      !(await this.modules.getEnabledKeys(actor.tenantId)).has('hr')
    )
      throw new ForbiddenException();
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.HrSkillWhereInput = {
      tenantId: actor.tenantId,
      active: true,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.hrSkill.findMany({
        where,
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.db.hrSkill.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async board(actor: AuthUser, query: PlanningQueryDto) {
    await this.access(actor);
    const config = await this.settings(actor.tenantId),
      tenantId = actor.tenantId;
    let start: Date, end: Date;
    try {
      start = new Date(serviceLocalToInstant(query.date + 'T00:00', config.timeZone));
      const endDay = new Date(Date.parse(query.date + 'T12:00:00Z') + (query.days ?? 7) * 86400000)
        .toISOString()
        .slice(0, 10);
      end = new Date(serviceLocalToInstant(endDay + 'T00:00', config.timeZone));
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const enabled = await this.modules.getEnabledKeys(tenantId);
    const hrAllowed =
      enabled.has('hr') && actor.permissions.includes(PERMISSIONS.HR.AVAILABILITY_READ);
    if (query.teamId && !hrAllowed)
      throw new ForbiddenException('La vue équipe requiert le droit de disponibilité RH.');
    const employees = hrAllowed
      ? await this.db.hrEmployee.findMany({
          where: {
            tenantId,
            active: true,
            userId: { not: null },
            ...(query.teamId ? { teamId: query.teamId } : {}),
          },
          select: { id: true, userId: true, teamId: true, team: { select: { name: true } } },
        })
      : [];
    const where: Prisma.UserWhereInput = {
      tenantId,
      status: 'ACTIVE',
      agentServiceFor: { none: {} },
      NOT: { email: 'service-account@pulsar.local' },
      AND: [
        ...(query.teamId ? [{ id: { in: employees.map((e) => e.userId!) } }] : []),
        ...(query.userId ? [{ id: query.userId }] : []),
      ],
    };
    const [people, peopleTotal] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: servicePersonSelect,
        orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
      this.db.user.count({ where }),
    ]);
    const jobWhere: Prisma.ServiceJobWhereInput = {
      tenantId,
      status: { in: ['PLANNED', 'IN_PROGRESS'] },
      assigneeUserId: { in: people.map((p) => p.id) },
      scheduledAt: { gte: new Date(start.getTime() - 7 * 86400000), lt: end },
    };
    const [jobs, jobsTotal] = await this.db.$transaction([
      this.db.serviceJob.findMany({
        where: jobWhere,
        select: {
          id: true,
          number: true,
          title: true,
          assigneeUserId: true,
          scheduledAt: true,
          plannedMinutes: true,
          status: true,
          updatedAt: true,
          projectId: true,
          workCenterId: true,
        },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
      this.db.serviceJob.count({ where: jobWhere }),
    ]);
    const employeeIds = employees
      .filter((e) => people.some((p) => p.id === e.userId))
      .map((e) => e.id);
    const leaves =
      hrAllowed && employeeIds.length
        ? await this.db.hrLeaveRequest.findMany({
            where: {
              tenantId,
              employeeId: { in: employeeIds },
              status: 'APPROVED',
              startDate: { lt: new Date(hrAvailabilityDate(end.toISOString(), config.timeZone)) },
              endDate: { gte: new Date(query.date) },
            },
            select: { employeeId: true, startDate: true, endDate: true },
          })
        : [];
    const days = Array.from({ length: query.days ?? 7 }, (_, i) =>
      new Date(Date.parse(query.date + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10),
    );
    return {
      timeZone: config.timeZone,
      days,
      checkedAt: new Date().toISOString(),
      truncated: peopleTotal > people.length || jobsTotal > jobs.length,
      peopleTotal,
      people: people.map((p) => {
        const e = employees.find((e) => e.userId === p.id);
        return {
          ...p,
          team: e?.team?.name ?? null,
          teamId: e?.teamId ?? null,
          hrVerified: !!e && hrAllowed,
          absentDays: days.filter(
            (d) =>
              e &&
              leaves.some(
                (l) =>
                  l.employeeId === e.id &&
                  l.startDate.toISOString().slice(0, 10) <= d &&
                  l.endDate.toISOString().slice(0, 10) >= d,
              ),
          ),
        };
      }),
      jobs: jobs.filter(
        (j) =>
          !j.plannedMinutes ||
          j.scheduledAt!.getTime() + j.plannedMinutes * 60000 > start.getTime(),
      ),
      unplanned: await this.db.serviceJob.count({
        where: {
          tenantId,
          status: { in: ['PLANNED', 'IN_PROGRESS'] },
          OR: [{ scheduledAt: null }, { assigneeUserId: null }, { plannedMinutes: null }],
        },
      }),
    };
  }
  async check(actor: AuthUser, id: string, dto: ScheduleServiceJobDto) {
    await this.access(actor);
    const enabled = await this.modules.getEnabledKeys(actor.tenantId);
    if (enabled.has('hr') && !actor.permissions.includes(PERMISSIONS.HR.AVAILABILITY_READ))
      throw new ForbiddenException('Le contrôle du planning requiert hr.availability.read.');
    return this.db.$transaction(async (tx) => this.inspect(tx, actor, id, dto), {
      isolationLevel: 'RepeatableRead',
    });
  }
  private async inspect(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    id: string,
    dto: ScheduleServiceJobDto,
  ) {
    const tenantId = actor.tenantId;
    const job = await tx.serviceJob.findFirst({
      where: { tenantId, id },
      select: { id: true, updatedAt: true, status: true, project: { select: { status: true } } },
    });
    if (!job) throw new NotFoundException();
    nextBusinessVersion(job, dto.expectedUpdatedAt);
    if (!['PLANNED', 'IN_PROGRESS'].includes(job.status) || job.project.status !== 'ACTIVE')
      throw new ConflictException('L’intervention et son projet doivent être ouverts.');
    await assertServicePerson(tx, this.ownership, tenantId, dto.assigneeUserId);
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const timeZone = connectedOperationsSettings(
      (tenant.settings as Record<string, unknown>).connectedOperations,
    ).timeZone;
    let instant: string;
    try {
      instant = serviceLocalToInstant(dto.localStart, timeZone);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const slot = {
      assigneeUserId: dto.assigneeUserId,
      scheduledAt: new Date(instant),
      plannedMinutes: dto.plannedMinutes,
    };
    const issues: string[] = [];
    try {
      await assertServiceSlot(tx, tenantId, slot, id);
    } catch (e) {
      if (e instanceof ConflictException) issues.push(e.message);
      else throw e;
    }
    const enabled = await this.modules.getEnabledKeys(tenantId);
    const employee = enabled.has('hr')
      ? await tx.hrEmployee.findFirst({
          where: { tenantId, userId: dto.assigneeUserId, active: true },
          select: { id: true },
        })
      : null;
    const incomplete = await tx.serviceJob.count({
      where: {
        tenantId,
        id: { not: id },
        assigneeUserId: dto.assigneeUserId,
        status: { in: ['PLANNED', 'IN_PROGRESS'] },
        plannedMinutes: null,
        scheduledAt: {
          gte: new Date(slot.scheduledAt.getTime() - 86400000),
          lt: new Date(slot.scheduledAt.getTime() + slot.plannedMinutes * 60000),
        },
      },
    });
    const warnings = [
      ...(!employee ? ['Disponibilité RH non vérifiée : module ou dossier employé absent.'] : []),
      ...(incomplete ? ['D’autres interventions sans durée peuvent occuper cette personne.'] : []),
    ];
    return {
      ...slot,
      timeZone,
      end: new Date(slot.scheduledAt.getTime() + dto.plannedMinutes * 60000),
      issues,
      warnings,
      checkedAt: new Date().toISOString(),
    };
  }
  async schedule(actor: AuthUser, id: string, dto: ScheduleServiceJobDto) {
    await this.access(actor, true);
    const enabled = await this.modules.getEnabledKeys(actor.tenantId);
    if (enabled.has('hr') && !actor.permissions.includes(PERMISSIONS.HR.AVAILABILITY_READ))
      throw new ForbiddenException('Le contrôle du planning requiert hr.availability.read.');
    const result = await this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, actor.tenantId);
      const check = await this.inspect(tx, actor, id, dto);
      if (check.issues.length) throw new ConflictException(check.issues.join(' '));
      if (check.warnings.length && !dto.acknowledgeUnknown)
        throw new ConflictException(
          'Confirmez explicitement les contrôles incomplets avant de planifier.',
        );
      const old = await tx.serviceJob.findFirstOrThrow({ where: { tenantId: actor.tenantId, id } });
      const row = await tx.serviceJob.update({
        where: { id, tenantId: actor.tenantId },
        data: {
          assigneeUserId: dto.assigneeUserId,
          scheduledAt: check.scheduledAt,
          plannedMinutes: dto.plannedMinutes,
          updatedAt: nextBusinessVersion(old, dto.expectedUpdatedAt),
        },
      });
      return {
        row,
        before: {
          assigneeUserId: old.assigneeUserId,
          scheduledAt: old.scheduledAt,
          plannedMinutes: old.plannedMinutes,
        },
        warnings: check.warnings,
      };
    });
    await this.audit.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      entityType: 'service-job',
      entityId: id,
      action: AuditAction.UPDATE,
      before: result.before,
      after: {
        assigneeUserId: result.row.assigneeUserId,
        scheduledAt: result.row.scheduledAt,
        plannedMinutes: result.row.plannedMinutes,
        warnings: result.warnings,
      },
    });
    return result.row;
  }
  async requirements(actor: AuthUser, id: string, dto?: ServiceRequirementsDto) {
    await this.access(actor, !!dto);
    const enabled = await this.modules.getEnabledKeys(actor.tenantId);
    if (!enabled.has('hr') || !actor.permissions.includes(PERMISSIONS.HR.QUALIFICATIONS_READ))
      throw new ForbiddenException('RH et hr.qualifications.read requis.');
    const manufacturing =
      enabled.has('manufacturing') && actor.permissions.includes(PERMISSIONS.MANUFACTURING.READ);
    if (dto?.workCenterId !== undefined && !manufacturing)
      throw new ForbiddenException('Lecture Fabrication requise.');
    return this.db.$transaction(async (tx) => {
      if (dto) await lockBusinessTenant(tx, actor.tenantId);
      const job = await tx.serviceJob.findFirst({ where: { tenantId: actor.tenantId, id } });
      if (!job) throw new NotFoundException();
      if (dto) {
        if (!['PLANNED', 'IN_PROGRESS'].includes(job.status))
          throw new ConflictException('Intervention fermée.');
        for (const skillId of dto.skillIds) {
          await this.ownership.assertOwned('hrSkill', skillId, actor.tenantId, tx);
          if (
            !(await tx.hrSkill.findFirst({
              where: { tenantId: actor.tenantId, id: skillId, active: true },
            }))
          )
            throw new BadRequestException('Compétence inactive.');
        }
        if (dto.workCenterId)
          await this.ownership.assertOwned('workCenter', dto.workCenterId, actor.tenantId, tx);
        await tx.serviceJobSkillRequirement.deleteMany({
          where: { tenantId: actor.tenantId, jobId: id },
        });
        await tx.serviceJobSkillRequirement.createMany({
          data: dto.skillIds.map((skillId) => ({ tenantId: actor.tenantId, jobId: id, skillId })),
        });
        await tx.serviceJob.updateMany({
          where: { tenantId: actor.tenantId, id },
          data: {
            workCenterId: dto.workCenterId,
            updatedAt: nextBusinessVersion(job, dto.expectedUpdatedAt),
          },
        });
        await assertServiceSlot(tx, actor.tenantId, job, id);
      }
      const skills = await tx.serviceJobSkillRequirement.findMany({
        where: { tenantId: actor.tenantId, jobId: id },
        select: { skillId: true, skill: { select: { name: true } } },
      });
      return {
        ...(manufacturing
          ? { workCenterId: dto?.workCenterId === undefined ? job.workCenterId : dto.workCenterId }
          : {}),
        skillIds: skills.map((s) => s.skillId),
        names: Object.fromEntries(skills.map((s) => [s.skillId, s.skill.name])),
      };
    });
  }
}
