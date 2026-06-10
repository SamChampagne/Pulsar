import { Injectable } from '@nestjs/common';
import { calculateRateCost, RateType } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Recomputes the estimated buy-side cost of a load from its assigned rate.
 * Called whenever the rate, the route (distance) or the shipment mix changes.
 */
@Injectable()
export class LoadCostService {
  constructor(private readonly prisma: PrismaService) {}

  async recompute(tenantId: string, loadId: string): Promise<void> {
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      include: {
        rate: true,
        route: { select: { totalDistanceKm: true } },
        shipments: { select: { weightKg: true, palletCount: true } },
      },
    });
    if (!load) return;

    if (!load.rate) {
      await this.prisma.load.update({
        where: { id: loadId },
        data: { estimatedCost: null, costCurrency: null },
      });
      return;
    }

    const sum = (values: (number | null)[]) =>
      values.some((v) => v !== null) ? values.reduce<number>((acc, v) => acc + (v ?? 0), 0) : null;

    const cost = calculateRateCost(
      {
        rateType: load.rate.rateType as RateType,
        baseAmount: Number(load.rate.baseAmount),
        fuelSurchargePct: load.rate.fuelSurchargePct,
        minCharge: load.rate.minCharge === null ? null : Number(load.rate.minCharge),
      },
      {
        distanceKm: load.route?.totalDistanceKm ?? null,
        weightKg: sum(load.shipments.map((s) => s.weightKg)),
        palletCount: sum(load.shipments.map((s) => s.palletCount)),
      },
    );

    await this.prisma.load.update({
      where: { id: loadId },
      data: {
        estimatedCost: cost ? cost.total : null,
        costCurrency: cost ? load.rate.currency : null,
      },
    });
  }
}
