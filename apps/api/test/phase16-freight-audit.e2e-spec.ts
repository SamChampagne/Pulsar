/**
 * E2E phase 16 — Freight audit (buy-side carrier-invoice reconciliation), end to end.
 *
 * Proves the full lifecycle of an incoming carrier invoice through the governed
 * endpoints, plus the agent path (event → task → governed dispute), over real
 * Postgres with the admin Bearer token:
 *
 *   1. Audit → FLAGGED           overcharged line flags the invoice; the matched
 *                                line carries matchedLoadId / expectedAmount /
 *                                variance and the invoice carries varianceTotal.
 *   2. Dispute → resolve         KEEP_EXPECTED books recoveredAmount == variance;
 *      KEEP_EXPECTED → savings    GET /freight-audit/savings reflects it.
 *   3. Within tolerance → PAID   charged == expected ⇒ MATCHED ⇒ PAID.
 *   4. Unmatched line → FLAGGED  a lineRef matching no load flags the invoice.
 *   5. Rule 16 (cost frozen)     auditing never mutates Load.estimatedCost.
 *   6. Agent path                always-on FREIGHT_AUDIT agent: intake emits the
 *                                domain event → policy → task assigned to the
 *                                agent; the agent runs audit_carrier_invoice (READ,
 *                                live) and dispute_carrier_invoice (SENSITIVE →
 *                                ProposedAction PENDING, triggeredByRef task:<id>).
 *   7. Isolation                 a line referencing a load owned by a DIFFERENT
 *                                carrier is unmatched (carrier-scoped match).
 *
 * The fake Hermes harness (FakeAgentRuntimeService + bootstrap + parseMcp + waitFor)
 * is copied from phase14-autonomy.e2e-spec.ts. This suite drives the governed
 * /api/v1/mcp endpoint DIRECTLY (synchronous, deterministic) for the agent
 * scenario, exactly like phase 14/15; the runtime override only keeps the app
 * bootable without a real Hermes process.
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
import { DomainEventsService } from '../src/core/operating/domain-events.service';
import { drainInheritedDomainEvents } from './utils/domain-events';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

/** Permissions for a freight-audit agent (read + manage). */
const AUDIT_PERMS = ['billing.freight-audit.read', 'billing.freight-audit.manage'];

