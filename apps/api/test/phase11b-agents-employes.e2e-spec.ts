/**
 * E2E phase 11b — agents-employés palier 2a.
 *
 * Proves the FULL employee-agent conversation path WITHOUT a real LLM or a real
 * Python Hermes sidecar: AgentRuntimeService is overridden by a deterministic
 * fake that drives the real HermesAcpClient over the in-process FakeAcpServer
 * transport. The fake's `sendTurn` performs a REAL in-process HTTP `tools/call`
 * against `/api/v1/mcp` using the session token it minted via the REAL
 * AgentsService — exactly what Hermes would do through its MCP client. This
 * exercises palier-1 governance end to end:
 *   conversation turn → ACP fake → /mcp tools/call (session token) → governance.
 *
 * Covered:
 *   - employee-agent registration (persona/role/model/autonomyLevel/caps)
 *   - conversation open records model + an mcpServers X-Agent-Key (`as_…`) header
 *   - PROPOSE turn enqueues a ProposedAction (no live load mutation), persists
 *     user + assistant AgentMessage rows
 *   - AUTONOMOUS turn auto-executes the mutating call live (bypasses the queue)
 *   - amount cap on an auto-approved SENSITIVE tool
 *
 * Prerequisites: reachable PostgreSQL with the seed applied (admin must hold
 * `core.agents.chat` + the agents.* permissions — run `pnpm db:seed` first).
 */
import { INestApplication, ValidationPipe, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentsService } from '../src/core/agents/agents.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { HermesAcpClient, type AcpEvent } from '../src/core/agents/hermes-acp.client';
import { FakeAcpServer } from './support/fake-acp-server';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

const PLANNING_PERMS = [
  'transportation.orders.read',
  'transportation.planning.read',
  'transportation.planning.manage',
];

/**
 * Per-conversation script: what the fake "agent" should do when it processes a
 * user turn. `mcpCall` is the REAL governed tool call the fake performs.
 */
interface TurnScript {
  assistantText: string;
  mcpCall: { name: string; arguments: Record<string, unknown> };
}

/**
 * Deterministic AgentRuntimeService stand-in.
 *
 * openSession: mints a real session token (REAL AgentsService), records the
 * config a real runtime would pass to Hermes (model + the mcpServers entry incl.
 * the X-Agent-Key header), and drives a real HermesAcpClient over an in-process
 * FakeAcpServer to produce a real ACP sessionId — no Python process spawned.
 *
 * sendTurn: makes a REAL HTTP `tools/call` to `/api/v1/mcp` with the minted
 * token (this is the Hermes-style MCP call that flows through palier-1
 * governance), then replays ACP events (tool_call + assistant text + end) via
 * the FakeAcpServer-backed client.
 */
@Injectable()
class FakeAgentRuntimeService {
  /** Injected by the test after app.init() — supertest needs the live server. */
  http: ReturnType<INestApplication['getHttpServer']> | null = null;

  /** sessionId → recorded open-session config (asserted by the test). */
  readonly recorded = new Map<
    string,
    {
      model: string | null;
      agentKey: string | undefined;
      pulsarMcpUrl: string;
      script: TurnScript;
    }
  >();

  /** sessionId → live fake-backed ACP client. */
  private readonly clients = new Map<string, { client: HermesAcpClient; fake: FakeAcpServer }>();

  /** agentId → the script the next conversation for that agent should run. */
  private readonly scripts = new Map<string, TurnScript>();

  constructor(private readonly agents: AgentsService) {}

  /** Test hook: register the turn script the agent's conversation will execute. */
  setScript(agentId: string, script: TurnScript): void {
    this.scripts.set(agentId, script);
  }

