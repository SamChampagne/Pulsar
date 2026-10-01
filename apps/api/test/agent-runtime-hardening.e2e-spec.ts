import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import { PERMISSION_CATALOG } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { RuntimeConfigService } from '../src/core/agents/runtime-config.service';

describe('AI runtime hardening — isolated tenants, no LLM', () => {
  let app: INestApplication, db: PrismaService, tenantId: string;
  const slug = `ai-runtime-${Date.now()}`;
  const actors: Record<string, string> = {};
  const runtimeTest = jest.fn(async () => ({ ok: true, scope: 'RUNTIME_ONLY', models: [] }));
  const call = (method: 'get' | 'put' | 'post', path: string, body?: object, role = 'manager') =>
    request(app.getHttpServer())
      [method](`/api/v1/agent-runtime${path}`)
      .auth(actors[role], { type: 'bearer' })
      .send(body);
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentRuntimeService)
      .useValue({
        installedForTenant: async () => true,
        testConnection: runtimeTest,
        killAgentSessions: async () => {},
        closeSession: async () => {},
      })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    db = app.get(PrismaService);
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    tenantId = (await db.tenant.create({ data: { slug, name: 'Recette IA isolée' } })).id;
    const otherId = (await db.tenant.create({ data: { slug: `${slug}-other`, name: 'Other' } })).id;
    for (const p of PERMISSION_CATALOG.filter((p) => p.key.startsWith('core.agents')))
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    for (const name of ['manager', 'reader', 'other']) {
      const tid = name === 'other' ? otherId : tenantId;
      const permissions = await db.permission.findMany({
        where: {
          key: {
            in:
              name === 'reader' ? ['core.agents.read'] : ['core.agents.read', 'core.agents.manage'],
          },
        },
      });
      const role = await db.role.create({
        data: {
          tenantId: tid,
          name,
          key: name,
          permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
        },
      });
      const email = `${name}@${slug}.test`;
      await db.user.create({
        data: {
          tenantId: tid,
          email,
          firstName: name,
          lastName: 'Recette',
          passwordHash: hashSync('Test1234!', 4),
          roles: { create: { roleId: role.id } },
        },
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          tenant: name === 'other' ? `${slug}-other` : slug,
          email,
          password: 'Test1234!',
        })
        .expect(200);
      actors[name] = res.body.accessToken;
    }
    console.log(`AI_RUNTIME_TENANT=${slug}`);
  }, 120000);
  afterAll(async () => {
    await app?.close();
  });

  it('requires authentication and runtime administration for health/config', async () => {
    await request(app.getHttpServer()).get('/api/v1/agent-runtime/health').expect(401);
    await call('get', '/health', undefined, 'reader').expect(403);
    await call('put', '', { provider: 'openrouter' }, 'reader').expect(403);
  });
  it('reports bounded local metadata without provider calls or paths', async () => {
    const res = await call('get', '/health').expect(200);
    expect(res.body.scope).toBe('LOCAL_METADATA_ONLY');
    expect(res.body.reference.upstreamCheckedAt).toBe('2026-09-27');
    expect(JSON.stringify(res.body)).not.toMatch(/apiKeyEnc|DATABASE_URL|C:\\\\|tenantId/);
    expect(runtimeTest).not.toHaveBeenCalled();
  });
  it('stores a key encrypted and does not expose it in either tenant', async () => {
    await call('put', '', {
      provider: 'custom',
      baseUrl: 'https://one.example.test/v1',
      defaultModel: 'test-model',
      apiKey: 'recette-only-no-real-key',
    }).expect(200);
    const cfg = (await call('get', '').expect(200)).body;
    expect(cfg.hasApiKey).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain('recette-only');
    const row = await db.agentRuntimeConfig.findUniqueOrThrow({ where: { tenantId } });
    expect(row.apiKeyEnc).not.toContain('recette-only');
    expect((await call('get', '', undefined, 'other').expect(200)).body.configured).toBe(false);
  });
  it('same identity retains its credential, changing endpoint clears key/login/test/models', async () => {
    await call('put', '', {
      provider: 'custom',
      baseUrl: 'https://one.example.test/v1',
      defaultModel: 'test-model',
    }).expect(200);
    expect((await call('get', '')).body.hasApiKey).toBe(true);
    await db.agentRuntimeConfig.update({
      where: { tenantId },
      data: { lastTestOk: true, connectedAt: new Date(), availableModels: [{ value: 'old' }] },
    });
    const res = await call('put', '', {
      provider: 'custom',
      baseUrl: 'https://two.example.test/v1',
      defaultModel: 'test-model',
    }).expect(200);
    expect(res.body.hasApiKey).toBe(false);
    expect(res.body.connectedAt).toBeNull();
    expect(res.body.lastTestOk).toBeNull();
    expect(res.body.availableModels).toEqual([]);
  });
  it('rejects endpoint credentials, query secrets and non-HTTP protocols', async () => {
    for (const baseUrl of [
      'https://user:secret@example.test/v1',
      'https://example.test/v1?apiKey=secret',
      'file:///secrets',
    ])
      await call('put', '', { provider: 'custom', baseUrl }).expect(400);
    await call('put', '', { provider: 'anthropic', baseUrl: 'https://example.test' }).expect(400);
    await call('put', '', { provider: 'nous', apiKey: 'not-accepted' }).expect(400);
  });
  it('does not validate a new config using an old test/login result', async () => {
    const old = await db.agentRuntimeConfig.findUniqueOrThrow({ where: { tenantId } });
    await call('put', '', { provider: 'openrouter', defaultModel: 'test-model' }).expect(200);
    const svc = app.get(RuntimeConfigService);
    await expect(svc.markTested(tenantId, true, [], old.updatedAt)).rejects.toThrow(
      'configuration a changé',
    );
    await expect(svc.markConnected(tenantId, old.updatedAt)).rejects.toThrow(
      'configuration a changé',
    );
    expect((await call('get', '')).body.lastTestOk).toBeNull();
  });
  it('never trusts a tenant ID from input', async () => {
    await call('put', '', { provider: 'openrouter', tenantId: 'foreign' }).expect(400);
    expect((await call('get', '', undefined, 'other')).body.configured).toBe(false);
  });
});
