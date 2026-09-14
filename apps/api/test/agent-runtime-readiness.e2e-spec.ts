/**
 * E2E — GET /agent-runtime/readiness (Wave 4 agent transparency).
 *
 * Proves the small addition to RuntimeConfigController: a plain GET that returns the
 * tenant's pure RuntimeReadiness (the same decision AgentsService.runNow already gates
 * on internally, via AgentRuntimeService.readiness) so the web UI can show a proactive
 * readiness chip instead of only surfacing the block reason as a toast after a failed
 * "Run now" click. No spawn, no secrets — it's the pure @pulsar/shared projection.
 *
 * Prerequisites: reachable PostgreSQL with the seed applied (admin must hold
 * `core.agents.manage` — run `pnpm db:seed` first).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

describe('GET /agent-runtime/readiness (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with a ready boolean + blockReason field and no secrets', async () => {
    const res = await request(http)
      .get('/api/v1/agent-runtime/readiness')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(typeof res.body.ready).toBe('boolean');
    expect('blockReason' in res.body).toBe(true);
    if (res.body.ready) {
      expect(res.body.blockReason).toBeNull();
    } else {
      expect([
        'not-installed',
        'not-configured',
        'auth-missing',
        'model-missing',
        'test-failed',
      ]).toContain(res.body.blockReason);
    }

    // Rule 26 spirit — the pure readiness projection carries no secrets whatsoever.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('secretHash');
    expect(raw).not.toContain('apiKey');
    expect(raw).not.toContain('serviceUserId');
  });

  it('rejects unauthenticated requests', async () => {
    await request(http).get('/api/v1/agent-runtime/readiness').expect(401);
  });
});
