import { Injectable } from '@nestjs/common';
import { AssetStatus, DriverStatus, LoadStatus, ShipmentStatus, checkCapacity } from '@pulsar/shared';
import type { CapacityExcess } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Single read-only aggregation backing the Planning Board UI. No writes, no new
 * business logic — assignment/capacity/recompute all live in the existing TMS
 * services. Capacity excesses are computed with the shared `checkCapacity`
 * (rule 18), never reimplemented here. Everything is tenant-scoped (rule 1) and
 * returned as an explicit projection (never raw Prisma entities).
 */

const CAP = 100;

export interface PlanningShipment {
  id: string;
  shipmentNumber: string;
  status: ShipmentStatus;
  weightKg?: number;
  volumeM3?: number;
  pallets?: number;
  originLabel: string;
  destinationLabel: string;
  customerName?: string;
}

export interface PlanningLoad {
  id: string;
  loadNumber: string;
  status: LoadStatus;
  mode?: string;
  carrierName?: string;
  driverName?: string;
  trailerLabel?: string;
  capacity?: { weightKg?: number; volumeM3?: number; pallets?: number };
  totals: { weightKg: number; volumeM3: number; pallets: number };
  excesses: CapacityExcess[];
  shipments: { id: string; shipmentNumber: string }[];
}

export interface PlanningResource {
  id: string;
  label: string;
  status: string;
}

export interface PlanningTrailer extends PlanningResource {
  capacityWeightKg?: number;
  capacityVolumeM3?: number;
  capacityPallets?: number;
}

export interface PlanningBoardDto {
  unassignedShipments: PlanningShipment[];
  openLoads: PlanningLoad[];
  resources: {
    vehicles: PlanningResource[];
    trailers: PlanningTrailer[];
    drivers: PlanningResource[];
  };
}

/** Location label mirrors how the rest of the TMS presents a location (name, fallback code). */
function locationLabel(loc: { code: string; name: string } | null): string {
  if (!loc) return '';
  return loc.name || loc.code || '';
}

/** Sums an axis across shipments; null only when no shipment provided a value (mirrors the TMS services). */
function sumAxis(values: (number | null)[]): number | null {
  return values.some((v) => v !== null) ? values.reduce<number>((acc, v) => acc + (v ?? 0), 0) : null;
}

@Injectable()
export class PlanningBoardService {
  constructor(private readonly prisma: PrismaService) {}

  async getBoard(tenantId: string): Promise<PlanningBoardDto> {
    const [shipments, loads, vehicles, trailers, drivers] = await Promise.all([
      this.prisma.shipment.findMany({
        where: { tenantId, loadId: null, status: ShipmentStatus.PENDING },
        take: CAP,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          shipmentNumber: true,
          status: true,
          weightKg: true,
          volumeM3: true,
          palletCount: true,
          originLocation: { select: { code: true, name: true } },
          destinationLocation: { select: { code: true, name: true } },
          transportOrder: { select: { customer: { select: { name: true } } } },
        },
      }),
      this.prisma.load.findMany({
        where: { tenantId, status: { in: [LoadStatus.OPEN, LoadStatus.PLANNED] } },
        take: CAP,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          loadNumber: true,
          status: true,
          mode: true,
          carrier: { select: { name: true } },
          driver: { select: { firstName: true, lastName: true } },
          trailer: {
            select: {
              unitNumber: true,
              capacityWeightKg: true,
              capacityVolumeM3: true,
              capacityPallets: true,
            },
          },
          shipments: {
            select: { id: true, shipmentNumber: true, weightKg: true, volumeM3: true, palletCount: true },
          },
        },
      }),
      this.prisma.vehicle.findMany({
        where: { tenantId, status: AssetStatus.AVAILABLE },
        take: CAP,
        orderBy: { unitNumber: 'asc' },
        select: { id: true, unitNumber: true, status: true },
      }),
      this.prisma.trailer.findMany({
        where: { tenantId, status: AssetStatus.AVAILABLE },
        take: CAP,
        orderBy: { unitNumber: 'asc' },
        select: {
          id: true,
          unitNumber: true,
          status: true,
          capacityWeightKg: true,
          capacityVolumeM3: true,
          capacityPallets: true,
        },
      }),
      this.prisma.driver.findMany({
        where: { tenantId, status: DriverStatus.ACTIVE },
        take: CAP,
        orderBy: { lastName: 'asc' },
        select: { id: true, firstName: true, lastName: true, status: true },
      }),
    ]);

    const unassignedShipments: PlanningShipment[] = shipments.map((s) => ({
      id: s.id,
      shipmentNumber: s.shipmentNumber,
      status: s.status as ShipmentStatus,
      weightKg: s.weightKg ?? undefined,
      volumeM3: s.volumeM3 ?? undefined,
      pallets: s.palletCount ?? undefined,
      originLabel: locationLabel(s.originLocation),
      destinationLabel: locationLabel(s.destinationLocation),
      customerName: s.transportOrder?.customer?.name ?? undefined,
    }));

    const openLoads: PlanningLoad[] = loads.map((load) => {
      const totalsRaw = {
        weightKg: sumAxis(load.shipments.map((s) => s.weightKg)),
        volumeM3: sumAxis(load.shipments.map((s) => s.volumeM3)),
        pallets: sumAxis(load.shipments.map((s) => s.palletCount)),
      };
      const trailer = load.trailer;
      // Capacity excesses come from the shared checkCapacity (rule 18) against the
      // assigned trailer's capacity and the load's shipment totals. No trailer ⇒ no axes ⇒ [].
      const excesses = trailer
        ? checkCapacity(
            {
              weightKg: trailer.capacityWeightKg,
              volumeM3: trailer.capacityVolumeM3,
              pallets: trailer.capacityPallets,
            },
            totalsRaw,
          )
        : [];
      const driverName = load.driver
        ? `${load.driver.firstName} ${load.driver.lastName}`.trim()
        : undefined;
      return {
        id: load.id,
        loadNumber: load.loadNumber,
        status: load.status as LoadStatus,
        mode: load.mode ?? undefined,
        carrierName: load.carrier?.name ?? undefined,
        driverName: driverName || undefined,
        trailerLabel: trailer?.unitNumber ?? undefined,
        capacity: trailer
          ? {
              weightKg: trailer.capacityWeightKg ?? undefined,
              volumeM3: trailer.capacityVolumeM3 ?? undefined,
              pallets: trailer.capacityPallets ?? undefined,
            }
          : undefined,
        totals: {
          weightKg: totalsRaw.weightKg ?? 0,
          volumeM3: totalsRaw.volumeM3 ?? 0,
          pallets: totalsRaw.pallets ?? 0,
        },
        excesses,
        shipments: load.shipments.map((s) => ({ id: s.id, shipmentNumber: s.shipmentNumber })),
      };
    });

    return {
      unassignedShipments,
      openLoads,
      resources: {
        vehicles: vehicles.map((v) => ({ id: v.id, label: v.unitNumber, status: v.status })),
        trailers: trailers.map((t) => ({
          id: t.id,
          label: t.unitNumber,
          status: t.status,
          capacityWeightKg: t.capacityWeightKg ?? undefined,
          capacityVolumeM3: t.capacityVolumeM3 ?? undefined,
          capacityPallets: t.capacityPallets ?? undefined,
        })),
        drivers: drivers.map((d) => ({
          id: d.id,
          label: `${d.firstName} ${d.lastName}`.trim(),
          status: d.status,
        })),
      },
    };
  }
}
