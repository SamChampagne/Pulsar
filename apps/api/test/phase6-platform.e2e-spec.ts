/**
 * E2E for phase 6 — platform plane: platform login, tenant creation (with
 * consumable admin invitation), suspension gating tenant login, watertight
 * token separation, and live status re-read on the PlatformGuard.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Phase 6 — platform plane (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let platformToken: string;
  let tenantId = '';
  let inviteToken = '';

  const suffix = `p6${Date.now().toString(36)}`;
  const slug = `${suffix}-corp`;
  const adminEmail = `${suffix}-admin@example.test`;
  const platformAuth = () => ({ Authorization: `Bearer ${platformToken}` });

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('platform admin signs in (12h token, no refresh token)', async () => {
    const res = await request(http)
      .post('/api/v1/platform/auth/login')
      .send({ email: 'platform@pulsar.dev', password: 'admin123' })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined();
    platformToken = res.body.accessToken;
  });

  it('rejects a tenant token on platform routes and vice versa', async () => {
    const tenantLogin = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    await request(http)
      .get('/api/v1/platform/tenants')
      .set({ Authorization: `Bearer ${tenantLogin.body.accessToken}` })
      .expect(401);
    await request(http).get('/api/v1/auth/me').set(platformAuth()).expect(401);
  });

  it('creates a tenant with modules, admin role and invitation', async () => {
    const res = await request(http)
      .post('/api/v1/platform/tenants')
      .set(platformAuth())
      .send({
        slug,
        name: 'Phase6 Corp',
        modules: ['transportation', 'billing'],
        admin: { email: adminEmail, firstName: 'Ada', lastName: 'Admin' },
      })
      .expect(201);
    tenantId = res.body.id;
    expect(res.body.enabledModules).toEqual(
      expect.arrayContaining(['core', 'transportation', 'billing']),
    );
    expect(res.body.inviteUrl).toContain('/reset-password/');
    inviteToken = res.body.inviteUrl.split('/reset-password/')[1];
  });

  it('the invited admin consumes the invitation and signs in', async () => {
    // reset-password returns 200 (auth.controller.ts has @HttpCode(200))
    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteToken, password: 'NewP@ss123' })
      .expect(200);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'NewP@ss123', tenant: slug })
      .expect(200);
  });

  it('suspension blocks tenant login; reactivation restores it', async () => {
    await request(http)
      .post(`/api/v1/platform/tenants/${tenantId}/suspend`)
      .set(platformAuth())
      .expect(201);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'NewP@ss123', tenant: slug })
      .expect(401);
    await request(http)
      .post(`/api/v1/platform/tenants/${tenantId}/reactivate`)
      .set(platformAuth())
      .expect(201);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'NewP@ss123', tenant: slug })
      .expect(200);
  });

  it('a DISABLED platform admin loses access on the next request', async () => {
    const email = 'platform@pulsar.dev';
    await prisma.platformUser.update({ where: { email }, data: { status: 'DISABLED' } });
    try {
      await request(http).get('/api/v1/platform/tenants').set(platformAuth()).expect(401);
    } finally {
      await prisma.platformUser.update({ where: { email }, data: { status: 'ACTIVE' } });
    }
  });
});
