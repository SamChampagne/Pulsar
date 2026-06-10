import { Injectable } from '@nestjs/common';
import { LoadStatus, ShipmentStatus, TenderStatus } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';

export interface CarrierScorecard {
  carrierId: string;
  code: string;
  name: string;
  loadsCompleted: number;
  loadsActive: number;
  tendersSent: number;
  tendersAccepted: number;
  /** Accepted / responded (accepted+declined), in percent. Null when no responses yet. */
  acceptanceRatePct: number | null;
  /** Delivered on or before plannedDeliveryAt, in percent. Null when not measurable. */
  onTimeDeliveryPct: number | null;
  totalEstimatedCost: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async carrierScorecards(tenantId: string): Promise<CarrierScorecard[]> {
    const [carriers, loads, tenders, deliveredShipments] = await Promise.all([
      this.prisma.carrier.findMany({
        where: { tenantId },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.load.findMany({
        where: { tenantId, carrierId: { not: null } },
        select: { carrierId: true, status: true, estimatedCost: true },
      }),
      this.prisma.tender.findMany({
        where: { tenantId },
        select: { carrierId: true, status: true },
      }),
      this.prisma.shipment.findMany({
        where: {
          tenantId,
          status: { in: [ShipmentStatus.DELIVERED, ShipmentStatus.CLOSED] },
          actualDeliveryAt: { not: null },
          load: { carrierId: { not: null } },
        },
        select: {
          plannedDeliveryAt: true,
          actualDeliveryAt: true,
          load: { select: { carrierId: true } },
        },
      }),
    ]);

    const activeStatuses: string[] = [
      LoadStatus.TENDERED,
      LoadStatus.DISPATCHED,
      LoadStatus.IN_TRANSIT,
    ];

    return carriers.map((carrier) => {
      const carrierLoads = loads.filter((l) => l.carrierId === carrier.id);
      const carrierTenders = tenders.filter((t) => t.carrierId === carrier.id);
      const accepted = carrierTenders.filter((t) => t.status === TenderStatus.ACCEPTED).length;
      const responded =
        accepted + carrierTenders.filter((t) => t.status === TenderStatus.DECLINED).length;

      const deliveries = deliveredShipments.filter((s) => s.load?.carrierId === carrier.id);
      const measurable = deliveries.filter((s) => s.plannedDeliveryAt !== null);
      const onTime = measurable.filter(
        (s) => s.actualDeliveryAt! <= s.plannedDeliveryAt!,
      ).length;

      const pct = (num: number, den: number) =>
        den === 0 ? null : Math.round((num / den) * 1000) / 10;

      return {
        carrierId: carrier.id,
        code: carrier.code,
        name: carrier.name,
        loadsCompleted: carrierLoads.filter((l) => l.status === LoadStatus.COMPLETED).length,
        loadsActive: carrierLoads.filter((l) => activeStatuses.includes(l.status)).length,
        tendersSent: carrierTenders.length,
        tendersAccepted: accepted,
        acceptanceRatePct: pct(accepted, responded),
        onTimeDeliveryPct: pct(onTime, measurable.length),
        totalEstimatedCost: carrierLoads.reduce(
          (acc, l) => acc + (l.estimatedCost === null ? 0 : Number(l.estimatedCost)),
          0,
        ),
      };
    });
  }
}
