// apps/api/test/access-module.e2e-spec.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const PASSWORD = 'Passw0rd!123';

interface RoleTemplateDto {
  key: string;
  name: string;
  permissionKeys: string[];
  exists: boolean;
}
interface RoleDto {
  id: string;
  key: string;
  permissions: Array<{ permission: { key: string } }>;
  _count: { users: number };
}
interface InvitationProjection {
  expiresAt: string;
  expired: boolean;
}
interface UserDto {
  id: string;
  email: string;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  lastLoginAt: string | null;
  invitation: InvitationProjection | null;
  inviteUrl?: string;
  roles: Array<{ role: { id: string; key: string; name: string } }>;
}

function extractToken(inviteUrl: string): string {
  return inviteUrl.split('/reset-password/')[1];
}

describe('Access module (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken = '';
  let seededAdminId = '';
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const suffix = Date.now().toString(36);

  // shared across the ordered `it` blocks
  let warehouseManagerRoleId = '';
  let adminRoleId = '';
  let whUserId = '';
  let whToken = '';
  let whEmail = '';
  let locationId = '';
  let secondAdminId = '';
  let secondAdminToken = '';
  let thirdUserId = '';
  let latestWhInviteUrl = '';

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();
    app.get(PrismaService);
    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    adminToken = (login.body as { accessToken: string }).accessToken;
    const me = await request(http).get('/api/v1/auth/me').set(auth(adminToken)).expect(200);
    seededAdminId = (me.body as { id: string }).id;
  });

  afterAll(async () => {
    // Safety net: never leave the seeded admin non-ACTIVE for other suites.
    if (seededAdminId) {
      await request(http).post(`/api/v1/users/${seededAdminId}/reactivate`).set(auth(adminToken));
    }
    await app.close();
  });

  it('1. GET /roles/templates lists warehouse-operator and warehouse-manager (acme has all modules enabled)', async () => {
    const res = await request(http)
      .get('/api/v1/roles/templates')
      .set(auth(adminToken))
      .expect(200);
    const templates = res.body as RoleTemplateDto[];
    expect(templates.some((t) => t.key === 'warehouse-operator')).toBe(true);
    expect(templates.some((t) => t.key === 'warehouse-manager')).toBe(true);
  });

  it('2. POST /roles/from-template warehouse-manager -> 201 or 409, role has core.locations.manage + wms.manage, not core.users.read', async () => {
    const create = await request(http)
      .post('/api/v1/roles/from-template')
      .set(auth(adminToken))
      .send({ templateKey: 'warehouse-manager' });
    expect([201, 409]).toContain(create.status);

    const list = await request(http).get('/api/v1/roles').set(auth(adminToken)).expect(200);
    const role = (list.body as RoleDto[]).find((r) => r.key === 'warehouse-manager');
    expect(role).toBeTruthy();
    warehouseManagerRoleId = role!.id;
    const permKeys = role!.permissions.map((p) => p.permission.key);
    expect(permKeys).toContain('core.locations.manage');
    expect(permKeys).toContain('wms.manage');
    expect(permKeys).not.toContain('core.users.read');
  });

  it('3. POST /users creates an invited warehouse user', async () => {
    whEmail = `wh-${suffix}@acme.test`;
    const res = await request(http)
      .post('/api/v1/users')
      .set(auth(adminToken))
      .send({
        email: whEmail,
        firstName: 'Wanda',
        lastName: 'House',
        roleIds: [warehouseManagerRoleId],
      })
      .expect(201);
    const user = res.body as UserDto;
    whUserId = user.id;
    expect(user.status).toBe('INVITED');
    expect(user.inviteUrl).toBeTruthy();
    expect(user.invitation?.expired).toBe(false);
  });

  it('4. resend-invitation issues a new token and invalidates the old one', async () => {
    const resend1 = await request(http)
      .post(`/api/v1/users/${whUserId}/resend-invitation`)
      .set(auth(adminToken))
      .expect(200);
    const inviteUrlA = (resend1.body as { inviteUrl: string }).inviteUrl;

    const resend2 = await request(http)
      .post(`/api/v1/users/${whUserId}/resend-invitation`)
      .set(auth(adminToken))
      .expect(200);
    const inviteUrlB = (resend2.body as { inviteUrl: string }).inviteUrl;

    expect(inviteUrlB).not.toBe(inviteUrlA);

    // The now-superseded token must no longer work.
    const staleToken = extractToken(inviteUrlA);
    const staleAttempt = await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token: staleToken, password: PASSWORD });
    expect([400, 401]).toContain(staleAttempt.status);

    // Keep the latest valid invite for the next step.
    latestWhInviteUrl = inviteUrlB;
  });

  it('5. reset-password activates the account, then login succeeds', async () => {
    const token = extractToken(latestWhInviteUrl);
    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: PASSWORD })
      .expect(200);

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: whEmail, password: PASSWORD, tenant: 'acme' })
      .expect(200);
    whToken = (login.body as { accessToken: string }).accessToken;
    expect(whToken).toBeTruthy();
  });

  it('6. warehouse-manager can manage core locations and read wms sites, but not TMS locations or users', async () => {
    const code = `WH-${suffix}`;
    const created = await request(http)
      .post('/api/v1/locations')
      .set(auth(whToken))
      .send({
        code,
        name: `Warehouse ${suffix}`,
        type: 'WAREHOUSE',
        addressLine1: '1 rue Test',
        city: 'Montréal',
        country: 'CA',
        latitude: 45.5,
        longitude: -73.6,
      })
      .expect(201);
    locationId = (created.body as { id: string }).id;

    const sites = await request(http).get('/api/v1/wms/sites').set(auth(whToken)).expect(200);
    const siteItems = (sites.body as { items: Array<{ id: string; code: string }> }).items;
    expect(siteItems.some((i) => i.id === locationId || i.code === code)).toBe(true);

    // Task 2 gap: `type=WAREHOUSE` filter was never asserted end-to-end.
    const filtered = await request(http)
      .get('/api/v1/locations?type=WAREHOUSE')
      .set(auth(whToken))
      .expect(200);
    const filteredItems = (filtered.body as { items: Array<{ type: string }> }).items;
    expect(filteredItems.length).toBeGreaterThan(0);
    expect(filteredItems.every((i) => i.type === 'WAREHOUSE')).toBe(true);

    await request(http).get('/api/v1/users').set(auth(whToken)).expect(403);

    await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth(whToken))
      .send({
        code: `TMS-${suffix}`,
        name: `Should be forbidden ${suffix}`,
        type: 'WAREHOUSE',
        addressLine1: '1 rue Test',
        city: 'Montréal',
        country: 'CA',
        latitude: 45.5,
        longitude: -73.6,
      })
      .expect(403);
  });

  it('7. resend-invitation on an already-ACTIVE user is rejected', async () => {
    await request(http)
      .post(`/api/v1/users/${whUserId}/resend-invitation`)
      .set(auth(adminToken))
      .expect(400);
  });

  it('8. DELETE /roles/:id is rejected while the role is assigned', async () => {
    await request(http)
      .delete(`/api/v1/roles/${warehouseManagerRoleId}`)
      .set(auth(adminToken))
      .expect(400);
  });

  it(
    '9. self-deactivation and last-active-admin guards',
    async () => {
      // (a) an admin cannot deactivate themselves.
      await request(http)
        .delete(`/api/v1/users/${seededAdminId}`)
        .set(auth(adminToken))
        .expect(400);

      // Find the system admin role.
      const roles = await request(http).get('/api/v1/roles').set(auth(adminToken)).expect(200);
      const adminRole = (roles.body as RoleDto[]).find((r) => r.key === 'admin');
      expect(adminRole).toBeTruthy();
      adminRoleId = adminRole!.id;

      // (b) create a second, already-active admin.
      const secondAdminEmail = `admin2-${suffix}@acme.test`;
      const created = await request(http)
        .post('/api/v1/users')
        .set(auth(adminToken))
        .send({
          email: secondAdminEmail,
          firstName: 'Second',
          lastName: 'Admin',
          password: PASSWORD,
          roleIds: [adminRoleId],
        })
        .expect(201);
      secondAdminId = (created.body as UserDto).id;
      expect((created.body as UserDto).status).toBe('ACTIVE');

      const secondLogin = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: secondAdminEmail, password: PASSWORD, tenant: 'acme' })
        .expect(200);
      secondAdminToken = (secondLogin.body as { accessToken: string }).accessToken;

      // Second admin deactivates the first — allowed, another active admin exists.
      const deactivated = await request(http)
        .delete(`/api/v1/users/${seededAdminId}`)
        .set(auth(secondAdminToken))
        .expect(200);
      expect((deactivated.body as UserDto).status).toBe('DISABLED');

      // The first admin (who has a lastLoginAt) is reactivated straight to ACTIVE
      // by the second admin.
      const reactivated = await request(http)
        .post(`/api/v1/users/${seededAdminId}/reactivate`)
        .set(auth(secondAdminToken))
        .expect(200);
      expect((reactivated.body as UserDto).status).toBe('ACTIVE');

      // Deactivate the second admin (by the now-restored first admin).
      await request(http)
        .delete(`/api/v1/users/${secondAdminId}`)
        .set(auth(adminToken))
        .expect(200);

      // The first admin is now the last active admin: removing their admin role fails.
      await request(http)
        .patch(`/api/v1/users/${seededAdminId}`)
        .set(auth(adminToken))
        .send({ roleIds: [] })
        .expect(400);
    },
    60000,
  );

  it('10. a deactivated user cannot consume a still-open invitation token', async () => {
    const email = `du-${suffix}@acme.test`;
    const created = await request(http)
      .post('/api/v1/users')
      .set(auth(adminToken))
      .send({ email, firstName: 'Dana', lastName: 'Unlucky' })
      .expect(201);
    thirdUserId = (created.body as UserDto).id;
    const inviteUrl = (created.body as UserDto).inviteUrl!;
    expect(inviteUrl).toBeTruthy();

    await request(http)
      .delete(`/api/v1/users/${thirdUserId}`)
      .set(auth(adminToken))
      .expect(200);

    const token = extractToken(inviteUrl);
    // `deactivate()` invalidates the user's open tokens as part of the same
    // transaction (defense in depth), so this hits the "token already used"
    // branch (401) rather than the "disabled account" branch (400) — both are
    // a rejection of the deactivated user's invitation link, which is the
    // guarantee under test (see auth.service.ts resetPassword).
    const attempt = await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: PASSWORD });
    expect([400, 401]).toContain(attempt.status);
  });

  it('11. the warehouse user can be deactivated and reactivated straight to ACTIVE', async () => {
    const deactivated = await request(http)
      .delete(`/api/v1/users/${whUserId}`)
      .set(auth(adminToken))
      .expect(200);
    expect((deactivated.body as UserDto).status).toBe('DISABLED');

    const reactivated = await request(http)
      .post(`/api/v1/users/${whUserId}/reactivate`)
      .set(auth(adminToken))
      .expect(200);
    expect((reactivated.body as UserDto).status).toBe('ACTIVE');
  });
});
