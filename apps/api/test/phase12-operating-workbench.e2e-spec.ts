/**
 * E2E phase 12 — Operating Workbench vertical slice.
 *
 * Proves the full path: business event → domain event → event policy →
 * OperationalTask → (human resolves  OR  always-on agent is woken by the
 * headless runner and proposes an action through governance) → audit.
 *
 * Two scenarios:
 *
 * Scenario A — human path (no always-on agent registered):
 *   1. Emit a stop.delayed domain event.
 *   2. processPending → creates an UNASSIGNED OPEN task.
 *   3. Human resolves the task.
 *   4. Idempotency: emitting the same stop.delayed again creates no duplicate.
 *
 * Scenario B — agent path (fake Hermes):
 *   1. Register an always-on agent that handles 'DELAY'.
 *   2. Emit a fresh stop.delayed → processPending → task auto-assigned to agent.
 *   3. AgentWorkerService.tick() marks the task IN_PROGRESS, opens a Hermes
 *      session (fake), sends a turn (fake performs a real governed /mcp
 *      tools/call with a PROPOSE-autonomy agent → enqueues a ProposedAction).
 *   4. ProposedAction has triggeredByRef = 'task:<taskId>'.
 *   5. GET /operational-tasks/:id exposes the proposed-action link.
 *
 * The fake Hermes harness is copied EXACTLY from phase11b-agents-employes.e2e-spec.ts:
 * AgentRuntimeService is replaced by FakeAgentRuntimeService, which drives a
 * real HermesAcpClient over an in-process FakeAcpServer, mints a REAL session
 * token via AgentsService.mintSessionToken, and makes a REAL HTTP tools/call to
 * /api/v1/mcp on the booted app (so palier-1 governance is exercised end-to-end).
 *
 * Prerequisites: reachable PostgreSQL with the seed applied.
 * Cannot run without a DB — compile-only in CI unless a seeded DB is present.
 */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as net from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentsService } from '../src/core/agents/agents.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { HermesAcpClient, type AcpEvent } from '../src/core/agents/hermes-acp.client';
import { DomainEventsService } from '../src/core/operating/domain-events.service';
import { AgentWorkerService } from '../src/core/operating/agent-worker.service';
import { FakeAcpServer } from './support/fake-acp-server';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

/** Permissions sufficient for a read + propose workbench agent. */
const WORKBENCH_PERMS = [
  'transportation.orders.read',
  'transportation.planning.read',
  'transportation.planning.manage',
];

/**
 * What the fake agent should do on its one Hermes turn.
 * The mcpCall is executed as a REAL governed tools/call against /api/v1/mcp.
 */
