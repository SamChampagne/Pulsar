import { Injectable } from '@nestjs/common';
import { LoadStatus } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { RatingService } from '../rating/rating.service';

/**
 * Recomputes the estimated buy-side cost + frozen calculation snapshot of a load.
 * Called whenever the rate, the route (distance), the shipment mix or the load's
 * accessorial flags change.
 *
 * SPEC INVARIANT (audit trail): a COMPLETED load is NEVER recomputed — its
 * estimatedCost/costDetail snapshot is the source of truth for reconciliation.
 */
@Injectable()
export class LoadCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rating: RatingService,
  ) {}

  async recompute(tenantId: string, loadId: string): Promise<void> {
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      select: { status: true, rateId: true },
    });
    if (!load) return;
    if (load.status === LoadStatus.COMPLETED) return;

    if (!load.rateId) {
      await this.prisma.load.update({
        where: { id: loadId },
        data: { estimatedCost: null, costCurrency: null, costDetail: Prisma.DbNull },
      });
      return;
    }

    const evaluation = await this.rating.evaluateAssignedRate(tenantId, loadId);
    await this.prisma.load.update({
      where: { id: loadId },
      data: {
        estimatedCost: evaluation ? evaluation.breakdown.total : null,
        costCurrency: evaluation ? evaluation.currency : null,
        costDetail: evaluation ? evaluation.snapshot : Prisma.DbNull,
      },
    });
  }
}
