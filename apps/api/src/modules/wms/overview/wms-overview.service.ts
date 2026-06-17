import { Injectable } from '@nestjs/common';
import { computeReplenishment } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Read-only dashboard rollup for the WMS module: distinct active items, open
 * (DRAFT) receipts, open (OPEN/PICKED) pick orders, negative bins (data
 * integrity attention list) and the total on-hand across all levels. All
 * figures are computed on read and tenant-scoped (rule 1).
 */
@Injectable()
export class WmsOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(tenantId: string) {
    const [distinctItems, openReceipts, openPickOrders, negativeLevels, levelsAgg] =
      await Promise.all([
        this.prisma.wmsItem.count({ where: { tenantId, isActive: true } }),
        this.prisma.receipt.count({ where: { tenantId, status: 'DRAFT' } }),
        this.prisma.pickOrder.count({
          where: { tenantId, status: { in: ['OPEN', 'PICKED'] } },
        }),
        this.prisma.inventoryLevel.findMany({
          where: { tenantId, qtyOnHand: { lt: 0 } },
          take: 50,
          include: {
            item: { select: { sku: true } },
            bin: { select: { code: true } },
          },
        }),
        this.prisma.inventoryLevel.aggregate({
          where: { tenantId },
          _sum: { qtyOnHand: true },
        }),
      ]);

    // Replenishment: items at/below reorder point (computed on read).
    const [reorderItems, openCycleCounts] = await Promise.all([
      this.prisma.wmsItem.findMany({
        where: { tenantId, isActive: true, reorderPoint: { not: null } },
        select: { id: true, sku: true, name: true, reorderPoint: true, reorderQty: true },
      }),
      this.prisma.cycleCount.count({ where: { tenantId, status: { in: ['OPEN', 'COUNTED'] } } }),
    ]);
    const onHandSums =
      reorderItems.length > 0
        ? await this.prisma.inventoryLevel.groupBy({
            by: ['itemId'],
            where: { tenantId, itemId: { in: reorderItems.map((i) => i.id) } },
            _sum: { qtyOnHand: true },
          })
        : [];
    const onHand = new Map<string, number>();
    for (const s of onHandSums) onHand.set(s.itemId, Number(s._sum.qtyOnHand ?? 0));
    const belowMin = reorderItems
      .map((i) => {
        const oh = onHand.get(i.id) ?? 0;
        return {
          id: i.id,
          sku: i.sku,
          name: i.name,
          onHand: oh,
          reorderPoint: i.reorderPoint,
          ...computeReplenishment({
            onHand: oh,
            reorderPoint: i.reorderPoint,
            reorderQty: i.reorderQty,
          }),
        };
      })
      .filter((i) => i.belowMin);

    return {
      distinctItems,
      openReceipts,
      openPickOrders,
      negativeBins: negativeLevels,
      totalOnHand: Number(levelsAgg._sum.qtyOnHand ?? 0),
      belowMin,
      openCycleCounts,
    };
  }
}