interface TurnScript {
  assistantText: string;
  mcpCall: { name: string; arguments: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// FakeAgentRuntimeService — identical mechanism to phase11b.
// openSession: mints a REAL session token, drives a real HermesAcpClient over
//   an in-process FakeAcpServer.
// sendTurn: performs the REAL governed /mcp tools/call, then scripted ACP events.
// ---------------------------------------------------------------------------
@Injectable()
class FakeAgentRuntimeService {
  /** Wired by the test after app.init() so sendTurn can call /api/v1/mcp. */
  http: ReturnType<INestApplication['getHttpServer']> | null = null;

  /** sessionId → recorded open-session info (asserted by tests). */
  readonly recorded = new Map<
    string,
    {
      model: string | null;
      agentKey: string | undefined;
      pulsarMcpUrl: string;
      triggeredByRef: string | undefined;
      script: TurnScript;
    }
  >();

  /** sessionId → live fake-ACP client pair. */
  private readonly clients = new Map<string, { client: HermesAcpClient; fake: FakeAcpServer }>();

  /** agentId → the script to run on the next session for that agent. */
  private readonly scripts = new Map<string, TurnScript>();

  constructor(private readonly agents: AgentsService) {}

  setScript(agentId: string, script: TurnScript): void {
    this.scripts.set(agentId, script);
  }

  async openSession(input: {
    tenantId: string;
    agent: { id: string; model: string | null; persona: string | null };
    pulsarMcpUrl: string;
    triggeredByRef?: string;
  }): Promise<string> {
    // REAL token mint — must validate against /mcp (palier 1 AgentPrincipal).
    // Pass triggeredByRef so the session token carries it; the MCP layer reads
    // it from the principal and stamps ProposedAction.triggeredByRef.
    const token = this.agents.mintSessionToken(input.agent.id, 300, input.triggeredByRef);

    const fake = new FakeAcpServer();
    const client = new HermesAcpClient(fake.clientTransport);
    await client.initialize();
    const { sessionId } = await client.newSession({
      cwd: process.cwd(),
      mcpServers: [
        {
          name: 'pulsar',
          url: input.pulsarMcpUrl,
          headers: [{ name: 'X-Agent-Key', value: token }],
        },
      ],
    });
    if (input.agent.model) {
      await client.setModel(sessionId, input.agent.model).catch(() => undefined);
    }

    // Extract the X-Agent-Key that was passed to the fake Hermes session/new.
    const mcpServers = (fake.lastNewSession?.mcpServers ?? []) as Array<{
      headers?: { name: string; value: string }[];
    }>;
    const agentKey = mcpServers[0]?.headers?.find((h) => h.name === 'X-Agent-Key')?.value;

    const script = this.scripts.get(input.agent.id) ?? {
      assistantText: 'OK',
      mcpCall: { name: 'create_load', arguments: { notes: 'fallback' } },
    };

    this.recorded.set(sessionId, {
      model: fake.lastModel,
      agentKey,
      pulsarMcpUrl: input.pulsarMcpUrl,
      triggeredByRef: input.triggeredByRef,
      script,
    });
    this.clients.set(sessionId, { client, fake });
    return sessionId;
  }

  /**
   * Drive one turn: first make the REAL governed /mcp tools/call, then script
   * the FakeAcpServer to emit a tool_call + assistant text.
   * Mirrors phase11b FakeAgentRuntimeService.sendTurn exactly.
   */
  async *sendTurn(sessionId: string, _text: string): AsyncGenerator<AcpEvent> {
    const rec = this.recorded.get(sessionId);
    const live = this.clients.get(sessionId);
    if (!rec || !live) throw new Error('Conversation session not live');
    if (!this.http) throw new Error('FakeAgentRuntimeService.http not wired');

    // Real governed tools/call — the load-bearing assertion target.
    const mcpRes = await request(this.http)
      .post('/api/v1/mcp')
      .set('X-Agent-Key', rec.agentKey ?? '')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: rec.script.mcpCall.name, arguments: rec.script.mcpCall.arguments },
      });

    (rec as { mcpEnvelope?: unknown }).mcpEnvelope = parseMcp(mcpRes);

