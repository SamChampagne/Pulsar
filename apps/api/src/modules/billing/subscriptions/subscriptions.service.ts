import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  canTransitionSubscription,
  advanceRunDate,
  SubscriptionStatus,
  SubscriptionInterval,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { CreateSubscriptionDto, UpdateSubscriptionDto } from './dto/subscription.dto';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const subscriptionInclude = {
  lines: true,
  customer: { select: { id: true, code: true, name: true } },
} as const;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
  ) {}

  list(tenantId: string) {
    return this.prisma.subscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: subscriptionInclude,
    });
  }

  async get(tenantId: string, id: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { id, tenantId },
      include: subscriptionInclude,
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  async create(tenantId: string, userId: string, dto: CreateSubscriptionDto) {
    await this.ownership.assertOwned('customer', dto.customerId, tenantId);
    const startDate = new Date(dto.startDate);
    const nextRunDate = dto.nextRunDate ? new Date(dto.nextRunDate) : startDate;
    const sub = await this.prisma.subscription.create({
      data: {
        tenantId,
        name: dto.name,
        customerId: dto.customerId,
        interval: dto.interval,
        startDate,
        nextRunDate,
        currency: dto.currency ?? 'CAD',
        lines: {
          create: dto.lines.map((l) => ({
            tenantId,
            description: l.description,
            amount: new Prisma.Decimal(l.amount),
          })),
        },
      },
      include: subscriptionInclude,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'subscription',
      entityId: sub.id,
      after: { name: sub.name, customerId: sub.customerId, interval: sub.interval },
    });
    return sub;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateSubscriptionDto) {
    const existing = await this.get(tenantId, id);
    if (dto.customerId && dto.customerId !== existing.customerId) {
      await this.ownership.assertOwned('customer', dto.customerId, tenantId);
    }
    const sub = await this.prisma.$transaction(async (tx) => {
      if (dto.lines !== undefined) {
        await tx.subscriptionLine.deleteMany({ where: { subscriptionId: id } });
      }
      return tx.subscription.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
          ...(dto.interval !== undefined ? { interval: dto.interval } : {}),
          ...(dto.startDate !== undefined ? { startDate: new Date(dto.startDate) } : {}),
          ...(dto.nextRunDate !== undefined ? { nextRunDate: new Date(dto.nextRunDate) } : {}),
          ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
          ...(dto.lines !== undefined
            ? {
                lines: {
                  create: dto.lines.map((l) => ({
                    tenantId,
                    description: l.description,
                    amount: new Prisma.Decimal(l.amount),
                  })),
                },
              }
            : {}),
        },
        include: subscriptionInclude,
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'subscription',
      entityId: id,
      before: { name: existing.name },
      after: { name: sub.name },
    });
    return sub;
  }

  async remove(tenantId: string, userId: string, id: string) {
    await this.get(tenantId, id);
    const linked = await this.prisma.subscriptionInvoice.count({ where: { tenantId, subscriptionId: id } });
    if (linked > 0) {
      throw new ConflictException('Cannot delete a subscription that has generated invoices');
    }
    await this.prisma.subscription.deleteMany({ where: { id, tenantId } });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'subscription',
      entityId: id,
    });
    return { deleted: true };
  }

  private async transition(
    tenantId: string,
    userId: string,
    id: string,
    from: SubscriptionStatus,
    to: SubscriptionStatus,
  ) {
    const sub = await this.get(tenantId, id);
    if (!canTransitionSubscription(sub.status as SubscriptionStatus, to)) {
      throw new BadRequestException(`Invalid transition ${sub.status} → ${to}`);
    }
    const { count } = await this.prisma.subscription.updateMany({
      where: { id, tenantId, status: from },
      data: { status: to },
    });
    if (count === 0) {
      throw new ConflictException(`Subscription is not ${from} (concurrent update)`);
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'subscription',
      entityId: id,
      before: { status: from },
      after: { status: to },
    });
    return this.get(tenantId, id);
  }

  pause(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED);
  }

  resume(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, SubscriptionStatus.PAUSED, SubscriptionStatus.ACTIVE);
  }

  cancel(tenantId: string, userId: string, id: string) {
    return this.get(tenantId, id).then((sub) =>
      this.transition(tenantId, userId, id, sub.status as SubscriptionStatus, SubscriptionStatus.CANCELLED),
    );
  }

  async generate(tenantId: string, userId: string, id: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE subscriptions can generate invoices');
    }

    const d = sub.nextRunDate;
    const periodStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

    const total = round2(sub.lines.reduce((acc, l) => acc + Number(l.amount), 0));

    // Mint invoice number BEFORE the transaction (sequences use raw SQL on shared client).
    const invoiceNumber = await this.sequences.nextNumber(tenantId, 'customer-invoice');

    let invoice: { id: string; invoiceNumber: string };
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const created = await tx.customerInvoice.create({
          data: {
            tenantId,
            invoiceNumber,
            customerId: sub.customerId,
            status: 'DRAFT',
            currency: sub.currency,
            totalAmount: new Prisma.Decimal(total),
            lines: {
              create: sub.lines.map((l) => ({
                transportOrderId: null,
                source: 'subscription',
                description: l.description,
                amount: new Prisma.Decimal(Number(l.amount)),
                priceDetail: Prisma.JsonNull,
              })),
            },
          },
          select: { id: true, invoiceNumber: true },
        });

        await tx.subscriptionInvoice.create({
          data: {
            tenantId,
            subscriptionId: id,
            periodStart,
            customerInvoiceId: created.id,
          },
        });

        await tx.subscription.updateMany({
          where: { id, tenantId },
          data: {
            nextRunDate: advanceRunDate(sub.nextRunDate, sub.interval as SubscriptionInterval),
          },
        });

        return created;
      });
      invoice = result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Already generated for this period');
      }
      throw err;
    }

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'subscription',
      entityId: id,
      after: {
        event: 'generate',
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        periodStart: periodStart.toISOString(),
        total,
      },
    });

    // Return the full invoice record for the caller.
    return this.prisma.customerInvoice.findFirst({
      where: { id: invoice.id },
      include: {
        customer: { select: { id: true, code: true, name: true, email: true } },
        lines: true,
      },
    });
  }

  async runDue(tenantId: string, userId: string): Promise<{ generated: number; skipped: number; errors: number }> {
    const subs = await this.prisma.subscription.findMany({
      where: { tenantId, status: SubscriptionStatus.ACTIVE, nextRunDate: { lte: new Date() } },
      select: { id: true },
    });
    let generated = 0;
    let skipped = 0;
    let errors = 0;
    for (const sub of subs) {
      try {
        await this.generate(tenantId, userId, sub.id);
        generated++;
      } catch (err) {
        if (err instanceof ConflictException) {
          skipped++;
        } else {
          errors++;
        }
      }
    }
    return { generated, skipped, errors };
  }
}
