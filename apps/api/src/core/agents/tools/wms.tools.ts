import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

export const wmsTools: ToolDef[] = [
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
