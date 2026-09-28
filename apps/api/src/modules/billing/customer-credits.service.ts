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
  calculateCustomerCredit,
  canTransitionCustomerCredit,
  CustomerCreditStatus,
  FrozenCreditTax,
  invoiceBalance,
  frozenInvoiceTaxes,
  reconcileInvoiceLedger,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { ModuleSettingsService } from '../../core/module-registry/module-settings.service';
import { LedgerService } from './ledger/ledger.service';
import { assessInvoiceSource } from './ledger-qualification/invoice-qualification';
import type { DraftCreditDto } from './customer-credits.controller';

const noteSelect = {
  id: true,
  number: true,
  status: true,
  reason: true,
  currency: true,
  netAmount: true,
  taxAmount: true,
  totalAmount: true,
  createdAt: true,
  issuedAt: true,
  cancelledAt: true,
  invoiceVersion: true,
  lines: {
    select: {
      id: true,
      invoiceLineId: true,
      description: true,
      quantity: true,
      netAmount: true,
      taxAmount: true,
      totalAmount: true,
      taxDetail: true,
    },
  },
} satisfies Prisma.CustomerCreditNoteSelect;
const units = (quantity: Prisma.Decimal | null) =>
  !quantity || quantity.decimalPlaces() > 4 ? new Prisma.Decimal(1) : quantity;
