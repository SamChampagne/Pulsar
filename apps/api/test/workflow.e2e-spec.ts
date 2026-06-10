/**
 * End-to-end happy path: order → confirm → plan → load → dispatch → transit
 * → delivered → POD → close.
 *
 * Prerequisites: a reachable PostgreSQL (DATABASE_URL in the root .env) with the
 * seed applied (`pnpm db:seed`) — the test signs in as the seeded admin and
 * creates its own master data with unique codes.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('TMS workflow (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = Date.now().toString(36).toUpperCase();
  const ids = {
    customer: '',
    origin: '',
    destination: '',
    carrier: '',
    order: '',
    shipment: '',
    load: '',
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs in as the seeded admin', async () => {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = res.body.accessToken;
    expect(res.body.tenant.enabledModules).toContain('transportation');
  });

  it('rejects unauthenticated access', async () => {
    await request(http).get('/api/v1/transportation/transport-orders').expect(401);
  });

  it('creates master data', async () => {
    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `E2E-CUST-${suffix}`, name: 'E2E Customer' })
      .expect(201);
    ids.customer = customer.body.id;

    const origin = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `E2E-ORI-${suffix}`,
        name: 'E2E Plant',
        type: 'PLANT',
        addressLine1: '1 Test St',
        city: 'Québec',
      })
      .expect(201);
    ids.origin = origin.body.id;

    const destination = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `E2E-DST-${suffix}`,
        name: 'E2E DC',
        type: 'DISTRIBUTION_CENTER',
        addressLine1: '2 Test Av',
        city: 'Montréal',
      })
      .expect(201);
    ids.destination = destination.body.id;

    const carrier = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: `E2E-CARR-${suffix}`, name: 'E2E Carrier' })
      .expect(201);
    ids.carrier = carrier.body.id;
  });

  it('rejects an order referencing a foreign id', async () => {
    await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: 'not-a-tenant-row',
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
      })
      .expect(400);
  });

  it('creates a transport order with a sequenced number', async () => {
    const res = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        totalWeightKg: 1000,
        palletCount: 4,
      })
      .expect(201);
    ids.order = res.body.id;
    expect(res.body.orderNumber).toMatch(/^TO-\d{6}$/);
    expect(res.body.status).toBe('DRAFT');
  });

  it('rejects an invalid transition (DRAFT → close)', async () => {
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/close`)
      .set(auth())
      .expect(400);
  });

  it('confirms then plans the order, generating a shipment', async () => {
    const confirmed = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/confirm`)
      .set(auth())
      .expect(201);
    expect(confirmed.body.status).toBe('CONFIRMED');

    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/plan`)
      .set(auth())
      .expect(201);
    expect(planned.body.status).toBe('PLANNED');
    expect(planned.body.shipments).toHaveLength(1);
    ids.shipment = planned.body.shipments[0].id;
    expect(planned.body.shipments[0].shipmentNumber).toMatch(/^SH-\d{6}$/);
  });

  it('builds a load and assigns the shipment and carrier', async () => {
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    ids.load = load.body.id;
    expect(load.body.loadNumber).toMatch(/^LD-\d{6}$/);
    expect(load.body.status).toBe('OPEN');

    const assigned = await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipment}/assign-load`)
      .set(auth())
      .send({ loadId: ids.load })
      .expect(201);
    expect(assigned.body.status).toBe('PLANNED');

    const withCarrier = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);
    expect(withCarrier.body.status).toBe('PLANNED');
  });

  it('builds a route for the load', async () => {
    const res = await request(http)
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
    expect(res.body.stops).toHaveLength(2);
  });

  it('executes: dispatch → transit → delivered, cascading statuses', async () => {
    const dispatched = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/dispatch`)
      .set(auth())
      .expect(201);
    expect(dispatched.body.status).toBe('DISPATCHED');

    const order = await request(http)
      .get(`/api/v1/transportation/transport-orders/${ids.order}`)
      .set(auth())
      .expect(200);
    expect(order.body.status).toBe('IN_EXECUTION');

    const inTransit = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/start-transit`)
      .set(auth())
      .expect(201);
    expect(inTransit.body.status).toBe('IN_TRANSIT');

    const completed = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/complete`)
      .set(auth())
      .expect(201);
    expect(completed.body.status).toBe('COMPLETED');

    const shipment = await request(http)
      .get(`/api/v1/transportation/shipments/${ids.shipment}`)
      .set(auth())
      .expect(200);
    expect(shipment.body.status).toBe('DELIVERED');

    const orderAfter = await request(http)
      .get(`/api/v1/transportation/transport-orders/${ids.order}`)
      .set(auth())
      .expect(200);
    expect(orderAfter.body.status).toBe('COMPLETED');
  });

  it('captures the POD and closes the order', async () => {
    const pod = await request(http)
      .post('/api/v1/transportation/tracking/pod')
      .set(auth())
      .send({ shipmentId: ids.shipment, signedByName: 'E2E Signee' })
      .expect(201);
    expect(pod.body.signedByName).toBe('E2E Signee');

    // A second POD for the same shipment must be rejected.
    await request(http)
      .post('/api/v1/transportation/tracking/pod')
      .set(auth())
      .send({ shipmentId: ids.shipment })
      .expect(409);

    const closed = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/close`)
      .set(auth())
      .expect(201);
    expect(closed.body.status).toBe('CLOSED');
  });

  it('recorded tracking events along the way', async () => {
    const res = await request(http)
      .get(`/api/v1/transportation/tracking/events?loadId=${ids.load}`)
      .set(auth())
      .expect(200);
    const types = res.body.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['DISPATCHED', 'DELIVERED']));
  });
});
