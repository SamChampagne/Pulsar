/**
 * E2E for portal accounts (customer-portal): staff-issued invitations, portal
 * account activation/login, the ADMIN/MEMBER self-service split, disable /
 * reactivate lifecycle, cross-plane token isolation, module-gating on the
 * portal session, and the refresh/logout rotation.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

interface PortalUserAdminDto {
  id: string;
  email: string;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  role: 'ADMIN' | 'MEMBER';
  invitation: { expiresAt: string; expired: boolean } | null;
  inviteUrl?: string;
}

interface PortalLoginResponseDto {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: 'ADMIN' | 'MEMBER' };
  customer: { id: string; name: string };
  shipper: { name: string };
  branding: Record<string, unknown>;
}

function extractActivationToken(inviteUrl: string): string {
  return inviteUrl.split('/portal/activate/')[1];
}

const PASSWORD = 'PortalPassw0rd!1';

describe('Portal accounts (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken = ''; // tenant staff JWT
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const suffix = `PA${Date.now().toString(36).toUpperCase()}`;
  const adminEmail = `portal-admin-${suffix}@example.com`.toLowerCase();
  const memberEmail = `portal-member-${suffix}@example.com`.toLowerCase();

  const ids = { customer: '', origin: '', destination: '' };
  const originCode = `${suffix}-WH`;
  const destinationCode = `${suffix}-CS`;

  // portal-side state threaded across ordered `it` blocks
  let adminInviteUrl = '';
  let adminPortalUserId = '';
  let adminAccessToken = '';
  let adminRefreshToken = '';
  let memberInviteToken = '';
  let memberPortalUserId = '';
  let memberAccessToken = '';

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
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    adminToken = (login.body as { accessToken: string }).accessToken;

    // Module must be enabled before any customer-portal endpoint works.
    await request(http)
      .patch('/api/v1/modules/customer-portal')
      .set(auth(adminToken))
      .send({ enabled: true })
      .expect(200);

    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth(adminToken))
      .send({ code: `${suffix}-CUST`, name: 'Portal Accounts Customer' })
      .expect(201);
    ids.customer = (customer.body as { id: string }).id;

    const origin = await request(http)
      .post('/api/v1/locations')
      .set(auth(adminToken))
      .send({
        code: originCode,
        name: 'Portal Accounts Warehouse',
        type: 'WAREHOUSE',
        addressLine1: '1 Depot St',
        city: 'Gatineau',
        latitude: 45.4765,
        longitude: -75.7013,
      })
      .expect(201);
    ids.origin = (origin.body as { id: string }).id;

    const destination = await request(http)
      .post('/api/v1/locations')
      .set(auth(adminToken))
      .send({
        code: destinationCode,
        name: 'Portal Accounts Customer Site',
        type: 'CUSTOMER_SITE',
        customerId: ids.customer,
        addressLine1: '2 Dock Ave',
        city: 'Ottawa',
        latitude: 45.4215,
        longitude: -75.6972,
      })
      .expect(201);
    ids.destination = (destination.body as { id: string }).id;
  });

  afterAll(async () => {
    // Safety net: other suites depend on the module staying enabled.
    await request(http)
      .patch('/api/v1/modules/customer-portal')
      .set(auth(adminToken))
      .send({ enabled: true });
    await app.close();
  });

  it('1. staff invites a portal ADMIN -> 201 INVITED with an inviteUrl', async () => {
    const res = await request(http)
      .post(`/api/v1/customer-portal/customers/${ids.customer}/users`)
      .set(auth(adminToken))
      .send({ email: adminEmail, firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' })
      .expect(201);
    const body = res.body as PortalUserAdminDto;
    expect(body.status).toBe('INVITED');
    expect(body.role).toBe('ADMIN');
    expect(body.inviteUrl).toBeTruthy();
    adminPortalUserId = body.id;
    adminInviteUrl = body.inviteUrl!;
  });

  it('2. POST /portal/auth/reset-password consumes the invitation and activates the ADMIN', async () => {
    const token = extractActivationToken(adminInviteUrl);
    await request(http)
      .post('/api/v1/portal/auth/reset-password')
      .send({ token, password: PASSWORD })
      .expect(200);
  });

  it('3. ADMIN logs in and GET /portal/auth/me reports role ADMIN', async () => {
    const login = await request(http)
      .post('/api/v1/portal/auth/login')
      .send({ email: adminEmail, password: PASSWORD, tenant: 'acme' })
      .expect(200);
    const body = login.body as PortalLoginResponseDto;
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.role).toBe('ADMIN');
    expect(body.customer.id).toBe(ids.customer);
    expect(body.shipper.name).toBeTruthy();
    adminAccessToken = body.accessToken;
    adminRefreshToken = body.refreshToken;

    const me = await request(http)
      .get('/api/v1/portal/auth/me')
      .set(auth(adminAccessToken))
      .expect(200);
    expect((me.body as { role: string }).role).toBe('ADMIN');
  });

  it('4. GET /portal/view is 200 and never leaks tenantId or passwordHash', async () => {
    const view = await request(http)
      .get('/api/v1/portal/view')
      .set(auth(adminAccessToken))
      .expect(200);
    const raw = JSON.stringify(view.body);
    expect(raw).not.toContain('tenantId');
    expect(raw).not.toContain('passwordHash');
  });

  it('5. POST /portal/orders creates a transport order from location codes', async () => {
    const created = await request(http)
      .post('/api/v1/portal/orders')
      .set(auth(adminAccessToken))
      .send({
        originLocationId: originCode,
        destinationLocationId: destinationCode,
        totalWeightKg: 100,
        palletCount: 1,
      })
      .expect(201);
    expect((created.body as { orderNumber: string }).orderNumber).toMatch(/^TO-/);
  });

  it('6. ADMIN self-service invites a MEMBER -> 201 INVITED', async () => {
    const res = await request(http)
      .post('/api/v1/portal/users')
      .set(auth(adminAccessToken))
      .send({ email: memberEmail, firstName: 'Mo', lastName: 'Member', role: 'MEMBER' })
      .expect(201);
    const body = res.body as PortalUserAdminDto;
    expect(body.status).toBe('INVITED');
    expect(body.role).toBe('MEMBER');
    expect(body.inviteUrl).toBeTruthy();
    memberPortalUserId = body.id;
    memberInviteToken = extractActivationToken(body.inviteUrl!);
  });

  it('7. activates and logs the MEMBER in', async () => {
    await request(http)
      .post('/api/v1/portal/auth/reset-password')
      .send({ token: memberInviteToken, password: PASSWORD })
      .expect(200);

    const login = await request(http)
      .post('/api/v1/portal/auth/login')
      .send({ email: memberEmail, password: PASSWORD, tenant: 'acme' })
      .expect(200);
    const body = login.body as PortalLoginResponseDto;
    expect(body.user.role).toBe('MEMBER');
    memberAccessToken = body.accessToken;

    const me = await request(http)
      .get('/api/v1/portal/auth/me')
      .set(auth(memberAccessToken))
      .expect(200);
    expect((me.body as { role: string }).role).toBe('MEMBER');
  });

  it('8. MEMBER cannot manage colleagues (403) but can view the portal (200)', async () => {
    await request(http)
      .post('/api/v1/portal/users')
      .set(auth(memberAccessToken))
      .send({ email: `blocked-${suffix}@example.com`, firstName: 'X', lastName: 'Y' })
      .expect(403);

    await request(http).get('/api/v1/portal/view').set(auth(memberAccessToken)).expect(200);
  });

  it('9. cross-plane isolation: a portal bearer never reaches tenant/platform routes, and vice versa', async () => {
    await request(http).get('/api/v1/users').set(auth(memberAccessToken)).expect(401);
    await request(http).get('/api/v1/platform/operations').set(auth(memberAccessToken)).expect(401);
    await request(http).get('/api/v1/portal/view').set(auth(adminToken)).expect(401);
  });

  it('10. staff disables the MEMBER: login fails and the consumed invitation cannot be replayed', async () => {
    const deactivated = await request(http)
      .delete(`/api/v1/customer-portal/customers/${ids.customer}/users/${memberPortalUserId}`)
      .set(auth(adminToken))
      .expect(200);
    expect((deactivated.body as PortalUserAdminDto).status).toBe('DISABLED');

    await request(http)
      .post('/api/v1/portal/auth/login')
      .send({ email: memberEmail, password: PASSWORD, tenant: 'acme' })
      .expect(401);

    await request(http)
      .post('/api/v1/portal/auth/reset-password')
      .send({ token: memberInviteToken, password: 'AnotherPassw0rd!1' })
      .expect(401);
  });

  it('11. an ADMIN cannot deactivate their own portal account', async () => {
    await request(http)
      .delete(`/api/v1/portal/users/${adminPortalUserId}`)
      .set(auth(adminAccessToken))
      .expect(400);
  });

  it('12. disabling the module blocks the live portal session; re-enabling restores it', async () => {
    await request(http)
      .patch('/api/v1/modules/customer-portal')
      .set(auth(adminToken))
      .send({ enabled: false })
      .expect(200);

    await request(http).get('/api/v1/portal/view').set(auth(adminAccessToken)).expect(403);

    await request(http)
      .patch('/api/v1/modules/customer-portal')
      .set(auth(adminToken))
      .send({ enabled: true })
      .expect(200);

    await request(http).get('/api/v1/portal/view').set(auth(adminAccessToken)).expect(200);
  });

  it('13. refresh rotates the session, logout revokes it, and a replayed refresh token fails', async () => {
    const refreshed = await request(http)
      .post('/api/v1/portal/auth/refresh')
      .send({ refreshToken: adminRefreshToken })
      .expect(200);
    const body = refreshed.body as PortalLoginResponseDto;
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.refreshToken).not.toBe(adminRefreshToken);

    await request(http)
      .post('/api/v1/portal/auth/logout')
      .send({ refreshToken: body.refreshToken })
      .expect(200);

    await request(http)
      .post('/api/v1/portal/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(401);
  });
});
