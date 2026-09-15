import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  ManufacturingFirmness,
  ManufacturingOrderStatus,
  ManufacturingPriority,
  MODULE_KEYS,
  type ManufacturingMaterialSnapshot,
} from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { ApsClient } from '../../../core/aps/aps.client';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { buildManufacturingSnapshot, type SnapshotMaterials } from './snapshot-builder';
import {
  APS_BRIDGE_VERSION,
  APS_ENGINE_REVISION,
  APS_BRIDGE_V2,
  APS_ENGINE_V2,
  type ApsBridgeRequest,
} from '../../../core/aps/aps.types';
import {
  artifactHash,
  explicitHorizon,
  parseApsUtc,
  validateEngineResult,
  validateSnapshot,
} from './aps-artifact';
import { plantWindows } from './plant-time';

export interface RunSchedulingInput {
  strategy?: string;
  horizonStart?: string;
  horizonDays?: number;
  /** V2: local start date and common plant timezone; never infer the host timezone. */
  horizonDate?: string;
  timeZone?: string;
  objective?: {
    makespan?: number;
    total_tardiness?: number;
    weighted_tardiness?: number;
    setup_cost?: number;
    idle_penalty?: number;
  };
  /** SP5: feed WMS on-hand into the engine's material ledger (default false). */
  respectMaterials?: boolean;
}