    // Script the ACP side so the turn yields tool_call + end events.
    live.fake.script = {
      assistantText: rec.script.assistantText,
      toolCall: { name: rec.script.mcpCall.name, args: rec.script.mcpCall.arguments },
    };
    yield* live.client.prompt(sessionId, _text);
  }

  async closeSession(sessionId: string): Promise<void> {
    const live = this.clients.get(sessionId);
    if (!live) return;
    this.clients.delete(sessionId);
    this.recorded.delete(sessionId);
    live.fake.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers (same as phase11-agents.e2e-spec.ts / phase11b)
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Phase 12 — Operating Workbench (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let domainEvents: DomainEventsService;
  let runner: AgentWorkerService;
  let fakeRuntime: FakeAgentRuntimeService;
  let token = '';
  let tenantId = '';
  let mcpUrl = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

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

    // Listen on a random port so AgentWorkerService.tick() gets a real URL.
    await app.listen(0);
    http = app.getHttpServer();

    // Resolve the ephemeral port so we can build the MCP URL.
    const addr = http.address() as net.AddressInfo;
    mcpUrl = `http://127.0.0.1:${addr.port}/api/v1/mcp`;

    prisma = app.get(PrismaService);
    domainEvents = app.get(DomainEventsService);
    runner = app.get(AgentWorkerService);
    fakeRuntime = app.get(AgentRuntimeService) as unknown as FakeAgentRuntimeService;
    fakeRuntime.http = http;

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // Scenario A — human path (no always-on agent registered yet for DELAY)
  // =========================================================================

  describe('Scenario A — human resolves a stop.delayed task', () => {
    const stopId = `stop-a-${suffix}`;
    const loadId = `load-a-${suffix}`;
    const deadline = '2026-06-14T18:00:00.000Z';
    let taskId = '';

    it('A1: emitting stop.delayed + processPending creates an UNASSIGNED OPEN task', async () => {
      const tasksBefore = await prisma.operationalTask.count({ where: { tenantId } });

      await domainEvents.emit(
        tenantId,
        'stop.delayed',
        { type: 'stop', id: stopId },
        { stopId, loadId, deadline, minutesLate: 30 },
      );

      const processed = await domainEvents.processPending(50);
      expect(processed).toBeGreaterThanOrEqual(1);

      const tasksAfter = await prisma.operationalTask.count({ where: { tenantId } });
      expect(tasksAfter).toBeGreaterThan(tasksBefore);
    });

    it('A2: GET /operational-tasks?status=OPEN returns the new DELAY task (UNASSIGNED)', async () => {
      const res = await request(http)
        .get('/api/v1/operational-tasks')
        .set(auth())
        .query({ status: 'OPEN' })
        .expect(200);

      const items = (res.body as { items: Array<{ category: string; assigneeType: string; subjectId: string; id: string }> }).items;
      const task = items.find((t) => t.category === 'DELAY' && t.subjectId === stopId);
      expect(task).toBeDefined();
      expect(task!.assigneeType).toBe('UNASSIGNED');
      taskId = task!.id;
    });

    it('A3: POST /operational-tasks/:id/resolve → 200/201, status RESOLVED', async () => {
      const res = await request(http)
        .post(`/api/v1/operational-tasks/${taskId}/resolve`)
        .set(auth())
        .send({ note: 'handled' })
        .expect((r) => {
          // Controller returns the updated task; NestJS uses 200 by default for
          // @Post when the handler is synchronous — accept both 200 and 201.
          expect([200, 201]).toContain(r.status);
        });

      const body = res.body as { status: string; resolutionNote: string };
      expect(body.status).toBe('RESOLVED');
      expect(body.resolutionNote).toBe('handled');
    });

    it('A4: GET /operational-tasks/:id confirms RESOLVED + note', async () => {
      const res = await request(http)
        .get(`/api/v1/operational-tasks/${taskId}`)
        .set(auth())
        .expect(200);

      const body = res.body as { status: string; resolutionNote: string };
      expect(body.status).toBe('RESOLVED');
      expect(body.resolutionNote).toBe('handled');
    });

    it('A5: re-emitting the same stop.delayed creates no duplicate (dedupKey idempotency)', async () => {
      // Count OPEN tasks for this exact dedup key before.
      const dedupKey = `DELAY:${stopId}:${deadline}`;
      const before = await prisma.operationalTask.count({
        where: { tenantId, dedupKey },
      });

      // Emit again + process.
      await domainEvents.emit(
        tenantId,
        'stop.delayed',
        { type: 'stop', id: stopId },
        { stopId, loadId, deadline, minutesLate: 30 },
      );
      await domainEvents.processPending(50);

      const after = await prisma.operationalTask.count({
        where: { tenantId, dedupKey },
      });
      // The P2002 unique constraint on (tenantId, dedupKey) prevents a second row.
      expect(after).toBe(before);
    });
  });

  // =========================================================================
  // Scenario B — agent path (fake Hermes)
  // =========================================================================

  describe('Scenario B — always-on agent woken by AgentWorkerService', () => {
    const stopId = `stop-b-${suffix}`;
    const loadId = `load-b-${suffix}`;
    const deadline = '2026-06-15T08:00:00.000Z';
    let agentId = '';
    let taskId = '';

    it('B1: register an always-on PROPOSE agent that handles DELAY', async () => {
      const res = await request(http)
        .post('/api/v1/agents')
        .set(auth())
        .send({
          name: `workbench-agent-${suffix}`,
          persona: 'Dispatch agent for delay escalation.',
          role: 'dispatcher',
          model: 'anthropic:claude-sonnet-4-6',
          autonomyLevel: 'PROPOSE',
          permissions: WORKBENCH_PERMS,
          caps: {
            alwaysOn: true,
            handlesCategories: ['DELAY'],
            maxAmountPerAction: 1500,
          },
        })
        .expect(201);

      const body = res.body as { id: string; autonomyLevel: string };
      agentId = body.id;
      expect(agentId).toBeTruthy();
      expect(body.autonomyLevel).toBe('PROPOSE');

      // Script the fake: when the agent's session runs its turn, it will call
      // create_load (MUTATING) → enqueued as a ProposedAction (PROPOSE autonomy).
      fakeRuntime.setScript(agentId, {
        assistantText: 'Delay detected. I will create a contingency load.',
        mcpCall: { name: 'create_load', arguments: { notes: `delay-b-${suffix}` } },
      });
    });

    it('B2: emit stop.delayed → processPending → task auto-assigned to the agent', async () => {
      await domainEvents.emit(
        tenantId,
        'stop.delayed',
        { type: 'stop', id: stopId },
        { stopId, loadId, deadline, minutesLate: 45 },
      );

      const processed = await domainEvents.processPending(50);
      expect(processed).toBeGreaterThanOrEqual(1);

      // The task must be auto-assigned to the always-on agent (assignHint AUTO,
      // agent has alwaysOn + handlesCategories: ['DELAY']).
      const task = await prisma.operationalTask.findFirst({
        where: { tenantId, subjectId: stopId, category: 'DELAY' },
      });
      expect(task).toBeDefined();
      expect(task!.assigneeType).toBe('AGENT');
      expect(task!.assigneeAgentId).toBe(agentId);
      expect(task!.status).toBe('OPEN');
      taskId = task!.id;
    });

    it('B3: AgentWorkerService.tick() drives the task to IN_PROGRESS via fake Hermes', async () => {
      const driven = await runner.tick(mcpUrl, 10);
      expect(driven).toBeGreaterThanOrEqual(1);

      // The task must now be IN_PROGRESS (tasks.start was called).
      const task = await prisma.operationalTask.findFirst({
        where: { id: taskId },
      });
      expect(task).toBeDefined();
      expect(task!.status).toBe('IN_PROGRESS');
    });

    it('B4: the fake agent turn enqueued a ProposedAction with triggeredByRef = task:<id>', async () => {
      // The fake runtime's sendTurn made a real /mcp tools/call for create_load
      // with a PROPOSE-level agent → governance enqueued a ProposedAction.
      // The session token carries triggeredByRef = 'task:<taskId>', which is
      // stamped onto ProposedAction.triggeredByRef by mcp-server.factory.ts.
      const proposal = await prisma.proposedAction.findFirst({
        where: {
          tenantId,
          agentId,
          tool: 'create_load',
          triggeredByRef: `task:${taskId}`,
        },
        orderBy: { proposedAt: 'desc' },
      });
      expect(proposal).toBeDefined();
      expect(proposal!.status).toBe('PENDING');
      expect(proposal!.triggeredByRef).toBe(`task:${taskId}`);
    });

    it('B5: GET /operational-tasks/:id exposes the proposed action (no argsJson in projection)', async () => {
      const res = await request(http)
        .get(`/api/v1/operational-tasks/${taskId}`)
        .set(auth())
        .expect(200);

      const body = res.body as {
        status: string;
        proposedActions: Array<{
          id: string;
          tool: string;
          riskTier: string;
          status: string;
          triggeredByRef: string;
        }>;
      };

      expect(body.status).toBe('IN_PROGRESS');

      const linked = body.proposedActions.find((p) => p.triggeredByRef === `task:${taskId}`);
      expect(linked).toBeDefined();
      expect(linked!.tool).toBe('create_load');
      expect(linked!.riskTier).toBe('MUTATING');
      expect(linked!.status).toBe('PENDING');

      // Hard rule: projected select must NOT include argsJson.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('argsJson');
    });
  });
});
