import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { computeReplenishment } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';

/**
 * WMS continuity: hourly sweep of items with a reorder point. On-hand at/below
 * the point emits `wms.item.below-min` → a WMS_REPLENISH workbench task (idempotent
 * per item via the event→task dedupKey). Best-effort and isolated — never throws
 * (rule 24). Computation is the pure computeReplenishment (@pulsar/shared).
 */
@Injectable()
export class ReplenishmentService {
  private readonly logger = new Logger(ReplenishmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runReplenishmentCheck(): Promise<void> {
    try {
      const items = await this.prisma.wmsItem.findMany({
        where: { isActive: true, reorderPoint: { not: null } },
        take: 1000,
      });
      if (items.length === 0) return;

      const sums = await this.prisma.inventoryLevel.groupBy({
        by: ['itemId'],
        where: { itemId: { in: items.map((i) => i.id) } },
        _sum: { qtyOnHand: true },
      });
      const onHand = new Map<string, number>();
      for (const s of sums) onHand.set(s.itemId, Number(s._sum.qtyOnHand ?? 0));

      for (const item of items) {
        try {
          const oh = onHand.get(item.id) ?? 0;
          const r = computeReplenishment({
            onHand: oh,
            reorderPoint: item.reorderPoint,
            reorderQty: item.reorderQty,
          });
          if (!r.belowMin) continue;
          await this.domainEvents.emit(
            item.tenantId,
            'wms.item.below-min',
            { type: 'wms-item', id: item.id },
            {
              itemId: item.id,
              sku: item.sku,
              name: item.name,
              onHand: oh,
              reorderPoint: item.reorderPoint,
              suggestedQty: r.suggestedQty,
            },
          );
        } catch (err) {
          this.logger.error(
            `replenish check failed for item ${item.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `runReplenishmentCheck failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
