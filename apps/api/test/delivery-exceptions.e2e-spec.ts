/** Incident/return workflows on isolated disposable QA tenants; no provider, warehouse or finance writes. */
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

type Mission = {
  tenantId: string;
  actorId: string;
  auth: string;
  loadId: string;
  shipmentId: string;
  orderId: string;
  siteId: string;
  packageIds: string[];
  driverToken: string;
};
describe('Delivery exceptions (HTTP + disposable PostgreSQL)', () => {
  let app: INestApplication, http: any, db: PrismaService, jwt: JwtService, moduleId: string;
  let main: Mission, foreign: Mission, retryCase: string, returnCase: string;
  let driverIntent: any, driverReceipt: unknown, returnIntent: any, returnReceipt: unknown;
  const suffix = `EX-${Date.now().toString(36)}-${randomUUID().slice(0, 5)}`;
  const base = '/api/v1/transportation',
    exceptions = `${base}/delivery-exceptions`,
    packages = `${base}/delivery-packages`;
  const privateNote = `PRIVATE-INCIDENT-${suffix}`;
  const auth = (m = main, token = m.auth) => ({ Authorization: `Bearer ${token}` });
  const sign = (
    m: Pick<Mission, 'tenantId' | 'actorId'>,
    permissions = ALL_PERMISSION_KEYS,
    actor = m.actorId,
  ) =>
    jwt.sign(
      { sub: actor, tenantId: m.tenantId, permissions, email: `${suffix}@example.invalid` },
      { expiresIn: '30m' },
    );
  const post = (m: Mission, path: string, body: object = {}) =>
    request(http).post(`${base}/${path}`).set(auth(m)).send(body).expect(201);
  const manifest = async (m = main) =>
    (await request(http).get(packages).query({ loadId: m.loadId }).set(auth(m)).expect(200)).body;
  const cases = async (m = main) =>
    (await request(http).get(exceptions).query({ loadId: m.loadId }).set(auth(m)).expect(200)).body;
  const driver = async (m = main) =>
    (await request(http).get(`/api/v1/public/driver/${m.driverToken}/packages`).expect(200)).body;
  const packageDto = async (packageId: string, target: string, m = main) => {
    const v = await manifest(m),
      p = v.shipments.flatMap((s: any) => s.packages).find((p: any) => p.id === packageId);
    return {
      operationKey: randomUUID(),
      expectedVersion: p.version,
      expectedLoadId: m.loadId,
      expectedLoadUpdatedAt: v.load.updatedAt,
      target,
      ...(target === 'DELIVERED' ? { recipientName: 'Réception test' } : {}),
    };
  };
  const createDto = async (packageId: string, m = main) => {
    const v = await manifest(m),
      p = v.shipments.flatMap((s: any) => s.packages).find((p: any) => p.id === packageId);
    return {
      operationKey: randomUUID(),
      packageId,
      expectedPackageVersion: p.version,
      expectedLoadUpdatedAt: v.load.updatedAt,
      kind: 'REFUSED',
      note: privateNote,
    };
  };
  const transitionDto = async (id: string, target: string, extra: object = {}, m = main) => {
    const v = await cases(m),
      c = v.cases.find((c: any) => c.id === id);
    return {
      operationKey: randomUUID(),
      expectedVersion: c.version,
      expectedPackageVersion: c.package.version,
      expectedLoadUpdatedAt: v.load.updatedAt,
      target,
      note: 'Décision motivée de recette',
      ...extra,
    };
  };
  const transition = (id: string, body: object, m = main) =>
    request(http).post(`${exceptions}/${id}/transition`).set(auth(m)).send(body);
  const newMission = async (label: string): Promise<Mission> => {
    const tenantId = (
      await db.tenant.create({
        data: { slug: `${suffix}-${label}`.toLowerCase(), name: `Incidents recette ${label}` },
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
    const actorId = (
      await db.user.create({
        data: {
          tenantId,
          email: `${suffix}-${label}@example.invalid`,
          passwordHash: 'fixture-not-loginable',
          firstName: 'Camille',
          lastName: label,
        },
      })
    ).id;
    const m = {
      tenantId,
      actorId,
      auth: sign({ tenantId, actorId }),
      loadId: '',
      shipmentId: '',
      orderId: '',
      siteId: '',
      packageIds: [],
      driverToken: '',
    } as Mission;
    const customerId = (await post(m, 'customers', { code: 'C', name: 'Client recette' })).body.id;
    const sites: string[] = [];
    for (const code of ['A', 'B'])
      sites.push(
        (
          await post(m, 'locations', {
            code,
            name: `Site ${code}`,
            type: 'WAREHOUSE',
            addressLine1: '1 Test',
            city: 'Laval',
          })
        ).body.id,
      );
    m.siteId = sites[0];
    const order = (
      await post(m, 'transport-orders', {
        customerId,
        originLocationId: sites[0],
        destinationLocationId: sites[1],
        totalWeightKg: 100,
        palletCount: 1,
      })
    ).body;
    m.orderId = order.id;
    await post(m, `transport-orders/${order.id}/confirm`);
    m.shipmentId = (await post(m, `transport-orders/${order.id}/plan`)).body.shipments[0].id;
    m.loadId = (await post(m, 'loads')).body.id;
    await post(m, `shipments/${m.shipmentId}/assign-load`, { loadId: m.loadId });
    for (let n = 0; n < 2; n++) {
      const shipment = await db.shipment.findFirstOrThrow({
        where: { tenantId, id: m.shipmentId },
      });
      const receipt = await request(http)
        .post(`${packages}/shipment/${m.shipmentId}`)
        .set(auth(m))
        .send({
          operationKey: randomUUID(),
          expectedUpdatedAt: shipment.updatedAt.toISOString(),
          label: `Carton ${n + 1}`,
          contents: [
            { reference: `COMP-${n}`, description: 'Pièce de recette', quantity: '1', unit: 'un' },
          ],
        })
        .expect(201);
      m.packageIds.push(receipt.body.packageId);
    }
    const driverId = (await post(m, 'drivers', { firstName: 'Camille', lastName: label })).body.id;
    const vehicleId = (
      await post(m, 'vehicles', { unitNumber: `TR-${label}`, type: 'STRAIGHT_TRUCK' })
    ).body.id;
    await post(m, `loads/${m.loadId}/assign`, { driverId, vehicleId });
    for (const id of m.packageIds)
      await request(http)
        .post(`${packages}/${id}/transition`)
        .set(auth(m))
        .send(await packageDto(id, 'LOADED', m))
        .expect(201);
    await post(m, `loads/${m.loadId}/dispatch`);
    await post(m, `loads/${m.loadId}/start-transit`);
    const link = (await post(m, `loads/${m.loadId}/driver-link`)).body;
    m.driverToken = new URL(link.url, 'http://fixture.invalid').pathname.split('/').pop()!;
    return m;
  };
  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('/pulsar_parcel_qa'))
      throw Error('This suite requires the dedicated disposable pulsar_parcel_qa database.');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RoutingService)
      .useValue({
        geocode: jest.fn(async () => null),
        route: jest.fn(async () => null),
        table: jest.fn(async () => null),
      })
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
    jwt = new JwtService({ secret: app.get(ConfigService).getOrThrow('JWT_SECRET') });
    moduleId = (await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'transportation' } }))
      .id;
    main = await newMission('main');
    foreign = await newMission('foreign');
  }, 120000);
  afterAll(async () => {
    await app?.close();
  });

  it('gates read/write by auth, permissions, module and tenant ownership', async () => {
    await request(http).get(exceptions).query({ loadId: main.loadId }).expect(401);
    await request(http)
      .get(exceptions)
      .query({ loadId: main.loadId })
      .set(auth(main, sign(main, [])))
      .expect(403);
    await request(http)
      .post(exceptions)
      .set(auth(main, sign(main, ['transportation.planning.read'])))
      .send(await createDto(main.packageIds[0]))
      .expect(403);
    await request(http).get(exceptions).query({ loadId: foreign.loadId }).set(auth()).expect(404);
    await request(http)
      .post(exceptions)
      .set(auth())
      .send({ ...(await createDto(main.packageIds[0])), packageId: foreign.packageIds[0] })
      .expect(404);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId: main.tenantId, moduleId } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(main.tenantId);
    await request(http).get(exceptions).query({ loadId: main.loadId }).set(auth()).expect(403);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId: main.tenantId, moduleId } },
      data: { enabled: true },
    });
    app.get(TenantModulesCacheService).invalidate(main.tenantId);
  });
  it('opens one actionable case from driver with exact replay, without package status or stock mutation', async () => {
    const v = await driver(),
      p = v.shipments[0].packages[0];
    driverIntent = {
      operationKey: randomUUID(),
      expectedVersion: p.version,
      expectedLoadUpdatedAt: v.updatedAt,
      kind: 'REFUSED',
      note: privateNote,
    };
    const call = () =>
      request(http)
        .post(`/api/v1/public/driver/${main.driverToken}/packages/${p.ref}/exception`)
        .send(driverIntent);
    const results = await Promise.all([call(), call()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0].body).toEqual(results[1].body);
    driverReceipt = results[0].body;
    const c = await cases();
    expect(c.cases).toHaveLength(1);
    retryCase = c.cases[0].id;
    expect(c.cases[0].status).toBe('OPEN');
    expect(c.cases[0].package.status).toBe('LOADED');
    expect(c.cases[0].package.version).toBe(p.version + 1);
    expect(
      await db.deliveryExceptionEvent.count({
        where: { tenantId: main.tenantId, exceptionId: retryCase },
      }),
    ).toBe(1);
    expect(await db.stockMovement.count({ where: { tenantId: main.tenantId } })).toBe(0);
    expect(await db.inventoryLevel.count({ where: { tenantId: main.tenantId } })).toBe(0);
    const publicView = await driver();
    expect(publicView.shipments[0].packages[0].incident).toMatchObject({ status: 'OPEN' });
    expect(JSON.stringify(publicView)).not.toContain(privateNote);
    expect(JSON.stringify(publicView)).not.toContain(retryCase);
    const tracking = await db.trackingEvent.findMany({
      where: { tenantId: main.tenantId, loadId: main.loadId },
    });
    expect(tracking.every((row) => !row.message?.includes(privateNote))).toBe(true);
  });
  it('blocks active duplicate cases, generic returns, delivery and completion until a decision', async () => {
    await request(http)
      .post(exceptions)
      .set(auth())
      .send(await createDto(main.packageIds[0]))
      .expect(409);
    await request(http)
      .post(`${packages}/${main.packageIds[0]}/transition`)
      .set(auth())
      .send(await packageDto(main.packageIds[0], 'RETURNED'))
      .expect(400);
    const v = await driver(),
      p = v.shipments[0].packages[0];
    await request(http)
      .post(`/api/v1/public/driver/${main.driverToken}/packages/${p.ref}/transition`)
      .send({
        operationKey: randomUUID(),
        expectedVersion: p.version,
        expectedLoadUpdatedAt: v.updatedAt,
        target: 'RETURNED',
      })
      .expect(400);
    await request(http)
      .post(`${packages}/${main.packageIds[0]}/transition`)
      .set(auth())
      .send(await packageDto(main.packageIds[0], 'DELIVERED'))
      .expect(409);
    await request(http).post(`${base}/loads/${main.loadId}/complete`).set(auth()).expect(400);
  });
  it('serializes competing decisions and closes retry only after successful package delivery', async () => {
    const dto = await transitionDto(retryCase, 'RETRY_PLANNED', {
      retryAt: '2099-01-01T00:00:00Z',
    });
    const attempts = await Promise.all([
      transition(retryCase, dto),
      transition(retryCase, { ...dto, operationKey: randomUUID() }),
    ]);
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
    const stale = {
      ...dto,
      operationKey: randomUUID(),
      target: 'RETURN_AUTHORIZED',
      returnLocationId: main.siteId,
    };
    await transition(retryCase, stale).expect(409);
    const before = (await cases()).cases.find((c: any) => c.id === retryCase);
    expect(before.status).toBe('RETRY_PLANNED');
    const delivery = await packageDto(main.packageIds[0], 'DELIVERED');
    const result = await request(http)
      .post(`${packages}/${main.packageIds[0]}/transition`)
      .set(auth())
      .send(delivery)
      .expect(201);
    expect(result.body.status).toBe('DELIVERED');
    const after = (await cases()).cases.find((c: any) => c.id === retryCase);
    expect(after.status).toBe('RESOLVED');
    await request(http)
      .post(`${packages}/${main.packageIds[0]}/transition`)
      .set(auth())
      .send(delivery)
      .expect(201);
    expect(
      await db.deliveryExceptionEvent.count({
        where: { tenantId: main.tenantId, exceptionId: retryCase },
      }),
    ).toBe(3);
    expect(
      (
        await db.shipment.findFirstOrThrow({
          where: { tenantId: main.tenantId, id: main.shipmentId },
        })
      ).status,
    ).toBe('IN_TRANSIT');
  });
  it('creates one internal return case and binds operation to actor/body', async () => {
    const dto = await createDto(main.packageIds[1]);
    const results = await Promise.all(
      [1, 2].map(() => request(http).post(exceptions).set(auth()).send(dto)),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    returnCase = results[0].body.id;
    await request(http)
      .post(exceptions)
      .set(auth())
      .send({ ...dto, note: 'Autre demande' })
      .expect(409);
    const otherActor = await db.user.create({
      data: {
        tenantId: main.tenantId,
        email: `${suffix}-other@example.invalid`,
        passwordHash: 'fixture',
        firstName: 'Autre',
        lastName: 'Acteur',
      },
    });
    await request(http)
      .post(exceptions)
      .set(auth(main, sign(main, ALL_PERMISSION_KEYS, otherActor.id)))
      .send(dto)
      .expect(409);
    await transition(
      returnCase,
      await transitionDto(returnCase, 'RETURN_AUTHORIZED', { returnLocationId: foreign.siteId }),
    ).expect(400);
    await transition(
      returnCase,
      await transitionDto(returnCase, 'RETURN_RECEIVED', { receivedBy: 'Réception test' }),
    ).expect(409);
    await transition(
      returnCase,
      await transitionDto(returnCase, 'RETURN_AUTHORIZED', { returnLocationId: main.siteId }),
    ).expect(201);
    await request(http).post(`${base}/loads/${main.loadId}/complete`).set(auth()).expect(400);
  });
  it('requires human physical reception evidence, deduplicates it, and never posts WMS stock', async () => {
    await transition(returnCase, await transitionDto(returnCase, 'RETURN_RECEIVED')).expect(400);
    returnIntent = await transitionDto(returnCase, 'RETURN_RECEIVED', {
      receivedBy: 'Camille Réception',
    });
    const disabled = await db.user.findFirstOrThrow({
      where: { tenantId: main.tenantId, email: 'service-account@pulsar.local' },
    });
    const denied = await request(http)
      .post(`${exceptions}/${returnCase}/transition`)
      .set(auth(main, sign(main, ALL_PERMISSION_KEYS, disabled.id)))
      .send(returnIntent);
    expect([401, 403]).toContain(denied.status);
    const results = await Promise.all([
      transition(returnCase, returnIntent),
      transition(returnCase, returnIntent),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    returnReceipt = results[0].body;
    const p = await db.deliveryPackage.findFirstOrThrow({
      where: { tenantId: main.tenantId, id: main.packageIds[1] },
    });
    expect(p.status).toBe('RETURNED');
    expect(p.deliveredAt).toBeNull();
    const c = (await cases()).cases.find((c: any) => c.id === returnCase);
    expect(c).toMatchObject({
      status: 'RETURN_RECEIVED',
      receivedBy: 'Camille Réception',
      returnLocationId: main.siteId,
    });
    expect(c.receivedAt).toBeTruthy();
    expect(
      await db.deliveryPackageEvent.count({
        where: { tenantId: main.tenantId, packageId: p.id, kind: 'RETURNED' },
      }),
    ).toBe(1);
    const event = await db.deliveryPackageEvent.findFirstOrThrow({
      where: { tenantId: main.tenantId, packageId: p.id, kind: 'RETURNED' },
    });
    expect(event.snapshot).toMatchObject({
      evidence: {
        exceptionId: returnCase,
        locationId: main.siteId,
        noStockMovement: true,
        receivedBy: 'Camille Réception',
      },
    });
    expect(await db.stockMovement.count({ where: { tenantId: main.tenantId } })).toBe(0);
    expect(await db.inventoryLevel.count({ where: { tenantId: main.tenantId } })).toBe(0);
  });
  it('closes the physical tour with returned evidence without inventing commercial delivery', async () => {
    const before = await db.load.findFirstOrThrow({
      where: { tenantId: main.tenantId, id: main.loadId },
    });
    const result = await post(main, `loads/${main.loadId}/complete`);
    expect(result.body.status).toBe('COMPLETED');
    const shipment = await db.shipment.findFirstOrThrow({
      where: { tenantId: main.tenantId, id: main.shipmentId },
    });
    expect(shipment.status).toBe('IN_TRANSIT');
    expect(shipment.actualDeliveryAt).toBeNull();
    const order = await db.transportOrder.findFirstOrThrow({
      where: { tenantId: main.tenantId, id: main.orderId },
    });
    expect(order.status).not.toBe('COMPLETED');
    const load = await db.load.findFirstOrThrow({
      where: { tenantId: main.tenantId, id: main.loadId },
    });
    expect(load.costDetail).toEqual(before.costDetail);
    expect(load.estimatedCost).toEqual(before.estimatedCost);
    const tracking = await db.trackingEvent.findMany({
      where: { tenantId: main.tenantId, loadId: main.loadId },
    });
    expect(
      tracking.filter((row) => row.type === 'DELIVERED' && row.shipmentId === null),
    ).toHaveLength(0);
    expect((await transition(returnCase, returnIntent).expect(201)).body).toEqual(returnReceipt);
    await request(http)
      .post(exceptions)
      .set(auth())
      .send(await createDto(main.packageIds[1]))
      .expect(409);
  });
  it('revalidates driver capability and module on receipt replay after completion', async () => {
    const pkg = await db.deliveryPackage.findFirstOrThrow({
      where: { tenantId: main.tenantId, id: main.packageIds[0] },
    });
    const { driverReference } =
      await import('../src/modules/transportation/public/driver-reference');
    const ref = driverReference(main.driverToken, 'package', pkg.id);
    const replay = () =>
      request(http)
        .post(`/api/v1/public/driver/${main.driverToken}/packages/${ref}/exception`)
        .send(driverIntent);
    expect((await replay().expect(200)).body).toEqual(driverReceipt);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId: main.tenantId, moduleId } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(main.tenantId);
    await replay().expect(403);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId: main.tenantId, moduleId } },
      data: { enabled: true },
    });
    app.get(TenantModulesCacheService).invalidate(main.tenantId);
    // Explicit isolated fixture simulates a rotated/revoked capability, never a production write.
    await db.load.update({
      where: { tenantId_id: { tenantId: main.tenantId, id: main.loadId } },
      data: { driverToken: randomUUID() },
    });
    await replay().expect(404);
    expect(await db.deliveryException.count({ where: { tenantId: foreign.tenantId } })).toBe(0);
  });
});
