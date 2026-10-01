/**
 * E2E phase 11 R1 — Pulsar-managed Hermes runtime CONFIG.
 *
 * Proves the per-tenant runtime configuration path WITHOUT a real Python/Hermes
 * sidecar, a real LLM, or a real provider login: AgentRuntimeService is
 * overridden by a deterministic fake whose `testConnection` / `connectLogin`
 * exercise the REAL RuntimeConfigService (decrypt) and the REAL `buildRuntimeEnv`
 * (env injection) — only the child-process spawn is faked.
 *
 * Covered:
 *   - providers catalog exposes both an apiKey and a login provider
 *   - PUT runtime config encrypts the apiKey (never leaks the raw key; the DB
 *     column is ciphertext) and GET reports hasApiKey without the key
 *   - POST /test resolves + decrypts the key and injects it in the spawn env
 *     (OPENROUTER_API_KEY = the raw key) with HERMES_HOME carrying the tenant id,
 *     and persists lastTestOk
 *   - resolveForSpawn throws "not configured" before any config exists
 *   - POST /connect (SSE) for a login provider streams the device-code line then
 *     `end`, and markConnected sets connectedAt
 *
 * Prerequisites: reachable PostgreSQL with the seed applied (admin must hold
 * `core.agents.manage` — run `pnpm db:seed` first).
 */
import { BadRequestException, INestApplication, ValidationPipe, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService, type LoginEvent } from '../src/core/agents/agent-runtime.service';
import { AgentsService } from '../src/core/agents/agents.service';
import { RuntimeConfigService } from '../src/core/agents/runtime-config.service';
import { buildRuntimeEnv, type RuntimeEnv } from '../src/core/agents/agent-runtime-env';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const SECRET = 'sk-test-SECRET';

/**
 * Deterministic AgentRuntimeService stand-in.
 *
 * It keeps the config/crypto/env paths REAL (it holds the actual
 * RuntimeConfigService and calls `resolveForSpawn` + `buildRuntimeEnv` +
 * `markTested`/`markConnected`) and ONLY fakes the child-process spawn. The env
 * a real runtime WOULD inject into Hermes is recorded for the test to assert.
 */
@Injectable()
class FakeAgentRuntimeService {
  async installedForTenant(): Promise<boolean> {
    return true;
  }
  /** tenantId → the spawn env the runtime WOULD pass to Hermes (real build). */
  readonly recordedEnv = new Map<string, RuntimeEnv>();

