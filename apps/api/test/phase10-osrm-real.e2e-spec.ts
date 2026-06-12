/**
 * OPTIONAL e2e — runs only when a real OSRM is configured:
 *   ROUTING_DRIVER=osrm OSRM_HOST=http://localhost:5000 pnpm --filter @pulsar/api test:e2e -- osrm-real
 * Skipped entirely otherwise (CI stays network-free).
 * Verifies distance/duration/geometry on a known trip and the geometry's
 * coordinate bounds — catches any [lng,lat]/[lat,lng] inversion (spec §D).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const OSRM_ENABLED = process.env.ROUTING_DRIVER === 'osrm' && !!process.env.OSRM_HOST;
const d = OSRM_ENABLED ? describe : describe.skip;

d('Phase 10 — real OSRM routing (optional e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;
  const suffix = `P10R${Date.now().toString(36).toUpperCase()}`;
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

  it('Montréal → Québec: OSRM distance/duration/geometry with sane bounds', async () => {
    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'P10R Customer' })
      .expect(201);
    const origin = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-ORI`, name: 'P10R MTL', type: 'WAREHOUSE',
        addressLine1: '1 St', city: 'Montréal', state: 'QC', country: 'CA',
        latitude: 45.5019, longitude: -73.5674,
      })
      .expect(201);
    const destination = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-DST`, name: 'P10R QC', type: 'WAREHOUSE',
        addressLine1: '2 St', city: 'Québec', state: 'QC', country: 'CA',
        latitude: 46.8131, longitude: -71.2075,
      })
      .expect(201);

    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: customer.body.id,
        originLocationId: origin.body.id,
        destinationLocationId: destination.body.id,
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
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: origin.body.id },
          { sequence: 2, type: 'DELIVERY', locationId: destination.body.id },
        ],
      })
      .expect(201);

    expect(route.body.distanceSource).toBe('OSRM');
    // Road distance MTL→QC ≈ 250-270 km; generous bounds for extract variations.
    expect(route.body.totalDistanceKm).toBeGreaterThan(230);
    expect(route.body.totalDistanceKm).toBeLessThan(330);
    expect(route.body.estimatedDurationMin).toBeGreaterThan(90);

    const geometry = route.body.geometry as { type: string; coordinates: [number, number][] };
    expect(geometry.type).toBe('LineString');
    expect(geometry.coordinates.length).toBeGreaterThan(2);
    // [lng, lat] order: lng in [-75, -70], lat in [45, 48] for this corridor.
    for (const [lng, lat] of geometry.coordinates) {
      expect(lng).toBeGreaterThan(-75);
      expect(lng).toBeLessThan(-70);
      expect(lat).toBeGreaterThan(45);
      expect(lat).toBeLessThan(48);
    }
  });
});
