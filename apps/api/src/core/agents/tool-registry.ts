import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ModuleKey, PermissionKey } from '@pulsar/shared';
import type { AgentPrincipal } from './agent-principal';

/** DI token for the concrete tool-services adapter (provided by AgentsModule, Task 10). */
export const AGENT_TOOL_SERVICES = Symbol('AGENT_TOOL_SERVICES');

/**
 * Services the tools delegate to. Injected by the module; kept as an interface to avoid cycles.
 *
 * NOTE (Task 6): these signatures were reconciled against the REAL TMS services. Differences
 * from the original assumed contract — the Task 10 adapter must satisfy THESE shapes:
 *  - loads.get(tenantId, id)            (real method is `get`, not `findOne`)
 *  - rate options live on the RATING service, not loads: rating.rateOptions(tenantId, loadId)
 *  - shipments.assignToLoad(tenantId, userId, id, dto)  — last arg is a DTO { loadId, force? }
 *  - tenders.create(tenantId, userId | undefined, loadId, input: CreateTenderInput)
 *    where input = { carrierId?, message?, expiresInHours?, isAuto? } — there is NO `amount` field
 *  - analytics.carrierScorecards(tenantId)  — plural
 */
export interface ToolServices {
  transportOrders: { list(tenantId: string, query: object): Promise<unknown> };
  loads: {
    get(tenantId: string, id: string): Promise<unknown>;
    create(tenantId: string, userId: string, dto: object): Promise<unknown>;
  };
  rating: { rateOptions(tenantId: string, loadId: string): Promise<unknown> };
  shipments: {
    list(tenantId: string, query: object): Promise<unknown>;
    assignToLoad(
      tenantId: string,
      userId: string,
      id: string,
      dto: { loadId: string; force?: boolean },
    ): Promise<unknown>;
  };
  tenders: {
    create(
      tenantId: string,
      userId: string | undefined,
      loadId: string,
      input: { carrierId?: string; message?: string; expiresInHours?: number; isAuto?: boolean },
    ): Promise<unknown>;
  };
  analytics: { carrierScorecards(tenantId: string): Promise<unknown> };
  operatingTasks: {
    listForAgent(tenantId: string, agentId: string): Promise<unknown>;
    getForTenant(tenantId: string, id: string): Promise<unknown>;
    resolve(tenantId: string, id: string, userId: string, note?: string): Promise<unknown>;
  };
  freightAudit: {
    audit(tenantId: string, userId: string, invoiceId: string): Promise<unknown>;
    dispute(
      tenantId: string,
      actorId: string,
      invoiceId: string,
      dto: { reasonCode: string; note?: string },
      agentId?: string,
    ): Promise<unknown>;
  };
  // ── Fleet ──────────────────────────────────────────────────────────────────
  vehicles: {
    list(tenantId: string, query: object): Promise<unknown>;
    get(tenantId: string, id: string): Promise<unknown>;
  };
  trailers: {
    list(tenantId: string, query: object): Promise<unknown>;
    get(tenantId: string, id: string): Promise<unknown>;
  };
  fleetOverview: { overview(tenantId: string): Promise<unknown> };
  fleetCompliance: { expiring(tenantId: string, days?: number): Promise<unknown> };
  fleetMaintenance: {
    create(
      tenantId: string,
      userId: string,
      dto: { vehicleId?: string; trailerId?: string; type: string; description: string },
    ): Promise<unknown>;
  };
  // ── Yard ───────────────────────────────────────────────────────────────────
  yardVisits: {
    list(tenantId: string, q: object): Promise<unknown>;
    get(tenantId: string, id: string): Promise<unknown>;
    assign(tenantId: string, userId: string, visitId: string, dto: { spotId: string; note?: string }): Promise<unknown>;
    move(tenantId: string, userId: string, visitId: string, dto: { spotId: string; note?: string }): Promise<unknown>;
    checkOut(tenantId: string, userId: string, visitId: string): Promise<unknown>;
  };
  yardOverview: {
    overview(tenantId: string): Promise<unknown>;
    board(tenantId: string, locationId?: string): Promise<unknown>;
  };
  yardAppointments: {
    create(tenantId: string, userId: string, dto: object): Promise<unknown>;
    arrive(tenantId: string, userId: string, id: string): Promise<unknown>;
  };
  // ── WMS ────────────────────────────────────────────────────────────────────
  wmsOverview: { overview(tenantId: string): Promise<unknown> };
  wmsPicking: { get(tenantId: string, id: string): Promise<unknown> };
  wmsCycleCounts: {
    create(tenantId: string, userId: string, dto: { binId: string; note?: string }): Promise<unknown>;
  };
}

