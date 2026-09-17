import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, sumLineItems } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import {
  CreateSalesOrderLineItemDto,
  UpdateSalesOrderLineItemDto,
} from './dto/sales-order-line-item.dto';

/**
 * CRM sales-order line-items service. All operations are tenant-scoped (rule 1).
 * Every mutation (create/update/delete) requires the order to be DRAFT (409 otherwise),
 * and recomputes salesOrder.totalAmount = Σ line totals inside the same transaction.
 * ProductId FK checked via tenant-scoped lookup (rule 9). Audited (rule 6).
 */
@Injectable()
export class SalesOrderLineItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /** Asserts order exists and is DRAFT. Returns order (for currency). Throws 404/409. */
  private async assertOrderDraft(
    tenantId: string,
    salesOrderId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const order = await tx.salesOrder.findFirst({
      where: { id: salesOrderId, tenantId },
      select: { id: true, status: true, currency: true },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status !== 'DRAFT') {
      throw new ConflictException('Line items can only be edited on a DRAFT order');
    }
    return order;
  }

  /** Recompute salesOrder.totalAmount = Σ line totals. Must run inside the caller's transaction. */
  private async recomputeOrderTotal(
    tx: Prisma.TransactionClient,
    tenantId: string,
    salesOrderId: string,
  ) {
    const lines = await tx.salesOrderLineItem.findMany({ where: { tenantId, salesOrderId } });
    const total = sumLineItems(
      lines.map((l) => ({
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountPct: Number(l.discountPct),
      })),
    );
    const parent = await tx.salesOrder.findFirstOrThrow({ where: { id: salesOrderId, tenantId } });
    await tx.salesOrder.updateMany({
      where: { id: salesOrderId, tenantId },
      data: {
        totalAmount: total,
        updatedAt: new Date(Math.max(Date.now(), parent.updatedAt.getTime() + 1)),
      },
    });
    return total;
  }

  async list(tenantId: string, salesOrderId: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, tenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    return this.prisma.salesOrderLineItem.findMany({
      where: { tenantId, salesOrderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    tenantId: string,
    userId: string,
    salesOrderId: string,
    dto: CreateSalesOrderLineItemDto,
  ) {
    const order = await this.assertOrderDraft(tenantId, salesOrderId);

    let name = dto.name;
    let unitPrice = dto.unitPrice;
    const currency = order.currency;

    if (dto.productId) {
      const product = await this.prisma.crmProduct.findFirst({
        where: { id: dto.productId, tenantId },
      });
      if (!product) throw new BadRequestException(`Unknown crm-product "${dto.productId}"`);
      name = name ?? product.name;
      unitPrice = unitPrice ?? Number(product.unitPrice);
    }

    if (!name) throw new BadRequestException('Line item requires a name (or a productId)');

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      await this.assertOrderDraft(tenantId, salesOrderId, tx);
      const line = await tx.salesOrderLineItem.create({
        data: {
          tenantId,
          salesOrderId,
          productId: dto.productId ?? null,
          name,
          quantity: dto.quantity ?? 1,
          unitPrice: unitPrice ?? 0,
          discountPct: dto.discountPct ?? 0,
          currency,
        },
      });
      await this.recomputeOrderTotal(tx, tenantId, salesOrderId);
      return line;
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm-so-line-item',
      entityId: created.id,
      after: { salesOrderId, name, quantity: created.quantity },
    });

    return created;
  }

  async update(
    tenantId: string,
    userId: string,
    salesOrderId: string,
    id: string,
    dto: UpdateSalesOrderLineItemDto,
  ) {
    await this.assertOrderDraft(tenantId, salesOrderId);
    const existing = await this.prisma.salesOrderLineItem.findFirst({
      where: { id, tenantId, salesOrderId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Sales order line item not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      await this.assertOrderDraft(tenantId, salesOrderId, tx);
      const { count } = await tx.salesOrderLineItem.updateMany({
        where: { id, tenantId, salesOrderId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
          ...(dto.unitPrice !== undefined ? { unitPrice: dto.unitPrice } : {}),
          ...(dto.discountPct !== undefined ? { discountPct: dto.discountPct } : {}),
        },
      });
      if (!count) throw new NotFoundException('Sales order line item not found');
      await this.recomputeOrderTotal(tx, tenantId, salesOrderId);
      return tx.salesOrderLineItem.findFirstOrThrow({ where: { id, tenantId, salesOrderId } });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-so-line-item',
      entityId: id,
      after: { ...dto },
    });

    return updated;
  }

  async remove(tenantId: string, userId: string, salesOrderId: string, id: string) {
    await this.assertOrderDraft(tenantId, salesOrderId);
    const existing = await this.prisma.salesOrderLineItem.findFirst({
      where: { id, tenantId, salesOrderId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Sales order line item not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      await this.assertOrderDraft(tenantId, salesOrderId, tx);
      await tx.salesOrderLineItem.deleteMany({ where: { id, tenantId, salesOrderId } });
      await this.recomputeOrderTotal(tx, tenantId, salesOrderId);
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'crm-so-line-item',
      entityId: id,
      after: { salesOrderId },
    });

    return { ok: true };
  }
}
