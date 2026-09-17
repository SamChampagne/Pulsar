/**
 * E2E inbound webhook receiver (task C2) — POST /public/hooks/:inboundToken.
 *
 *   S1  token issue   POST /integrations/:id/inbound-token returns the raw token ONCE
 *                     and the partner URL; the config never echoes it back.
 *   S2  happy path    a partner-shaped JSON body is mapped (codes → ids) and creates a
 *                     real TransportOrder, visible through the TMS API.
 *   S3  idempotency   the same body with the same X-Idempotency-Key answers 200 with
 *                     `replayed: true` and creates NOTHING a second time.
 *   S4  HMAC          a receiver with config.inboundSecret refuses a bad signature (401)
 *                     and accepts the right one over the RAW bytes.
 *   S5  unknown token an unknown token is a generic 404.
 *   S6  upsert        target location.upsert twice updates the same row (natural key).
 *   S7  module gate   transportation disabled → 403 (rule 15; re-enabled afterwards).
 *   S8  rotation      re-issuing the token invalidates the previous one.
 *   S9  config perms  a staff user holding core.integrations.manage but NOT the target's
 *                     own permission cannot point a receiver at it nor issue its token (403).
 *   S10 pollution     a mapping target walking __proto__ is refused at save time (400).
 *   S11 projection    GET /integrations exposes hasInboundToken, never inboundTokenHash.
 *
 * Fully offline: the receiver is the app itself, no outbound call.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const SECRET = 'inbound-e2e-secret';

describe('Inbound webhook receiver (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const customerCode = `HOOK-CUST-${suffix}`;
  const originCode = `HOOK-ORIG-${suffix}`;
  const destinationCode = `HOOK-DEST-${suffix}`;
  const upsertCode = `HOOK-LOC-${suffix}`;

  const orderIntegrationKey = `inbound-hook-order-${suffix}`;
  const signedIntegrationKey = `inbound-hook-signed-${suffix}`;
  const locationIntegrationKey = `inbound-hook-location-${suffix}`;

  const limitedRoleKey = `hook-limited-${suffix}`.slice(0, 40);
  const limitedEmail = `hook-limited-${suffix}@acme.test`;
  const LIMITED_PASSWORD = 'Hooks123!';
  let limitedRoleId = '';
  let limitedUserId = '';
  let limitedToken = '';

  let orderHookToken = '';
  let signedHookToken = '';
  let locationHookToken = '';
  let orderIntegrationId = '';
  let signedIntegrationId = '';

  /** Partner payload: nothing Pulsar-shaped, everything goes through the mapping. */
  const partnerOrder = (reference: string) => ({
    order: {
      reference,
      account: { number: customerCode },
      pickup: { site: originCode },
      dropoff: { site: destinationCode },
      weight_kg: '1250.5',
    },
    meta: { apiKey: 'must-not-be-stored' },
  });

  const orderMappings = [
    { source: 'order.account.number', target: 'customerCode', transform: 'uppercase' },
    { source: 'order.pickup.site', target: 'originCode', transform: 'uppercase' },
    { source: 'order.dropoff.site', target: 'destinationCode', transform: 'uppercase' },
    { source: 'order.reference', target: 'customerReference', transform: 'trim' },
    { source: 'order.weight_kg', target: 'totalWeightKg', transform: 'number' },
    { source: 'order.mode', target: 'mode', transform: 'default:FTL' },
  ];

  async function createReceiver(
    key: string,
    config: Record<string, unknown>,
  ): Promise<{ id: string; token: string }> {
    const created = await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({ key, name: `Inbound ${key}`, status: 'ENABLED', config })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const issued = await request(http)
      .post(`/api/v1/integrations/${id}/inbound-token`)
      .set(auth())
      .expect(201);
    return { id, token: (issued.body as { token: string }).token };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // rawBody mirrors main.ts: the HMAC is verified over the exact bytes received.
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    // Master data the mapping resolves by code.
    await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: customerCode, name: `Hook customer ${suffix}` })
      .expect(201);
    for (const [code, name] of [
      [originCode, 'Hook origin'],
      [destinationCode, 'Hook destination'],
    ]) {
      await request(http)
        .post('/api/v1/locations')
        .set(auth())
        .send({
          code,
          name: `${name} ${suffix}`,
          type: 'WAREHOUSE',
          addressLine1: '1 rue du Test',
          city: 'Montréal',
        })
        .expect(201);
    }

    const orderHook = await createReceiver(orderIntegrationKey, {
      target: 'transport-order.create',
      mappings: orderMappings,
    });
    orderIntegrationId = orderHook.id;
    orderHookToken = orderHook.token;

    const signedHook = await createReceiver(signedIntegrationKey, {
      target: 'transport-order.create',
      mappings: orderMappings,
      inboundSecret: SECRET,
    });
    signedIntegrationId = signedHook.id;
    signedHookToken = signedHook.token;

    const locationHook = await createReceiver(locationIntegrationKey, {
      target: 'location.upsert',
      mappings: [
        { source: 'site.code', target: 'code' },
        { source: 'site.label', target: 'name' },
        { source: 'site.kind', target: 'type' },
        { source: 'site.address', target: 'addressLine1' },
        { source: 'site.city', target: 'city' },
      ],
    });
    locationHookToken = locationHook.token;
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      const tenant = await prisma.tenant.findUnique({ where: { slug: 'acme' } });
      const tenantId = tenant?.id ?? '';
      await prisma.transportOrder
        .deleteMany({ where: { tenantId, customerReference: { startsWith: `REF-${suffix}` } } })
        .catch(() => undefined);
      await prisma.inboundMessage
        .deleteMany({ where: { tenantId, source: 'WEBHOOK', kind: { not: null } } })
        .catch(() => undefined);
      await prisma.location
        .deleteMany({
          where: { tenantId, code: { in: [originCode, destinationCode, upsertCode] } },
        })
        .catch(() => undefined);
      await prisma.customer
        .deleteMany({ where: { tenantId, code: customerCode } })
        .catch(() => undefined);
      await prisma.integration
        .deleteMany({
          where: {
            tenantId,
            key: {
              in: [
                orderIntegrationKey,
                signedIntegrationKey,
                locationIntegrationKey,
                `inbound-hook-neutral-${suffix}`,
              ],
            },
          },
        })
        .catch(() => undefined);
      if (limitedUserId) {
        await prisma.userRole
          .deleteMany({ where: { userId: limitedUserId } })
          .catch(() => undefined);
        await prisma.refreshToken
          .deleteMany({ where: { userId: limitedUserId } })
          .catch(() => undefined);
        await prisma.userActionToken
          .deleteMany({ where: { userId: limitedUserId } })
          .catch(() => undefined);
        await prisma.user.delete({ where: { id: limitedUserId } }).catch(() => undefined);
      }
      if (limitedRoleId) {
        await prisma.rolePermission
          .deleteMany({ where: { roleId: limitedRoleId } })
          .catch(() => undefined);
        await prisma.role.delete({ where: { id: limitedRoleId } }).catch(() => undefined);
      }
    }
    if (app) await app.close();
  }, 60_000);

  // S1 ------------------------------------------------------------------------
  it('S1 issues the token once and never echoes it in the integration config', async () => {
    expect(orderHookToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const list = await request(http).get('/api/v1/integrations').set(auth()).expect(200);
    const row = (list.body as Array<{ key: string; config: Record<string, unknown> }>).find(
      (i) => i.key === orderIntegrationKey,
    );
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(orderHookToken);
    // The secret of the signed receiver is masked too.
    const signed = (list.body as Array<{ key: string; config: Record<string, unknown> }>).find(
      (i) => i.key === signedIntegrationKey,
    );
    expect(signed?.config.inboundSecret).toBe('***');
  });

  // S2 ------------------------------------------------------------------------
  it('S2 maps a partner payload and creates a real transport order', async () => {
    const reference = `REF-${suffix}-A`;
    const res = await request(http)
      .post(`/api/v1/public/hooks/${orderHookToken}`)
      .send(partnerOrder(reference))
      .expect(202);

    expect(res.body).toMatchObject({ status: 'IMPORTED', entityType: 'transport-order' });
    expect(res.body.inboxId).toBeTruthy();
    expect(res.body.replayed).toBeUndefined();

    const orders = await request(http)
      .get(`/api/v1/transportation/transport-orders?search=${reference}`)
      .set(auth())
      .expect(200);
    const items = (orders.body as { items: Array<Record<string, any>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0].customerReference).toBe(reference);
    expect(Number(items[0].totalWeightKg)).toBe(1250.5);
    expect(items[0].mode).toBe('FTL'); // default:FTL transform
    expect(items[0].customer.code).toBe(customerCode);
    expect(items[0].originLocation.code).toBe(originCode);

    // The inbox row keeps a redacted copy, never the partner credential.
    const inbox = await request(http)
      .get(`/api/v1/connect/inbox/${res.body.inboxId}`)
      .set(auth())
      .expect(200);
    expect(inbox.body.source).toBe('WEBHOOK');
    expect(inbox.body.status).toBe('IMPORTED');
    expect(JSON.stringify(inbox.body.parsed)).not.toContain('must-not-be-stored');
  });

  // S3 ------------------------------------------------------------------------
  it('S3 replays an identical delivery without creating a second order', async () => {
    const reference = `REF-${suffix}-B`;
    const body = partnerOrder(reference);
    const key = `delivery-${suffix}-B`;

    const first = await request(http)
      .post(`/api/v1/public/hooks/${orderHookToken}`)
      .set('X-Idempotency-Key', key)
      .send(body)
      .expect(202);
    expect(first.body.status).toBe('IMPORTED');

    const replay = await request(http)
      .post(`/api/v1/public/hooks/${orderHookToken}`)
      .set('X-Idempotency-Key', key)
      .send(body)
      .expect(200);
    expect(replay.body).toMatchObject({
      inboxId: first.body.inboxId,
      status: 'IMPORTED',
      replayed: true,
    });

    const orders = await request(http)
      .get(`/api/v1/transportation/transport-orders?search=${reference}`)
      .set(auth())
      .expect(200);
    expect((orders.body as { total: number }).total).toBe(1);
  });

  // S4 ------------------------------------------------------------------------
  it('S4 enforces the HMAC signature when the receiver declares a secret', async () => {
    const reference = `REF-${suffix}-C`;
    const raw = JSON.stringify(partnerOrder(reference));

    await request(http)
      .post(`/api/v1/public/hooks/${signedHookToken}`)
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'sha256=deadbeef')
      .send(raw)
      .expect(401);

    await request(http)
      .post(`/api/v1/public/hooks/${signedHookToken}`)
      .set('Content-Type', 'application/json')
      .send(raw)
      .expect(401);

    const signature = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
    const ok = await request(http)
      .post(`/api/v1/public/hooks/${signedHookToken}`)
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw)
      .expect(202);
    expect(ok.body.status).toBe('IMPORTED');
  });

  // S4b -----------------------------------------------------------------------
  it('S4b a partial PATCH (name only) keeps the receiver armed — config is merged', async () => {
    // The generic Studio form knows nothing about `target`/`inboundSecret`: a
    // PATCH that replaced the config would silently disarm the HMAC and drop
    // the target on the next "Save".
    await request(http)
      .patch(`/api/v1/integrations/${signedIntegrationId}`)
      .set(auth())
      .send({ name: `Inbound renamed ${suffix}` })
      .expect(200);

    const reference = `REF-${suffix}-C2`;
    const raw = JSON.stringify(partnerOrder(reference));

    await request(http)
      .post(`/api/v1/public/hooks/${signedHookToken}`)
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'sha256=deadbeef')
      .send(raw)
      .expect(401);

    const signature = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
    const ok = await request(http)
      .post(`/api/v1/public/hooks/${signedHookToken}`)
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(raw)
      .expect(202);
    // Still routed to its target: the merge kept `target` and the mappings.
    expect(ok.body).toMatchObject({ status: 'IMPORTED', entityType: 'transport-order' });
  });

  // S5 ------------------------------------------------------------------------
  it('S5 answers a generic 404 for an unknown token', async () => {
    await request(http)
      .post(`/api/v1/public/hooks/${'x'.repeat(43)}`)
      .send({ any: 'thing' })
      .expect(404);
  });

  // S6 ------------------------------------------------------------------------
  it('S6 upserts a location on its natural key instead of duplicating it', async () => {
    const payload = (label: string) => ({
      site: {
        code: upsertCode,
        label,
        kind: 'WAREHOUSE',
        address: '10 rue des Quais',
        city: 'Laval',
      },
    });

    const created = await request(http)
      .post(`/api/v1/public/hooks/${locationHookToken}`)
      .send(payload('Entrepôt v1'))
      .expect(202);
    expect(created.body).toMatchObject({ status: 'IMPORTED', entityType: 'location' });

    const updated = await request(http)
      .post(`/api/v1/public/hooks/${locationHookToken}`)
      .send(payload('Entrepôt v2'))
      .expect(202);
    expect(updated.body.status).toBe('IMPORTED');
    expect(updated.body.entityId).toBe(created.body.entityId);

    const list = await request(http)
      .get(`/api/v1/locations?search=${upsertCode}`)
      .set(auth())
      .expect(200);
    const items = (list.body as { items: Array<{ code: string; name: string }> }).items.filter(
      (l) => l.code === upsertCode,
    );
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Entrepôt v2');
  });

  // S9 ------------------------------------------------------------------------
  it('S9 refuses a receiver configuration the staff user could not perform itself (403)', async () => {
    // A user with core.integrations.* but WITHOUT transportation.orders.manage:
    // pointing a receiver at transport-order.create would hand a partner a write
    // this user cannot do — 403 at configuration time (the delivery itself runs
    // as the service-account, so this is the only place the check can live).
    const role = await request(http)
      .post('/api/v1/roles')
      .set(auth())
      .send({
        key: limitedRoleKey,
        name: `Hook limited ${suffix}`,
        permissionKeys: ['core.integrations.read', 'core.integrations.manage'],
      })
      .expect(201);
    limitedRoleId = (role.body as { id: string }).id;

    const created = await request(http)
      .post('/api/v1/users')
      .set(auth())
      .send({
        email: limitedEmail,
        firstName: 'Hook',
        lastName: 'Limited',
        roleIds: [limitedRoleId],
      })
      .expect(201);
    const invited = created.body as { id: string; inviteUrl: string };
    limitedUserId = invited.id;
    const inviteToken = invited.inviteUrl.split('/reset-password/')[1];
    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteToken, password: LIMITED_PASSWORD })
      .expect(200);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: limitedEmail, password: LIMITED_PASSWORD, tenant: 'acme' })
      .expect(200);
    limitedToken = (login.body as { accessToken: string }).accessToken;
    const limitedAuth = () => ({ Authorization: `Bearer ${limitedToken}` });

    // Cannot CREATE a receiver pointing at transport-order.create...
    await request(http)
      .post('/api/v1/integrations')
      .set(limitedAuth())
      .send({
        key: `inbound-hook-denied-${suffix}`,
        name: 'Denied receiver',
        status: 'ENABLED',
        config: { target: 'transport-order.create' },
      })
      .expect(403);

    // ...nor ISSUE a token for an existing one.
    await request(http)
      .post(`/api/v1/integrations/${orderIntegrationId}/inbound-token`)
      .set(limitedAuth())
      .expect(403);

    // A core target it DOES hold nothing for is refused as well; but a receiver
    // with no target at all stays configurable (nothing is delegated yet).
    const neutral = await request(http)
      .post('/api/v1/integrations')
      .set(limitedAuth())
      .send({ key: `inbound-hook-neutral-${suffix}`, name: 'Neutral', status: 'DISABLED' })
      .expect(201);
    await request(http)
      .patch(`/api/v1/integrations/${(neutral.body as { id: string }).id}`)
      .set(limitedAuth())
      .send({ config: { target: 'customer.upsert' } })
      .expect(403);
  });

  // S10 -----------------------------------------------------------------------
  it('S10 refuses a prototype-walking mapping target at save time (400)', async () => {
    await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: `inbound-hook-proto-${suffix}`,
        name: 'Proto receiver',
        status: 'DISABLED',
        config: {
          target: 'customer.upsert',
          mappings: [{ source: 'a', target: '__proto__.polluted' }],
        },
      })
      .expect(400);

    await request(http)
      .patch(`/api/v1/integrations/${orderIntegrationId}`)
      .set(auth())
      .send({ config: { mappings: [{ source: 'a', target: 'constructor.prototype.x' }] } })
      .expect(400);

    // The receiver still works with its original mapping — nothing was stored.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  // S11 -----------------------------------------------------------------------
  it('S11 exposes hasInboundToken, never the token hash', async () => {
    const list = await request(http).get('/api/v1/integrations').set(auth()).expect(200);
    const rows = list.body as Array<Record<string, unknown>>;
    const withToken = rows.find((r) => r.key === orderIntegrationKey);
    const withoutToken = rows.find((r) => r.key === `inbound-hook-neutral-${suffix}`);
    expect(withToken?.hasInboundToken).toBe(true);
    expect(withToken).not.toHaveProperty('inboundTokenHash');
    expect(JSON.stringify(rows)).not.toContain('inboundTokenHash');
    if (withoutToken) expect(withoutToken.hasInboundToken).toBe(false);
  });

  // S7 ------------------------------------------------------------------------
  it('S7 refuses the delivery when the target module is disabled (rule 15)', async () => {
    await request(http)
      .patch('/api/v1/modules/transportation')
      .set(auth())
      .send({ enabled: false })
      .expect(200);
    try {
      await request(http)
        .post(`/api/v1/public/hooks/${orderHookToken}`)
        .send(partnerOrder(`REF-${suffix}-D`))
        .expect(403);
    } finally {
      await request(http)
        .patch('/api/v1/modules/transportation')
        .set(auth())
        .send({ enabled: true })
        .expect(200);
    }
  });

  // S8 ------------------------------------------------------------------------
  it('S8 rotates the token: the previous one stops working', async () => {
    const issued = await request(http)
      .post(`/api/v1/integrations/${orderIntegrationId}/inbound-token`)
      .set(auth())
      .expect(201);
    const rotated = (issued.body as { token: string; url: string }).token;
    expect(rotated).not.toBe(orderHookToken);
    expect((issued.body as { url: string }).url).toContain(`/api/v1/public/hooks/${rotated}`);

    await request(http)
      .post(`/api/v1/public/hooks/${orderHookToken}`)
      .send(partnerOrder(`REF-${suffix}-E`))
      .expect(404);

    const ok = await request(http)
      .post(`/api/v1/public/hooks/${rotated}`)
      .send(partnerOrder(`REF-${suffix}-F`))
      .expect(202);
    expect(ok.body.status).toBe('IMPORTED');
    orderHookToken = rotated;
  });
});
