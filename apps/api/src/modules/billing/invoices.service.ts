import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  canTransitionInvoice,
  computeTax,
  evaluateReconciliation,
  InvoiceStatus,
  LoadStatus,
  PaymentPartyType,
  PaymentTargetType,
  PaymentType,
  TaxTemplateType,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { ModuleSettingsService } from '../../core/module-registry/module-settings.service';
import { ReconcileInvoiceDto, ResolveDisputeDto } from './dto/reconcile.dto';
import { csvSafe } from '../../common/csv';
import { LedgerService } from './ledger/ledger.service';
import { PaymentsService } from './payments.service';
import { TaxTemplatesService } from './tax-templates.service';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const invoiceInclude = {
  incomingAudit: { select: { id: true } },
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
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly moduleSettings: ModuleSettingsService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly taxTemplates: TaxTemplatesService,
  ) {}

  private async defaultModeId(tenantId: string): Promise<string> {
    const mode = await this.prisma.modeOfPayment.findFirst({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true },
    });
    if (!mode) throw new BadRequestException('No mode of payment configured');
    return mode.id;
  }

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
    const s = await this.moduleSettings.resolve(tenantId, 'billing');
    const defaultCurrency = (s.defaultCurrency as string | undefined) ?? 'CAD';
    const invoice = await this.prisma.invoice.create({
      data: {
        tenantId,
        invoiceNumber: await this.sequences.nextNumber(tenantId, 'invoice'),
        carrierId,
        currency: loads[0].costCurrency ?? defaultCurrency,
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

  /** The only escape path of a draft carrier invoice: deletion frees the loads
   *  (cascade on lines) for re-drafting. DRAFT only; gated by the billing
   *  `allowInvoiceDeletion` setting. */
  async deleteDraft(tenantId: string, userId: string, id: string) {
    const invoice = await this.get(tenantId, id);
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT invoices can be deleted');
    }
    const s = await this.moduleSettings.resolve(tenantId, 'billing');
    if (s.allowInvoiceDeletion === false) {
      throw new ForbiddenException('Invoice deletion is disabled for this tenant');
    }
    const { count } = await this.prisma.invoice.deleteMany({
      where: { id, tenantId, status: InvoiceStatus.DRAFT },
    });
    if (count === 0) {
      // Approved concurrently between the read and the delete — immutability wins.
      throw new BadRequestException('Only DRAFT invoices can be deleted');
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'invoice',
      entityId: id,
      before: {
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        carrierId: invoice.carrierId,
        loads: invoice.lines.map((l) => l.load?.loadNumber ?? l.description),
      },
    });
    return { deleted: true };
  }

  /** Applies (or clears) a PURCHASE tax template on a DRAFT carrier invoice. */
  async applyTax(tenantId: string, userId: string, id: string, taxTemplateId: string | null) {
    const invoice = await this.get(tenantId, id);

    const net = round2(Number(invoice.totalAmount) - Number(invoice.taxAmount));

    let newTaxAmount: number;
    let newTaxDetail: Prisma.InputJsonValue | null;
    let newTemplateId: string | null;
    let newTotal: number;

    if (taxTemplateId === null) {
      // Clear tax
      newTaxAmount = 0;
      newTaxDetail = null;
      newTemplateId = null;
      newTotal = round2(net);
    } else {
      const template = await this.taxTemplates.get(tenantId, taxTemplateId); // 404 if not owned — rule 9
      if (template.type !== TaxTemplateType.PURCHASE) {
        throw new BadRequestException('Tax template must be of type PURCHASE for carrier invoices');
      }
      const computation = computeTax(
        net,
        template.lines.map((l) => ({
          description: l.description,
          rate: Number(l.rate),
          accountCode: l.accountCode,
        })),
      );
      newTaxAmount = computation.taxAmount;
      newTaxDetail = computation as unknown as Prisma.InputJsonValue;
      newTemplateId = taxTemplateId;
      newTotal = round2(net + computation.taxAmount);
    }

    const { count } = await this.prisma.invoice.updateMany({
      where: { id, tenantId, status: InvoiceStatus.DRAFT },
      data: {
        taxTemplateId: newTemplateId,
        taxAmount: newTaxAmount,
        taxDetail: newTaxDetail ?? Prisma.JsonNull,
        totalAmount: newTotal,
      },
    });
    if (count === 0) {
      // Approved concurrently between the read and the update — immutability wins.
      throw new BadRequestException('Tax can only be applied to DRAFT invoices');
    }

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'invoice',
      entityId: id,
      before: {
        taxTemplateId: invoice.taxTemplateId,
        taxAmount: Number(invoice.taxAmount),
        totalAmount: Number(invoice.totalAmount),
      },
      after: { taxTemplateId: newTemplateId, taxAmount: newTaxAmount, totalAmount: newTotal },
    });

    return this.get(tenantId, id);
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
    const result = await this.get(tenantId, id);
    const s = await this.moduleSettings.resolve(tenantId, 'billing');
    // Auto-post ledger entry: DR Expense (net) + DR <inputTax> per line / CR AP (gross).
    // When taxAmount is 0 / no taxDetail, reduces to DR Expense / CR AP (unchanged behaviour).
    if (s.ledgerAutoPost === true) {
      const totalAmount = Number(result.totalAmount);
      const taxAmount = Number(result.taxAmount);
      const netAmount = round2(totalAmount - taxAmount);
      const expCode = (s.expenseAccountCode as string | undefined) ?? '5000';
      const apCode = (s.apAccountCode as string | undefined) ?? '2000';
      try {
        // Build input-tax debit lines from the tax breakdown (one per tax line).
        const taxDetail = result.taxDetail as {
          lines?: Array<{ accountCode: string; amount: number }>;
        } | null;
        const taxDebitLines: Array<{ accountCode: string; debit: number }> =
          taxDetail && Array.isArray(taxDetail.lines) && taxDetail.lines.length > 0
            ? taxDetail.lines.map((l) => ({ accountCode: l.accountCode, debit: l.amount }))
            : [];

        await this.ledger.post(
          tenantId,
          {
            memo: `Facture transporteur ${result.invoiceNumber} approuvée`,
            currency: result.currency,
            sourceType: 'invoice',
            sourceId: id,
            sourceKind: 'approved',
            lines: [
              { accountCode: expCode, debit: netAmount },
              ...taxDebitLines,
              { accountCode: apCode, credit: totalAmount },
            ],
          },
          userId,
        );
      } catch (err) {
        this.logger.warn(
          `Ledger auto-post failed for invoice ${id} (approved): ${(err as Error).message}`,
        );
      }
    }
    return result;
  }

  /** Tenant tolerances from the billing module settings (defaults: 2 % / 25 / MAX). */
  private async tolerances(tenantId: string) {
    const s = await this.moduleSettings.resolve(tenantId, 'billing');
    return {
      tolerancePct: s.tolerancePct as number,
      toleranceAbsolute: s.toleranceAbsolute as number,
      mode: (s.toleranceMode ?? 'MAX') as 'MAX' | 'MIN',
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
    const tol = await this.tolerances(tenantId);
    const outcome = evaluateReconciliation(computed, tol, tol.mode);
    const next = outcome.withinTolerance ? InvoiceStatus.APPROVED : InvoiceStatus.DISPUTED;
    if (next !== invoice.status && !canTransitionInvoice(invoice.status as InvoiceStatus, next)) {
      throw new BadRequestException(`Cannot move invoice from ${invoice.status} to ${next}`);
    }

    // Line updates are keyed by line id (no status condition) — acceptable because
    // the header updateMany below is the authoritative gate for concurrent-state detection.
    const txResults = await this.prisma.$transaction([
      ...computed.map((c) =>
        this.prisma.invoiceLine.updateMany({
          // InvoiceLine has no tenantId; scope to the parent invoice (id), which the
          // header updateMany below gates by tenantId — a foreign line id can't match.
          where: { id: c.id, invoiceId: id },
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
        ...(dto.resolution === 'ACCEPT_INVOICED' ? { totalAmount: invoice.invoicedTotal! } : {}),
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
    const inv = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        amountPaid: true,
        carrierId: true,
        currency: true,
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== 'APPROVED')
      throw new BadRequestException('Only APPROVED invoices can be paid');
    const outstanding = Number(inv.totalAmount) - Number(inv.amountPaid);
    if (outstanding <= 0) throw new BadRequestException('Invoice already settled');
    const payment = await this.payments.create(tenantId, userId, {
      type: PaymentType.PAY,
      partyType: PaymentPartyType.CARRIER,
      partyId: inv.carrierId,
      modeOfPaymentId: await this.defaultModeId(tenantId),
      date: paidAt ?? new Date().toISOString(),
      currency: inv.currency,
      totalAmount: outstanding,
      allocations: [
        { targetType: PaymentTargetType.CARRIER_INVOICE, targetId: inv.id, amount: outstanding },
      ],
    });
    await this.payments.submit(tenantId, userId, payment.id);
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
