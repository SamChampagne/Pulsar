import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

const A = PERMISSIONS.ANALYTICS;

export const analyticsTools: ToolDef[] = [
  // ── Analytics / Flow ───────────────────────────────────────────────────────
  {
    name: 'get_flow_timeline',
    description: 'Read the cross-module activity timeline with causality chains (event → task → agent action). Read-only.',
    tier: RiskTier.READ,
    permission: A.READ,
    module: MODULE_KEYS.ANALYTICS,
    inputSchema: z.object({
      days: z.number().int().positive().optional(),
      modules: z.array(z.string()).optional(),
      crossOnly: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    }),
    run: (args, ctx) => ctx.services.flow.timeline(ctx.principal.user.tenantId, args),
  },
  {
    name: 'trace_entity',
    description: 'Trace a transport order / shipment / load across modules (created → picked → dispatched → yard → delivered → billed). Read-only.',
    tier: RiskTier.READ,
    permission: A.READ,
    module: MODULE_KEYS.ANALYTICS,
    inputSchema: z.object({
      entityType: z.enum(['TRANSPORT_ORDER', 'SHIPMENT', 'LOAD']),
      entityId: z.string().min(1),
    }),
    run: (args, ctx) =>
      ctx.services.flow.trace(
        ctx.principal.user.tenantId,
        args.entityType as 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD',
        args.entityId as string,
      ),
  },
];
