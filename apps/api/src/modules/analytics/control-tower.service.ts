import { Injectable, Logger } from '@nestjs/common';
import {
  AssetStatus,
  LoadStatus,
  MODULE_KEYS,
  ShipmentStatus,
  avg,
  computeFleetAvailability,
  computeOtif,
  sortAttention,
} from '@pulsar/shared';
import type {
  AttentionItem,
  ControlTower,
  ControlTowerKpis,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';

const ATTENTION_LIMIT = 50;

@Injectable()
export class ControlTowerService {
  private readonly logger = new Logger(ControlTowerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
  ) {}

  async controlTower(tenantId: string, days: number): Promise<ControlTower> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const now = new Date();

    const enabledModules = await this.modulesCache.getEnabledKeys(tenantId);
    const hasFleet = enabledModules.has(MODULE_KEYS.FLEET);
    const hasYard = enabledModules.has(MODULE_KEYS.YARD);
    const hasWms = enabledModules.has(MODULE_KEYS.WMS);
    const hasBilling = enabledModules.has(MODULE_KEYS.BILLING);

    const attention: AttentionItem[] = [];

    // -------------------------------------------------------------------------
    // Core: load_late — active loads with a shipment whose plannedDeliveryLate has passed
    // -------------------------------------------------------------------------
    let lateLoadsCount = 0;
    try {
      const lateLoads = await this.prisma.load.findMany({
        where: {
          tenantId,
          status: { in: [LoadStatus.DISPATCHED, LoadStatus.IN_TRANSIT, LoadStatus.TENDERED] },
          shipments: {
            some: {
              plannedDeliveryLate: { lt: now },
              status: { notIn: [ShipmentStatus.DELIVERED, ShipmentStatus.CLOSED, ShipmentStatus.CANCELLED] },
            },
          },
        },
        select: { id: true, loadNumber: true, updatedAt: true },
        take: ATTENTION_LIMIT,
        orderBy: { updatedAt: 'asc' },
      });

      lateLoadsCount = lateLoads.length;
      for (const load of lateLoads) {
        attention.push({
          kind: 'load_late',
          severity: 'critical',
          label: `Load ${load.loadNumber} is late`,
          ref: load.id,
          href: `/loads/${load.id}`,
          at: load.updatedAt.toISOString(),
        });
      }
    } catch (err) {
      this.logger.warn(`controlTower: load_late query failed — ${String(err)}`);
    }

    // -------------------------------------------------------------------------
    // Billing (best-effort): freight_dispute — IncomingCarrierInvoice with DISPUTED status
    // -------------------------------------------------------------------------
    if (hasBilling) {
      try {
        const disputes = await this.prisma.incomingCarrierInvoice.findMany({
          where: { tenantId, status: 'DISPUTED' },
          select: { id: true, carrierInvoiceNumber: true, updatedAt: true },
          take: ATTENTION_LIMIT,
          orderBy: { updatedAt: 'desc' },
        });
        for (const inv of disputes) {
          attention.push({
            kind: 'freight_dispute',
            severity: 'warning',
            label: `Freight dispute on invoice ${inv.carrierInvoiceNumber}`,
            ref: inv.id,
            href: `/billing/freight-audit/${inv.id}`,
            at: inv.updatedAt.toISOString(),
          });
        }
      } catch (err) {
        this.logger.warn(`controlTower: freight_dispute query failed — ${String(err)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Fleet (best-effort): asset_out_of_service — Vehicle/Trailer in MAINTENANCE
    // (schema does not have OUT_OF_SERVICE; MAINTENANCE is the closest equivalent)
    // -------------------------------------------------------------------------
    if (hasFleet) {
      try {
        const [vehicles, trailers] = await Promise.all([
          this.prisma.vehicle.findMany({
            where: { tenantId, status: AssetStatus.MAINTENANCE },
            select: { id: true, unitNumber: true, updatedAt: true },
            take: ATTENTION_LIMIT,
          }),
          this.prisma.trailer.findMany({
            where: { tenantId, status: AssetStatus.MAINTENANCE },
            select: { id: true, unitNumber: true, updatedAt: true },
            take: ATTENTION_LIMIT,
          }),
        ]);
        for (const v of vehicles) {
          attention.push({
            kind: 'asset_out_of_service',
            severity: 'warning',
            label: `Vehicle ${v.unitNumber} is in maintenance`,
            ref: v.id,
            href: `/fleet/vehicles/${v.id}`,
            at: v.updatedAt.toISOString(),
          });
        }
        for (const t of trailers) {
          attention.push({
            kind: 'asset_out_of_service',
            severity: 'warning',
            label: `Trailer ${t.unitNumber} is in maintenance`,
            ref: t.id,
            href: `/fleet/trailers/${t.id}`,
            at: t.updatedAt.toISOString(),
          });
        }
      } catch (err) {
        this.logger.warn(`controlTower: asset_out_of_service query failed — ${String(err)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Yard (best-effort): dock_at_risk — DockAppointment not completed, windowEnd < now
    // -------------------------------------------------------------------------
    if (hasYard) {
      try {
        const atRisk = await this.prisma.dockAppointment.findMany({
          where: {
            tenantId,
            status: { in: ['SCHEDULED', 'ARRIVED'] },
            windowEnd: { lt: now },
          },
          select: { id: true, appointmentNumber: true, windowEnd: true },
          take: ATTENTION_LIMIT,
          orderBy: { windowEnd: 'asc' },
        });
        for (const appt of atRisk) {
          attention.push({
            kind: 'dock_at_risk',
            severity: 'warning',
            label: `Dock appointment ${appt.appointmentNumber} window elapsed`,
            ref: appt.id,
            href: `/yard/appointments`,
            at: appt.windowEnd.toISOString(),
          });
        }
      } catch (err) {
        this.logger.warn(`controlTower: dock_at_risk query failed — ${String(err)}`);
      }
    }

    // -------------------------------------------------------------------------
    // WMS (best-effort): pick_ready_not_dispatched — PickOrder COMPLETED with shipment
    // not yet dispatched (status not DISPATCHED/IN_TRANSIT/DELIVERED/CLOSED)
    // -------------------------------------------------------------------------
    if (hasWms) {
      try {
        const readyPicks = await this.prisma.pickOrder.findMany({
          where: {
            tenantId,
            status: 'COMPLETED',
            shipmentId: { not: null },
            shipment: {
              status: {
                notIn: [
                  ShipmentStatus.DISPATCHED,
                  ShipmentStatus.IN_TRANSIT,
                  ShipmentStatus.DELIVERED,
                  ShipmentStatus.CLOSED,
                  ShipmentStatus.CANCELLED,
                ],
              },
            },
          },
          select: { id: true, number: true, updatedAt: true },
          take: ATTENTION_LIMIT,
          orderBy: { updatedAt: 'asc' },
        });
        for (const pick of readyPicks) {
          attention.push({
            kind: 'pick_ready_not_dispatched',
            severity: 'info',
            label: `Pick order ${pick.number} ready but shipment not dispatched`,
            ref: pick.id,
            href: `/wms/picking/${pick.id}`,
            at: pick.updatedAt.toISOString(),
          });
        }
      } catch (err) {
        this.logger.warn(`controlTower: pick_ready_not_dispatched query failed — ${String(err)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Agents (always attempted — ProposedAction exists for all tenants with agents):
    // agent_action_pending — ProposedAction with PENDING status
    // -------------------------------------------------------------------------
    let agentActionsPendingCount = 0;
    try {
      const pendingActions = await this.prisma.proposedAction.findMany({
        where: { tenantId, status: 'PENDING' },
        select: { id: true, tool: true, proposedAt: true },
        take: ATTENTION_LIMIT,
        orderBy: { proposedAt: 'asc' },
      });
      agentActionsPendingCount = pendingActions.length;
      for (const action of pendingActions) {
        attention.push({
          kind: 'agent_action_pending',
          severity: 'info',
          label: `Agent action pending approval: ${action.tool}`,
          ref: action.id,
          href: `/agent-actions`,
          at: action.proposedAt.toISOString(),
        });
      }
    } catch (err) {
      this.logger.warn(`controlTower: agent_action_pending query failed — ${String(err)}`);
    }

    // -------------------------------------------------------------------------
    // KPIs
    // -------------------------------------------------------------------------
    const kpis = await this.buildKpis({
      tenantId,
      since,
      hasFleet,
      hasBilling,
      lateLoadsCount,
      agentActionsPendingCount,
    });

    return {
      rangeDays: days,
      kpis,
      attention: sortAttention(attention).slice(0, ATTENTION_LIMIT),
    };
  }

  private async buildKpis(opts: {
    tenantId: string;
    since: Date;
    hasFleet: boolean;
    hasBilling: boolean;
    lateLoadsCount: number;
    agentActionsPendingCount: number;
  }): Promise<ControlTowerKpis> {
    const { tenantId, since, hasFleet, hasBilling, lateLoadsCount, agentActionsPendingCount } = opts;

    // Core transport KPIs (always attempted — transportation is core-ish)
    let loadsInTransit = 0;
    let otifPct: number | null = null;
    let avgCostPerLoad: number | null = null;

    try {
      loadsInTransit = await this.prisma.load.count({
        where: { tenantId, status: { in: [LoadStatus.DISPATCHED, LoadStatus.IN_TRANSIT] } },
      });
    } catch (err) {
      this.logger.warn(`controlTower: loadsInTransit KPI failed — ${String(err)}`);
    }

    try {
      const deliveredShipments = await this.prisma.shipment.findMany({
        where: {
          tenantId,
          status: { in: [ShipmentStatus.DELIVERED, ShipmentStatus.CLOSED] },
          actualDeliveryAt: { gte: since, not: null },
        },
        select: { plannedDeliveryLate: true, actualDeliveryAt: true },
      });
      const otifRows = deliveredShipments.map((s) => ({
        onTime:
          s.plannedDeliveryLate !== null &&
          s.actualDeliveryAt !== null &&
          s.actualDeliveryAt <= s.plannedDeliveryLate,
      }));
      otifPct = computeOtif(otifRows);
    } catch (err) {
      this.logger.warn(`controlTower: otifPct KPI failed — ${String(err)}`);
    }

    try {
      const completedLoads = await this.prisma.load.findMany({
        where: {
          tenantId,
          status: LoadStatus.COMPLETED,
          completedAt: { gte: since },
          estimatedCost: { not: null },
        },
        select: { estimatedCost: true },
      });
      const costs = completedLoads
        .map((l) => (l.estimatedCost !== null ? Number(l.estimatedCost) : null))
        .filter((c): c is number => c !== null);
      avgCostPerLoad = avg(costs);
    } catch (err) {
      this.logger.warn(`controlTower: avgCostPerLoad KPI failed — ${String(err)}`);
    }

    // Billing KPIs (best-effort)
    let recoveredAmount = 0;
    let disputesOpen = 0;
    if (hasBilling) {
      try {
        const resolved = await this.prisma.incomingCarrierInvoice.findMany({
          where: {
            tenantId,
            resolvedAt: { gte: since, not: null },
            recoveredAmount: { gt: 0 },
          },
          select: { recoveredAmount: true },
        });
        recoveredAmount = resolved.reduce(
          (sum, inv) => sum + Number(inv.recoveredAmount),
          0,
        );
      } catch (err) {
        this.logger.warn(`controlTower: recoveredAmount KPI failed — ${String(err)}`);
      }

      try {
        disputesOpen = await this.prisma.incomingCarrierInvoice.count({
          where: { tenantId, status: 'DISPUTED' },
        });
      } catch (err) {
        this.logger.warn(`controlTower: disputesOpen KPI failed — ${String(err)}`);
      }
    }

    // Fleet KPI (best-effort)
    let fleetAvailabilityPct: number | null = null;
    if (hasFleet) {
      try {
        const [vehicles, trailers] = await Promise.all([
          this.prisma.vehicle.groupBy({
            by: ['status'],
            where: { tenantId, status: { not: AssetStatus.RETIRED } },
            _count: { id: true },
          }),
          this.prisma.trailer.groupBy({
            by: ['status'],
            where: { tenantId, status: { not: AssetStatus.RETIRED } },
            _count: { id: true },
          }),
        ]);

        let available = 0;
        let total = 0;
        for (const row of [...vehicles, ...trailers]) {
          total += row._count.id;
          if (row.status === AssetStatus.AVAILABLE) available += row._count.id;
        }
        fleetAvailabilityPct = computeFleetAvailability({ available, total });
      } catch (err) {
        this.logger.warn(`controlTower: fleetAvailabilityPct KPI failed — ${String(err)}`);
      }
    }

    // Operational tasks (always attempted)
    let tasksOpen = 0;
    try {
      tasksOpen = await this.prisma.operationalTask.count({
        where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      });
    } catch (err) {
      this.logger.warn(`controlTower: tasksOpen KPI failed — ${String(err)}`);
    }

    return {
      loadsInTransit,
      loadsLate: lateLoadsCount,
      otifPct,
      avgCostPerLoad,
      recoveredAmount,
      disputesOpen,
      fleetAvailabilityPct,
      agentActionsPending: agentActionsPendingCount,
      tasksOpen,
    };
  }
}
