import { Injectable } from '@nestjs/common';
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

    return {
      distinctItems,
      openReceipts,
      openPickOrders,
      negativeBins: negativeLevels,
      totalOnHand: Number(levelsAgg._sum.qtyOnHand ?? 0),
    };
  }
}
