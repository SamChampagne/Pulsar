import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginationArgs, paginated } from '../../../common/pagination';

const invoiceSelect = {
  id: true,
  invoiceNumber: true,
  carrierId: true,
  currency: true,
  status: true,
  totalAmount: true,
  taxAmount: true,
  amountPaid: true,
  lines: { select: { loadId: true } },
} as const;
const auditInclude = { lines: true } as const;
type AuditRecord = Prisma.IncomingCarrierInvoiceGetPayload<{ include: typeof auditInclude }>;
type InvoiceRecord = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

/** Documentary association only. Never creates/approves an invoice or transfers money. */
@Injectable()
export class FreightAccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}

  private async get(tenantId: string, id: string, db: Prisma.TransactionClient = this.prisma) {
    const record = await db.incomingCarrierInvoice.findFirst({
      where: { id, tenantId },
      include: auditInclude,
    });
    if (!record) throw new NotFoundException('Dossier d’audit introuvable.');
    return record;
  }

  private eligibility(record: AuditRecord, invoice: InvoiceRecord): string | null {
    if (!['MATCHED', 'RESOLVED', 'PAID'].includes(record.status))
      return 'Terminez le rapprochement et les litiges avant association.';
    if (!['APPROVED', 'PAID'].includes(invoice.status))
      return 'La facture comptable doit être approuvée.';
    if (record.carrierId !== invoice.carrierId || record.currency !== invoice.currency)
      return 'Le transporteur ou la devise diffère.';
    const loads = new Set(record.lines.map((l) => l.matchedLoadId));
    if (
      !record.lines.length ||
      loads.has(null) ||
      loads.size !== record.lines.length ||
      loads.size !== invoice.lines.length ||
      invoice.lines.some((l) => !loads.has(l.loadId))
    )
      return 'Les deux dossiers doivent couvrir exactement les mêmes chargements, rapprochés une seule fois.';
    const retained =
      record.resolution === 'ACCEPT_CHARGED' ? record.chargedTotal : record.matchedTotal;
    if (
      retained === null ||
      new Prisma.Decimal(invoice.totalAmount).minus(invoice.taxAmount).comparedTo(retained) !== 0
    )
      return 'Le montant hors taxes de la facture diffère du montant retenu par l’audit.';
    return null;
  }

  async read(tenantId: string, id: string, query: ListQueryDto) {
    const record = await this.get(tenantId, id);
    const { page, pageSize, skip, take } = paginationArgs(query);
    if (!record.accountingInvoiceId) {
      const where: Prisma.InvoiceWhereInput = {
        tenantId,
        carrierId: record.carrierId,
        currency: record.currency,
        status: { in: ['APPROVED', 'PAID'] },
        incomingAudit: null,
        ...(query.search ? { invoiceNumber: { contains: query.search, mode: 'insensitive' } } : {}),
      };
      const [items, total] = await this.prisma.$transaction([
        this.prisma.invoice.findMany({
          where,
          select: invoiceSelect,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.invoice.count({ where }),
      ]);
      return {
        invoice: null,
        payments: [],
        candidates: paginated(
          items.map((invoice) => ({ ...invoice, reason: this.eligibility(record, invoice) })),
          total,
          page,
          pageSize,
        ),
      };
    }
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: record.accountingInvoiceId, tenantId },
      select: invoiceSelect,
    });
    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        allocations: {
          some: { tenantId, targetType: 'CARRIER_INVOICE', targetId: record.accountingInvoiceId },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        paymentNumber: true,
        status: true,
        currency: true,
        totalAmount: true,
        reconciledAt: true,
        allocations: {
          where: { tenantId, targetType: 'CARRIER_INVOICE', targetId: record.accountingInvoiceId },
          select: { amount: true },
        },
      },
    });
    const transactions = await this.prisma.bankTransaction.findMany({
      where: {
        tenantId,
        status: 'RECONCILED',
        matchedPaymentId: { in: payments.map((p) => p.id) },
      },
      select: { id: true, matchedPaymentId: true, bankAccountId: true, date: true, amount: true },
    });
    return {
      invoice,
      candidates: paginated([], 0, page, pageSize),
      payments: payments.map((p) => ({
        ...p,
        bankTransaction: transactions.find((t) => t.matchedPaymentId === p.id) ?? null,
      })),
    };
  }

  async link(tenantId: string, userId: string, id: string, invoiceId: string) {
    await this.ownership.assertOwned('invoice', invoiceId, tenantId);
    let created = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM incoming_carrier_invoices WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const record = await this.get(tenantId, id, tx);
      if (record.accountingInvoiceId === invoiceId) return;
      if (record.accountingInvoiceId)
        throw new ConflictException('Ce dossier possède déjà une facture comptable liée.');
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, tenantId },
        select: invoiceSelect,
      });
      if (!invoice) throw new BadRequestException('Facture comptable introuvable.');
      const reason = this.eligibility(record, invoice);
      if (reason) throw new BadRequestException(reason);
      const other = await tx.incomingCarrierInvoice.findFirst({
        where: { tenantId, accountingInvoiceId: invoiceId },
        select: { id: true },
      });
      if (other) throw new ConflictException('Cette facture est déjà associée à un autre audit.');
      await tx.incomingCarrierInvoice.updateMany({
        where: { id, tenantId, accountingInvoiceId: null },
        data: { accountingInvoiceId: invoiceId },
      });
      created = true;
    });
    if (created)
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.UPDATE,
        entityType: 'incoming-carrier-invoice',
        entityId: id,
        before: { accountingInvoiceId: null },
        after: { accountingInvoiceId: invoiceId },
      });
    return { accountingInvoiceId: invoiceId };
  }
}