// ---------------------------------------------------------------------------
// FakeAgentRuntimeService — minimal stub. This suite drives /api/v1/mcp
// directly (synchronous), so the runtime is never used to open a session; the
// override only keeps the app bootable without a real Hermes process.
// ---------------------------------------------------------------------------
@Injectable()
class FakeAgentRuntimeService {
  constructor(private readonly _agents: AgentsService) {}
  async openSession(): Promise<string> {
    return 'fake-session';
  }
  async *sendTurn(): AsyncGenerator<never> {
    /* no turns driven in this suite */
  }
  async closeSession(): Promise<void> {
    /* no-op */
  }
  async killAgentSessions(): Promise<void> {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Helpers (parseMcp / decodeToolPayload copied from phase-14)
// ---------------------------------------------------------------------------

function parseMcp(res: request.Response): { result?: unknown; error?: unknown } {
  if (res.body && (res.body.result !== undefined || res.body.error !== undefined)) {
    return res.body as { result?: unknown; error?: unknown };
  }
  const text: string = res.text ?? '';
  const dataLines = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  for (const line of dataLines) {
    try {
      const parsed = JSON.parse(line) as { result?: unknown; error?: unknown };
      if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
    } catch {
      /* not this line */
    }
  }
  try {
    return JSON.parse(text) as { result?: unknown; error?: unknown };
  } catch {
    throw new Error(
      `Could not parse MCP response. status=${res.status} body=${text.slice(0, 500)}`,
    );
  }
}

interface McpToolResult {
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function decodeToolPayload(result: McpToolResult): Record<string, unknown> | null {
  const text = result.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Phase 16 — Freight audit (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let agents: AgentsService;
  let domainEvents: DomainEventsService;
  let token = '';
  let tenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Seeded fixtures (cleaned up in afterAll).
  let carrierId = '';
  let otherCarrierId = '';
  let loadAId = '';
  let loadBId = '';
  let otherLoadId = '';
  const loadANumber = `LD-A-${suffix}`;
  const loadBNumber = `LD-B-${suffix}`;
  const otherLoadNumber = `LD-X-${suffix}`;
  const invoiceIds: string[] = [];
  const registeredAgentIds: string[] = [];

  /** Drive a REAL governed tools/call synchronously via /api/v1/mcp. */
  async function callTool(
    agentId: string,
    name: string,
    args: Record<string, unknown>,
    triggeredByRef?: string,
  ): Promise<{ payload: Record<string, unknown> | null; isError: boolean }> {
    const agentKey = agents.mintSessionToken(agentId, 300, triggeredByRef);
    const res = await request(http)
      .post('/api/v1/mcp')
      .set('X-Agent-Key', agentKey)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const envelope = parseMcp(res) as { result?: McpToolResult; error?: unknown };
    const toolResult = envelope.result ?? {};
    return { payload: decodeToolPayload(toolResult), isError: toolResult.isError === true };
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
    void (http.address() as net.AddressInfo).port;

    prisma = app.get(PrismaService);
    agents = app.get(AgentsService);
    domainEvents = app.get(DomainEventsService);
    await drainInheritedDomainEvents(domainEvents);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // --- Ensure BILLING is enabled for acme. -------------------------------
    const billingModule = await prisma.moduleDefinition.findUniqueOrThrow({
      where: { key: 'billing' },
    });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: billingModule.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: billingModule.id, enabled: true, enabledAt: new Date() },
    });

    // --- Seed the carrier under test + a second carrier (isolation). -------
    const carrier = await prisma.carrier.create({
      data: { tenantId, code: `FA-CARR-${suffix}`, name: `Freight Audit Carrier ${suffix}` },
    });
    carrierId = carrier.id;
    const otherCarrier = await prisma.carrier.create({
      data: { tenantId, code: `FA-OTHER-${suffix}`, name: `Other Carrier ${suffix}` },
    });
    otherCarrierId = otherCarrier.id;

    // --- Seed two COMPLETED loads for the carrier (frozen estimatedCost). --
    const loadA = await prisma.load.create({
      data: {
        tenantId,
        loadNumber: loadANumber,
        status: 'COMPLETED',
        carrierId,
        estimatedCost: 100,
        costCurrency: 'CAD',
      },
    });
    loadAId = loadA.id;
    const loadB = await prisma.load.create({
      data: {
        tenantId,
        loadNumber: loadBNumber,
        status: 'COMPLETED',
        carrierId,
        estimatedCost: 400,
        costCurrency: 'CAD',
      },
    });
    loadBId = loadB.id;

    // --- Seed a load owned by the OTHER carrier (isolation scenario). ------
    const otherLoad = await prisma.load.create({
      data: {
        tenantId,
        loadNumber: otherLoadNumber,
        status: 'COMPLETED',
        carrierId: otherCarrierId,
        estimatedCost: 200,
        costCurrency: 'CAD',
      },
    });
    otherLoadId = otherLoad.id;
  });

  afterAll(async () => {
    if (prisma) {
      // Agent-owned rows first.
      if (registeredAgentIds.length > 0) {
        await prisma.proposedAction
          .deleteMany({ where: { agentId: { in: registeredAgentIds } } })
          .catch(() => undefined);
        await prisma.agentRun
          .deleteMany({ where: { agentId: { in: registeredAgentIds } } })
          .catch(() => undefined);
        await prisma.operationalTask
          .deleteMany({ where: { tenantId, category: 'FREIGHT_AUDIT' } })
          .catch(() => undefined);
        const agentRows = await prisma.agent
          .findMany({ where: { id: { in: registeredAgentIds } }, select: { serviceUserId: true } })
          .catch(() => [] as { serviceUserId: string | null }[]);
        await prisma.agent
          .deleteMany({ where: { id: { in: registeredAgentIds } } })
          .catch(() => undefined);
        const serviceUserIds = agentRows
          .map((a) => a.serviceUserId)
          .filter((id): id is string => !!id);
        if (serviceUserIds.length > 0) {
          await prisma.user
            .deleteMany({ where: { id: { in: serviceUserIds } } })
            .catch(() => undefined);
        }
      }

      // Invoices + lines (lines cascade on invoice delete).
      if (invoiceIds.length > 0) {
        await prisma.incomingCarrierInvoice
          .deleteMany({ where: { id: { in: invoiceIds } } })
          .catch(() => undefined);
      }
      // Any domain events emitted for the seeded invoices.
      await prisma.domainEvent
        .deleteMany({ where: { tenantId, type: 'carrier-invoice.received' } })
        .catch(() => undefined);

      // Loads + carriers.
      await prisma.load
        .deleteMany({ where: { id: { in: [loadAId, loadBId, otherLoadId] } } })
        .catch(() => undefined);
      await prisma.carrier
        .deleteMany({ where: { id: { in: [carrierId, otherCarrierId] } } })
        .catch(() => undefined);
    }
    await app.close();
  });

