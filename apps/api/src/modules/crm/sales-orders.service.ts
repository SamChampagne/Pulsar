import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, canTransitionSalesOrder, CrmDealStage, SalesOrderStatus, sumLineItems } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { SequencesService } from '../../prisma/sequences.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { CreateSalesOrderDto, SalesOrderListQueryDto, UpdateSalesOrderDto } from './dto/sales-order.dto';

/**
 * CRM sales orders service. All operations are tenant-scoped (rule 1).
 * Status transitions use canTransitionSalesOrder from @pulsar/shared (rule 2).
 * Claim-safe updates via updateMany with optimistic status lock (TOCTOU).
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly sequences: SequencesService,
  ) {}

  async list(tenantId: string, query: SalesOrderListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.status ? { status: query.status as SalesOrderStatus } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.search
        ? { number: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { company: { select: { id: true, name: true } } },
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, tenantId },
      include: {
        company: { select: { id: true, name: true } },
        lineItems: true,
      },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    return order;
  }

  async create(tenantId: string, userId: string, dto: CreateSalesOrderDto) {
    // R9: assert companyId is owned by this tenant
    const company = await this.prisma.crmCompany.findFirst({
      where: { id: dto.companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new BadRequestException(`Unknown crm-company "${dto.companyId}"`);

    // R9: assert customerId owned if provided
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw new BadRequestException(`Unknown customer "${dto.customerId}"`);
    }

    // R9: assert dealId owned if provided
    if (dto.dealId) {
      const deal = await this.prisma.crmDeal.findFirst({
        where: { id: dto.dealId, tenantId },
        select: { id: true },
      });
      if (!deal) throw new BadRequestException(`Unknown crm-deal "${dto.dealId}"`);
    }

    // R8: document number from SequencesService
    const number = await this.sequences.nextNumber(tenantId, 'sales-order');

    const order = await this.prisma.salesOrder.create({
      data: {
        tenantId,
        number,
        status: SalesOrderStatus.DRAFT,
        companyId: dto.companyId,
        customerId: dto.customerId ?? null,
        dealId: dto.dealId ?? null,
        currency: dto.currency ?? 'CAD',
        notes: dto.notes ?? null,
        ownerUserId: dto.ownerUserId ?? null,
        totalAmount: 0,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm-sales-order',
      entityId: order.id,
      after: { number: order.number, status: order.status, companyId: order.companyId },
    });

    return this.get(tenantId, order.id);
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateSalesOrderDto) {
    // Only notes/ownerUserId/currency are writable — status/number/companyId are not
    const { count } = await this.prisma.salesOrder.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('Sales order not found');

    const order = await this.get(tenantId, id);

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-sales-order',
      entityId: id,
      after: { status: order.status, currency: order.currency },
    });

    return order;
  }

  /**
   * Convert a WON deal into a DRAFT SalesOrder, copying all deal line items as a snapshot.
   * Guards: deal must be WON (mirrors DealsService.convert) and have ≥1 line item.
   */
  async createFromDeal(tenantId: string, userId: string, dealId: string) {
    const deal = await this.prisma.crmDeal.findFirst({
      where: { id: dealId, tenantId },
      include: { company: true },
    });
    if (!deal) throw new NotFoundException('CRM deal not found');
    if (deal.stage !== CrmDealStage.WON) {
      throw new BadRequestException('Only WON deals can be converted to a sales order');
    }

    const dealLines = await this.prisma.crmDealLineItem.findMany({
      where: { tenantId, dealId },
    });
    if (dealLines.length === 0) {
      throw new BadRequestException('Deal must have at least one line item to create a sales order');
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextNumber(tenantId, 'sales-order');

      const so = await tx.salesOrder.create({
        data: {
          tenantId,
          number,
          status: SalesOrderStatus.DRAFT,
          companyId: deal.companyId,
          customerId: deal.convertedCustomerId ?? null,
          dealId: deal.id,
          currency: deal.currency,
          totalAmount: 0,
        },
      });

      // Snapshot deal line items
      await tx.salesOrderLineItem.createMany({
        data: dealLines.map((l) => ({
          tenantId,
          salesOrderId: so.id,
          productId: l.productId ?? null,
          name: l.name,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountPct: Number(l.discountPct),
          currency: l.currency ?? deal.currency,
        })),
      });

      // Recompute totalAmount from the just-copied lines
      const total = sumLineItems(
        dealLines.map((l) => ({
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountPct: Number(l.discountPct),
        })),
      );
      await tx.salesOrder.updateMany({
        where: { id: so.id, tenantId },
        data: { totalAmount: total },
      });

      return so;
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm-sales-order',
      entityId: order.id,
      after: { number: order.number, status: order.status, fromDeal: dealId },
    });

    return this.get(tenantId, order.id);
  }

  /**
   * Transition a sales order's status. Guards with canTransitionSalesOrder (rule 2).
   * Claim-safe: optimistic lock on current status (TOCTOU).
   */
  async transition(tenantId: string, userId: string, id: string, to: SalesOrderStatus) {
    const order = await this.prisma.salesOrder.findFirst({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Sales order not found');

    if (!canTransitionSalesOrder(order.status as SalesOrderStatus, to)) {
      throw new BadRequestException(`Cannot transition sales order from ${order.status} to ${to}`);
    }

    const res = await this.prisma.salesOrder.updateMany({
      where: { id, tenantId, status: order.status }, // TOCTOU claim
      data: { status: to },
    });
    if (res.count === 0) throw new BadRequestException('Sales order changed concurrently; retry');

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'crm-sales-order',
      entityId: id,
      before: { status: order.status },
      after: { status: to },
    });

    return this.get(tenantId, id);
  }
}
