import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

const STRATEGIES = ['greedy', 'backward', 'hybrid', 'cpsat', 'auto'] as const;

/**
 * Manufacturing / APS planning tools (SP6). READ/LOW execute live; the baseline
 * publish is MUTATING and therefore routed through the ProposedAction governance
 * queue (hard rules 21–29). Scope is gated by MODULE_KEYS.MANUFACTURING ∩ the
 * agent's permissions ∩ its tool allowlist.
 */
export const manufacturingTools: ToolDef[] = [
  {
    name: 'list_manufacturing_orders',
    description:
      'List manufacturing orders for the tenant. Optionally filter by status (DRAFT, RELEASED, IN_PROGRESS, COMPLETED, CANCELLED).',
    tier: RiskTier.READ,
    permission: PERMISSIONS.MANUFACTURING.READ,
    module: MODULE_KEYS.MANUFACTURING,
    inputSchema: z.object({
      status: z.enum(['DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    }),
    run: (args, ctx) =>
      ctx.services.manufacturingOrders.list(ctx.principal.user.tenantId, {
        pageSize: 100,
        status: args.status as string | undefined,
      }),
  },
  {
    name: 'get_manufacturing_plan',
    description:
      'Get the current published baseline production schedule (work-center assignments). Returns null if no baseline has been published yet.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.MANUFACTURING.READ,
    module: MODULE_KEYS.MANUFACTURING,
    inputSchema: z.object({}),
    run: (_args, ctx) => ctx.services.manufacturingPlanning.baseline(ctx.principal.user.tenantId),
  },
  {
    name: 'list_scheduling_runs',
    description: 'List recent APS scheduling runs (candidates and baseline) for the tenant.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.MANUFACTURING.READ,
    module: MODULE_KEYS.MANUFACTURING,
    inputSchema: z.object({}),
    run: (_args, ctx) =>
      ctx.services.manufacturingPlanning.listRuns(ctx.principal.user.tenantId, { pageSize: 20 }),
  },
  {
    name: 'run_manufacturing_schedule',
    description:
      'Run the APS scheduler over the active (released/in-progress) manufacturing orders and persist a candidate plan. Returns the run with its work-center assignments. Set respectMaterials to honour WMS on-hand stock. This produces a candidate only — it does NOT publish it as the operational baseline.',
    tier: RiskTier.LOW,
    permission: PERMISSIONS.MANUFACTURING.MANAGE,
    module: MODULE_KEYS.MANUFACTURING,
    inputSchema: z.object({
      strategy: z.enum(STRATEGIES).optional(),
      horizonDays: z.number().int().positive().max(365).optional(),
      respectMaterials: z.boolean().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.manufacturingPlanning.run(ctx.principal.user.tenantId, ctx.principal.user.id, {
        strategy: args.strategy as string | undefined,
        horizonDays: args.horizonDays as number | undefined,
        respectMaterials: args.respectMaterials as boolean | undefined,
      }),
  },
  {
    name: 'publish_manufacturing_baseline',
    description:
      'Publish a scheduling run as the tenant operational baseline (the committed plan the shop floor follows). PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.MANUFACTURING.MANAGE,
    module: MODULE_KEYS.MANUFACTURING,
    inputSchema: z.object({ runId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.manufacturingPlanning.publish(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.runId as string,
      ),
  },
];
