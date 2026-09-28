import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditAction, AuthUser, canTransitionServiceAcceptance } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import {
  assertServicePerson,
  lockBusinessTenant,
  nextBusinessVersion,
  servicePersonSelect,
} from './business-lock';
import type { RecordServiceAcceptanceDto } from './services-acceptance.controller';

const recordSelect = {
  id: true,
  fromStatus: true,
  toStatus: true,
  representative: true,
  reference: true,
  note: true,
  snapshot: true,
  jobVersion: true,
  createdAt: true,
  actor: { select: servicePersonSelect },
} as const;

@Injectable()
export class ServicesAcceptanceService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}

  async history(tenantId: string, jobId: string, page: number) {
    return this.db.$transaction(
      async (tx) => {
        const job = await tx.serviceJob.findFirst({
          where: { tenantId, id: jobId },
          select: {
            id: true,
            number: true,
            title: true,
            report: true,
            completedAt: true,
            status: true,
            acceptanceStatus: true,
            updatedAt: true,
            project: { select: { status: true, acceptanceRequired: true } },
          },
        });
        if (!job) throw new NotFoundException('Intervention introuvable.');
        const where = { tenantId, jobId };
        const [items, total] = await Promise.all([
          tx.serviceAcceptanceRecord.findMany({
            where,
            select: recordSelect,
            take: 20,
            skip: (page - 1) * 20,
            orderBy: [{ jobVersion: 'desc' }, { id: 'desc' }],
          }),
          tx.serviceAcceptanceRecord.count({ where }),
        ]);
        return { job, items, total, page, pageSize: 20 };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async record(actor: AuthUser, jobId: string, dto: RecordServiceAcceptanceDto) {
    const tenantId = actor.tenantId;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          actor: actor.id,
          jobId,
          expectedUpdatedAt: dto.expectedUpdatedAt,
          status: dto.status,
          representative: dto.representative,
          reference: dto.reference,
          note: dto.note,
          confirm: dto.confirm,
        }),
      )
      .digest('hex');
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      await assertServicePerson(tx, this.ownership, tenantId, actor.id);
      const existing = await tx.serviceAcceptanceRecord.findFirst({
        where: { tenantId, operationKey: dto.operationKey },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException('Cette clé désigne une autre décision.');
        return { id: existing.id, created: false };
      }
      const job = await tx.serviceJob.findFirst({
        where: { tenantId, id: jobId },
        include: { project: true },
      });
      if (!job) throw new NotFoundException('Intervention introuvable.');
      const updatedAt = nextBusinessVersion(job, dto.expectedUpdatedAt);
      if (job.status !== 'COMPLETED' || job.project.status !== 'ACTIVE' || !job.report.trim())
        throw new ConflictException(
          'Terminez l’intervention dans un projet actif avant de consigner la décision.',
        );
      if (!canTransitionServiceAcceptance(job.acceptanceStatus, dto.status))
        throw new ConflictException(
          'Les travaux sont déjà acceptés. Utilisez un suivi SAV ou une nouvelle intervention pour une correction.',
        );
      const record = await tx.serviceAcceptanceRecord.create({
        data: {
          tenantId,
          jobId,
          actorId: actor.id,
          fromStatus: job.acceptanceStatus,
          toStatus: dto.status,
          representative: dto.representative,
          reference: dto.reference,
          note: dto.note,
          snapshot: {
            jobNumber: job.number,
            title: job.title,
            report: job.report,
            completedAt: job.completedAt?.toISOString() ?? null,
            projectId: job.projectId,
            projectNumber: job.project.number,
            partnerId: job.project.partnerId,
            acceptanceRequired: job.project.acceptanceRequired,
            scope: 'completed-work-report-v1',
          },
          jobVersion: job.updatedAt.toISOString(),
          operationKey: dto.operationKey,
          fingerprint,
        },
      });
      const claimed = await tx.serviceJob.updateMany({
        where: {
          tenantId,
          id: jobId,
          updatedAt: job.updatedAt,
          acceptanceStatus: job.acceptanceStatus,
        },
        data: { acceptanceStatus: dto.status, updatedAt },
      });
      if (claimed.count !== 1) throw new ConflictException('Le dossier a changé. Rechargez-le.');
      await this.audit.log(
        {
          tenantId,
          userId: actor.id,
          entityType: 'service-job',
          entityId: jobId,
          action: AuditAction.STATUS_CHANGE,
          before: { acceptanceStatus: job.acceptanceStatus },
          after: { acceptanceStatus: dto.status, acceptanceRecordId: record.id },
        },
        tx,
      );
      return { id: record.id, created: true };
    });
  }
}
