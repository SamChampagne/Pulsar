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
    addNote(tenantId: string, id: string, userId: string, note: string): Promise<unknown>;
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
    description: 'Get a single operating task by id.',
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
    description: 'Resolve an operating task, optionally with a note. PROPOSED — requires human approval.',
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
  {
    name: 'add_task_note',
    description: 'Add a note to an operating task. PROPOSED — requires human approval.',
    tier: RiskTier.LOW,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_MANAGE,
    inputSchema: z.object({ taskId: z.string().min(1), note: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.operatingTasks.addNote(
        ctx.principal.user.tenantId,
        args.taskId as string,
        ctx.principal.user.id,
        args.note as string,
      ),
  },
];

export const TOOL_BY_NAME = new Map<string, ToolDef>(TOOL_REGISTRY.map((t) => [t.name, t]));
