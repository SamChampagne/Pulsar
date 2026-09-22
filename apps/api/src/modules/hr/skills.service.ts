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
  HrQualificationStatus,
  canTransitionHrQualification,
  calendarDate,
  qualificationDates,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { paginated, paginationArgs } from '../../common/pagination';
import {
  assertServicePerson,
  lockBusinessTenant,
  nextBusinessVersion,
} from '../business/business-lock';
import {
  CreateQualificationDto,
  CreateSkillDto,
  QualificationCheckDto,
  RequirementsDto,
  RevokeQualificationDto,
  SkillQueryDto,
  UpdateSkillDto,
} from './skills.dto';
const skillSelect = {
  id: true,
  code: true,
  name: true,
  kind: true,
  active: true,
  updatedAt: true,
} as const;
const person = { id: true, firstName: true, lastName: true } as const;
const qualificationSelect = {
  id: true,
  employeeId: true,
  employee: { select: { ...person, code: true, active: true } },
  skillId: true,
  skill: { select: skillSelect },
  validFrom: true,
  expiresOn: true,
  reference: true,
  status: true,
  createdBy: { select: person },
  createdAt: true,
  updatedAt: true,
  revokedAt: true,
  revokedBy: { select: person },
  revokeReason: true,
} as const;
function parseDates(start: string, end: string | null) {
  try {
    return qualificationDates(start, end);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}
@Injectable()
export class HrSkillsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
  ) {}
  private locked<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      return fn(tx);
    });
  }
  async skills(tenantId: string, q: SkillQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.HrSkillWhereInput = {
        tenantId,
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
      this.db.hrSkill.findMany({
        where,
        select: skillSelect,
        skip,
        take,
        orderBy: { code: 'asc' },
      }),
      this.db.hrSkill.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async createSkill(u: AuthUser, dto: CreateSkillDto) {
    return this.locked(u.tenantId, async (tx) => {
      if (await tx.hrSkill.count({ where: { tenantId: u.tenantId, code: dto.code } }))
        throw new ConflictException('Ce code existe déjà.');
      return tx.hrSkill.create({ data: { ...dto, tenantId: u.tenantId }, select: skillSelect });
    });
  }
  async updateSkill(u: AuthUser, id: string, dto: UpdateSkillDto) {
    return this.locked(u.tenantId, async (tx) => {
      const old = await tx.hrSkill.findFirst({ where: { tenantId: u.tenantId, id } });
      if (!old) throw new NotFoundException();
      return tx.hrSkill.update({
        where: { tenantId: u.tenantId, id: old.id },
        data: {
          name: dto.name,
          active: dto.active,
          updatedAt: nextBusinessVersion(old, dto.expectedUpdatedAt),
        },
        select: skillSelect,
      });
    });
  }
  async qualifications(u: AuthUser, q: SkillQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.HrQualificationWhereInput = {
        tenantId: u.tenantId,
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.search
          ? {
              OR: [
                { employee: { lastName: { contains: q.search, mode: 'insensitive' } } },
                { employee: { code: { contains: q.search, mode: 'insensitive' } } },
                { skill: { name: { contains: q.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
    const [items, total] = await this.db.$transaction([
      this.db.hrQualification.findMany({
        where,
        select: qualificationSelect,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.hrQualification.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async issue(u: AuthUser, dto: CreateQualificationDto) {
    const dates = parseDates(dto.validFrom, dto.expiresOn),
      { operationKey, ...body } = dto;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ actor: u.id, ...body }))
      .digest('hex');
    const result = await this.locked(u.tenantId, async (tx) => {
      const previous = await tx.hrQualification.findUnique({
        where: { tenantId_operationKey: { tenantId: u.tenantId, operationKey } },
      });
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return {
          row: await tx.hrQualification.findFirstOrThrow({
            where: { tenantId: u.tenantId, id: previous.id },
            select: qualificationSelect,
          }),
          replayed: true,
        };
      }
      await this.ownership.assertOwned('hrEmployee', dto.employeeId, u.tenantId, tx);
      await this.ownership.assertOwned('hrSkill', dto.skillId, u.tenantId, tx);
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
      const employee = await tx.hrEmployee.findFirstOrThrow({
        where: { tenantId: u.tenantId, id: dto.employeeId },
      });
      if (employee.userId === u.id)
        throw new ForbiddenException(
          'Une autre personne habilitée doit attester votre qualification.',
        );
      if (
        !employee.active ||
        !(await tx.hrSkill.findFirstOrThrow({ where: { tenantId: u.tenantId, id: dto.skillId } }))
          .active
      )
        throw new ConflictException('Employé et compétence doivent être actifs.');
      const row = await tx.hrQualification.create({
        data: {
          tenantId: u.tenantId,
          employeeId: dto.employeeId,
          skillId: dto.skillId,
          ...dates,
          reference: dto.reference,
          createdById: u.id,
          operationKey,
          fingerprint,
        },
        select: qualificationSelect,
      });
      return { row, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'hr-qualification',
        entityId: result.row.id,
        action: AuditAction.CREATE,
        after: { status: 'ACTIVE' },
      });
    return { ...result.row, replayed: result.replayed };
  }
  async revoke(u: AuthUser, id: string, dto: RevokeQualificationDto) {
    const row = await this.locked(u.tenantId, async (tx) => {
      const old = await tx.hrQualification.findFirst({
        where: { tenantId: u.tenantId, id },
        include: { employee: { select: { userId: true } } },
      });
      if (!old) throw new NotFoundException();
      if (old.employee.userId === u.id)
        throw new ForbiddenException(
          'Une autre personne habilitée doit révoquer votre qualification.',
        );
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
      if (
        !canTransitionHrQualification(
          old.status as HrQualificationStatus,
          HrQualificationStatus.REVOKED,
        )
      )
        throw new ConflictException('Déjà révoquée.');
      const updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      const claimed = await tx.hrQualification.updateMany({
        where: { tenantId: u.tenantId, id, status: old.status, updatedAt: old.updatedAt },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedById: u.id,
          revokeReason: dto.reason,
          updatedAt,
        },
      });
      if (!claimed.count)
        throw new ConflictException('Cette qualification a changé. Rechargez le registre.');
      return tx.hrQualification.findFirstOrThrow({
        where: { tenantId: u.tenantId, id },
        select: qualificationSelect,
      });
    });
    await this.audit.log({
      tenantId: u.tenantId,
      userId: u.id,
      entityType: 'hr-qualification',
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      before: { status: 'ACTIVE' },
      after: { status: 'REVOKED' },
    });
    return row;
  }
  async requireManufacturing(u: AuthUser) {
    const enabled = await this.modules.getEnabledKeys(u.tenantId);
    if (
      !enabled.has('hr') ||
      !enabled.has('manufacturing') ||
      !u.permissions.includes('hr.qualifications.read') ||
      !u.permissions.includes('manufacturing.read')
    )
      throw new ForbiddenException(
        'RH, Fabrication et les droits de consultation des qualifications sont requis.',
      );
  }
  async people(u: AuthUser, q: SkillQueryDto) {
    await this.requireManufacturing(u);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.HrEmployeeWhereInput = {
      tenantId: u.tenantId,
      active: true,
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { lastName: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.hrEmployee.findMany({
        where,
        select: { ...person, code: true },
        skip,
        take,
        orderBy: { code: 'asc' },
      }),
      this.db.hrEmployee.count({ where }),
    ]);
    return paginated(
      rows.map((e) => ({ ...e, name: `${e.firstName} ${e.lastName}` })),
      total,
      page,
      pageSize,
    );
  }
  async requirements(u: AuthUser, id: string) {
    await this.requireManufacturing(u);
    const row = await this.db.workCenter.findFirst({
      where: { tenantId: u.tenantId, id },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        updatedAt: true,
        skillRequirements: { select: { skill: { select: skillSelect } } },
      },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async setRequirements(u: AuthUser, id: string, dto: RequirementsDto) {
    await this.requireManufacturing(u);
    await this.locked(u.tenantId, async (tx) => {
      await this.ownership.assertOwned('workCenter', id, u.tenantId, tx);
      await tx.$queryRaw`SELECT id FROM work_centers WHERE "tenantId"=${u.tenantId} AND id=${id} FOR UPDATE`;
      const old = await tx.workCenter.findFirstOrThrow({ where: { tenantId: u.tenantId, id } }),
        updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (!old.isActive) throw new ConflictException('Poste inactif.');
      for (const skillId of dto.skillIds) {
        await this.ownership.assertOwned('hrSkill', skillId, u.tenantId, tx);
        if (
          !(await tx.hrSkill.findFirstOrThrow({ where: { tenantId: u.tenantId, id: skillId } }))
            .active
        )
          throw new ConflictException('Compétence inactive.');
      }
      await tx.workCenterSkillRequirement.deleteMany({
        where: { tenantId: u.tenantId, workCenterId: id },
      });
      await tx.workCenterSkillRequirement.createMany({
        data: dto.skillIds.map((skillId) => ({ tenantId: u.tenantId, workCenterId: id, skillId })),
      });
      const claimed = await tx.workCenter.updateMany({
        where: { tenantId: u.tenantId, id, updatedAt: old.updatedAt },
        data: { updatedAt },
      });
      if (!claimed.count) throw new ConflictException('Les exigences du poste ont changé.');
    });
    return this.requirements(u, id);
  }
  async check(u: AuthUser, dto: QualificationCheckDto) {
    await this.requireManufacturing(u);
    let day: Date;
    try {
      day = calendarDate(dto.date);
    } catch {
      throw new BadRequestException('Date de contrôle invalide.');
    }
    return this.db.$transaction(
      async (tx) => {
        const wc = await tx.workCenter.findFirst({
          where: { tenantId: u.tenantId, id: dto.workCenterId },
          select: {
            id: true,
            name: true,
            isActive: true,
            skillRequirements: { select: { skill: { select: skillSelect } } },
          },
        });
        const employee = await tx.hrEmployee.findFirst({
          where: { tenantId: u.tenantId, id: dto.employeeId },
          select: { ...person, active: true },
        });
        if (!wc || !employee) throw new NotFoundException();
        const qualifications = await tx.hrQualification.findMany({
          where: {
            tenantId: u.tenantId,
            employeeId: employee.id,
            status: 'ACTIVE',
            validFrom: { lte: day },
            OR: [{ expiresOn: null }, { expiresOn: { gte: day } }],
          },
          select: { skillId: true },
        });
        const skills = new Set(qualifications.map((q) => q.skillId));
        const requirements = wc.skillRequirements.map(({ skill }) => ({
          id: skill.id,
          name: skill.name,
          code: skill.code,
          kind: skill.kind,
          covered: employee.active && wc.isActive && skill.active && skills.has(skill.id),
        }));
        return {
          date: dto.date,
          employee: { id: employee.id, name: `${employee.firstName} ${employee.lastName}` },
          workCenter: { id: wc.id, name: wc.name },
          requirements,
          result: !employee.active
            ? 'EMPLOYEE_INACTIVE'
            : !wc.isActive
              ? 'WORK_CENTER_INACTIVE'
              : !requirements.length
                ? 'NO_REQUIREMENTS'
                : requirements.every((r) => r.covered)
                  ? 'MET'
                  : 'MISSING',
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