@Injectable()
export class CustomerCreditsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly settings: ModuleSettingsService,
    private readonly ledger: LedgerService,
  ) {}
  private async locked<T>(
    tenantId: string,
    invoiceId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_invoices WHERE "tenantId"=${tenantId} AND id=${invoiceId} FOR UPDATE`;
      return fn(tx);
    });
  }
  private async source(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const invoice = await tx.customerInvoice.findFirst({
      where: { tenantId, id },
      include: { lines: true },
    });
    if (!invoice) throw new NotFoundException('Facture introuvable.');
    const approved = await tx.customerCreditLine.findMany({
      where: { tenantId, creditNote: { tenantId, invoiceId: id, status: 'ISSUED' } },
    });
    const credited = new Map<string, Prisma.Decimal>();
    for (const line of approved)
      credited.set(
        line.invoiceLineId,
        (credited.get(line.invoiceLineId) ?? new Prisma.Decimal(0)).plus(line.quantity),
      );
    const taxes = (invoice.taxDetail as { lines?: FrozenCreditTax[] } | null)?.lines ?? [];
    return {
      invoice,
      taxes,
      sources: invoice.lines.map((l) => ({
        id: l.id,
        amount: l.amount.toString(),
        quantity: units(l.quantity).toString(),
        creditedQuantity: (credited.get(l.id) ?? new Prisma.Decimal(0)).toString(),
      })),
    };
  }
  async context(tenantId: string, invoiceId: string) {
    return this.db.$transaction(
      async (tx) => {
        const { invoice, sources } = await this.source(tx, tenantId, invoiceId);
        const notes = await tx.customerCreditNote.findMany({
          where: { tenantId, invoiceId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
          select: noteSelect,
        });
        return {
          invoiceVersion: invoice.creditVersion,
          status: invoice.status,
          currency: invoice.currency,
          totalAmount: invoice.totalAmount,
          amountPaid: invoice.amountPaid,
          creditedAmount: invoice.creditedAmount,
          ...invoiceBalance(
            invoice.totalAmount.toString(),
            invoice.amountPaid.toString(),
            invoice.creditedAmount.toString(),
          ),
          lines: sources.map((s) => ({
            ...s,
            description: invoice.lines.find((l) => l.id === s.id)!.description,
            unit:
              invoice.lines.find((l) => l.id === s.id)!.quantity?.decimalPlaces()! > 4 ||
              !invoice.lines.find((l) => l.id === s.id)!.quantity
                ? 'fraction de ligne'
                : 'unité facturée',
            remainingQuantity: new Prisma.Decimal(s.quantity).minus(s.creditedQuantity).toString(),
          })),
          notes,
          historyLimited: notes.length === 100,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async draft(actor: AuthUser, invoiceId: string, dto: DraftCreditDto) {
    const tenantId = actor.tenantId;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          actor.id,
          invoiceId,
          dto.operationKey,
          dto.expectedVersion,
          dto.reason,
          [...dto.lines]
            .sort((a, b) => a.invoiceLineId.localeCompare(b.invoiceLineId))
            .map((l) => [l.invoiceLineId, l.quantity]),
        ]),
      )
      .digest('hex');
    const number = await this.sequences.nextNumber(tenantId, 'customer-credit');
    const result = await this.locked(tenantId, invoiceId, async (tx) => {
      const previous = await tx.customerCreditNote.findFirst({
        where: { tenantId, operationKey: dto.operationKey },
      });
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ConflictException('Cette clé désigne un autre avoir.');
        return { id: previous.id, replayed: true };
      }
      await this.ownership.assertOwned('customerInvoice', invoiceId, tenantId, tx);
      const { invoice, taxes, sources } = await this.source(tx, tenantId, invoiceId);
      if (invoice.status === 'DRAFT')
        throw new ConflictException('Corrigez directement la facture brouillon.');
      if (invoice.creditVersion !== dto.expectedVersion)
        throw new ConflictException('Les avoirs ont changé. Actualisez les quantités.');
      let calculated: ReturnType<typeof calculateCustomerCredit>;
      try {
        calculated = calculateCustomerCredit({
          totalAmount: invoice.totalAmount.toString(),
          taxAmount: invoice.taxAmount.toString(),
          taxes,
          lines: sources,
          requested: dto.lines,
        });
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const note = await tx.customerCreditNote.create({
        data: {
          tenantId,
          invoiceId,
          number,
          reason: dto.reason,
          currency: invoice.currency,
          invoiceVersion: invoice.creditVersion,
          netAmount: calculated.netAmount,
          taxAmount: calculated.taxAmount,
          totalAmount: calculated.totalAmount,
          createdById: actor.id,
          operationKey: dto.operationKey,
          fingerprint,
        },
      });
      await tx.customerCreditLine.createMany({
        data: calculated.lines.map((l) => ({
          tenantId,
          creditNoteId: note.id,
          invoiceLineId: l.invoiceLineId,
          description: invoice.lines.find((s) => s.id === l.invoiceLineId)!.description,
          quantity: l.quantity,
          netAmount: l.netAmount,
          taxAmount: l.taxAmount,
          totalAmount: l.totalAmount,
          taxDetail: l.taxes as unknown as Prisma.InputJsonValue,
        })),
      });
      return { id: note.id, replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId,
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: 'customer-credit',
        entityId: result.id,
        after: { invoiceId, number },
      });
    return result;
  }
  async issue(actor: AuthUser, invoiceId: string, id: string) {
    const tenantId = actor.tenantId,
      settings = await this.settings.resolve(tenantId, 'billing');
    await this.ledger.ensureChart(tenantId);
    const result = await this.locked(tenantId, invoiceId, async (tx) => {
      const note = await tx.customerCreditNote.findFirst({
        where: { tenantId, invoiceId, id },
        include: { lines: true },
      });
      if (!note) throw new NotFoundException('Avoir introuvable.');
      if (note.status === 'ISSUED') return { replayed: true };
      if (
        !canTransitionCustomerCredit(
          note.status as CustomerCreditStatus,
          CustomerCreditStatus.ISSUED,
        )
      )
        throw new ConflictException('Avoir non validable.');
      const { invoice, taxes } = await this.source(tx, tenantId, invoiceId);
      if (invoice.status === 'DRAFT' || invoice.creditVersion !== note.invoiceVersion)
        throw new ConflictException(
          'Aperçu périmé : annulez ce brouillon et préparez-en un nouveau.',
        );
      const credited = invoice.creditedAmount.plus(note.totalAmount);
      if (credited.gt(invoice.totalAmount))
        throw new ConflictException('Le crédit dépasse la facture.');
      // Original ledger accounts are authoritative. If absent, post the frozen invoice explicitly
      // as part of this confirmation, atomically with the compensating credit.
      let original = await tx.journalEntry.findFirst({
        where: {
          tenantId,
          sourceType: 'customer-invoice',
          sourceId: invoiceId,
          sourceKind: 'approved',
        },
        include: {
          currencyQualification: true,
          _count: { select: { lines: true } },
          lines: { where: { tenantId, account: { tenantId } }, include: { account: true } },
        },
      });
      if (!original) {
        await this.ledger.postTx(
          tx,
          tenantId,
          {
            date: invoice.approvedAt ?? invoice.createdAt,
            currency: invoice.currency,
            memo: `Facture ${invoice.invoiceNumber} — comptabilisée avec son avoir`,
            sourceType: 'customer-invoice',
            sourceId: invoiceId,
            sourceKind: 'approved',
            lines: [
              {
                accountCode: String(settings.arAccountCode ?? '1100'),
                debit: Number(invoice.totalAmount),
              },
              {
                accountCode: String(settings.revenueAccountCode ?? '4000'),
                credit: Number(invoice.totalAmount.minus(invoice.taxAmount)),
              },
              ...taxes
                .filter((t) => Number(t.amount) > 0)
                .map((t) => ({ accountCode: t.accountCode, credit: Number(t.amount) })),
            ],
          },
          actor.id,
        );
        original = await tx.journalEntry.findFirst({
          where: {
            tenantId,
            sourceType: 'customer-invoice',
            sourceId: invoiceId,
            sourceKind: 'approved',
          },
          include: {
            currencyQualification: true,
            _count: { select: { lines: true } },
            lines: { where: { tenantId, account: { tenantId } }, include: { account: true } },
          },
        });
      }
      if (!original || original.lines.length !== original._count.lines)
        throw new ConflictException('Écriture d’origine absente ou de propriété incohérente.');
      const qualification = original.currencyQualification;
      const effectiveCurrency =
        original.currency ??
        (qualification?.state === 'QUALIFIED' && qualification.sourceEntryId === original.id
          ? qualification.currency
          : null);
      if (effectiveCurrency !== invoice.currency)
        throw new ConflictException(
          'Devise de l’écriture d’origine non qualifiée ou différente : revue comptable requise avant avoir.',
        );
      // Shares the invoice lock with qualification/withdrawal; a new credit always has a known currency.
      if (original.currency === null) await assessInvoiceSource(tx, actor, original);
      let accounts: ReturnType<typeof reconcileInvoiceLedger>;
      let creditTaxes: ReturnType<typeof frozenInvoiceTaxes>;
      try {
        accounts = reconcileInvoiceLedger({
          customer: true,
          net: invoice.totalAmount.minus(invoice.taxAmount).toString(),
          tax: invoice.taxAmount.toString(),
          total: invoice.totalAmount.toString(),
          taxes,
          lines: original.lines.map((l) => ({
            accountCode: l.account.code,
            accountType: l.account.type,
            debit: l.debit.toString(),
            credit: l.credit.toString(),
          })),
        });
        creditTaxes = frozenInvoiceTaxes(
          note.lines.flatMap((line) =>
            frozenInvoiceTaxes(line.taxDetail, line.taxAmount.toString()),
          ),
          note.taxAmount.toString(),
        );
      } catch (error) {
        throw new ConflictException(
          'Écriture d’origine ou taxes non standard : ' + (error as Error).message,
        );
      }
      await this.ledger.postTx(
        tx,
        tenantId,
        {
          memo: `Avoir ${note.number} · facture ${invoice.invoiceNumber}`,
          currency: invoice.currency,
          sourceType: 'customer-credit',
          sourceId: id,
          sourceKind: 'issued',
          lines: [
            { accountCode: accounts.controlAccount, credit: note.totalAmount.toString() },
            ...(note.netAmount.gt(0)
              ? [{ accountCode: accounts.netAccount, debit: note.netAmount.toString() }]
              : []),
            ...creditTaxes.map(({ accountCode, amount }) => ({ accountCode, debit: amount })),
          ],
        },
        actor.id,
      );
      const invoiceClaim = await tx.customerInvoice.updateMany({
        where: { tenantId, id: invoiceId, creditVersion: note.invoiceVersion },
        data: { creditedAmount: credited, creditVersion: { increment: 1 } },
      });
      const noteClaim = await tx.customerCreditNote.updateMany({
        where: { tenantId, id, status: 'DRAFT' },
        data: { status: 'ISSUED', issuedAt: new Date(), issuedById: actor.id },
      });
      if (invoiceClaim.count !== 1 || noteClaim.count !== 1)
        throw new ConflictException('La facture ou l’avoir a changé. Actualisez.');
      return { replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId,
        userId: actor.id,
        action: AuditAction.STATUS_CHANGE,
        entityType: 'customer-credit',
        entityId: id,
        before: { status: 'DRAFT' },
        after: { status: 'ISSUED', invoiceId },
      });
    return result;
  }
  async cancel(actor: AuthUser, invoiceId: string, id: string) {
    const result = await this.locked(actor.tenantId, invoiceId, async (tx) => {
      const note = await tx.customerCreditNote.findFirst({
        where: { tenantId: actor.tenantId, invoiceId, id },
      });
      if (!note) throw new NotFoundException();
      if (note.status === 'CANCELLED') return { replayed: true };
      if (
        !canTransitionCustomerCredit(
          note.status as CustomerCreditStatus,
          CustomerCreditStatus.CANCELLED,
        )
      )
        throw new ConflictException('Un avoir validé est définitif.');
      await tx.customerCreditNote.updateMany({
        where: { tenantId: actor.tenantId, id, status: 'DRAFT' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      return { replayed: false };
    });
    if (!result.replayed)
      await this.audit.log({
        tenantId: actor.tenantId,
        userId: actor.id,
        action: AuditAction.STATUS_CHANGE,
        entityType: 'customer-credit',
        entityId: id,
        before: { status: 'DRAFT' },
        after: { status: 'CANCELLED' },
      });
    return result;
  }
}
