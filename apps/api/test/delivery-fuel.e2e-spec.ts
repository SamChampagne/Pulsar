/** Dedicated disposable QA tenants only; every road-provider response is mocked. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ALL_PERMISSION_KEYS } from '@pulsar/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RoutingService } from '../src/core/routing/routing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('Delivery fuel operations (HTTP + disposable PostgreSQL)', () => {
  let app: INestApplication, http: any, db: PrismaService, jwt: JwtService;
  let tenantId: string, actorId: string, token: string, moduleId: string;
  let vehicleId: string,
    foreignVehicle: string,
    foreignLoad: string,
    loadId: string,
    shipmentId: string;
  let route: any,
    a: string,
    b: string,
    profileRevision = 0,
    priceRevision = 0;
  const prefix = '/api/v1/transportation',
    fuel = `${prefix}/delivery-fuel`;
  const suffix = `FUEL-${Date.now().toString(36)}-${randomUUID().slice(0, 5)}`;
  const profile = {
    loadedLitersPer100Km: 35,
    emptyLitersPer100Km: 25,
    idleLitersPerHour: 3,
    tankCapacityLitres: 600,
    reserveLitres: 60,
  };
  const price = {
    effectiveOn: '2026-10-01',
    pricePerLitre: '1.65',
    currency: 'CAD',
    reference: 'Prix local de recette',
  };
  const actual = {
    distanceKm: '205.5',
    consumedLitres: '61.125',
    costAmount: '100.85',
    currency: 'CAD',
    measuredAt: '2026-10-02T15:00:00.000Z',
    note: 'Relevé compteur et carburant manuel, total cumulatif',
  };
  const headers = (access = token) => ({ Authorization: `Bearer ${access}` });
  const post = (path: string, body: object = {}) =>
    request(http).post(`${prefix}/${path}`).set(headers()).send(body).expect(201);
  const current = async () =>
    (await request(http).get(`${fuel}/loads/${loadId}`).set(headers()).expect(200)).body;
  const sign = (permissions: string[], actor = actorId) =>
    jwt.sign(
      { sub: actor, tenantId, email: `${suffix}@example.invalid`, permissions },
      { expiresIn: '30m' },
    );
  const profileDto = (expectedRevision = profileRevision) => ({
    operationKey: randomUUID(),
    expectedRevision,
    profile,
  });
  const priceDto = () => ({ operationKey: randomUUID(), expectedRevision: priceRevision, price });
  const planDto = async () => ({
    loadId,
    expectedUpdatedAt: (await current()).load.updatedAt,
    planning: { startAt: '2026-10-02T12:00:00Z', returnToStart: true, serviceMinutes: 0 },
    fuelSource: { vehicleId, profileRevision, priceRevision, currency: 'CAD', asOf: '2026-10-02' },
    stops: [
      { sequence: 1, type: 'PICKUP', locationId: a, shipmentId },
      { sequence: 2, type: 'DELIVERY', locationId: b, shipmentId },
    ],
  });
  const actualDto = async () => {
    const c = await current();
    return {
      operationKey: randomUUID(),
      expectedRevision: c.actual?.revision ?? 0,
      expectedLoadUpdatedAt: c.load.updatedAt,
      expectedRouteUpdatedAt: c.route.updatedAt,
      actual,
    };
  };
  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('/pulsar_parcel_qa'))
      throw Error('This suite requires the dedicated disposable pulsar_parcel_qa database.');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RoutingService)
      .useValue({
        geocode: jest.fn(async () => null),
        route: jest.fn(async (points: unknown[]) => ({
          distanceKm: (points.length - 1) * 100,
          durationMin: (points.length - 1) * 60,
          geometry: null,
          legs: points.slice(1).map(() => ({ distanceKm: 100, durationMin: 60 })),
        })),
        table: jest.fn(async () => null),
      })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    db = app.get(PrismaService);
    jwt = new JwtService({ secret: app.get(ConfigService).getOrThrow('JWT_SECRET') });
    moduleId = (await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'transportation' } }))
      .id;
    tenantId = (
      await db.tenant.create({
        data: { slug: suffix.toLowerCase(), name: 'Recette carburant isolée' },
      })
    ).id;
    await db.tenantModule.create({
      data: {
        tenantId,
        moduleId,
        enabled: true,
        settings: {
          requireTendering: 'OPTIONAL',
          bolRequiredBeforeDispatch: false,
          podRequiredBeforeCompletion: false,
        },
      },
    });
    actorId = (
      await db.user.create({
        data: {
          tenantId,
          email: `${suffix}@example.invalid`,
          passwordHash: 'fixture-not-loginable',
          firstName: 'Camille',
          lastName: 'Recette',
        },
      })
    ).id;
    token = sign(ALL_PERMISSION_KEYS);
    const foreign = await db.tenant.create({
      data: { slug: `${suffix}-foreign`.toLowerCase(), name: 'Autre recette isolée' },
    });
    foreignVehicle = (
      await db.vehicle.create({ data: { tenantId: foreign.id, unitNumber: 'PRIVATE-TRUCK' } })
    ).id;
    foreignLoad = (
      await db.load.create({ data: { tenantId: foreign.id, loadNumber: 'PRIVATE-LOAD' } })
    ).id;
    const customer = (await post('customers', { code: suffix, name: 'Client recette' })).body;
    const ids: string[] = [];
    for (const [index, code] of ['A', 'B'].entries())
      ids.push(
        (
          await post('locations', {
            code,
            name: `Recette ${code}`,
            type: 'WAREHOUSE',
            addressLine1: '1 Test',
            city: 'Laval',
            latitude: 45 + index,
            longitude: -73,
          })
        ).body.id,
      );
    [a, b] = ids;
    const order = (
      await post('transport-orders', {
        customerId: customer.id,
        originLocationId: a,
        destinationLocationId: b,
        totalWeightKg: 100,
        palletCount: 1,
      })
    ).body;
    await post(`transport-orders/${order.id}/confirm`);
    shipmentId = (await post(`transport-orders/${order.id}/plan`)).body.shipments[0].id;
    loadId = (await post('loads')).body.id;
    await post(`shipments/${shipmentId}/assign-load`, { loadId });
    const driverId = (await post('drivers', { firstName: 'Camille', lastName: 'Test' })).body.id;
    vehicleId = (await post('vehicles', { unitNumber: 'TR-TEST-FUEL', type: 'STRAIGHT_TRUCK' })).body.id;
    await post(`loads/${loadId}/assign`, { driverId, vehicleId });
  }, 90000);
  afterAll(async () => {
    await app?.close();
  });

  it('requires authentication, permission, module and tenant ownership', async () => {
    await request(http).get(`${fuel}/prices`).expect(401);
    const none = sign([]),
      read = sign(['transportation.planning.read']);
    await request(http).get(`${fuel}/prices`).set(headers(none)).expect(403);
    await request(http).post(`${fuel}/prices`).set(headers(read)).send(priceDto()).expect(403);
    await request(http).get(`${fuel}/loads/${foreignLoad}`).set(headers()).expect(404);
    await request(http)
      .get(`${fuel}/vehicles/${foreignVehicle}/profile`)
      .set(headers())
      .expect(404);
    await request(http)
      .post(`${fuel}/vehicles/${foreignVehicle}/profile`)
      .set(headers())
      .send(profileDto())
      .expect(404);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await request(http).get(`${fuel}/prices`).set(headers()).expect(403);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      data: { enabled: true },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    expect((await current()).profile).toBeNull();
  });
  it('validates closed DTOs and exact quantities before writes', async () => {
    await request(http)
      .post(`${fuel}/prices`)
      .set(headers())
      .send({ ...priceDto(), tenantId })
      .expect(400);
    await request(http)
      .post(`${fuel}/prices`)
      .set(headers())
      .send({ ...priceDto(), price: { ...price, effectiveOn: '2026-02-30' } })
      .expect(400);
    await request(http)
      .post(`${fuel}/vehicles/${vehicleId}/profile`)
      .set(headers())
      .send({ ...profileDto(), profile: { ...profile, reserveLitres: 600 } })
      .expect(400);
    expect(await db.deliveryFuelPriceRevision.count({ where: { tenantId } })).toBe(0);
  });
  it('serializes duplicate and competing profile requests, binds actor and exact body', async () => {
    const dto = profileDto();
    const results = await Promise.all(
      [1, 2].map(() =>
        request(http).post(`${fuel}/vehicles/${vehicleId}/profile`).set(headers()).send(dto),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    profileRevision = 1;
    expect(await db.deliveryFuelProfileRevision.count({ where: { tenantId, vehicleId } })).toBe(1);
    await request(http)
      .post(`${fuel}/vehicles/${vehicleId}/profile`)
      .set(headers())
      .send({ ...dto, profile: { ...profile, reserveLitres: 50 } })
      .expect(409);
    const actor = await db.user.create({
      data: {
        tenantId,
        email: `${suffix}-other@example.invalid`,
        passwordHash: 'fixture',
        firstName: 'Autre',
        lastName: 'Acteur',
      },
    });
    await request(http)
      .post(`${fuel}/vehicles/${vehicleId}/profile`)
      .set(headers(sign(ALL_PERMISSION_KEYS, actor.id)))
      .send(dto)
      .expect(409);
    const race = await Promise.all(
      [1, 2].map(() =>
        request(http)
          .post(`${fuel}/vehicles/${vehicleId}/profile`)
          .set(headers())
          .send(profileDto()),
      ),
    );
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    profileRevision = 2;
    expect(
      await db.auditLog.count({ where: { tenantId, entityType: 'delivery_fuel_profile' } }),
    ).toBe(2);
  });
  it('captures an explicitly selected historical price and rejects future/date/currency/stale profile', async () => {
    priceRevision = (
      await request(http).post(`${fuel}/prices`).set(headers()).send(priceDto()).expect(201)
    ).body.revision;
    const future = await request(http)
      .post(`${fuel}/prices`)
      .set(headers())
      .send({ ...priceDto(), price: { ...price, effectiveOn: '2099-01-01' } })
      .expect(201);
    expect(future.body.revision).toBe(2);
    const dto = await planDto();
    for (const fuelSource of [
      { ...dto.fuelSource, priceRevision: 2 },
      { ...dto.fuelSource, currency: 'USD' },
      { ...dto.fuelSource, profileRevision: 1 },
      { ...dto.fuelSource, asOf: '2026-10-01' },
      { ...dto.fuelSource, vehicleId: foreignVehicle },
    ]) {
      const rejected = await request(http)
        .post(`${prefix}/routes/preview`)
        .set(headers())
        .send({ ...dto, fuelSource });
      expect([400, 409]).toContain(rejected.status);
    }
    const preview = await request(http)
      .post(`${prefix}/routes/preview`)
      .set(headers())
      .send(dto)
      .expect(201);
    expect(preview.body.deliveryPlan.fuelSource).toMatchObject({
      profileRevision: 2,
      priceRevision: 1,
      profile,
      price,
    });
    expect(preview.body.deliveryPlan.totals).toMatchObject({
      liters: 60,
      fuelCost: 99,
      distanceKm: 200,
    });
    route = (await request(http).post(`${prefix}/routes`).set(headers()).send(dto).expect(201))
      .body;
    expect(route.deliveryPlan.fuelSource).toMatchObject({ priceRevision: 1, profileRevision: 2 });
  });
  it('rejects actual before transit, stale versions, permission loss and future readings', async () => {
    await request(http)
      .post(`${fuel}/loads/${loadId}/actuals`)
      .set(headers())
      .send(await actualDto())
      .expect(409);
    await post(`loads/${loadId}/dispatch`);
    await post(`loads/${loadId}/start-transit`);
    const dto = await actualDto();
    await request(http)
      .post(`${fuel}/loads/${loadId}/actuals`)
      .set(headers(sign(['transportation.planning.manage'])))
      .send(dto)
      .expect(403);
    for (const body of [
      { ...dto, expectedLoadUpdatedAt: '2000-01-01T00:00:00.000Z' },
      { ...dto, expectedRouteUpdatedAt: '2000-01-01T00:00:00.000Z' },
    ])
      await request(http)
        .post(`${fuel}/loads/${loadId}/actuals`)
        .set(headers())
        .send(body)
        .expect(409);
    await request(http)
      .post(`${fuel}/loads/${loadId}/actuals`)
      .set(headers())
      .send({ ...dto, actual: { ...actual, measuredAt: '2099-01-01T00:00:00.000Z' } })
      .expect(400);
  });
  it('serializes actual requests, keeps immutable baseline and does not modify load financials', async () => {
    const before = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    const dto = await actualDto();
    const results = await Promise.all(
      [1, 2].map(() =>
        request(http).post(`${fuel}/loads/${loadId}/actuals`).set(headers()).send(dto),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results.map((r) => r.body.id)).toEqual([results[0].body.id, results[0].body.id]);
    expect(await db.deliveryFuelActualRevision.count({ where: { tenantId, loadId } })).toBe(1);
    const c = await current();
    expect(c.actual.snapshot.baseline.deliveryPlan).toEqual(route.deliveryPlan);
    expect(c.actual.comparison).toMatchObject({
      deltaDistanceKm: 5.5,
      deltaLitres: 1.125,
      deltaCostAmount: 1.85,
    });
    const next = await actualDto();
    const race = await Promise.all(
      [1, 2].map(() =>
        request(http)
          .post(`${fuel}/loads/${loadId}/actuals`)
          .set(headers())
          .send({ ...next, operationKey: randomUUID() }),
      ),
    );
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    const after = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    expect(after.costDetail).toEqual(before.costDetail);
    expect(after.estimatedCost).toEqual(before.estimatedCost);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
  it('supports completed actual revisions with stable comparison, preserving unknown cost', async () => {
    for (const stop of route.stops) {
      await post(`routes/stops/${stop.id}/status`, { status: 'ARRIVED' });
      await post(`routes/stops/${stop.id}/status`, { status: 'DEPARTED' });
    }
    await post(`loads/${loadId}/complete`);
    const before = await current();
    const row = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    const dto = { ...(await actualDto()), actual: { ...actual, costAmount: null, currency: null } };
    const saved = await request(http)
      .post(`${fuel}/loads/${loadId}/actuals`)
      .set(headers())
      .send(dto)
      .expect(201);
    expect(saved.body.snapshot.baseline).toEqual(before.actual.snapshot.baseline);
    expect((await current()).actual.comparison.deltaCostAmount).toBeNull();
    const after = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    expect(after.status).toBe('COMPLETED');
    expect(after.costDetail).toEqual(row.costDetail);
    expect(after.estimatedCost).toEqual(row.estimatedCost);
    expect(after.updatedAt).toEqual(row.updatedAt);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await request(http)
      .post(`${fuel}/loads/${loadId}/actuals`)
      .set(headers())
      .send(dto)
      .expect(403);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      data: { enabled: true },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    const replay = await request(http)
      .post(`${fuel}/loads/${loadId}/actuals`)
      .set(headers())
      .send(dto)
      .expect(201);
    expect(replay.body.id).toBe(saved.body.id);
  });
  it('keeps histories tenant-scoped, paginated, and SQL-immutable', async () => {
    const result = await request(http)
      .get(`${fuel}/loads/${loadId}/actuals?page=1`)
      .set(headers())
      .expect(200);
    expect(result.body.total).toBe(3);
    expect(result.body.items).toHaveLength(3);
    expect(result.body.pageSize).toBe(20);
    for (const item of result.body.items) {
      expect(item).not.toHaveProperty('fingerprint');
      expect(item).not.toHaveProperty('actorId');
      expect(item).not.toHaveProperty('operationKey');
    }
    const id = result.body.items[0].id;
    await expect(
      db.$executeRaw`UPDATE delivery_fuel_actual_revisions SET revision = revision + 1 WHERE id = ${id} AND "tenantId" = ${tenantId}`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`DELETE FROM delivery_fuel_actual_revisions WHERE id = ${id} AND "tenantId" = ${tenantId}`,
    ).rejects.toThrow();
    expect(await db.deliveryFuelActualRevision.count({ where: { tenantId, loadId } })).toBe(3);
    expect(
      await db.auditLog.count({ where: { tenantId, entityType: 'delivery_fuel_actual' } }),
    ).toBe(3);
  });
});
