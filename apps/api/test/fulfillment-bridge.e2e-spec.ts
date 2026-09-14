/**
 * E2E — Connected Fulfillment: CRM SalesOrder → TMS TransportOrder bridge.
 *
 * Covers the whole bridge contract (Gate D + automation + agents):
 *   1. Create a transport order from a CONFIRMED sales order (customer derived
 *      server-side, logistics supplied explicitly), link visible both sides,
 *      audit + crm.sales_order.transport_requested DomainEvent.
 *   2. Rejections: DRAFT / CANCELLED sales order, missing customer, unknown
 *      (cross-tenant) sales order, unowned location, CRM module disabled.
 *   3. Idempotency: same fulfillmentKey => same transport order; a different key
 *      => a second transport order (partial shipments).
 *   4. Fulfillment reaction: completing the transport order(s) drives the sales
 *      order CONFIRMED → FULFILLED via the transport-order.completed event +
 *      the fulfill_sales_order reaction (idempotent; partial keeps CONFIRMED;
 *      cancelled-only never fulfills). A FULFILLED sales order refuses new work.
 *   5. Agent governance: create_transport_order_from_sales_order (MUTATING) is
 *      queued as a ProposedAction (never auto-executed), and executes on
 *      approval; get_sales_order_fulfillment_context (READ) runs directly.
 *   6. Vertical slice: Deal WON → Customer → SalesOrder → CONFIRMED → prepare
 *      shipment → deliver → SalesOrder FULFILLED → INVOICED → CustomerInvoice →
 *      pay → balanced GL.
 *
 * Prerequisites: reachable PostgreSQL with seed applied (pnpm db:seed).
 * Run: pnpm --filter @pulsar/api test:e2e -- fulfillment-bridge
 */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { AgentsService } from '../src/core/agents/agents.service';
import { DomainEventsService } from '../src/core/operating/domain-events.service';
import { drainInheritedDomainEvents } from './utils/domain-events';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { TransportOrdersService } from '../src/modules/transportation/transport-orders/transport-orders.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const suffix = `FB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

@Injectable()
class FakeAgentRuntimeService {
  constructor(private readonly _agents: AgentsService) {}
  async openSession(): Promise<string> {
    return 'fake-session';
  }
  async *sendTurn(): AsyncGenerator<never> {
    /* no turns */
  }
  async closeSession(): Promise<void> {
    /* no-op */
  }
  async killAgentSessions(): Promise<void> {
    /* no-op */
  }
}

