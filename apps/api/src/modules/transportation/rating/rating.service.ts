import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AccessorialUnit,
  CostBreakdown,
  CostMetrics,
  ENDPOINT_SPECIFICITY,
  RateStatus,
  RateType,
  RequestedAccessorial,
  calculateRateCost,
  candidateEndpointKeys,
  pickFuelEntry,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveLoadEndpoints } from './load-endpoints';

const rateDetailInclude = {
  carrier: { select: { id: true, code: true, name: true } },
  lane: { select: { id: true, name: true, originType: true, destinationType: true, createdAt: true } },
  fuelTable: { select: { id: true, name: true, entries: { orderBy: { effectiveFrom: 'desc' as const } } } },
  breaks: { orderBy: { upToKg: 'asc' as const } },
  accessorialPrices: { include: { accessorial: { select: { code: true, name: true, unit: true } } } },
} satisfies Prisma.RateInclude;

type RateDetail = Prisma.RateGetPayload<{ include: typeof rateDetailInclude }>;

interface LoadForRating {
  id: string;
  route: { totalDistanceKm: number | null } | null;
  shipments: { weightKg: number | null; palletCount: number | null; plannedPickupAt: Date | null }[];
  accessorials: { quantity: number; accessorial: { code: string; unit: string } }[];
}

interface FuelResolution {
  pct: number;
  source: 'TABLE' | 'STATIC' | 'NONE';
  tableId?: string;
  effectiveFrom?: string;
}

export interface RateEvaluation {
  breakdown: CostBreakdown;
  currency: string;
  fuel: FuelResolution;
  snapshot: Prisma.InputJsonValue;
}

