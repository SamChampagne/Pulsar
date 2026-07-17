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
    name: 'get_sales_order_fulfillment_context',
    description:
      'Read the fulfillment context of a CRM sales order: the order, its linked TMS customer, ' +
      'the transport orders already derived from it, the derived fulfillment status, and the ' +
      'logistics fields a shipment still needs. Read-only — use before proposing a shipment. ' +
      'Requires transportation.orders.read AND crm.read, with both modules enabled.',
    tier: RiskTier.READ,
    permission: T.ORDERS_READ,
    additionalPermissions: [PERMISSIONS.CRM.READ],
    module: MODULE_KEYS.TRANSPORTATION,
    additionalModules: [MODULE_KEYS.CRM],
    inputSchema: z.object({ salesOrderId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.transportOrders.salesOrderFulfillmentContext(
        ctx.principal.user.tenantId,
        args.salesOrderId as string,
      ),
  },
  {
    name: 'create_transport_order_from_sales_order',
    description:
      'Prepare a shipment: create a transport order from a CONFIRMED CRM sales order. The ' +
      'customer is derived server-side from the sales order (never provide it). You MUST supply ' +
      'originLocationId, destinationLocationId, a mode, AND at least one physical measure > 0 ' +
      '(totalWeightKg, totalVolumeM3 or palletCount) — NEVER infer weight/volume/pallets from ' +
      'product quantities or commercial amounts; zero does not count. Time windows are optional. ' +
      'Idempotent per (salesOrder, fulfillmentKey). Requires transportation.orders.manage AND ' +
      'crm.read, with both modules enabled. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: T.ORDERS_MANAGE,
    additionalPermissions: [PERMISSIONS.CRM.READ],
    module: MODULE_KEYS.TRANSPORTATION,
    additionalModules: [MODULE_KEYS.CRM],
    inputSchema: z.object({
      salesOrderId: z.string().min(1),
      fulfillmentKey: z.string().optional(),
      originLocationId: z.string().min(1),
      destinationLocationId: z.string().min(1),
      customerReference: z.string().optional(),
      requestedPickupEarly: z.string().optional(),
      requestedPickupLate: z.string().optional(),
      requestedDeliveryEarly: z.string().optional(),
      requestedDeliveryLate: z.string().optional(),
      // mode is REQUIRED. At least one of the three measures must be > 0 — this
      // cross-field rule is enforced server-side (validateFulfillmentLogistics),
      // since a Zod .refine() would change the schema type the MCP layer needs.
      mode: z.enum(['FTL', 'LTL', 'PARCEL']),
      totalWeightKg: z.number().positive().optional(),
      totalVolumeM3: z.number().positive().optional(),
      palletCount: z.number().int().positive().optional(),
      notes: z.string().optional(),
    }),
    run: (args, ctx) => {
      const { salesOrderId, ...dto } = args;
      return ctx.services.transportOrders.createFromSalesOrder(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        salesOrderId as string,
        dto,
      );
    },
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