export interface ToolContext {
  principal: AgentPrincipal;
  services: ToolServices;
}

export interface ToolDef {
  name: string;
  description: string;
  tier: RiskTier;
  permission: PermissionKey;
  /** When undefined, the tool is a core tool available regardless of enabled modules. */
  module?: ModuleKey;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** Executes the real operation. Live for READ/LOW; on approval for MUTATING/SENSITIVE. */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
  /** Optional monetary amount used for cap evaluation at enqueue time. */
  amountFrom?(args: Record<string, unknown>): number | undefined;
}

const T = PERMISSIONS.TRANSPORTATION;

export const TOOL_REGISTRY: ToolDef[] = [
  {
    name: 'list_transport_orders',
    description: 'List transport orders for the tenant (paginated).',
    tier: RiskTier.READ,
    permission: T.ORDERS_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({
      page: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().optional(),
    }),
    run: (args, ctx) => ctx.services.transportOrders.list(ctx.principal.user.tenantId, args),
  },
  {
    name: 'get_load',
    description: 'Get a single load by id, including resources and route.',
    tier: RiskTier.READ,
    permission: T.PLANNING_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({ loadId: z.string().min(1) }),
    run: (args, ctx) => ctx.services.loads.get(ctx.principal.user.tenantId, args.loadId as string),
  },
  {
    name: 'list_shipments',
    description: 'List shipments for the tenant (paginated).',
    tier: RiskTier.READ,
    permission: T.PLANNING_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({
      page: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().optional(),
    }),
    run: (args, ctx) => ctx.services.shipments.list(ctx.principal.user.tenantId, args),
  },
  {
    name: 'rate_options',
    description: 'Get ranked rate options for a load (rate shopping).',
    tier: RiskTier.READ,
    permission: T.PLANNING_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({ loadId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.rating.rateOptions(ctx.principal.user.tenantId, args.loadId as string),
  },
  {
    name: 'carrier_scorecard',
    description: 'Carrier scorecard / KPIs for the tenant.',
    tier: RiskTier.READ,
    permission: T.ANALYTICS_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({}),
    run: (_args, ctx) => ctx.services.analytics.carrierScorecards(ctx.principal.user.tenantId),
  },
  {
    name: 'create_load',
    description:
      'Create a new (empty) load. Only an optional free-text `notes` field is accepted at ' +
      'creation time. Carrier, driver, vehicle, trailer, rate, and transport mode are assigned ' +
      'via separate actions (assign_load_resources / tender_load). PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: T.PLANNING_MANAGE,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({
      notes: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.loads.create(ctx.principal.user.tenantId, ctx.principal.user.id, args),
  },
  {
    name: 'assign_shipment',
    description: 'Assign a shipment to a load. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: T.PLANNING_MANAGE,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({ shipmentId: z.string().min(1), loadId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.shipments.assignToLoad(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.shipmentId as string,
        { loadId: args.loadId as string },
      ),
  },
  {
    name: 'tender_load',
    description: 'Tender a load to a carrier. PROPOSED — requires human approval.',
    tier: RiskTier.SENSITIVE,
    permission: T.PLANNING_MANAGE,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({
      loadId: z.string().min(1),
      carrierId: z.string().min(1),
      // `amount` is accepted from the agent for the cap check (amountFrom) only; the real
      // TendersService.create has no amount field, so it is not forwarded into the input.
      amount: z.number().optional(),
      expiresInHours: z.number().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.tenders.create(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.loadId as string,
        {
          carrierId: args.carrierId as string,
          expiresInHours: typeof args.expiresInHours === 'number' ? args.expiresInHours : undefined,
        },
      ),
    amountFrom: (args) => (typeof args.amount === 'number' ? args.amount : undefined),
  },
  // ── Core workbench tools (no module requirement — always available) ──────────
  {
    name: 'list_my_tasks',
    description: 'List open and in-progress operating tasks assigned to this agent.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_READ,
    inputSchema: z.object({}),
    run: (_args, ctx) =>
      ctx.services.operatingTasks.listForAgent(
        ctx.principal.user.tenantId,
        ctx.principal.agentId,
      ),
  },
  {
    name: 'get_task',
    description: 'Get a single operating task by id, including linked proposed actions.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_READ,
    inputSchema: z.object({ taskId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.operatingTasks.getForTenant(
        ctx.principal.user.tenantId,
        args.taskId as string,
      ),
  },
  {
    name: 'resolve_task',
    description: 'Resolve an operating task assigned to me, with an optional note. Runs immediately (low-risk self-management).',
    tier: RiskTier.LOW,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_MANAGE,
    inputSchema: z.object({ taskId: z.string().min(1), note: z.string().optional() }),
    run: (args, ctx) =>
      ctx.services.operatingTasks.resolve(
        ctx.principal.user.tenantId,
        args.taskId as string,
        ctx.principal.user.id,
        args.note as string | undefined,
      ),
  },
  // ── Freight audit (billing) ──────────────────────────────────────────────────
  {
    name: 'audit_carrier_invoice',
    description:
      'Run the deterministic match of an incoming carrier invoice against expected load costs. Returns the variance summary and per-line results. Read-only audit (no outward action).',
    tier: RiskTier.READ,
    permission: PERMISSIONS.BILLING.FREIGHT_AUDIT_READ,
    module: MODULE_KEYS.BILLING,
    inputSchema: z.object({ invoiceId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.freightAudit.audit(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.invoiceId as string,
      ),
  },
  {
    name: 'dispute_carrier_invoice',
    description:
      'Open a dispute on a FLAGGED incoming carrier invoice. SENSITIVE — goes through the approval queue.',
    tier: RiskTier.SENSITIVE,
    permission: PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE,
    module: MODULE_KEYS.BILLING,
    inputSchema: z.object({
      invoiceId: z.string().min(1),
      reasonCode: z.string().min(1),
      note: z.string().optional(),
      amount: z.number().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.freightAudit.dispute(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.invoiceId as string,
        { reasonCode: args.reasonCode as string, note: args.note as string | undefined },
        ctx.principal.agentId,
      ),
    amountFrom: (args) => (typeof args.amount === 'number' ? args.amount : undefined),
  },
  // ── Fleet ──────────────────────────────────────────────────────────────────
  {
    name: 'list_assets',
    description: 'List all fleet assets (vehicles and trailers) for the tenant.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.FLEET.READ,
    module: MODULE_KEYS.FLEET,
    inputSchema: z.object({}),
    run: async (_args, ctx) => {
      const tenantId = ctx.principal.user.tenantId;
      const [vehicles, trailers] = await Promise.all([
        ctx.services.vehicles.list(tenantId, {}),
        ctx.services.trailers.list(tenantId, {}),
      ]);
      return { vehicles, trailers };
    },
  },
  {
    name: 'get_vehicle',
    description: 'Get a single vehicle by id.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.FLEET.READ,
    module: MODULE_KEYS.FLEET,
    inputSchema: z.object({ vehicleId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.vehicles.get(ctx.principal.user.tenantId, args.vehicleId as string),
  },
  {
    name: 'get_trailer',
    description: 'Get a single trailer by id.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.FLEET.READ,
    module: MODULE_KEYS.FLEET,
    inputSchema: z.object({ trailerId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.trailers.get(ctx.principal.user.tenantId, args.trailerId as string),
  },
  {
    name: 'list_maintenance_due',
    description:
      'List fleet assets with open maintenance orders due within 7 days, plus PM schedules due/overdue.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.FLEET.READ,
    module: MODULE_KEYS.FLEET,
    inputSchema: z.object({}),
    run: async (_args, ctx) => {
      const overview = await ctx.services.fleetOverview.overview(ctx.principal.user.tenantId) as {
        openWorkOrders: number;
        maintenanceDue: unknown[];
        pmDue: unknown[];
        pmOverdue: unknown[];
        pmDueSoon: unknown[];
      };
      return {
        openWorkOrders: overview.openWorkOrders,
        maintenanceDue: overview.maintenanceDue,
        pmDue: overview.pmDue,
        pmOverdue: overview.pmOverdue,
        pmDueSoon: overview.pmDueSoon,
      };
    },
  },
  {
    name: 'flag_expiring_compliance',
    description: 'List compliance documents expiring within the given number of days (default 30).',
    tier: RiskTier.READ,
    permission: PERMISSIONS.FLEET.READ,
    module: MODULE_KEYS.FLEET,
    inputSchema: z.object({ days: z.number().int().positive().optional() }),
    run: (args, ctx) =>
      ctx.services.fleetCompliance.expiring(
        ctx.principal.user.tenantId,
        typeof args.days === 'number' ? args.days : undefined,
      ),
  },
  {
    name: 'create_maintenance_order',
    description:
      'Create a maintenance work order for a vehicle or trailer. Exactly one of vehicleId or trailerId must be provided. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.FLEET.MANAGE,
    module: MODULE_KEYS.FLEET,
    inputSchema: z.object({
      vehicleId: z.string().min(1).optional(),
      trailerId: z.string().min(1).optional(),
      type: z.string().min(1),
      description: z.string().min(1),
    }),
    run: (args, ctx) =>
      ctx.services.fleetMaintenance.create(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        {
          vehicleId: args.vehicleId as string | undefined,
          trailerId: args.trailerId as string | undefined,
          type: args.type as string,
          description: args.description as string,
        },
      ),
  },
  {
    name: 'mark_asset_out_of_service',
    description:
      'Open a REPAIR work order to put a vehicle or trailer out of service. Exactly one of vehicleId or trailerId must be provided. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.FLEET.MANAGE,
    module: MODULE_KEYS.FLEET,
    inputSchema: z.object({
      vehicleId: z.string().min(1).optional(),
      trailerId: z.string().min(1).optional(),
      reason: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.fleetMaintenance.create(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        {
          vehicleId: args.vehicleId as string | undefined,
          trailerId: args.trailerId as string | undefined,
          type: 'REPAIR',
          description: (args.reason as string | undefined) ?? 'Hors service (agent)',
        },
      ),
  },
  // ── Yard ───────────────────────────────────────────────────────────────────
  {
    name: 'list_yard_visits',
    description: 'List yard visits, optionally filtered by status and/or location.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.YARD.READ,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({
      status: z.string().optional(),
      locationId: z.string().min(1).optional(),
    }),
    run: (args, ctx) =>
      ctx.services.yardVisits.list(ctx.principal.user.tenantId, {
        status: args.status,
        locationId: args.locationId,
      }),
  },
  {
    name: 'get_yard_board',
    description:
      'Get the live yard board: all spots with their occupying visit, and unassigned visits. Optionally filter by locationId.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.YARD.READ,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({ locationId: z.string().min(1).optional() }),
    run: (args, ctx) =>
      ctx.services.yardOverview.board(
        ctx.principal.user.tenantId,
        args.locationId as string | undefined,
      ),
  },
  {
    name: 'flag_detention',
    description:
      'Return yard detention summary: number of active visits in detention and late appointments.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.YARD.READ,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({}),
    run: async (_args, ctx) => {
      const overview = await ctx.services.yardOverview.overview(ctx.principal.user.tenantId) as {
        detentionCount: number;
        lateAppointments: number;
        trucksInYard: number;
      };
      return {
        detentionCount: overview.detentionCount,
        lateAppointments: overview.lateAppointments,
        trucksInYard: overview.trucksInYard,
      };
    },
  },
  {
    name: 'assign_yard_spot',
    description: 'Assign an active yard visit to a spot. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.YARD.MANAGE,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({
      visitId: z.string().min(1),
      spotId: z.string().min(1),
      note: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.yardVisits.assign(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.visitId as string,
        { spotId: args.spotId as string, note: args.note as string | undefined },
      ),
  },
  {
    name: 'move_trailer',
    description: 'Move an assigned yard visit to a different spot. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.YARD.MANAGE,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({
      visitId: z.string().min(1),
      spotId: z.string().min(1),
      note: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.yardVisits.move(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.visitId as string,
        { spotId: args.spotId as string, note: args.note as string | undefined },
      ),
  },
  {
    name: 'create_dock_appointment',
    description:
      'Create a dock appointment for a carrier. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.YARD.MANAGE,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({
      locationId: z.string().min(1),
      windowStart: z.string().min(1).describe('ISO 8601 datetime'),
      windowEnd: z.string().min(1).describe('ISO 8601 datetime'),
      carrierId: z.string().min(1).optional(),
      spotId: z.string().min(1).optional(),
      direction: z.string().optional(),
      reference: z.string().optional(),
      notes: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.yardAppointments.create(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        {
          locationId: args.locationId as string,
          windowStart: new Date(args.windowStart as string),
          windowEnd: new Date(args.windowEnd as string),
          carrierId: args.carrierId as string | undefined,
          spotId: args.spotId as string | undefined,
          direction: args.direction as string | undefined,
          reference: args.reference as string | undefined,
          notes: args.notes as string | undefined,
        },
      ),
  },
  {
    name: 'mark_arrived',
    description:
      'Mark a dock appointment as ARRIVED (carrier showed up). PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.YARD.MANAGE,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({ appointmentId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.yardAppointments.arrive(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.appointmentId as string,
      ),
  },
  {
    name: 'mark_departed',
    description: 'Check out an active yard visit (mark as DEPARTED). PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.YARD.MANAGE,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({ visitId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.yardVisits.checkOut(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.visitId as string,
      ),
  },
  // ── WMS ────────────────────────────────────────────────────────────────────
  {
    name: 'list_low_stock_items',
    description: 'List WMS items at or below their reorder point (low stock / replenishment needed).',
    tier: RiskTier.READ,
    permission: PERMISSIONS.WMS.READ,
    module: MODULE_KEYS.WMS,
    inputSchema: z.object({}),
    run: async (_args, ctx) => {
      const overview = await ctx.services.wmsOverview.overview(ctx.principal.user.tenantId) as {
        belowMin: unknown[];
      };
      return { belowMin: overview.belowMin };
    },
  },
  {
    name: 'get_pick_order',
    description: 'Get a single pick order by id, including its lines.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.WMS.READ,
    module: MODULE_KEYS.WMS,
    inputSchema: z.object({ pickOrderId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.wmsPicking.get(ctx.principal.user.tenantId, args.pickOrderId as string),
  },
  {
    name: 'flag_inventory_variance',
    description: 'Return bins with negative inventory levels (data-integrity attention list).',
    tier: RiskTier.READ,
    permission: PERMISSIONS.WMS.READ,
    module: MODULE_KEYS.WMS,
    inputSchema: z.object({}),
    run: async (_args, ctx) => {
      const overview = await ctx.services.wmsOverview.overview(ctx.principal.user.tenantId) as {
        negativeBins: unknown[];
      };
      return { negativeBins: overview.negativeBins };
    },
  },
  {
    name: 'create_cycle_count',
    description:
      'Create a cycle count for a bin (snapshots current system quantities). PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.WMS.MANAGE,
    module: MODULE_KEYS.WMS,
    inputSchema: z.object({
      binId: z.string().min(1),
      note: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.wmsCycleCounts.create(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        { binId: args.binId as string, note: args.note as string | undefined },
      ),
  },
];

export const TOOL_BY_NAME = new Map<string, ToolDef>(TOOL_REGISTRY.map((t) => [t.name, t]));
