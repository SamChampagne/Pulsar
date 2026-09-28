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
  calendarDate,
  canTransitionSupplierCredit,
  supplierCreditBalance,
  supplierInvoiceNumberKey,
  validateSupplierCredit,
  SupplierCreditAmounts,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import {
  assertServicePerson,
  lockBusinessTenant,
  nextBusinessVersion,
} from '../../business/business-lock';
import { SupplierCreditDto } from './supplier-credits.dto';
import { SupplierInvoiceCloseDto } from '../supplier-invoices/supplier-invoices.dto';

const hash = (u: AuthUser, id: string | null, kind: string, d: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(['supplier-credit-v1', u.id, id, kind, d]))
    .digest('hex');
@Injectable()
export class SupplierCreditsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
  ) {}
  private async invoice(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const r = await tx.supplierInvoice.findFirst({
      where: { tenantId, id },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!r) throw new NotFoundException('Facture fournisseur introuvable.');
    if (r.status !== 'QUALIFIED')
      throw new ConflictException('L’avoir exige une facture qualifiée et figée.');
    return r;
  }
  private async parent(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const r = await tx.supplierCredit.findFirst({
      where: { tenantId, id },
      include: { lines: true },
    });
    if (!r) throw new NotFoundException('Avoir fournisseur introuvable.');
    return r;
  }
  private async canWms(u: AuthUser, tx: Prisma.TransactionClient = this.db) {
    return (
      u.permissions.includes('wms.read') &&
      !!(await tx.tenantModule.findFirst({
        where: { tenantId: u.tenantId, enabled: true, module: { key: 'wms' } },
        select: { moduleId: true },
      }))
    );
  }
  async requireReturnAccess(u: AuthUser, id: string, tx: Prisma.TransactionClient = this.db) {
    const r = await this.parent(tx, u.tenantId, id);
    if (r.returnReportId && !(await this.canWms(u, tx)))
      throw new ForbiddenException(
        'Lecture WMS et module actif requis pour ce contexte de retour.',
      );
    return r;
  }
  private async returnSource(
    u: AuthUser,
    tx: Prisma.TransactionClient,
    id: string,
    supplierId: string,
    latest: boolean,
  ) {
    if (!(await this.canWms(u, tx)))
      throw new ForbiddenException('Lecture WMS et module actif requis.');
    await this.ownership.assertOwned('supplierReturnReport', id, u.tenantId, tx);
    const r = await tx.supplierReturnReport.findFirst({
      where: { tenantId: u.tenantId, id },
      include: { stockExit: true },
    });
    if (
      !r ||
      r.stockExit.supplierId !== supplierId ||
      r.stockExit.status !== 'POSTED' ||
      r.stockExit.kind !== 'SUPPLIER_RETURN'
    )
      throw new ConflictException(
        'Le suivi doit appartenir à un retour enregistré du même fournisseur.',
      );
    if (
      latest &&
      (await tx.supplierReturnReport.count({
        where: { tenantId: u.tenantId, stockExitId: r.stockExitId, revision: { gt: r.revision } },
      }))
    )
      throw new ConflictException(
        'Le suivi du retour a changé. Sélectionnez sa dernière révision et enregistrez le brouillon.',
      );
    // No purchasing snapshot, evidence URL or price exposed through the WMS context.
    return {
      reportId: r.id,
      stockExitId: r.stockExitId,
      number: r.stockExit.number,
      revision: r.revision,
      received: r.received.toFixed(),
      accepted: r.accepted.toFixed(),
      refused: r.refused.toFixed(),
      unit: r.stockExit.unitSnapshot,
      reference: r.reference,
      reportedAt: r.reportedAt.toISOString(),
    };
  }
  async returns(u: AuthUser, invoiceId: string, q: ListQueryDto) {
    if (!(await this.canWms(u)))
      throw new ForbiddenException('Lecture WMS et module actif requis.');
    const invoice = await this.invoice(this.db, u.tenantId, invoiceId);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.WmsStockExitWhereInput = {
      tenantId: u.tenantId,
      supplierId: invoice.supplierId,
      status: 'POSTED',
      kind: 'SUPPLIER_RETURN',
      supplierReports: { some: {} },
      ...(q.search ? { number: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.wmsStockExit.findMany({
        where,
        orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          number: true,
          unitSnapshot: true,
          supplierReports: {
            orderBy: { revision: 'desc' },
            take: 1,
            select: { id: true, revision: true, accepted: true, reference: true },
          },
        },
      }),
      this.db.wmsStockExit.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({
        id: r.supplierReports[0].id,
        name: `${r.number} · révision ${r.supplierReports[0].revision}`,
        detail: `Accepté : ${r.supplierReports[0].accepted} ${r.unitSnapshot} · ${r.supplierReports[0].reference}`,
      })),
      total,
      page,
      pageSize,
    );
  }
  private async balance(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
    candidate?: SupplierCreditAmounts,
  ) {
    const invoice = await this.invoice(tx, tenantId, invoiceId);
    const rows = await tx.supplierCredit.findMany({
      where: { tenantId, invoiceId, status: 'QUALIFIED' },
      include: { lines: true },
    });
    const amounts = rows.map((r) => ({
      lines: r.lines.map((l) => ({
        invoiceLineId: l.invoiceLineId,
        netAmount: l.netAmount.toFixed(2),
      })),
      taxes: r.taxes as unknown as SupplierCreditAmounts['taxes'],
    }));
    try {
      return supplierCreditBalance(
        {
          lines: invoice.lines.map((l) => ({ id: l.id, netAmount: l.netAmount.toFixed(2) })),
          taxes: invoice.taxes as { label: string; amount: string }[],
        },
        candidate ? [...amounts, candidate] : amounts,
      );
    } catch (e) {
      throw new ConflictException((e as Error).message);
    }
  }
  async list(u: AuthUser, invoiceId: string, q: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    return this.db.$transaction(
      async (tx) => {
        const balance = await this.balance(tx, u.tenantId, invoiceId);
        const where = { tenantId: u.tenantId, invoiceId };
        const rows = await tx.supplierCredit.findMany({
          where,
          skip,
          take,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            number: true,
            externalNumber: true,
            status: true,
            totalAmount: true,
            creditDate: true,
            updatedAt: true,
          },
        });
        return {
          ...paginated(rows, await tx.supplierCredit.count({ where }), page, pageSize),
          balance,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async get(u: AuthUser, id: string) {
    const r = await this.parent(this.db, u.tenantId, id),
      visible = await this.canWms(u);
    const invoice = await this.invoice(this.db, u.tenantId, r.invoiceId);
    return {
      id: r.id,
      number: r.number,
      invoiceId: r.invoiceId,
      invoiceNumber: invoice.number,
      currency: invoice.currency,
      externalNumber: r.externalNumber,
      creditDate: r.creditDate,
      status: r.status,
      reason: r.reason,
      netAmount: r.netAmount,
      taxAmount: r.taxAmount,
      totalAmount: r.totalAmount,
      taxes: r.taxes,
      lines: r.lines.map((l) => ({ invoiceLineId: l.invoiceLineId, netAmount: l.netAmount })),
      updatedAt: r.updatedAt,
      closedAt: r.closedAt,
      originalEvidenceId: r.originalEvidenceId,
      qualificationNote: r.qualificationNote,
      hasReturnLink: !!r.returnReportId,
      returnVisible: visible,
      ...(visible ? { returnReportId: r.returnReportId, returnSnapshot: r.returnSnapshot } : {}),
      operations: await this.db.supplierCreditOperation.findMany({
        where: { tenantId: u.tenantId, creditId: id },
        take: 30,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          kind: true,
          createdAt: true,
          actor: { select: { firstName: true, lastName: true } },
        },
      }),
    };
  }
  async request(u: AuthUser, key: string) {
    const op = await this.db.supplierCreditOperation.findFirst({
      where: { tenantId: u.tenantId, operationKey: key, actorId: u.id },
    });
    if (!op) throw new NotFoundException('Aucun enregistrement confirmé pour cette demande.');
    if (
      !u.permissions.includes(
        op.kind === 'QUALIFIED'
          ? 'billing.supplier-credits.qualify'
          : 'billing.supplier-credits.manage',
      )
    )
      throw new ForbiddenException('Droit de reprise manquant.');
    await this.requireReturnAccess(u, op.creditId);
    return { id: op.creditId, replayed: true };
  }
  async save(u: AuthUser, id: string | null, d: SupplierCreditDto) {
    const fingerprint = hash(u, id, 'SAVE', d);
    const result = await this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, u.tenantId);
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
      const prior = await tx.supplierCreditOperation.findFirst({
        where: { tenantId: u.tenantId, operationKey: d.operationKey },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new ConflictException('Clé déjà utilisée pour une autre demande.');
        await this.requireReturnAccess(u, prior.creditId, tx);
        return { id: prior.creditId, replayed: true };
      }
      const current = id ? await this.requireReturnAccess(u, id, tx) : null;
      if (current && (current.status !== 'DRAFT' || current.invoiceId !== d.invoiceId))
        throw new ConflictException('Source immuable; seul un brouillon est modifiable.');
      if (!!current !== !!d.expectedUpdatedAt)
        throw new BadRequestException(
          'Version attendue uniquement et obligatoirement pour une édition.',
        );
      const updatedAt = current ? nextBusinessVersion(current, d.expectedUpdatedAt!) : new Date();
      let totals;
      try {
        totals = validateSupplierCredit(d);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      await this.ownership.assertOwned('supplierInvoice', d.invoiceId, u.tenantId, tx);
      const invoice = await this.invoice(tx, u.tenantId, d.invoiceId);
      if (d.creditDate < invoice.invoiceDate.toISOString().slice(0, 10))
        throw new BadRequestException('L’avoir ne peut pas précéder sa facture source.');
      for (const l of d.lines)
        await this.ownership.assertOwned('supplierInvoiceLine', l.invoiceLineId, u.tenantId, tx);
      await this.balance(tx, u.tenantId, d.invoiceId, d);
      const externalNumberKey = supplierInvoiceNumberKey(d.externalNumber);
      if (
        await tx.supplierCredit.count({
          where: {
            tenantId: u.tenantId,
            supplierId: invoice.supplierId,
            externalNumberKey,
            ...(id ? { id: { not: id } } : {}),
          },
        })
      )
        throw new ConflictException(
          'Ce numéro d’avoir existe déjà pour ce fournisseur, même annulé.',
        );
      const returnSnapshot = d.returnReportId
        ? await this.returnSource(u, tx, d.returnReportId, invoice.supplierId, true)
        : Prisma.JsonNull;
      const data = {
        externalNumber: d.externalNumber,
        externalNumberKey,
        creditDate: calendarDate(d.creditDate),
        reason: d.reason,
        taxes: d.taxes.map((t) => ({ ...t })),
        ...totals,
        returnReportId: d.returnReportId ?? null,
        returnSnapshot,
        updatedAt,
      };
      let creditId: string;
      if (current) {
        creditId = current.id;
        await tx.supplierCreditLine.deleteMany({ where: { tenantId: u.tenantId, creditId } });
        await tx.supplierCredit.update({
          where: { tenantId_id: { tenantId: u.tenantId, id: creditId } },
          data,
        });
      } else {
        creditId = (
          await tx.supplierCredit.create({
            data: {
              ...data,
              tenantId: u.tenantId,
              invoiceId: invoice.id,
              supplierId: invoice.supplierId,
              number: await this.sequences.nextNumber(u.tenantId, 'supplier-credit', tx),
            },
          })
        ).id;
      }
      await tx.supplierCreditLine.createMany({
        data: d.lines.map((l) => ({ ...l, tenantId: u.tenantId, creditId })),
      });
      await tx.supplierCreditOperation.create({
        data: {
          tenantId: u.tenantId,
          creditId,
          actorId: u.id,
          operationKey: d.operationKey,
          fingerprint,
          kind: current ? 'UPDATED' : 'CREATED',
        },
      });
      return { id: creditId, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'supplier-credit',
        entityId: result.id,
        action: id ? AuditAction.UPDATE : AuditAction.CREATE,
        after: { status: 'DRAFT', invoiceId: d.invoiceId },
      });
    return result;
  }
  async close(u: AuthUser, id: string, to: 'QUALIFIED' | 'CANCELLED', d: SupplierInvoiceCloseDto) {
    const fingerprint = hash(u, id, to, d);
    const result = await this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, u.tenantId);
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
      const r = await this.requireReturnAccess(u, id, tx);
      const prior = await tx.supplierCreditOperation.findFirst({
        where: { tenantId: u.tenantId, operationKey: d.operationKey },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ConflictException('Clé déjà utilisée.');
        return { id, replayed: true };
      }
      if (!canTransitionSupplierCredit(r.status, to))
        throw new ConflictException('Seul un brouillon peut être clos.');
      const updatedAt = nextBusinessVersion(r, d.expectedUpdatedAt);
      if (d.note.trim().length < 10)
        throw new BadRequestException('Compte rendu explicite requis.');
      if (to === 'QUALIFIED') {
        if (!d.evidenceId)
          throw new BadRequestException('Sélectionnez l’original de l’avoir reçu.');
        await this.ownership.assertOwned('supplierCreditEvidence', d.evidenceId, u.tenantId, tx);
        if (
          !(await tx.supplierCreditEvidence.count({
            where: { tenantId: u.tenantId, creditId: id, id: d.evidenceId },
          }))
        )
          throw new BadRequestException('Original étranger à cet avoir.');
        await this.balance(tx, u.tenantId, r.invoiceId, {
          lines: r.lines.map((l) => ({
            invoiceLineId: l.invoiceLineId,
            netAmount: l.netAmount.toFixed(2),
          })),
          taxes: r.taxes as unknown as SupplierCreditAmounts['taxes'],
        });
        if (r.returnReportId) await this.returnSource(u, tx, r.returnReportId, r.supplierId, true);
      } else if (d.evidenceId)
        throw new BadRequestException('Pas d’original sélectionné à l’annulation.');
      await tx.supplierCredit.update({
        where: { tenantId_id: { tenantId: u.tenantId, id } },
        data: {
          status: to,
          updatedAt,
          closedAt: new Date(),
          qualificationNote: d.note,
          originalEvidenceId: to === 'QUALIFIED' ? d.evidenceId : null,
        },
      });
      await tx.supplierCreditOperation.create({
        data: {
          tenantId: u.tenantId,
          creditId: id,
          actorId: u.id,
          operationKey: d.operationKey,
          fingerprint,
          kind: to,
        },
      });
      return { id, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'supplier-credit',
        entityId: id,
        action: AuditAction.UPDATE,
        before: { status: 'DRAFT' },
        after: { status: to, note: d.note, evidenceId: d.evidenceId ?? null },
      });
    return result;
  }
}