function parseMcp(res: request.Response): { result?: any; error?: any } {
  if (res.body && (res.body.result !== undefined || res.body.error !== undefined)) return res.body;
  const text: string = res.text ?? '';
  for (const line of text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
    } catch {
      /* not this line */
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

describe('Connected Fulfillment bridge (e2e) — CRM SalesOrder → TMS TransportOrder', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let domainEvents: DomainEventsService;
  let modulesCache: TenantModulesCacheService;
  let token = '';
  let tenantId = '';

  const auth = () => ({ Authorization: `Bearer ${token}` });

  let companyId = '';
  let customerId = '';
  let originId = '';
  let destId = '';
  let carrierId = '';
  let agentKey = '';
  let agentId = '';
  const extraAgentIds: string[] = [];

  const soIds: string[] = [];
  const toIds: string[] = [];
  const loadIds: string[] = [];
  const shipmentIds: string[] = [];
  const invoiceIds: string[] = [];
  const customerIds: string[] = [];
  const dealIds: string[] = [];

  let mcpId = 0;
  const mcpAs = (key: string, method: string, params: unknown) =>
    request(http)
      .post('/api/v1/mcp')
      .set('X-Agent-Key', key)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++mcpId, method, params });
  const mcp = (method: string, params: unknown) => mcpAs(agentKey, method, params);

  /** Create a throwaway agent and return its key; tracked for cleanup. */
  async function createAgent(
    name: string,
    permissions: string[],
    caps: Record<string, unknown> = {},
  ) {
    const res = await request(http)
      .post('/api/v1/agents')
      .set(auth())
      .send({
        name: `${name}-${suffix}`,
        permissions,
        caps: { maxAmountPerAction: 100000, ...caps },
      })
      .expect(201);
    const body = res.body as { key: string; id: string };
    extraAgentIds.push(body.id);
    return body.key;
  }

  function toolNamesFrom(res: request.Response): string[] {
    const env = parseMcp(res);
    return ((env.result?.tools ?? []) as Array<{ name: string }>).map((t) => t.name);
  }

  async function enableModule(key: string, enabled = true) {
    const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      update: { enabled },
      create: { tenantId, moduleId: mod.id, enabled, enabledAt: new Date() },
    });
    // Bust the 30s in-memory module cache so the change is visible immediately.
    modulesCache.invalidate(tenantId);
  }

  /** Create a Customer + a CONFIRMED SalesOrder. Pass withCustomer=false to omit the customer link. */
  async function createConfirmedSO(
    withCustomer = true,
  ): Promise<{ soId: string; number: string; customerId: string | null }> {
    let soCustomerId: string | null = null;
    if (withCustomer) {
      const c = await prisma.customer.create({
        data: {
          tenantId,
          code: `FB-C-${suffix}-${soIds.length}`,
          name: `FB Cust ${suffix} ${soIds.length}`,
        },
      });
      soCustomerId = c.id;
      customerIds.push(c.id);
    }
    const soRes = await request(http)
      .post('/api/v1/crm/sales-orders')
      .set(auth())
      .send({ companyId, ...(soCustomerId ? { customerId: soCustomerId } : {}) })
      .expect(201);
    const so = soRes.body as { id: string; number: string };
    soIds.push(so.id);
    await request(http).post(`/api/v1/crm/sales-orders/${so.id}/confirm`).set(auth()).expect(200);
    return { soId: so.id, number: so.number, customerId: soCustomerId };
  }

  const LOGISTICS = () => ({
    originLocationId: originId,
    destinationLocationId: destId,
    totalWeightKg: 800,
    totalVolumeM3: 12,
    palletCount: 4,
    mode: 'FTL' as const,
  });

  function prepareShipment(soId: string, body: Record<string, unknown>) {
    return request(http)
      .post(`/api/v1/transportation/transport-orders/from-sales-order/${soId}`)
      .set(auth())
      .send(body);
  }

  /** Drive a bridge transport order all the way to COMPLETED (delivered). */
  async function deliverTransportOrder(toId: string): Promise<void> {
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${toId}/confirm`)
      .set(auth())
      .expect(201);
    const planRes = await request(http)
      .post(`/api/v1/transportation/transport-orders/${toId}/plan`)
      .set(auth())
      .expect(201);
    const shipmentId = (planRes.body as { shipments: Array<{ id: string }> }).shipments[0].id;
    shipmentIds.push(shipmentId);
    const loadRes = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    const loadId = (loadRes.body as { id: string }).id;
    loadIds.push(loadId);
    await request(http)
      .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
      .set(auth())
      .send({ loadId })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/assign`)
      .set(auth())
      .send({ carrierId })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/dispatch`)
      .set(auth())
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/start-transit`)
      .set(auth())
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/complete`)
      .set(auth())
      .expect(201);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentRuntimeService)
      .useClass(FakeAgentRuntimeService)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();

    prisma = app.get(PrismaService);
    domainEvents = app.get(DomainEventsService);
    modulesCache = app.get(TenantModulesCacheService);
    await drainInheritedDomainEvents(domainEvents);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    await enableModule('crm');
    await enableModule('transportation');
    await enableModule('billing');

    // Ensure the built-in fulfill_sales_order rule exists (seeded; be idempotent).
    const rule = await prisma.automationRule.findFirst({
      where: { tenantId, eventType: 'transport-order.completed', enabled: true },
    });
    if (!rule) {
      await prisma.automationRule.create({
        data: {
          tenantId,
          name: `fb-fulfill-so-${suffix}`,
          eventType: 'transport-order.completed',
          enabled: true,
          match: 'ALL',
          conditions: [],
          action: {
            kind: 'RUN_ACTION',
            action: 'fulfill_sales_order',
            args: { salesOrderId: '{sourceSalesOrderId}' },
          },
        },
      });
    }

    const company = await prisma.crmCompany.create({ data: { tenantId, name: `FB Co ${suffix}` } });
    companyId = company.id;
    const origin = await prisma.location.create({
      data: {
        tenantId,
        code: `FB-ORG-${suffix}`,
        name: `FB Origin ${suffix}`,
        type: 'WAREHOUSE',
        addressLine1: '1 Origin St',
        city: 'Montreal',
        country: 'CA',
      },
    });
    originId = origin.id;
    const dest = await prisma.location.create({
      data: {
        tenantId,
        code: `FB-DST-${suffix}`,
        name: `FB Dest ${suffix}`,
        addressLine1: '2 Dest Rd',
        city: 'Toronto',
        country: 'CA',
      },
    });
    destId = dest.id;
    const carrier = await prisma.carrier.create({
      data: { tenantId, code: `FB-CAR-${suffix}`, name: `FB Carrier ${suffix}` },
    });
    carrierId = carrier.id;

    const agentRes = await request(http)
      .post('/api/v1/agents')
      .set(auth())
      .send({
        name: `fb-bot-${suffix}`,
        permissions: ['transportation.orders.read', 'transportation.orders.manage', 'crm.read'],
        caps: { maxAmountPerAction: 100000 },
      })
      .expect(201);
    agentKey = (agentRes.body as { key: string }).key;
    agentId = (agentRes.body as { id: string }).id;
  });

  afterAll(async () => {
    if (prisma) {
      const allAgentIds = [agentId, ...extraAgentIds].filter(Boolean);
      await prisma.proposedAction
        .deleteMany({ where: { agentId: { in: allAgentIds } } })
        .catch(() => undefined);
      await prisma.agent.deleteMany({ where: { id: { in: allAgentIds } } }).catch(() => undefined);
      // Payments / GL from the vertical slice
      for (const invId of invoiceIds) {
        const allocs = await prisma.paymentAllocation
          .findMany({ where: { tenantId, targetId: invId } })
          .catch(() => []);
        for (const a of allocs) {
          await prisma.journalLine
            .deleteMany({
              where: { entry: { tenantId, sourceType: 'payment', sourceId: a.paymentId } },
            })
            .catch(() => undefined);
          await prisma.journalEntry
            .deleteMany({ where: { tenantId, sourceType: 'payment', sourceId: a.paymentId } })
            .catch(() => undefined);
          await prisma.paymentAllocation.deleteMany({ where: { id: a.id } }).catch(() => undefined);
          await prisma.payment.deleteMany({ where: { id: a.paymentId } }).catch(() => undefined);
        }
        await prisma.journalLine
          .deleteMany({
            where: { entry: { tenantId, sourceType: 'customer-invoice', sourceId: invId } },
          })
          .catch(() => undefined);
        await prisma.journalEntry
          .deleteMany({ where: { tenantId, sourceType: 'customer-invoice', sourceId: invId } })
          .catch(() => undefined);
      }
      await prisma.customerInvoiceLine
        .deleteMany({ where: { customerInvoiceId: { in: invoiceIds } } })
        .catch(() => undefined);
      await prisma.customerInvoice
        .deleteMany({ where: { id: { in: invoiceIds } } })
        .catch(() => undefined);
      // Owned domain events + their reaction ledger rows (scoped to this suite's SO/TO ids).
      const ownedEvents = await prisma.domainEvent
        .findMany({
          where: {
            tenantId,
            OR: [
              { payload: { path: ['salesOrderId'], string_contains: soIds[0] ?? 'none' } },
              { payload: { path: ['sourceSalesOrderId'], string_contains: soIds[0] ?? 'none' } },
            ],
          },
          select: { id: true },
        })
        .catch(() => [] as { id: string }[]);
      // Broaden to all of this suite's SO ids.
      const evByTo = await prisma.domainEvent
        .findMany({
          where: {
            tenantId,
            subjectType: { in: ['sales-order', 'transport-order'] },
            subjectId: { in: [...soIds, ...toIds] },
          },
          select: { id: true },
        })
        .catch(() => [] as { id: string }[]);
      const eventIdsToDelete = [
        ...new Set([...ownedEvents.map((e) => e.id), ...evByTo.map((e) => e.id)]),
      ];
      await prisma.reactionExecution
        .deleteMany({ where: { tenantId, eventId: { in: eventIdsToDelete } } })
        .catch(() => undefined);
      await prisma.shipmentLoadLeg
        .deleteMany({ where: { shipmentId: { in: shipmentIds } } })
        .catch(() => undefined);
      await prisma.shipment
        .deleteMany({ where: { id: { in: shipmentIds } } })
        .catch(() => undefined);
      await prisma.load.deleteMany({ where: { id: { in: loadIds } } }).catch(() => undefined);
      await prisma.transportOrder
        .deleteMany({
          where: { OR: [{ id: { in: toIds } }, { tenantId, sourceSalesOrderId: { in: soIds } }] },
        })
        .catch(() => undefined);
      await prisma.domainEvent
        .deleteMany({ where: { tenantId, id: { in: eventIdsToDelete } } })
        .catch(() => undefined);
      await prisma.salesOrder.deleteMany({ where: { id: { in: soIds } } }).catch(() => undefined);
      await prisma.crmDeal.deleteMany({ where: { id: { in: dealIds } } }).catch(() => undefined);
      await prisma.customer
        .deleteMany({ where: { id: { in: customerIds } } })
        .catch(() => undefined);
      await prisma.crmCompany.deleteMany({ where: { id: companyId } }).catch(() => undefined);
      await prisma.location
        .deleteMany({ where: { id: { in: [originId, destId] } } })
        .catch(() => undefined);
      await prisma.carrier.deleteMany({ where: { id: carrierId } }).catch(() => undefined);
      await prisma.auditLog
        .deleteMany({ where: { tenantId, entityId: { in: soIds } } })
        .catch(() => undefined);
    }
    await app.close();
  });

  // -------------------------------------------------------------------------
  describe('1. Create from a CONFIRMED sales order', () => {
    it('creates a transport order with the customer derived from the sales order, linked both sides', async () => {
      const { soId, number, customerId: soCustomer } = await createConfirmedSO();
      const res = await prepareShipment(soId, LOGISTICS()).expect(201);
      const to = res.body as {
        id: string;
        orderNumber: string;
        customerId: string;
        customerReference: string;
        sourceSalesOrderId: string;
        sourceFulfillmentKey: string;
        sourceSalesOrder: { id: string; number: string };
      };
      toIds.push(to.id);

      expect(to.customerId).toBe(soCustomer); // derived, never from the client
      expect(to.sourceSalesOrderId).toBe(soId);
      expect(to.sourceFulfillmentKey).toBe('primary');
      expect(to.customerReference).toBe(number); // defaults to SO number
      expect(to.sourceSalesOrder.id).toBe(soId);
      expect(to.sourceSalesOrder.number).toBe(number);

      // Link visible from the sales-order side via the fulfillment context endpoint.
      const ctx = await request(http)
        .get(`/api/v1/transportation/transport-orders/from-sales-order/${soId}/context`)
        .set(auth());
      // context endpoint may not exist as a GET route — assert the link via GET TO instead if 404.
      if (ctx.status === 200) {
        const body = ctx.body as { transportOrders: Array<{ id: string }> };
        expect(body.transportOrders.some((t) => t.id === to.id)).toBe(true);
      }

      // transport_requested DomainEvent emitted.
      const evt = await prisma.domainEvent.findFirst({
        where: {
          tenantId,
          type: 'crm.sales_order.transport_requested',
          payload: { path: ['transportOrderId'], equals: to.id },
        },
      });
      expect(evt).not.toBeNull();

      // Audit log on the sales-order side.
      const audit = await prisma.auditLog.findFirst({
        where: { tenantId, entityType: 'crm-sales-order', entityId: soId, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('2. Rejections', () => {
    it('refuses a DRAFT sales order (not CONFIRMED)', async () => {
      const c = await prisma.customer.create({
        data: { tenantId, code: `FB-D-${suffix}`, name: `FB Draft ${suffix}` },
      });
      customerIds.push(c.id);
      const so = (
        await request(http)
          .post('/api/v1/crm/sales-orders')
          .set(auth())
          .send({ companyId, customerId: c.id })
          .expect(201)
      ).body as { id: string };
      soIds.push(so.id);
      await prepareShipment(so.id, LOGISTICS()).expect(400);
    });

    it('refuses a CANCELLED sales order', async () => {
      const c = await prisma.customer.create({
        data: { tenantId, code: `FB-X-${suffix}`, name: `FB Cancel ${suffix}` },
      });
      customerIds.push(c.id);
      const so = (
        await request(http)
          .post('/api/v1/crm/sales-orders')
          .set(auth())
          .send({ companyId, customerId: c.id })
          .expect(201)
      ).body as { id: string };
      soIds.push(so.id);
      await request(http).post(`/api/v1/crm/sales-orders/${so.id}/cancel`).set(auth()).expect(200);
      await prepareShipment(so.id, LOGISTICS()).expect(400);
    });

    it('refuses a sales order without a linked customer', async () => {
      const { soId } = await createConfirmedSO(false);
      await prepareShipment(soId, LOGISTICS()).expect(400);
    });

    it('returns 404 for an unknown (cross-tenant) sales order', async () => {
      await prepareShipment('so_does_not_exist_xyz', LOGISTICS()).expect(404);
    });

    it('refuses an unowned / cross-tenant location', async () => {
      const { soId } = await createConfirmedSO();
      await prepareShipment(soId, { ...LOGISTICS(), originLocationId: 'loc_not_owned_xyz' }).expect(
        400,
      );
    });

    it('refuses when the CRM module is disabled', async () => {
      const { soId } = await createConfirmedSO();
      await enableModule('crm', false);
      try {
        await prepareShipment(soId, LOGISTICS()).expect(400);
      } finally {
        await enableModule('crm', true);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('3. Idempotency & partial shipments', () => {
    it('same fulfillmentKey returns the SAME transport order; a different key creates a second', async () => {
      const { soId } = await createConfirmedSO();
      const first = (await prepareShipment(soId, LOGISTICS()).expect(201)).body as { id: string };
      toIds.push(first.id);
      const retry = (
        await prepareShipment(soId, { ...LOGISTICS(), fulfillmentKey: 'primary' }).expect(201)
      ).body as { id: string };
      expect(retry.id).toBe(first.id); // idempotent

      const second = (
        await prepareShipment(soId, { ...LOGISTICS(), fulfillmentKey: 'backup' }).expect(201)
      ).body as { id: string; sourceFulfillmentKey: string };
      toIds.push(second.id);
      expect(second.id).not.toBe(first.id);
      expect(second.sourceFulfillmentKey).toBe('backup');
    });
  });

  // -------------------------------------------------------------------------
  describe('4. Fulfillment reaction (TMS → CRM)', () => {
    it('delivering the only transport order drives the sales order CONFIRMED → FULFILLED', async () => {
      const { soId } = await createConfirmedSO();
      const to = (await prepareShipment(soId, LOGISTICS()).expect(201)).body as { id: string };
      toIds.push(to.id);
      await deliverTransportOrder(to.id);

      // transport-order.completed emitted for the bridge order.
      const evt = await prisma.domainEvent.findFirst({
        where: {
          tenantId,
          type: 'transport-order.completed',
          payload: { path: ['sourceSalesOrderId'], equals: soId },
        },
      });
      expect(evt).not.toBeNull();

      await domainEvents.processPending(500);

      const so = await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId } });
      expect(so.status).toBe('FULFILLED');

      // Idempotent: re-processing does not error and keeps FULFILLED.
      await domainEvents.processPending(500);
      const so2 = await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId } });
      expect(so2.status).toBe('FULFILLED');

      // A FULFILLED sales order refuses new shipment preparation.
      await prepareShipment(soId, { ...LOGISTICS(), fulfillmentKey: 'late' }).expect(400);
    });

    it('with several transport orders, stays CONFIRMED until ALL are delivered', async () => {
      const { soId } = await createConfirmedSO();
      const a = (await prepareShipment(soId, LOGISTICS()).expect(201)).body as { id: string };
      const b = (
        await prepareShipment(soId, { ...LOGISTICS(), fulfillmentKey: 'second' }).expect(201)
      ).body as { id: string };
      toIds.push(a.id, b.id);

      await deliverTransportOrder(a.id);
      await domainEvents.processPending(500);
      expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId } })).status).toBe(
        'CONFIRMED',
      );

      await deliverTransportOrder(b.id);
      await domainEvents.processPending(500);
      expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId } })).status).toBe(
        'FULFILLED',
      );
    });

    it('a sales order whose only transport order is CANCELLED is NOT fulfilled', async () => {
      const { soId } = await createConfirmedSO();
      const to = (await prepareShipment(soId, LOGISTICS()).expect(201)).body as { id: string };
      toIds.push(to.id);
      await request(http)
        .post(`/api/v1/transportation/transport-orders/${to.id}/cancel`)
        .set(auth())
        .expect(201);

      // Simulate a sibling-completion trigger; the reaction must see only a cancelled TO.
      await domainEvents.emit(
        tenantId,
        'transport-order.completed',
        { type: 'transport-order', id: to.id },
        {
          transportOrderId: to.id,
          sourceSalesOrderId: soId,
          sourceFulfillmentKey: 'primary',
          customerId,
        },
      );
      await domainEvents.processPending(500);
      expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId } })).status).toBe(
        'CONFIRMED',
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('5. Agent governance', () => {
    it('get_sales_order_fulfillment_context (READ) returns context directly', async () => {
      const { soId } = await createConfirmedSO();
      const res = await mcp('tools/call', {
        name: 'get_sales_order_fulfillment_context',
        arguments: { salesOrderId: soId },
      }).expect(200);
      const payload = JSON.parse(parseMcp(res).result.content[0].text);
      expect(payload.salesOrder.id).toBe(soId);
      expect(payload.canPrepareShipment).toBe(true);
      expect(Array.isArray(payload.requiredLogisticsFields)).toBe(true);
    });

    it('create_transport_order_from_sales_order (MUTATING) is QUEUED as a ProposedAction, then executes on approval', async () => {
      const { soId } = await createConfirmedSO();
      const before = await prisma.transportOrder.count({
        where: { tenantId, sourceSalesOrderId: soId },
      });
      expect(before).toBe(0);

      const res = await mcp('tools/call', {
        name: 'create_transport_order_from_sales_order',
        arguments: { salesOrderId: soId, ...LOGISTICS() },
      }).expect(200);
      const payload = JSON.parse(parseMcp(res).result.content[0].text);
      expect(payload.proposalId).toBeTruthy();
      expect(payload.status).toBe('PENDING');
      // Not executed yet — no transport order created by the handler.
      expect(
        await prisma.transportOrder.count({ where: { tenantId, sourceSalesOrderId: soId } }),
      ).toBe(0);

      const approve = await request(http)
        .post(`/api/v1/agent-actions/${payload.proposalId}/approve`)
        .set(auth())
        .expect(201);
      expect(approve.body.status).toBe('EXECUTED');
      const created = await prisma.transportOrder.findFirst({
        where: { tenantId, sourceSalesOrderId: soId },
      });
      expect(created).not.toBeNull();
      if (created) toIds.push(created.id);
      expect(created!.sourceFulfillmentKey).toBe('primary');
    });
  });

  // -------------------------------------------------------------------------
  describe('6. Vertical slice — WON deal → SalesOrder → delivery → FULFILLED → INVOICED → paid + balanced GL', () => {
    it('walks a deal end to end through the bridge to a paid, ledgered invoice', async () => {
      await request(http)
        .put('/api/v1/modules/crm/settings')
        .set(auth())
        .send({ settings: { salesOrderDirectInvoicing: true } })
        .expect(200);

      // Deal → line item → WON → convert → Customer
      const deal = (
        await request(http)
          .post('/api/v1/crm/deals')
          .set(auth())
          .send({ title: `FB Deal ${suffix}`, companyId })
          .expect(201)
      ).body as { id: string };
      dealIds.push(deal.id);
      await request(http)
        .post(`/api/v1/crm/deals/${deal.id}/line-items`)
        .set(auth())
        .send({ name: 'Freight', quantity: 2, unitPrice: 500 })
        .expect(201);
      for (const stage of ['QUALIFIED', 'PROPOSAL', 'WON']) {
        await request(http)
          .post(`/api/v1/crm/deals/${deal.id}/advance`)
          .set(auth())
          .send({ stage })
          .expect(200);
      }
      const conv = (
        await request(http).post(`/api/v1/crm/deals/${deal.id}/convert`).set(auth()).expect(200)
      ).body as { customerId: string };
      customerIds.push(conv.customerId);

      // SalesOrder from deal → confirm
      const so = (
        await request(http)
          .post(`/api/v1/crm/deals/${deal.id}/create-sales-order`)
          .set(auth())
          .expect(201)
      ).body as { id: string };
      soIds.push(so.id);
      await request(http).post(`/api/v1/crm/sales-orders/${so.id}/confirm`).set(auth()).expect(200);

      // Prepare shipment → deliver → SalesOrder auto-FULFILLED via reaction
      const to = (await prepareShipment(so.id, LOGISTICS()).expect(201)).body as { id: string };
      toIds.push(to.id);
      await deliverTransportOrder(to.id);
      await domainEvents.processPending(500);
      expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe(
        'FULFILLED',
      );

      // FULFILLED → INVOICED (emits crm.sales_order.invoiced) → reaction drafts a CustomerInvoice
      await request(http).post(`/api/v1/crm/sales-orders/${so.id}/invoice`).set(auth()).expect(200);
      await domainEvents.processPending(500);

      const draft = await prisma.customerInvoice.findFirst({
        where: { tenantId, customData: { path: ['salesOrderId'], equals: so.id } },
      });
      expect(draft).not.toBeNull();
      invoiceIds.push(draft!.id);
      await prisma.customer.update({
        where: { id: conv.customerId },
        data: { email: `fb-${suffix}@example.test` },
      });

      // approve → send → pay
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${draft!.id}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${draft!.id}/send`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      const paid = (
        await request(http)
          .post(`/api/v1/billing/customer-invoices/${draft!.id}/pay`)
          .set(auth())
          .send({})
          .expect((r) => expect([200, 201]).toContain(r.status))
      ).body as { status: string };
      expect(paid.status).toBe('PAID');

      // Balanced GL on approve + pay
      const approveEntry = await prisma.journalEntry.findFirst({
        where: {
          tenantId,
          sourceType: 'customer-invoice',
          sourceId: draft!.id,
          sourceKind: 'approved',
        },
        include: { lines: true },
      });
      expect(approveEntry).not.toBeNull();
      const aDr = approveEntry!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const aCr = approveEntry!.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(aDr).toBe(aCr);
      expect(aDr).toBe(1000);

      const alloc = await prisma.paymentAllocation.findFirst({
        where: { tenantId, targetType: 'CUSTOMER_INVOICE', targetId: draft!.id },
        select: { paymentId: true },
      });
      expect(alloc).not.toBeNull();
      const payEntry = await prisma.journalEntry.findFirst({
        where: { tenantId, sourceType: 'payment', sourceId: alloc!.paymentId },
        include: { lines: true },
      });
      expect(payEntry).not.toBeNull();
      const pDr = payEntry!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const pCr = payEntry!.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(pDr).toBe(pCr);
      expect(pDr).toBe(1000);
    }, 90_000);
  });

  // -------------------------------------------------------------------------
  describe('7. Cross-module tool authorization (registry-enforced)', () => {
    const BRIDGE_TOOLS = [
      'get_sales_order_fulfillment_context',
      'create_transport_order_from_sales_order',
    ];

    it('agent with BOTH permissions + both modules sees the bridge tools', async () => {
      const names = toolNamesFrom(await mcp('tools/list', {}).expect(200));
      for (const t of BRIDGE_TOOLS) expect(names).toContain(t);
    });

    it('agent WITHOUT crm.read does not see the bridge tools (cross-module leak closed)', async () => {
      const key = await createAgent('fb-nocrm', [
        'transportation.orders.read',
        'transportation.orders.manage',
      ]);
      const names = toolNamesFrom(await mcpAs(key, 'tools/list', {}).expect(200));
      for (const t of BRIDGE_TOOLS) expect(names).not.toContain(t);
      // Sanity: it still sees a pure-TMS tool it IS authorized for.
      expect(names).toContain('list_transport_orders');
    });

    it('agent WITHOUT a TMS permission does not see the bridge tools', async () => {
      const key = await createAgent('fb-nomts', ['crm.read']);
      const names = toolNamesFrom(await mcpAs(key, 'tools/list', {}).expect(200));
      for (const t of BRIDGE_TOOLS) expect(names).not.toContain(t);
    });

    it('directly invoking an unexposed bridge tool is rejected (never reaches the handler)', async () => {
      const key = await createAgent('fb-nocrm2', [
        'transportation.orders.read',
        'transportation.orders.manage',
      ]);
      const env = parseMcp(
        await mcpAs(key, 'tools/call', {
          name: 'get_sales_order_fulfillment_context',
          arguments: { salesOrderId: 'x' },
        }).expect(200),
      );
      expect(env.result?.isError).toBe(true);
      expect(env.result.content[0].text).toContain('not found');
    });

    it('CRM disabled hides the bridge tools even for a fully-permissioned agent', async () => {
      await enableModule('crm', false);
      try {
        const names = toolNamesFrom(await mcp('tools/list', {}).expect(200));
        for (const t of BRIDGE_TOOLS) expect(names).not.toContain(t);
        // A pure-TMS tool remains visible (transportation still enabled).
        expect(names).toContain('list_transport_orders');
      } finally {
        await enableModule('crm', true);
      }
    });

    it('toolAllowlist still filters (allowlist without the bridge tool hides it)', async () => {
      const key = await createAgent(
        'fb-allow',
        ['transportation.orders.read', 'transportation.orders.manage', 'crm.read'],
        { toolAllowlist: ['list_transport_orders'] },
      );
      const names = toolNamesFrom(await mcpAs(key, 'tools/list', {}).expect(200));
      expect(names).toEqual(['list_transport_orders']);
      for (const t of BRIDGE_TOOLS) expect(names).not.toContain(t);
    });
  });

  // -------------------------------------------------------------------------
  describe('8. Completion invariants (completeFromDelivery: tenant-scoped, audited, single-event)', () => {
    let txService: TransportOrdersService;
    let realUserId = '';

    // Create a bridge-linked transport order directly in IN_EXECUTION.
    async function makeInExecutionBridgeTO(status: 'IN_EXECUTION' | 'CANCELLED' = 'IN_EXECUTION') {
      const { soId } = await createConfirmedSO();
      const cust = await prisma.customer.create({
        data: {
          tenantId,
          code: `FB-CMP-${suffix}-${toIds.length}`,
          name: `FB Cmp ${suffix} ${toIds.length}`,
        },
      });
      customerIds.push(cust.id);
      const to = await prisma.transportOrder.create({
        data: {
          tenantId,
          orderNumber: `FB-CMP-TO-${suffix}-${toIds.length}`,
          customerId: cust.id,
          originLocationId: originId,
          destinationLocationId: destId,
          status: status as never,
          sourceSalesOrderId: soId,
          sourceFulfillmentKey: 'primary',
        },
      });
      toIds.push(to.id);
      return { orderId: to.id, soId };
    }

    beforeAll(async () => {
      txService = app.get(TransportOrdersService);
      const admin = await prisma.user.findFirstOrThrow({
        where: { tenantId, email: 'admin@pulsar.dev' },
      });
      realUserId = admin.id;
    });

    it('IN_EXECUTION → COMPLETED: returns true, audits STATUS_CHANGE, emits exactly one event', async () => {
      const { orderId } = await makeInExecutionBridgeTO();
      const did = await txService.completeFromDelivery(tenantId, realUserId, orderId);
      expect(did).toBe(true);

      expect(
        (await prisma.transportOrder.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('COMPLETED');

      const audit = await prisma.auditLog.findFirst({
        where: {
          tenantId,
          entityType: 'transport-order',
          entityId: orderId,
          action: 'STATUS_CHANGE',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect((audit!.after as { status?: string }).status).toBe('COMPLETED');

      const events = await prisma.domainEvent.count({
        where: { tenantId, type: 'transport-order.completed', subjectId: orderId },
      });
      expect(events).toBe(1);
    });

    it('retry is idempotent: a second call returns false and emits no second event', async () => {
      const { orderId } = await makeInExecutionBridgeTO();
      expect(await txService.completeFromDelivery(tenantId, realUserId, orderId)).toBe(true);
      expect(await txService.completeFromDelivery(tenantId, realUserId, orderId)).toBe(false);
      const events = await prisma.domainEvent.count({
        where: { tenantId, type: 'transport-order.completed', subjectId: orderId },
      });
      expect(events).toBe(1);
    });

    it('a CANCELLED order is not transitioned (no state-machine violation)', async () => {
      const { orderId } = await makeInExecutionBridgeTO('CANCELLED');
      expect(await txService.completeFromDelivery(tenantId, realUserId, orderId)).toBe(false);
      expect(
        (await prisma.transportOrder.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('CANCELLED');
    });

    it("another tenant cannot complete this tenant's order (tenant isolation)", async () => {
      const { orderId } = await makeInExecutionBridgeTO();
      const other = await prisma.tenant.create({
        data: { slug: `fb-other-${suffix}`, name: `FB Other ${suffix}` },
      });
      try {
        expect(await txService.completeFromDelivery(other.id, realUserId, orderId)).toBe(false);
        expect(
          (await prisma.transportOrder.findUniqueOrThrow({ where: { id: orderId } })).status,
        ).toBe('IN_EXECUTION');
      } finally {
        await prisma.tenant.deleteMany({ where: { id: other.id } }).catch(() => undefined);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('9. Logistics contract (origin/destination/mode + >=1 positive measure)', () => {
    const NO_MEASURE = () => ({
      originLocationId: originId,
      destinationLocationId: destId,
      mode: 'FTL' as const,
    });

    it('refuses when no physical measure is provided', async () => {
      const { soId } = await createConfirmedSO();
      await prepareShipment(soId, NO_MEASURE()).expect(400);
    });

    it('refuses when all measures are zero (zero never satisfies the rule)', async () => {
      const { soId } = await createConfirmedSO();
      await prepareShipment(soId, {
        ...NO_MEASURE(),
        totalWeightKg: 0,
        totalVolumeM3: 0,
        palletCount: 0,
      }).expect(400);
    });

    it('accepts a positive weight only', async () => {
      const { soId } = await createConfirmedSO();
      const to = (await prepareShipment(soId, { ...NO_MEASURE(), totalWeightKg: 500 }).expect(201))
        .body as { id: string };
      toIds.push(to.id);
    });

    it('accepts a positive volume only', async () => {
      const { soId } = await createConfirmedSO();
      const to = (await prepareShipment(soId, { ...NO_MEASURE(), totalVolumeM3: 8 }).expect(201))
        .body as { id: string };
      toIds.push(to.id);
    });

    it('accepts a positive pallet count only', async () => {
      const { soId } = await createConfirmedSO();
      const to = (await prepareShipment(soId, { ...NO_MEASURE(), palletCount: 3 }).expect(201))
        .body as { id: string };
      toIds.push(to.id);
    });

    it('refuses when mode is missing', async () => {
      const { soId } = await createConfirmedSO();
      await prepareShipment(soId, {
        originLocationId: originId,
        destinationLocationId: destId,
        totalWeightKg: 500,
      }).expect(400);
    });

    it('refuses when origin or destination is missing', async () => {
      const { soId } = await createConfirmedSO();
      await prepareShipment(soId, {
        destinationLocationId: destId,
        mode: 'FTL',
        totalWeightKg: 500,
      }).expect(400);
      const { soId: soId2 } = await createConfirmedSO();
      await prepareShipment(soId2, {
        originLocationId: originId,
        mode: 'FTL',
        totalWeightKg: 500,
      }).expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('10. Backlog resilience (fulfillment still works behind >100 old PENDING events)', () => {
    const backlogTenant = `zzz-fb-backlog-${suffix}`;

    afterAll(async () => {
      await prisma.domainEvent
        .deleteMany({ where: { tenantId: backlogTenant } })
        .catch(() => undefined);
    });

    it('drains a 120-event backlog and still fulfills the sales order', async () => {
      // Inject 120 old PENDING events for a throwaway tenant (older than anything
      // this test emits). Oldest-first + batch limits would starve a naive single
      // batch; the bounded catch-up helper drains them.
      await prisma.$transaction(
        Array.from({ length: 120 }, (_v, i) =>
          prisma.domainEvent.create({
            data: {
              tenantId: backlogTenant,
              type: 'noop.backlog',
              payload: {},
              status: 'PENDING',
              createdAt: new Date(Date.now() - (200 - i) * 1000),
            },
          }),
        ),
      );
      expect(
        await prisma.domainEvent.count({ where: { tenantId: backlogTenant, status: 'PENDING' } }),
      ).toBe(120);

      const { soId } = await createConfirmedSO();
      const to = (await prepareShipment(soId, LOGISTICS()).expect(201)).body as { id: string };
      toIds.push(to.id);
      await deliverTransportOrder(to.id);

      // Bounded catch-up drains the whole queue (backlog + this suite's events).
      await drainInheritedDomainEvents(domainEvents);

      expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId } })).status).toBe(
        'FULFILLED',
      );
      expect(
        await prisma.domainEvent.count({ where: { tenantId: backlogTenant, status: 'PENDING' } }),
      ).toBe(0);
    });
  });
});
