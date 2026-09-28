import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  deriveSupplierReturnBalance,
  supplierReturnDecreased,
  type AuthUser,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { assertServicePerson, lockBusinessTenant } from '../../business/business-lock';
import { SupplierReturnReportDto } from './supplier-return-reports.dto';

const projection = {
  id: true,
  revision: true,
  received: true,
  accepted: true,
  refused: true,
  evidenceId: true,
  reportedAt: true,
  reference: true,
  note: true,
  correctionReason: true,
  createdAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
} as const;
@Injectable()
export class SupplierReturnReportsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}
  private async parent(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const d = await tx.wmsStockExit.findFirst({ where: { tenantId, id } });
    if (!d) throw new NotFoundException('Retour introuvable.');
    if (d.kind !== 'SUPPLIER_RETURN' || d.status !== 'POSTED' || !d.closedAt)
      throw new ConflictException('Le suivi fournisseur exige un retour physiquement enregistré.');
    return d;
  }
  async list(tenantId: string, id: string, q: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    return this.db.$transaction(
      async (tx) => {
        const d = await this.parent(tx, tenantId, id),
          where = { tenantId, stockExitId: id };
        const current = await tx.supplierReturnReport.findFirst({
          where,
          orderBy: { revision: 'desc' },
          select: projection,
        });
        const items = await tx.supplierReturnReport.findMany({
          where,
          orderBy: { revision: 'desc' },
          select: projection,
          skip,
          take,
        });
        const total = await tx.supplierReturnReport.count({ where });
        return {
          current,
          revision: current?.revision ?? 0,
          balance: deriveSupplierReturnBalance(d.quantity.toFixed(), {
            received: current?.received.toFixed() ?? '0',
            accepted: current?.accepted.toFixed() ?? '0',
            refused: current?.refused.toFixed() ?? '0',
          }),
          history: paginated(items, total, page, pageSize),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async request(u: AuthUser, id: string, key: string) {
    await this.parent(this.db, u.tenantId, id);
    const r = await this.db.supplierReturnReport.findFirst({
      where: { tenantId: u.tenantId, stockExitId: id, createdById: u.id, operationKey: key },
      select: { id: true, revision: true },
    });
    if (!r) throw new NotFoundException('Aucune déclaration confirmée pour cette demande.');
    return { ...r, replayed: true };
  }
  async create(u: AuthUser, id: string, d: SupplierReturnReportDto) {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          'supplier-return-report-v1',
          u.id,
          id,
          d.expectedRevision,
          d.received,
          d.accepted,
          d.refused,
          d.evidenceId,
          d.reportedAt,
          d.reference,
          d.note,
          d.correctionReason ?? null,
        ]),
      )
      .digest('hex');
    const result = await this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, u.tenantId);
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${u.tenantId} FOR UPDATE`;
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
      const parent = await this.parent(tx, u.tenantId, id);
      const prior = await tx.supplierReturnReport.findFirst({
        where: { tenantId: u.tenantId, operationKey: d.operationKey },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new ConflictException('Clé déjà utilisée pour une autre déclaration.');
        return { id: prior.id, revision: prior.revision, replayed: true };
      }
      const current = await tx.supplierReturnReport.findFirst({
        where: { tenantId: u.tenantId, stockExitId: id },
        orderBy: { revision: 'desc' },
      });
      if (d.expectedRevision !== (current?.revision ?? 0))
        throw new ConflictException(
          'Le suivi fournisseur a changé. Rechargez-le et revoyez les cumuls.',
        );
      try {
        deriveSupplierReturnBalance(parent.quantity.toFixed(), d);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const reportedAt = new Date(d.reportedAt);
      if (
        !Number.isFinite(reportedAt.getTime()) ||
        reportedAt < parent.closedAt! ||
        reportedAt.getTime() > Date.now()
      )
        throw new BadRequestException(
          'La date du constat doit être comprise entre la sortie physique et maintenant.',
        );
      if (
        d.reference.trim().length < 3 ||
        d.note.trim().length < 10 ||
        (d.correctionReason !== undefined && d.correctionReason.trim().length < 10)
      )
        throw new BadRequestException('Référence, compte rendu et motif doivent être explicites.');
      if (
        current &&
        (supplierReturnDecreased(
          {
            received: current.received.toFixed(),
            accepted: current.accepted.toFixed(),
            refused: current.refused.toFixed(),
          },
          d,
        ) ||
          reportedAt < current.reportedAt) &&
        !d.correctionReason
      )
        throw new BadRequestException(
          'Une baisse de cumul ou une date antérieure exige un motif de correction.',
        );
      // Composite ownership also binds the immutable evidence to this exact exit.
      const evidence = await tx.wmsStockExitEvidence.findFirst({
        where: { tenantId: u.tenantId, stockExitId: id, id: d.evidenceId },
      });
      if (!evidence) throw new NotFoundException('Choisissez un justificatif de ce retour.');
      const r = await tx.supplierReturnReport.create({
        data: {
          tenantId: u.tenantId,
          stockExitId: id,
          createdById: u.id,
          revision: d.expectedRevision + 1,
          received: d.received,
          accepted: d.accepted,
          refused: d.refused,
          evidenceId: d.evidenceId,
          reportedAt,
          reference: d.reference,
          note: d.note,
          correctionReason: d.correctionReason,
          operationKey: d.operationKey,
          fingerprint,
        },
      });
      return { id: r.id, revision: r.revision, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'supplier-return-report',
        entityId: result.id,
        action: AuditAction.CREATE,
        after: {
          stockExitId: id,
          revision: result.revision,
          received: d.received,
          accepted: d.accepted,
          refused: d.refused,
          evidenceId: d.evidenceId,
          correctionReason: d.correctionReason ?? null,
        },
      });
    return result;
  }
}
