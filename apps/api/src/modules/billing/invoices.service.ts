import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, InvoiceStatus, LoadStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';

const invoiceInclude = {
  carrier: { select: { id: true, code: true, name: true } },
  lines: {
    include: { load: { select: { id: true, loadNumber: true, completedAt: true } } },
  },
} as const;

/**
 * Carrier settlement v1: a draft invoice bundles the estimated costs of a
 * carrier's COMPLETED, not-yet-invoiced loads (the InvoiceLine.loadId unique
 * constraint guarantees a load is billed once). Approval freezes the draft.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
  ) {}

  list(tenantId: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: invoiceInclude,
    });
  }

  async get(tenantId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  /** Loads that would land on the next draft for this carrier (preview). */
  async billableLoads(tenantId: string, carrierId: string) {
    await this.ownership.assertOwned('carrier', carrierId, tenantId);
    return this.prisma.load.findMany({
      where: {
        tenantId,
        carrierId,
        status: LoadStatus.COMPLETED,
        estimatedCost: { not: null },
        invoiceLine: null,
      },
      orderBy: { completedAt: 'asc' },
      select: {
        id: true,
        loadNumber: true,
        completedAt: true,
        estimatedCost: true,
        costCurrency: true,
      },
    });
  }

  async createDraft(tenantId: string, userId: string, carrierId: string) {
    const loads = await this.billableLoads(tenantId, carrierId);
    if (loads.length === 0) {
      throw new BadRequestException('No completed, uninvoiced loads with a cost for this carrier');
    }

    const total = loads.reduce((acc, load) => acc + Number(load.estimatedCost), 0);
    const invoice = await this.prisma.invoice.create({
      data: {
        tenantId,
        invoiceNumber: await this.sequences.nextNumber(tenantId, 'invoice'),
        carrierId,
        currency: loads[0].costCurrency ?? 'CAD',
        totalAmount: Math.round(total * 100) / 100,
        lines: {
          create: loads.map((load) => ({
            loadId: load.id,
            description: `Load ${load.loadNumber}`,
            amount: load.estimatedCost!,
          })),
        },
      },
      include: invoiceInclude,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'invoice',
      entityId: invoice.id,
      after: { invoiceNumber: invoice.invoiceNumber, carrierId, lines: loads.length },
    });
    return invoice;
  }

  async approve(tenantId: string, userId: string, id: string) {
    const invoice = await this.get(tenantId, id);
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT invoices can be approved');
    }
    const approved = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.APPROVED, approvedAt: new Date() },
      include: invoiceInclude,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'invoice',
      entityId: id,
      before: { status: InvoiceStatus.DRAFT },
      after: { status: InvoiceStatus.APPROVED },
    });
    return approved;
  }
}
