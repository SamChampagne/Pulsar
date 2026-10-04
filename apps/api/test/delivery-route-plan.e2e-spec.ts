/** Real HTTP/Prisma workflow. Routing responses alone are synthetic, no provider calls. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RoutingService } from '../src/core/routing/routing.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Delivery route and fuel (HTTP + database)', () => {
  let app: INestApplication, http: any, prisma: PrismaService, token: string, tenantId: string;
  let loadId: string, shipmentId: string, a: string, b: string, version: string, routeId: string;
  let stops: { id: string; status: string }[];
  const suffix = `DP${Date.now().toString(36)}`;
  const headers = () => ({ Authorization: `Bearer ${token}` });
  const routing = {
    geocode: jest.fn(async () => null),
    route: jest.fn(async (points: unknown[]) => ({
      distanceKm: (points.length - 1) * 100,
      durationMin: (points.length - 1) * 60,
      geometry: null,
      legs: points.slice(1).map(() => ({ distanceKm: 100, durationMin: 60 })),
    })),
    table: jest.fn(async () => ({
      distancesKm: [
        [0, 100],
        [120, 0],
      ],
      durationsMin: [
        [0, 60],
        [80, 0],
      ],
    })),
  };
  const dto = () => ({
    loadId,
    expectedUpdatedAt: version,
    planning: {
      startAt: '2026-10-02T12:00:00Z',
      serviceMinutes: 15,
      loadedLitersPer100Km: 30,
      emptyLitersPer100Km: 20,
      pricePerLiter: 1.6,
      currency: 'CAD',
      returnToStart: true,
    },
    stops: [
      { sequence: 1, type: 'PICKUP', locationId: a, shipmentId },
      { sequence: 2, type: 'DELIVERY', locationId: b, shipmentId },
    ],
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RoutingService)
      .useValue(routing)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;
    tenantId = login.body.tenant.id;
    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(headers())
      .send({ code: `${suffix}-C`, name: 'Composants recette' })
      .expect(201);
    const locationIds: string[] = [];
    for (const [code, latitude] of [
      ['A', 45],
      ['B', 46],
    ] as const) {
      const loc = await request(http)
        .post('/api/v1/transportation/locations')
        .set(headers())
        .send({
          code: `${suffix}-${code}`,
          name: `Usine ${code}`,
          type: 'WAREHOUSE',
          addressLine1: '1 Recette',
          city: 'Laval',
          latitude,
          longitude: -73,
        })
        .expect(201);
      locationIds.push(loc.body.id);
    }
    [a, b] = locationIds;
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(headers())
      .send({
        customerId: customer.body.id,
        originLocationId: a,
        destinationLocationId: b,
        totalWeightKg: 1000,
        palletCount: 2,
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/confirm`)
      .set(headers())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/plan`)
      .set(headers())
      .send({})
      .expect(201);
    shipmentId = planned.body.shipments[0].id;
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(headers())
      .send({})
      .expect(201);
    loadId = load.body.id;
    await request(http)
      .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
      .set(headers())
      .send({ loadId })
      .expect(201);
    version = (
      await request(http).get(`/api/v1/transportation/loads/${loadId}`).set(headers()).expect(200)
    ).body.updatedAt;
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  it('previews full road legs, return/fuel/time without creating a route', async () => {
    const result = await request(http)
      .post('/api/v1/transportation/routes/preview')
      .set(headers())
      .send({ ...dto(), optimize: true })
      .expect(201);
    expect(result.body.deliveryPlan.totals).toMatchObject({
      distanceKm: 200,
      liters: 50,
      fuelCost: 80,
      serviceMinutes: 30,
    });
    expect(await prisma.route.count({ where: { tenantId, loadId } })).toBe(0);
  });
  it('validates numbers, timezone, tenant-owned shipment and pickup order', async () => {
    await request(http)
      .post('/api/v1/transportation/routes/preview')
      .set(headers())
      .send({ ...dto(), planning: { loadedLitersPer100Km: -1 } })
      .expect(400);
    await request(http)
      .post('/api/v1/transportation/routes/preview')
      .set(headers())
      .send({ ...dto(), planning: { startAt: '2026-10-01T10:00:00' } })
      .expect(400);
    await request(http)
      .post('/api/v1/transportation/routes/preview')
      .set(headers())
      .send({ ...dto(), stops: dto().stops.map((s) => ({ ...s, shipmentId: 'missing-foreign' })) })
      .expect(400);
    await request(http)
      .post('/api/v1/transportation/routes/preview')
      .set(headers())
      .send({
        ...dto(),
        stops: dto()
          .stops.reverse()
          .map((s, i) => ({ ...s, sequence: i + 1 })),
      })
      .expect(400);
  });
  it('rejects actual foreign-tenant locations and loads before routing', async () => {
    const foreign = await prisma.tenant.create({
      data: { slug: `${suffix.toLowerCase()}-foreign`, name: 'Tenant isolé recette' },
    });
    const location = await prisma.location.create({
      data: {
        tenantId: foreign.id,
        code: 'SECRET',
        name: 'Site privé',
        addressLine1: '1 Recette',
        city: 'Laval',
      },
    });
    const foreignLoad = await prisma.load.create({
      data: { tenantId: foreign.id, loadNumber: 'LD-PRIVATE', driverToken: `${suffix}-disabled` },
    });
    await request(http)
      .post(`/api/v1/public/driver/${suffix}-disabled/stops/missing/status`)
      .send({ status: 'ARRIVED' })
      .expect(403);
    routing.route.mockClear();
    await request(http)
      .post('/api/v1/transportation/routes/preview')
      .set(headers())
      .send({ ...dto(), loadId: foreignLoad.id })
      .expect(404);
    await request(http)
      .post('/api/v1/transportation/routes/preview')
      .set(headers())
      .send({
        ...dto(),
        stops: dto().stops.map((s, i) => (i ? s : { ...s, locationId: location.id })),
      })
      .expect(400);
    expect(routing.route).not.toHaveBeenCalled();
    expect(await prisma.route.count({ where: { tenantId: foreign.id } })).toBe(0);
  });
  it('saves a versioned plan atomically and rejects duplicate stale saves', async () => {
    const result = await request(http)
      .post('/api/v1/transportation/routes')
      .set(headers())
      .send({ ...dto(), totalDistanceKm: 210 })
      .expect(201);
    routeId = result.body.id;
    stops = result.body.stops;
    expect(result.body.deliveryPlan.totals.fuelCost).toBe(80);
    expect(result.body.totalDistanceKm).toBe(210);
    expect(
      await prisma.auditLog.count({ where: { tenantId, entityType: 'route', entityId: routeId } }),
    ).toBe(1);
    await request(http)
      .post('/api/v1/transportation/routes')
      .set(headers())
      .send(dto())
      .expect(409);
    expect(await prisma.stop.count({ where: { tenantId, routeId } })).toBe(2);
    version = (await request(http).get(`/api/v1/transportation/loads/${loadId}`).set(headers()))
      .body.updatedAt;
  });
  it('preserves manual tariff distance on a subsequent calculation', async () => {
    const result = await request(http)
      .post('/api/v1/transportation/routes/preview')
      .set(headers())
      .send(dto())
      .expect(201);
    expect(result.body.totalDistanceKm).toBe(210);
    expect(result.body.distanceSource).toBe('MANUAL');
    expect(result.body.deliveryPlan.totals.distanceKm).toBe(200);
  });
  it('allows only one of two concurrent edits and keeps one complete stop set', async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        request(http).post('/api/v1/transportation/routes').set(headers()).send(dto()),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    stops = results.find((r) => r.status === 201)!.body.stops;
    expect(await prisma.stop.count({ where: { tenantId, routeId } })).toBe(2);
    expect(
      await prisma.auditLog.count({ where: { tenantId, entityType: 'route', entityId: routeId } }),
    ).toBe(2);
    version = (await request(http).get(`/api/v1/transportation/loads/${loadId}`).set(headers()))
      .body.updatedAt;
  });
  it('executes in order, prevents early completion, and persists one event per arrival', async () => {
    await request(http)
      .post(`/api/v1/transportation/routes/stops/${stops[0].id}/status`)
      .set(headers())
      .send({ status: 'ARRIVED' })
      .expect(400);
    const driver = await prisma.driver.create({
      data: { tenantId, firstName: 'Camille', lastName: suffix },
    });
    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/assign`)
      .set(headers())
      .send({ driverId: driver.id })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/dispatch`)
      .set(headers())
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/start-transit`)
      .set(headers())
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/complete`)
      .set(headers())
      .expect(400);
    await request(http)
      .post(`/api/v1/transportation/routes/stops/${stops[1].id}/status`)
      .set(headers())
      .send({ status: 'ARRIVED' })
      .expect(400);
    for (const stop of stops) {
      for (const status of ['ARRIVED', 'ARRIVED', 'DEPARTED'])
        await request(http)
          .post(`/api/v1/transportation/routes/stops/${stop.id}/status`)
          .set(headers())
          .send({ status })
          .expect(201);
      expect(
        await prisma.trackingEvent.count({
          where: { tenantId, stopId: stop.id, type: 'ARRIVED_AT_STOP' },
        }),
      ).toBe(1);
    }
    const completions = await Promise.all(
      [1, 2].map(() =>
        request(http).post(`/api/v1/transportation/loads/${loadId}/complete`).set(headers()),
      ),
    );
    expect(completions.filter((r) => r.status === 201)).toHaveLength(1);
    expect(completions.filter((r) => r.status === 400 || r.status === 409)).toHaveLength(1);
    expect(
      await prisma.trackingEvent.count({ where: { tenantId, loadId, type: 'DELIVERED' } }),
    ).toBe(1);
    const completed = completions.find((r) => r.status === 201)!;
    expect(completed.body.status).toBe('COMPLETED');
    await request(http)
      .post('/api/v1/transportation/routes')
      .set(headers())
      .send(dto())
      .expect(400);
    await request(http)
      .post(`/api/v1/transportation/routes/stops/${stops[0].id}/status`)
      .set(headers())
      .send({ status: 'ARRIVED' })
      .expect(400);
    const frozen = await prisma.route.findFirstOrThrow({ where: { tenantId, id: routeId } });
    expect((frozen.deliveryPlan as any).totals.fuelCost).toBe(80);
  });
});