  /** Intake an invoice through the governed endpoint; track for cleanup. */
  async function intake(lines: Array<{ lineRef: string; chargedAmount: number }>, label: string) {
    const res = await request(http)
      .post('/api/v1/freight-audit/incoming-invoices')
      .set(auth())
      .send({
        carrierId,
        carrierInvoiceNumber: `INV-${label}-${suffix}`,
        lines,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    invoiceIds.push(id);
    return id;
  }

  // =========================================================================
  // Scenario 1 — Audit → FLAGGED (overcharged line)
  // =========================================================================
  describe('Scenario 1 — audit flags an overcharged invoice', () => {
    let invoiceId = '';

    it('S1.1: intake an invoice (LD-A ok, LD-B overcharged)', async () => {
      invoiceId = await intake(
        [
          { lineRef: loadANumber, chargedAmount: 100 },
          { lineRef: loadBNumber, chargedAmount: 500 },
        ],
        's1',
      );
      expect(invoiceId).toBeTruthy();
    });

    it('S1.2: POST :id/audit → FLAGGED; LD-B line matched w/ expected 400, variance 100; varianceTotal 100', async () => {
      const res = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId}/audit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      expect((res.body as { status: string }).status).toBe('FLAGGED');

      const get = await request(http)
        .get(`/api/v1/freight-audit/incoming-invoices/${invoiceId}`)
        .set(auth())
        .expect(200);

      const body = get.body as {
        status: string;
        varianceTotal: string | number;
        lines: Array<{
          lineRef: string;
          matchedLoadId: string | null;
          expectedAmount: string | number | null;
          variance: string | number | null;
        }>;
      };
      expect(body.status).toBe('FLAGGED');
      expect(Number(body.varianceTotal)).toBe(100);

      const lineB = body.lines.find((l) => l.lineRef === loadBNumber);
      expect(lineB).toBeDefined();
      expect(lineB!.matchedLoadId).toBe(loadBId);
      expect(Number(lineB!.expectedAmount)).toBe(400);
      expect(Number(lineB!.variance)).toBe(100);

      // The in-tolerance line still matched (expected 100, variance 0).
      const lineA = body.lines.find((l) => l.lineRef === loadANumber);
      expect(lineA!.matchedLoadId).toBe(loadAId);
      expect(Number(lineA!.variance)).toBe(0);
    });
  });

  // =========================================================================
  // Scenario 2 — Dispute → resolve KEEP_EXPECTED → savings
  // =========================================================================
  describe('Scenario 2 — dispute / resolve KEEP_EXPECTED books savings', () => {
    let invoiceId = '';

    it('S2.1: intake + audit a fresh overcharged invoice (FLAGGED, varianceTotal 100)', async () => {
      invoiceId = await intake(
        [
          { lineRef: loadANumber, chargedAmount: 100 },
          { lineRef: loadBNumber, chargedAmount: 500 },
        ],
        's2',
      );
      const res = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId}/audit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('FLAGGED');
    });

    it('S2.2: POST :id/dispute → DISPUTED', async () => {
      const res = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId}/dispute`)
        .set(auth())
        .send({ reasonCode: 'RATE_MISMATCH' })
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('DISPUTED');
    });

    it('S2.3: POST :id/resolve KEEP_EXPECTED → RESOLVED, recoveredAmount == 100', async () => {
      const res = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId}/resolve`)
        .set(auth())
        .send({ resolution: 'KEEP_EXPECTED', reasonCode: 'RATE_MISMATCH' })
        .expect((r) => expect([200, 201]).toContain(r.status));
      const body = res.body as { status: string; recoveredAmount: string | number };
      expect(body.status).toBe('RESOLVED');
      expect(Number(body.recoveredAmount)).toBe(100);
    });

