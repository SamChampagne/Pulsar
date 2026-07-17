/**
 * E2E phase 13 — the 24/7 workforce path.
 *
 * Proves the always-on agent workforce end to end:
 *   - an event wakes the agent (eager dispatch), the run is recorded in the
 *     durable AgentRun ledger, and the agent's action goes through the
 *     ProposedAction governance queue with triggeredByRef = 'task:<id>';
 *   - GET /agents/:id/runs exposes the ledger (paginated, no secrets leaked)
 *     and GET /agents/:id surfaces the heartbeat (lastSeenAt / lastRunAt);
 *   - the PAUSE hot kill switch removes the agent from the workforce so new
 *     tasks are NOT auto-assigned to it and it is not woken; resume restores it;
 *   - run-now manually enqueues the agent's oldest OPEN task;
 *   - when the runtime is unavailable (BadRequestException), the run is SKIPPED
 *     (rule 24), the task reverts to OPEN, and nothing crashes the core.
 *
 * The fake Hermes harness is copied from phase12-operating-workbench.e2e-spec.ts:
 * AgentRuntimeService is replaced by FakeAgentRuntimeService, which drives a
 * real HermesAcpClient over an in-process FakeAcpServer, mints a REAL session
 * token via AgentsService.mintSessionToken (carrying triggeredByRef), and makes
 * a REAL HTTP tools/call to /api/v1/mcp on the booted app (so palier-1 +
 * palier-2a governance is exercised end-to-end).
 *
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { BadRequestException, INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
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
// FakeAgentRuntimeService — identical mechanism to phase12.
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

  /** Manual run-now readiness gate probe — the fake runtime is always ready. */
  async readiness(): Promise<{ installed: boolean; configured: boolean; defaultModel: string | null }> {
    return { installed: true, configured: true, defaultModel: 'fake-model' };
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
          type: 'http',
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

  // Hot kill switch hook used by AgentsService.pause — no live sessions to kill
  // in this harness (sessions are short-lived within a single turn), so a no-op.
  async killAgentSessions(_agentId: string): Promise<void> {
    /* no-op for the fake */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Poll `predicate` until it resolves truthy or the timeout elapses. Returns the
 * last truthy value, or undefined on timeout. Makes the eager event-driven
 * agent dispatch deterministic without asserting on a transient race window.
 */
async function waitFor<T>(
  predicate: () => Promise<T | undefined | null | false>,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) return undefined;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

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

interface RunRow {
  id: string;
  status: string;
  trigger: string;
  taskId: string | null;
  proposedActionCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Phase 13 — 24/7 workforce (e2e)', () => {
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

  // The single always-on PROPOSE DELAY agent registered by the bootstrap.
  let agentId = '';

  const registeredAgentIds: string[] = [];

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

    const addr = http.address() as net.AddressInfo;
    mcpUrl = `http://127.0.0.1:${addr.port}/api/v1/mcp`;

    prisma = app.get(PrismaService);
    domainEvents = app.get(DomainEventsService);
    // Test isolation: drain the PENDING domain-event backlog inherited from
    // earlier e2e suites (global + oldest-first + batch-limited queue, so a
    // large cross-suite backlog would otherwise starve this suite's freshly-
    // emitted events out of its processPending(N) window). Harmless — those
    // events belong to already-completed suites.
    for (let _i = 0; _i < 100; _i++) {
      if ((await domainEvents.processPending(500)) === 0) break;
    }
    runner = app.get(AgentWorkerService);
    fakeRuntime = app.get(AgentRuntimeService) as unknown as FakeAgentRuntimeService;
    fakeRuntime.http = http;

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Bootstrap: ONE always-on PROPOSE agent that handles DELAY (same shape as
    // phase-12 B1). create_load (MUTATING) → PROPOSE autonomy enqueues a PENDING
    // ProposedAction with triggeredByRef = 'task:<id>'.
    const res = await request(http)
      .post('/api/v1/agents')
      .set(auth())
      .send({
        name: `workforce-agent-${suffix}`,
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

    agentId = (res.body as { id: string }).id;
    registeredAgentIds.push(agentId);

    fakeRuntime.setScript(agentId, {
      assistantText: 'Delay detected. I will create a contingency load.',
      mcpCall: { name: 'create_load', arguments: { notes: `delay-${suffix}` } },
    });
  });

  afterAll(async () => {
    if (prisma && registeredAgentIds.length > 0) {
      await prisma.proposedAction
        .deleteMany({ where: { agentId: { in: registeredAgentIds } } })
        .catch(() => undefined);
      await prisma.agentRun
        .deleteMany({ where: { agentId: { in: registeredAgentIds } } })
        .catch(() => undefined);
      await prisma.operationalTask
        .updateMany({
          where: { assigneeAgentId: { in: registeredAgentIds } },
          data: { assigneeAgentId: null },
        })
        .catch(() => undefined);
      await prisma.agent
        .deleteMany({ where: { id: { in: registeredAgentIds } } })
        .catch(() => undefined);
    }
    await app.close();
  });

  /** Emit a fresh stop.delayed event (unique stopId) and process the outbox. */
  async function emitDelay(stopId: string, loadId: string, deadline: string): Promise<void> {
    await domainEvents.emit(
      tenantId,
      'stop.delayed',
      { type: 'stop', id: stopId },
      { stopId, loadId, deadline, minutesLate: 30 },
    );
    await domainEvents.processPending(50);
  }

  async function fetchRuns(query: Record<string, string | number> = {}): Promise<{
    items: RunRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const res = await request(http)
      .get(`/api/v1/agents/${agentId}/runs`)
      .set(auth())
      .query(query)
      .expect(200);
    return res.body as { items: RunRow[]; total: number; page: number; pageSize: number };
  }

  // =========================================================================
  // Scenario A — event wakeup drives the agent, recorded in the ledger
  // =========================================================================

  describe('Scenario A — event wakeup + run ledger + heartbeat', () => {
    const stopId = `stop-a-${suffix}`;
    const loadId = `load-a-${suffix}`;
    const deadline = '2026-06-15T08:00:00.000Z';
    let taskId = '';

    it('A1: a fresh stop.delayed wakes the agent → IN_PROGRESS + ProposedAction', async () => {
      await emitDelay(stopId, loadId, deadline);

      // Eager dispatch races our assertions — poll the OUTCOME, never a transient.
      // Also fire the cron safety-net to cover the CRON pickup path.
      void runner.tick(mcpUrl, 10).catch(() => undefined);

      const outcome = await waitFor(async () => {
        const task = await prisma.operationalTask.findFirst({
          where: { tenantId, subjectId: stopId, category: 'DELAY' },
        });
        if (!task) return undefined;
        const proposal = await prisma.proposedAction.findFirst({
          where: {
            tenantId,
            agentId,
            tool: 'create_load',
            triggeredByRef: `task:${task.id}`,
          },
        });
        return task.status === 'IN_PROGRESS' && proposal ? { task, proposal } : undefined;
      }, 20000);

      expect(outcome).toBeDefined();
      expect(outcome!.task.assigneeType).toBe('AGENT');
      expect(outcome!.task.assigneeAgentId).toBe(agentId);
      expect(outcome!.task.status).toBe('IN_PROGRESS');
      expect(outcome!.proposal.status).toBe('PENDING');
      expect(outcome!.proposal.triggeredByRef).toBe(`task:${outcome!.task.id}`);
      taskId = outcome!.task.id;
    });

    it('A2: GET /agents/:id/runs → latest run SUCCEEDED, EVENT|CRON, proposedActionCount>=1', async () => {
      // The SUCCEEDED ledger row is written after the proposal — poll the ledger.
      const latest = await waitFor(async () => {
        const body = await fetchRuns();
        const succeeded = body.items.find(
          (r) => r.taskId === taskId && r.status === 'SUCCEEDED',
        );
        return succeeded ?? undefined;
      }, 20000);

      expect(latest).toBeDefined();
      expect(latest!.status).toBe('SUCCEEDED');
      expect(latest!.taskId).toBe(taskId);
      expect(['EVENT', 'CRON']).toContain(latest!.trigger);
      expect(latest!.proposedActionCount).toBeGreaterThanOrEqual(1);
    });

    it('A3: the runs projection leaks no secrets (secretHash / serviceUserId)', async () => {
      const body = await fetchRuns();
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('secretHash');
      expect(serialized).not.toContain('serviceUserId');
    });

    it('A4: GET /agents/:id → heartbeat set (lastSeenAt/lastRunAt) + status ACTIVE', async () => {
      const res = await request(http)
        .get(`/api/v1/agents/${agentId}`)
        .set(auth())
        .expect(200);
      const body = res.body as {
        status: string;
        lastSeenAt: string | null;
        lastRunAt: string | null;
      };
      expect(body.status).toBe('ACTIVE');
      expect(body.lastSeenAt).toBeTruthy();
      expect(body.lastRunAt).toBeTruthy();
    });
  });

  // =========================================================================
  // Scenario A2 — runs endpoint pagination
  // =========================================================================

  describe('Scenario A2 — runs endpoint pagination', () => {
    it('returns items/total with the requested pageSize', async () => {
      const body = await fetchRuns({ page: 1, pageSize: 5 });
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.total).toBe('number');
      expect(body.pageSize).toBe(5);
    });
  });

  // =========================================================================
  // Scenario B — hot kill switch (pause) removes the agent from the workforce
  // =========================================================================

  describe('Scenario B — pause kills the agent from the workforce', () => {
    const stopId = `stop-b-${suffix}`;
    const loadId = `load-b-${suffix}`;
    const deadline = '2026-06-16T08:00:00.000Z';
    let secondTaskId = '';

    it('B1: POST /agents/:id/pause → PAUSED', async () => {
      const res = await request(http)
        .post(`/api/v1/agents/${agentId}/pause`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('PAUSED');

      const got = await request(http)
        .get(`/api/v1/agents/${agentId}`)
        .set(auth())
        .expect(200);
      expect((got.body as { status: string }).status).toBe('PAUSED');
    });

    it('B2: a new stop.delayed is NOT auto-assigned to the paused agent', async () => {
      const runsBefore = await fetchRuns({ pageSize: 100 });
      const succeededBefore = runsBefore.items.filter((r) => r.status === 'SUCCEEDED').length;

      await emitDelay(stopId, loadId, deadline);
      // Even fire a tick: a PAUSED agent must not be swept either.
      void runner.tick(mcpUrl, 10).catch(() => undefined);

      // The task must exist and be UNASSIGNED (assignment routes only to ACTIVE).
      const task = await waitFor(async () => {
        const t = await prisma.operationalTask.findFirst({
          where: { tenantId, subjectId: stopId, category: 'DELAY' },
        });
        return t ?? undefined;
      }, 5000);
      expect(task).toBeDefined();
      expect(task!.assigneeType).not.toBe('AGENT');
      expect(task!.assigneeAgentId).toBeNull();
      secondTaskId = task!.id;

      // Give any stray eager/tick run a moment, then assert NO new SUCCEEDED run
      // appeared for this second task (the paused agent is not woken).
      await new Promise((r) => setTimeout(r, 600));
      const runsAfter = await fetchRuns({ pageSize: 100 });
      const succeededAfter = runsAfter.items.filter((r) => r.status === 'SUCCEEDED').length;
      expect(succeededAfter).toBe(succeededBefore);
      const newRunForSecond = runsAfter.items.find(
        (r) => r.taskId === secondTaskId && r.status === 'SUCCEEDED',
      );
      expect(newRunForSecond).toBeUndefined();
    });

    it('B3: POST /agents/:id/resume → ACTIVE', async () => {
      const res = await request(http)
        .post(`/api/v1/agents/${agentId}/resume`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('ACTIVE');

      const got = await request(http)
        .get(`/api/v1/agents/${agentId}`)
        .set(auth())
        .expect(200);
      expect((got.body as { status: string }).status).toBe('ACTIVE');
    });

    // =====================================================================
    // Scenario B2 — run-now after resume
    // =====================================================================

    it('B4: assign the still-OPEN second task to the agent, then run-now drives it', async () => {
      // The second task is OPEN + UNASSIGNED. Assign it to the (now ACTIVE) agent
      // via the operational-tasks assign endpoint so the agent owns an OPEN task.
      const assigned = await request(http)
        .post(`/api/v1/operational-tasks/${secondTaskId}/assign`)
        .set(auth())
        .send({ assigneeType: 'AGENT', assigneeAgentId: agentId })
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((assigned.body as { assigneeAgentId: string }).assigneeAgentId).toBe(agentId);

      // Re-arm the script for this turn.
      fakeRuntime.setScript(agentId, {
        assistantText: 'Handling the resumed task.',
        mcpCall: { name: 'create_load', arguments: { notes: `delay-b2-${suffix}` } },
      });

      const res = await request(http)
        .post(`/api/v1/agents/${agentId}/run-now`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { enqueued: boolean }).enqueued).toBe(true);

      const outcome = await waitFor(async () => {
        const task = await prisma.operationalTask.findFirst({ where: { id: secondTaskId } });
        const proposal = await prisma.proposedAction.findFirst({
          where: {
            tenantId,
            agentId,
            tool: 'create_load',
            triggeredByRef: `task:${secondTaskId}`,
          },
        });
        return task?.status === 'IN_PROGRESS' && proposal ? { task, proposal } : undefined;
      }, 20000);

      expect(outcome).toBeDefined();
      expect(outcome!.task.status).toBe('IN_PROGRESS');
      expect(outcome!.proposal.status).toBe('PENDING');
    });
  });

  // =========================================================================
  // Scenario C — SKIPPED when the runtime is unavailable (rule 24, no crash)
  // =========================================================================

  describe('Scenario C — runtime unavailable → run SKIPPED, task reverted, no crash', () => {
    const stopId = `stop-c-${suffix}`;
    const loadId = `load-c-${suffix}`;
    const deadline = '2026-06-17T08:00:00.000Z';

    it('C1: openSession rejects (BadRequestException) → latest run SKIPPED + task OPEN', async () => {
      // Re-arm the normal script (so if anything DID run, it would succeed — making
      // the SKIPPED outcome a real signal that the openSession failure was honored).
      fakeRuntime.setScript(agentId, {
        assistantText: 'should not run',
        mcpCall: { name: 'create_load', arguments: { notes: `delay-c-${suffix}` } },
      });

      // Persistent rejection for the duration of this scenario: the eager event
      // run AND any cron-tick run that wins the claim must both SKIP. Using
      // ...Once would let a second run (after the first reverts the task) succeed
      // with the spy consumed, racing the OPEN assertion. Restored in finally.
      const spy = jest
        .spyOn(fakeRuntime, 'openSession')
        .mockRejectedValue(new BadRequestException('not installed'));

      try {
        await emitDelay(stopId, loadId, deadline);
        // Fire a tick too: depending on timing either the eager event run or a cron
        // tick drives it; the claim-guard ensures only one wins. The OUTCOME
        // (SKIPPED run, task OPEN, no proposal for this task) is deterministic.
        void runner.tick(mcpUrl, 10).catch(() => undefined);

        const task = await waitFor(async () => {
          const t = await prisma.operationalTask.findFirst({
            where: { tenantId, subjectId: stopId, category: 'DELAY' },
          });
          return t ?? undefined;
        }, 5000);
        expect(task).toBeDefined();
        const skippedTaskId = task!.id;

        // Poll until the agent has a SKIPPED run for this task AND the task is OPEN.
        const skipped = await waitFor(async () => {
          const body = await fetchRuns({ pageSize: 100 });
          const skip = body.items.find(
            (r) => r.taskId === skippedTaskId && r.status === 'SKIPPED',
          );
          const fresh = await prisma.operationalTask.findFirst({ where: { id: skippedTaskId } });
          return skip && fresh?.status === 'OPEN' ? { skip, fresh } : undefined;
        }, 20000);

        expect(skipped).toBeDefined();
        expect(skipped!.skip.status).toBe('SKIPPED');
        expect(skipped!.fresh.status).toBe('OPEN');

        // No proposal was enqueued for this task (the turn never ran).
        const proposal = await prisma.proposedAction.findFirst({
          where: { tenantId, agentId, triggeredByRef: `task:${skippedTaskId}` },
        });
        expect(proposal).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
