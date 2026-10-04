/** Real HTTP + PostgreSQL regression. Run only on a disposable migrated/seeded database. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PERMISSIONS } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RoutingService } from '../src/core/routing/routing.service';
import { ModuleSettingsService } from '../src/core/module-registry/module-settings.service';

describe('Delivery packages (HTTP + database)', () => {
  let app: INestApplication, http: any, db: PrismaService, token: string, tenantId: string;
  let readToken: string, noReadToken: string, otherActorToken: string;
  let loadId: string, vehicleId: string, otherVehicleId: string, driverId: string;
  let origin: string,
    destination: string,
    foreignShipment: string,
    foreignLoad: string,
    foreignPackage: string;
  const shipments: string[] = [],
    packages: string[] = [];
  let stops: { id: string }[] = [];
  let createBody: Record<string, unknown>, createReceipt: any, cancelledId: string;
  let firstDeliveryAt: string, initialPickup: Date | null, frozenCost: unknown;
  let restoreSettings: Record<string, unknown>;
  const suffix = `PK${Date.now().toString(36)}`;
  const base = '/api/v1/transportation';
  const parcel = `${base}/delivery-packages`;
  const headers = (auth = token) => ({ Authorization: `Bearer ${auth}` });
  const contents = (quantity = '40.000') => [
    { reference: 'COMP-1', description: 'Composants', quantity, unit: 'piece' },
  ];
  const current = (id: string) => db.deliveryPackage.findFirstOrThrow({ where: { tenantId, id } });
  const shipment = (id: string) => db.shipment.findFirstOrThrow({ where: { tenantId, id } });
  const settings = (value: Record<string, unknown>) =>
    request(http)
      .put('/api/v1/modules/transportation/settings')
      .set(headers())
      .send({ settings: value });
  const transition = async (id: string, target: string, extra: Record<string, unknown> = {}) => {
    const p = await current(id);
    const s = await shipment(p.shipmentId);
    const load = await db.load.findFirstOrThrow({ where: { tenantId, id: s.loadId! } });
    return request(http)
      .post(`${parcel}/${id}/transition`)
      .set(headers())
      .send({
        operationKey: randomUUID(),
        expectedVersion: p.version,
        expectedLoadId: load.id,
        expectedLoadUpdatedAt: load.updatedAt.toISOString(),
        target,
        ...extra,
      });
  };
  const stop = (index: number, status: string) =>
    request(http)
      .post(`${base}/routes/stops/${stops[index].id}/status`)
      .set(headers())
      .send({ status });
  const routing = {
    geocode: jest.fn(async () => null),
    route: jest.fn(async (points: unknown[]) => ({
      distanceKm: (points.length - 1) * 20,
      durationMin: (points.length - 1) * 15,
      geometry: null,
      legs: points.slice(1).map(() => ({ distanceKm: 20, durationMin: 15 })),
    })),
    table: jest.fn(async () => null),
  };

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
    db = app.get(PrismaService);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;
    tenantId = login.body.tenant.id;
    const jwt = new JwtService({ secret: app.get(ConfigService).getOrThrow('JWT_SECRET') });
    const claims = jwt.decode(token) as { sub: string; email: string; permissions: string[] };
    const sign = (permissions: string[], userId = claims.sub) =>
      jwt.sign({ sub: userId, tenantId, email: claims.email, permissions }, { expiresIn: '15m' });
    readToken = sign([PERMISSIONS.TRANSPORTATION.PLANNING_READ]);
    noReadToken = sign([PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE]);
    const actor = await db.user.create({
      data: {
        tenantId,
        email: `${suffix}@example.test`,
        firstName: 'Second',
        lastName: 'Actor',
        passwordHash: 'not-a-login-password',
      },
    });
    otherActorToken = sign(claims.permissions, actor.id);
    const resolved = await app.get(ModuleSettingsService).resolve(tenantId, 'transportation');
    restoreSettings = {
      podRequiredBeforeCompletion: resolved.podRequiredBeforeCompletion,
      requireTendering: resolved.requireTendering,
      bolRequiredBeforeDispatch: resolved.bolRequiredBeforeDispatch,
    };
    await settings({
      podRequiredBeforeCompletion: false,
      requireTendering: 'OPTIONAL',
      bolRequiredBeforeDispatch: false,
    }).expect(200);
    const customer = await request(http)
      .post(`${base}/customers`)
      .set(headers())
      .send({ code: `${suffix}-C`, name: 'Distribution composants' })
      .expect(201);
    const locations: string[] = [];
    for (const [code, latitude] of [
      ['A', 45],
      ['B', 46],
    ] as const) {
      const location = await request(http)
        .post(`${base}/locations`)
        .set(headers())
        .send({
          code: `${suffix}-${code}`,
          name: code,
          type: 'WAREHOUSE',
          addressLine1: '1 Recette',
          city: 'Laval',
          latitude,
          longitude: -73,
        })
        .expect(201);
      locations.push(location.body.id);
    }
    [origin, destination] = locations;
    for (let i = 0; i < 2; i++) {
      const order = await request(http)
        .post(`${base}/transport-orders`)
        .set(headers())
        .send({
          customerId: customer.body.id,
          originLocationId: origin,
          destinationLocationId: destination,
          totalWeightKg: 100,
          palletCount: 1,
        })
        .expect(201);
      await request(http)
        .post(`${base}/transport-orders/${order.body.id}/confirm`)
        .set(headers())
        .expect(201);
      const plan = await request(http)
        .post(`${base}/transport-orders/${order.body.id}/plan`)
        .set(headers())
        .send({})
        .expect(201);
      shipments.push(plan.body.shipments[0].id);
    }
    loadId = (await request(http).post(`${base}/loads`).set(headers()).send({}).expect(201)).body
      .id;
    for (const id of shipments)
      await request(http)
        .post(`${base}/shipments/${id}/assign-load`)
        .set(headers())
        .send({ loadId })
        .expect(201);
    driverId = (
      await db.driver.create({ data: { tenantId, firstName: 'Camille', lastName: suffix } })
    ).id;
    vehicleId = (await db.vehicle.create({ data: { tenantId, unitNumber: `${suffix}-V` } })).id;
    otherVehicleId = (
      await db.vehicle.create({ data: { tenantId, unitNumber: `${suffix}-OTHER` } })
    ).id;
    const rate = await db.rate.create({
      data: {
        tenantId,
        name: suffix,
        rateType: 'FLAT',
        baseAmount: '250.00',
        currency: 'CAD',
        status: 'ACTIVE',
      },
    });
    await request(http)
      .post(`${base}/loads/${loadId}/assign`)
      .set(headers())
      .send({ driverId, vehicleId, rateId: rate.id })
      .expect(201);
    const foreign = await db.tenant.create({
      data: { slug: `${suffix.toLowerCase()}-foreign`, name: 'Private tenant' },
    });
    const fc = await db.customer.create({
      data: { tenantId: foreign.id, code: 'C', name: 'Private' },
    });
    const fl = await db.location.create({
      data: {
        tenantId: foreign.id,
        code: 'L',
        name: 'Private',
        addressLine1: 'Private',
        city: 'Private',
      },
    });
    const fo = await db.transportOrder.create({
      data: {
        tenantId: foreign.id,
        orderNumber: 'TO-P',
        customerId: fc.id,
        originLocationId: fl.id,
        destinationLocationId: fl.id,
      },
    });
    foreignLoad = (await db.load.create({ data: { tenantId: foreign.id, loadNumber: 'LD-P' } })).id;
    foreignShipment = (
      await db.shipment.create({
        data: {
          tenantId: foreign.id,
          shipmentNumber: 'SH-P',
          transportOrderId: fo.id,
          originLocationId: fl.id,
          destinationLocationId: fl.id,
          loadId: foreignLoad,
        },
      })
    ).id;
    foreignPackage = (
      await db.deliveryPackage.create({
        data: {
          tenantId: foreign.id,
          shipmentId: foreignShipment,
          code: 'PKG-P',
          label: '',
          contents: contents(),
        },
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    try {
      if (restoreSettings) await settings(restoreSettings).expect(200);
    } finally {
      await app?.close();
    }
  });

  it('enforces read/manage permissions and tenant ownership', async () => {
    await request(http).get(parcel).query({ loadId }).set(headers(noReadToken)).expect(403);
    await request(http).get(parcel).query({ loadId }).set(headers(readToken)).expect(200);
    await request(http).get(parcel).query({ loadId: foreignLoad }).set(headers()).expect(404);
    await request(http).get(`${parcel}/${foreignPackage}/events`).set(headers()).expect(404);
    const body = {
      operationKey: randomUUID(),
      expectedUpdatedAt: (await shipment(shipments[0])).updatedAt.toISOString(),
      label: 'Colis',
      contents: contents(),
    };
    await request(http)
      .post(`${parcel}/shipment/${shipments[0]}`)
      .set(headers(readToken))
      .send(body)
      .expect(403);
    await request(http)
      .post(`${parcel}/shipment/${foreignShipment}`)
      .set(headers())
      .send(body)
      .expect(404);
  });

  it('rejects malformed or unqualified contents without enabling tracking', async () => {
    const before = await shipment(shipments[0]);
    for (const invalid of [
      [],
      [{ ...contents()[0], quantity: 12 }],
      [{ ...contents()[0], quantity: '0' }],
      [{ ...contents()[0], quantity: '1.0001' }],
      [{ ...contents()[0], extra: 'hidden' }],
    ]) {
      await request(http)
        .post(`${parcel}/shipment/${shipments[0]}`)
        .set(headers())
        .send({
          operationKey: randomUUID(),
          expectedUpdatedAt: before.updatedAt.toISOString(),
          label: 'Invalid',
          contents: invalid,
        })
        .expect(400);
    }
    expect((await shipment(shipments[0])).packageTrackingEnabledAt).toBeNull();
    expect(await db.deliveryPackage.count({ where: { tenantId, shipmentId: shipments[0] } })).toBe(
      0,
    );
  });

  it('creates one package for concurrent identical UUIDs in different case and replays exactly', async () => {
    createBody = {
      operationKey: randomUUID(),
      expectedUpdatedAt: (await shipment(shipments[0])).updatedAt.toISOString(),
      label: 'Carton 1',
      contents: contents(),
    };
    const results = await Promise.all([
      request(http).post(`${parcel}/shipment/${shipments[0]}`).set(headers()).send(createBody),
      request(http)
        .post(`${parcel}/shipment/${shipments[0]}`)
        .set(headers())
        .send({ ...createBody, operationKey: String(createBody.operationKey).toUpperCase() }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    createReceipt = results[0].body;
    packages.push(createReceipt.packageId);
    expect(createReceipt.code).toMatch(/^PKG-/);
    expect((await current(packages[0])).contents).toEqual(contents('40'));
    expect((await shipment(shipments[0])).packageTrackingEnabledAt).not.toBeNull();
    expect(
      await db.deliveryPackageEvent.count({
        where: { tenantId, operationKey: String(createBody.operationKey) },
      }),
    ).toBe(1);
    await request(http)
      .post(`${parcel}/shipment/${shipments[0]}`)
      .set(headers())
      .send({ ...createBody, label: 'Different' })
      .expect(409);
    await request(http)
      .post(`${parcel}/shipment/${shipments[0]}`)
      .set(headers(otherActorToken))
      .send(createBody)
      .expect(409);
  });

  it('rejects stale creation, serializes different concurrent creates, and permits append-only cancellation', async () => {
    await request(http)
      .post(`${parcel}/shipment/${shipments[0]}`)
      .set(headers())
      .send({ ...createBody, operationKey: randomUUID() })
      .expect(409);
    const expectedUpdatedAt = (await shipment(shipments[0])).updatedAt.toISOString();
    const results = await Promise.all(
      [1, 2].map((i) =>
        request(http)
          .post(`${parcel}/shipment/${shipments[0]}`)
          .set(headers())
          .send({
            operationKey: randomUUID(),
            expectedUpdatedAt,
            label: `Carton ${i + 1}`,
            contents: contents(),
          }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    packages.push(results.find((r) => r.status === 201)!.body.packageId);
    const third = await request(http)
      .post(`${parcel}/shipment/${shipments[1]}`)
      .set(headers())
      .send({
        operationKey: randomUUID(),
        expectedUpdatedAt: (await shipment(shipments[1])).updatedAt.toISOString(),
        label: 'Carton 3',
        contents: contents('20'),
      })
      .expect(201);
    packages.push(third.body.packageId);
    const cancelled = await request(http)
      .post(`${parcel}/shipment/${shipments[1]}`)
      .set(headers())
      .send({
        operationKey: randomUUID(),
        expectedUpdatedAt: (await shipment(shipments[1])).updatedAt.toISOString(),
        label: 'Erreur corrigée',
        contents: contents('1'),
      })
      .expect(201);
    cancelledId = cancelled.body.packageId;
    expect((await transition(cancelledId, 'CANCELLED')).status).toBe(201);
    expect((await transition(cancelledId, 'LOADED')).status).toBe(409);
    expect(
      await db.deliveryPackageEvent.count({ where: { tenantId, packageId: cancelledId } }),
    ).toBe(2);
    expect((await shipment(shipments[1])).packageTrackingEnabledAt).not.toBeNull();
  });

  it('edits with version checks and unloads without clearing the composite tenant FK', async () => {
    const p = await current(packages[0]);
    const edit = {
      operationKey: randomUUID(),
      expectedVersion: p.version,
      label: 'Carton fragile',
      contents: contents(),
    };
    await request(http).patch(`${parcel}/${p.id}`).set(headers()).send(edit).expect(200);
    await request(http)
      .patch(`${parcel}/${p.id}`)
      .set(headers())
      .send({ ...edit, operationKey: randomUUID() })
      .expect(409);
    expect((await transition(p.id, 'LOADED')).status).toBe(201);
    await request(http)
      .post(`${base}/loads/${loadId}/assign`)
      .set(headers())
      .send({ vehicleId: otherVehicleId })
      .expect(409);
    expect((await transition(p.id, 'PREPARED')).status).toBe(201);
    expect(await current(p.id)).toMatchObject({
      tenantId,
      loadedLoadId: null,
      loadedAt: null,
      status: 'PREPARED',
    });
    expect((await shipment(shipments[0])).actualPickupAt).toBeNull();
    const unloaded = await current(p.id);
    const originalLoad = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    const staleLoadBody = {
      operationKey: randomUUID(),
      expectedVersion: unloaded.version,
      target: 'LOADED',
      expectedLoadId: loadId,
      expectedLoadUpdatedAt: originalLoad.updatedAt.toISOString(),
    };
    await request(http)
      .post(`${base}/loads/${loadId}/assign`)
      .set(headers())
      .send({ vehicleId: otherVehicleId })
      .expect(201);
    await request(http)
      .post(`${parcel}/${p.id}/transition`)
      .set(headers())
      .send(staleLoadBody)
      .expect(409);
    await request(http)
      .post(`${base}/loads/${loadId}/assign`)
      .set(headers())
      .send({ vehicleId })
      .expect(201);
    const alternateLoad = (
      await request(http).post(`${base}/loads`).set(headers()).send({}).expect(201)
    ).body.id;
    await request(http)
      .post(`${base}/loads/${alternateLoad}/assign`)
      .set(headers())
      .send({ driverId, vehicleId, rateId: originalLoad.rateId })
      .expect(201);
    const beforeReassignment = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    // Existing reassignment workflow returns prepared shipments to the pool by cancelling the load.
    await request(http).post(`${base}/loads/${loadId}/cancel`).set(headers()).expect(201);
    await request(http)
      .post(`${base}/shipments/${shipments[0]}/assign-load`)
      .set(headers())
      .send({ loadId: alternateLoad })
      .expect(201);
    await request(http)
      .post(`${parcel}/${p.id}/transition`)
      .set(headers())
      .send({
        ...staleLoadBody,
        operationKey: randomUUID(),
        expectedLoadUpdatedAt: beforeReassignment.updatedAt.toISOString(),
      })
      .expect(409);
    await request(http)
      .post(`${base}/shipments/${shipments[1]}/assign-load`)
      .set(headers())
      .send({ loadId: alternateLoad })
      .expect(201);
    loadId = alternateLoad;
    for (const id of packages.slice(0, 2))
      expect((await transition(id, 'LOADED')).status).toBe(201);
    initialPickup = (await shipment(shipments[0])).actualPickupAt;
    expect(initialPickup).not.toBeNull();
    const events = await request(http).get(`${parcel}/${p.id}/events`).set(headers()).expect(200);
    const loaded = events.body.find((e: any) => e.kind === 'LOADED');
    expect(loaded.snapshot.evidence.load).toMatchObject({ id: loadId, vehicleId, driverId });
    const replay = await request(http)
      .post(`${parcel}/shipment/${shipments[0]}`)
      .set(headers())
      .send(createBody)
      .expect(201);
    expect(replay.body).toEqual(createReceipt);
    expect((await current(p.id)).status).toBe('LOADED');
    const firstEvent = await db.deliveryPackageEvent.findFirstOrThrow({
      where: { tenantId, operationKey: String(createBody.operationKey) },
    });
    expect((firstEvent.snapshot as any).package).toMatchObject({
      label: 'Carton 1',
      version: 1,
      status: 'PREPARED',
    });
  });

  it('dispatches with a later pickup pending and requires the actual pickup stop', async () => {
    const load = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    const route = await request(http)
      .post(`${base}/routes`)
      .set(headers())
      .send({
        loadId,
        expectedUpdatedAt: load.updatedAt.toISOString(),
        planning: { serviceMinutes: 10 },
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: origin, shipmentId: shipments[0] },
          { sequence: 2, type: 'PICKUP', locationId: origin, shipmentId: shipments[1] },
          { sequence: 3, type: 'DELIVERY', locationId: destination, shipmentId: shipments[0] },
          { sequence: 4, type: 'DELIVERY', locationId: destination, shipmentId: shipments[1] },
        ],
      })
      .expect(201);
    stops = route.body.stops;
    await request(http).post(`${base}/loads/${loadId}/dispatch`).set(headers()).expect(201);
    await request(http).post(`${base}/loads/${loadId}/start-transit`).set(headers()).expect(201);
    expect((await shipment(shipments[0])).actualPickupAt).toEqual(initialPickup);
    expect((await shipment(shipments[1])).actualPickupAt).toBeNull();
    expect((await transition(packages[2], 'LOADED')).status).toBe(409);
    await stop(0, 'ARRIVED').expect(201);
    await stop(0, 'DEPARTED').expect(201);
    await stop(1, 'ARRIVED').expect(201);
    expect((await transition(packages[2], 'LOADED')).status).toBe(201);
    expect((await shipment(shipments[1])).actualPickupAt).not.toBeNull();
    expect((await transition(packages[2], 'PREPARED')).status).toBe(409);
    await stop(1, 'DEPARTED').expect(201);
    expect(
      (await transition(packages[0], 'DELIVERED', { recipientName: 'Réception A' })).status,
    ).toBe(409);
    frozenCost = (await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } })).costDetail;
    expect(frozenCost).not.toBeNull();
  });

  it('records partial delivery, rolls back the last package without required POD, then delivers only its shipment', async () => {
    await stop(2, 'ARRIVED').expect(201);
    expect((await transition(packages[0], 'DELIVERED')).status).toBe(400);
    expect(
      (await transition(packages[0], 'DELIVERED', { recipientName: 'Réception A' })).status,
    ).toBe(201);
    expect((await shipment(shipments[0])).status).toBe('IN_TRANSIT');
    await settings({ podRequiredBeforeCompletion: true }).expect(200);
    const p = await current(packages[1]);
    const body = {
      operationKey: randomUUID(),
      expectedVersion: p.version,
      expectedLoadId: loadId,
      expectedLoadUpdatedAt: (
        await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } })
      ).updatedAt.toISOString(),
      target: 'DELIVERED',
      recipientName: 'Réception A',
    };
    const eventCount = await db.deliveryPackageEvent.count({
      where: { tenantId, packageId: p.id },
    });
    await request(http).post(`${parcel}/${p.id}/transition`).set(headers()).send(body).expect(409);
    expect(await current(p.id)).toMatchObject({
      version: p.version,
      status: 'LOADED',
      deliveredAt: null,
    });
    expect(await db.deliveryPackageEvent.count({ where: { tenantId, packageId: p.id } })).toBe(
      eventCount,
    );
    await request(http)
      .post(`${base}/tracking/pod`)
      .set(headers())
      .send({
        shipmentId: shipments[0],
        signedByName: 'Réception A',
        signedAt: new Date().toISOString(),
      })
      .expect(201);
    await request(http).post(`${parcel}/${p.id}/transition`).set(headers()).send(body).expect(201);
    expect((await shipment(shipments[0])).status).toBe('DELIVERED');
    expect((await shipment(shipments[1])).status).toBe('IN_TRANSIT');
    firstDeliveryAt = (await shipment(shipments[0])).actualDeliveryAt!.toISOString();
    await stop(2, 'DEPARTED').expect(201);
    await stop(3, 'ARRIVED').expect(201);
    await stop(3, 'DEPARTED').expect(201);
    await request(http).post(`${base}/loads/${loadId}/complete`).set(headers()).expect(400);
    expect((await shipment(shipments[1])).actualDeliveryAt).toBeNull();
  });

  it('completes after the final package without overwriting individual timestamps or costs', async () => {
    await request(http)
      .post(`${base}/tracking/pod`)
      .set(headers())
      .send({ shipmentId: shipments[1], signedByName: 'Réception B' })
      .expect(201);
    expect(
      (await transition(packages[2], 'DELIVERED', { recipientName: 'Réception B' })).status,
    ).toBe(201);
    const secondDeliveryAt = (await shipment(shipments[1])).actualDeliveryAt!.toISOString();
    const completed = await request(http)
      .post(`${base}/loads/${loadId}/complete`)
      .set(headers())
      .expect(201);
    expect(completed.body.status).toBe('COMPLETED');
    expect((await shipment(shipments[0])).actualDeliveryAt!.toISOString()).toBe(firstDeliveryAt);
    expect((await shipment(shipments[1])).actualDeliveryAt!.toISOString()).toBe(secondDeliveryAt);
    expect(
      (await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } })).costDetail,
    ).toEqual(frozenCost);
    expect((await current(cancelledId)).status).toBe('CANCELLED');
    for (const id of packages) expect((await current(id)).status).toBe('DELIVERED');
    expect((await transition(packages[0], 'PREPARED')).status).toBe(409);
    const replay = await request(http)
      .post(`${parcel}/shipment/${shipments[0]}`)
      .set(headers())
      .send(createBody)
      .expect(201);
    expect(replay.body).toEqual(createReceipt);
    expect((await current(packages[0])).status).toBe('DELIVERED');
    for (const id of shipments)
      expect(
        await db.trackingEvent.count({ where: { tenantId, shipmentId: id, type: 'DELIVERED' } }),
      ).toBe(1);
  });
});