    it('S2.4: GET /freight-audit/savings → tenantTotal >= 100', async () => {
      const res = await request(http).get('/api/v1/freight-audit/savings').set(auth()).expect(200);
      const body = res.body as { tenantTotal: number; byAgent: unknown[] };
      expect(Number(body.tenantTotal)).toBeGreaterThanOrEqual(100);
    });
  });

  // =========================================================================
  // Scenario 3 — Within tolerance → MATCHED → PAID
  // =========================================================================
  describe('Scenario 3 — within tolerance → MATCHED → PAID', () => {
    let invoiceId = '';

    it('S3.1: intake an invoice where both lines charge exactly the expected cost', async () => {
      invoiceId = await intake(
        [
          { lineRef: loadANumber, chargedAmount: 100 },
          { lineRef: loadBNumber, chargedAmount: 400 },
        ],
        's3',
      );
      expect(invoiceId).toBeTruthy();
    });

    it('S3.2: audit → MATCHED', async () => {
      const res = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId}/audit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('MATCHED');
    });

    it('S3.3: POST :id/pay → PAID', async () => {
      const res = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId}/pay`)
        .set(auth())
        .send({})
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('PAID');
    });
  });

  // =========================================================================
  // Scenario 4 — Unmatched line → FLAGGED
  // =========================================================================
  describe('Scenario 4 — unmatched line flags the invoice', () => {
    it('S4.1: an invoice with an unknown lineRef audits to FLAGGED', async () => {
      const invoiceId = await intake(
        [
          { lineRef: loadANumber, chargedAmount: 100 },
          { lineRef: `NOPE-${suffix}`, chargedAmount: 50 },
        ],
        's4',
      );
      const res = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId}/audit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('FLAGGED');

      const get = await request(http)
        .get(`/api/v1/freight-audit/incoming-invoices/${invoiceId}`)
        .set(auth())
        .expect(200);
      const lines = (
        get.body as { lines: Array<{ lineRef: string; matchedLoadId: string | null }> }
      ).lines;
      const nope = lines.find((l) => l.lineRef === `NOPE-${suffix}`);
      expect(nope).toBeDefined();
      expect(nope!.matchedLoadId).toBeNull();
    });
  });

  // =========================================================================
  // Scenario 5 — Rule 16: Load.estimatedCost is frozen across an audit
  // =========================================================================
  describe('Scenario 5 — rule 16: auditing never mutates Load.estimatedCost', () => {
    it('S5.1: LD-B estimatedCost is unchanged after auditing an invoice that references it', async () => {
      const before = await prisma.load.findUniqueOrThrow({
        where: { id: loadBId },
        select: { estimatedCost: true },
      });

      const invoiceId = await intake([{ lineRef: loadBNumber, chargedAmount: 999 }], 's5');
      await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId}/audit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      const after = await prisma.load.findUniqueOrThrow({
        where: { id: loadBId },
        select: { estimatedCost: true },
      });
      expect(Number(after.estimatedCost)).toBe(Number(before.estimatedCost));
      expect(Number(after.estimatedCost)).toBe(400);
    });
  });

  // =========================================================================
  // Scenario 6 — Agent path: event → task → governed dispute via the gate
  // =========================================================================
  describe('Scenario 6 — always-on FREIGHT_AUDIT agent audits + disputes via the gate', () => {
    let agentId = '';
    let invoiceId = '';
    let taskId = '';

    it('S6.1: register an always-on PROPOSE agent handling FREIGHT_AUDIT', async () => {
      const res = await request(http)
        .post('/api/v1/agents')
        .set(auth())
        .send({
          name: `p16-audit-agent-${suffix}`,
          persona: 'Freight-audit agent for phase-16 e2e.',
          role: 'dispatcher',
          model: 'anthropic:claude-sonnet-4-6',
          autonomyLevel: 'PROPOSE',
          permissions: AUDIT_PERMS,
          caps: { alwaysOn: true, handlesCategories: ['FREIGHT_AUDIT'] },
        })
        .expect(201);
      agentId = (res.body as { id: string }).id;
      registeredAgentIds.push(agentId);
      expect(agentId).toBeTruthy();
    });

    it('S6.2: intake emits carrier-invoice.received → processPending → task assigned to the agent', async () => {
      invoiceId = await intake(
        [
          { lineRef: loadANumber, chargedAmount: 100 },
          { lineRef: loadBNumber, chargedAmount: 500 },
        ],
        's6',
      );

      const processed = await domainEvents.processPending(50);
      expect(processed).toBeGreaterThanOrEqual(1);

      const task = await prisma.operationalTask.findFirst({
        where: { tenantId, category: 'FREIGHT_AUDIT', subjectId: invoiceId },
      });
      expect(task).toBeDefined();
      expect(task!.assigneeType).toBe('AGENT');
      expect(task!.assigneeAgentId).toBe(agentId);
      taskId = task!.id;
    });

    it('S6.3: agent runs audit_carrier_invoice (READ, live) → FLAGGED', async () => {
      const { payload, isError } = await callTool(
        agentId,
        'audit_carrier_invoice',
        { invoiceId },
        `task:${taskId}`,
      );
      expect(isError).toBe(false);
      expect(payload).toBeTruthy();
      expect(payload!.status).toBe('FLAGGED');

      // Confirm the durable state.
      const inv = await prisma.incomingCarrierInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true },
      });
      expect(inv.status).toBe('FLAGGED');
    });

    it('S6.4: agent runs dispute_carrier_invoice (SENSITIVE) → queued PENDING ProposedAction with triggeredByRef', async () => {
      const { payload, isError } = await callTool(
        agentId,
        'dispute_carrier_invoice',
        { invoiceId, reasonCode: 'RATE_MISMATCH', amount: 100 },
        `task:${taskId}`,
      );
      expect(isError).toBe(false);
      expect(payload).toBeTruthy();
      expect(payload!.queued).toBe(true);
      expect(payload!.status).toBe('PENDING');

      const action = await prisma.proposedAction.findFirst({
        where: {
          tenantId,
          agentId,
          tool: 'dispute_carrier_invoice',
          status: 'PENDING',
          triggeredByRef: `task:${taskId}`,
        },
        orderBy: { proposedAt: 'desc' },
      });
      expect(action).toBeDefined();
      expect(action!.status).toBe('PENDING');
      expect(action!.riskTier).toBe('SENSITIVE');
      expect(action!.triggeredByRef).toBe(`task:${taskId}`);

      // SENSITIVE path: the dispute did NOT run (invoice still FLAGGED, not DISPUTED).
      const inv = await prisma.incomingCarrierInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true },
      });
      expect(inv.status).toBe('FLAGGED');
    });
  });

  // =========================================================================
  // Scenario 7 — Isolation: a load owned by a DIFFERENT carrier is unmatched
  // =========================================================================
  describe('Scenario 7 — carrier-scoped match (isolation)', () => {
    it('S7.1: a line referencing another carrier’s load is unmatched → FLAGGED', async () => {
      const invoiceId = await intake(
        [
          { lineRef: loadANumber, chargedAmount: 100 },
          { lineRef: otherLoadNumber, chargedAmount: 200 },
        ],
        's7',
      );
      const res = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId}/audit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('FLAGGED');

      const get = await request(http)
        .get(`/api/v1/freight-audit/incoming-invoices/${invoiceId}`)
        .set(auth())
        .expect(200);
      const lines = (
        get.body as { lines: Array<{ lineRef: string; matchedLoadId: string | null }> }
      ).lines;
      const other = lines.find((l) => l.lineRef === otherLoadNumber);
      expect(other).toBeDefined();
      // Even though otherLoadNumber IS a real COMPLETED load with a cost, it
      // belongs to a different carrier → carrier-scoped match leaves it unmatched.
      expect(other!.matchedLoadId).toBeNull();
    });
  });
});
