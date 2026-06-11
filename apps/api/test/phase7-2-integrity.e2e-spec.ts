/**
 * E2E for phase 7.2: time windows (coherence 400s + advisory warnings), 3-axis
 * capacity check with audited force override, shipment_load_legs junction invariant.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 7.2 plan integrity (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P72${Date.now().toString(36).toUpperCase()}`;
  const ids = {
    customer: '', origin: '', destination: '', carrier: '',
    trailer: '', order: '', shipment: '', load: '',
  };
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    http = app.getHttpServer();

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;

    const customer = await request(http).post('/api/v1/transportation/customers').set(auth())
      .send({ code: `${suffix}-CUST`, name: 'P72 Customer' }).expect(201);
    ids.customer = customer.body.id;
    for (const [field, code, type] of [
      ['origin', `${suffix}-ORI`, 'PLANT'],
      ['destination', `${suffix}-DST`, 'WAREHOUSE'],
    ] as const) {
      const location = await request(http).post('/api/v1/transportation/locations').set(auth())
        .send({ code, name: code, type, addressLine1: '1 Test', city: 'Sherbrooke' }).expect(201);
      ids[field] = location.body.id;
    }
    const carrier = await request(http).post('/api/v1/transportation/carriers').set(auth())
      .send({ code: `${suffix}-CARR`, name: 'P72 Carrier' }).expect(201);
    ids.carrier = carrier.body.id;
    const trailer = await request(http).post('/api/v1/transportation/trailers').set(auth())
      .send({ unitNumber: `${suffix}-TRL`, type: 'DRY_VAN', capacityWeightKg: 1000 }).expect(201);
    ids.trailer = trailer.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('NON-LOSS: the seeded demo order kept its date through the column rename', async () => {
    // Search specifically for TO-000001 to avoid pagination issues with large accumulated datasets.
    const res = await request(http)
      .get('/api/v1/transportation/transport-orders?search=TO-000001').set(auth()).expect(200);
    const seedOrder = res.body.items.find((o: { orderNumber: string }) => o.orderNumber === 'TO-000001');
    expect(seedOrder).toBeDefined();
    expect(seedOrder.requestedPickupEarly).toBeTruthy();
  });

  it('rejects an incoherent window (early > late) with 400', async () => {
    await request(http).post('/api/v1/transportation/transport-orders').set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        requestedPickupEarly: '2026-08-02T00:00:00.000Z',
        requestedPickupLate: '2026-08-01T00:00:00.000Z',
      })
      .expect(400);
  });

  it('creates an order with windows; planning outside them produces advisory warnings, not a block', async () => {
    const order = await request(http).post('/api/v1/transportation/transport-orders').set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        totalWeightKg: 600,
        palletCount: 3,
        requestedPickupEarly: '2026-08-01T08:00:00.000Z',
        requestedPickupLate: '2026-08-01T12:00:00.000Z',
        requestedDeliveryEarly: '2026-08-02T08:00:00.000Z',
        requestedDeliveryLate: '2026-08-02T17:00:00.000Z',
      })
      .expect(201);
    ids.order = order.body.id;
    await request(http).post(`/api/v1/transportation/transport-orders/${ids.order}/confirm`).set(auth()).expect(201);

    // plannedPickupEarly is after the order's requestedPickupLate (12:00).
    // We must also provide plannedPickupLate ≥ plannedPickupEarly to pass coherence.
    // The advisory warning fires because the LATEST planned pickup bound (14:00) > requestedPickupLate (12:00).
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/plan`).set(auth())
      .send({
        shipments: [
          {
            weightKg: 600, palletCount: 3,
            plannedPickupEarly: '2026-08-01T13:00:00.000Z',
            plannedPickupLate: '2026-08-01T14:00:00.000Z',
          },
        ],
      })
      .expect(201);
    ids.shipment = planned.body.shipments[0].id;

    const detail = await request(http)
      .get(`/api/v1/transportation/transport-orders/${ids.order}`).set(auth()).expect(200);
    expect(detail.body.windowWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'pickup', kind: 'AFTER_LATE' }),
      ]),
    );
  });

  it('capacity: assignment exceeding the trailer is rejected with the per-axis detail; force passes and is audited', async () => {
    const load = await request(http).post('/api/v1/transportation/loads').set(auth()).send({}).expect(201);
    ids.load = load.body.id;
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/assign`).set(auth())
      .send({ carrierId: ids.carrier, trailerId: ids.trailer }).expect(201);

    await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipment}/assign-load`).set(auth())
      .send({ loadId: ids.load })
      .expect(201); // 600 kg / 3 pallets fits 1000 kg / 4 pallets

    const order2 = await request(http).post('/api/v1/transportation/transport-orders').set(auth())
      .send({
        customerId: ids.customer, originLocationId: ids.origin, destinationLocationId: ids.destination,
        totalWeightKg: 700, palletCount: 3,
      }).expect(201);
    await request(http).post(`/api/v1/transportation/transport-orders/${order2.body.id}/confirm`).set(auth()).expect(201);
    const planned2 = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order2.body.id}/plan`).set(auth()).expect(201);
    const shipment2 = planned2.body.shipments[0].id;

    const rejected = await request(http)
      .post(`/api/v1/transportation/shipments/${shipment2}/assign-load`).set(auth())
      .send({ loadId: ids.load })
      .expect(400);
    // Only the weightKg axis fires: capacityPallets is not exposed in the trailer DTO so it
    // remains null in the DB, and checkCapacity skips null-capacity axes.
    expect(rejected.body.excesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ axis: 'weightKg', capacity: 1000, requested: 1300, excess: 300 }),
      ]),
    );

    await request(http)
      .post(`/api/v1/transportation/shipments/${shipment2}/assign-load`).set(auth())
      .send({ loadId: ids.load, force: true })
      .expect(201);

    // Audit override: the entityType is 'load', entityId is ids.load.
    // The audit-logs endpoint returns a paginated response { items, total, page, pageSize }.
    const audit = await request(http)
      .get(`/api/v1/audit-logs?entityType=load&entityId=${ids.load}`).set(auth()).expect(200);
    expect(JSON.stringify(audit.body)).toContain('capacityOverride');

    // Junction sanity (indirect, by design — no legs endpoint): unassign works cleanly.
    await request(http)
      .post(`/api/v1/transportation/shipments/${shipment2}/remove-load`).set(auth()).expect(201);
    const detail = await request(http).get(`/api/v1/transportation/loads/${ids.load}`).set(auth()).expect(200);
    expect(detail.body.shipments).toHaveLength(1);
  });

  it('changing to a smaller trailer is rejected, force passes', async () => {
    const small = await request(http).post('/api/v1/transportation/trailers').set(auth())
      .send({ unitNumber: `${suffix}-SML`, type: 'DRY_VAN', capacityWeightKg: 100 }).expect(201);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/assign`).set(auth())
      .send({ trailerId: small.body.id }).expect(400);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/assign`).set(auth())
      .send({ trailerId: small.body.id, force: true }).expect(201);
  });

  it('route stops accept arrival windows and reject incoherent ones', async () => {
    await request(http).post('/api/v1/transportation/routes').set(auth())
      .send({
        loadId: ids.load,
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: ids.origin, shipmentId: ids.shipment,
            plannedArrivalEarly: '2026-08-01T08:00:00.000Z', plannedArrivalLate: '2026-08-01T10:00:00.000Z' },
          { sequence: 2, type: 'DELIVERY', locationId: ids.destination, shipmentId: ids.shipment },
        ],
      })
      .expect(201);

    await request(http).post('/api/v1/transportation/routes').set(auth())
      .send({
        loadId: ids.load,
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: ids.origin,
            plannedArrivalEarly: '2026-08-01T12:00:00.000Z', plannedArrivalLate: '2026-08-01T10:00:00.000Z' },
          { sequence: 2, type: 'DELIVERY', locationId: ids.destination },
        ],
      })
      .expect(400);
  });
});
