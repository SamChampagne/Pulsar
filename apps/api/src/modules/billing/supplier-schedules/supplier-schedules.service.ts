import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  AuthUser,
  calendarDate,
  canTransitionSupplierSchedule,
  supplierCreditAmount,
  supplierCreditCents,
  validateSupplierSchedule,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { paginated, paginationArgs } from '../../../common/pagination';
import { assertServicePerson, lockBusinessTenant } from '../../business/business-lock';
import {
  SupplierScheduleConfirmDto,
  SupplierSchedulePageDto,
  SupplierScheduleQueryDto,
  SupplierScheduleReviewDto,
} from './supplier-schedules.dto';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const projection = {
  id: true,
  invoiceId: true,
  revision: true,
  status: true,
  previousRevisionId: true,
  amountSnapshot: true,
  currencySnapshot: true,
  creditsSnapshot: true,
  installments: true,
  note: true,
  createdAt: true,
  actor: { select: { firstName: true, lastName: true } },
} as const;
@Injectable()
export class SupplierSchedulesService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}
  private async context(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const invoice = await tx.supplierInvoice.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        number: true,
        supplierId: true,
        supplierSnapshot: true,
        externalNumber: true,
        status: true,
        invoiceDate: true,
        dueDate: true,
        currency: true,
        totalAmount: true,
        updatedAt: true,
      },
    });
    if (!invoice) throw new NotFoundException('Facture fournisseur introuvable.');
    if (invoice.status !== 'QUALIFIED')
      throw new ConflictException('L’échéancier exige une facture qualifiée et figée.');
    const credits = await tx.supplierCredit.findMany({
      where: { tenantId, invoiceId: id, status: 'QUALIFIED' },
      orderBy: { id: 'asc' },
      select: { id: true, number: true, totalAmount: true },
    });
    const credited = credits.reduce(
        (n, c) => n + supplierCreditCents(c.totalAmount.toFixed(2)),
        0n,
      ),
      remaining = supplierCreditCents(invoice.totalAmount.toFixed(2)) - credited;
    if (remaining < 0n)
      throw new ConflictException('Historique incohérent : les avoirs dépassent la facture.');
    const latest = await tx.supplierInvoiceSchedule.findFirst({
      where: { tenantId, invoiceId: id },
      orderBy: { revision: 'desc' },
      select: projection,
    });
    const creditsSnapshot = credits.map((c) => ({
      id: c.id,
      number: c.number,
      totalAmount: c.totalAmount.toFixed(2),
    }));
    return {
      invoice,
      credits: creditsSnapshot,
      credited: supplierCreditAmount(credited),
      remaining: supplierCreditAmount(remaining),
      latest,
    };
  }
  get(u: AuthUser, id: string) {
    return this.db.$transaction((tx) => this.context(tx, u.tenantId, id), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  async history(u: AuthUser, id: string, q: SupplierSchedulePageDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    return this.db.$transaction(
      async (tx) => {
        await this.context(tx, u.tenantId, id);
        const where = { tenantId: u.tenantId, invoiceId: id };
        return paginated(
          await tx.supplierInvoiceSchedule.findMany({
            where,
            select: projection,
            orderBy: { revision: 'desc' },
            skip,
            take,
          }),
          await tx.supplierInvoiceSchedule.count({ where }),
          page,
          pageSize,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private assessment(
    u: AuthUser,
    context: Awaited<ReturnType<SupplierSchedulesService['context']>>,
    d: SupplierScheduleReviewDto,
  ) {
    let input;
    try {
      input = validateSupplierSchedule(
        d,
        context.remaining,
        context.invoice.invoiceDate.toISOString().slice(0, 10),
      );
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (!canTransitionSupplierSchedule(context.latest?.status ?? null, input.status))
      throw new ConflictException('Cette révision n’est pas permise depuis l’état courant.');
    const expectedRevisionId = context.latest?.id ?? null;
    return {
      input,
      expectedRevisionId,
      remaining: context.remaining,
      currency: context.invoice.currency,
      revision: (context.latest?.revision ?? 0) + 1,
      reviewToken: hash([
        'supplier-schedule-review-v1',
        u.tenantId,
        u.id,
        context.invoice.id,
        context.invoice.updatedAt,
        expectedRevisionId,
        context.credits,
        input,
      ]),
    };
  }
  async review(u: AuthUser, id: string, d: SupplierScheduleReviewDto) {
    return this.db.$transaction(
      async (tx) => this.assessment(u, await this.context(tx, u.tenantId, id), d),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async confirm(u: AuthUser, id: string, d: SupplierScheduleConfirmDto) {
    const fingerprint = hash(['supplier-schedule-v1', u.tenantId, u.id, id, d]);
    const result = await this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, u.tenantId);
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
      const prior = await tx.supplierInvoiceSchedule.findFirst({
        where: { tenantId: u.tenantId, operationKey: d.operationKey },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new ConflictException('Clé déjà utilisée pour une autre demande.');
        return { id: prior.id, invoiceId: id, revision: prior.revision, replayed: true };
      }
      await this.ownership.assertOwned('supplierInvoice', id, u.tenantId, tx);
      const context = await this.context(tx, u.tenantId, id),
        review = this.assessment(u, context, d);
      if (
        review.expectedRevisionId !== d.expectedRevisionId ||
        review.reviewToken !== d.reviewToken
      )
        throw new ConflictException(
          'La facture, ses avoirs ou son échéancier ont changé. Rechargez et refaites la revue.',
        );
      const made = await tx.supplierInvoiceSchedule.create({
        data: {
          tenantId: u.tenantId,
          invoiceId: id,
          revision: review.revision,
          previousRevisionId: review.expectedRevisionId,
          status: review.input.status,
          amountSnapshot: context.remaining,
          currencySnapshot: context.invoice.currency,
          creditsSnapshot: context.credits,
          installments: review.input.installments,
          note: review.input.note,
          actorId: u.id,
          operationKey: d.operationKey,
          fingerprint,
        },
      });
      return { id: made.id, invoiceId: id, revision: made.revision, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId: u.tenantId,
        userId: u.id,
        entityType: 'supplier-invoice-schedule',
        entityId: result.id,
        action: AuditAction.CREATE,
        after: { invoiceId: id, revision: result.revision, status: d.status },
      });
    return result;
  }
  async request(u: AuthUser, key: string) {
    const r = await this.db.supplierInvoiceSchedule.findFirst({
      where: { tenantId: u.tenantId, operationKey: key, actorId: u.id },
      select: { id: true, invoiceId: true, revision: true },
    });
    if (!r) throw new NotFoundException('Aucune révision confirmée pour cette demande.');
    return { ...r, replayed: true };
  }
  /** Separate operational forecast: never joins payments or writes the legacy currency-less GL. */
  async list(u: AuthUser, q: SupplierScheduleQueryDto) {
    try {
      calendarDate(q.referenceDate);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const { page, pageSize, skip, take } = paginationArgs(q),
      conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (q.state) conditions.push(Prisma.sql`state=${q.state}`);
    if (q.currency) conditions.push(Prisma.sql`currency=${q.currency}`);
    if (q.supplierId) conditions.push(Prisma.sql`"supplierId"=${q.supplierId}`);
    if (q.search) {
      const s = `%${q.search.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(
        Prisma.sql`(number ILIKE ${s} OR "externalNumber" ILIKE ${s} OR "supplierName" ILIKE ${s})`,
      );
    }
    const source = Prisma.sql`WITH raw AS (
      SELECT i.id AS "invoiceId",i.number,i."externalNumber",i."supplierId",i."supplierSnapshot"->>'name' AS "supplierName",i.currency,i."invoiceDate",i."dueDate",i."totalAmount",COALESCE(c.amount,0) AS credited,
        i."totalAmount"-COALESCE(c.amount,0) AS remaining,s.id AS "scheduleId",s.revision,s.status,s."amountSnapshot",s.installments,
        CASE WHEN i."totalAmount"-COALESCE(c.amount,0)<0 THEN 'INCONSISTENT' WHEN s.id IS NULL THEN 'UNPLANNED' WHEN s.status='WITHDRAWN' THEN 'WITHDRAWN'
          WHEN s."amountSnapshot"<>i."totalAmount"-COALESCE(c.amount,0) THEN 'REVIEW' WHEN s."amountSnapshot"=0 THEN 'ZERO' ELSE 'CONFIRMED' END AS state
      FROM supplier_invoices i
      LEFT JOIN LATERAL (SELECT SUM("totalAmount") AS amount FROM supplier_credits c WHERE c."tenantId"=i."tenantId" AND c."invoiceId"=i.id AND c."supplierId"=i."supplierId" AND c.status='QUALIFIED') c ON TRUE
      LEFT JOIN LATERAL (SELECT s.id,s.revision,s.status,s."amountSnapshot",s.installments FROM supplier_invoice_schedules s WHERE s."tenantId"=i."tenantId" AND s."invoiceId"=i.id ORDER BY revision DESC LIMIT 1) s ON TRUE
      WHERE i."tenantId"=${u.tenantId} AND i.status='QUALIFIED'
    ), f AS (SELECT * FROM raw WHERE ${Prisma.join(conditions, ' AND ')})`;
    return this.db.$transaction(
      async (tx) => {
        const items = await tx.$queryRaw<unknown[]>(
          Prisma.sql`${source} SELECT "invoiceId",number,"externalNumber","supplierId","supplierName",currency,"invoiceDate","dueDate","totalAmount"::text AS "totalAmount",credited::text AS credited,CASE WHEN remaining>=0 THEN remaining::text ELSE NULL END AS remaining,"scheduleId",revision,state,"amountSnapshot"::text AS "amountSnapshot",COALESCE(installments,'[]'::jsonb) AS installments FROM f ORDER BY "invoiceDate" DESC,"invoiceId" LIMIT ${take} OFFSET ${skip}`,
        );
        const [count] = await tx.$queryRaw<{ total: number }[]>(
          Prisma.sql`${source} SELECT COUNT(*)::int AS total FROM f`,
        );
        const groups = await tx.$queryRaw<unknown[]>(
          Prisma.sql`${source} SELECT currency,state,COUNT(*)::int AS count,CASE WHEN state='INCONSISTENT' THEN NULL ELSE SUM(remaining)::text END AS amount FROM f GROUP BY currency,state ORDER BY currency,state`,
        );
        const buckets = await tx.$queryRaw<unknown[]>(Prisma.sql`${source}, dates AS (
        SELECT currency,(x->>'amount')::numeric AS amount,(x->>'dueDate')::date-${q.referenceDate}::date AS days FROM f CROSS JOIN LATERAL jsonb_array_elements(installments) x WHERE state='CONFIRMED'
      ) SELECT currency,CASE WHEN days<0 THEN 'OVERDUE' WHEN days=0 THEN 'TODAY' WHEN days<=7 THEN 'WITHIN_7' WHEN days<=30 THEN 'WITHIN_30' ELSE 'LATER' END AS bucket,SUM(amount)::text AS amount FROM dates GROUP BY currency,bucket ORDER BY currency,bucket`);
        return {
          ...paginated(items, count.total, page, pageSize),
          referenceDate: q.referenceDate,
          summary: { groups, buckets },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
