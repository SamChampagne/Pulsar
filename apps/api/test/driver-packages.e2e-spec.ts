/**
 * HTTP + PostgreSQL, only against a disposable migrated/seeded test database.
 * Every fixture belongs to a dedicated tenant; routing and storage never leave
 * this process. Operational setup uses TMS HTTP workflows. The one direct
 * reassignment below is an isolated fixture race, not a production writer.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ALL_PERMISSION_KEYS } from '@pulsar/shared';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FILE_STORAGE } from '../src/core/documents/storage/file-storage';
import { RoutingService } from '../src/core/routing/routing.service';
import { DeliveryPackagesService } from '../src/modules/transportation/delivery-packages/delivery-packages.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

interface TenantFixture {
  id: string;
  actorId: string;
  auth: string;
}
interface Mission {
  tenant: TenantFixture;
  loadId: string;
  driverId: string;
  vehicleId: string;
  token: string;
  locationIds: string[];
  stops: { id: string; sequence: number }[];
  shipments: { id: string; number: string; packages: { id: string; code: string }[] }[];
}
interface DriverPackage {
  ref: string;
  code: string;
  label: string;
  status: string;
  version: number;
  contents: { reference: string; description: string; quantity: string; unit: string }[];
  loadedAt: string | null;
  deliveredAt: string | null;
}
interface DriverPackagesView {
  loadNumber: string;
  status: string;
  updatedAt: string;
  shipments: {
    ref: string;
    shipmentNumber: string;
    status: string;
    originName: string;
    destinationName: string;
    hasPod: boolean;
    packages: DriverPackage[];
  }[];
}
interface Intent {
  ref: string;
  body: {
    operationKey: string;
    expectedVersion: number;
    expectedLoadUpdatedAt: string;
    target: 'LOADED' | 'DELIVERED';
    recipientName?: string;
    notes?: string;
  };
}

describe('Driver packages (HTTP + database)', () => {
  let app: INestApplication, http: any, db: PrismaService, moduleId: string;
  let tenant: TenantFixture, foreignTenant: TenantFixture;
  let main: Mission, side: Mission, alternate: Mission, foreign: Mission;
  let lastLoadIntent: Intent, closedDeliveryIntent: Intent;
  let closedDeliveryReceipt: unknown;
  const suffix = `DP${Date.now().toString(36)}${randomUUID().slice(0, 5)}`;
  const transport = '/api/v1/transportation';
  const authPackages = `${transport}/delivery-packages`;
  const driverUrl = (mission: Mission) => `/api/v1/public/driver/${mission.token}`;
  const headers = (fixture: TenantFixture) => ({ Authorization: `Bearer ${fixture.auth}` });
  const opaque = /^[A-Za-z0-9_-]{43}$/;
  const privateNote = `PRIVATE-LOAD-NOTE-${suffix}`;
  const exceptionNote = `PRIVATE-EXCEPTION-${suffix}`;
  const contents = [
    { reference: 'COMP-1', description: 'Supports de montage', quantity: '0.125', unit: 'kg' },
  ];
  const blobs = new Map<string, Buffer>();
  const storage = {
    put: jest.fn(async (key: string, body: Buffer) => {
      blobs.set(key, Buffer.from(body));
    }),
    get: jest.fn(async (key: string) => {
      const body = blobs.get(key);
      if (!body) throw new Error('Fixture file is unavailable');
      return Readable.from([Buffer.from(body)]);
    }),
    delete: jest.fn(async (key: string) => {
      blobs.delete(key);
    }),
    getDownloadUrl: jest.fn(async () => null),
    getUploadUrl: jest.fn(async () => null),
  };
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
  const view = async (mission = main): Promise<DriverPackagesView> =>
    (
      await request(http)
        .get(`${driverUrl(mission)}/packages`)
        .expect(200)
    ).body;
  const allPackages = (v: DriverPackagesView) => v.shipments.flatMap((s) => s.packages);
  const packageFor = (v: DriverPackagesView, code: string) => {
    const p = allPackages(v).find((p) => p.code === code);
    if (!p) throw new Error(`Missing package fixture ${code}`);
    return p;
  };
  const intent = async (
    mission: Mission,
    code: string,
    target: 'LOADED' | 'DELIVERED',
  ): Promise<Intent> => {
    const v = await view(mission);
    const p = packageFor(v, code);
    return {
      ref: p.ref,
      body: {
        operationKey: randomUUID(),
        expectedVersion: p.version,
        expectedLoadUpdatedAt: v.updatedAt,
        target,
        ...(target === 'DELIVERED' ? { recipientName: 'Réception de test' } : {}),
      },
    };
  };
  const transition = (mission: Mission, i: Intent) =>
    request(http)
      .post(`${driverUrl(mission)}/packages/${i.ref}/transition`)
      .send(i.body);
  const exception = (mission: Mission, ref: string, body: Record<string, unknown>) =>
    request(http)
      .post(`${driverUrl(mission)}/packages/${ref}/exception`)
      .send(body);
  const packageRow = (mission: Mission, id: string) =>
    db.deliveryPackage.findFirstOrThrow({ where: { tenantId: mission.tenant.id, id } });
  const eventCount = (mission: Mission, operationKey?: string) =>
    db.deliveryPackageEvent.count({
      where: { tenantId: mission.tenant.id, ...(operationKey ? { operationKey } : {}) },
    });
  const makeToken = async (mission: Mission) => {
    const response = await request(http)
      .post(`${transport}/loads/${mission.loadId}/driver-link`)
      .set(headers(mission.tenant))
      .expect(201);
    mission.token = new URL(response.body.url, 'http://fixture.invalid').pathname.split('/').pop()!;
  };
  const driverView = async (mission = main) =>
    (await request(http).get(driverUrl(mission)).expect(200)).body;
  const stopStatus = async (sequence: number, status: 'ARRIVED' | 'DEPARTED') => {
    const v = await driverView();
    const stop = v.stops.find((s: { sequence: number }) => s.sequence === sequence);
    expect(stop.id).toMatch(opaque);
    return request(http)
      .post(`${driverUrl(main)}/stops/${stop.id}/status`)
      .send({ status })
      .expect(200);
  };
  const noPrivateValues = (body: unknown, mission: Mission) => {
    const serialized = JSON.stringify(body);
    const secrets = [
      mission.tenant.id,
      mission.tenant.actorId,
      mission.loadId,
      mission.driverId,
      mission.vehicleId,
      mission.token,
      privateNote,
      exceptionNote,
      ...mission.locationIds,
      ...mission.stops.map((s) => s.id),
      ...mission.shipments.flatMap((s) => [s.id, ...s.packages.map((p) => p.id)]),
    ];
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    const inspect = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        expect([
          'tenantId',
          'loadId',
          'shipmentId',
          'packageId',
          'driverToken',
          'trackingToken',
          'estimatedCost',
          'costDetail',
          'buyRate',
          'sellRate',
          'notes',
          'note',
        ]).not.toContain(key);
        inspect(child);
      }
    };
    inspect(body);
  };
  const createTenant = async (label: string): Promise<TenantFixture> => {
    const t = await db.tenant.create({
      data: { slug: `${suffix}-${label}`.toLowerCase(), name: `Driver fixture ${label}` },
    });
    await db.tenantModule.create({
      data: {
        tenantId: t.id,
        moduleId,
        enabled: true,
        settings: {
          requireTendering: 'OPTIONAL',
          bolRequiredBeforeDispatch: false,
          podRequiredBeforeCompletion: true,
        },
      },
    });
    const user = await db.user.create({
      data: {
        tenantId: t.id,
        email: `${suffix}-${label}@example.test`,
        passwordHash: 'fixture-not-a-login',
        firstName: 'Opérateur',
        lastName: label,
      },
    });
    const jwt = new JwtService({ secret: app.get(ConfigService).getOrThrow('JWT_SECRET') });
    return {
      id: t.id,
      actorId: user.id,
      auth: jwt.sign(
        {
          sub: user.id,
          tenantId: t.id,
          email: user.email,
          permissions: ALL_PERMISSION_KEYS,
        },
        { expiresIn: '30m' },
      ),
    };
  };
  const createMission = async (
    t: TenantFixture,
    label: string,
    packageCounts: number[],
    managedRoute = false,
  ): Promise<Mission> => {
    const post = (path: string, body: object = {}) =>
      request(http).post(`${transport}/${path}`).set(headers(t)).send(body).expect(201);
    const customer = (
      await post('customers', { code: `${suffix}-${label}-C`, name: `Client ${label}` })
    ).body;
    const locationIds: string[] = [];
    for (const [index, name] of ['Atelier origine', 'Dépôt destination'].entries()) {
      locationIds.push(
        (
          await post('locations', {
            code: `${suffix}-${label}-${index}`,
            name,
            type: 'WAREHOUSE',
            addressLine1: `${index + 1} Rue Test`,
            city: 'Laval',
            state: 'QC',
            country: 'CA',
            postalCode: 'H7A 1A1',
            latitude: 45 + index,
            longitude: -73,
          })
        ).body.id,
      );
    }
    const loadId = (await post('loads')).body.id;
    const shipments: Mission['shipments'] = [];
    for (const count of packageCounts) {
      const order = (
        await post('transport-orders', {
          customerId: customer.id,
          originLocationId: locationIds[0],
          destinationLocationId: locationIds[1],
          totalWeightKg: 100,
          palletCount: 1,
        })
      ).body;
      await post(`transport-orders/${order.id}/confirm`);
      const shipment = (await post(`transport-orders/${order.id}/plan`)).body.shipments[0];
      await post(`shipments/${shipment.id}/assign-load`, { loadId });
      const packages: Mission['shipments'][number]['packages'] = [];
      for (let n = 0; n < count; n++) {
        const current = await db.shipment.findFirstOrThrow({
          where: { tenantId: t.id, id: shipment.id },
        });
        const p = (
          await request(http)
            .post(`${authPackages}/shipment/${shipment.id}`)
            .set(headers(t))
            .send({
              operationKey: randomUUID(),
              expectedUpdatedAt: current.updatedAt.toISOString(),
              label: `Carton ${label} ${n + 1}`,
              contents,
            })
            .expect(201)
        ).body;
        packages.push({ id: p.packageId, code: p.code });
      }
      shipments.push({ id: shipment.id, number: shipment.shipmentNumber, packages });
    }
    const driver = await db.driver.create({
      data: { tenantId: t.id, firstName: 'Camille', lastName: label },
    });
    const vehicle = await db.vehicle.create({
      data: { tenantId: t.id, unitNumber: `${suffix}-${label}` },
    });
    await post(`loads/${loadId}/assign`, { driverId: driver.id, vehicleId: vehicle.id });
    let stops: Mission['stops'] = [];
    if (managedRoute) {
      const load = await db.load.findFirstOrThrow({ where: { tenantId: t.id, id: loadId } });
      const route = (
        await post('routes', {
          loadId,
          expectedUpdatedAt: load.updatedAt.toISOString(),
          planning: { startAt: '2026-10-02T12:00:00Z', serviceMinutes: 10 },
          stops: ['PICKUP', 'DELIVERY'].flatMap((type, typeIndex) =>
            shipments.map((s, index) => ({
              sequence: typeIndex * shipments.length + index + 1,
              type,
              locationId: locationIds[typeIndex],
              shipmentId: s.id,
            })),
          ),
        })
      ).body;
      stops = route.stops.map((s: { id: string; sequence: number }) => ({
        id: s.id,
        sequence: s.sequence,
      }));
    }
    const mission: Mission = {
      tenant: t,
      loadId,
      driverId: driver.id,
      vehicleId: vehicle.id,
      token: '',
      locationIds,
      stops,
      shipments,
    };
    await makeToken(mission);
    return mission;
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RoutingService)
      .useValue(routing)
      .overrideProvider(FILE_STORAGE)
      .useValue(storage)
      // These assertions exercise authorization, not the independently tested IP rate limiter.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    db = app.get(PrismaService);
    moduleId = (await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'transportation' } }))
      .id;
    tenant = await createTenant('main');
    foreignTenant = await createTenant('foreign');
    main = await createMission(tenant, 'main', [2, 1], true);
    side = await createMission(tenant, 'side', [1]);
    alternate = await createMission(tenant, 'alternate', [1]);
    foreign = await createMission(foreignTenant, 'foreign', [1]);
    const load = await db.load.findFirstOrThrow({
      where: { tenantId: tenant.id, id: main.loadId },
    });
    await request(http)
      .patch(`${transport}/loads/${main.loadId}`)
      .set(headers(tenant))
      .send({ notes: privateNote, expectedUpdatedAt: load.updatedAt.toISOString() })
      .expect(200);
    for (const mission of [main, side, foreign]) {
      await request(http)
        .post(`${transport}/loads/${mission.loadId}/dispatch`)
        .set(headers(mission.tenant))
        .expect(201);
    }
  }, 120000);

  afterAll(async () => {
    await app?.close();
  });

  it('projects only assigned packages with token-scoped references and no private identifiers', async () => {
    const v = await view();
    expect(Object.keys(v).sort()).toEqual(['loadNumber', 'shipments', 'status', 'updatedAt']);
    expect(v.shipments).toHaveLength(2);
    expect(
      allPackages(v)
        .map((p) => p.code)
        .sort(),
    ).toEqual(main.shipments.flatMap((s) => s.packages.map((p) => p.code)).sort());
    expect(allPackages(v).every((p) => p.status === 'PREPARED')).toBe(true);
    for (const s of v.shipments) {
      expect(Object.keys(s).sort()).toEqual([
        'destinationName',
        'hasPod',
        'originName',
        'packages',
        'ref',
        'shipmentNumber',
        'status',
      ]);
      expect(s.ref).toMatch(opaque);
      expect(s.hasPod).toBe(false);
      for (const p of s.packages) {
        expect(Object.keys(p).sort()).toEqual([
          'code',
          'contents',
          'deliveredAt',
          'incident',
          'label',
          'loadedAt',
          'ref',
          'status',
          'version',
        ]);
        expect(p.ref).toMatch(opaque);
        expect(p.contents).toEqual(contents);
        expect(p).toHaveProperty('incident', null);
      }
    }
    const legacy = await driverView();
    for (const s of v.shipments)
      expect(
        legacy.shipments.find(
          (row: { shipmentNumber: string }) => row.shipmentNumber === s.shipmentNumber,
        ).id,
      ).toBe(s.ref);
    for (const stop of legacy.stops) expect(stop.id).toMatch(opaque);
    noPrivateValues(v, main);
    noPrivateValues(legacy, main);
    expect(await view()).toEqual(v);
    await request(http).get('/api/v1/public/driver/invalid-capability/packages').expect(404);
  });

  it('rejects internal IDs, human codes and references from another load or tenant', async () => {
    const i = await intent(main, main.shipments[0].packages[0].code, 'LOADED');
    const wrongRefs = [
      main.shipments[0].packages[0].id,
      main.shipments[0].packages[0].code,
      allPackages(await view(side))[0].ref,
      allPackages(await view(foreign))[0].ref,
      'A'.repeat(43),
    ];
    const before = await eventCount(main);
    for (const ref of wrongRefs) {
      await transition(main, { ...i, ref }).expect(404);
      await exception(main, ref, {
        operationKey: randomUUID(),
        expectedVersion: 1,
        expectedLoadUpdatedAt: i.body.expectedLoadUpdatedAt,
        kind: 'MISSING',
        note: 'Absent du quai',
      }).expect(404);
    }
    await request(http)
      .post(`${driverUrl(main)}/pod`)
      .send({ shipmentId: main.shipments[0].id, signedByName: 'Réception' })
      .expect(404);
    await request(http)
      .post(`${driverUrl(main)}/stops/${main.stops[0].id}/status`)
      .send({ status: 'ARRIVED' })
      .expect(404);
    expect(await eventCount(main)).toBe(before);
  });

  it('validates a closed UUIDv4/version/action contract before mutation', async () => {
    const i = await intent(main, main.shipments[0].packages[0].code, 'LOADED');
    const invalid = [
      { target: 'PREPARED' },
      { target: 'CANCELLED' },
      { target: 'RETURNED' },
      { operationKey: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
      { expectedVersion: 0 },
      { expectedVersion: 1.5 },
      { expectedLoadUpdatedAt: 'yesterday' },
      { tenantId: tenant.id },
      { expectedLoadId: main.loadId },
      { packageId: main.shipments[0].packages[0].id },
      { recipientName: 'x'.repeat(121) },
      { notes: 'x'.repeat(1001) },
    ];
    const before = await eventCount(main);
    for (const extra of invalid)
      await request(http)
        .post(`${driverUrl(main)}/packages/${i.ref}/transition`)
        .send({ ...i.body, ...extra })
        .expect(400);
    expect(await eventCount(main)).toBe(before);
  });

  it('rejects stale package and load versions without recording a command', async () => {
    const i = await intent(main, main.shipments[0].packages[0].code, 'LOADED');
    await transition(main, {
      ...i,
      body: { ...i.body, expectedVersion: i.body.expectedVersion + 1 },
    }).expect(409);
    await transition(main, {
      ...i,
      body: { ...i.body, expectedLoadUpdatedAt: '2000-01-01T00:00:00.000Z' },
    }).expect(409);
    expect(await eventCount(main, i.body.operationKey)).toBe(0);
    expect((await packageRow(main, main.shipments[0].packages[0].id)).status).toBe('PREPARED');
  });

  it('commits concurrent identical loading requests once, attributed to a real disabled service user', async () => {
    const p = main.shipments[0].packages[0];
    const i = await intent(main, p.code, 'LOADED');
    const responses = await Promise.all([transition(main, i), transition(main, i)]);
    for (const response of responses) expect(response.status).toBe(200);
    expect(responses[1].body).toEqual(responses[0].body);
    expect(responses[0].body).toEqual({
      operationKey: i.body.operationKey,
      ref: i.ref,
      code: p.code,
      version: 2,
      status: 'LOADED',
    });
    expect(await eventCount(main, i.body.operationKey)).toBe(1);
    expect((await transition(main, i).expect(200)).body).toEqual(responses[0].body);
    const shipment = await db.shipment.findFirstOrThrow({
      where: { tenantId: tenant.id, id: main.shipments[0].id },
    });
    expect(shipment.actualPickupAt).toBeNull();
    expect((await packageRow(main, main.shipments[0].packages[1].id)).status).toBe('PREPARED');
    const event = await db.deliveryPackageEvent.findFirstOrThrow({
      where: { tenantId: tenant.id, operationKey: i.body.operationKey },
    });
    const actor = await db.user.findFirstOrThrow({
      where: { tenantId: tenant.id, id: event.actorId },
    });
    expect(actor.status).toBe('DISABLED');
    expect(actor.id).not.toBe(tenant.actorId);
    expect(JSON.stringify(event.snapshot)).not.toContain(main.token);
    const audit = await db.auditLog.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        userId: actor.id,
        entityType: 'delivery-package',
        entityId: p.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit.after)).not.toContain(main.token);
    noPrivateValues(responses[0].body, main);
    lastLoadIntent = i;
  });

  it('revokes old capabilities and binds even an existing receipt to its token fingerprint', async () => {
    const old = { ...main };
    const oldIntent = lastLoadIntent;
    await request(http)
      .delete(`${transport}/loads/${main.loadId}/driver-link`)
      .set(headers(tenant))
      .expect(200);
    await makeToken(main);
    expect(main.token).not.toBe(old.token);
    await request(http)
      .get(`${driverUrl(old)}/packages`)
      .expect(404);
    await transition(old, oldIntent).expect(404);
    const v = await view();
    const nextRef = packageFor(v, main.shipments[0].packages[0].code).ref;
    expect(nextRef).not.toBe(oldIntent.ref);
    await transition(main, oldIntent).expect(404);
    await transition(main, { ...oldIntent, ref: nextRef }).expect(409);
    expect(await eventCount(main, oldIntent.body.operationKey)).toBe(1);
  });

  it('loads the remaining units without falsely completing a shipment', async () => {
    for (const p of [main.shipments[0].packages[1], main.shipments[1].packages[0]]) {
      lastLoadIntent = await intent(main, p.code, 'LOADED');
      await transition(main, lastLoadIntent).expect(200);
    }
    expect(allPackages(await view()).every((p) => p.status === 'LOADED')).toBe(true);
    expect((await view()).shipments.every((s) => s.status === 'DISPATCHED')).toBe(true);
  });

  it('rechecks module activation before reads, fresh writes and exact receipt replays', async () => {
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId: tenant.id, moduleId } },
      data: { enabled: false },
    });
    // Deliberately leave the previously warmed module cache untouched: a
    // public capability must recheck activation against the live tenant.
    try {
      await request(http)
        .get(`${driverUrl(main)}/packages`)
        .expect(403);
      await transition(main, lastLoadIntent).expect(403);
      await exception(main, lastLoadIntent.ref, {
        operationKey: randomUUID(),
        expectedVersion: 2,
        expectedLoadUpdatedAt: lastLoadIntent.body.expectedLoadUpdatedAt,
        kind: 'DAMAGE',
        note: exceptionNote,
      }).expect(403);
    } finally {
      await db.tenantModule.update({
        where: { tenantId_moduleId: { tenantId: tenant.id, moduleId } },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(tenant.id);
    }
    await transition(main, lastLoadIntent).expect(200);
  });

  it('opens deduplicated cases, resolves them explicitly and preserves stock/status/physical evidence', async () => {
    const p = main.shipments[0].packages[0];
    const before = await packageRow(main, p.id);
    const shipmentBefore = await db.shipment.findFirstOrThrow({
      where: { tenantId: tenant.id, id: main.shipments[0].id },
    });
    const stockBefore = await db.stockMovement.count({ where: { tenantId: tenant.id } });
    for (const kind of ['DAMAGE', 'REFUSED', 'MISSING', 'OTHER']) {
      const v = await view();
      const publicPackage = packageFor(v, p.code);
      const body = {
        operationKey: randomUUID(),
        expectedVersion: publicPackage.version,
        expectedLoadUpdatedAt: v.updatedAt,
        kind,
        note: exceptionNote,
      };
      const response = await exception(main, publicPackage.ref, body).expect(200);
      expect(response.body).toEqual({
        operationKey: body.operationKey,
        ref: publicPackage.ref,
        code: p.code,
        recorded: true,
      });
      expect((await exception(main, publicPackage.ref, body).expect(200)).body).toEqual(
        response.body,
      );
      await exception(main, publicPackage.ref, { ...body, note: 'Contenu différent' }).expect(409);
      expect(await eventCount(main, body.operationKey)).toBe(1);
      await transition(main, {
        ref: publicPackage.ref,
        body: {
          operationKey: body.operationKey,
          expectedVersion: body.expectedVersion,
          expectedLoadUpdatedAt: body.expectedLoadUpdatedAt,
          target: 'LOADED',
        },
      }).expect(409);
      // D3 creates one actionable case at a time. A later report requires a
      // deliberate operator decision through the real exception workflow.
      const caseView = (
        await request(http)
          .get(`${transport}/delivery-exceptions`)
          .query({ loadId: main.loadId })
          .set(headers(tenant))
          .expect(200)
      ).body;
      const active = caseView.cases.find(
        (c: { packageId: string; status: string }) => c.packageId === p.id && c.status === 'OPEN',
      );
      expect(active).toBeDefined();
      expect(active.package.version).toBe(publicPackage.version + 1);
      await request(http)
        .post(`${transport}/delivery-exceptions/${active.id}/transition`)
        .set(headers(tenant))
        .send({
          operationKey: randomUUID(),
          expectedVersion: active.version,
          expectedPackageVersion: active.package.version,
          expectedLoadUpdatedAt: caseView.load.updatedAt,
          target: 'RESOLVED',
          note: 'Contrôle de recette terminé; problème résolu explicitement sans modifier la preuve physique.',
        })
        .expect(201);
    }
    expect(await packageRow(main, p.id)).toMatchObject({
      status: before.status,
      loadedAt: before.loadedAt,
      loadedLoadId: before.loadedLoadId,
      deliveredAt: before.deliveredAt,
      contents: before.contents,
      version: before.version + 8,
    });
    const shipmentAfter = await db.shipment.findFirstOrThrow({
      where: { tenantId: tenant.id, id: main.shipments[0].id },
    });
    expect(shipmentAfter.status).toBe(shipmentBefore.status);
    expect(shipmentAfter.actualPickupAt).toEqual(shipmentBefore.actualPickupAt);
    expect(shipmentAfter.actualDeliveryAt).toEqual(shipmentBefore.actualDeliveryAt);
    expect(await db.stockMovement.count({ where: { tenantId: tenant.id } })).toBe(stockBefore);
    noPrivateValues(await view(), main);
    noPrivateValues(await driverView(), main);
    const share = await request(http)
      .post(`${transport}/shipments/${main.shipments[0].id}/share`)
      .set(headers(tenant))
      .expect(201);
    const trackingToken = new URL(share.body.url, 'http://fixture.invalid').pathname
      .split('/')
      .pop()!;
    const tracking = await request(http)
      .get(`/api/v1/public/tracking/${trackingToken}`)
      .expect(200);
    expect(tracking.body.events.some((e: { type: string }) => e.type === 'EXCEPTION')).toBe(true);
    expect(JSON.stringify(tracking.body)).not.toContain(exceptionNote);
    // Recipient D2c exposes the code in its dedicated package list, not incident text.
    expect(JSON.stringify(tracking.body.events)).not.toContain(p.code);
  });

  it('rejects invalid exception payloads and stale optimistic versions', async () => {
    const v = await view();
    const p = allPackages(v)[0];
    const body = {
      operationKey: randomUUID(),
      expectedVersion: p.version,
      expectedLoadUpdatedAt: v.updatedAt,
      kind: 'OTHER',
      note: 'Constat explicite',
    };
    for (const invalid of [
      { note: '' },
      { note: '   ' },
      { note: 'x'.repeat(1001) },
      { kind: 'DELAY' },
      { tenantId: tenant.id },
      { expectedVersion: 0 },
      { operationKey: 'not-a-uuid' },
    ]) {
      await exception(main, p.ref, { ...body, ...invalid }).expect(400);
    }
    await exception(main, p.ref, { ...body, expectedVersion: p.version + 1 }).expect(409);
    await exception(main, p.ref, {
      ...body,
      expectedLoadUpdatedAt: '2000-01-01T00:00:00.000Z',
    }).expect(409);
    expect(await eventCount(main, body.operationKey)).toBe(0);
  });

  it('requires transit and the delivery stop before recording a delivered package', async () => {
    const p = main.shipments[0].packages[0];
    await transition(main, await intent(main, p.code, 'DELIVERED')).expect(409);
    await request(http)
      .post(`${transport}/loads/${main.loadId}/start-transit`)
      .set(headers(tenant))
      .expect(201);
    await transition(main, await intent(main, p.code, 'DELIVERED')).expect(409);
    for (const sequence of [1, 2]) {
      await stopStatus(sequence, 'ARRIVED');
      await stopStatus(sequence, 'DEPARTED');
    }
    await stopStatus(3, 'ARRIVED');
    const i = await intent(main, p.code, 'DELIVERED');
    const { recipientName: _recipient, ...missingRecipient } = i.body;
    await request(http)
      .post(`${driverUrl(main)}/packages/${i.ref}/transition`)
      .send(missingRecipient)
      .expect(400);
    await transition(main, { ...i, body: { ...i.body, recipientName: '   ' } }).expect(400);
    const receipt = (await transition(main, i).expect(200)).body;
    expect(receipt).toMatchObject({
      ref: i.ref,
      code: p.code,
      status: 'DELIVERED',
      version: i.body.expectedVersion + 1,
    });
    const current = await view();
    expect(
      current.shipments.find((s) => s.shipmentNumber === main.shipments[0].number)?.status,
    ).toBe('IN_TRANSIT');
    expect(packageFor(current, main.shipments[0].packages[1].code).status).toBe('LOADED');
    expect(packageFor(current, main.shipments[1].packages[0].code).status).toBe('LOADED');
    expect(
      (
        await db.shipment.findFirstOrThrow({
          where: { tenantId: tenant.id, id: main.shipments[0].id },
        })
      ).actualDeliveryAt,
    ).toBeNull();
  });

  it('rolls back the last package without required POD and completes only its own shipment once evidence exists', async () => {
    const p = main.shipments[0].packages[1];
    const before = await packageRow(main, p.id);
    const denied = await intent(main, p.code, 'DELIVERED');
    await transition(main, denied).expect(409);
    expect(await packageRow(main, p.id)).toEqual(before);
    expect(await eventCount(main, denied.body.operationKey)).toBe(0);
    const v = await view();
    const shipment = v.shipments.find((s) => s.shipmentNumber === main.shipments[0].number)!;
    expect(shipment.hasPod).toBe(false);
    const pod = await request(http)
      .post(`${driverUrl(main)}/pod`)
      .send({ shipmentId: shipment.ref, signedByName: 'Réception destination' })
      .expect(201);
    noPrivateValues(pod.body, main);
    const refreshed = await view();
    expect(refreshed.shipments.find((s) => s.ref === shipment.ref)?.hasPod).toBe(true);
    const legacy = await driverView();
    expect(
      legacy.shipments.find((s: { id: string }) => s.id === shipment.ref).proofOfDelivery,
    ).toEqual({ present: true });
    noPrivateValues(legacy, main);
    await transition(main, await intent(main, p.code, 'DELIVERED')).expect(200);
    const after = await view();
    expect(after.shipments.find((s) => s.ref === shipment.ref)?.status).toBe('DELIVERED');
    expect(after.shipments.find((s) => s.shipmentNumber === main.shipments[1].number)?.status).toBe(
      'IN_TRANSIT',
    );
    await stopStatus(3, 'DEPARTED');
  });

  it('refuses new commands on a completed load but preserves authorized exact historical receipts', async () => {
    await stopStatus(4, 'ARRIVED');
    const v = await view();
    const shipment = v.shipments.find((s) => s.shipmentNumber === main.shipments[1].number)!;
    await request(http)
      .post(`${driverUrl(main)}/pod`)
      .send({ shipmentId: shipment.ref, signedByName: 'Second destinataire' })
      .expect(201);
    closedDeliveryIntent = await intent(main, main.shipments[1].packages[0].code, 'DELIVERED');
    closedDeliveryReceipt = (await transition(main, closedDeliveryIntent).expect(200)).body;
    await stopStatus(4, 'DEPARTED');
    await request(http)
      .post(`${transport}/loads/${main.loadId}/complete`)
      .set(headers(tenant))
      .expect(201);
    expect((await transition(main, closedDeliveryIntent).expect(200)).body).toEqual(
      closedDeliveryReceipt,
    );
    const before = await eventCount(main);
    await transition(main, {
      ...closedDeliveryIntent,
      body: {
        ...closedDeliveryIntent.body,
        operationKey: randomUUID(),
      },
    }).expect(400);
    await exception(main, closedDeliveryIntent.ref, {
      operationKey: randomUUID(),
      expectedVersion: 3,
      expectedLoadUpdatedAt: closedDeliveryIntent.body.expectedLoadUpdatedAt,
      kind: 'OTHER',
      note: 'Nouvelle déclaration après clôture',
    }).expect(400);
    const closed = await view();
    expect(closed.status).toBe('COMPLETED');
    expect(closed.shipments).toEqual([]);
    expect(await eventCount(main)).toBe(before);
  });

  it('revokes a planned mission link when the assigned driver changes', async () => {
    expect((await view(alternate)).shipments).toEqual([]);
    const old = { ...alternate };
    const replacement = await db.driver.create({
      data: { tenantId: tenant.id, firstName: 'Nouvelle', lastName: 'Conductrice' },
    });
    await request(http)
      .post(`${transport}/loads/${alternate.loadId}/assign`)
      .set(headers(tenant))
      .send({ driverId: replacement.id })
      .expect(201);
    alternate.driverId = replacement.id;
    await request(http).get(driverUrl(old)).expect(404);
    await request(http)
      .get(`${driverUrl(old)}/packages`)
      .expect(404);
    await makeToken(alternate);
    expect(alternate.token).not.toBe(old.token);
    await request(http)
      .post(`${transport}/loads/${alternate.loadId}/dispatch`)
      .set(headers(tenant))
      .expect(201);
    expect(allPackages(await view(alternate))).toHaveLength(1);
  });

  it('revalidates assignment under the writer lock, including existing exception receipt replays', async () => {
    const p = side.shipments[0].packages[0];
    const v = await view(side);
    const publicPackage = packageFor(v, p.code);
    const priorBody = {
      operationKey: randomUUID(),
      expectedVersion: publicPackage.version,
      expectedLoadUpdatedAt: v.updatedAt,
      kind: 'MISSING',
      note: 'Contrôle quai avant chargement',
    };
    const priorReceipt = (await exception(side, publicPackage.ref, priorBody).expect(200)).body;
    const i = await intent(side, p.code, 'LOADED');
    const service = app.get(DeliveryPackagesService);
    const original = service.transition.bind(service);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest.spyOn(service, 'transition').mockImplementationOnce(async (...args) => {
      enter();
      await released;
      return original(...args);
    });
    // Execute the lazy Supertest request now; pause after public ref resolution,
    // but before the business writer reacquires the load/assignment locks.
    const pending = transition(side, i).then((response) => response);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        entered,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Writer race barrier was not reached')), 5000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      // Explicit fixture-only reassignment: preserve the shipment/leg invariant
      // atomically. No workflow status is fabricated and no user data is touched.
      await db.$transaction(async (tx) => {
        for (const id of [side.loadId, alternate.loadId].sort()) {
          await tx.$queryRaw`SELECT id FROM loads WHERE id = ${id} AND "tenantId" = ${tenant.id} FOR UPDATE`;
        }
        await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${side.shipments[0].id} AND "tenantId" = ${tenant.id} FOR UPDATE`;
        const moved = await tx.shipment.updateMany({
          where: {
            tenantId: tenant.id,
            id: side.shipments[0].id,
            loadId: side.loadId,
            status: 'DISPATCHED',
          },
          data: { loadId: alternate.loadId },
        });
        expect(moved.count).toBe(1);
        const legs = await tx.shipmentLoadLeg.updateMany({
          where: {
            tenantId: tenant.id,
            shipmentId: side.shipments[0].id,
            loadId: side.loadId,
          },
          data: { loadId: alternate.loadId },
        });
        expect(legs.count).toBe(1);
        for (const id of [side.loadId, alternate.loadId]) {
          const load = await tx.load.findFirstOrThrow({ where: { tenantId: tenant.id, id } });
          await tx.load.updateMany({
            where: { tenantId: tenant.id, id },
            data: { updatedAt: new Date(Math.max(Date.now(), load.updatedAt.getTime() + 1)) },
          });
        }
      });
      release();
      const response = await pending;
      expect([404, 409]).toContain(response.status);
      expect(await eventCount(side, i.body.operationKey)).toBe(0);
      expect(await packageRow(side, p.id)).toMatchObject({
        status: 'PREPARED',
        version: publicPackage.version + 1,
        loadedLoadId: null,
      });
      expect(allPackages(await view(side))).toHaveLength(0);
      await exception(side, publicPackage.ref, priorBody).expect(404);
      const moved = packageFor(await view(alternate), p.code);
      expect(moved.ref).not.toBe(priorReceipt.ref);
      await exception(alternate, moved.ref, priorBody).expect(409);
      expect(await eventCount(side, priorBody.operationKey)).toBe(1);
    } finally {
      if (timer) clearTimeout(timer);
      release();
      await pending;
      spy.mockRestore();
    }
  });
});
