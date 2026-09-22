import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  AuthUser,
  PERMISSIONS,
  ServiceTimeStatus,
  ServiceTimeReviewAction,
  canTransitionServiceTime,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { paginationArgs, paginated } from '../../common/pagination';
import {
  assertServicePerson,
  lockBusinessTenant,
  nextBusinessVersion,
  servicePersonSelect,
} from './business-lock';
import {
  CreateServiceTimeDto,
  UpdateServiceTimeDto,
  VoidServiceTimeDto,
  ServiceTimeQueryDto,
  ReviewServiceTimeDto,
  BusinessQueryDto,
} from './business.dto';

const reviewSelect = {
  id: true,
  action: true,
  fromStatus: true,
  toStatus: true,
  reason: true,
  snapshot: true,
  entryVersion: true,
  createdAt: true,
  actor: { select: servicePersonSelect },
} as const;
const timeSelect = {
  id: true,
  jobId: true,
  userId: true,
  workDate: true,
  minutes: true,
  billable: true,
  note: true,
  status: true,
  voidReason: true,
  createdAt: true,
  updatedAt: true,
  user: { select: servicePersonSelect },
  createdBy: { select: servicePersonSelect },
  reviews: { select: reviewSelect, orderBy: { entryVersion: 'desc' as const }, take: 1 },
  _count: { select: { reviews: true } },
  job: {
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      project: {
        select: { id: true, number: true, title: true, status: true },
      },
    },
  },
} as const;

