/** Real HTTP/PostgreSQL only on the isolated disposable QA database; no external I/O. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ALL_PERMISSION_KEYS } from '@pulsar/shared';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FILE_STORAGE } from '../src/core/documents/storage/file-storage';
import { RoutingService } from '../src/core/routing/routing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('Recipient package tracking (HTTP + database)', () => {
  let app: INestApplication, http: any, db: PrismaService;
  let tenantId: string, auth: string, customerId: string, loadId: string;
  let shipmentId: string, otherShipmentId: string, foreignShipmentId: string;
  let trackingToken: string, legacyToken: string, portalToken: string;
  const moduleIds = new Map<string, string>();
  const parcels: { id: string; code: string }[] = [];
  const suffix = `RCPT${Date.now().toString(36)}${randomUUID().slice(0, 5)}`;
  const secret = `PRIVATE-CONTENTS-RECEIVER-INCIDENT-${suffix}`;
  const tms = '/api/v1/transportation';
  const blobs = new Map<string, Buffer>();
  const storage = {
    put: jest.fn(async (key: string, body: Buffer) => {
      blobs.set(key, Buffer.from(body));
    }),
    get: jest.fn(async (key: string) => {
      const body = blobs.get(key);
      if (!body) throw new Error('Missing fixture file');
      return Readable.from([body]);
    }),
    delete: jest.fn(async (key: string) => {
      blobs.delete(key);
    }),
    getDownloadUrl: jest.fn(async () => null),
    getUploadUrl: jest.fn(async () => null),
  };
  const routing = {
    geocode: jest.fn(async () => null),
    route: jest.fn(async () => null),
    table: jest.fn(async () => null),
  };
  const headers = (token = auth) => ({ Authorization: `Bearer ${token}` });
  const getPublic = (token = trackingToken) =>
    request(http).get(`/api/v1/public/tracking/${token}`);
  const getPortal = (id = shipmentId) =>
    request(http).get(`/api/v1/public/portal/${portalToken}/shipments/${id}`);
  const tokenFrom = (url: string) =>
    new URL(url, 'http://fixture.invalid').pathname.split('/').pop()!;
  const post = (path: string, body: object = {}, token = auth) =>
    request(http).post(`${tms}/${path}`).set(headers(token)).send(body).expect(201);

  async function createTenant(label: string) {
    const tenant = await db.tenant.create({
      data: { slug: `${suffix}-${label}`.toLowerCase(), name: `Recipient fixture ${label}` },
    });
    for (const moduleId of moduleIds.values())
      await db.tenantModule.create({
        data: {
          tenantId: tenant.id,
          moduleId,
          enabled: true,
          settings: {
            requireTendering: 'OPTIONAL',
            bolRequiredBeforeDispatch: false,
            podRequiredBeforeCompletion: false,
          },
        },
      });
    const user = await db.user.create({
      data: {
        tenantId: tenant.id,
        email: `${suffix}-${label}@example.test`,
        passwordHash: 'fixture-not-a-login',
        firstName: 'Camille',
        lastName: label,
      },
    });
    const jwt = new JwtService({ secret: app.get(ConfigService).getOrThrow('JWT_SECRET') });
    return {
      tenantId: tenant.id,
      auth: jwt.sign(
        { sub: user.id, tenantId: tenant.id, email: user.email, permissions: ALL_PERMISSION_KEYS },
        { expiresIn: '30m' },
      ),
    };
  }

  async function makeShipment(token: string, label: string, existingCustomerId?: string) {
    const customer =
      existingCustomerId ??
      (await post('customers', { code: `${suffix}-${label}`, name: label }, token)).body.id;
    const locations: string[] = [];
    for (const [index, city] of ['Laval', 'Québec'].entries())
      locations.push(
        (
          await post(
            'locations',
            {
              code: `${suffix}-${label}-${index}`,
              name: `Dépôt ${city}`,
              type: 'WAREHOUSE',
              addressLine1: `${index + 1} Rue Test`,
              city,
              state: 'QC',
              country: 'CA',
              latitude: 45 + index,
              longitude: -73,
            },
            token,
          )
        ).body.id,
      );
    const order = (
      await post(
        'transport-orders',
        {
          customerId: customer,
          originLocationId: locations[0],
          destinationLocationId: locations[1],
          totalWeightKg: 20,
          notes: secret,
        },
        token,
      )
    ).body;
    await post(`transport-orders/${order.id}/confirm`, {}, token);
    const shipment = (await post(`transport-orders/${order.id}/plan`, {}, token)).body.shipments[0];
    return { customerId: customer as string, id: shipment.id as string };
  }

  async function packageTransition(id: string, target: 'LOADED' | 'DELIVERED' | 'CANCELLED') {
    const parcel = await db.deliveryPackage.findFirstOrThrow({ where: { tenantId, id } });
    const load = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    return post(`delivery-packages/${id}/transition`, {
      operationKey: randomUUID(),
      expectedVersion: parcel.version,
      expectedLoadId: loadId,
      expectedLoadUpdatedAt: load.updatedAt.toISOString(),
      target,
      ...(target === 'DELIVERED' ? { recipientName: secret, notes: secret } : {}),
    });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FILE_STORAGE)
      .useValue(storage)
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
    for (const key of ['transportation', 'customer-portal'])
      moduleIds.set(key, (await db.moduleDefinition.findUniqueOrThrow({ where: { key } })).id);
    ({ tenantId, auth } = await createTenant('main'));
    const owned = await makeShipment(auth, 'owned');
    shipmentId = owned.id;
    customerId = owned.customerId;
    const legacy = await makeShipment(auth, 'legacy', customerId);
    otherShipmentId = (await makeShipment(auth, 'other-customer')).id;
    const foreign = await createTenant('foreign');
    foreignShipmentId = (await makeShipment(foreign.auth, 'foreign')).id;
    loadId = (await post('loads')).body.id;
    await post(`shipments/${shipmentId}/assign-load`, { loadId });
    for (let index = 0; index < 3; index++) {
      const shipment = await db.shipment.findFirstOrThrow({ where: { tenantId, id: shipmentId } });
      const receipt = (
        await post(`delivery-packages/shipment/${shipmentId}`, {
          operationKey: randomUUID(),
          expectedUpdatedAt: shipment.updatedAt.toISOString(),
          label: secret,
          contents: [{ reference: secret, description: secret, quantity: '2.125', unit: 'kg' }],
        })
      ).body;
      parcels.push({ id: receipt.packageId, code: receipt.code });
    }
    await packageTransition(parcels[2].id, 'CANCELLED');
    const driver = await db.driver.create({
      data: { tenantId, firstName: 'Conductrice', lastName: 'Privée' },
    });
    const vehicle = await db.vehicle.create({ data: { tenantId, unitNumber: `${suffix}-TRUCK` } });
    await post(`loads/${loadId}/assign`, { driverId: driver.id, vehicleId: vehicle.id });
    await post(`loads/${loadId}/dispatch`);
    await packageTransition(parcels[0].id, 'LOADED');
    await packageTransition(parcels[1].id, 'LOADED');
    await post(`loads/${loadId}/start-transit`);
    await packageTransition(parcels[0].id, 'DELIVERED');
    trackingToken = tokenFrom((await post(`shipments/${shipmentId}/share`)).body.url);
    legacyToken = tokenFrom((await post(`shipments/${legacy.id}/share`)).body.url);
    portalToken = tokenFrom(
      (
        await request(http)
          .post(`/api/v1/customer-portal/customers/${customerId}/portal-link`)
          .set(headers())
          .expect(201)
      ).body.url,
    );
    // Fixture evidence only: verifies older arbitrary messages and GPS events
    // cannot leak through the new projection, regardless of current writers.
    await db.trackingEvent.createMany({
      data: [
        {
          tenantId,
          shipmentId,
          loadId,
          type: 'EXCEPTION',
          message: secret,
          payload: { note: secret },
        },
        {
          tenantId,
          shipmentId,
          loadId,
          type: 'POSITION_UPDATE',
          latitude: 45.1,
          longitude: -73.1,
          occurredAt: new Date('2026-10-02T10:00:00Z'),
          message: secret,
        },
        {
          tenantId,
          shipmentId,
          loadId,
          type: 'POSITION_UPDATE',
          latitude: 46.1,
          longitude: -72.1,
          occurredAt: new Date('2026-10-02T11:00:00Z'),
          message: secret,
        },
      ],
    });
  }, 120000);

  afterAll(async () => {
    await app?.close();
  });

  it('shares physical counters without contents, receiver, incident text or internal IDs', async () => {
    const { body } = await getPublic().expect(200);
    expect(body.status).toBe('IN_TRANSIT');
    expect(body.packageTracking.counts).toEqual({
      total: 3,
      active: 2,
      prepared: 0,
      loaded: 1,
      delivered: 1,
      cancelled: 1,
    });
    expect(body.packageTracking.packages.map((p: { code: string }) => p.code)).toEqual(
      parcels.map((p) => p.code),
    );
    for (const parcel of body.packageTracking.packages) {
      expect(Object.keys(parcel).sort()).toEqual(['code', 'deliveredAt', 'loadedAt', 'status']);
    }
    expect(body.packageTracking.packages[0].deliveredAt).not.toBeNull();
    expect(body.packageTracking.packages[1].deliveredAt).toBeNull();
    const serialized = JSON.stringify(body);
    for (const value of [
      secret,
      tenantId,
      shipmentId,
      otherShipmentId,
      foreignShipmentId,
      loadId,
      ...parcels.map((p) => p.id),
    ])
      expect(serialized).not.toContain(value);
    expect(serialized).not.toMatch(
      /"contents"|"label"|"recipientName"|"notes"|"costDetail"|"driverId"/,
    );
  });

  it('publishes fixed event wording and one current position, never GPS history', async () => {
    const { body } = await getPublic().expect(200);
    expect(body.lastPosition).toEqual({
      latitude: 46.1,
      longitude: -72.1,
      occurredAt: '2026-10-02T11:00:00.000Z',
    });
    expect(body.events.some((e: { type: string }) => e.type === 'EXCEPTION')).toBe(true);
    expect(body.events.some((e: { type: string }) => e.type === 'POSITION_UPDATE')).toBe(false);
    expect(body.events.find((e: { type: string }) => e.type === 'EXCEPTION').message).toBe(
      'Un incident a été signalé.',
    );
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain('45.1');
  });

  it('uses exactly the same projection in the customer portal and rejects other customers/tenants', async () => {
    expect((await getPortal().expect(200)).body).toEqual((await getPublic().expect(200)).body);
    await getPortal(otherShipmentId).expect(404);
    await getPortal(foreignShipmentId).expect(404);
    await request(http).get(`/api/v1/portal/shipments/${shipmentId}`).expect(401);
  });

  it('does not turn historical global shipment tracking into zero delivered packages', async () => {
    expect((await getPublic(legacyToken).expect(200)).body.packageTracking).toEqual({
      enabled: false,
      counts: null,
      packages: [],
    });
  });

  it('reads live Transport and Portal activation even while their normal cache is warm', async () => {
    await app.get(TenantModulesCacheService).getEnabledKeys(tenantId);
    for (const key of ['transportation', 'customer-portal']) {
      const moduleId = moduleIds.get(key)!;
      await db.tenantModule.update({
        where: { tenantId_moduleId: { tenantId, moduleId } },
        data: { enabled: false },
      });
      try {
        await getPortal().expect(403);
        await getPublic().expect(key === 'transportation' ? 403 : 200);
      } finally {
        await db.tenantModule.update({
          where: { tenantId_moduleId: { tenantId, moduleId } },
          data: { enabled: true },
        });
        app.get(TenantModulesCacheService).invalidate(tenantId);
        await app.get(TenantModulesCacheService).getEnabledKeys(tenantId);
      }
    }
  });

  it('invalidates a revoked shipment capability without exposing a different tracking record', async () => {
    await request(http).delete(`${tms}/shipments/${shipmentId}/share`).set(headers()).expect(200);
    await getPublic().expect(404);
    await request(http).get('/api/v1/public/tracking/not-a-capability').expect(404);
    await getPortal().expect(200);
  });
});
