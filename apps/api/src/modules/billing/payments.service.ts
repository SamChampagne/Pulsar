import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CustomerInvoiceStatus,
  InvoiceStatus,
  PaymentPartyType,
  PaymentStatus,
  PaymentTargetType,
  PaymentType,
  canTransitionCustomerInvoice,
  canTransitionInvoice,
  canTransitionPayment,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { ModuleSettingsService } from '../../core/module-registry/module-settings.service';
import { LedgerService } from './ledger/ledger.service';
import { ModesOfPaymentService } from './modes-of-payment.service';

interface AllocationInput {
  targetType: PaymentTargetType;
  targetId: string;
  amount: number;
}

interface CreatePaymentInput {
  type: PaymentType;
  partyType: PaymentPartyType;
  partyId: string;
  modeOfPaymentId: string;
  date: string;
  currency?: string;
  totalAmount: number;
  reference?: string;
  note?: string;
  allocations: AllocationInput[];
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly ownership: OwnershipService,
    private readonly moduleSettings: ModuleSettingsService,
    private readonly ledger: LedgerService,
    private readonly modes: ModesOfPaymentService,
  ) {}

  async list(tenantId: string, status?: PaymentStatus, type?: PaymentType) {
    const payments = await this.prisma.payment.findMany({
      where: { tenantId, status, type },
      orderBy: { createdAt: 'desc' },
      include: { modeOfPayment: true, allocations: true },
    });
    return this.withParties(tenantId, payments);
  }

  /** Batch explicit display projections; never resolve a polymorphic ID across tenants. */
  private async withParties<T extends { partyType: string; partyId: string }>(
    tenantId: string,
    payments: T[],
  ) {
    const customerIds = [
      ...new Set(payments.filter((p) => p.partyType === 'CUSTOMER').map((p) => p.partyId)),
    ];
    const carrierIds = [
      ...new Set(payments.filter((p) => p.partyType === 'CARRIER').map((p) => p.partyId)),
    ];
    const [customers, carriers] = await Promise.all([
      customerIds.length
        ? this.prisma.customer.findMany({
            where: { tenantId, id: { in: customerIds } },
            select: { id: true, name: true },
          })
        : [],
      carrierIds.length
        ? this.prisma.carrier.findMany({
            where: { tenantId, id: { in: carrierIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const customerMap = new Map(customers.map((p) => [p.id, p]));
    const carrierMap = new Map(carriers.map((p) => [p.id, p]));
    return payments.map((p) => ({
      ...p,
      party: (p.partyType === 'CUSTOMER' ? customerMap : carrierMap).get(p.partyId) ?? null,
    }));
  }

  async get(tenantId: string, id: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      include: { modeOfPayment: true, allocations: true },
    });
    if (!p) throw new NotFoundException('Payment not found');
    const customerIds = p.allocations
      .filter((a) => a.targetType === 'CUSTOMER_INVOICE')
      .map((a) => a.targetId);
    const carrierIds = p.allocations
      .filter((a) => a.targetType === 'CARRIER_INVOICE')
      .map((a) => a.targetId);
    const [parties, customers, carriers] = await Promise.all([
      this.withParties(tenantId, [p]),
      customerIds.length
        ? this.prisma.customerInvoice.findMany({
            where: { tenantId, id: { in: customerIds } },
            select: { id: true, invoiceNumber: true },
          })
        : [],
      carrierIds.length
        ? this.prisma.invoice.findMany({
            where: { tenantId, id: { in: carrierIds } },
            select: { id: true, invoiceNumber: true },
          })
        : [],
    ]);
    const customerMap = new Map(customers.map((i) => [i.id, i]));
    const carrierMap = new Map(carriers.map((i) => [i.id, i]));
    return {
      ...parties[0],
      allocations: p.allocations.map((a) => ({
        ...a,
        target:
          (a.targetType === 'CUSTOMER_INVOICE' ? customerMap : carrierMap).get(a.targetId) ?? null,
      })),
    };
  }

  /** Open invoices (outstanding > 0) of a party, for the allocation screen. */
  async openInvoices(tenantId: string, partyType: PaymentPartyType, partyId: string) {
    if (!partyId) throw new BadRequestException('Payment party is required');
    if (!Object.values(PaymentPartyType).includes(partyType))
      throw new BadRequestException('Invalid payment party type');
    if (partyType === PaymentPartyType.CUSTOMER) {
      const rows = await this.prisma.customerInvoice.findMany({
        where: { tenantId, customerId: partyId, status: { in: ['APPROVED', 'SENT'] } },
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          amountPaid: true,
          currency: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      return rows
        .map((r) => ({
          ...r,
          targetType: PaymentTargetType.CUSTOMER_INVOICE,
          outstanding: Number(r.totalAmount) - Number(r.amountPaid),
        }))
        .filter((r) => r.outstanding > 0);
    }
    const rows = await this.prisma.invoice.findMany({
      where: { tenantId, carrierId: partyId, status: { in: ['APPROVED'] } },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        amountPaid: true,
        currency: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .map((r) => ({
        ...r,
        targetType: PaymentTargetType.CARRIER_INVOICE,
        outstanding: Number(r.totalAmount) - Number(r.amountPaid),
      }))
      .filter((r) => r.outstanding > 0);
  }

  private assertPartyTargetCoherence(
    partyType: PaymentPartyType,
    allocations: AllocationInput[],
  ): number {
    const expected =
      partyType === PaymentPartyType.CUSTOMER
        ? PaymentTargetType.CUSTOMER_INVOICE
        : PaymentTargetType.CARRIER_INVOICE;
    if (!allocations.length) throw new BadRequestException('Payment has no allocations');
    const targets = new Set<string>();
    for (const a of allocations) {
      if (targets.has(a.targetId)) throw new BadRequestException('Duplicate allocation target');
      targets.add(a.targetId);
      if (a.targetType !== expected)
        throw new BadRequestException('Allocation target does not match party type');
      if (!Number.isFinite(a.amount) || a.amount <= 0)
        throw new BadRequestException('Allocation amount must be positive');
    }
    const sum = allocations.reduce((s, a) => s + a.amount, 0);
    return sum;
  }

  private assertDirection(type: PaymentType, partyType: PaymentPartyType) {
    if (
      !(
        (type === PaymentType.RECEIVE && partyType === PaymentPartyType.CUSTOMER) ||
        (type === PaymentType.PAY && partyType === PaymentPartyType.CARRIER)
      )
    )
      throw new BadRequestException('Payment direction does not match party type');
  }

  private async assertAllocationParties(
    tenantId: string,
    partyId: string,
    allocations: AllocationInput[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    for (const a of allocations) {
      const customer = a.targetType === PaymentTargetType.CUSTOMER_INVOICE;
      await this.ownership.assertOwned(
        customer ? 'customerInvoice' : 'invoice',
        a.targetId,
        tenantId,
      );
      const invoice = customer
        ? await db.customerInvoice.findFirst({
            where: { id: a.targetId, tenantId, customerId: partyId },
            select: { id: true },
          })
        : await db.invoice.findFirst({
            where: { id: a.targetId, tenantId, carrierId: partyId },
            select: { id: true },
          });
      if (!invoice)
        throw new BadRequestException('Allocated invoice does not belong to payment party');
    }
  }

  /** Serialize editing and submission, then read the current allocations under the row lock. */
  private async lockPayment(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const payment = await tx.payment.findFirst({
      where: { id, tenantId },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  /**
   * Verify that the party belongs to the tenant.
   * Real signature: assertOwned(entity, id, tenantId) — note argument order.
   */
  private async assertPartyOwned(tenantId: string, partyType: PaymentPartyType, partyId: string) {
    if (partyType === PaymentPartyType.CUSTOMER) {
      await this.ownership.assertOwned('customer', partyId, tenantId);
    } else {
      await this.ownership.assertOwned('carrier', partyId, tenantId);
    }
  }

  async create(tenantId: string, userId: string, input: CreatePaymentInput) {
    this.assertDirection(input.type, input.partyType);
    await this.assertPartyOwned(tenantId, input.partyType, input.partyId);
    await this.modes.resolveAccountCode(tenantId, input.modeOfPaymentId); // validates ownership/existence
    const allocSum = this.assertPartyTargetCoherence(input.partyType, input.allocations);
    if (allocSum > input.totalAmount + 1e-9)
      throw new BadRequestException('Allocations exceed payment amount');

    await this.assertAllocationParties(tenantId, input.partyId, input.allocations);
    const settings = await this.moduleSettings.resolve(tenantId, 'billing');
    const currency = input.currency ?? (settings.defaultCurrency as string);
    const paymentNumber = await this.sequences.nextNumber(tenantId, 'payment');

    const payment = await this.prisma.payment.create({
      data: {
        tenantId,
        paymentNumber,
        type: input.type,
        partyType: input.partyType,
        partyId: input.partyId,
        modeOfPaymentId: input.modeOfPaymentId,
        date: new Date(input.date),
        currency,
        totalAmount: new Prisma.Decimal(input.totalAmount),
        reference: input.reference,
        note: input.note,
        createdById: userId,
        allocations: {
          create: input.allocations.map((a) => ({
            tenantId,
            targetType: a.targetType,
            targetId: a.targetId,
            amount: new Prisma.Decimal(a.amount),
          })),
        },
      },
      include: { allocations: true, modeOfPayment: true },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'payment',
      entityId: payment.id,
      after: { paymentNumber, status: payment.status },
    });
    return payment;
  }

  async update(tenantId: string, userId: string, id: string, input: Partial<CreatePaymentInput>) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockPayment(tx, tenantId, id);
      if (existing.status !== PaymentStatus.DRAFT)
        throw new BadRequestException('Only DRAFT payments can be edited');
      for (const field of [
        'type',
        'partyType',
        'partyId',
        'modeOfPaymentId',
        'currency',
      ] as const) {
        if (input[field] !== undefined && input[field] !== existing[field])
          throw new BadRequestException(`Payment ${field} cannot be changed; create a new draft`);
      }
      this.assertDirection(existing.type as PaymentType, existing.partyType as PaymentPartyType);
      const allocations =
        input.allocations ??
        existing.allocations.map((a) => ({
          targetType: a.targetType as PaymentTargetType,
          targetId: a.targetId,
          amount: Number(a.amount),
        }));
      const allocSum = this.assertPartyTargetCoherence(
        existing.partyType as PaymentPartyType,
        allocations,
      );
      if (allocSum > (input.totalAmount ?? Number(existing.totalAmount)) + 1e-9)
        throw new BadRequestException('Allocations exceed payment amount');
      await this.assertAllocationParties(tenantId, existing.partyId, allocations, tx);

      const data: Prisma.PaymentUpdateManyMutationInput = {};
      if (input.totalAmount != null) data.totalAmount = new Prisma.Decimal(input.totalAmount);
      if (input.reference !== undefined) data.reference = input.reference;
      if (input.note !== undefined) data.note = input.note;
      if (input.date) data.date = new Date(input.date);
      const claim = await tx.payment.updateMany({
        where: { id, tenantId, status: PaymentStatus.DRAFT },
        data,
      });
      if (!claim.count) throw new ConflictException('Payment is no longer DRAFT');
      if (input.allocations) {
        await tx.paymentAllocation.deleteMany({ where: { paymentId: id, tenantId } });
        await tx.paymentAllocation.createMany({
          data: input.allocations.map((a) => ({
            tenantId,
            paymentId: id,
            targetType: a.targetType,
            targetId: a.targetId,
            amount: new Prisma.Decimal(a.amount),
          })),
        });
      }
      return tx.payment.findFirstOrThrow({
        where: { id, tenantId },
        include: { allocations: true, modeOfPayment: true },
      });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'payment',
      entityId: id,
      after: { status: updated.status },
    });
    return updated;
  }

  /**
   * Post the GL transactionally with the status flip + amountPaid increments.
   * A failed GL post rolls back the entire submit (rule 41).
   */
  async submit(tenantId: string, userId: string, id: string) {
    const payment = await this.get(tenantId, id);
    if (!canTransitionPayment(payment.status as PaymentStatus, PaymentStatus.SUBMITTED)) {
      throw new BadRequestException(`Cannot submit a ${payment.status} payment`);
    }
    if (payment.allocations.length === 0)
      throw new BadRequestException('Payment has no allocations');

    const settings = await this.moduleSettings.resolve(tenantId, 'billing');
    const modeAccount = await this.modes.resolveAccountCode(tenantId, payment.modeOfPaymentId);
    const arAccount = settings.arAccountCode as string;
    const apAccount = settings.apAccountCode as string;
    // Ensure the chart of accounts exists before entering the transaction
    // (ledger.postTx does not call ensureChart; we do it here so the tx stays clean).
    await this.ledger.ensureChart(tenantId);

    // Collect invoice status changes for post-commit audit (avoid auditing inside tx).
    const invoiceStatusChanges: Array<{
      entityType: string;
      entityId: string;
      from: string;
      to: string;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, tenantId, id);
      this.assertDirection(payment.type as PaymentType, payment.partyType as PaymentPartyType);
      const allocated = this.assertPartyTargetCoherence(
        payment.partyType as PaymentPartyType,
        payment.allocations.map((a) => ({
          targetType: a.targetType as PaymentTargetType,
          targetId: a.targetId,
          amount: Number(a.amount),
        })),
      );
      if (allocated > Number(payment.totalAmount) + 1e-9)
        throw new BadRequestException('Allocations exceed payment amount');
      const lines =
        payment.type === PaymentType.RECEIVE
          ? [
              { accountCode: modeAccount, debit: allocated },
              { accountCode: arAccount, credit: allocated },
            ]
          : [
              { accountCode: apAccount, debit: allocated },
              { accountCode: modeAccount, credit: allocated },
            ];
      // Claim DRAFT→SUBMITTED (TOCTOU guard).
      const claim = await tx.payment.updateMany({
        where: { id, tenantId, status: PaymentStatus.DRAFT },
        data: { status: PaymentStatus.SUBMITTED, submittedAt: new Date() },
      });
      if (claim.count === 0) throw new BadRequestException('Payment is no longer DRAFT');

      for (const a of payment.allocations) {
        if (a.targetType === PaymentTargetType.CUSTOMER_INVOICE) {
          const inv = await tx.customerInvoice.findFirst({
            where: { id: a.targetId, tenantId },
            select: {
              totalAmount: true,
              amountPaid: true,
              status: true,
              currency: true,
              customerId: true,
            },
          });
          if (!inv) throw new BadRequestException('Allocated customer invoice not found');
          if (inv.customerId !== payment.partyId)
            throw new BadRequestException('Allocated invoice does not belong to payment party');
          if (
            inv.status !== CustomerInvoiceStatus.APPROVED &&
            inv.status !== CustomerInvoiceStatus.SENT
          )
            throw new BadRequestException(
              'Customer invoice must be approved or sent before payment',
            );
          // Allocation-currency coherence check.
          if (inv.currency !== payment.currency)
            throw new BadRequestException('Allocation currency does not match payment currency');
          const priorPaid = inv.amountPaid;
          const newPaid = Number(priorPaid) + Number(a.amount);
          if (newPaid > Number(inv.totalAmount) + 1e-9)
            throw new BadRequestException('Allocation exceeds invoice outstanding');
          const willBePaid = newPaid >= Number(inv.totalAmount) - 1e-9;
          if (willBePaid) {
            if (
              !canTransitionCustomerInvoice(
                inv.status as CustomerInvoiceStatus,
                CustomerInvoiceStatus.PAID,
              )
            ) {
              throw new BadRequestException(
                `Cannot mark customer invoice PAID from status ${inv.status}`,
              );
            }
          }
          // Finding 1: conditional-claim (TOCTOU guard) on amountPaid increment.
          const claimed = await tx.customerInvoice.updateMany({
            where: {
              id: a.targetId,
              tenantId,
              amountPaid: priorPaid,
              status: inv.status,
              currency: inv.currency,
              customerId: payment.partyId,
              totalAmount: inv.totalAmount,
            },
            data: {
              amountPaid: new Prisma.Decimal(newPaid),
              ...(willBePaid ? { status: CustomerInvoiceStatus.PAID, paidAt: new Date() } : {}),
            },
          });
          if (claimed.count === 0)
            throw new ConflictException('Invoice changed concurrently, retry the payment');
          if (willBePaid) {
            invoiceStatusChanges.push({
              entityType: 'customer-invoice',
              entityId: a.targetId,
              from: inv.status,
              to: CustomerInvoiceStatus.PAID,
            });
          }
        } else {
          const inv = await tx.invoice.findFirst({
            where: { id: a.targetId, tenantId },
            select: {
              totalAmount: true,
              amountPaid: true,
              status: true,
              currency: true,
              carrierId: true,
            },
          });
          if (!inv) throw new BadRequestException('Allocated carrier invoice not found');
          if (inv.carrierId !== payment.partyId)
            throw new BadRequestException('Allocated invoice does not belong to payment party');
          if (inv.status !== InvoiceStatus.APPROVED)
            throw new BadRequestException('Carrier invoice must be approved before payment');
          // Allocation-currency coherence check.
          if (inv.currency !== payment.currency)
            throw new BadRequestException('Allocation currency does not match payment currency');
          const priorPaid = inv.amountPaid;
          const newPaid = Number(priorPaid) + Number(a.amount);
          if (newPaid > Number(inv.totalAmount) + 1e-9)
            throw new BadRequestException('Allocation exceeds invoice outstanding');
          const willBePaid = newPaid >= Number(inv.totalAmount) - 1e-9;
          if (willBePaid) {
            if (!canTransitionInvoice(inv.status as InvoiceStatus, InvoiceStatus.PAID)) {
              throw new BadRequestException(
                `Cannot mark carrier invoice PAID from status ${inv.status}`,
              );
            }
          }
          // Finding 1: conditional-claim (TOCTOU guard) on amountPaid increment.
          const claimed = await tx.invoice.updateMany({
            where: {
              id: a.targetId,
              tenantId,
              amountPaid: priorPaid,
              status: inv.status,
              currency: inv.currency,
              carrierId: payment.partyId,
              totalAmount: inv.totalAmount,
            },
            data: {
              amountPaid: new Prisma.Decimal(newPaid),
              ...(willBePaid ? { status: InvoiceStatus.PAID, paidAt: new Date() } : {}),
            },
          });
          if (claimed.count === 0)
            throw new ConflictException('Invoice changed concurrently, retry the payment');
          if (willBePaid) {
            invoiceStatusChanges.push({
              entityType: 'carrier-invoice',
              entityId: a.targetId,
              from: inv.status,
              to: InvoiceStatus.PAID,
            });
          }
        }
      }

      // Post GL inside the same transaction via the transactional ledger entrypoint (Task 6b).
      // sourceKind is undefined (not null) — PostInput.sourceKind is string | undefined.
      await this.ledger.postTx(
        tx,
        tenantId,
        {
          date: payment.date,
          memo: `Payment ${payment.paymentNumber}`,
          sourceType: 'payment',
          sourceId: payment.id,
          sourceKind: undefined,
          lines,
        },
        userId,
      );
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'payment',
      entityId: id,
      before: { status: 'DRAFT' },
      after: { status: 'SUBMITTED' },
    });
    // Audit invoice status changes after commit (best-effort — never blocks submit).
    for (const change of invoiceStatusChanges) {
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.STATUS_CHANGE,
        entityType: change.entityType,
        entityId: change.entityId,
        before: { status: change.from },
        after: { status: change.to },
      });
    }
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const payment = await this.get(tenantId, id);
    if (!canTransitionPayment(payment.status as PaymentStatus, PaymentStatus.CANCELLED)) {
      throw new BadRequestException(`Cannot cancel a ${payment.status} payment`);
    }
    const wasSubmitted = payment.status === PaymentStatus.SUBMITTED;
    const settings = await this.moduleSettings.resolve(tenantId, 'billing');
    const modeAccount = await this.modes.resolveAccountCode(tenantId, payment.modeOfPaymentId);
    const arAccount = settings.arAccountCode as string;
    const apAccount = settings.apAccountCode as string;
    const allocated = payment.allocations.reduce((s, a) => s + Number(a.amount), 0);

    // Reversal = swap debit/credit.
    const lines =
      payment.type === PaymentType.RECEIVE
        ? [
            { accountCode: modeAccount, credit: allocated },
            { accountCode: arAccount, debit: allocated },
          ]
        : [
            { accountCode: apAccount, credit: allocated },
            { accountCode: modeAccount, debit: allocated },
          ];

    if (wasSubmitted) {
      await this.ledger.ensureChart(tenantId);
    }

    const cancelInvoiceRevertChanges: Array<{
      entityType: string;
      entityId: string;
      from: string;
      to: string;
    }> = [];

    await this.prisma.$transaction(async (tx: any) => {
      const claim = await tx.payment.updateMany({
        where: { id, tenantId, status: payment.status },
        data: { status: PaymentStatus.CANCELLED, cancelledAt: new Date() },
      });
      if (claim.count === 0) throw new BadRequestException('Payment changed concurrently');

      if (wasSubmitted) {
        for (const a of payment.allocations) {
          if (a.targetType === PaymentTargetType.CUSTOMER_INVOICE) {
            const inv = await tx.customerInvoice.findFirst({
              where: { id: a.targetId, tenantId },
              select: { totalAmount: true, amountPaid: true, status: true, sentAt: true },
            });
            if (!inv) continue;
            const priorPaid = inv.amountPaid;
            const newPaid = Math.max(0, Number(priorPaid) - Number(a.amount));
            const willRevert =
              inv.status === CustomerInvoiceStatus.PAID && newPaid < Number(inv.totalAmount);
            const revertTarget = willRevert
              ? inv.sentAt
                ? CustomerInvoiceStatus.SENT
                : CustomerInvoiceStatus.APPROVED
              : null;
            if (willRevert && revertTarget) {
              if (
                !canTransitionCustomerInvoice(inv.status as CustomerInvoiceStatus, revertTarget)
              ) {
                throw new BadRequestException(
                  `Cannot revert customer invoice from ${inv.status} to ${revertTarget}`,
                );
              }
            }
            // Finding 1 (cancel): conditional-claim (TOCTOU guard) on amountPaid decrement.
            const claimed = await tx.customerInvoice.updateMany({
              where: { id: a.targetId, tenantId, amountPaid: priorPaid },
              data: {
                amountPaid: new Prisma.Decimal(newPaid),
                ...(willRevert && revertTarget ? { status: revertTarget, paidAt: null } : {}),
              },
            });
            if (claimed.count === 0)
              throw new ConflictException('Invoice changed concurrently, retry the cancellation');
            if (willRevert && revertTarget) {
              cancelInvoiceRevertChanges.push({
                entityType: 'customer-invoice',
                entityId: a.targetId,
                from: inv.status,
                to: revertTarget,
              });
            }
          } else {
            const inv = await tx.invoice.findFirst({
              where: { id: a.targetId, tenantId },
              select: { totalAmount: true, amountPaid: true, status: true },
            });
            if (!inv) continue;
            const priorPaid = inv.amountPaid;
            const newPaid = Math.max(0, Number(priorPaid) - Number(a.amount));
            const willRevert =
              inv.status === InvoiceStatus.PAID && newPaid < Number(inv.totalAmount);
            const revertTarget = InvoiceStatus.APPROVED;
            if (willRevert) {
              if (!canTransitionInvoice(inv.status as InvoiceStatus, revertTarget)) {
                throw new BadRequestException(
                  `Cannot revert carrier invoice from ${inv.status} to ${revertTarget}`,
                );
              }
            }
            // Finding 1 (cancel): conditional-claim (TOCTOU guard) on amountPaid decrement.
            const claimed = await tx.invoice.updateMany({
              where: { id: a.targetId, tenantId, amountPaid: priorPaid },
              data: {
                amountPaid: new Prisma.Decimal(newPaid),
                ...(willRevert ? { status: revertTarget, paidAt: null } : {}),
              },
            });
            if (claimed.count === 0)
              throw new ConflictException('Invoice changed concurrently, retry the cancellation');
            if (willRevert) {
              cancelInvoiceRevertChanges.push({
                entityType: 'carrier-invoice',
                entityId: a.targetId,
                from: inv.status,
                to: revertTarget,
              });
            }
          }
        }
        // Post reversal GL entry with sourceKind='reversal' (distinct idempotence key from submit).
        await this.ledger.postTx(
          tx,
          tenantId,
          {
            date: new Date(),
            memo: `Reversal of payment ${payment.paymentNumber}`,
            sourceType: 'payment',
            sourceId: payment.id,
            sourceKind: 'reversal',
            lines,
          },
          userId,
        );
      }
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'payment',
      entityId: id,
      before: { status: payment.status },
      after: { status: 'CANCELLED' },
    });
    // Audit invoice status reversions after commit (best-effort).
    for (const change of cancelInvoiceRevertChanges) {
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.STATUS_CHANGE,
        entityType: change.entityType,
        entityId: change.entityId,
        before: { status: change.from },
        after: { status: change.to },
      });
    }
    return this.get(tenantId, id);
  }
}
