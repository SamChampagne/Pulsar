import { Injectable, Logger } from '@nestjs/common';
import {
  AssetStatus,
  MODULE_KEYS,
  buildExceptionHeatmap,
  computeAvgDwellMinutes,
  computeAvgMaintenanceDays,
  computeOccupancyPct,
  computeReadinessPct,
  computeUptimePct,
  deriveAgentKpis,
} from '@pulsar/shared';
import type {
  AgentKpiRaw,
  ExceptionHeatmap,
  HeatmapSeverity,
  HeatmapTask,
  ScorecardsAgentRoi,
  ScorecardsDto,
  ScorecardsFleetUptime,
  ScorecardsWarehouseReadiness,
  ScorecardsYardCongestion,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';

/**
 * Scorecards — cross-module read-time KPIs (C1-M2). Rule 30: computed on read from
 * AgentRun/ProposedAction/OperationalTask/AuditLog + module entities, no rollup store,
 * no migration. Pure ratio/heatmap math lives in @pulsar/shared. Every section is
 * tenant-scoped (rule 1) and defensive: a failing or empty section yields null/empty
 * and never breaks the others. Agent projections exclude secretHash/serviceUserId
 * (rule 26) — only public fields are selected.
 *
 * Agent ROI reuses deriveAgentKpis (do not recompute ratios) and an agentSelect-style
 * projection that never reads secretHash/serviceUserId.
 */
@Injectable()
export class ScorecardsService {
  private readonly logger = new Logger(ScorecardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
  ) {}

  async scorecards(tenantId: string, days: number): Promise<ScorecardsDto> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const now = new Date();

    let enabled: Set<string>;
    try {
      enabled = await this.modulesCache.getEnabledKeys(tenantId);
    } catch (err) {
      this.logger.warn(`scorecards: module lookup failed — ${String(err)}`);
      enabled = new Set();
    }

    const [fleetUptime, yardCongestion, warehouseReadiness, exceptionHeatmap, agentRoi] =
      await Promise.all([
        enabled.has(MODULE_KEYS.FLEET)
          ? this.buildFleetUptime(tenantId, since)
          : Promise.resolve(null),
        enabled.has(MODULE_KEYS.YARD)
          ? this.buildYardCongestion(tenantId, since, now)
          : Promise.resolve(null),
        enabled.has(MODULE_KEYS.WMS)
          ? this.buildWarehouseReadiness(tenantId, since)
          : Promise.resolve(null),
        this.buildExceptionHeatmap(tenantId, since, days),
        this.buildAgentRoi(tenantId, since),
      ]);

    return {
      sinceDays: days,
      fleetUptime,
      yardCongestion,
      warehouseReadiness,
      exceptionHeatmap,
      agentRoi,
    };
  }

  // -------------------------------------------------------------------------
  // Fleet uptime
  // -------------------------------------------------------------------------
  private async buildFleetUptime(
    tenantId: string,
    since: Date,
  ): Promise<ScorecardsFleetUptime | null> {
    try {
      const [vehicleGroups, trailerGroups, completedMos, openMaintenanceOrders] =
        await Promise.all([
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
          this.prisma.maintenanceOrder.findMany({
            where: { tenantId, status: 'COMPLETED', completedAt: { gte: since, not: null } },
            select: { openedAt: true, completedAt: true },
          }),
          this.prisma.maintenanceOrder.count({
            where: { tenantId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          }),
        ]);

      const tally = (groups: { status: string; _count: { id: number } }[]) => {
        let total = 0;
        let available = 0;
        let inMaintenance = 0;
        for (const g of groups) {
          total += g._count.id;
          if (g.status === AssetStatus.AVAILABLE) available += g._count.id;
          if (g.status === AssetStatus.MAINTENANCE) inMaintenance += g._count.id;
        }
        return { total, available, inMaintenance, uptimePct: computeUptimePct(available, total) };
      };

      return {
        vehicles: tally(vehicleGroups),
        trailers: tally(trailerGroups),
        avgMaintenanceDays: computeAvgMaintenanceDays(completedMos),
        openMaintenanceOrders,
      };
    } catch (err) {
      this.logger.warn(`scorecards: fleetUptime failed — ${String(err)}`);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Yard congestion
  // -------------------------------------------------------------------------
  private async buildYardCongestion(
    tenantId: string,
    since: Date,
    now: Date,
  ): Promise<ScorecardsYardCongestion | null> {
    try {
      const [activeVisits, occupiedSpotGroups, totalSpots, dwellVisits, appointmentsAtRisk] =
        await Promise.all([
          this.prisma.yardVisit.count({
            where: { tenantId, status: { in: ['CHECKED_IN', 'ASSIGNED'] } },
          }),
          this.prisma.yardVisit.groupBy({
            by: ['spotId'],
            where: {
              tenantId,
              status: { in: ['CHECKED_IN', 'ASSIGNED'] },
              spotId: { not: null },
            },
          }),
          this.prisma.yardSpot.count({ where: { tenantId } }),
          this.prisma.yardVisit.findMany({
            where: { tenantId, checkOutAt: { gte: since, not: null } },
            select: { checkInAt: true, checkOutAt: true },
          }),
          this.prisma.dockAppointment.count({
            where: { tenantId, status: { in: ['SCHEDULED', 'ARRIVED'] }, windowEnd: { lt: now } },
          }),
        ]);

      const occupiedSpots = occupiedSpotGroups.length;
      return {
        activeVisits,
        occupiedSpots,
        totalSpots,
        occupancyPct: computeOccupancyPct(occupiedSpots, totalSpots),
        avgDwellMinutes: computeAvgDwellMinutes(dwellVisits),
        appointmentsAtRisk,
      };
    } catch (err) {
      this.logger.warn(`scorecards: yardCongestion failed — ${String(err)}`);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Warehouse readiness — mirrors WmsOverviewService below-min logic (reorderPoint)
  // -------------------------------------------------------------------------
  private async buildWarehouseReadiness(
    tenantId: string,
    since: Date,
  ): Promise<ScorecardsWarehouseReadiness | null> {
    try {
      const [openPickOrders, completedPickOrders, reorderItems, stockOutLevels] =
        await Promise.all([
          this.prisma.pickOrder.count({
            where: { tenantId, status: { in: ['OPEN', 'PICKED'] }, createdAt: { gte: since } },
          }),
          this.prisma.pickOrder.count({
            where: { tenantId, status: 'COMPLETED', completedAt: { gte: since, not: null } },
          }),
          // Items with a reorder point ("min"); below-min computed on read like the WMS overview.
          this.prisma.wmsItem.findMany({
            where: { tenantId, isActive: true, reorderPoint: { not: null } },
            select: { id: true, reorderPoint: true },
          }),
          // Stock-out = item with any bin at or below zero on-hand.
          this.prisma.inventoryLevel.groupBy({
            by: ['itemId'],
            where: { tenantId },
            _sum: { qtyOnHand: true },
          }),
        ]);

      // itemsBelowMin: total on-hand across bins ≤ reorderPoint (mirrors computeReplenishment.belowMin).
      const onHand = new Map<string, number>();
      for (const lvl of stockOutLevels) {
        onHand.set(lvl.itemId, Number(lvl._sum.qtyOnHand ?? 0));
      }
      let itemsBelowMin = 0;
      for (const item of reorderItems) {
        const oh = onHand.get(item.id) ?? 0;
        if (item.reorderPoint !== null && oh <= item.reorderPoint) itemsBelowMin += 1;
      }

      // stockOutItems: active items whose total on-hand is ≤ 0.
      const activeItemIds = new Set(
        (
          await this.prisma.wmsItem.findMany({
            where: { tenantId, isActive: true },
            select: { id: true },
          })
        ).map((i) => i.id),
      );
      let stockOutItems = 0;
      for (const [itemId, qty] of onHand) {
        if (activeItemIds.has(itemId) && qty <= 0) stockOutItems += 1;
      }

      return {
        openPickOrders,
        completedPickOrders,
        readinessPct: computeReadinessPct(openPickOrders, completedPickOrders),
        itemsBelowMin,
        stockOutItems,
      };
    } catch (err) {
      this.logger.warn(`scorecards: warehouseReadiness failed — ${String(err)}`);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Exception heatmap — OperationalTask since → pure buildExceptionHeatmap
  // -------------------------------------------------------------------------
  private async buildExceptionHeatmap(
    tenantId: string,
    since: Date,
    days: number,
  ): Promise<ExceptionHeatmap> {
    try {
      const tasks = await this.prisma.operationalTask.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: { category: true, severity: true, createdAt: true },
        take: 5000,
      });
      const mapped: HeatmapTask[] = tasks.map((t) => ({
        category: t.category,
        severity: t.severity as HeatmapSeverity,
        createdAt: t.createdAt,
      }));
      return buildExceptionHeatmap(mapped, days);
    } catch (err) {
      this.logger.warn(`scorecards: exceptionHeatmap failed — ${String(err)}`);
      return buildExceptionHeatmap([], days);
    }
  }

  // -------------------------------------------------------------------------
  // Agent ROI — per-agent deriveAgentKpis. Projection excludes secretHash/serviceUserId.
  // -------------------------------------------------------------------------
  private async buildAgentRoi(tenantId: string, since: Date): Promise<ScorecardsAgentRoi[]> {
    try {
      const agents = await this.prisma.agent.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        // agentSelect-style projection: public fields only (rule 26).
        select: { id: true, name: true, avatar: true },
      });
      return await Promise.all(
        agents.map(async (a) => ({
          agentId: a.id,
          name: a.name,
          avatar: a.avatar,
          kpis: deriveAgentKpis(await this.gatherKpiRaw(tenantId, a.id, since)),
        })),
      );
    } catch (err) {
      this.logger.warn(`scorecards: agentRoi failed — ${String(err)}`);
      return [];
    }
  }

  /**
   * Raw KPI counts for one agent within the window — mirrors AgentsService.gatherKpiRaw.
   * Breaker trips come from the audit trail (entityType='agent', after.breakerTripped=true),
   * like the control-tower/trust score (rule 30).
   */
  private async gatherKpiRaw(
    tenantId: string,
    agentId: string,
    since: Date,
  ): Promise<AgentKpiRaw> {
    const pa = (extra: object) =>
      this.prisma.proposedAction.count({
        where: { tenantId, agentId, proposedAt: { gte: since }, ...extra },
      });
    const run = (extra: object) =>
      this.prisma.agentRun.count({
        where: { tenantId, agentId, createdAt: { gte: since }, ...extra },
      });
    const [
      executed,
      autoApproved,
      pending,
      rejected,
      failed,
      runsTotal,
      runsSucceeded,
      runsFailed,
      runsSkipped,
      runsKilled,
      breakerTrips,
      tasksResolved,
      finishedRuns,
    ] = await Promise.all([
      pa({ status: 'EXECUTED' }),
      pa({ status: 'EXECUTED', autoApproved: true }),
      pa({ status: 'PENDING' }),
      pa({ status: 'REJECTED' }),
      pa({ status: 'FAILED' }),
      run({}),
      run({ status: 'SUCCEEDED' }),
      run({ status: 'FAILED' }),
      run({ status: 'SKIPPED' }),
      run({ status: 'KILLED' }),
      this.prisma.auditLog.count({
        where: {
          tenantId,
          entityType: 'agent',
          entityId: agentId,
          after: { path: ['breakerTripped'], equals: true },
          createdAt: { gte: since },
        },
      }),
      this.prisma.operationalTask.count({
        where: { tenantId, assigneeAgentId: agentId, status: 'RESOLVED', resolvedAt: { gte: since } },
      }),
      this.prisma.agentRun.findMany({
        where: {
          tenantId,
          agentId,
          createdAt: { gte: since },
          startedAt: { not: null },
          finishedAt: { not: null },
        },
        select: { startedAt: true, finishedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    const runLatenciesMs = finishedRuns
      .filter((r) => r.startedAt && r.finishedAt)
      .map((r) => r.finishedAt!.getTime() - r.startedAt!.getTime());
    return {
      executed,
      autoApproved,
      pending,
      rejected,
      failed,
      runsTotal,
      runsSucceeded,
      runsFailed,
      runsSkipped,
      runsKilled,
      runLatenciesMs,
      breakerTrips,
      tasksResolved,
    };
  }
}
