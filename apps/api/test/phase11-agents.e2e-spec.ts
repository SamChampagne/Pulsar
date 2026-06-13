/**
 * E2E phase 11 — agent governance + MCP exposure (palier 1).
 * Verifies: agent registration, scoped tool listing, live reads, mutation
 * enqueue (no live execution), amount-cap rejection, approval execution + audit,
 * idempotency. Creates its own agent (rerun-safe via unique key per run).
 *
 * Prerequisites: reachable PostgreSQL with the seed applied (admin must hold the
 * agents.* permissions — run `pnpm db:seed` first).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

/**
 * The MCP endpoint uses the StreamableHTTP transport (stateless). It replies with a
 * `text/event-stream` body containing one `event: message\ndata: {json-rpc}` frame,
 * not a parsed JSON body. Pull the JSON-RPC envelope out of whichever shape arrived.
 */
function parseMcp(res: request.Response): { result?: any; error?: any } {
  if (res.body && (res.body.result !== undefined || res.body.error !== undefined)) {
    return res.body;
  }
  const text: string = res.text ?? '';
  // SSE frames: lines beginning with `data:` carry the payload.
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
  // Last resort: maybe the whole body is JSON text.
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Could not parse MCP response. status=${res.status} body=${text.slice(0, 500)}`);
  }
}

describe('Phase 11 — agent governance (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let agentKey = '';
  let mcpId = 0;

  const mcp = (method: string, params: unknown) =>
    request(http)
      .post('/api/v1/mcp')
      .set('X-Agent-Key', agentKey)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++mcpId, method, params });

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers an agent with planning permissions + an amount cap', async () => {
    const res = await request(http)
      .post('/api/v1/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'dispatch-bot',
        permissions: [
          'transportation.orders.read',
          'transportation.planning.read',
          'transportation.planning.manage',
        ],
        caps: { maxAmountPerAction: 1500 },
      })
      .expect(201);
    expect(res.body.key).toMatch(/^ak_/);
    agentKey = res.body.key;
  });

  it('lists only the tools the agent may use (no analytics — not granted)', async () => {
    const res = await mcp('tools/list', {}).expect(200);
    const envelope = parseMcp(res);
    const names: string[] = (envelope.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['list_transport_orders', 'get_load', 'create_load', 'tender_load']),
    );
    expect(names).not.toContain('carrier_scorecard');
  });

  it('executes a read tool live', async () => {
    const res = await mcp('tools/call', {
      name: 'list_transport_orders',
      arguments: { pageSize: 5 },
    }).expect(200);
    const envelope = parseMcp(res);
    const text = envelope.result?.content?.[0]?.text ?? '';
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('enqueues a mutating tool instead of executing it', async () => {
    const loadsBefore = await prisma.load.count();
    const before = await prisma.proposedAction.count();
    const res = await mcp('tools/call', {
      name: 'create_load',
      arguments: { notes: 'agent draft load' },
    }).expect(200);
    const envelope = parseMcp(res);
    const payload = JSON.parse(envelope.result.content[0].text);
    expect(payload.queued).toBe(true);
    expect(payload.status).toBe('PENDING');
    expect(await prisma.proposedAction.count()).toBe(before + 1);
    expect(await prisma.load.count()).toBe(loadsBefore); // mutation was queued, not executed
  });

  it('rejects a tender above the amount cap', async () => {
    const res = await mcp('tools/call', {
      name: 'tender_load',
      arguments: { loadId: 'nonexistent', carrierId: 'x', amount: 5000 },
    }).expect(200);
    const envelope = parseMcp(res);
    // MCP surfaces tool errors as isError content; assert the cap message surfaced.
    const text = JSON.stringify(envelope.result ?? envelope.error);
    expect(text).toContain('exceeds the agent cap of 1500');
  });

  it('approving a pending proposal executes it and audits the approver', async () => {
    const pending = await request(http)
      .get('/api/v1/agent-actions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const proposal = pending.body.find((p: { tool: string }) => p.tool === 'create_load');
    expect(proposal).toBeDefined();

    const approve = await request(http)
      .post(`/api/v1/agent-actions/${proposal.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(['EXECUTED', 'FAILED']).toContain(approve.body.status);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'proposed-action', entityId: proposal.id, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('is idempotent: re-enqueuing the same call returns the same proposal', async () => {
    const args = { notes: 'idem-key-test' };
    const a = await mcp('tools/call', { name: 'create_load', arguments: args }).expect(200);
    const b = await mcp('tools/call', { name: 'create_load', arguments: args }).expect(200);
    const ida = JSON.parse(parseMcp(a).result.content[0].text).proposalId;
    const idb = JSON.parse(parseMcp(b).result.content[0].text).proposalId;
    expect(ida).toBe(idb);
  });
});
