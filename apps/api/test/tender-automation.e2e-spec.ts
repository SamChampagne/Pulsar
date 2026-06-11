/**
 * E2E for tender automation: lane carrier preferences and the auto-tender
 * chain (decline → automatic offer to the next carrier in the lane).
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Tender automation (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `A${Date.now().toString(36).toUpperCase()}`;
  const ids = {
    customer: '',
    origin: '',
    destination: '',
    carrierA: '',
    carrierB: '',
    lane: '',
    load: '',
    shipment: '',
  };

  const auth = () => ({ Authorization: `Bearer ${token}` });

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
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets up a lane with two preferred carriers', async () => {
    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'Auto Customer' })
      .expect(201);
    ids.customer = customer.body.id;

    for (const [field, code] of [
      ['origin', `${suffix}-ORI`],
      ['destination', `${suffix}-DST`],
    ] as const) {
      const location = await request(http)
        .post('/api/v1/transportation/locations')
        .set(auth())
        .send({ code, name: code, type: 'WAREHOUSE', addressLine1: '1 Test', city: 'Lévis' })
        .expect(201);
      ids[field] = location.body.id;
    }

    for (const [field, code, email] of [
      ['carrierA', `${suffix}-CA`, 'dispatch-a@example.com'],
      ['carrierB', `${suffix}-CB`, 'dispatch-b@example.com'],
    ] as const) {
      const carrier = await request(http)
        .post('/api/v1/transportation/carriers')
        .set(auth())
        .send({ code, name: `Carrier ${code}`, email })
        .expect(201);
      ids[field] = carrier.body.id;
    }

    const createdLane = await request(http)
      .post('/api/v1/transportation/lanes')
      .set(auth())
      .send({
        originType: 'LOCATION',
        origin: { locationId: ids.origin },
        destinationType: 'LOCATION',
        destination: { locationId: ids.destination },
      })
      .expect(201);
    ids.lane = createdLane.body.id;

    const lane = await request(http)
      .put(`/api/v1/transportation/lanes/${ids.lane}/carriers`)
      .set(auth())
      .send({ carrierIds: [ids.carrierA, ids.carrierB] })
      .expect(200);
    expect(lane.body.carrierPreferences).toHaveLength(2);
    expect(lane.body.carrierPreferences[0].rank).toBe(1);
  });

  it('builds a planned load on that lane', async () => {
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        palletCount: 6,
      })
      .expect(201);

    await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/plan`)
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
    // Assign a vehicle-less carrier-less load: auto-tender will pick the carrier.
    const assigned = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/assign`)
      .set(auth())
      .send({})
      .expect(201);
    expect(assigned.body.status).toBe('PLANNED');
  });

  it('auto-tenders to carrier A (rank 1) and emails the link', async () => {
    const tender = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/auto-tender`)
      .set(auth())
      .send({})
      .expect(201);
    expect(tender.body.carrier.id).toBe(ids.carrierA);
    expect(tender.body.isAuto).toBe(true);
    // EMAIL_DRIVER=log accepts everything → emailedTo reflects the carrier address.
    expect(tender.body.emailedTo).toBe('dispatch-a@example.com');

    const load = await request(http)
      .get(`/api/v1/transportation/loads/${ids.load}`)
      .set(auth())
      .expect(200);
    expect(load.body.status).toBe('TENDERED');
  });

  it('on decline, automatically offers to carrier B (rank 2)', async () => {
    const tenders = await request(http)
      .get(`/api/v1/transportation/loads/${ids.load}/tenders`)
      .set(auth())
      .expect(200);
    const pending = tenders.body.find((t: { status: string }) => t.status === 'PENDING');

    await request(http)
      .post(`/api/v1/public/tenders/${pending.token}/decline`)
      .send({ reason: 'No truck available' })
      .expect(200);

    const after = await request(http)
      .get(`/api/v1/transportation/loads/${ids.load}/tenders`)
      .set(auth())
      .expect(200);
    expect(after.body).toHaveLength(2);
    const next = after.body.find((t: { status: string }) => t.status === 'PENDING');
    expect(next).toBeDefined();
    expect(next.carrier.id).toBe(ids.carrierB);
    expect(next.isAuto).toBe(true);

    const load = await request(http)
      .get(`/api/v1/transportation/loads/${ids.load}`)
      .set(auth())
      .expect(200);
    expect(load.body.status).toBe('TENDERED');
    // The load's carrier follows the active tender.
    expect(load.body.carrier.id).toBe(ids.carrierB);
  });

  it('carrier B accepts; the chain ends and dispatch works', async () => {
    const tenders = await request(http)
      .get(`/api/v1/transportation/loads/${ids.load}/tenders`)
      .set(auth())
      .expect(200);
    const pending = tenders.body.find((t: { status: string }) => t.status === 'PENDING');

    await request(http).post(`/api/v1/public/tenders/${pending.token}/accept`).expect(200);

    const dispatched = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/dispatch`)
      .set(auth())
      .expect(201);
    expect(dispatched.body.status).toBe('DISPATCHED');
  });

  it('when every lane carrier declined, auto-tender refuses to start again', async () => {
    // Build a second load on the same lane and exhaust the list.
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/plan`)
      .set(auth())
      .expect(201);
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/shipments/${planned.body.shipments[0].id}/assign-load`)
      .set(auth())
      .send({ loadId: load.body.id })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/assign`)
      .set(auth())
      .send({})
      .expect(201);

    // One auto-tender starts the chain; each decline advances it automatically.
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/auto-tender`)
      .set(auth())
      .send({})
      .expect(201);

    for (let i = 0; i < 3; i++) {
      const tenders = await request(http)
        .get(`/api/v1/transportation/loads/${load.body.id}/tenders`)
        .set(auth())
        .expect(200);
      const pending = tenders.body.find((t: { status: string }) => t.status === 'PENDING');
      if (!pending) break; // chain exhausted
      await request(http).post(`/api/v1/public/tenders/${pending.token}/decline`).expect(200);
    }

    // Both lane carriers declined → restarting the chain is refused.
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/auto-tender`)
      .set(auth())
      .send({})
      .expect(400);
  });
});
