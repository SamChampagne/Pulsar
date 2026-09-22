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
  type AuthUser,
  HrLeaveStatus,
  canTransitionHrLeave,
  hrLeaveDates,
  calendarDate,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { paginationArgs, paginated } from '../../common/pagination';
import {
  assertServicePerson,
  lockBusinessTenant,
  nextBusinessVersion,
  servicePersonSelect,
} from '../business/business-lock';
import {
  CreateEmployeeDto,
  CreateLeaveDto,
  CreateTeamDto,
  HrQueryDto,
  LeaveTransitionDto,
  UpdateEmployeeDto,
  UpdateLeaveDto,
  UpdateTeamDto,
} from './hr.dto';

const teamSelect = { id: true, code: true, name: true, active: true, updatedAt: true } as const;
const employeeSelect = {
  id: true,
  code: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  teamId: true,
  team: { select: teamSelect },
  userId: true,
  user: { select: servicePersonSelect },
  active: true,
  updatedAt: true,
} as const;
const leaveSelect = {
  id: true,
  number: true,
  employeeId: true,
  employee: {
    select: { id: true, code: true, firstName: true, lastName: true, userId: true, active: true },
  },
  kind: true,
  startDate: true,
  endDate: true,
  note: true,
  status: true,
  createdById: true,
  updatedAt: true,
  createdAt: true,
} as const;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
function dates(start: string, end: string) {
  try {
    return hrLeaveDates(start, end);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}

@Injectable()
export class HrService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
  ) {}
  private locked<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      return fn(tx);
    });
  }
  async people(tenantId: string, q: HrQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.UserWhereInput = {
        tenantId,
        status: 'ACTIVE',
        agentServiceFor: { none: {} },
        NOT: { email: 'service-account@pulsar.local' },
        ...(q.search
          ? {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
    const [rows, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: servicePersonSelect,
        skip,
        take,
        orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
      }),
      this.db.user.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...r, name: `${r.firstName} ${r.lastName}` })),
      total,
      page,
      pageSize,
    );
  }
  async teams(tenantId: string, q: HrQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.HrTeamWhereInput = {
        tenantId,
        ...(q.active ? { active: q.active === 'true' } : {}),
        ...(q.search
          ? {
              OR: [
                { code: { contains: q.search, mode: 'insensitive' } },
                { name: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
    const [items, total] = await this.db.$transaction([
      this.db.hrTeam.findMany({
        where,
        select: teamSelect,
        skip,
        take,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.db.hrTeam.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async createTeam(u: AuthUser, dto: CreateTeamDto) {
    return this.locked(u.tenantId, async (tx) => {
      if (await tx.hrTeam.count({ where: { tenantId: u.tenantId, code: dto.code } }))
        throw new ConflictException('Ce code équipe existe déjà.');
      return tx.hrTeam.create({ data: { ...dto, tenantId: u.tenantId }, select: teamSelect });
    });
  }
  async updateTeam(u: AuthUser, id: string, dto: UpdateTeamDto) {
    return this.locked(u.tenantId, async (tx) => {
      const old = await tx.hrTeam.findFirst({ where: { tenantId: u.tenantId, id } });
      if (!old) throw new NotFoundException('Équipe introuvable.');
      const updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (
        !dto.active &&
        (await tx.hrEmployee.count({ where: { tenantId: u.tenantId, teamId: id, active: true } }))
      )
        throw new ConflictException(
          'Réaffectez les employés actifs avant de désactiver cette équipe.',
        );
      return tx.hrTeam.update({
        where: { tenantId_id: { tenantId: u.tenantId, id } },
        data: { name: dto.name, active: dto.active, updatedAt },
        select: teamSelect,
      });
    });
  }
  async employees(tenantId: string, q: HrQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.HrEmployeeWhereInput = {
        tenantId,
        ...(q.active ? { active: q.active === 'true' } : {}),
        ...(q.teamId ? { teamId: q.teamId } : {}),
        ...(q.search
          ? {
              OR: [
                { code: { contains: q.search, mode: 'insensitive' } },
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
    const [rows, total] = await this.db.$transaction([
      this.db.hrEmployee.findMany({
        where,
        select: employeeSelect,
        skip,
        take,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      }),
      this.db.hrEmployee.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...r, name: `${r.code} · ${r.firstName} ${r.lastName}` })),
      total,
      page,
      pageSize,
    );
  }
  private async team(tx: Prisma.TransactionClient, tenantId: string, id: string | null) {
    if (!id) return;
    await this.ownership.assertOwned('hrTeam', id, tenantId, tx);
    if (!(await tx.hrTeam.count({ where: { tenantId, id, active: true } })))
      throw new BadRequestException('Choisissez une équipe active.');
  }
  async createEmployee(u: AuthUser, dto: CreateEmployeeDto) {
    return this.locked(u.tenantId, async (tx) => {
      await this.team(tx, u.tenantId, dto.teamId);
      if (dto.userId) await assertServicePerson(tx, this.ownership, u.tenantId, dto.userId);
      if (
        await tx.hrEmployee.count({
          where: {
            tenantId: u.tenantId,
            OR: [{ code: dto.code }, ...(dto.userId ? [{ userId: dto.userId }] : [])],
          },
        })
      )
        throw new ConflictException('Ce matricule ou ce compte est déjà rattaché à un employé.');
      return tx.hrEmployee.create({
        data: { ...dto, tenantId: u.tenantId },
        select: employeeSelect,
      });
    });
  }
  async updateEmployee(u: AuthUser, id: string, dto: UpdateEmployeeDto) {
    return this.locked(u.tenantId, async (tx) => {
      const old = await tx.hrEmployee.findFirst({ where: { tenantId: u.tenantId, id } });
      if (!old) throw new NotFoundException('Employé introuvable.');
      const updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (dto.teamId !== old.teamId || dto.active) await this.team(tx, u.tenantId, dto.teamId);
      if (
        !dto.active &&
        (await tx.hrLeaveRequest.count({
          where: {
            tenantId: u.tenantId,
            employeeId: id,
            OR: [
              { status: 'SUBMITTED' },
              {
                status: 'APPROVED',
                endDate: { gte: calendarDate(new Date().toISOString().slice(0, 10)) },
              },
            ],
          },
        }))
      )
        throw new ConflictException(
          'Traitez ou annulez les demandes soumises et absences approuvées non terminées avant de désactiver le dossier.',
        );
      const { expectedUpdatedAt, ...data } = dto;
      return tx.hrEmployee.update({
        where: { tenantId_id: { tenantId: u.tenantId, id } },
        data: { ...data, updatedAt },
        select: employeeSelect,
      });
    });
  }
  async me(u: AuthUser) {
    return this.db.hrEmployee.findFirst({
      where: { tenantId: u.tenantId, userId: u.id },
      select: employeeSelect,
    });
  }
  private async ownEmployee(
    tx: Prisma.TransactionClient,
    u: AuthUser,
    employeeId: string,
    self: boolean,
  ) {
    await this.ownership.assertOwned('hrEmployee', employeeId, u.tenantId, tx);
    const employee = await tx.hrEmployee.findFirstOrThrow({
      where: { tenantId: u.tenantId, id: employeeId },
    });
    if (self && employee.userId !== u.id)
      throw new NotFoundException('Dossier personnel introuvable.');
    return employee;
  }
  async leaves(u: AuthUser, q: HrQueryDto, self = false) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.HrLeaveRequestWhereInput = {
        tenantId: u.tenantId,
        ...(self ? { employee: { userId: u.id } } : {}),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.search ? { number: { contains: q.search, mode: 'insensitive' } } : {}),
      };
    const [items, total] = await this.db.$transaction([
      this.db.hrLeaveRequest.findMany({
        where,
        select: leaveSelect,
        skip,
        take,
        orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
      }),
      this.db.hrLeaveRequest.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  private async leave(tx: Prisma.TransactionClient, u: AuthUser, id: string, self: boolean) {
    const row = await tx.hrLeaveRequest.findFirst({
      where: { tenantId: u.tenantId, id, ...(self ? { employee: { userId: u.id } } : {}) },
      select: leaveSelect,
    });
    if (!row) throw new NotFoundException('Demande introuvable.');
    return row;
  }
  async detail(u: AuthUser, id: string, self = false) {
    return this.leave(this.db, u, id, self);
  }
  private async event(
    tx: Prisma.TransactionClient,
    u: AuthUser,
    leaveId: string,
    action: string,
    note: string,
    before: unknown,
    after: unknown,
  ) {
    await tx.hrLeaveEvent.create({
      data: {
        tenantId: u.tenantId,
        actorId: u.id,
        leaveId,
        action,
        note,
        snapshot: json({ before, after }),
      },
    });
  }
  // General audit keeps only the decision/identity. HR notes and full snapshots stay behind hr.read/hr.self.
  private log(u: AuthUser, id: string, action: AuditAction, status: string) {
    return this.audit.log({
      tenantId: u.tenantId,
      userId: u.id,
      entityType: 'hr-leave',
      entityId: id,
      action,
      after: { status },
    });
  }
  async createLeave(u: AuthUser, dto: CreateLeaveDto, self = false) {
    const range = dates(dto.startDate, dto.endDate),
      fingerprint = createHash('sha256')
        .update(
          JSON.stringify([u.id, dto.employeeId, dto.kind, dto.startDate, dto.endDate, dto.note]),
        )
        .digest('hex');
    const result = await this.locked(u.tenantId, async (tx) => {
      const employee = await this.ownEmployee(tx, u, dto.employeeId, self);
      const replay = await tx.hrLeaveRequest.findFirst({
        where: { tenantId: u.tenantId, operationKey: dto.operationKey },
        select: { ...leaveSelect, fingerprint: true },
      });
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw new ConflictException('Cette clé désigne une autre demande.');
        const { fingerprint: _, ...row } = replay;
        return { row, replayed: true };
      }
      if (!employee.active) throw new ConflictException('Le dossier employé est inactif.');
      const row = await tx.hrLeaveRequest.create({
        data: {
          tenantId: u.tenantId,
          employeeId: dto.employeeId,
          number: await this.sequences.nextNumber(u.tenantId, 'hr-leave'),
          kind: dto.kind,
          ...range,
          note: dto.note,
          operationKey: dto.operationKey,
          fingerprint,
          createdById: u.id,
        },
        select: leaveSelect,
      });
      await this.event(tx, u, row.id, 'CREATE', 'Demande créée', null, row);
      return { row, replayed: false };
    });
    if (!result.replayed) await this.log(u, result.row.id, AuditAction.CREATE, result.row.status);
    return result.row;
  }
  async updateLeave(u: AuthUser, id: string, dto: UpdateLeaveDto, self = false) {
    const range = dates(dto.startDate, dto.endDate);
    const row = await this.locked(u.tenantId, async (tx) => {
      const old = await this.leave(tx, u, id, self),
        updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (old.status !== 'DRAFT' || !old.employee.active)
        throw new ConflictException('Seul le brouillon d’un employé actif peut être modifié.');
      const row = await tx.hrLeaveRequest.update({
        where: { tenantId_id: { tenantId: u.tenantId, id } },
        data: { ...range, kind: dto.kind, note: dto.note, updatedAt },
        select: leaveSelect,
      });
      await this.event(tx, u, id, 'UPDATE', 'Période et motif actualisés', old, row);
      return row;
    });
    await this.log(u, id, AuditAction.UPDATE, row.status);
    return row;
  }
  async transition(u: AuthUser, id: string, dto: LeaveTransitionDto, self = false) {
    const row = await this.locked(u.tenantId, async (tx) => {
      const old = await this.leave(tx, u, id, self),
        updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (!canTransitionHrLeave(old.status as HrLeaveStatus, dto.status))
        throw new ConflictException('Transition d’absence interdite.');
      const decision =
        dto.status === 'APPROVED' || dto.status === 'REJECTED' || old.status === 'APPROVED';
      if (decision) {
        await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
        if (self || !u.permissions.includes('hr.approve'))
          throw new ForbiddenException('Le droit d’approbation RH est nécessaire.');
        if (old.employee.userId === u.id || old.createdById === u.id)
          throw new ForbiddenException('Une autre personne doit décider de cette demande.');
      } else if (!self && !u.permissions.includes('hr.manage'))
        throw new ForbiddenException('Le droit de gestion RH est nécessaire.');
      if (dto.status === 'SUBMITTED' || dto.status === 'APPROVED') {
        if (!old.employee.active) throw new ConflictException('Le dossier employé est inactif.');
        if (
          await tx.hrLeaveRequest.count({
            where: {
              tenantId: u.tenantId,
              employeeId: old.employeeId,
              id: { not: id },
              status: { in: ['SUBMITTED', 'APPROVED'] },
              startDate: { lte: old.endDate },
              endDate: { gte: old.startDate },
            },
          })
        )
          throw new ConflictException(
            'Cette période chevauche une demande soumise ou une absence approuvée.',
          );
      }
      const claim = await tx.hrLeaveRequest.updateMany({
        where: { tenantId: u.tenantId, id, status: old.status, updatedAt: old.updatedAt },
        data: { status: dto.status, updatedAt },
      });
      if (claim.count !== 1) throw new ConflictException('La demande a changé.');
      const row = await this.leave(tx, u, id, self);
      await this.event(tx, u, id, 'TRANSITION', dto.note, old, row);
      return row;
    });
    await this.log(u, id, AuditAction.UPDATE, row.status);
    return row;
  }
  async history(u: AuthUser, id: string, q: HrQueryDto, self = false) {
    await this.leave(this.db, u, id, self);
    const { page, pageSize, skip, take } = paginationArgs(q),
      where = { tenantId: u.tenantId, leaveId: id };
    const [items, total] = await this.db.$transaction([
      this.db.hrLeaveEvent.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          action: true,
          note: true,
          snapshot: true,
          createdAt: true,
          actor: { select: { firstName: true, lastName: true } },
        },
      }),
      this.db.hrLeaveEvent.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
}
