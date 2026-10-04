/**
 * E2E for phase 10 — driver positions, public tracking coordinates, active-map,
 * haversine fallback distance. Runs with ROUTING_DRIVER/GEOCODING_DRIVER unset
 * (the "none" drivers) — zero network dependency.
 *
 * Prerequisites: reachable PostgreSQL with the seed applied
 * (admin@pulsar.dev / admin123, tenant: acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 10 — positions, public coords, active-map, haversine (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P10${Date.now().toString(36).toUpperCase()}`;
  const ids = {
    customer: '',
    origin: '',
    destination: '',
    carrier: '',
    loadId: '',
    loadNumber: '',
    shipmentId: '',
    driverToken: '',
    trackingToken: '',
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

    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'P10 Customer' })
      .expect(201);
    ids.customer = customer.body.id;

    // Locations with MANUAL coordinates (geocoding driver is off).
    const origin = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-ORI`, name: 'P10 Montréal', type: 'WAREHOUSE',
        addressLine1: '1 P10 St', city: 'Montréal', state: 'QC', country: 'CA',
        latitude: 45.5019, longitude: -73.5674,
      })
      .expect(201);
    ids.origin = origin.body.id;

    const destination = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-DST`, name: 'P10 Québec', type: 'WAREHOUSE',
        addressLine1: '2 P10 St', city: 'Québec', state: 'QC', country: 'CA',
        latitude: 46.8131, longitude: -71.2075,
      })
      .expect(201);
    ids.destination = destination.body.id;

    const carrier = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: `${suffix}-CAR`, name: 'P10 Carrier' })
      .expect(201);
    ids.carrier = carrier.body.id;

    // Order → confirm → plan → load → route (NO manual distance) → assign → dispatch
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
      .send({})
      .expect(201);
    ids.shipmentId = planned.body.shipments[0].id;
    // trackingToken is generated lazily: POST :id/share returns { url: .../track/<token> }
    ids.trackingToken =
      planned.body.shipments[0].trackingToken ??
      ((await request(http)
        .post(`/api/v1/transportation/shipments/${ids.shipmentId}/share`)
        .set(auth())
        .expect(201)).body.url as string).split('/').pop()!;

    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    ids.loadId = load.body.id;
    ids.loadNumber = load.body.loadNumber;

    await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipmentId}/assign-load`)
      .set(auth())
      .send({ loadId: ids.loadId })
      .expect(201);

    const route = await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: ids.loadId,
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: ids.origin, shipmentId: ids.shipmentId },
          { sequence: 2, type: 'DELIVERY', locationId: ids.destination, shipmentId: ids.shipmentId },
        ],
      })
      .expect(201);
    expect(route.body.id).toBeDefined();

    await request(http)
      .post(`/api/v1/transportation/loads/${ids.loadId}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.loadId}/dispatch`)
      .set(auth())
      .expect(201);

    const link = await request(http)
      .post(`/api/v1/transportation/loads/${ids.loadId}/driver-link`)
      .set(auth())
      .expect(201);
    ids.driverToken = (link.body.url as string).split('/').pop()!;
  });

  afterAll(async () => {
    await app.close();
  });

  it('driver position: recorded on a DISPATCHED load, deduped under 60s', async () => {
    const first = await request(http)
      .post(`/api/v1/public/driver/${ids.driverToken}/position`)
      .send({ latitude: 45.6, longitude: -73.2 })
      .expect(200);
    expect(first.body.recorded).toBe(true);

    const second = await request(http)
      .post(`/api/v1/public/driver/${ids.driverToken}/position`)
      .send({ latitude: 45.61, longitude: -73.21 })
      .expect(200);
    expect(second.body.recorded).toBe(false); // < 60s after the first one
  });

  it('driver position: 400 on out-of-bounds lat/lng (anonymous input is validated)', async () => {
    await request(http)
      .post(`/api/v1/public/driver/${ids.driverToken}/position`)
      .send({ latitude: 9999, longitude: 9999 })
      .expect(400);
  });

  it('driver position: 404 on unknown token', async () => {
    await request(http)
      .post('/api/v1/public/driver/not-a-real-token/position')
      .send({ latitude: 45, longitude: -73 })
      .expect(404);
  });

  it('driver position: 403 when the transportation module is disabled', async () => {
    // Public routes bypass ModulesGuard — the service re-checks activation
    // (rule 15). setEnabled() invalidates TenantModulesCacheService immediately,
    // so the toggle takes effect without waiting for the 30 s TTL.
    await request(http)
      .patch('/api/v1/modules/transportation')
      .set(auth())
      .send({ enabled: false })
      .expect(200);
    try {
      await request(http)
        .post(`/api/v1/public/driver/${ids.driverToken}/position`)
        .send({ latitude: 45.62, longitude: -73.22 })
        .expect(403);
    } finally {
      // ALWAYS re-enable — the rest of this suite and the other suites need it.
      await request(http)
        .patch('/api/v1/modules/transportation')
        .set(auth())
        .send({ enabled: true })
        .expect(200);
    }
  });

  it('public tracking exposes origin/destination coords and lastPosition while undelivered', async () => {
    const view = await request(http)
      .get(`/api/v1/public/tracking/${ids.trackingToken}`)
      .expect(200);

    expect(view.body.origin.latitude).toBeCloseTo(45.5019, 3);
    expect(view.body.origin.longitude).toBeCloseTo(-73.5674, 3);
    expect(view.body.destination.latitude).toBeCloseTo(46.8131, 3);
    // Position posted in the earlier dedup test:
    expect(view.body.lastPosition).toMatchObject({ latitude: 45.6, longitude: -73.2 });
    expect(view.body.lastPosition.occurredAt).toBeDefined();
    // Rule 10: no tenant/internal leakage, no position history
    expect(JSON.stringify(view.body)).not.toContain('tenantId');
    expect(view.body.events.find((e: { latitude?: number }) => e.latitude != null)).toBeUndefined();
  });

  it('driver position: 400 when the load is not DISPATCHED/IN_TRANSIT', async () => {
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
      .send({})
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
    // Assign a carrier (OPEN → PLANNED) so the driver link can be generated,
    // but do NOT dispatch — positions must be rejected on a PLANNED load.
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);
    const link = await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/driver-link`)
      .set(auth())
      .expect(201);
    const plannedToken = (link.body.url as string).split('/').pop()!;

    await request(http)
      .post(`/api/v1/public/driver/${plannedToken}/position`)
      .send({ latitude: 45, longitude: -73 })
      .expect(400);
  });

  it('haversine fallback: route built without manual distance got HAVERSINE source ~233 km', async () => {
    const loadDetail = await request(http)
      .get(`/api/v1/transportation/loads/${ids.loadId}`)
      .set(auth())
      .expect(200);
    const route = loadDetail.body.route;
    expect(route.distanceSource).toBe('HAVERSINE');
    expect(route.totalDistanceKm).toBeGreaterThan(225);
    expect(route.totalDistanceKm).toBeLessThan(242);
    expect(route.estimatedDurationMin).toBeNull(); // haversine gives no duration
  });

  it('manual distance wins: MANUAL source, value untouched, no haversine overwrite', async () => {
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
      .send({})
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

    const route = await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: load.body.id,
        totalDistanceKm: 500,
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: ids.origin },
          { sequence: 2, type: 'DELIVERY', locationId: ids.destination },
        ],
      })
      .expect(201);
    expect(route.body.totalDistanceKm).toBe(500);
    expect(route.body.distanceSource).toBe('MANUAL');
  });

  it('active-map: dispatched load listed with stops coords, lastPosition, isLate=false', async () => {
    const map = await request(http)
      .get('/api/v1/transportation/loads/active-map')
      .set(auth())
      .expect(200);
    const entry = map.body.find((l: { id: string }) => l.id === ids.loadId);
    expect(entry).toBeDefined();
    expect(entry.loadNumber).toBe(ids.loadNumber);
    expect(entry.carrier).toBe('P10 Carrier');
    expect(entry.isLate).toBe(false);
    expect(entry.lastPosition).toMatchObject({ latitude: 45.6, longitude: -73.2 });
    expect(entry.stops).toHaveLength(2);
    expect(entry.stops[0]).toMatchObject({
      sequence: 1, type: 'PICKUP', city: 'Montréal', latitude: 45.5019,
    });
    // Spec §C: no geometry in this payload (markers only)
    expect(entry.geometry).toBeUndefined();
  });

  it('active-map: late stop flips isLate (same isLate as the exception engine)', async () => {
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
      .send({})
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
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: load.body.id,
        stops: [
          {
            sequence: 1, type: 'PICKUP', locationId: ids.origin,
            plannedArrivalEarly: new Date(Date.now() - 90 * 60_000).toISOString(),
            plannedArrivalLate: new Date(Date.now() - 60 * 60_000).toISOString(),
          },
          { sequence: 2, type: 'DELIVERY', locationId: ids.destination },
        ],
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/dispatch`)
      .set(auth())
      .expect(201);

    const map = await request(http)
      .get('/api/v1/transportation/loads/active-map')
      .set(auth())
      .expect(200);
    const entry = map.body.find((l: { id: string }) => l.id === load.body.id);
    expect(entry.isLate).toBe(true);
  });

  it('active-map requires auth', async () => {
    await request(http).get('/api/v1/transportation/loads/active-map').expect(401);
  });

  it('active-map: 403 without transportation.planning.read', async () => {
    // Role with zero permissions + directly-activated user (password ⇒ ACTIVE).
    const lower = suffix.toLowerCase();
    const role = await request(http)
      .post('/api/v1/roles')
      .set(auth())
      .send({ key: `${lower}-noperm`, name: 'P10 No Permissions', permissionKeys: [] })
      .expect(201);
    await request(http)
      .post('/api/v1/users')
      .set(auth())
      .send({
        email: `${lower}-noperm@example.test`,
        password: 'NoPerm$123',
        firstName: 'No',
        lastName: 'Perm',
        roleIds: [role.body.id],
      })
      .expect(201);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: `${lower}-noperm@example.test`, password: 'NoPerm$123', tenant: 'acme' })
      .expect(200);

    await request(http)
      .get('/api/v1/transportation/loads/active-map')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .expect(403);
  });

  it('active-map: tenant isolation — a second tenant never sees acme loads', async () => {
    // Second tenant through the platform plane (phase 6 precedent — no MFA in e2e env).
    const lower = suffix.toLowerCase();
    const platformLogin = await request(http)
      .post('/api/v1/platform/auth/login')
      .send({ email: 'platform@pulsar.dev', password: 'admin123' })
      .expect(200);
    const created = await request(http)
      .post('/api/v1/platform/tenants')
      .set({ Authorization: `Bearer ${platformLogin.body.accessToken}` })
      .send({
        slug: `${lower}-iso`,
        name: 'P10 Isolation Corp',
        modules: ['transportation'],
        admin: { email: `${lower}-iso@example.test`, firstName: 'Iso', lastName: 'Admin' },
      })
      .expect(201);
    const inviteToken = (created.body.inviteUrl as string).split('/reset-password/')[1];
    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteToken, password: 'Iso$Pass123' })
      .expect(200);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: `${lower}-iso@example.test`, password: 'Iso$Pass123', tenant: `${lower}-iso` })
      .expect(200);

    const map = await request(http)
      .get('/api/v1/transportation/loads/active-map')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .expect(200);
    expect(map.body).toEqual([]); // brand-new tenant: nothing, certainly not acme's loads
  });

  // LAST on purpose: delivering ids.loadId flips it out of DISPATCHED/IN_TRANSIT,
  // which the position/active-map tests above rely on.
  it('public tracking: lastPosition is null after delivery, coords remain', async () => {
    // DISPATCHED → IN_TRANSIT (authed), stops + POD via the public driver page
    // (collaboration precedent), then load complete (authed) flips shipments DELIVERED.
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.loadId}/start-transit`)
      .set(auth())
      .expect(201);

    const driverView = await request(http)
      .get(`/api/v1/public/driver/${ids.driverToken}`)
      .expect(200);
    const [pickup, delivery] = driverView.body.stops;
    await request(http)
      .post(`/api/v1/public/driver/${ids.driverToken}/stops/${pickup.id}/status`)
      .send({ status: 'ARRIVED' })
      .expect(200);
    await request(http)
      .post(`/api/v1/public/driver/${ids.driverToken}/stops/${pickup.id}/status`)
      .send({ status: 'DEPARTED' })
      .expect(200);
    await request(http)
      .post(`/api/v1/public/driver/${ids.driverToken}/stops/${delivery.id}/status`)
      .send({ status: 'ARRIVED' })
      .expect(200);
    await request(http)
      .post(`/api/v1/public/driver/${ids.driverToken}/pod`)
      .send({ shipmentId: driverView.body.shipments[0].id, signedByName: 'P10 Receiver' })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.loadId}/complete`)
      .set(auth())
      .expect(201);

    const view = await request(http)
      .get(`/api/v1/public/tracking/${ids.trackingToken}`)
      .expect(200);
    expect(view.body.status).toBe('DELIVERED');
    // The position history still exists, but a delivered shipment exposes none of it.
    expect(view.body.lastPosition).toBeNull();
    // Origin/destination coordinates remain for the static map.
    expect(view.body.origin.latitude).toBeCloseTo(45.5019, 3);
    expect(view.body.destination.latitude).toBeCloseTo(46.8131, 3);

    // And the load left the active map.
    const map = await request(http)
      .get('/api/v1/transportation/loads/active-map')
      .set(auth())
      .expect(200);
    expect(map.body.find((l: { id: string }) => l.id === ids.loadId)).toBeUndefined();
  });
});
