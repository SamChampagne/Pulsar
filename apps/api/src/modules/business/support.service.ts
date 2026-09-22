import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  AuthUser,
  SupportCaseStatus,
  canTransitionSupportCase,
  calendarDate,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SequencesService } from '../../prisma/sequences.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { paginationArgs, paginated } from '../../common/pagination';
import {
  lockBusinessTenant,
  nextBusinessVersion,
  assertServicePerson,
  servicePersonSelect,
} from './business-lock';
import { BusinessQueryDto, VersionDto } from './business.dto';
const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
export class CreateSupportCaseDto {
  @IsString() @Length(1, 100) partnerId!: string;
  @IsString() @Trim() @Length(1, 200) title!: string;
  @IsString() @Trim() @Length(1, 4000) description!: string;
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority!: string;
  @IsUUID('4') operationKey!: string;
}
export class UpdateSupportCaseDto extends VersionDto {
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsString()
  @Length(1, 100)
  assigneeUserId?: string | null;
  @ValidateIf((_o, v) => v !== null && v !== undefined) @IsString() @Length(10, 10) dueDate?:
    | string
    | null;
  @IsString() @Trim() @Length(1, 200) title!: string;
  @IsString() @Trim() @Length(1, 4000) description!: string;
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority!: string;
  @ValidateIf((_o, v) => v !== null && v !== undefined) @IsString() @Length(1, 100) jobId?:
    | string
    | null;
}
export class SupportTransitionDto extends VersionDto {
  @IsEnum(SupportCaseStatus) status!: SupportCaseStatus;
  @IsString() @Trim() @Length(1, 2000) note!: string;
}
export class SupportQueryDto extends BusinessQueryDto {
  @IsOptional() @IsIn(['mine', 'unassigned', 'overdue']) followup?: string;
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
  @IsOptional() @IsEnum(SupportCaseStatus) caseStatus?: SupportCaseStatus;
  @IsOptional() @IsString() @Length(1, 100) partnerId?: string;
}
const select = {
  id: true,
  number: true,
  partnerId: true,
  partner: { select: { id: true, name: true, code: true } },
  title: true,
  description: true,
  priority: true,
  status: true,
  jobId: true,
  assigneeUserId: true,
  assignee: { select: servicePersonSelect },
  dueDate: true,
  resolution: true,
  createdAt: true,
  updatedAt: true,
} as const;
@Injectable()
export class SupportService {
  constructor(
    private readonly db: PrismaService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
  ) {}
  private async locked<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      return fn(tx);
    });
  }
  async list(tenantId: string, q: SupportQueryDto, userId: string) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.SupportCaseWhereInput = {
      tenantId,
      ...(q.caseStatus ? { status: q.caseStatus } : {}),
      ...(q.partnerId ? { partnerId: q.partnerId } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.followup
        ? {
            AND: [
              { status: { in: ['OPEN', 'IN_PROGRESS'] } },
              q.followup === 'mine'
                ? { assigneeUserId: userId }
                : q.followup === 'unassigned'
                  ? { assigneeUserId: null }
                  : { dueDate: { lt: calendarDate(new Date().toISOString().slice(0, 10)) } },
            ],
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { number: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.supportCase.findMany({
        where,
        select,
        skip,
        take,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.supportCase.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async get(tenantId: string, id: string) {
    const row = await this.db.supportCase.findFirst({ where: { tenantId, id }, select });
    if (!row) throw new NotFoundException('Demande SAV introuvable.');
    return row;
  }
  async history(tenantId: string, id: string, q: BusinessQueryDto) {
    await this.get(tenantId, id);
    const { page, pageSize, skip, take } = paginationArgs(q),
      where = { tenantId, caseId: id };
    const [items, total] = await this.db.$transaction([
      this.db.supportCaseEvent.findMany({
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
      this.db.supportCaseEvent.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async jobs(actor: AuthUser, q: SupportQueryDto) {
    await this.requireServices(actor);
    if (!q.partnerId) throw new BadRequestException('Choisissez le client.');
    const { page, pageSize, skip, take } = paginationArgs(q),
      where: Prisma.ServiceJobWhereInput = {
        tenantId: actor.tenantId,
        project: { tenantId: actor.tenantId, partnerId: q.partnerId },
        ...(q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: 'insensitive' } },
                { number: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
    const [items, total] = await this.db.$transaction([
      this.db.serviceJob.findMany({
        where,
        skip,
        take,
        select: { id: true, number: true, title: true, status: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.serviceJob.count({ where }),
    ]);
    return paginated(
      items.map((j) => ({ ...j, name: `${j.number} · ${j.title}` })),
      total,
      page,
      pageSize,
    );
  }
  private async requireServices(actor: AuthUser) {
    if (
      !actor.permissions.includes('services.read') ||
      !(await this.modules.getEnabledKeys(actor.tenantId)).has('services')
    )
      throw new ForbiddenException('Lier une intervention exige Services activé et services.read.');
  }
  private async event(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    id: string,
    action: string,
    note: string,
    before: unknown,
    after: unknown,
  ) {
    await tx.supportCaseEvent.create({
      data: {
        tenantId,
        actorId,
        caseId: id,
        action,
        note,
        snapshot: JSON.parse(JSON.stringify({ before, after })),
      },
    });
  }
  async create(actor: AuthUser, dto: CreateSupportCaseDto) {
    const { operationKey, ...body } = dto,
      tenantId = actor.tenantId;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([actor.id, body]))
      .digest('hex');
    const result = await this.locked(tenantId, async (tx) => {
      const previous = await tx.supportCase.findFirst({ where: { tenantId, operationKey } });
      if (previous) {
        if (previous.requestFingerprint !== fingerprint)
          throw new ConflictException('Cette clé désigne une autre demande.');
        return { id: previous.id, replayed: true };
      }
      await this.ownership.assertOwned('businessPartner', dto.partnerId, tenantId, tx);
      if (
        !(await tx.businessPartner.findFirst({
          where: { tenantId, id: dto.partnerId, active: true, isCustomer: true },
        }))
      )
        throw new ConflictException('Choisissez un client actif du Catalogue.');
      const number = await this.sequences.nextNumber(tenantId, 'support-case');
      const row = await tx.supportCase.create({
        data: { ...body, tenantId, number, operationKey, requestFingerprint: fingerprint },
        select,
      });
      await this.event(tx, tenantId, actor.id, row.id, 'CREATE', dto.description, null, row);
      return { id: row.id, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId,
        userId: actor.id,
        entityType: 'support-case',
        entityId: result.id,
        action: AuditAction.CREATE,
        after: body,
      });
    return { ...(await this.get(tenantId, result.id)), replayed: result.replayed };
  }
  async update(actor: AuthUser, id: string, dto: UpdateSupportCaseDto) {
    const tenantId = actor.tenantId;
    await this.locked(tenantId, async (tx) => {
      const old = await tx.supportCase.findFirst({ where: { tenantId, id }, select });
      if (!old) throw new NotFoundException('Demande introuvable.');
      const updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (!['OPEN', 'IN_PROGRESS'].includes(old.status))
        throw new ConflictException(
          'Rouvrez la demande résolue avant de modifier son contenu. Une clôture est définitive.',
        );
      if (dto.jobId !== undefined && dto.jobId !== old.jobId) {
        await this.requireServices(actor);
        if (dto.jobId) {
          await this.ownership.assertOwned('serviceJob', dto.jobId, tenantId, tx);
          if (
            !(await tx.serviceJob.findFirst({
              where: { tenantId, id: dto.jobId, project: { tenantId, partnerId: old.partnerId } },
            }))
          )
            throw new ConflictException('L’intervention doit concerner le même client.');
        }
      }
      const { expectedUpdatedAt, ...data } = dto;
      if (dto.assigneeUserId)
        await assertServicePerson(tx, this.ownership, tenantId, dto.assigneeUserId);
      let dueDate: Date | null | undefined;
      try {
        dueDate =
          dto.dueDate === undefined
            ? undefined
            : dto.dueDate === null
              ? null
              : calendarDate(dto.dueDate);
      } catch {
        throw new BadRequestException('Échéance invalide (AAAA-MM-JJ).');
      }
      await tx.supportCase.updateMany({
        where: { tenantId, id, updatedAt: old.updatedAt },
        data: { ...data, dueDate, updatedAt },
      });
      await this.event(
        tx,
        tenantId,
        actor.id,
        id,
        'UPDATE',
        'Qualification actualisée',
        old,
        await tx.supportCase.findFirst({ where: { tenantId, id }, select }),
      );
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      entityType: 'support-case',
      entityId: id,
      action: AuditAction.UPDATE,
      after: dto,
    });
    return this.get(tenantId, id);
  }
  async transition(actor: AuthUser, id: string, dto: SupportTransitionDto) {
    const tenantId = actor.tenantId;
    await this.locked(tenantId, async (tx) => {
      const old = await tx.supportCase.findFirst({ where: { tenantId, id }, select });
      if (!old) throw new NotFoundException('Demande introuvable.');
      const updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (!canTransitionSupportCase(old.status as SupportCaseStatus, dto.status))
        throw new ConflictException('Transition SAV interdite.');
      const result = await tx.supportCase.updateMany({
        where: { tenantId, id, status: old.status, updatedAt: old.updatedAt },
        data: {
          status: dto.status,
          updatedAt,
          ...(dto.status === 'RESOLVED' ? { resolution: dto.note } : {}),
        },
      });
      if (!result.count) throw new ConflictException('La demande a changé.');
      await this.event(
        tx,
        tenantId,
        actor.id,
        id,
        dto.status,
        dto.note,
        { status: old.status, updatedAt: old.updatedAt },
        { status: dto.status, updatedAt },
      );
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      entityType: 'support-case',
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      after: dto,
    });
    return this.get(tenantId, id);
  }
}
