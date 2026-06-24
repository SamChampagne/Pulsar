import { z } from 'zod';
import { RiskTier } from '@pulsar/shared';
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
  // ── Analytics / Flow ───────────────────────────────────────────────────────
  flow: {
    timeline(tenantId: string, opts: { days?: number; modules?: string[]; crossOnly?: boolean; limit?: number }): Promise<unknown>;
    trace(tenantId: string, entityType: 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD', entityId: string): Promise<unknown>;
  };
  // ── CRM ────────────────────────────────────────────────────────────────────
  crm: {
    listDeals(tenantId: string, query: object): Promise<unknown>;
    getCompany(tenantId: string, id: string): Promise<unknown>;
    listActivities(tenantId: string, query: object): Promise<unknown>;
    logActivity(tenantId: string, input: object, author: { agentId?: string; userId?: string }): Promise<unknown>;
    advanceDeal(tenantId: string, id: string, userId: string, stage: string): Promise<unknown>;
    createFollowup(tenantId: string, input: object, author: { agentId?: string }): Promise<unknown>;
    listThreads(tenantId: string, query: object): Promise<unknown>;
    getThread(tenantId: string, id: string): Promise<unknown>;
    replyThread(tenantId: string, id: string, dto: { html: string; subject?: string }, author: { agentId?: string; userId?: string }): Promise<unknown>;
    linkThread(tenantId: string, id: string, dto: object, userId: string): Promise<unknown>;
  };
  // ── Email (core) ───────────────────────────────────────────────────────────
  email: {
    draft(tenantId: string, input: { prompt: string; context?: string }): Promise<unknown>;
    send(
      tenantId: string,
      input: {
        toAddresses: string[];
        subject: string;
        html: string;
        relatedType?: string;
        relatedId?: string;
        attachments?: { documentId: string; filename: string }[];
      },
      author: { agentId: string },
    ): Promise<unknown>;
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