@Injectable()
export class ServicesTimeService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}
  private manager(actor: AuthUser) {
    return actor.permissions.includes(PERMISSIONS.SERVICES.MANAGE);
  }
  private authorize(actor: AuthUser, personId: string) {
    if (
      !this.manager(actor) &&
      !(actor.id === personId && actor.permissions.includes(PERMISSIONS.SERVICES.TIME_WRITE))
    )
      throw new ForbiddenException(
        'La saisie du temps exige services.manage, ou services.time.write pour son propre temps.',
      );
  }
  private async locked<T>(tenantId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      return work(tx);
    });
  }
  private async job(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const job = await tx.serviceJob.findFirst({
      where: { tenantId, id },
      include: { project: { select: { status: true } } },
    });
    if (!job) throw new NotFoundException('Intervention introuvable.');
    if (job.project.status !== 'ACTIVE')
      throw new ConflictException('Les temps d’un projet fermé sont en lecture seule.');
    return job;
  }
  private async dailyLimit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    workDate: Date,
    minutes: number,
    exceptId?: string,
  ) {
    const total = await tx.serviceTimeEntry.aggregate({
      where: {
        tenantId,
        userId,
        workDate,
        status: { not: 'VOIDED' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      _sum: { minutes: true },
    });
    if ((total._sum.minutes ?? 0) + minutes > 1440)
      throw new ConflictException(
        'Le total dépasse 24 heures pour cette personne et cette date, tous projets Services confondus.',
      );
  }
  private where(tenantId: string, q: ServiceTimeQueryDto): Prisma.ServiceTimeEntryWhereInput {
    if (q.from && q.to && q.from > q.to)
      throw new BadRequestException('La date de début doit précéder la date de fin.');
    return {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.jobId ? { jobId: q.jobId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.projectId ? { job: { tenantId, projectId: q.projectId } } : {}),
      ...(q.from || q.to
        ? {
            workDate: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { note: { contains: q.search, mode: 'insensitive' } },
              { job: { number: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }
  async list(tenantId: string, q: ServiceTimeQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      where = this.where(tenantId, q);
    const [items, total, totals] = await this.db.$transaction(
      [
        this.db.serviceTimeEntry.findMany({
          where,
          select: timeSelect,
          orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
        this.db.serviceTimeEntry.count({ where }),
        this.db.serviceTimeEntry.groupBy({
          by: ['billable', 'status'],
          orderBy: { billable: 'asc' },
          where: { AND: [where, { status: { not: 'VOIDED' } }] },
          _sum: { minutes: true },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      ...paginated(items, total, page, pageSize),
      summary: {
        minutes: totals.reduce((sum, t) => sum + (t._sum?.minutes ?? 0), 0),
        billableMinutes: totals
          .filter((t) => t.billable)
          .reduce((s, t) => s + (t._sum?.minutes ?? 0), 0),
        submittedMinutes: totals
          .filter((t) => t.status === 'SUBMITTED')
          .reduce((s, t) => s + (t._sum?.minutes ?? 0), 0),
        approvedMinutes: totals
          .filter((t) => t.status === 'APPROVED')
          .reduce((s, t) => s + (t._sum?.minutes ?? 0), 0),
        approvedBillableMinutes: totals
          .filter((t) => t.status === 'APPROVED' && t.billable)
          .reduce((s, t) => s + (t._sum?.minutes ?? 0), 0),
      },
    };
  }
  async create(actor: AuthUser, dto: CreateServiceTimeDto) {
    this.authorize(actor, dto.userId);
    const tenantId = actor.tenantId;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          actor.id,
          dto.jobId,
          dto.userId,
          dto.workDate,
          dto.minutes,
          dto.billable,
          dto.note,
        ]),
      )
      .digest('hex');
    const result = await this.locked(tenantId, async (tx) => {
      const replay = await tx.serviceTimeEntry.findFirst({
        where: { tenantId, operationKey: dto.operationKey },
      });
      if (replay) {
        if (replay.requestFingerprint !== fingerprint)
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Cette clé de saisie appartient à une autre demande.',
          });
        return {
          replay: true,
          after: await tx.serviceTimeEntry.findFirstOrThrow({
            where: { tenantId, id: replay.id },
            select: timeSelect,
          }),
        };
      }
      await this.ownership.assertOwned('serviceJob', dto.jobId, tenantId, tx);
      const job = await this.job(tx, tenantId, dto.jobId);
      if (!['IN_PROGRESS', 'COMPLETED'].includes(job.status))
        throw new ConflictException('Démarrez l’intervention avant d’enregistrer du temps.');
      if (!this.manager(actor) && job.assigneeUserId !== actor.id)
        throw new ForbiddenException('Cette intervention ne vous est pas affectée.');
      await assertServicePerson(tx, this.ownership, tenantId, dto.userId);
      const workDate = new Date(dto.workDate);
      await this.dailyLimit(tx, tenantId, dto.userId, workDate, dto.minutes);
      return {
        replay: false,
        after: await tx.serviceTimeEntry.create({
          data: {
            ...dto,
            tenantId,
            createdById: actor.id,
            requestFingerprint: fingerprint,
            workDate,
          },
          select: timeSelect,
        }),
      };
    });
    if (!result.replay)
      await this.audit.log({
        tenantId,
        userId: actor.id,
        entityType: 'service-time',
        entityId: result.after.id,
        action: AuditAction.CREATE,
        after: result.after,
      });
    return result.after;
  }
  async update(actor: AuthUser, id: string, dto: UpdateServiceTimeDto) {
    const tenantId = actor.tenantId;
    const result = await this.locked(tenantId, async (tx) => {
      const old = await tx.serviceTimeEntry.findFirst({
        where: { tenantId, id },
        select: timeSelect,
      });
      if (!old) throw new NotFoundException('Temps introuvable.');
      this.authorize(actor, old.userId);
      await this.job(tx, tenantId, old.jobId);
      if (!['RECORDED', 'REJECTED'].includes(old.status))
        throw new ConflictException(
          'Retirez la soumission ou faites rouvrir l’approbation avant de corriger ce temps.',
        );
      const { expectedUpdatedAt, ...data } = dto;
      const updatedAt = nextBusinessVersion(old, expectedUpdatedAt),
        workDate = new Date(dto.workDate);
      await this.dailyLimit(tx, tenantId, old.userId, workDate, dto.minutes, id);
      await tx.serviceTimeEntry.updateMany({
        where: { tenantId, id, updatedAt: old.updatedAt },
        data: { ...data, workDate, updatedAt },
      });
      await this.recordReview(
        tx,
        actor,
        old,
        { ...old, ...data, workDate, updatedAt },
        ServiceTimeReviewAction.CORRECT,
      );
      return {
        before: old,
        after: await tx.serviceTimeEntry.findFirstOrThrow({
          where: { tenantId, id },
          select: timeSelect,
        }),
      };
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      entityType: 'service-time',
      entityId: id,
      action: AuditAction.UPDATE,
      ...result,
    });
    return result.after;
  }
  async void(actor: AuthUser, id: string, dto: VoidServiceTimeDto) {
    const tenantId = actor.tenantId;
    const result = await this.locked(tenantId, async (tx) => {
      const old = await tx.serviceTimeEntry.findFirst({
        where: { tenantId, id },
        select: timeSelect,
      });
      if (!old) throw new NotFoundException('Temps introuvable.');
      this.authorize(actor, old.userId);
      await this.job(tx, tenantId, old.jobId);
      const updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (!canTransitionServiceTime(old.status as ServiceTimeStatus, ServiceTimeStatus.VOIDED))
        throw new ConflictException('Seul un temps à soumettre ou à corriger peut être annulé.');
      await tx.serviceTimeEntry.updateMany({
        where: { tenantId, id, updatedAt: old.updatedAt, status: old.status },
        data: { status: 'VOIDED', voidReason: dto.reason, updatedAt },
      });
      await this.recordReview(
        tx,
        actor,
        old,
        { ...old, status: ServiceTimeStatus.VOIDED, updatedAt },
        ServiceTimeReviewAction.VOID,
        dto.reason,
      );
      return {
        before: old,
        after: await tx.serviceTimeEntry.findFirstOrThrow({
          where: { tenantId, id },
          select: timeSelect,
        }),
      };
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      entityType: 'service-time',
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      ...result,
    });
    return result.after;
  }

  private async recordReview(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    before: {
      id: string;
      workDate: Date;
      minutes: number;
      billable: boolean;
      note: string;
      status: string;
      updatedAt: Date;
    },
    after: typeof before,
    action: ServiceTimeReviewAction,
    reason?: string,
  ) {
    const snapshot = (v: typeof before) => ({
      workDate: v.workDate.toISOString().slice(0, 10),
      minutes: v.minutes,
      billable: v.billable,
      note: v.note,
    });
    await tx.serviceTimeReview.create({
      data: {
        tenantId: actor.tenantId,
        timeEntryId: before.id,
        actorId: actor.id,
        action,
        fromStatus: before.status as ServiceTimeStatus,
        toStatus: after.status as ServiceTimeStatus,
        reason: reason ?? null,
        entryVersion: after.updatedAt,
        snapshot: { before: snapshot(before), after: snapshot(after) },
      },
    });
  }

  async reviews(tenantId: string, id: string, q: BusinessQueryDto) {
    if (
      !(await this.db.serviceTimeEntry.findFirst({ where: { tenantId, id }, select: { id: true } }))
    )
      throw new NotFoundException('Temps introuvable.');
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where = { tenantId, timeEntryId: id };
    const [items, total] = await this.db.$transaction([
      this.db.serviceTimeReview.findMany({
        where,
        select: reviewSelect,
        orderBy: { entryVersion: 'desc' },
        skip,
        take,
      }),
      this.db.serviceTimeReview.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async review(actor: AuthUser, id: string, dto: ReviewServiceTimeDto) {
    const tenantId = actor.tenantId;
    const result = await this.locked(tenantId, async (tx) => {
      const old = await tx.serviceTimeEntry.findFirst({
        where: { tenantId, id },
        select: timeSelect,
      });
      if (!old) throw new NotFoundException('Temps introuvable.');
      const reviewerAction = ['APPROVE', 'REJECT', 'REOPEN'].includes(dto.action);
      if (
        dto.action === 'REOPEN' &&
        (await tx.customerInvoiceLine.count({
          where: { serviceTimeEntryId: id, customerInvoice: { tenantId } },
        }))
      )
        throw new ConflictException(
          'Cette heure est liée à une facture. Supprimez le brouillon ou faites traiter la correction financière avant toute réouverture.',
        );
      if (reviewerAction) {
        if (!actor.permissions.includes(PERMISSIONS.SERVICES.TIME_APPROVE))
          throw new ForbiddenException('Le droit services.time.approve est requis.');
        if (old.userId === actor.id || old.createdBy.id === actor.id)
          throw new ForbiddenException(
            'Une autre personne doit valider les temps vous concernant ou saisis par vous.',
          );
        const lastCorrection = await tx.serviceTimeReview.findFirst({
          where: { tenantId, timeEntryId: id, action: 'CORRECT' },
          orderBy: { entryVersion: 'desc' },
          select: { actorId: true },
        });
        if (lastCorrection?.actorId === actor.id)
          throw new ForbiddenException(
            'Une autre personne doit valider votre dernière correction.',
          );
        await assertServicePerson(tx, this.ownership, tenantId, actor.id);
      } else this.authorize(actor, old.userId);
      await this.job(tx, tenantId, old.jobId);
      const updatedAt = nextBusinessVersion(old, dto.expectedUpdatedAt);
      if (['REJECT', 'REOPEN'].includes(dto.action) && !dto.reason?.trim())
        throw new BadRequestException(
          'Un motif est obligatoire pour demander une correction ou rouvrir une approbation.',
        );
      const transitions: Record<string, { from: string[]; to: ServiceTimeStatus }> = {
        SUBMIT: { from: ['RECORDED', 'REJECTED'], to: ServiceTimeStatus.SUBMITTED },
        WITHDRAW: { from: ['SUBMITTED'], to: ServiceTimeStatus.RECORDED },
        APPROVE: { from: ['SUBMITTED'], to: ServiceTimeStatus.APPROVED },
        REJECT: { from: ['SUBMITTED'], to: ServiceTimeStatus.REJECTED },
        REOPEN: { from: ['APPROVED'], to: ServiceTimeStatus.RECORDED },
      };
      const transition = transitions[dto.action];
      if (
        !transition?.from.includes(old.status) ||
        !canTransitionServiceTime(old.status as ServiceTimeStatus, transition.to)
      )
        throw new ConflictException(
          'Cette action ne correspond plus à l’état du temps. Rechargez le registre.',
        );
      const changed = await tx.serviceTimeEntry.updateMany({
        where: { tenantId, id, status: old.status, updatedAt: old.updatedAt },
        data: { status: transition.to, updatedAt },
      });
      if (changed.count !== 1)
        throw new ConflictException('Ce temps a changé. Rechargez le registre.');
      await this.recordReview(
        tx,
        actor,
        old,
        { ...old, status: transition.to, updatedAt },
        dto.action,
        dto.reason,
      );
      return {
        before: old,
        after: await tx.serviceTimeEntry.findFirstOrThrow({
          where: { tenantId, id },
          select: timeSelect,
        }),
      };
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      entityType: 'service-time',
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      ...result,
    });
    return result.after;
  }
}
