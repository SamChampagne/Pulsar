/**
 * E2E phase 11 R2 — first-class agents experience.
 *
 * Proves the read paths the agents UI consumes WITHOUT a real Hermes runtime,
 * LLM, or conversation turn:
 *   - registering an employee-agent (role/persona/autonomyLevel/permissions)
 *   - GET /agents/:id projects the profile (role, persona, autonomyLevel,
 *     permissions) and NEVER leaks the secretHash or the serviceUserId
 *   - GET /agents/<bogus> → 404 (tenant scoping is findFirst {id,tenantId}; a
 *     foreign tenant's id behaves like a nonexistent one)
 *   - GET /agents/:id/activity is empty on a fresh agent, then reflects rows
 *     inserted directly via Prisma (a conversation + a PENDING proposed action),
 *     scoped to the agent's tenant.
 *
 * Activity rows are inserted directly via PrismaService rather than driven
 * through a real conversation turn — this isolates the read/projection path
 * (R2) from the runtime (covered by R1 / phase 11b).
 *
 * Prerequisites: reachable PostgreSQL with the seed applied (admin must hold
 * `core.agents.read` + `core.agents.manage` — run `pnpm db:seed` first).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

const PLANNING_PERMS = [
  'transportation.orders.read',
  'transportation.planning.read',
  'transportation.planning.manage',
];

describe('Phase 11 R2 — agents experience (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let adminId = '';
  let tenantId = '';
  const suffix = `${Date.now()}`;

  const auth = () => ({ Authorization: `Bearer ${token}` });

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
    const admin = await prisma.user.findFirstOrThrow({
      where: { tenantId, email: 'admin@pulsar.dev' },
      select: { id: true },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAgent(name: string) {
    const res = await request(http)
      .post('/api/v1/agents')
      .set(auth())
      .send({
        name,
        persona: 'Je suis le répartiteur IA de votre flotte.',
        role: 'dispatcher',
        autonomyLevel: 'PROPOSE',
        permissions: PLANNING_PERMS,
      })
      .expect(201);
    return res.body as { id: string; key: string };
  }

  it('GET /agents/:id projects the profile and never leaks secretHash/serviceUserId', async () => {
    const agent = await registerAgent(`r2-profile-${suffix}`);
    expect(agent.id).toBeTruthy();

    const res = await request(http).get(`/api/v1/agents/${agent.id}`).set(auth()).expect(200);
    expect(res.body.role).toBe('dispatcher');
    expect(res.body.persona).toContain('répartiteur');
    expect(res.body.autonomyLevel).toBe('PROPOSE');
    expect(res.body.permissions).toEqual(expect.arrayContaining(PLANNING_PERMS));

    // The sensitive fields must NEVER appear in the projected body.
    expect(res.body.secretHash).toBeUndefined();
    expect(res.body.serviceUserId).toBeUndefined();
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('secretHash');
    expect(serialized).not.toContain('serviceUserId');
  });

  it('GET /agents/<bogus> → 404 (foreign/nonexistent ids are scoped out)', async () => {
    await request(http).get('/api/v1/agents/does-not-exist-xyz').set(auth()).expect(404);
  });

  it('GET /agents/:id/activity is empty on a fresh agent, then reflects inserted rows', async () => {
    const agent = await registerAgent(`r2-activity-${suffix}`);

    // Fresh agent: everything empty, counters zeroed.
    const empty = await request(http)
      .get(`/api/v1/agents/${agent.id}/activity`)
      .set(auth())
      .expect(200);
    expect(empty.body.conversations).toEqual([]);
    expect(empty.body.proposedActions).toEqual([]);
    expect(empty.body.stats).toEqual({
      conversations: 0,
      pending: 0,
      executed: 0,
      rejected: 0,
    });

    // Create activity directly via Prisma (no real Hermes): one conversation +
    // one PENDING mutating proposal, both scoped to this tenant + agent.
    const conversation = await prisma.agentConversation.create({
      data: {
        tenantId,
        agentId: agent.id,
        userId: adminId,
        title: `Conversation R2 ${suffix}`,
      },
    });
    const proposal = await prisma.proposedAction.create({
      data: {
        tenantId,
        agentId: agent.id,
        tool: 'create_load',
        argsJson: {},
        riskTier: 'MUTATING',
        status: 'PENDING',
        idempotencyKey: `r2-${suffix}-${agent.id}`,
      },
    });

    const res = await request(http)
      .get(`/api/v1/agents/${agent.id}/activity`)
      .set(auth())
      .expect(200);

    expect(res.body.stats.conversations).toBe(1);
    expect(res.body.stats.pending).toBe(1);
    expect(res.body.stats.executed).toBe(0);
    expect(res.body.stats.rejected).toBe(0);

    // Lists contain exactly the inserted rows (tenant + agent scoped).
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([conversation.id]);
    expect(res.body.proposedActions.map((p: { id: string }) => p.id)).toEqual([proposal.id]);

    const convRow = res.body.conversations[0];
    expect(convRow.title).toBe(`Conversation R2 ${suffix}`);
    const propRow = res.body.proposedActions[0];
    expect(propRow.tool).toBe('create_load');
    expect(propRow.status).toBe('PENDING');
    expect(propRow.riskTier).toBe('MUTATING');
  });
});