/**
 * Ties Pulsar manufacturing master-data to the APS engine: load → snapshot →
 * run → persist. The engine call is best-effort (ApsClient maps failure to 503);
 * persistence is transactional so a run never leaves partial assignments.
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aps: ApsClient,
    private readonly audit: AuditLogsService,
    private readonly modulesCache: TenantModulesCacheService,
  ) {}

  /**
   * M2.1: site-scoped WMS stock + the material definition captured at OF release.
   * Never re-read an editable BOM to reconstruct historical requirements.
   * Explicit opt-in is fail-closed: never claim material-aware planning without WMS.
   */
  private async loadMaterials(
    tenantId: string,
    orders: {
      id: string;
      bomId: string | null;
      locationId: string | null;
      materialSnapshot: Prisma.JsonValue;
    }[],
  ): Promise<{ materials: SnapshotMaterials | undefined; warnings: string[] }> {
    const enabled = await this.modulesCache.getEnabledKeys(tenantId);
    if (!enabled.has(MODULE_KEYS.WMS)) {
      throw new BadRequestException('Material-aware planning requires the WMS module');
    }
    const materialOrders = orders.filter((o) => o.bomId);
    if (materialOrders.some((o) => !o.locationId || !o.materialSnapshot))
      throw new BadRequestException(
        'OF historique sans matières figées : planifiez sans contrainte matières ou recréez un OF avec version publiée.',
      );
    const sites = [...new Set(materialOrders.map((o) => o.locationId!))];
    if (sites.length > 1)
      throw new BadRequestException(
        'La planification avec matières exige un seul site de fabrication dans ce lot.',
      );
    const [items, levels] = await this.prisma.$transaction([
      this.prisma.wmsItem.findMany({
        where: { tenantId },
        select: { id: true, sku: true, unit: true, isActive: true },
      }),
      this.prisma.inventoryLevel.findMany({
        where: {
          tenantId,
          ...(sites[0]
            ? { bin: { tenantId, locationId: sites[0], isActive: true } }
            : { itemId: { in: [] } }),
        },
        select: { itemId: true, qtyOnHand: true },
      }),
    ]);
    const onHandByItem = new Map<string, number>();
    for (const l of levels) {
      onHandByItem.set(l.itemId, (onHandByItem.get(l.itemId) ?? 0) + Number(l.qtyOnHand));
    }
    const inventory = items.map((i) => ({
      materialRef: i.sku,
      onHand: onHandByItem.get(i.id) ?? 0,
    }));

    const byOrder: SnapshotMaterials['byOrder'] = {};
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const o of materialOrders) {
      const snapshot = o.materialSnapshot as unknown as ManufacturingMaterialSnapshot;
      if (
        snapshot.version !== 'pulsar.manufacturing.materials.v1' ||
        snapshot.locationId !== o.locationId ||
        !Array.isArray(snapshot.components)
      )
        throw new BadRequestException('Instantané matières incompatible.');
      byOrder[o.id] = snapshot.components.map((line) => {
        const item = byId.get(line.itemId);
        if (!item?.isActive || item.unit !== line.unit || item.sku !== line.sku)
          throw new BadRequestException(
            'Composant inactif ou différent de son instantané matières.',
          );
        const quantity = Number(line.requiredQuantity);
        if (!Number.isFinite(quantity) || quantity <= 0)
          throw new BadRequestException('Quantité matières invalide.');
        return { materialRef: line.sku, fixedQuantity: quantity };
      });
    }
    return { materials: { inventory, byOrder }, warnings: [] };
  }

  /** Passthrough so the UI only offers strategies the engine actually supports. */
  strategies() {
    return this.aps.listStrategies();
  }

  private planningSlice(tx: Prisma.TransactionClient, tenantId: string) {
    return Promise.all([
      tx.workingCalendar.findMany({
        where: { tenantId, isActive: true },
        orderBy: { id: 'asc' },
        include: { shifts: { where: { tenantId }, orderBy: { id: 'asc' } } },
      }),
      tx.workCenter.findMany({ where: { tenantId, isActive: true }, orderBy: { id: 'asc' } }),
      tx.manufacturingOrder.findMany({
        where: {
          tenantId,
          status: {
            in: [ManufacturingOrderStatus.RELEASED, ManufacturingOrderStatus.IN_PROGRESS],
          },
        },
        orderBy: { id: 'asc' },
        include: { operations: { where: { tenantId }, orderBy: { id: 'asc' } } },
      }),
    ]);
  }

  async run(tenantId: string, userId: string, input: RunSchedulingInput) {
    // Load the schedulable slice: active orders (RELEASED + IN_PROGRESS) with ops,
    // all work centers, and the calendars they reference.
    const [calendars, workCenters, orders, baseline] = await this.prisma.$transaction(
      async (tx) => {
        const slice = await this.planningSlice(tx, tenantId);
        const baseline = await tx.schedulingRun.findFirst({
          where: { tenantId, isBaseline: true },
          select: { id: true },
        });
        return [...slice, baseline] as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    if (orders.length === 0) {
      throw new BadRequestException(
        'No schedulable manufacturing orders (need at least one RELEASED or IN_PROGRESS order).',
      );
    }

    // SP5: optionally wire WMS inventory into the engine's material ledger.
    let materials: SnapshotMaterials | undefined;
    const materialWarnings: string[] = [];
    if (input.respectMaterials) {
      const loaded = await this.loadMaterials(tenantId, orders);
      materials = loaded.materials;
      materialWarnings.push(...loaded.warnings);
    }

    const built = buildManufacturingSnapshot({
      exportedAt: new Date(),
      materials,
      calendars: calendars.map((c) => ({
        id: c.id,
        name: c.name,
        shifts: c.shifts.map((s) => ({
          weekday: s.weekday,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      })),
      workCenters: workCenters.map((w) => ({
        id: w.id,
        name: w.name,
        calendarId: w.calendarId,
        capabilities: w.capabilities,
        efficiency: w.efficiency,
      })),
      orders: orders.map((o) => ({
        id: o.id,
        name: o.name,
        productRef: o.productRef,
        quantity: o.quantity,
        dueDate: o.dueDate,
        releaseDate: o.releaseDate,
        priority: o.priority as unknown as ManufacturingPriority,
        firmness: o.firmness as unknown as ManufacturingFirmness,
        operations: o.operations.map((op) => ({
          id: op.id,
          sequence: op.sequence,
          name: op.name,
          status: op.status,
          durationMinutes: op.durationMinutes,
          setupMinutes: op.setupMinutes,
          eligibleWorkCenterIds: op.eligibleWorkCenterIds,
          dependsOn: op.dependsOn,
        })),
      })),
    });
    const { snapshot } = built;
    snapshot.metadata = {
      ...snapshot.metadata,
      source_revision: artifactHash([calendars, workCenters, orders]),
    };
    const warnings = [...materialWarnings, ...built.warnings];

    validateSnapshot(snapshot);
    if (input.timeZone !== undefined && input.horizonStart !== undefined)
      throw new BadRequestException(
        'Utilisez horizonDate avec timeZone, pas horizonStart (UTC historique).',
      );
    if (input.horizonDate !== undefined && input.timeZone === undefined)
      throw new BadRequestException('horizonDate exige un fuseau timeZone explicite.');
    const common = {
      snapshot,
      strategy: input.strategy ?? 'greedy',
      horizon_days: input.horizonDays ?? 30,
      objective: input.objective ?? null,
    };
    const request: ApsBridgeRequest =
      input.timeZone !== undefined
        ? {
            ...common,
            bridge_version: APS_BRIDGE_V2,
            time_zone: input.timeZone,
            ...plantWindows(
              snapshot.calendars ?? [],
              input.timeZone,
              input.horizonDate,
              common.horizon_days,
            ),
          }
        : {
            ...common,
            bridge_version: APS_BRIDGE_VERSION,
            time_zone: 'UTC',
            horizon_start: explicitHorizon(input.horizonStart, new Date()),
          };
    return this.execute(tenantId, userId, request, warnings, baseline?.id ?? null);
  }

  /** Reuses captured inputs, never rebuilds historical demand from live rows. */
  async replay(tenantId: string, userId: string, id: string) {
    const source = await this.get(tenantId, id);
    if (
      !source.inputRequest ||
      !this.supportedArtifact(source) ||
      artifactHash(source.inputRequest) !== source.snapshotHash
    ) {
      throw new ConflictException(
        'This run cannot be replayed with the installed bridge; calculate a new scenario',
      );
    }
    const baseline = await this.prisma.schedulingRun.findFirst({
      where: { tenantId, isBaseline: true },
      select: { id: true },
    });
    return this.execute(
      tenantId,
      userId,
      source.inputRequest as unknown as ApsBridgeRequest,
      source.warnings,
      baseline?.id ?? null,
      id,
    );
  }

  private supportedArtifact(run: { bridgeVersion: string | null; engineRevision: string | null }) {
    return (
      (run.bridgeVersion === APS_BRIDGE_VERSION && run.engineRevision === APS_ENGINE_REVISION) ||
      (run.bridgeVersion === APS_BRIDGE_V2 && run.engineRevision === APS_ENGINE_V2)
    );
  }

  private async execute(
    tenantId: string,
    userId: string,
    request: ApsBridgeRequest,
    warnings: string[],
    basedOnRunId: string | null,
    replayedFromId?: string,
  ) {
    const result = validateEngineResult(
      await this.aps.runForTenant(tenantId, request),
      request,
      tenantId,
    );
    const orderCount = request.snapshot.work_orders?.length ?? 0;
    const operationCount =
      request.snapshot.work_orders?.reduce((n, o) => n + o.operations.length, 0) ?? 0;

    // Persist the run + its assignments atomically.
    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.schedulingRun.create({
        data: {
          tenantId,
          apsScheduleId: result.schedule_id,
          strategy: result.strategy,
          solverStatus: result.solver_status,
          objectiveValue: result.objective_value,
          wallTimeMs: result.wall_time_ms,
          horizonStart: parseApsUtc(result.horizon_start),
          horizonEnd: parseApsUtc(result.horizon_end),
          orderCount,
          operationCount,
          assignmentCount: result.assignments.length,
          snapshotHash: artifactHash(request),
          inputRequest: request as unknown as Prisma.InputJsonValue,
          engineResult: result as unknown as Prisma.InputJsonValue,
          bridgeVersion: result.bridge_version,
          engineRevision: result.engine_revision,
          timeZone: result.time_zone,
          basedOnRunId,
          replayedFromId,
          warnings,
          diagnostics: (result.diagnostics ?? undefined) as object | undefined,
          createdById: userId,
        },
      });
      if (result.assignments.length > 0) {
        await tx.scheduledManufacturingOperation.createMany({
          data: result.assignments.map((a) => ({
            tenantId,
            runId: created.id,
            operationId: a.operation_id,
            orderId: a.work_order_id,
            workCenterId: a.machine_id,
            setupStart: parseApsUtc(a.setup_start),
            start: parseApsUtc(a.start),
            end: parseApsUtc(a.end),
          })),
        });
      }
      return created;
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'scheduling-run',
      entityId: run.id,
      after: {
        strategy: run.strategy,
        solverStatus: run.solverStatus,
        objectiveValue: run.objectiveValue,
        assignmentCount: run.assignmentCount,
        snapshotHash: run.snapshotHash,
        replayedFromId: run.replayedFromId,
      },
    });

    return this.get(tenantId, run.id);
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = { tenantId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.schedulingRun.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        omit: { inputRequest: true, engineResult: true, publicationCheck: true },
      }),
      this.prisma.schedulingRun.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const run = await this.prisma.schedulingRun.findFirst({
      where: { id, tenantId },
      include: { assignments: { orderBy: { start: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Scheduling run not found');
    return run;
  }

  private async publicationInputs(tenantId: string, id: string) {
    const run = await this.get(tenantId, id);
    if (
      !run.inputRequest ||
      !run.engineResult ||
      !this.supportedArtifact(run) ||
      artifactHash(run.inputRequest) !== run.snapshotHash
    ) {
      throw new ConflictException(
        'Legacy or incomplete scenario: calculate a new run before publishing',
      );
    }
    if (run.publishedAt)
      throw new ConflictException(
        'This scenario has already been superseded; calculate a new candidate',
      );
    // Historical simulation never implicitly republishes obsolete orders/stock.
    if (run.replayedFromId)
      throw new ConflictException(
        'Historical replay is read-only; calculate from current data to publish',
      );
    const baseline = await this.baseline(tenantId);
    if ((baseline?.id ?? null) !== run.basedOnRunId) {
      throw new ConflictException(
        'The baseline changed since this calculation; calculate a new candidate',
      );
    }
    const candidate = validateEngineResult(
      run.engineResult,
      run.inputRequest as unknown as ApsBridgeRequest,
      tenantId,
    );
    // Old baselines have only assignments and diagnostics. Never invent an artifact
    // for a legacy candidate or overwrite old timestamps with a guessed timezone.
    const previous =
      baseline?.engineResult ??
      (baseline
        ? {
            schedule_id: baseline.apsScheduleId ?? baseline.id,
            created_at: baseline.createdAt.toISOString(),
            organization_id: tenantId,
            strategy: baseline.strategy,
            solver_status: baseline.solverStatus,
            objective_value: baseline.objectiveValue,
            wall_time_ms: baseline.wallTimeMs,
            diagnostics: baseline.diagnostics ?? {},
            metrics: {},
            assignments: baseline.assignments.map((a) => ({
              operation_id: a.operationId,
              work_order_id: a.orderId,
              machine_id: a.workCenterId,
              setup_start: a.setupStart.toISOString().slice(0, 19),
              start: a.start.toISOString().slice(0, 19),
              end: a.end.toISOString().slice(0, 19),
            })),
          }
        : null);
    return { run, candidate, previous };
  }

  /** Read-only: uses the engine's own assessment, never a parallel scoring system. */
  async review(tenantId: string, id: string) {
    const { run, candidate, previous } = await this.publicationInputs(tenantId, id);
    const assessment = await this.aps.reviewPublication(tenantId, candidate, previous);
    if (
      !assessment ||
      !['publishable', 'review', 'blocked'].includes(assessment.publish_status) ||
      typeof assessment.recommendation !== 'string'
    )
      throw new ServiceUnavailableException(
        'Revue APS indisponible; aucune publication autorisée.',
      );
    const slice = await this.prisma.$transaction((tx) => this.planningSlice(tx, tenantId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    const sourceRevision = artifactHash(slice);
    const fresh =
      sourceRevision ===
      (run.inputRequest as unknown as ApsBridgeRequest).snapshot.metadata?.source_revision;
    const blockers = fresh
      ? []
      : ['Les ordres, postes ou calendriers ont changé. Calculez un nouveau scénario.'];
    if (assessment.publish_status === 'review')
      blockers.push(
        'Ce scénario nécessite un arbitrage : ajustez puis recalculez. La publication forcée n’est pas disponible.',
      );
    if (assessment.publish_status === 'blocked')
      blockers.push('Le moteur refuse ce scénario. Corrigez les contraintes avant de recalculer.');
    const reviewToken = artifactHash({
      id,
      hash: run.snapshotHash,
      baselineId: run.basedOnRunId,
      sourceRevision,
      assessment,
    });
    return {
      runId: id,
      baselineId: run.basedOnRunId,
      timeZone: run.timeZone,
      assessment,
      blockers,
      canPublish: blockers.length === 0,
      reviewToken,
    };
  }

  /** Engine gate first; tenant lock + expected baseline recheck before any write. */
  async publish(tenantId: string, userId: string, id: string, reviewToken?: string) {
    const existing = await this.get(tenantId, id);
    if (existing.isBaseline) return existing; // Safe retry after an uncertain successful response.
    if (reviewToken) {
      const review = await this.review(tenantId, id);
      if (!review.canPublish || review.reviewToken !== reviewToken)
        throw new ConflictException(
          'La revue a changé. Rechargez-la avant de confirmer la publication.',
        );
    }
    const { run, candidate, previous } = await this.publicationInputs(tenantId, id);
    const assessment = await this.aps.checkPublication(tenantId, candidate, previous);
    if (
      assessment?.publish_status !== 'publishable' ||
      typeof assessment.recommendation !== 'string'
    ) {
      throw new ServiceUnavailableException(
        'Engine did not authorize publication; baseline unchanged',
      );
    }
    const changed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manufacturing-baseline:${tenantId}`}, 0))`;
      const current = await tx.schedulingRun.findFirst({ where: { tenantId, isBaseline: true } });
      if (current?.id === id) return false;
      if ((current?.id ?? null) !== run.basedOnRunId) {
        throw new ConflictException(
          'A different scenario was published during validation; baseline unchanged',
        );
      }
      const liveSlice = await this.planningSlice(tx, tenantId);
      const source = (run.inputRequest as unknown as ApsBridgeRequest).snapshot.metadata
        ?.source_revision;
      if (!source || artifactHash(liveSlice) !== source) {
        throw new ConflictException(
          'Manufacturing orders, work centers or calendars changed; calculate a new candidate',
        );
      }
      await tx.schedulingRun.updateMany({
        where: { tenantId, isBaseline: true },
        data: { isBaseline: false },
      });
      const claim = await tx.schedulingRun.updateMany({
        where: { id, tenantId, publishedAt: null },
        data: {
          isBaseline: true,
          publishedAt: new Date(),
          publicationCheck: assessment as Prisma.InputJsonValue,
        },
      });
      if (claim.count !== 1) throw new ConflictException('Scenario was already published');
      return true;
    });
    if (!changed) return this.get(tenantId, id);
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'scheduling-run',
      entityId: id,
      before: { baselineId: run.basedOnRunId },
      after: { isBaseline: true, publicationCheck: assessment },
    });
    return this.get(tenantId, id);
  }

  async baseline(tenantId: string) {
    return this.prisma.schedulingRun.findFirst({
      where: { tenantId, isBaseline: true },
      include: { assignments: { orderBy: { start: 'asc' } } },
    });
  }
}
