/**
 * E2E — Dispatch Exception Agent tools (Wave 4).
 *
 * Proves the two new READ agent tools wrap the existing detection/data without
 * reimplementing it:
 *   - list_dispatch_exceptions: reads OPEN OperationalTask rows with category
 *     DELAY / TENDER_FAILURE via OperationalTasksService.list (rule 27's
 *     policies already produce these categories from stop.delayed /
 *     tender.declined / tender.expired domain events).
 *   - check_load_capacity: reads a load's shipment totals vs. its trailer's
 *     limits via LoadsService.capacitySummary, reusing the same pure
 *     `checkCapacity` (@pulsar/shared) as assignResources (rule 18) — never a
 *     mutation.
 *
 * Also proves the retender decision: re-tendering a load (after a
 * TENDER_FAILURE) to a different carrier goes through the EXISTING
 * `tender_load` SENSITIVE tool (no redundant `retender_load` tool was added) —
 * it enqueues a ProposedAction rather than executing live, and is subject to
 * the agent's amount cap, exactly like a first tender.
 *
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

/** Same SSE/JSON envelope parser as phase11-agents.e2e-spec.ts. */
function parseMcp(res: request.Response): { result?: any; error?: any } {
  if (res.body && (res.body.result !== undefined || res.body.error !== undefined)) {
    return res.body;
  }
  const text: string = res.text ?? '';
  const dataLines = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  for (const line of dataLines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
    } catch {
      // not this line
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Could not parse MCP response. status=${res.status} body=${text.slice(0, 500)}`);
  }
}

describe('Dispatch Exception Agent tools (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let agentKey = '';
  let agentId = '';
  let mcpId = 0;
  let tenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const mcp = (method: string, params: unknown) =>
    request(http)
      .post('/api/v1/mcp')
      .set('X-Agent-Key', agentKey)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++mcpId, method, params });

  // Fixtures
  let customerId = '';
  let originId = '';
  let destId = '';
  let orderId = '';
  let trailerId = '';
  let carrierId = '';
  let loadId = ''; // over-capacity load (no tender)
  let plannedLoadId = ''; // PLANNED load used for the tender_load / retender proof
  const shipmentIds: string[] = [];
  const plannedShipmentIds: string[] = [];
  const dispatchTaskIds: string[] = [];
  const createdLoadIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // --- Ensure TRANSPORTATION is enabled. ---------------------------------
    const tmsModule = await prisma.moduleDefinition.findUniqueOrThrow({
      where: { key: 'transportation' },
    });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: tmsModule.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: tmsModule.id, enabled: true, enabledAt: new Date() },
    });

    // --- Base fixtures: customer, locations, order, carrier, trailer. ------
    const customer = await prisma.customer.create({
      data: { tenantId, code: `DEA-CUST-${suffix}`, name: `DEA Customer ${suffix}` },
    });
    customerId = customer.id;

    const origin = await prisma.location.create({
      data: {
        tenantId,
        code: `DEA-ORIG-${suffix}`,
        name: `DEA Origin ${suffix}`,
        addressLine1: '1 Origin St',
        city: 'Montreal',
        country: 'CA',
      },
    });
    originId = origin.id;

    const dest = await prisma.location.create({
      data: {
        tenantId,
        code: `DEA-DEST-${suffix}`,
        name: `DEA Dest ${suffix}`,
        addressLine1: '2 Dest Ave',
        city: 'Toronto',
        country: 'CA',
      },
    });
    destId = dest.id;

    const order = await prisma.transportOrder.create({
      data: {
        tenantId,
        orderNumber: `TO-DEA-${suffix}`,
        customerId,
        originLocationId: originId,
        destinationLocationId: destId,
      },
    });
    orderId = order.id;

    const carrier = await prisma.carrier.create({
      data: { tenantId, code: `DEA-CARR-${suffix}`, name: `DEA Carrier ${suffix}`, email: 'carrier@example.com' },
    });
    carrierId = carrier.id;

    // Small trailer: 1000 kg / 10 m3 / 4 pallets — shipments below will exceed it.
    const trailer = await prisma.trailer.create({
      data: {
        tenantId,
        unitNumber: `DEA-TRL-${suffix}`,
        capacityWeightKg: 1000,
        capacityVolumeM3: 10,
        capacityPallets: 4,
      },
    });
    trailerId = trailer.id;

    // --- Load A: over-capacity (2 shipments totalling 1500 kg / 6 pallets). --
    const load = await prisma.load.create({
      data: { tenantId, loadNumber: `LD-DEA-A-${suffix}`, trailerId },
    });
    loadId = load.id;
    createdLoadIds.push(loadId);

    for (const [label, weightKg, palletCount] of [
      ['1', 900, 3],
      ['2', 600, 3],
    ] as const) {
      const sh = await prisma.shipment.create({
        data: {
          tenantId,
          shipmentNumber: `SH-DEA-${label}-${suffix}`,
          transportOrderId: orderId,
          originLocationId: originId,
          destinationLocationId: destId,
          status: 'PLANNED',
          loadId,
          weightKg,
          palletCount,
        },
      });
      shipmentIds.push(sh.id);
    }

    // --- Load B: PLANNED, no trailer yet — used to prove tender_load covers retender. --
    const plannedLoad = await prisma.load.create({
      data: { tenantId, loadNumber: `LD-DEA-B-${suffix}`, status: 'PLANNED' },
    });
    plannedLoadId = plannedLoad.id;
    createdLoadIds.push(plannedLoadId);
    const shB = await prisma.shipment.create({
      data: {
        tenantId,
        shipmentNumber: `SH-DEA-B-${suffix}`,
        transportOrderId: orderId,
        originLocationId: originId,
        destinationLocationId: destId,
        status: 'PLANNED',
        loadId: plannedLoadId,
        weightKg: 100,
      },
    });
    plannedShipmentIds.push(shB.id);

    // --- Two OPEN dispatch-exception tasks: DELAY + TENDER_FAILURE. --------
    // Inserted directly — the detection pipeline (delay-detection / tender-expiry)
    // producing these exact categories is already covered by its own e2e suites
    // (phase12-operating-workbench, tender-offer-snapshot); this test only proves
    // the new agent tool reads them correctly.
    const delayTask = await prisma.operationalTask.create({
      data: {
        tenantId,
        type: 'EXCEPTION',
        category: 'DELAY',
        status: 'OPEN',
        title: `Stop late (test ${suffix})`,
        subjectType: 'stop',
        subjectId: `stop-dea-${suffix}`,
        dedupKey: `DELAY:stop-dea-${suffix}:test`,
        details: { loadId, minutesLate: 45 },
      },
    });
    dispatchTaskIds.push(delayTask.id);

    const tenderFailureTask = await prisma.operationalTask.create({
      data: {
        tenantId,
        type: 'EXCEPTION',
        category: 'TENDER_FAILURE',
        status: 'OPEN',
        title: `Tender expired on load (test ${suffix})`,
        subjectType: 'load',
        subjectId: plannedLoadId,
        dedupKey: `TENDER_FAILURE:tender-dea-${suffix}`,
        details: { loadId: plannedLoadId, reason: 'expired' },
      },
    });
    dispatchTaskIds.push(tenderFailureTask.id);

    // --- Agent with planning permissions + a low amount cap (for the cap proof). --
    const agentRes = await request(http)
      .post('/api/v1/agents')
      .set(auth())
      .send({
        name: `dispatch-exception-bot-${suffix}`,
        permissions: [
          'transportation.orders.read',
          'transportation.planning.read',
          'transportation.planning.manage',
        ],
        caps: { maxAmountPerAction: 1500 },
      })
      .expect(201);
    agentKey = agentRes.body.key;
    agentId = agentRes.body.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (agentId) {
        await prisma.proposedAction.deleteMany({ where: { agentId } }).catch(() => undefined);
        await prisma.agent.deleteMany({ where: { id: agentId } }).catch(() => undefined);
      }
      await prisma.operationalTask
        .deleteMany({ where: { id: { in: dispatchTaskIds } } })
        .catch(() => undefined);
      await prisma.shipmentLoadLeg
        .deleteMany({ where: { shipmentId: { in: [...shipmentIds, ...plannedShipmentIds] } } })
        .catch(() => undefined);
      await prisma.shipment
        .deleteMany({ where: { id: { in: [...shipmentIds, ...plannedShipmentIds] } } })
        .catch(() => undefined);
      await prisma.tender.deleteMany({ where: { loadId: { in: createdLoadIds } } }).catch(() => undefined);
      await prisma.load.deleteMany({ where: { id: { in: createdLoadIds } } }).catch(() => undefined);
      await prisma.trailer.deleteMany({ where: { id: trailerId } }).catch(() => undefined);
      await prisma.carrier.deleteMany({ where: { id: carrierId } }).catch(() => undefined);
      await prisma.transportOrder.deleteMany({ where: { id: orderId } }).catch(() => undefined);
      await prisma.location.deleteMany({ where: { id: { in: [originId, destId] } } }).catch(() => undefined);
      await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    }
    await app.close();
  });

  it('exposes the new READ tools in the scoped tool surface', async () => {
    const res = await mcp('tools/list', {}).expect(200);
    const envelope = parseMcp(res);
    const names: string[] = (envelope.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['list_dispatch_exceptions', 'check_load_capacity', 'tender_load']),
    );
  });

  it('list_dispatch_exceptions executes live and returns the seeded DELAY + TENDER_FAILURE tasks', async () => {
    const res = await mcp('tools/call', { name: 'list_dispatch_exceptions', arguments: {} }).expect(200);
    const envelope = parseMcp(res);
    const payload = JSON.parse(envelope.result.content[0].text);

    const delayItems = payload.delays?.items ?? [];
    const tenderItems = payload.tenderFailures?.items ?? [];
    expect(delayItems.some((t: { id: string }) => dispatchTaskIds.includes(t.id))).toBe(true);
    expect(tenderItems.some((t: { id: string }) => dispatchTaskIds.includes(t.id))).toBe(true);
  });

  it('check_load_capacity executes live and flags the over-capacity load', async () => {
    const res = await mcp('tools/call', {
      name: 'check_load_capacity',
      arguments: { loadId },
    }).expect(200);
    const envelope = parseMcp(res);
    const payload = JSON.parse(envelope.result.content[0].text);

    expect(payload.loadId).toBe(loadId);
    expect(payload.overCapacity).toBe(true);
    expect(payload.trailer.id).toBe(trailerId);
    const weightAxis = payload.axes.find((a: { axis: string }) => a.axis === 'weightKg');
    expect(weightAxis.capacity).toBe(1000);
    expect(weightAxis.requested).toBe(1500);
    expect(weightAxis.utilizationPct).toBeGreaterThan(100);
  });

  it('retender via tender_load enqueues a ProposedAction instead of executing live (covers re-tender — no separate tool needed)', async () => {
    const before = await prisma.proposedAction.count();
    const loadsBefore = await prisma.load.findUnique({ where: { id: plannedLoadId } });
    expect(loadsBefore?.status).toBe('PLANNED');

    const res = await mcp('tools/call', {
      name: 'tender_load',
      arguments: { loadId: plannedLoadId, carrierId, amount: 500 },
    }).expect(200);
    const envelope = parseMcp(res);
    const payload = JSON.parse(envelope.result.content[0].text);

    expect(payload.queued).toBe(true);
    expect(payload.status).toBe('PENDING');
    expect(await prisma.proposedAction.count()).toBe(before + 1);

    // Not executed: the load must still be PLANNED (SENSITIVE tools never run in the handler).
    const loadAfter = await prisma.load.findUnique({ where: { id: plannedLoadId } });
    expect(loadAfter?.status).toBe('PLANNED');
  });

  it('retender via tender_load is still subject to the agent amount cap', async () => {
    const res = await mcp('tools/call', {
      name: 'tender_load',
      arguments: { loadId: plannedLoadId, carrierId, amount: 5000 },
    }).expect(200);
    const envelope = parseMcp(res);
    const text = JSON.stringify(envelope.result ?? envelope.error);
    expect(text).toContain('exceeds the agent cap of 1500');
  });
});
