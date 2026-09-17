/**
 * E2E for phase 3: order splitting, manual route rebuild (reorder), user
 * invitation + password reset, and the webhook outbox with retries.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 3 (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P3${Date.now().toString(36).toUpperCase()}`;
  const ids = {
    customer: '',
    origin: '',
    destination: '',
    order: '',
    shipmentA: '',
    shipmentB: '',
    load: '',
    integration: '',
  };

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    // This suite deliberately points a webhook at an unreachable loopback port
    // (127.0.0.1:9) to exercise the outbox retry path: the SSRF egress guard
    // must be relaxed first, exactly like integrations.e2e-spec.ts. Set BEFORE
    // the module compiles — ConfigService snapshots process.env at init.
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'true';

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
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('splits an order into two shipments at planning time', async () => {
    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'Split Customer' })
      .expect(201);
    ids.customer = customer.body.id;

    for (const [field, code] of [
      ['origin', `${suffix}-ORI`],
      ['destination', `${suffix}-DST`],
    ] as const) {
      const location = await request(http)
        .post('/api/v1/transportation/locations')
        .set(auth())
        .send({
          code,
          name: code,
          type: 'WAREHOUSE',
          addressLine1: '1 Test',
          city: 'Trois-Rivières',
        })
        .expect(201);
      ids[field] = location.body.id;
    }

    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        totalWeightKg: 9000,
        palletCount: 18,
      })
      .expect(201);
    ids.order = order.body.id;

    await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/confirm`)
      .set(auth())
      .expect(201);

    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/plan`)
      .set(auth())
      .send({
        shipments: [
          { weightKg: 6000, palletCount: 12 },
          { weightKg: 3000, palletCount: 6 },
        ],
      })
      .expect(201);
    expect(planned.body.status).toBe('PLANNED');
    expect(planned.body.shipments).toHaveLength(2);
    [ids.shipmentA, ids.shipmentB] = planned.body.shipments.map((s: { id: string }) => s.id);
  });

  it('consolidates both shipments on one load and rebuilds the route manually', async () => {
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    ids.load = load.body.id;

    for (const shipmentId of [ids.shipmentA, ids.shipmentB]) {
      await request(http)
        .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
        .set(auth())
        .send({ loadId: ids.load })
        .expect(201);
    }

    // First build: pickups then deliveries (the v0 auto-generated shape).
    await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: ids.load,
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: ids.origin, shipmentId: ids.shipmentA },
          { sequence: 2, type: 'PICKUP', locationId: ids.origin, shipmentId: ids.shipmentB },
          { sequence: 3, type: 'DELIVERY', locationId: ids.destination, shipmentId: ids.shipmentA },
          { sequence: 4, type: 'DELIVERY', locationId: ids.destination, shipmentId: ids.shipmentB },
        ],
      })
      .expect(201);

    // Manual rebuild: reorder (deliver B before A) and set planned times + distance.
    const rebuilt = await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: ids.load,
        totalDistanceKm: 142,
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: ids.origin, shipmentId: ids.shipmentA },
          { sequence: 2, type: 'PICKUP', locationId: ids.origin, shipmentId: ids.shipmentB },
          {
            sequence: 3,
            type: 'DELIVERY',
            locationId: ids.destination,
            shipmentId: ids.shipmentB,
            plannedArrivalEarly: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          },
          { sequence: 4, type: 'DELIVERY', locationId: ids.destination, shipmentId: ids.shipmentA },
        ],
      })
      .expect(201);
    expect(rebuilt.body.totalDistanceKm).toBe(142);
    expect(rebuilt.body.stops[2].shipmentId).toBe(ids.shipmentB);
    expect(rebuilt.body.stops[2].plannedArrivalEarly).toBeDefined();
  });

  it('invites a user and activates the account through the invitation link', async () => {
    const email = `${suffix.toLowerCase()}@example.com`;
    const invited = await request(http)
      .post('/api/v1/users')
      .set(auth())
      .send({ email, firstName: 'Invited', lastName: 'User' })
      .expect(201);
    expect(invited.body.status).toBe('INVITED');
    expect(invited.body.inviteUrl).toContain('/reset-password/');

    const inviteToken = invited.body.inviteUrl.split('/reset-password/')[1];

    // The invited account cannot sign in before setting a password.
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: 'whatever-123', tenant: 'acme' })
      .expect(401);

    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteToken, password: 'S3cure-pass!' })
      .expect(200);

    // One-shot: the same link cannot be replayed.
    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteToken, password: 'another-pass-1' })
      .expect(401);

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: 'S3cure-pass!', tenant: 'acme' })
      .expect(200);
    expect(login.body.user.email).toBe(email);
  });

  it('forgot-password never discloses whether the account exists', async () => {
    const known = await request(http)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'admin@pulsar.dev', tenant: 'acme' })
      .expect(200);
    const unknown = await request(http)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@nowhere.example' })
      .expect(200);
    expect(known.body).toEqual(unknown.body);

    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'forged-token', password: 'irrelevant-123' })
      .expect(401);
  });

  it('webhook outbox records deliveries and schedules retries on failure', async () => {
    const integration = await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: `webhook-${suffix.toLowerCase()}`,
        name: 'Phase3 webhook',
        config: { url: 'http://127.0.0.1:9/unreachable', events: ['load.dispatched'] },
      })
      .expect(201);
    ids.integration = integration.body.id;
    await request(http)
      .patch(`/api/v1/integrations/${ids.integration}`)
      .set(auth())
      .send({ status: 'ENABLED' })
      .expect(200);

    // Dispatch the load → emits load.dispatched → outbox row (delivery fails: port 9).
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/assign`)
      .set(auth())
      .send({})
      .expect(201);
    const carriers = await request(http)
      .get('/api/v1/transportation/carriers')
      .set(auth())
      .expect(200);
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/assign`)
      .set(auth())
      .send({ carrierId: carriers.body.items[0].id })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/dispatch`)
      .set(auth())
      .expect(201);

    // The domain-event → outbox bridge is fire-and-forget (DomainEventsService
    // never extends the caller's path), so the row — and its first, failing
    // attempt — land just after the dispatch response. Poll instead of racing.
    let deliveries = await request(http)
      .get(`/api/v1/integrations/${ids.integration}/deliveries`)
      .set(auth())
      .expect(200);
    for (let i = 0; i < 60 && (deliveries.body[0]?.attempts ?? 0) < 1; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      deliveries = await request(http)
        .get(`/api/v1/integrations/${ids.integration}/deliveries`)
        .set(auth())
        .expect(200);
    }
    expect(deliveries.body.length).toBeGreaterThanOrEqual(1);
    const delivery = deliveries.body[0];
    expect(delivery.event).toBe('load.dispatched');
    expect(delivery.status).toBe('PENDING'); // first attempt failed, retry scheduled
    expect(delivery.attempts).toBe(1);
    expect(delivery.lastError).toBeTruthy();
    expect(new Date(delivery.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
  });
});
