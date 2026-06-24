import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, sumLineItems } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { CreateLineItemDto, UpdateLineItemDto } from './dto/line-item.dto';

/**
 * CRM deal line-items service. All operations are tenant-scoped (rule 1).
 * Every mutation (create/update/delete) recomputes deal.amount = Σ line totals
 * inside the same transaction (rule 2 pattern: atomic mutation + derived aggregate).
 * ProductId FK checked via tenant-scoped lookup (rule 9). Audited (rule 6).
 */
@Injectable()
export class LineItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async assertDealOwned(tenantId: string, dealId: string) {
    const deal = await this.prisma.crmDeal.findFirst({
      where: { id: dealId, tenantId },
      select: { id: true, currency: true },
    });
    if (!deal) throw new NotFoundException('CRM deal not found');
    return deal;
  }

  /** Recompute deal.amount = Σ line totals. Must run inside the caller's transaction. */
  private async recomputeDealAmount(tx: any, tenantId: string, dealId: string) {
    const lines = await tx.crmDealLineItem.findMany({ where: { tenantId, dealId } });
    const total = sumLineItems(
      lines.map((l: any) => ({
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountPct: Number(l.discountPct),
      })),
    );
    await tx.crmDeal.updateMany({ where: { id: dealId, tenantId }, data: { amount: total } });
    return total;
  }

  async list(tenantId: string, dealId: string) {
    await this.assertDealOwned(tenantId, dealId);
    return this.prisma.crmDealLineItem.findMany({
      where: { tenantId, dealId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(tenantId: string, userId: string, dealId: string, dto: CreateLineItemDto) {
    const deal = await this.assertDealOwned(tenantId, dealId);

    let name = dto.name;
    let unitPrice = dto.unitPrice;
    const currency = deal.currency;

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
      const line = await tx.crmDealLineItem.create({
        data: {
          tenantId,
          dealId,
          productId: dto.productId ?? null,
          name,
          quantity: dto.quantity ?? 1,
          unitPrice: unitPrice ?? 0,
          discountPct: dto.discountPct ?? 0,
          currency,
        },
      });
      await this.recomputeDealAmount(tx, tenantId, dealId);
      return line;
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm-line-item',
      entityId: created.id,
      after: { dealId, name, quantity: created.quantity },
    });

    return created;
  }

  async update(tenantId: string, userId: string, dealId: string, id: string, dto: UpdateLineItemDto) {
    await this.assertDealOwned(tenantId, dealId);
    const existing = await this.prisma.crmDealLineItem.findFirst({
      where: { id, tenantId, dealId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('CRM line item not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.crmDealLineItem.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
          ...(dto.unitPrice !== undefined ? { unitPrice: dto.unitPrice } : {}),
          ...(dto.discountPct !== undefined ? { discountPct: dto.discountPct } : {}),
        },
      });
      await this.recomputeDealAmount(tx, tenantId, dealId);
      return tx.crmDealLineItem.findUnique({ where: { id } });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-line-item',
      entityId: id,
      after: { ...dto },
    });

    return updated;
  }

  async remove(tenantId: string, userId: string, dealId: string, id: string) {
    await this.assertDealOwned(tenantId, dealId);
    const existing = await this.prisma.crmDealLineItem.findFirst({
      where: { id, tenantId, dealId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('CRM line item not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.crmDealLineItem.delete({ where: { id } });
      await this.recomputeDealAmount(tx, tenantId, dealId);
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'crm-line-item',
      entityId: id,
      after: { dealId },
    });

    return { ok: true };
  }
}