  async openSession(input: {
    agent: { id: string; model: string | null; persona: string | null };
    pulsarMcpUrl: string;
  }): Promise<string> {
    // REAL token mint — must validate against /mcp (palier 1 AgentPrincipal).
    const token = this.agents.mintSessionToken(input.agent.id, 300);

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

    // Pull the X-Agent-Key the runtime actually handed Hermes out of the
    // recorded session/new params (mirrors what a real sidecar received).
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
      script,
    });
    this.clients.set(sessionId, { client, fake });
    return sessionId;
  }

  /**
   * Drive one turn. First make the REAL governed /mcp call (what Hermes does),
   * then script the FakeAcpServer to emit a tool_call + assistant text and
   * stream the normalized ACP events back through the real client.
   */
  async *sendTurn(sessionId: string, _text: string): AsyncGenerator<AcpEvent> {
    const rec = this.recorded.get(sessionId);
    const live = this.clients.get(sessionId);
    if (!rec || !live) throw new Error('Conversation session not live');
    if (!this.http) throw new Error('FakeAgentRuntimeService.http not wired');

    // === The load-bearing assertion target: a real /mcp tools/call with the
    // agent's session token, flowing through palier-1 governance. ===
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
    // Expose the parsed MCP envelope to the test via the recorded entry.
    (rec as { mcpEnvelope?: unknown }).mcpEnvelope = parseMcp(mcpRes);

    // Replay the ACP side so the SSE stream carries a tool_call + assistant text.
    live.fake.script = {
      assistantText: rec.script.assistantText,
      toolCall: { name: rec.script.mcpCall.name, args: rec.script.mcpCall.arguments },
    };
    yield* live.client.prompt(sessionId, _text);
  }

  /** Mirrors AgentRuntimeService.isLive — true only for a session we still hold. */
  isLive(sessionId: string | null | undefined): boolean {
    return !!sessionId && this.clients.has(sessionId);
  }

  /**
   * Mirrors AgentRuntimeService.resumeSession: reuse a still-live session,
   * otherwise transparently open a fresh one (the controller resumes a
   * persisted conversation after a runtime restart).
   */
  async resumeSession(
    input: {
      agent: { id: string; model: string | null; persona: string | null };
      pulsarMcpUrl: string;
    } & { existingSessionId?: string | null },
  ): Promise<string> {
    if (input.existingSessionId && this.clients.has(input.existingSessionId)) {
      return input.existingSessionId;
    }
    return this.openSession(input);
  }

  async closeSession(sessionId: string): Promise<void> {
    const live = this.clients.get(sessionId);
    if (!live) return;
    this.clients.delete(sessionId);
    this.recorded.delete(sessionId);
    live.fake.close();
  }
}

/**
 * Parse an MCP StreamableHTTP response (JSON body or `text/event-stream` frame)
 * into the JSON-RPC envelope. Mirrors phase11-agents.e2e-spec.ts.
 */
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
    throw new Error(
      `Could not parse MCP response. status=${res.status} body=${text.slice(0, 500)}`,
    );
  }
}

/** Parse an SSE response body (`res.text`) into ordered {event,data} frames. */
function parseSse(body: string): { event: string; data: any }[] {
  return body
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let event = 'message';
      const dataParts: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataParts.push(line.slice(5).trim());
      }
      let data: any = dataParts.join('\n');
      try {
        data = JSON.parse(data);
      } catch {
        // leave as string
      }
      return { event, data };
    });
}

