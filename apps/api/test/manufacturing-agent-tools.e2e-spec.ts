/**
 * E2E (SP6): manufacturing planning tools over the agent MCP governance path.
 * Proves an agent with manufacturing permissions sees the tools, runs a schedule
 * LIVE (LOW tier), and that publishing the baseline is QUEUED as a ProposedAction
 * (MUTATING tier) rather than executed. Boots the real APS engine; skips cleanly
 * when the runtime isn't installed (run `pnpm aps:setup`).
 *
 * Prerequisites: seeded Postgres (a RELEASED MO-DEMO-001 exists) + `pnpm aps:setup`.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ApsRuntimeService } from '../src/core/aps/aps-runtime.service';
import { isInstalled } from '../src/core/aps/runtime-install';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123' };
const describeIfInstalled = isInstalled() ? describe : describe.skip;
if (!isInstalled()) {
  // eslint-disable-next-line no-console
  console.warn('[manufacturing-agent-tools.e2e] APS runtime not installed — skipping. Run `pnpm aps:setup`.');
}

function parseMcp(res: request.Response): { result?: any; error?: any } {
  if (res.body && (res.body.result !== undefined || res.body.error !== undefined)) return res.body;
  const text: string = res.text ?? '';
  for (const line of text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean)) {
    try {
      const p = JSON.parse(line);
      if (p.result !== undefined || p.error !== undefined) return p;
    } catch {
      /* skip */
    }
  }
  return JSON.parse(text);
}

describeIfInstalled('Manufacturing agent tools (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let agentKey = '';
  let mcpId = 0;
  let runId = '';

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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const runtime = app.get(ApsRuntimeService);
    await runtime.start();
    await runtime.waitForHealthy(30_000);

    token = (await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200)).body.accessToken;
    await request(http).patch('/api/v1/modules/manufacturing').set('Authorization', `Bearer ${token}`).send({ enabled: true });
    const agent = await request(http)
      .post('/api/v1/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `planner-bot-${Date.now()}`, permissions: ['manufacturing.read', 'manufacturing.manage'] })
      .expect(201);
    agentKey = agent.body.key;
  }, 90_000);

  afterAll(async () => {
    app?.get(ApsRuntimeService)?.stop();
    await app?.close();
  });

  it('exposes the manufacturing planning tools to a permitted agent', async () => {
    const envelope = parseMcp(await mcp('tools/list', {}).expect(200));
    const names: string[] = (envelope.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_manufacturing_orders',
        'get_manufacturing_plan',
        'run_manufacturing_schedule',
        'publish_manufacturing_baseline',
      ]),
    );
  });

  it('runs a schedule LIVE (LOW tier) and returns a persisted run', async () => {
    const envelope = parseMcp(
      await mcp('tools/call', { name: 'run_manufacturing_schedule', arguments: { strategy: 'greedy' } }).expect(200),
    );
    const payload = JSON.parse(envelope.result.content[0].text);
    expect(payload.id).toBeTruthy();
    expect(payload.solverStatus).toBeTruthy();
    expect(payload.assignmentCount).toBeGreaterThanOrEqual(1);
    runId = payload.id;
  }, 60_000);

  it('QUEUES the baseline publish (MUTATING) instead of executing it', async () => {
    const before = await prisma.proposedAction.count();
    const envelope = parseMcp(
      await mcp('tools/call', { name: 'publish_manufacturing_baseline', arguments: { runId } }).expect(200),
    );
    const payload = JSON.parse(envelope.result.content[0].text);
    expect(payload.queued).toBe(true);
    expect(payload.status).toBe('PENDING');
    expect(await prisma.proposedAction.count()).toBe(before + 1);
    // The run is NOT yet the baseline (publish was queued, not executed).
    const run = await prisma.schedulingRun.findUnique({ where: { id: runId } });
    expect(run?.isBaseline).toBe(false);
  });
});
