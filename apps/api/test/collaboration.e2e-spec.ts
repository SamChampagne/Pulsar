/**
 * E2E for the collaboration layer: refresh tokens, carrier tendering through
 * public tokenized links, public shipment tracking, the driver page
 * (stops + POD + photo upload) and the estimated cost engine.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Collaboration & cost (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;
  let refreshToken: string;

  const suffix = `C${Date.now().toString(36).toUpperCase()}`;
  const ids = {
    customer: '',
    origin: '',
    destination: '',
    carrier: '',
    rate: '',
    order: '',
    shipment: '',
    load: '',
    tenderToken: '',
    trackingUrl: '',
    driverUrl: '',
  };

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const publicPath = (url: string) => new URL(url).pathname.replace(/^\/(tender|track|driver)\//, '');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in and rotates the refresh token', async () => {
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    expect(login.body.refreshToken).toBeDefined();

    const refreshed = await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    token = refreshed.body.accessToken;
    refreshToken = refreshed.body.refreshToken;
    expect(refreshToken).not.toBe(login.body.refreshToken);

    // The old token is revoked after rotation.
    await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });

  it('prepares master data and a planned load with a per-pallet rate', async () => {
    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'Collab Customer' })
      .expect(201);
    ids.customer = customer.body.id;

    for (const [field, code, type] of [
      ['origin', `${suffix}-ORI`, 'PLANT'],
      ['destination', `${suffix}-DST`, 'CUSTOMER_SITE'],
    ] as const) {
      const location = await request(http)
        .post('/api/v1/transportation/locations')
        .set(auth())
        .send({ code, name: code, type, addressLine1: '1 Test', city: 'Québec' })
        .expect(201);
      ids[field] = location.body.id;
    }

    const carrier = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: `${suffix}-CARR`, name: 'Collab Carrier' })
      .expect(201);
    ids.carrier = carrier.body.id;

    const rate = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} per-pallet`,
        rateType: 'PER_PALLET',
        baseAmount: 50,
        fuelSurchargePct: 10,
        carrierId: ids.carrier,
      })
      .expect(201);
    ids.rate = rate.body.id;

    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        palletCount: 10,
        totalWeightKg: 4000,
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
      .expect(201);
    ids.shipment = planned.body.shipments[0].id;

    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    ids.load = load.body.id;

    await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipment}/assign-load`)
      .set(auth())
      .send({ loadId: ids.load })
      .expect(201);

    const assigned = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier, rateId: ids.rate })
      .expect(201);
    // Cost engine: 10 pallets × 50 + 10% fuel = 550.00
    expect(Number(assigned.body.estimatedCost)).toBe(550);

    // Route built while the load is still PLANNED (required for the driver page later).
    await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: ids.load,
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: ids.origin, shipmentId: ids.shipment },
          { sequence: 2, type: 'DELIVERY', locationId: ids.destination, shipmentId: ids.shipment },
        ],
      })
      .expect(201);
  });

  it('tenders the load and the carrier declines, returning it to PLANNED', async () => {
    const tender = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/tender`)
      .set(auth())
      .send({ message: 'Pickup Thursday AM' })
      .expect(201);
    expect(tender.body.responseUrl).toContain('/tender/');

    const t = publicPath(tender.body.responseUrl);
    const view = await request(http).get(`/api/v1/public/tenders/${t}`).expect(200);
    expect(view.body.status).toBe('PENDING');
    expect(view.body.load.loadNumber).toBeDefined();

    // P0-F: the carrier gets enough context to price the decision.
    expect(view.body).toHaveProperty('offeredRate');
    expect(view.body).toHaveProperty('offeredCurrency');
    expect(view.body.load).toHaveProperty('mode');
    expect(view.body.load).toHaveProperty('totalDistanceKm');
    const s0 = view.body.load.shipments[0];
    expect(s0).toHaveProperty('origin');
    expect(s0).toHaveProperty('destination');
    expect(s0).toHaveProperty('plannedPickupEarly');
    expect(s0).toHaveProperty('plannedDeliveryEarly');
    expect(s0).toHaveProperty('volumeM3');
    // Rule 10: no tenant internals in the public payload.
    expect(JSON.stringify(view.body)).not.toContain('tenantId');

    await request(http)
      .post(`/api/v1/public/tenders/${t}/decline`)
      .send({ reason: 'No capacity' })
      .expect(200);

    const load = await request(http)
      .get(`/api/v1/transportation/loads/${ids.load}`)
      .set(auth())
      .expect(200);
    expect(load.body.status).toBe('PLANNED');
  });

  it('tenders again, the carrier accepts, and dispatch becomes possible', async () => {
    const tender = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/tender`)
      .set(auth())
      .send({})
      .expect(201);
    ids.tenderToken = publicPath(tender.body.responseUrl);

    // Dispatch is blocked while the tender is unanswered.
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/dispatch`)
      .set(auth())
      .expect(400);

    await request(http).post(`/api/v1/public/tenders/${ids.tenderToken}/accept`).expect(200);

    // Double response is rejected.
    await request(http).post(`/api/v1/public/tenders/${ids.tenderToken}/accept`).expect(400);

    const dispatched = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/dispatch`)
      .set(auth())
      .expect(201);
    expect(dispatched.body.status).toBe('DISPATCHED');
  });

  it('shares a public tracking link for the shipment', async () => {
    const share = await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipment}/share`)
      .set(auth())
      .expect(201);
    ids.trackingUrl = share.body.url;

    const t = publicPath(ids.trackingUrl);
    const view = await request(http).get(`/api/v1/public/tracking/${t}`).expect(200);
    expect(view.body.status).toBe('DISPATCHED');
    expect(view.body.shipmentNumber).toMatch(/^SH-/);
    // No tenant ids leak in the public payload.
    expect(JSON.stringify(view.body)).not.toContain('tenantId');
  });

  it('drives the load from the public driver page (stops + POD + photo)', async () => {
    const link = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/driver-link`)
      .set(auth())
      .expect(201);
    ids.driverUrl = link.body.url;
    const t = publicPath(ids.driverUrl);

    await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/start-transit`)
      .set(auth())
      .expect(201);

    const view = await request(http).get(`/api/v1/public/driver/${t}`).expect(200);
    expect(view.body.stops).toHaveLength(2);
    const [pickup, delivery] = view.body.stops;

    await request(http)
      .post(`/api/v1/public/driver/${t}/stops/${pickup.id}/status`)
      .send({ status: 'ARRIVED' })
      .expect(200);
    await request(http)
      .post(`/api/v1/public/driver/${t}/stops/${pickup.id}/status`)
      .send({ status: 'DEPARTED' })
      .expect(200);
    // Drivers cannot report anything other than ARRIVED/DEPARTED.
    await request(http)
      .post(`/api/v1/public/driver/${t}/stops/${delivery.id}/status`)
      .send({ status: 'SKIPPED' })
      .expect(400);

    const pod = await request(http)
      .post(`/api/v1/public/driver/${t}/pod`)
      .send({ shipmentId: ids.shipment, signedByName: 'Door 4 Receiver' })
      .expect(201);
    expect(pod.body.signedByName).toBe('Door 4 Receiver');

    const photo = await request(http)
      .post(`/api/v1/public/driver/${t}/pod/${ids.shipment}/photo`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]), {
        filename: 'pod.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    expect(photo.body.storageKey).toContain('proof-of-delivery');

    // Revoked links stop working.
    await request(http)
      .delete(`/api/v1/transportation/loads/${ids.load}/driver-link`)
      .set(auth())
      .expect(200);
    await request(http).get(`/api/v1/public/driver/${t}`).expect(404);
  });

  it('logout revokes the refresh token', async () => {
    await request(http).post('/api/v1/auth/logout').send({ refreshToken }).expect(200);
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
  });
});
