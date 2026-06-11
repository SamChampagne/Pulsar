import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  CustomerInvoiceStatus,
  TransportOrderStatus,
  canTransitionCustomerInvoice,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { EmailService } from '../../core/email/email.service';
import { RatingService } from '../transportation/rating/rating.service';

const statementInclude = {
  customer: { select: { id: true, code: true, name: true, email: true } },
  lines: {
    include: {
      transportOrder: { select: { id: true, orderNumber: true, customerReference: true } },
    },
  },
} as const;

interface RatedOrder {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  snapshot: Prisma.InputJsonValue;
}

interface UnratableOrder {
  orderId: string;
  orderNumber: string;
  reason: 'NO_APPLICABLE_RATE';
}

/** Groups rated orders by the winning rate's currency — one statement per currency. */
export function groupByCurrency(rated: RatedOrder[]): Map<string, RatedOrder[]> {
  const groups = new Map<string, RatedOrder[]>();
  for (const r of rated) {
    const group = groups.get(r.currency) ?? [];
    group.push(r);
    groups.set(r.currency, group);
  }
  return groups;
}

/**
 * Customer billing statements (sell-side). Delivered orders are priced with the
 * customer's rates at draft time; the snapshot freezes on the line. Never bills
 * 0 by accident: unratable orders are excluded and surfaced with their reason.
 */
