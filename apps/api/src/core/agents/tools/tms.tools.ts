import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

const T = PERMISSIONS.TRANSPORTATION;

export const tmsTools: ToolDef[] = [
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
];