  // Mirror the real constructor so Nest injects the same providers. `agents` is
  // unused here but kept positionally to match AgentRuntimeService's signature.
  constructor(
    private readonly agents: AgentsService,
    private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  /**
   * REAL resolve + decrypt + env build; fake spawn. Records the env, persists
   * lastTestOk via the real markTested. Never spawns a process.
   */
  async testConnection(
    tenantId: string,
  ): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try {
      const { config, decryptedKey } = await this.runtimeConfig.resolveForSpawn(tenantId);
      const env = buildRuntimeEnv(config, decryptedKey, this.runtimeConfig.hermesHomeRoot());
      this.recordedEnv.set(tenantId, env);
      await this.runtimeConfig.markTested(tenantId, true);
      return { ok: true, models: ['fake-model'] };
    } catch (err) {
      await this.runtimeConfig.markTested(tenantId, false).catch(() => undefined);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Scripted device-code login; REAL markConnected. No process spawned. */
  async *connectLogin(tenantId: string): AsyncGenerator<LoginEvent> {
    // Touch the real resolve path so a missing config surfaces as it would live.
    await this.runtimeConfig.resolveForSpawn(tenantId);
    yield { type: 'text', text: 'go to https://x/device code ABCD' };
    await this.runtimeConfig.markConnected(tenantId);
    yield { type: 'end' };
  }

  async openSession(): Promise<string> {
    return 'fake-session';
  }
  async *sendTurn(): AsyncGenerator<never> {
    /* not used here */
  }
  async closeSession(): Promise<void> {
    /* no-op */
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

describe('Phase 11 R1 — agent runtime config (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let runtimeConfig: RuntimeConfigService;
  let fake: FakeAgentRuntimeService;
  let token = '';
  let tenantId = '';

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
    runtimeConfig = app.get(RuntimeConfigService);
    fake = app.get(AgentRuntimeService) as unknown as FakeAgentRuntimeService;

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Start from a clean slate so the unconfigured-path assertion is meaningful.
    await prisma.agentRuntimeConfig.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await prisma.agentRuntimeConfig.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await app.close();
  });

  it('exposes both an apiKey provider and a login provider', async () => {
    const res = await request(http).get('/api/v1/agent-runtime/providers').set(auth()).expect(200);
    const providers = res.body as Array<{ id: string; authMode: string }>;
    expect(Array.isArray(providers)).toBe(true);

    const apiKeyProvider = providers.find((p) => p.id === 'openrouter');
    expect(apiKeyProvider).toBeDefined();
    expect(apiKeyProvider!.authMode).toBe('apiKey');

    const loginProvider = providers.find((p) => p.authMode === 'login');
    expect(loginProvider).toBeDefined();
    expect(['openai-codex', 'nous']).toContain(loginProvider!.id);
  });

  it('unconfigured: resolveForSpawn throws before any config exists', async () => {
    // No row yet (deleted in beforeAll) → the real resolve must reject.
    await expect(runtimeConfig.resolveForSpawn(tenantId)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // And the same surfaces through the HTTP /test path: ok:false, error set.
    const res = await request(http).post('/api/v1/agent-runtime/test').set(auth()).expect(201);
    expect(res.body.ok).toBe(false);
    expect(String(res.body.error)).toContain('not configured');
  });

  it('PUT config encrypts the apiKey — no raw key ever leaks', async () => {
    await request(http)
      .put('/api/v1/agent-runtime')
      .set(auth())
      .send({
        provider: 'openrouter',
        apiKey: SECRET,
        defaultModel: 'anthropic/claude-opus-4.6',
      })
      .expect(200);

    const res = await request(http).get('/api/v1/agent-runtime').set(auth()).expect(200);
    expect(res.body.provider).toBe('openrouter');
    expect(res.body.hasApiKey).toBe(true);
    expect(res.body.defaultModel).toBe('anthropic/claude-opus-4.6');
    // The raw key must NOT appear anywhere in the projected response.
    expect(JSON.stringify(res.body)).not.toContain(SECRET);

    // At rest the column is ciphertext (present, but not the plaintext key).
    const row = await prisma.agentRuntimeConfig.findUnique({ where: { tenantId } });
    expect(row).toBeTruthy();
    expect(row!.apiKeyEnc).toBeTruthy();
    expect(row!.apiKeyEnc).not.toBe(SECRET);
  });

  it('POST /test decrypts the key + injects it in the real spawn env', async () => {
    const res = await request(http).post('/api/v1/agent-runtime/test').set(auth()).expect(201);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.models)).toBe(true);

    // The fake recorded the env a real runtime WOULD inject — built REAL.
    const recorded = fake.recordedEnv.get(tenantId);
    expect(recorded).toBeDefined();
    // Decrypt path is real: the OpenRouter key env holds the original secret.
    expect(recorded!.env.OPENROUTER_API_KEY).toBe(SECRET);
    // HERMES_HOME is per-tenant — must carry the tenant id.
    expect(recorded!.env.HERMES_HOME).toContain(tenantId);
    expect(recorded!.homeDir).toContain(tenantId);

    // lastTestOk persisted.
    const after = await request(http).get('/api/v1/agent-runtime').set(auth()).expect(200);
    expect(after.body.lastTestOk).toBe(true);
    expect(after.body.lastTestAt).toBeTruthy();
  });

  it('POST /connect (login provider) streams the device code then end, and sets connectedAt', async () => {
    // Switch to a login provider, no apiKey.
    await request(http)
      .put('/api/v1/agent-runtime')
      .set(auth())
      .send({ provider: 'openai-codex', defaultModel: 'gpt-5-codex' })
      .expect(200);

    const cfg = await request(http).get('/api/v1/agent-runtime').set(auth()).expect(200);
    expect(cfg.body.provider).toBe('openai-codex');
    expect(cfg.body.hasApiKey).toBe(false); // changing identity discards the previous key
    expect(cfg.body.authMode).toBe('login');

    const res = await request(http).post('/api/v1/agent-runtime/connect').set(auth()).expect(201);
    const frames = parseSse(res.text);
    const events = frames.map((f) => f.event);
    expect(events).toContain('text');
    expect(events).toContain('end');
    expect(events.indexOf('text')).toBeLessThan(events.indexOf('end'));

    const textFrame = frames.find((f) => f.event === 'text');
    expect(String(textFrame!.data.text)).toContain('device code');

    const after = await request(http).get('/api/v1/agent-runtime').set(auth()).expect(200);
    expect(after.body.connectedAt).toBeTruthy();
  });
});