@Injectable()
export class RatingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reference date: earliest planned pickup, else today. Governs fuel AND validity. */
  referenceDate(shipments: { plannedPickupAt: Date | null }[]): Date {
    const dates = shipments
      .map((s) => s.plannedPickupAt)
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime());
    return dates.length > 0 ? new Date(Math.min(...dates)) : new Date();
  }

  isValidAt(rate: { validFrom: Date | null; validTo: Date | null }, date: Date): boolean {
    if (rate.validFrom && rate.validFrom.getTime() > date.getTime()) return false;
    if (rate.validTo && rate.validTo.getTime() < date.getTime()) return false;
    return true;
  }

  private metricsOf(load: LoadForRating): CostMetrics {
    const sum = (values: (number | null)[]) =>
      values.some((v) => v !== null) ? values.reduce<number>((acc, v) => acc + (v ?? 0), 0) : null;
    return {
      distanceKm: load.route?.totalDistanceKm ?? null,
      weightKg: sum(load.shipments.map((s) => s.weightKg)),
      palletCount: sum(load.shipments.map((s) => s.palletCount)),
    };
  }

  private requestedAccessorials(load: LoadForRating): RequestedAccessorial[] {
    return load.accessorials.map((a) => ({
      code: a.accessorial.code,
      unit: a.accessorial.unit as AccessorialUnit,
      quantity: a.quantity,
    }));
  }

  private resolveFuel(rate: RateDetail, date: Date): FuelResolution {
    if (rate.fuelTable) {
      const entry = pickFuelEntry(rate.fuelTable.entries, date);
      return entry
        ? {
            pct: entry.pct,
            source: 'TABLE',
            tableId: rate.fuelTable.id,
            effectiveFrom: entry.effectiveFrom.toISOString(),
          }
        : { pct: 0, source: 'NONE', tableId: rate.fuelTable.id };
    }
    return rate.fuelSurchargePct != null
      ? { pct: rate.fuelSurchargePct, source: 'STATIC' }
      : { pct: 0, source: 'NONE' };
  }

  async loadForRating(tenantId: string, loadId: string) {
    return this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      select: {
        id: true,
        status: true,
        rateId: true,
        route: { select: { totalDistanceKm: true } },
        shipments: { select: { weightKg: true, palletCount: true, plannedPickupAt: true } },
        accessorials: { select: { quantity: true, accessorial: { select: { code: true, unit: true } } } },
      },
    });
  }

  /**
   * Evaluates one rate against one load. The snapshot is self-contained: the rate as
   * used, the inputs and the result — re-explainable without touching the live rate.
   */
  evaluate(rate: RateDetail, load: LoadForRating, referenceDate: Date): RateEvaluation | null {
    const fuel = this.resolveFuel(rate, referenceDate);
    const requested = this.requestedAccessorials(load);
    const metrics = this.metricsOf(load);
    const breakdown = calculateRateCost(
      {
        rateType: rate.rateType as RateType,
        baseAmount: Number(rate.baseAmount),
        fuelSurchargePct: fuel.pct,
        minCharge: rate.minCharge === null ? null : Number(rate.minCharge),
        breaks: rate.breaks.map((b) => ({ upToKg: b.upToKg, amount: Number(b.amount) })),
        accessorialPrices: rate.accessorialPrices.map((p) => ({
          code: p.accessorial.code,
          amount: Number(p.amount),
        })),
      },
      metrics,
      requested,
    );
    if (!breakdown) return null;

    const snapshot = {
      version: 1,
      computedAt: new Date().toISOString(),
      referenceDate: referenceDate.toISOString(),
      rate: {
        id: rate.id,
        name: rate.name,
        rateType: rate.rateType,
        currency: rate.currency,
        baseAmount: Number(rate.baseAmount),
        minCharge: rate.minCharge === null ? null : Number(rate.minCharge),
        laneId: rate.laneId,
        validFrom: rate.validFrom?.toISOString() ?? null,
        validTo: rate.validTo?.toISOString() ?? null,
        breaks: rate.breaks.map((b) => ({ upToKg: b.upToKg, amount: Number(b.amount) })),
        accessorialPrices: rate.accessorialPrices.map((p) => ({
          code: p.accessorial.code,
          amount: Number(p.amount),
        })),
        fuel,
      },
      inputs: { ...metrics, accessorials: requested },
      result: breakdown,
    };

    return {
      breakdown,
      currency: rate.currency,
      fuel,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    };
  }

  /** Evaluation of the load's assigned rate — what recompute() persists. */
  async evaluateAssignedRate(tenantId: string, loadId: string): Promise<RateEvaluation | null> {
    const load = await this.loadForRating(tenantId, loadId);
    if (!load?.rateId) return null;
    const rate = await this.prisma.rate.findFirst({
      where: { id: load.rateId, tenantId },
      include: rateDetailInclude,
    });
    if (!rate) return null;
    return this.evaluate(rate, load, this.referenceDate(load.shipments));
  }

  /**
   * Rate shopping: every ACTIVE rate valid at the reference date whose lane matches the
   * load (or catch-all), costed in full. Sorted per currency, complete candidates first,
   * cheapest first. Read-only — assignment stays the existing manual endpoint.
   */
  async rateOptions(tenantId: string, loadId: string) {
    const load = await this.loadForRating(tenantId, loadId);
    if (!load) throw new NotFoundException('Load not found');
    const endpoints = await resolveLoadEndpoints(this.prisma, tenantId, loadId);
    const date = this.referenceDate(load.shipments);

    const laneFilter: Prisma.RateWhereInput = endpoints
      ? {
          OR: [
            { laneId: null },
            {
              lane: {
                originKey: { in: candidateEndpointKeys(endpoints.origin) },
                destinationKey: { in: candidateEndpointKeys(endpoints.destination) },
              },
            },
          ],
        }
      : { laneId: null };

    const rates = await this.prisma.rate.findMany({
      where: {
        tenantId,
        status: RateStatus.ACTIVE,
        AND: [
          laneFilter,
          { OR: [{ validFrom: null }, { validFrom: { lte: date } }] },
          { OR: [{ validTo: null }, { validTo: { gte: date } }] },
        ],
      },
      include: rateDetailInclude,
    });

    const options = rates
      .map((rate) => ({ rate, evaluation: this.evaluate(rate, load, date) }))
      .filter((o): o is { rate: RateDetail; evaluation: RateEvaluation } => o.evaluation !== null)
      .map(({ rate, evaluation }) => ({
        rateId: rate.id,
        rateName: rate.name,
        currency: rate.currency,
        carrier: rate.carrier,
        laneSpecificity: rate.lane
          ? {
              originType: rate.lane.originType,
              destinationType: rate.lane.destinationType,
              total:
                ENDPOINT_SPECIFICITY[rate.lane.originType as keyof typeof ENDPOINT_SPECIFICITY] +
                ENDPOINT_SPECIFICITY[rate.lane.destinationType as keyof typeof ENDPOINT_SPECIFICITY],
            }
          : null,
        breakdown: evaluation.breakdown,
        missingAccessorials: evaluation.breakdown.missingAccessorials,
      }))
      .sort((a, b) => {
        if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
        const aIncomplete = a.missingAccessorials.length > 0 ? 1 : 0;
        const bIncomplete = b.missingAccessorials.length > 0 ? 1 : 0;
        if (aIncomplete !== bIncomplete) return aIncomplete - bIncomplete;
        return a.breakdown.total - b.breakdown.total;
      });

    return { referenceDate: date.toISOString(), options };
  }
}