@Injectable()
export class CustomerInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly email: EmailService,
    private readonly rating: RatingService,
  ) {}

  list(tenantId: string, status?: CustomerInvoiceStatus, customerId?: string) {
    return this.prisma.customerInvoice.findMany({
      where: { tenantId, ...(status ? { status } : {}), ...(customerId ? { customerId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: statementInclude,
    });
  }

  async get(tenantId: string, id: string) {
    const statement = await this.prisma.customerInvoice.findFirst({
      where: { id, tenantId },
      include: statementInclude,
    });
    if (!statement) throw new NotFoundException('Billing statement not found');
    return statement;
  }

  /** Rates every billable order of the customer; nothing is persisted. */
  private async rateBillableOrders(tenantId: string, customerId: string) {
    await this.ownership.assertOwned('customer', customerId, tenantId);
    const orders = await this.prisma.transportOrder.findMany({
      where: {
        tenantId,
        customerId,
        status: { in: [TransportOrderStatus.COMPLETED, TransportOrderStatus.CLOSED] },
        customerInvoiceLine: null,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, orderNumber: true },
    });

    const rated: RatedOrder[] = [];
    const unratable: UnratableOrder[] = [];
    for (const order of orders) {
      const evaluation = await this.rating.rateOrder(tenantId, order.id);
      if (evaluation) {
        rated.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: evaluation.breakdown.total,
          currency: evaluation.currency,
          snapshot: evaluation.snapshot,
        });
      } else {
        unratable.push({ orderId: order.id, orderNumber: order.orderNumber, reason: 'NO_APPLICABLE_RATE' });
      }
    }
    return { rated, unratable };
  }

  /** Preview: what the next generation would bill (and what it would skip, with reasons). */
  async billable(tenantId: string, customerId: string) {
    const { rated, unratable } = await this.rateBillableOrders(tenantId, customerId);
    return {
      ratable: rated.map(({ snapshot: _snapshot, ...r }) => r),
      unratable,
    };
  }

  /** Generates DRAFT statements — one per currency encountered (spec currency rule). */
  async createDrafts(tenantId: string, userId: string, customerId: string) {
    const { rated, unratable } = await this.rateBillableOrders(tenantId, customerId);
    if (rated.length === 0) {
      throw new BadRequestException({
        message: 'No ratable delivered orders for this customer',
        unratable,
      });
    }

    const invoices = [];
    for (const [currency, group] of groupByCurrency(rated)) {
      const total = group.reduce((acc, r) => acc + r.amount, 0);
      const invoice = await this.prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: await this.sequences.nextNumber(tenantId, 'customer-invoice'),
          customerId,
          currency,
          totalAmount: Math.round(total * 100) / 100,
          lines: {
            create: group.map((r) => ({
              transportOrderId: r.orderId,
              description: `Order ${r.orderNumber}`,
              amount: r.amount,
              priceDetail: r.snapshot,
            })),
          },
        },
        include: statementInclude,
      });
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.CREATE,
        entityType: 'customer-invoice',
        entityId: invoice.id,
        after: { invoiceNumber: invoice.invoiceNumber, customerId, currency, lines: group.length },
      });
      invoices.push(invoice);
    }
    return { invoices, unratable };
  }

  /** The only escape path of a draft: deletion frees the orders (cascade on lines). */
  async deleteDraft(tenantId: string, userId: string, id: string) {
    const statement = await this.get(tenantId, id);
    if (statement.status !== CustomerInvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT statements can be deleted');
    }
    await this.prisma.customerInvoice.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'customer-invoice',
      entityId: id,
      before: {
        invoiceNumber: statement.invoiceNumber,
        status: statement.status,
        orders: statement.lines.map((l) => l.transportOrder.orderNumber),
      },
    });
    return { deleted: true };
  }

  /** Conditional-update transition (anti-TOCTOU): the WHERE carries the expected status. */
  private async transition(
    tenantId: string,
    userId: string,
    id: string,
    from: CustomerInvoiceStatus,
    to: CustomerInvoiceStatus,
    extra: Prisma.CustomerInvoiceUpdateManyMutationInput = {},
  ) {
    if (!canTransitionCustomerInvoice(from, to)) {
      throw new BadRequestException(`Invalid transition ${from} → ${to}`);
    }
    const { count } = await this.prisma.customerInvoice.updateMany({
      where: { id, tenantId, status: from },
      data: { status: to, ...extra },
    });
    if (count === 0) {
      throw new BadRequestException(`Statement is not ${from}`);
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'customer-invoice',
      entityId: id,
      before: { status: from },
      after: { status: to },
    });
    return this.get(tenantId, id);
  }

  approve(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, CustomerInvoiceStatus.DRAFT, CustomerInvoiceStatus.APPROVED, {
      approvedAt: new Date(),
    });
  }

  /** Emails the statement summary to the customer contact; no email, no SENT. */
  async send(tenantId: string, userId: string, id: string) {
    const statement = await this.get(tenantId, id);
    if (statement.status !== CustomerInvoiceStatus.APPROVED) {
      throw new BadRequestException('Only APPROVED statements can be sent');
    }
    if (!statement.customer.email) {
      throw new BadRequestException('Customer has no email address on file');
    }
    const rows = statement.lines
      .map(
        (l) =>
          `<tr><td>${l.transportOrder.orderNumber}</td><td>${l.description}</td><td style="text-align:right">${l.amount} ${statement.currency}</td></tr>`,
      )
      .join('');
    const sent = await this.email.send({
      to: statement.customer.email,
      subject: `Billing statement ${statement.invoiceNumber}`,
      html: [
        `<p>Please find below your billing statement <strong>${statement.invoiceNumber}</strong>.</p>`,
        `<table><tr><th>Order</th><th>Description</th><th>Amount</th></tr>${rows}</table>`,
        `<p><strong>Total: ${statement.totalAmount} ${statement.currency}</strong></p>`,
      ].join('\n'),
      text: `Billing statement ${statement.invoiceNumber} — total ${statement.totalAmount} ${statement.currency}`,
    });
    if (!sent) {
      throw new BadRequestException('Email could not be sent — statement not marked SENT');
    }
    return this.transition(tenantId, userId, id, CustomerInvoiceStatus.APPROVED, CustomerInvoiceStatus.SENT, {
      sentAt: new Date(),
    });
  }

  markPaid(tenantId: string, userId: string, id: string, paidAt?: string) {
    return this.transition(tenantId, userId, id, CustomerInvoiceStatus.SENT, CustomerInvoiceStatus.PAID, {
      paidAt: paidAt ? new Date(paidAt) : new Date(),
    });
  }
}
