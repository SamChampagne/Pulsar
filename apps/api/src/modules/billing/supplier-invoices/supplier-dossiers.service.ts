import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuthUser,
  calendarDate,
  summarizeSupplierDossier,
  type SupplierDossierGroup,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginated, paginationArgs } from '../../../common/pagination';
import { SupplierDossierDirectoryDto, SupplierDossierQueryDto } from './supplier-dossiers.dto';

const identity = { id: true, code: true, name: true, active: true, isSupplier: true } as const;
type Tx = Prisma.TransactionClient;
@Injectable()
export class SupplierDossiersService {
  constructor(private readonly db: PrismaService) {}
  private eligible(tenantId: string): Prisma.BusinessPartnerWhereInput {
    return { tenantId, OR: [{ isSupplier: true }, { supplierInvoices: { some: { tenantId } } }] };
  }
  private async supplier(tx: Tx, tenantId: string, id: string) {
    const row = await tx.businessPartner.findFirst({
      where: { ...this.eligible(tenantId), id },
      select: identity,
    });
    if (!row) throw new NotFoundException('Dossier fournisseur introuvable.');
    return row;
  }
  async directory(u: AuthUser, q: SupplierDossierDirectoryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.BusinessPartnerWhereInput = {
      ...this.eligible(u.tenantId),
      ...(q.activity ? { active: q.activity === 'ACTIVE' } : {}),
      ...(q.search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: q.search, mode: 'insensitive' } },
                  { code: { contains: q.search, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    };
    return this.db.$transaction(
      async (tx) =>
        paginated(
          await tx.businessPartner.findMany({
            where,
            select: identity,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip,
            take,
          }),
          await tx.businessPartner.count({ where }),
          page,
          pageSize,
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  /** Financial projection only. Never select purchase/return snapshots or operational IDs. */
  private documents(tenant: string, supplier: string) {
    return Prisma.sql`
      SELECT 'INVOICE'::text AS kind, i.id, i.id AS "invoiceId", i.number, i."externalNumber",
        i.number AS "invoiceNumber", i."invoiceDate" AS "documentDate", i."createdAt", i.currency,
        i.status::text AS status, i."totalAmount", i."originalEvidenceId", i."supplierSnapshot"->>'name' AS "supplierNameSnapshot"
      FROM supplier_invoices i WHERE i."tenantId"=${tenant} AND i."supplierId"=${supplier}
      UNION ALL
      SELECT 'CREDIT'::text, c.id, i.id, c.number, c."externalNumber", i.number, c."creditDate", c."createdAt",
        i.currency, c.status::text, c."totalAmount", c."originalEvidenceId", i."supplierSnapshot"->>'name'
      FROM supplier_credits c JOIN supplier_invoices i ON i.id=c."invoiceId" AND i."tenantId"=c."tenantId" AND i."supplierId"=c."supplierId"
      WHERE c."tenantId"=${tenant} AND c."supplierId"=${supplier}`;
  }
  private filters(q: SupplierDossierQueryDto, evidence = false) {
    const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
    try {
      if (q.from) parts.push(Prisma.sql`"documentDate">=${calendarDate(q.from)}`);
      if (q.to) parts.push(Prisma.sql`"documentDate"<=${calendarDate(q.to)}`);
      if (q.from && q.to && q.from > q.to) throw Error('La fin doit suivre le début.');
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (q.kind) parts.push(Prisma.sql`kind=${q.kind}`);
    if (q.status) parts.push(Prisma.sql`status=${q.status}`);
    if (q.currency) parts.push(Prisma.sql`currency=${q.currency}`);
    // Literal substring: user-entered % and _ are not SQL wildcards.
    if (q.search) {
      const s = `%${q.search.replace(/[\\%_]/g, '\\$&')}%`;
      parts.push(
        evidence
          ? Prisma.sql`(number ILIKE ${s} OR "externalNumber" ILIKE ${s} OR "invoiceNumber" ILIKE ${s} OR "fileName" ILIKE ${s} OR caption ILIKE ${s})`
          : Prisma.sql`(number ILIKE ${s} OR "externalNumber" ILIKE ${s} OR "invoiceNumber" ILIKE ${s} OR "supplierNameSnapshot" ILIKE ${s})`,
      );
    }
    return Prisma.join(parts, ' AND ');
  }
  async overview(u: AuthUser, id: string) {
    return this.db.$transaction(
      async (tx) => {
        const supplier = await this.supplier(tx, u.tenantId, id);
        const groups = await tx.$queryRaw<SupplierDossierGroup[]>(Prisma.sql`
        WITH d AS (${this.documents(u.tenantId, id)})
        SELECT currency, kind, status, COUNT(*)::int AS count, SUM("totalAmount")::text AS amount
        FROM d GROUP BY currency, kind, status`);
        return { supplier, ...summarizeSupplierDossier(groups), asOf: new Date().toISOString() };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async list(u: AuthUser, id: string, q: SupplierDossierQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      filter = this.filters(q);
    return this.db.$transaction(
      async (tx) => {
        await this.supplier(tx, u.tenantId, id);
        const source = this.documents(u.tenantId, id);
        const items = await tx.$queryRaw<unknown[]>(Prisma.sql`
        WITH d AS (${source}) SELECT kind, id, "invoiceId", number, "externalNumber", "invoiceNumber", "documentDate", "createdAt", currency,
        status, "totalAmount"::text AS "totalAmount", ("originalEvidenceId" IS NOT NULL) AS "hasOriginal", "supplierNameSnapshot"
        FROM d WHERE ${filter} ORDER BY "documentDate" DESC, "createdAt" DESC, kind, id LIMIT ${take} OFFSET ${skip}`);
        const [count] = await tx.$queryRaw<{ total: number }[]>(
          Prisma.sql`WITH d AS (${source}) SELECT COUNT(*)::int AS total FROM d WHERE ${filter}`,
        );
        return paginated(items, count.total, page, pageSize);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async evidence(u: AuthUser, id: string, q: SupplierDossierQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q),
      filter = this.filters(q, true);
    return this.db.$transaction(
      async (tx) => {
        await this.supplier(tx, u.tenantId, id);
        const source = Prisma.sql`WITH d AS (${this.documents(u.tenantId, id)}), f AS (
        SELECT d.kind, d.id AS "parentId", d."invoiceId", d.number, d."externalNumber", d."invoiceNumber", d."documentDate", d.status, d.currency,
          e.id, e.caption, e."createdAt", doc."fileName", doc."mimeType", doc."sizeBytes", COALESCE(e.id=d."originalEvidenceId", FALSE) AS "isOriginal"
        FROM d JOIN supplier_invoice_evidence e ON d.kind='INVOICE' AND e."invoiceId"=d.id AND e."tenantId"=${u.tenantId}
        JOIN documents doc ON doc.id=e."documentId" AND doc."tenantId"=e."tenantId" AND doc."entityType"='supplier-invoice-evidence' AND doc."entityId"=d.id
        UNION ALL
        SELECT d.kind, d.id, d."invoiceId", d.number, d."externalNumber", d."invoiceNumber", d."documentDate", d.status, d.currency,
          e.id, e.caption, e."createdAt", doc."fileName", doc."mimeType", doc."sizeBytes", COALESCE(e.id=d."originalEvidenceId", FALSE)
        FROM d JOIN supplier_credit_evidence e ON d.kind='CREDIT' AND e."creditId"=d.id AND e."tenantId"=${u.tenantId}
        JOIN documents doc ON doc.id=e."documentId" AND doc."tenantId"=e."tenantId" AND doc."entityType"='supplier-credit-evidence' AND doc."entityId"=d.id
      )`;
        const items = await tx.$queryRaw<unknown[]>(
          Prisma.sql`${source} SELECT * FROM f WHERE ${filter} ORDER BY "createdAt" DESC, kind, id LIMIT ${take} OFFSET ${skip}`,
        );
        const [count] = await tx.$queryRaw<{ total: number }[]>(
          Prisma.sql`${source} SELECT COUNT(*)::int AS total FROM f WHERE ${filter}`,
        );
        return paginated(items, count.total, page, pageSize);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