describe('Phase 11b — agents-employés (conversation → governance) (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let runtime: FakeAgentRuntimeService;
  let token = '';
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
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    runtime = app.get(AgentRuntimeService) as unknown as FakeAgentRuntimeService;
    runtime.http = http;

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // -- helpers -------------------------------------------------------------

  async function registerAgent(opts: {
    name: string;
    autonomyLevel: 'PROPOSE' | 'ACT_LOW' | 'AUTONOMOUS';
    caps?: object;
  }) {
    const res = await request(http)
      .post('/api/v1/agents')
      .set(auth())
      .send({
        name: opts.name,
        persona: 'You are a dispatch assistant.',
        role: 'dispatcher',
        model: 'anthropic:claude-sonnet-4-6',
        autonomyLevel: opts.autonomyLevel,
        permissions: PLANNING_PERMS,
        caps: opts.caps ?? { maxAmountPerAction: 1500 },
      })
      .expect(201);
    return res.body as { id: string; model: string; autonomyLevel: string };
  }

  async function startConversation(agentId: string) {
    const res = await request(http)
      .post('/api/v1/agent-conversations')
      .set(auth())
      .send({ agentId })
      .expect(201);
    return res.body as { id: string; hermesSessionId: string };
  }

  // -- tests ---------------------------------------------------------------

  it('global chat roster projects only safe worker fields and requires authentication', async () => {
    const agent = await registerAgent({ name: `workspace-${suffix}`, autonomyLevel: 'PROPOSE' });
    await request(http).get('/api/v1/agent-conversations/workers').expect(401);
    const response = await request(http)
      .get('/api/v1/agent-conversations/workers')
      .set(auth())
      .expect(200);
    const worker = response.body.find((row: { id: string }) => row.id === agent.id);
    expect(worker.model).toBe('anthropic:claude-sonnet-4-6');
    expect(Object.keys(worker).sort()).toEqual(['avatar', 'id', 'model', 'name', 'role', 'status']);
  });

  it('PROPOSE: turn enqueues a governed proposal (no live mutation) and persists messages', async () => {
    const agent = await registerAgent({
      name: `employe-propose-${suffix}`,
      autonomyLevel: 'PROPOSE',
      caps: { maxAmountPerAction: 1500 },
    });
    expect(agent.autonomyLevel).toBe('PROPOSE');

    // Script the fake to make a governed create_load via /mcp on the turn.
    runtime.setScript(agent.id, {
      assistantText: 'Je crée un load brouillon.',
      mcpCall: { name: 'create_load', arguments: { notes: `propose-${suffix}` } },
    });

    const conv = await startConversation(agent.id);
    expect(conv.id).toBeTruthy();
    expect(conv.hermesSessionId).toBeTruthy();

    // The fake runtime recorded the model + an mcpServers X-Agent-Key (`as_…`).
    const rec = runtime.recorded.get(conv.hermesSessionId);
    expect(rec).toBeDefined();
    expect(rec!.model).toBe('anthropic:claude-sonnet-4-6');
    expect(rec!.agentKey).toMatch(/^as_/);

    const loadsBefore = await prisma.load.count();
    const proposalsBefore = await prisma.proposedAction.count();

    const turn = await request(http)
      .post(`/api/v1/agent-conversations/${conv.id}/messages`)
      .set(auth())
      .send({ text: 'Crée un load pour demain.' })
      .expect(201);

    const frames = parseSse(turn.text);
    const events = frames.map((f) => f.event);
    expect(events).toContain('tool_call');
    expect(events).toContain('end');

    const toolFrame = frames.find((f) => f.event === 'tool_call');
    expect(toolFrame!.data.name).toBe('create_load');

    // Governance queued exactly one proposal; nothing executed live.
    expect(await prisma.proposedAction.count()).toBe(proposalsBefore + 1);
    expect(await prisma.load.count()).toBe(loadsBefore);

    // The /mcp call surfaced a queued proposal (not auto-executed).
    const env = (rec as { mcpEnvelope?: any }).mcpEnvelope;
    const payload = JSON.parse(env.result.content[0].text);
    expect(payload.queued).toBe(true);
    expect(payload.status).toBe('PENDING');

    // user + assistant messages persisted.
    const con006 = await prisma.agentConversation.findUnique({
      where: { id: conv.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    expect(con006).toBeTruthy();
    const roles = con006!.messages.map((m) => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    const userMsg = con006!.messages.find((m) => m.role === 'user');
    expect(userMsg!.content).toBe('Crée un load pour demain.');
    const assistantMsg = con006!.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg!.content).toContain('Je crée un load');
  });

  it('AUTONOMOUS: a mutating tool auto-executes live (bypasses the queue)', async () => {
    const agent = await registerAgent({
      name: `employe-autonome-${suffix}`,
      autonomyLevel: 'AUTONOMOUS',
      caps: { maxAmountPerAction: 1500 },
    });
    expect(agent.autonomyLevel).toBe('AUTONOMOUS');

    runtime.setScript(agent.id, {
      assistantText: 'Je crée le load directement.',
      mcpCall: { name: 'create_load', arguments: { notes: `autonomous-${suffix}` } },
    });

    const conv = await startConversation(agent.id);
    const rec = runtime.recorded.get(conv.hermesSessionId)!;
    expect(rec.agentKey).toMatch(/^as_/);

    const loadsBefore = await prisma.load.count();
    const pendingBefore = await prisma.proposedAction.count({
      where: { agentId: agent.id, status: 'PENDING' },
    });

    await request(http)
      .post(`/api/v1/agent-conversations/${conv.id}/messages`)
      .set(auth())
      .send({ text: 'Crée le load maintenant.' })
      .expect(201);

    const env = (rec as { mcpEnvelope?: any }).mcpEnvelope;
    const payload = JSON.parse(env.result.content[0].text);

    // autoApprove bypassed the queue: the /mcp response is an executed attempt,
    // NOT a queued proposal. No new PENDING proposal for this agent.
    expect(payload.queued).not.toBe(true);
    expect(payload.autoApproved).toBe(true);
    expect(
      await prisma.proposedAction.count({ where: { agentId: agent.id, status: 'PENDING' } }),
    ).toBe(pendingBefore);
    // create_load executed live → a new load row exists.
    expect(await prisma.load.count()).toBe(loadsBefore + 1);
  });

  it('AUTONOMOUS: an auto-approved SENSITIVE tool above the amount cap is rejected', async () => {
    const agent = await registerAgent({
      name: `employe-cap-${suffix}`,
      autonomyLevel: 'AUTONOMOUS',
      caps: { maxAmountPerAction: 1500 },
    });

    runtime.setScript(agent.id, {
      assistantText: 'Je tente un tender.',
      mcpCall: {
        name: 'tender_load',
        arguments: { loadId: 'nonexistent', carrierId: 'x', amount: 5000 },
      },
    });

    const conv = await startConversation(agent.id);
    const rec = runtime.recorded.get(conv.hermesSessionId)!;

    const loadsBefore = await prisma.load.count();

    await request(http)
      .post(`/api/v1/agent-conversations/${conv.id}/messages`)
      .set(auth())
      .send({ text: 'Tender ce load à 5000.' })
      .expect(201);

    const env = (rec as { mcpEnvelope?: any }).mcpEnvelope;
    // The cap error must surface from the /mcp tool call (no execution). Since phase 14 the
    // hard amount cap is a DENY decided in evaluatePolicy, whose reason names the hard cap.
    const blob = JSON.stringify(env.result ?? env.error);
    expect(env.result?.isError).toBe(true);
    expect(blob).toContain('exceeds the hard cap 1500');
    // Nothing executed (no spurious load created by the rejected tender path).
    expect(await prisma.load.count()).toBe(loadsBefore);
  });
});
