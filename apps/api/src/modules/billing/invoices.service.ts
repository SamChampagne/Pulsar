import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  canTransitionInvoice,
  evaluateReconciliation,
  InvoiceStatus,
  LoadStatus,
  MODULE_KEYS,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { ReconcileInvoiceDto, ResolveDisputeDto } from './dto/reconcile.dto';
import { csvSafe } from '../../common/csv';

const invoiceInclude = {
  carrier: { select: { id: true, code: true, name: true } },
  lines: {
    include: { load: { select: { id: true, loadNumber: true, completedAt: true } } },
  },
} as const;

/**
 * Carrier settlement v1: a draft invoice bundles the estimated costs of a
 * carrier's COMPLETED, not-yet-invoiced loads (the InvoiceLine.loadId unique
 * constraint guarantees a load is billed once). Reconciled against the
 * carrier's actual invoice (tolerance on gross variance), disputed when over,
 * PAID tracked.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
  ) {}

  list(tenantId: string, status?: InvoiceStatus) {
    return this.prisma.invoice.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
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
    // Initial get for 404 and response shape; the write is conditional on status
    // to close the TOCTOU window between the read and the update.
    await this.get(tenantId, id);
    const { count } = await this.prisma.invoice.updateMany({
      where: { id, tenantId, status: InvoiceStatus.DRAFT },
      data: { status: InvoiceStatus.APPROVED, approvedAt: new Date() },
    });
    if (count === 0) {
      throw new BadRequestException('Only DRAFT invoices can be approved');
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'invoice',
      entityId: id,
      before: { status: InvoiceStatus.DRAFT },
      after: { status: InvoiceStatus.APPROVED },
    });
    return this.get(tenantId, id);
  }

  /** Tenant tolerances from the billing module settings (defaults: 2 % / 25). */
  private async tolerances(tenantId: string) {
    const tenantModule = await this.prisma.tenantModule.findFirst({
      where: { tenantId, module: { key: MODULE_KEYS.BILLING } },
    });
    const settings = (tenantModule?.settings ?? {}) as {
      tolerancePct?: unknown;
      toleranceAbsolute?: unknown;
    };
    // Settings come from a free-form Json column: coerce and reject bad types
    // and negatives, otherwise a stray "2%" string would NaN the threshold and
    // silently route EVERY invoice to DISPUTED.
    const sane = (value: unknown, fallback: number) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    return {
      tolerancePct: sane(settings.tolerancePct, 2),
      toleranceAbsolute: sane(settings.toleranceAbsolute, 25),
    };
  }

  /**
   * Captures the carrier's actual invoice and routes by tolerance on the GROSS
   * variance (catches compensating line errors). Allowed from DRAFT and from
   * DISPUTED (corrected invoice: amounts are overwritten, tolerance re-evaluated;
   * staying DISPUTED is a state no-op). disputeReasonCode stays null here on
   * purpose — it qualifies the human diagnosis at resolution time.
   */
  async reconcile(tenantId: string, userId: string, id: string, dto: ReconcileInvoiceDto) {
    const invoice = await this.get(tenantId, id);
    if (invoice.status !== InvoiceStatus.DRAFT && invoice.status !== InvoiceStatus.DISPUTED) {
      throw new BadRequestException('Only DRAFT or DISPUTED invoices can be reconciled');
    }
    const byLine = new Map(dto.lines.map((l) => [l.lineId, l.invoicedAmount]));
    for (const lineId of byLine.keys()) {
      if (!invoice.lines.some((l) => l.id === lineId)) {
        throw new BadRequestException(`Line ${lineId} does not belong to this invoice`);
      }
    }
    const computed = invoice.lines.map((line) => {
      const expected = Number(line.amount);
      const invoiced = byLine.get(line.id) ?? expected;
      return {
        id: line.id,
        expected,
        invoiced,
        variance: Math.round((invoiced - expected) * 100) / 100,
      };
    });
    const outcome = evaluateReconciliation(computed, await this.tolerances(tenantId));
    const next = outcome.withinTolerance ? InvoiceStatus.APPROVED : InvoiceStatus.DISPUTED;
    if (next !== invoice.status && !canTransitionInvoice(invoice.status as InvoiceStatus, next)) {
      throw new BadRequestException(`Cannot move invoice from ${invoice.status} to ${next}`);
    }

    // Line updates are keyed by line id (no status condition) — acceptable because
    // the header updateMany below is the authoritative gate for concurrent-state detection.
    const txResults = await this.prisma.$transaction([
      ...computed.map((c) =>
        this.prisma.invoiceLine.update({
          where: { id: c.id },
          data: { invoicedAmount: c.invoiced, variance: c.variance },
        }),
      ),
      this.prisma.invoice.updateMany({
        where: { id, tenantId, status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.DISPUTED] } },
        data: {
          carrierInvoiceNumber: dto.carrierInvoiceNumber,
          invoicedTotal: outcome.invoicedTotal,
          varianceTotal: outcome.varianceTotal,
          varianceGross: outcome.varianceGross,
          reconciledAt: new Date(),
          status: next,
          ...(next === InvoiceStatus.APPROVED ? { approvedAt: new Date() } : {}),
        },
      }),
    ]);
    // Last element is the header updateMany result; count === 0 means the invoice
    // status changed concurrently between our initial read and the transaction write.
    const headerResult = txResults[txResults.length - 1] as { count: number };
    if (headerResult.count === 0) {
      throw new BadRequestException('Invoice state changed concurrently — retry');
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'invoice',
      entityId: id,
      before: { status: invoice.status },
      after: {
        status: next,
        carrierInvoiceNumber: dto.carrierInvoiceNumber,
        invoicedTotal: outcome.invoicedTotal,
        varianceGross: outcome.varianceGross,
      },
    });
    return this.get(tenantId, id);
  }

  /** Human resolution of a dispute. ACCEPT_INVOICED pays the carrier's figure;
   *  KEEP_EXPECTED pays ours (the carrier issues a credit note out of band). */
  async resolveDispute(tenantId: string, userId: string, id: string, dto: ResolveDisputeDto) {
    // Initial get for 404 + invoicedTotal check; write is conditional on DISPUTED status
    // to close the TOCTOU window between the read and the update.
    const invoice = await this.get(tenantId, id);
    if (dto.resolution === 'ACCEPT_INVOICED' && invoice.invoicedTotal === null) {
      throw new BadRequestException('No invoiced total recorded on this invoice');
    }
    const { count } = await this.prisma.invoice.updateMany({
      where: { id, tenantId, status: InvoiceStatus.DISPUTED },
      data: {
        status: InvoiceStatus.APPROVED,
        approvedAt: new Date(),
        disputeReasonCode: dto.reasonCode,
        disputeNote: dto.note,
        // ACCEPT_INVOICED makes the HEADER totalAmount the authoritative
        // payable; line `amount`s deliberately keep the expected values as the
        // audit trail (invoicedAmount/variance carry the carrier's figures).
        // Consequence: sum(lines.amount) ≠ totalAmount on such invoices —
        // never re-derive the payable from line amounts.
        ...(dto.resolution === 'ACCEPT_INVOICED'
          ? { totalAmount: invoice.invoicedTotal! }
          : {}),
      },
    });
    if (count === 0) {
      throw new BadRequestException('Only DISPUTED invoices can be resolved');
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'invoice',
      entityId: id,
      before: { status: InvoiceStatus.DISPUTED },
      after: {
        status: InvoiceStatus.APPROVED,
        resolution: dto.resolution,
        reasonCode: dto.reasonCode,
      },
    });
    return this.get(tenantId, id);
  }

  async markPaid(tenantId: string, userId: string, id: string, paidAt?: string) {
    // Initial get for 404; the write is conditional on APPROVED status to close
    // the TOCTOU window between the read and the update.
    await this.get(tenantId, id);
    const resolvedPaidAt = paidAt ? new Date(paidAt) : new Date();
    const { count } = await this.prisma.invoice.updateMany({
      where: { id, tenantId, status: InvoiceStatus.APPROVED },
      data: { status: InvoiceStatus.PAID, paidAt: resolvedPaidAt },
    });
    if (count === 0) {
      throw new BadRequestException('Only APPROVED invoices can be marked paid');
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'invoice',
      entityId: id,
      before: { status: InvoiceStatus.APPROVED },
      after: { status: InvoiceStatus.PAID, paidAt: resolvedPaidAt },
    });
    return this.get(tenantId, id);
  }

  /** Filtered list as CSV (expected/invoiced/variance per invoice).
   *  Own query, NOT list(): the list endpoint takes 50 for the UI — an export
   *  silently truncated to 50 invoices would produce wrong reports. */
  async exportCsv(tenantId: string, status?: InvoiceStatus): Promise<string> {
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: invoiceInclude,
    });
    const escape = (value: unknown) => {
      const s = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'invoiceNumber',
      'carrier',
      'status',
      'currency',
      'expectedTotal',
      'invoicedTotal',
      'varianceTotal',
      'varianceGross',
      'carrierInvoiceNumber',
      'disputeReasonCode',
      'approvedAt',
      'paidAt',
      'createdAt',
    ];
    const rows = invoices.map((inv) => {
      // Free-text columns: apply formula-injection guard before CSV-escaping.
      // Numeric columns (totalAmount, invoicedTotal, varianceTotal, varianceGross)
      // are intentionally NOT guarded — a legitimate -12.50 variance must stay numeric.
      const carrierName = escape(csvSafe(inv.carrier.name));
      const carrierInvNum =
        inv.carrierInvoiceNumber != null ? escape(csvSafe(inv.carrierInvoiceNumber)) : '';
      return [
        escape(inv.invoiceNumber),
        carrierName,
        escape(inv.status),
        escape(inv.currency),
        escape(inv.totalAmount),
        escape(inv.invoicedTotal),
        escape(inv.varianceTotal),
        escape(inv.varianceGross),
        carrierInvNum,
        escape(inv.disputeReasonCode),
        escape(inv.approvedAt?.toISOString()),
        escape(inv.paidAt?.toISOString()),
        escape(inv.createdAt.toISOString()),
      ].join(',');
    });
    return [header.join(','), ...rows].join('\n');
  }
}
