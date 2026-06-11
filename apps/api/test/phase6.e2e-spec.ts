/**
 * E2E for phase 6: the cross-tenant platform administration plane.
 * Provisioning a tenant + initial admin, suspend/activate gating logins, and
 * module toggling — all gated to platform staff (isPlatformAdmin).
 * Prerequisites: reachable PostgreSQL with the seed applied (platform admin +
 * acme tenant). Tenants are created with unique slugs so reruns are safe.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 6 — platform plane (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let platformToken: string;
  let tenantAdminToken: string;
  let tenantAdminRefresh = '';

  const suffix = Date.now().toString(36);
  const slug = `p6-${suffix}`;
  const adminEmail = `admin-${suffix}@phase6.test`;
  const adminPassword = 'phase6-secret';
  let createdTenantId = '';

  const platform = () => ({ Authorization: `Bearer ${platformToken}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'platform@pulsar.dev', password: 'platform123', tenant: 'platform' })
      .expect(200);
    platformToken = login.body.accessToken;
    expect(login.body.user.isPlatformAdmin).toBe(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects non-platform users from the platform plane', async () => {
    const acme = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    expect(acme.body.user.isPlatformAdmin).toBe(false);

    await request(http)
      .get('/api/v1/platform/tenants')
      .set({ Authorization: `Bearer ${acme.body.accessToken}` })
      .expect(403);
  });

  it('requires authentication on the platform plane', async () => {
    await request(http).get('/api/v1/platform/tenants').expect(401);
  });

  it('returns a platform overview', async () => {
    const res = await request(http).get('/api/v1/platform/overview').set(platform()).expect(200);
    expect(res.body.tenants).toBeGreaterThanOrEqual(2); // acme + platform at least
    expect(res.body.users).toBeGreaterThanOrEqual(2);
  });

  it('provisions a new tenant with an admin and a module', async () => {
    const res = await request(http)
      .post('/api/v1/platform/tenants')
      .set(platform())
      .send({
        slug,
        name: 'Phase6 Co',
        status: 'ACTIVE',
        modules: ['transportation'],
        admin: {
          email: adminEmail,
          firstName: 'Casey',
          lastName: 'Admin',
          password: adminPassword,
        },
      })
      .expect(201);
    createdTenantId = res.body.id;
    expect(res.body.slug).toBe(slug);
    expect(res.body.adminEmail).toBe(adminEmail);
    const enabled = res.body.modules
      .filter((m: { enabled: boolean }) => m.enabled)
      .map((m: { key: string }) => m.key);
    expect(enabled).toEqual(expect.arrayContaining(['core', 'transportation']));
    expect(res.body.userCount).toBe(1);
  });

  it('refuses a duplicate slug and unknown modules', async () => {
    await request(http)
      .post('/api/v1/platform/tenants')
      .set(platform())
      .send({
        slug,
        name: 'Dup',
        admin: { email: 'x@y.test', firstName: 'X', lastName: 'Y', password: 'pw123456' },
      })
      .expect(409);

    await request(http)
      .post('/api/v1/platform/tenants')
      .set(platform())
      .send({
        slug: `${slug}-2`,
        name: 'Bad module',
        modules: ['does-not-exist'],
        admin: { email: 'z@y.test', firstName: 'Z', lastName: 'Y', password: 'pw123456' },
      })
      .expect(400);
  });

  it('lists the new tenant', async () => {
    const res = await request(http)
      .get('/api/v1/platform/tenants')
      .set(platform())
      .query({ search: slug })
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(createdTenantId);
    expect(res.body.items[0].enabledModules).toEqual(expect.arrayContaining(['transportation']));
  });

  it('the provisioned admin can sign in, scoped to its own tenant only', async () => {
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword, tenant: slug })
      .expect(200);
    tenantAdminToken = login.body.accessToken;
    tenantAdminRefresh = login.body.refreshToken;
    expect(login.body.user.tenantId).toBe(createdTenantId);
    expect(login.body.user.isPlatformAdmin).toBe(false);
    expect(login.body.tenant.enabledModules).toEqual(expect.arrayContaining(['transportation']));

    // A freshly provisioned tenant admin is NOT a platform admin.
    await request(http)
      .get('/api/v1/platform/tenants')
      .set({ Authorization: `Bearer ${tenantAdminToken}` })
      .expect(403);
  });

  it('toggles a module for the tenant', async () => {
    const enabled = await request(http)
      .patch(`/api/v1/platform/tenants/${createdTenantId}/modules/billing`)
      .set(platform())
      .send({ enabled: true })
      .expect(200);
    const billing = enabled.body.modules.find((m: { key: string }) => m.key === 'billing');
    expect(billing.enabled).toBe(true);

    await request(http)
      .patch(`/api/v1/platform/tenants/${createdTenantId}/modules/core`)
      .set(platform())
      .send({ enabled: false })
      .expect(400); // core cannot be toggled
  });

  it('suspends the tenant, blocking its logins, then re-activates it', async () => {
    const suspended = await request(http)
      .post(`/api/v1/platform/tenants/${createdTenantId}/suspend`)
      .set(platform())
      .expect(201);
    expect(suspended.body.status).toBe('SUSPENDED');

    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword, tenant: slug })
      .expect(401);

    // Suspension is also a kill switch: an active session cannot renew its token.
    await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tenantAdminRefresh })
      .expect(401);

    const activated = await request(http)
      .post(`/api/v1/platform/tenants/${createdTenantId}/activate`)
      .set(platform())
      .expect(201);
    expect(activated.body.status).toBe('ACTIVE');

    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword, tenant: slug })
      .expect(200);
  });

  it('invites the admin when no password is given', async () => {
    const res = await request(http)
      .post('/api/v1/platform/tenants')
      .set(platform())
      .send({
        slug: `${slug}-inv`,
        name: 'Invited Co',
        admin: { email: `invite-${suffix}@phase6.test`, firstName: 'Ivy', lastName: 'Invite' },
      })
      .expect(201);
    expect(res.body.inviteUrl).toContain('/reset-password/');
    expect(res.body.status).toBe('TRIAL'); // default when status omitted
  });
});
