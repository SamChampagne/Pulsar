/**
 * E2E — /health/* infra endpoints.
 *
 * `/health/live` is a pure liveness probe: no auth, no dependency checks, 200
 * whenever the process is up. `/health/ready` checks Postgres (via Prisma)
 * and reports best-effort agent-runtime/APS install state without failing
 * readiness on their absence (CLAUDE.md rule 24 — those runtimes are optional).
 *
 * Both routes sit under the global `api/v1` prefix (set the same way in
 * main.ts and here), same as every other endpoint — health is not special-
 * cased out of the prefix.
 *
 * Prerequisites: reachable PostgreSQL (db:up + db:migrate). No seed/auth
 * needed — these routes are public.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  const srv = () => app.getHttpServer();

  it('GET /health/live returns 200 without auth', async () => {
    const res = await request(srv()).get('/api/v1/health/live').expect(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('GET /health/ready returns 200 with checks.postgres.ok === true', async () => {
    const res = await request(srv()).get('/api/v1/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.postgres.ok).toBe(true);
    // Best-effort checks are reported but never fail readiness on their own.
    expect(typeof res.body.checks.agentRuntime.ok).toBe('boolean');
    expect(typeof res.body.checks.aps.ok).toBe('boolean');
  });

  it('does not require a JWT (no Authorization header sent above) and does not leak secrets', async () => {
    const res = await request(srv()).get('/api/v1/health/ready').expect(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/postgres(ql)?:\/\//i);
    expect(raw).not.toMatch(/password/i);
  });
});
