import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

export const fleetTools: ToolDef[] = [
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
];
