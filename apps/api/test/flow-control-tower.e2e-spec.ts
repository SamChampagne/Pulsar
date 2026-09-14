/**
 * E2E flow-control-tower — cross-module flow timeline, entity trace, and flow map.
 *
 * Proves the three read-only analytics/flow endpoints over real Postgres with the
 * admin Bearer token.  All fixture rows are seeded directly via Prisma; the
 * DomainEventsService.processPending() helper is called in-process to materialise
 * the event→task causality chain.
 *
 * Scenarios:
 *
 *   1. Timeline + causality
 *      Seed a `DomainEvent` (stop.delayed) for tenant acme, call processPending(),
 *      then GET /analytics/flow/timeline?days=7 → the response contains a chain
 *      whose event.type matches and tasks is non-empty.
 *
 *   2. Trace
 *      Create a minimal TransportOrder with one Shipment via Prisma, then
 *      GET /analytics/flow/trace?entityType=TRANSPORT_ORDER&entityId=<id>
 *      → stages array present, first stage Créée has status DONE, shape is correct.
 *
 *   3. Map
 *      GET /analytics/flow/map?days=7 → nodes array with at least one entry for the
 *      TRANSPORTATION module (from the stop.delayed event seeded in scenario 1).
 *
 *   4. Tenant isolation
 *      Seed a second DomainEvent with a fabricated (non-existent) tenantId that is
 *      different from acme's; then assert the acme timeline does NOT contain the
 *      foreign event (FlowService scopes queries by tenantId).
 *
 *   5. Gating (module + permission)
 *      A user without analytics.read gets 403 on the timeline endpoint.
 *      (Module gating confirmed by the happy-path succeeding — acme has ANALYTICS enabled.)
 *
 * The AgentRuntimeService is replaced by a minimal stub so the app boots without
 * a real Hermes process (mirrors phase15a-control-tower.e2e-spec.ts intent).
 *
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as net from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentsService } from '../src/core/agents/agents.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { AgentWorkerService } from '../src/core/operating/agent-worker.service';
import { DomainEventsService } from '../src/core/operating/domain-events.service';
import { drainInheritedDomainEvents } from './utils/domain-events';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

// ---------------------------------------------------------------------------
// FakeAgentRuntimeService — minimal no-op stub. This suite never drives a real
// Hermes turn; the override only prevents the app from trying to spawn Python.
// ---------------------------------------------------------------------------
@Injectable()
class FakeAgentRuntimeService {
  constructor(private readonly _agents: AgentsService) {}

  async openSession(): Promise<string> {
    return 'fake-session';
  }

  async *sendTurn(): AsyncGenerator<never> {
    /* no turns in this suite */
  }

  async closeSession(): Promise<void> {
    /* no-op */
  }

  async killAgentSessions(): Promise<void> {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// FakeAgentWorkerService — prevents processPending() from waking the live
// dispatcher against the shared DB when it fire-and-forgets enqueueTask().
// Without this stub the domain-event worker would kick the real AgentWorkerService,
// creating AgentRun rows and worsening the phase13-workforce cross-suite flake
// (an always-on DELAY agent racing for the same task).
// ---------------------------------------------------------------------------
const FakeAgentWorkerService = {
  enqueueTask: async () => {},
  runNow: async () => false,
  pauseAgent: async () => {},
  resumeAgent: async () => {},
  runCron: async () => {},
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Flow Control Tower (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let domainEvents: DomainEventsService;
  let token = '';
  let tenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // IDs for fixture rows (cleaned up in afterAll).
  let customerId = '';
  let originId = '';
  let destId = '';
  let orderId = '';
  let shipmentId = '';
  let seedEventId = '';
  let seedTaskDedupKey = '';
  const noPermUserId: string[] = [];

  // IDs for scenario 6 (reaction visibility) fixture rows.
  let rxCarrierId = '';
  let rxOrderId = '';
  let rxShipmentId = '';
  let rxLoadId = '';
  let rxRuleId = '';
  const rxInvoiceIds: string[] = [];
  const rxEventIds: string[] = [];

  // IDs for scenario 6C (genuine zero-case isolated tenant).
  let zeroTenantId = '';
  let zeroToken = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentRuntimeService)
      .useClass(FakeAgentRuntimeService)
      .overrideProvider(AgentWorkerService)
      .useValue(FakeAgentWorkerService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );

    await app.listen(0);
    http = app.getHttpServer();
    void (http.address() as net.AddressInfo).port;

    prisma = app.get(PrismaService);
    domainEvents = app.get(DomainEventsService);
    await drainInheritedDomainEvents(domainEvents);

    // Login as admin (has analytics.read via seeded ADMIN role).
    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // --- Ensure ANALYTICS module is enabled for acme. -----------------------
    const analyticsMod = await prisma.moduleDefinition.findUniqueOrThrow({
      where: { key: 'analytics' },
    });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: analyticsMod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: analyticsMod.id, enabled: true, enabledAt: new Date() },
    });

    // --- Ensure TRANSPORTATION module is enabled for acme (needed for the TransportOrder). ----
    const tmsMod = await prisma.moduleDefinition.findUniqueOrThrow({
      where: { key: 'transportation' },
    });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: tmsMod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: tmsMod.id, enabled: true, enabledAt: new Date() },
    });

    // --- Ensure BILLING module is enabled for acme (needed for draft_customer_invoice reaction). --
    const billingMod = await prisma.moduleDefinition.findUniqueOrThrow({
      where: { key: 'billing' },
    });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: billingMod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: billingMod.id, enabled: true, enabledAt: new Date() },
    });

    // --- Ensure the service-account exists (required by ReactionExecutorService). ---------------
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId, email: 'service-account@pulsar.local' } },
      update: {},
      create: {
        tenantId,
        email: 'service-account@pulsar.local',
        passwordHash: 'x',
        firstName: 'Service',
        lastName: 'Account',
        status: 'DISABLED',
      },
    });

    // --- Seed a customer + origin/dest + a minimal TransportOrder + Shipment for trace tests. --
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        code: `FCT-CUST-${suffix}`,
        name: `FCT Customer ${suffix}`,
      },
    });
    customerId = customer.id;

    const origin = await prisma.location.create({
      data: {
        tenantId,
        code: `FCT-ORIG-${suffix}`,
        name: `FCT Origin ${suffix}`,
        addressLine1: '1 Origin St',
        city: 'Montreal',
        country: 'CA',
      },
    });
    originId = origin.id;

    const dest = await prisma.location.create({
      data: {
        tenantId,
        code: `FCT-DEST-${suffix}`,
        name: `FCT Dest ${suffix}`,
        addressLine1: '2 Dest Ave',
        city: 'Toronto',
        country: 'CA',
      },
    });
    destId = dest.id;

    const order = await prisma.transportOrder.create({
      data: {
        tenantId,
        orderNumber: `TO-FCT-${suffix}`,
        customerId,
        originLocationId: originId,
        destinationLocationId: destId,
      },
    });
    orderId = order.id;

    const shipment = await prisma.shipment.create({
      data: {
        tenantId,
        shipmentNumber: `SH-FCT-${suffix}`,
        transportOrderId: orderId,
        originLocationId: originId,
        destinationLocationId: destId,
        status: 'PENDING',
        weightKg: 1000,
        palletCount: 4,
      },
    });
    shipmentId = shipment.id;

    // --- Seed a DomainEvent (stop.delayed) so processPending() creates a task. ----------------
    // stopId is a stable fabricated ID that will make the dedupKey unique per run.
    const stopId = `fct-stop-${suffix}`;
    const deadline = new Date(Date.now() + 3_600_000).toISOString();
    seedTaskDedupKey = `DELAY:${stopId}:${deadline}`;

    const event = await prisma.domainEvent.create({
      data: {
        tenantId,
        type: 'stop.delayed',
        subjectType: 'stop',
        subjectId: stopId,
        payload: { stopId, deadline, minutesLate: 30 },
        status: 'PENDING',
      },
    });
    seedEventId = event.id;

    // --- Run the domain-event worker to materialise the event→task chain. ---
    await domainEvents.processPending(50);
  });

  afterAll(async () => {
    if (prisma) {
      // Domain event + task
      await prisma.operationalTask
        .deleteMany({ where: { tenantId, dedupKey: seedTaskDedupKey } })
        .catch(() => undefined);
      await prisma.domainEvent.deleteMany({ where: { id: seedEventId } }).catch(() => undefined);

      // TransportOrder chain
      await prisma.shipment.deleteMany({ where: { id: shipmentId } }).catch(() => undefined);
      await prisma.transportOrder.deleteMany({ where: { id: orderId } }).catch(() => undefined);
      await prisma.location
        .deleteMany({ where: { id: { in: [originId, destId] } } })
        .catch(() => undefined);
      await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);

      // No-perm test user (if created)
      if (noPermUserId.length > 0) {
        await prisma.user
          .deleteMany({ where: { id: { in: noPermUserId } } })
          .catch(() => undefined);
      }

      // Scenario 6 reaction fixtures
      if (rxInvoiceIds.length > 0) {
        await prisma.customerInvoice
          .deleteMany({ where: { id: { in: rxInvoiceIds } } })
          .catch(() => undefined);
      }
      if (rxEventIds.length > 0) {
        await prisma.reactionExecution
          .deleteMany({ where: { tenantId, eventId: { in: rxEventIds } } })
          .catch(() => undefined);
        await prisma.domainEvent
          .deleteMany({ where: { tenantId, id: { in: rxEventIds } } })
          .catch(() => undefined);
      }
      if (rxLoadId) {
        await prisma.shipmentLoadLeg
          .deleteMany({ where: { shipmentId: rxShipmentId } })
          .catch(() => undefined);
        await prisma.shipment.deleteMany({ where: { id: rxShipmentId } }).catch(() => undefined);
        await prisma.load.deleteMany({ where: { id: rxLoadId } }).catch(() => undefined);
      }
      if (rxOrderId) {
        await prisma.transportOrder.deleteMany({ where: { id: rxOrderId } }).catch(() => undefined);
      }
      if (rxRuleId) {
        await prisma.automationRule.deleteMany({ where: { id: rxRuleId } }).catch(() => undefined);
      }
      if (rxCarrierId) {
        await prisma.carrier.deleteMany({ where: { id: rxCarrierId } }).catch(() => undefined);
      }

      // Scenario 6C — clean up the isolated zero-reaction tenant
      if (zeroTenantId) {
        await prisma.domainEvent
          .deleteMany({ where: { tenantId: zeroTenantId } })
          .catch(() => undefined);
        await prisma.user.deleteMany({ where: { tenantId: zeroTenantId } }).catch(() => undefined);
        await prisma.role.deleteMany({ where: { tenantId: zeroTenantId } }).catch(() => undefined);
        await prisma.tenantModule
          .deleteMany({ where: { tenantId: zeroTenantId } })
          .catch(() => undefined);
        await prisma.tenant.deleteMany({ where: { id: zeroTenantId } }).catch(() => undefined);
      }
    }
    await app.close();
  });

  // =========================================================================
  // Scenario 1 — Timeline + causality
  // =========================================================================
  describe('Scenario 1 — timeline + causality', () => {
    it('returns a chain whose event.type is stop.delayed and tasks is non-empty', async () => {
      const res = await request(http)
        .get('/api/v1/analytics/flow/timeline?days=7')
        .set(auth())
        .expect(200);

      const body = res.body as {
        chains: Array<{
          event: { id: string; type: string; module: string } | null;
          tasks: Array<{ id: string; sourceEventId: string | null }>;
          actions: unknown[];
          modules: string[];
          crossModule: boolean;
          startedAt: string;
          lastAt: string;
        }>;
      };

      expect(Array.isArray(body.chains)).toBe(true);

      // Find our seeded chain by event id.
      const chain = body.chains.find((c) => c.event?.id === seedEventId);
      expect(chain).toBeTruthy();

      // Event shape
      expect(chain!.event!.type).toBe('stop.delayed');
      expect(chain!.event!.module).toBe('TRANSPORTATION');

      // The processPending call must have created at least one task linked to this event.
      expect(chain!.tasks.length).toBeGreaterThanOrEqual(1);
      const linkedTask = chain!.tasks.find((t) => t.sourceEventId === seedEventId);
      expect(linkedTask).toBeTruthy();

      // Shape invariants
      expect(typeof chain!.startedAt).toBe('string');
      expect(typeof chain!.lastAt).toBe('string');
      expect(Array.isArray(chain!.modules)).toBe(true);
    });
  });

  // =========================================================================
  // Scenario 2 — Trace
  // =========================================================================
  describe('Scenario 2 — entity trace', () => {
    it('returns stages with Créée=DONE for a newly created TransportOrder', async () => {
      const res = await request(http)
        .get(`/api/v1/analytics/flow/trace?entityType=TRANSPORT_ORDER&entityId=${orderId}`)
        .set(auth())
        .expect(200);

      const body = res.body as {
        rootType: string;
        rootId: string;
        stages: Array<{
          stage: string;
          module: string;
          status: string;
          at: string | null;
          refs: string[];
        }>;
      };

      // Root shape
      expect(body.rootType).toBe('TRANSPORT_ORDER');
      expect(body.rootId).toBe(orderId);

      // Must return the six standard stages.
      expect(Array.isArray(body.stages)).toBe(true);
      expect(body.stages.length).toBeGreaterThanOrEqual(6);

      // First stage: Créée — the order exists, so it must be DONE.
      const created = body.stages.find((s) => s.stage === 'Créée');
      expect(created).toBeTruthy();
      expect(created!.status).toBe('DONE');
      expect(created!.module).toBe('TRANSPORTATION');
      expect(typeof created!.at).toBe('string');

      // Remaining stages for a brand-new order with no load/pick/yard/invoice must be exactly
      // PENDING. buildEntityTrace sets status=DONE only when the "at" timestamp is non-null,
      // and BLOCKED only when pickBlocked=true. This assertion would FAIL if the derivation
      // wrongly resolved a timestamp (e.g. by accidentally recomputing a completed load) or
      // returned BLOCKED/DONE for any stage the test fixture hasn't reached.
      const rest = body.stages.filter((s) => s.stage !== 'Créée');
      for (const s of rest) {
        expect(s.status).toBe('PENDING');
        // refs must be an empty array for stages with no data yet.
        expect(Array.isArray(s.refs)).toBe(true);
      }
    });

    it('returns the same trace when the entityType is SHIPMENT (resolved to order)', async () => {
      const res = await request(http)
        .get(`/api/v1/analytics/flow/trace?entityType=SHIPMENT&entityId=${shipmentId}`)
        .set(auth())
        .expect(200);

      const body = res.body as { rootType: string; rootId: string };
      // Trace resolves to the parent TransportOrder.
      expect(body.rootId).toBe(orderId);
    });
  });

  // =========================================================================
  // Scenario 3 — Map
  // =========================================================================
  describe('Scenario 3 — flow map', () => {
    it('returns nodes with at least one TRANSPORTATION node for the seeded event', async () => {
      const res = await request(http)
        .get('/api/v1/analytics/flow/map?days=7')
        .set(auth())
        .expect(200);

      const body = res.body as {
        nodes: Array<{ module: string; eventCount: number }>;
        edges: Array<{ from: string; to: string; count: number }>;
      };

      expect(Array.isArray(body.nodes)).toBe(true);
      expect(Array.isArray(body.edges)).toBe(true);

      // There must be at least one TRANSPORTATION node (from the stop.delayed event).
      const tmsNode = body.nodes.find((n) => n.module === 'TRANSPORTATION');
      expect(tmsNode).toBeTruthy();
      expect(tmsNode!.eventCount).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Scenario 4 — Tenant isolation
  // =========================================================================
  describe('Scenario 4 — tenant isolation', () => {
    it('a DomainEvent belonging to a foreign tenantId does not appear in acme timeline', async () => {
      // Insert a DomainEvent with a completely different (fake) tenantId.
      const foreignTenantId = `foreign-tenant-${suffix}`;
      const foreignEvent = await prisma.domainEvent.create({
        data: {
          // We use a fabricated tenantId — it won't match any real tenant.
          tenantId: foreignTenantId,
          type: 'stop.delayed',
          subjectType: 'stop',
          subjectId: `foreign-stop-${suffix}`,
          payload: { stopId: `foreign-stop-${suffix}`, minutesLate: 5 },
          status: 'PROCESSED', // already processed, skip the worker
        },
      });

      try {
        // The acme admin token must NOT see the foreign event in the timeline.
        const res = await request(http)
          .get('/api/v1/analytics/flow/timeline?days=7')
          .set(auth())
          .expect(200);

        const body = res.body as {
          chains: Array<{ event: { id: string } | null }>;
        };

        const found = body.chains.some((c) => c.event?.id === foreignEvent.id);
        expect(found).toBe(false);
      } finally {
        await prisma.domainEvent
          .deleteMany({ where: { id: foreignEvent.id } })
          .catch(() => undefined);
      }
    });
  });

  // =========================================================================
  // Scenario 5a — Module gating (SKIPPED — see comment)
  // =========================================================================
  // NOTE: We intentionally skip a dedicated module-gating test here.
  // Toggling acme's ANALYTICS module off (prisma.tenantModule.update enabled=false) and
  // back on in this suite would risk polluting other suites that share the same seeded
  // DB state and rely on acme having ANALYTICS enabled (the ModulesGuard uses a 30 s
  // in-memory cache, so the toggle leaks across suites when running --runInBand).
  // The happy-path succeeding in Scenarios 1-4 already confirms the module guard allows
  // the request when ANALYTICS is enabled. A dedicated isolation test belongs in a
  // test that controls its own tenant and does not share acme.

  // =========================================================================
  // Scenario 6 — Reaction visibility (timeline + map + KPI + back-compat)
  // =========================================================================
  describe('Scenario 6 — reaction visibility', () => {
    /**
     * Drive a complete load lifecycle (DRAFT→CONFIRMED→PLANNED→DISPATCHED→IN_TRANSIT→COMPLETED)
     * so the `load.completed` DomainEvent is emitted and then processed by the reaction engine.
     * Then assert:
     *   A) Timeline: some chain's reactions[] contains the reaction with status EXECUTED;
     *      reactionKpis.executed >= 1.
     *   B) Map: edges contains at least one entry with kind = 'reaction'.
     *   C) Back-compat: reactionKpis.executed is a number (0 ok) when no reactions exist in
     *      a fresh window — asserted via the existing seedEventId chain which never triggers a
     *      reaction (stop.delayed has no RUN_ACTION rule).
     */

    // Set up: create an automation rule + carrier + full order/load cycle.
    beforeAll(async () => {
      // Create the draft_customer_invoice rule for load.completed
      const ruleRes = await request(http)
        .post('/api/v1/automation/rules')
        .set(auth())
        .send({
          name: `FCT Draft Invoice ${suffix}`,
          eventType: 'load.completed',
          match: 'ALL',
          conditions: [],
          action: {
            kind: 'RUN_ACTION',
            action: 'draft_customer_invoice',
            args: { loadId: '{loadId}' },
          },
        })
        .expect(201);
      rxRuleId = (ruleRes.body as { id: string }).id;

      // Create a carrier (needed to dispatch the load)
      const carrierRes = await request(http)
        .post('/api/v1/transportation/carriers')
        .set(auth())
        .send({ code: `FCT-CARR-${suffix}`, name: `FCT Carrier ${suffix}` })
        .expect(201);
      rxCarrierId = (carrierRes.body as { id: string }).id;

      // Create transport order (reuse existing customerId/originId/destId from beforeAll)
      const orderRes = await request(http)
        .post('/api/v1/transportation/transport-orders')
        .set(auth())
        .send({
          customerId,
          originLocationId: originId,
          destinationLocationId: destId,
          totalWeightKg: 100,
        })
        .expect(201);
      rxOrderId = (orderRes.body as { id: string }).id;

      // Confirm the order
      await request(http)
        .post(`/api/v1/transportation/transport-orders/${rxOrderId}/confirm`)
        .set(auth())
        .expect(201);

      // Plan the order (emits transport-order.planned; also creates shipment)
      const planRes = await request(http)
        .post(`/api/v1/transportation/transport-orders/${rxOrderId}/plan`)
        .set(auth())
        .expect(201);
      rxShipmentId = (planRes.body as { shipments: Array<{ id: string }> }).shipments[0].id;

      // Drain the transport-order.planned event so it doesn't interfere
      await domainEvents.processPending(50);

      // Create load
      const loadRes = await request(http)
        .post('/api/v1/transportation/loads')
        .set(auth())
        .send({})
        .expect(201);
      rxLoadId = (loadRes.body as { id: string }).id;

      // Assign shipment to load
      await request(http)
        .post(`/api/v1/transportation/shipments/${rxShipmentId}/assign-load`)
        .set(auth())
        .send({ loadId: rxLoadId })
        .expect(201);

      // Assign carrier
      await request(http)
        .post(`/api/v1/transportation/loads/${rxLoadId}/assign`)
        .set(auth())
        .send({ carrierId: rxCarrierId })
        .expect(201);

      // Dispatch → start-transit → complete (emits load.completed)
      await request(http)
        .post(`/api/v1/transportation/loads/${rxLoadId}/dispatch`)
        .set(auth())
        .expect(201);
      await request(http)
        .post(`/api/v1/transportation/loads/${rxLoadId}/start-transit`)
        .set(auth())
        .expect(201);
      await request(http)
        .post(`/api/v1/transportation/loads/${rxLoadId}/complete`)
        .set(auth())
        .expect(201);

      // Collect the load.completed DomainEvent id for cleanup
      const completedEvent = await prisma.domainEvent.findFirst({
        where: {
          tenantId,
          type: 'load.completed',
          payload: { path: ['loadId'], equals: rxLoadId },
        },
        select: { id: true },
      });
      if (completedEvent) rxEventIds.push(completedEvent.id);

      // Process reactions
      await domainEvents.processPending(50);

      // Collect any invoices created for cleanup
      const invoices = await prisma.customerInvoice.findMany({
        where: { tenantId, customerId },
        select: { id: true },
      });
      rxInvoiceIds.push(...invoices.map((i) => i.id));
    });

    it('A) timeline: chain for load.completed has reactions[] with EXECUTED entry; reactionKpis.executed >= 1', async () => {
      const res = await request(http)
        .get('/api/v1/analytics/flow/timeline?days=7')
        .set(auth())
        .expect(200);

      const body = res.body as {
        chains: Array<{
          event: { id: string; type: string } | null;
          reactions: Array<{ id: string; action: string; status: string; eventId: string }>;
        }>;
        reactionKpis: { executed: number; failed: number };
      };

      // Find the chain for our load.completed event
      const chain = body.chains.find(
        (c) =>
          c.event?.type === 'load.completed' &&
          c.reactions.some((r) => r.action === 'draft_customer_invoice'),
      );
      expect(chain).toBeTruthy();

      // The reaction entry MUST be EXECUTED (the beforeAll setup enables Billing + service-account
      // to guarantee the draft_customer_invoice handler succeeds — not merely "EXECUTED or FAILED").
      const reaction = chain!.reactions.find((r) => r.action === 'draft_customer_invoice');
      expect(reaction).toBeTruthy();
      expect(reaction!.status).toBe('EXECUTED');

      // EXECUTED reactions count in the KPI — assert unconditionally.
      expect(body.reactionKpis.executed).toBeGreaterThanOrEqual(1);
    });

    it('B) map: edges contains at least one entry with kind = "reaction"', async () => {
      const res = await request(http)
        .get('/api/v1/analytics/flow/map?days=7')
        .set(auth())
        .expect(200);

      const body = res.body as {
        nodes: Array<{ module: string; eventCount: number }>;
        edges: Array<{ from: string; to: string; count: number; kind: string }>;
      };

      const reactionEdge = body.edges.find((e) => e.kind === 'reaction');
      expect(reactionEdge).toBeTruthy();
      // The reaction targets BILLING (draft_customer_invoice module).
      // from is the source event's module (load.completed → CORE, since 'load' prefix maps to CORE).
      expect(reactionEdge!.to).toBe('BILLING');
    });

    it('C) back-compat: a no-reaction tenant returns reactionKpis.executed===0 and no reaction edge', async () => {
      // Set up a second isolated tenant with ANALYTICS enabled but NO automation rules
      // and NO domain events — a genuine zero-reaction baseline.
      const zeroSlug = `fct-zero-${suffix}`;
      const zeroTenant = await prisma.tenant.create({
        data: { slug: zeroSlug, name: `FCT Zero ${suffix}`, status: 'ACTIVE' },
      });
      zeroTenantId = zeroTenant.id;

      // Enable ANALYTICS module for the zero tenant
      const analyticsMod = await prisma.moduleDefinition.findUniqueOrThrow({
        where: { key: 'analytics' },
      });
      await prisma.tenantModule.create({
        data: {
          tenantId: zeroTenantId,
          moduleId: analyticsMod.id,
          enabled: true,
          enabledAt: new Date(),
        },
      });

      // Create a role with analytics.read permission
      const analyticsReadPerm = await prisma.permission.findUniqueOrThrow({
        where: { key: 'analytics.read' },
      });
      const zeroRole = await prisma.role.create({
        data: {
          tenantId: zeroTenantId,
          key: 'admin',
          name: 'Admin',
          isSystem: true,
          permissions: { create: [{ permissionId: analyticsReadPerm.id }] },
        },
      });

      // Create an admin user for the zero tenant (active with password so we can log in)
      const { hashSync } = await import('bcryptjs');
      const zeroUser = await prisma.user.create({
        data: {
          tenantId: zeroTenantId,
          email: `fct-zero-admin-${suffix}@example.test`,
          passwordHash: hashSync('Zero$123', 10),
          firstName: 'Zero',
          lastName: 'Admin',
          status: 'ACTIVE',
          roles: { create: [{ roleId: zeroRole.id }] },
        },
      });
      void zeroUser;

      // Log in as the zero tenant admin
      const zeroLogin = await request(http)
        .post('/api/v1/auth/login')
        .send({
          email: `fct-zero-admin-${suffix}@example.test`,
          password: 'Zero$123',
          tenant: zeroSlug,
        })
        .expect(200);
      zeroToken = (zeroLogin.body as { accessToken: string }).accessToken;

      // GET /analytics/flow/timeline for the zero tenant — must have executed === 0
      const timelineRes = await request(http)
        .get('/api/v1/analytics/flow/timeline?days=7')
        .set({ Authorization: `Bearer ${zeroToken}` })
        .expect(200);

      const timelineBody = timelineRes.body as {
        chains: unknown[];
        reactionKpis: { executed: number; failed: number; byAction: unknown[] };
      };

      // The reactionKpis shape must always be present
      expect(typeof timelineBody.reactionKpis).toBe('object');
      expect(typeof timelineBody.reactionKpis.executed).toBe('number');
      expect(typeof timelineBody.reactionKpis.failed).toBe('number');
      expect(Array.isArray(timelineBody.reactionKpis.byAction)).toBe(true);
      // Zero reactions for this tenant
      expect(timelineBody.reactionKpis.executed).toBe(0);

      // GET /analytics/flow/map for the zero tenant — must have NO reaction edge
      const mapRes = await request(http)
        .get('/api/v1/analytics/flow/map?days=7')
        .set({ Authorization: `Bearer ${zeroToken}` })
        .expect(200);

      const mapBody = mapRes.body as {
        nodes: unknown[];
        edges: Array<{ from: string; to: string; count: number; kind?: string }>;
      };

      const reactionEdge = mapBody.edges.find((e) => e.kind === 'reaction');
      expect(reactionEdge).toBeUndefined();
    });
  });

  // =========================================================================
  // Scenario 5 — Gating (permission)
  // =========================================================================
  describe('Scenario 5 — permission gating', () => {
    it('returns 403 when the user does not have analytics.read', async () => {
      // Create a user with NO roles (therefore no permissions) via the invitation flow.
      // POST /api/v1/users accepts { email, firstName, lastName, roleIds? } — omit roleIds
      // for no permissions. The response includes inviteUrl for the reset-password flow.
      const email = `fct-noperm-${suffix}@example.test`;
      const inviteRes = await request(http)
        .post('/api/v1/users')
        .set(auth())
        .send({ email, firstName: 'No', lastName: 'Perm' })
        .expect(201);

      const inviteUrl = (inviteRes.body as { inviteUrl?: string }).inviteUrl ?? '';
      const inviteToken = inviteUrl.includes('/reset-password/')
        ? inviteUrl.split('/reset-password/')[1]
        : '';
      expect(inviteToken).not.toBe('');

      // Set a password via reset-password.
      await request(http)
        .post('/api/v1/auth/reset-password')
        .send({ token: inviteToken, password: 'NoPerm$123' })
        .expect(200);

      // Log in as that user.
      const noPermLogin = await request(http)
        .post('/api/v1/auth/login')
        .send({ email, password: 'NoPerm$123', tenant: 'acme' })
        .expect(200);

      const noPermToken = (noPermLogin.body as { accessToken: string }).accessToken;

      // Record userId for afterAll cleanup.
      const userRow = await prisma.user.findFirst({ where: { tenantId, email } });
      if (userRow) noPermUserId.push(userRow.id);

      await request(http)
        .get('/api/v1/analytics/flow/timeline?days=7')
        .set({ Authorization: `Bearer ${noPermToken}` })
        .expect(403);
    });
  });
});
