process.env.APS_AUTOSTART = 'false';
import { randomUUID } from 'node:crypto';
import { INestApplication, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApsClient } from '../src/core/aps/aps.client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { InventoryService } from '../src/modules/wms/inventory/inventory.service';
import { ReceivingService } from '../src/modules/wms/receiving/receiving.service';
import { StockMovementType, type MrpSnapshot } from '@pulsar/shared';

describe('MRP planning (HTTP + PostgreSQL, no stock side effects)', () => {
  let app: INestApplication, db: PrismaService, http: any;
  let tenantId: string, userId: string, token: string, other: string, reader: string, noWms: string;
  let siteId: string,
    otherSiteId: string,
    itemId: string,
    componentId: string,
    binId: string,
    bomId: string,
    runId: string;
  let demand: any;
  let revisionId: string;
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const real =
    process.env.PULSAR_TEST_REAL_APS === 'true'
      ? new ApsClient(new ConfigService(process.env))
      : null;
  const engine = {
    health: jest.fn(async () => ({ status: 'ok' })),
    calculateMrp: jest.fn(async (tenant: string, snapshot: MrpSnapshot) =>
      real
        ? real.calculateMrp(tenant, snapshot)
        : {
            tenant_id: tenant,
            version: 'pulsar.mrp.v1',
            engine_revision: 'planiadvance-d26a8cd.pulsar-mrp1',
            as_of: snapshot.as_of,
            horizon_end: snapshot.horizon_end,
            proposals: [],
            exceptions: [],
            assumptions: [],
            items: snapshot.items.map((i) => ({
              item_id: i.id,
              sku: i.sku,
              name: i.name,
              unit: i.unit,
              method: i.method,
              level: 0,
              on_hand: i.on_hand,
              gross_requirement: '0',
              planned_receipts: '0',
              projected_end: i.on_hand,
              timeline: [],
            })),
          },
    ),
  };
  const call = (method: 'get' | 'post' | 'put', path: string, body?: unknown, auth = token) => {
    const req = request(http)
      [method](`/api/v1/manufacturing/mrp/${path}`)
      .set('Authorization', `Bearer ${auth}`);
    return body ? req.send(body) : req;
  };
  const policy = (item = itemId) => ({
    locationId: siteId,
    itemId: item,
    method: 'BUY',
    leadDays: 2,
    safetyStock: '0',
    minimumOrder: '0',
    orderMultiple: '1',
    acknowledgeUnits: true,
  });
  const entry = (kind = 'DEMAND') => ({
    locationId: siteId,
    itemId,
    kind,
    quantity: '10',
    dueDate: future,
    reference: 'Customer order',
    isActive: true,
  });
  const calculate = () => call('post', 'runs', { locationId: siteId, horizonEnd: future });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ApsClient)
      .useValue(engine)
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    http = app.getHttpServer();
    db = app.get(PrismaService);
    for (const name of ['main', 'other']) {
      const slug = `mrp-${name}-${randomUUID()}`;
      const tenant = await db.tenant.create({ data: { slug, name: slug } });
      const modules = await db.moduleDefinition.findMany({
        where: { key: { in: ['manufacturing', 'wms'] } },
      });
      for (const module of modules)
        await db.tenantModule.create({
          data: { tenantId: tenant.id, moduleId: module.id, enabled: true },
        });
      for (const mode of name === 'main' ? ['manager', 'reader', 'no-wms'] : ['manager']) {
        const keys = [
          'manufacturing.read',
          ...(mode === 'reader' ? [] : ['manufacturing.manage']),
          ...(mode === 'no-wms' ? [] : ['wms.read']),
          ...(mode === 'manager' ? ['wms.manage'] : []),
        ];
        const perms = await db.permission.findMany({ where: { key: { in: keys } } });
        expect(perms).toHaveLength(keys.length);
        const role = await db.role.create({
          data: {
            tenantId: tenant.id,
            key: mode,
            name: mode,
            permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
          },
        });
        const email = `${mode}@${slug}.test`;
        const user = await db.user.create({
          data: {
            tenantId: tenant.id,
            email,
            firstName: 'MRP',
            lastName: mode,
            status: 'ACTIVE',
            passwordHash: hashSync('Test1234!', 4),
            roles: { create: { roleId: role.id } },
          },
        });
        const auth = await request(http)
          .post('/api/v1/auth/login')
          .send({ tenant: slug, email, password: 'Test1234!' })
          .expect(200);
        if (name === 'other') other = auth.body.accessToken;
        else if (mode === 'reader') reader = auth.body.accessToken;
        else if (mode === 'no-wms') noWms = auth.body.accessToken;
        else {
          token = auth.body.accessToken;
          tenantId = tenant.id;
          userId = user.id;
        }
      }
    }
    const site = (code: string) =>
      db.location.create({
        data: {
          tenantId,
          code,
          name: code,
          type: 'WAREHOUSE',
          addressLine1: '1 Test',
          city: 'Test',
        },
      });
    siteId = (await site('SITE-A')).id;
    otherSiteId = (await site('SITE-B')).id;
    itemId = (
      await db.wmsItem.create({ data: { tenantId, sku: 'FG', name: 'Finished good', unit: 'EA' } })
    ).id;
    componentId = (
      await db.wmsItem.create({ data: { tenantId, sku: 'RAW', name: 'Material', unit: 'KG' } })
    ).id;
    binId = (await db.bin.create({ data: { tenantId, locationId: siteId, code: 'A' } })).id;
    const otherBin = await db.bin.create({
      data: { tenantId, locationId: otherSiteId, code: 'B' },
    });
    for (const [bin, qty] of [
      [binId, 2],
      [otherBin.id, 100],
    ] as const) {
      await db.$transaction((tx) =>
        app.get(InventoryService).postMovement(tx, {
          tenantId,
          userId,
          itemId,
          toBinId: bin,
          qty,
          type: StockMovementType.RECEIPT,
        }),
      );
    }
    bomId = (
      await db.bom.create({
        data: {
          tenantId,
          code: 'BOM-FG',
          name: 'FG',
          productRef: 'FG',
          lines: { create: { tenantId, materialRef: 'RAW', quantityPerUnit: 0.5 } },
        },
      })
    ).id;
    const bom = await db.bom.findFirstOrThrow({ where: { tenantId, id: bomId } });
    revisionId = (
      await request(http)
        .post(`/api/v1/manufacturing/boms/${bomId}/revisions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ expectedUpdatedAt: bom.updatedAt.toISOString(), acknowledgeUnits: true })
        .expect(201)
    ).body.id;
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it('gates both module permissions and tenant ownership', async () => {
    await call('get', 'options', undefined, noWms).expect(403);
    await call('put', 'policies', policy(), reader).expect(403);
    await call('put', 'policies', policy(), other).expect(400);
    await call('get', `workspace?locationId=${siteId}`, undefined, other).expect(400);
    await call('post', 'entries', { ...entry(), tenantId }).expect(400);
  });
  it('validates units, quantities and method/BOM pairing', async () => {
    await call('put', 'policies', { ...policy(), acknowledgeUnits: false }).expect(400);
    await call('put', 'policies', { ...policy(), method: 'MAKE' }).expect(400);
    await call('put', 'policies', { ...policy(), bomId }).expect(400);
    await call('put', 'policies', { ...policy(), orderMultiple: '0' }).expect(400);
    await call('post', 'entries', { ...entry(), quantity: '0.0001' }).expect(400);
    await call('post', 'entries', { ...entry(), dueDate: '2026-02-30' }).expect(400);
  });
  it('creates a policy and prevents lost updates with a version', async () => {
    const p = (await call('put', 'policies', policy()).expect(200)).body;
    await call('put', 'policies', policy()).expect(409);
    const results = await Promise.all(
      [1, 2].map((leadDays) =>
        call('put', 'policies', { ...policy(), leadDays, expectedUpdatedAt: p.updatedAt }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    await call('put', 'policies', policy(componentId)).expect(200);
  });
  it('creates a demand; reads current stock at only the chosen site', async () => {
    demand = (await call('post', 'entries', entry()).expect(201)).body;
    const run = (await calculate().expect(201)).body;
    runId = run.id;
    expect(run.stale).toBe(false);
    expect(run.inputSnapshot.items.find((i: any) => i.id === itemId).on_hand).toBe('2');
    expect(run.inputSnapshot.demands[0].quantity).toBe('10');
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(2);
    if (real) expect(run.result.proposals[0].quantity).toBe('8');
  });
  it('persists immutable tenant-scoped runs and exposes stale calculations', async () => {
    await call('get', `runs/${runId}`, undefined, other).expect(404);
    await call('get', `runs/${runId}`, undefined, reader).expect(200);
    await call('put', `entries/${demand.id}`, { ...entry(), quantity: '11' }).expect(409);
    await call('put', `entries/${demand.id}`, {
      ...entry(),
      quantity: '11',
      expectedUpdatedAt: demand.updatedAt,
    }).expect(200);
    const historical = (await call('get', `runs/${runId}`).expect(200)).body;
    expect(historical.stale).toBe(true);
    expect(historical.inputSnapshot.demands[0].quantity).toBe('10');
  });
  it('rejects a MAKE BOM with an unconfigured component and handles multi-level mapping', async () => {
    const p = (await call('get', `workspace?locationId=${siteId}`).expect(200)).body.policies.find(
      (p: any) => p.itemId === itemId,
    );
    await call('put', 'policies', {
      ...policy(),
      method: 'MAKE',
      bomId,
      bomRevisionId: revisionId,
      expectedUpdatedAt: p.updatedAt,
    }).expect(200);
    await db.bomLine.updateMany({ where: { tenantId, bomId }, data: { materialRef: 'MISSING' } });
    // A working-draft edit must not alter a pinned published revision.
    await calculate().expect(201);
    await db.mrpItemPolicy.deleteMany({
      where: { tenantId, locationId: siteId, itemId: componentId },
    });
    await calculate().expect(400);
    await call('put', 'policies', policy(componentId)).expect(200);
    await db.bomLine.updateMany({ where: { tenantId, bomId }, data: { materialRef: 'RAW' } });
    const run = (await calculate().expect(201)).body;
    expect(run.inputSnapshot.items.find((i: any) => i.id === itemId).components).toEqual([
      { item_id: componentId, quantity: '0.5' },
    ]);
    if (real)
      expect(run.result.proposals.find((p: any) => p.item_id === componentId).quantity).toBe('5');
  });
  it('does not double count a posted linked WMS receipt', async () => {
    const receiving = app.get(ReceivingService);
    const receipt = await receiving.create(tenantId, userId, { locationId: siteId });
    await receiving.addLine(tenantId, receipt.id, { itemId, toBinId: binId, qty: 3 });
    await call('post', 'entries', {
      ...entry('SUPPLY'),
      quantity: '3',
      receiptId: receipt.id,
      dueDate: today,
    }).expect(201);
    await call('post', 'entries', { ...entry('SUPPLY'), receiptId: receipt.id }).expect(409);
    const before = (await calculate().expect(201)).body;
    expect(before.inputSnapshot.supplies[0].quantity).toBe('3');
    await receiving.post(tenantId, userId, receipt.id);
    const after = (await calculate().expect(201)).body;
    expect(after.inputSnapshot.supplies).toHaveLength(0);
    expect(after.inputSnapshot.items.find((i: any) => i.id === itemId).on_hand).toBe('5');
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(3);
  });
  it('detects changed item units instead of silently converting', async () => {
    await db.wmsItem.updateMany({ where: { id: componentId, tenantId }, data: { unit: 'LB' } });
    await calculate().expect(400);
    await db.wmsItem.updateMany({ where: { id: componentId, tenantId }, data: { unit: 'KG' } });
  });
  it('does not persist an engine failure or wrong-tenant result', async () => {
    const count = await db.mrpRun.count({ where: { tenantId } });
    engine.calculateMrp.mockRejectedValueOnce(new ServiceUnavailableException('Sidecar offline'));
    await calculate().expect(503);
    engine.calculateMrp.mockResolvedValueOnce({
      tenant_id: 'other',
      version: 'pulsar.mrp.v1',
    } as any);
    await calculate().expect(503);
    expect(await db.mrpRun.count({ where: { tenantId } })).toBe(count);
  });
  it('publishes immutable decimal revisions, idempotently, with scoped reads and versioned drafts', async () => {
    const path = `/api/v1/manufacturing/boms/${bomId}`;
    const auth = { Authorization: `Bearer ${token}` };
    const bom = (await request(http).get(path).set(auth).expect(200)).body;
    const payload = { expectedUpdatedAt: bom.updatedAt, acknowledgeUnits: true };
    const repeated = await Promise.all(
      [1, 2].map(() => request(http).post(`${path}/revisions`).set(auth).send(payload).expect(201)),
    );
    expect(repeated[0].body.id).toBe(revisionId);
    expect(repeated[1].body.id).toBe(revisionId);
    await request(http)
      .post(`${path}/revisions`)
      .set('Authorization', `Bearer ${noWms}`)
      .send(payload)
      .expect(403);
    await request(http)
      .get(`${path}/revisions/${revisionId}`)
      .set('Authorization', `Bearer ${other}`)
      .expect(404);
    await request(http)
      .patch(`${path}/lines/${bom.lines[0].id}`)
      .set(auth)
      .send({ quantityPerUnit: '0.123456789', expectedUpdatedAt: bom.updatedAt })
      .expect(200);
    await request(http)
      .patch(path)
      .set(auth)
      .send({ name: 'Lost update', expectedUpdatedAt: bom.updatedAt })
      .expect(409);
    const fresh = (await request(http).get(path).set(auth)).body;
    const published = (
      await request(http)
        .post(`${path}/revisions`)
        .set(auth)
        .send({ ...payload, expectedUpdatedAt: fresh.updatedAt })
        .expect(201)
    ).body;
    expect(published.revision).toBe(2);
    expect(published.lines[0].quantityPerUnit).toBe('0.123456789');
    const original = (
      await request(http).get(`${path}/revisions/${revisionId}`).set(auth).expect(200)
    ).body;
    expect(original.lines[0].quantityPerUnit).toBe('0.5');
    const run = (await calculate().expect(201)).body;
    expect(run.inputSnapshot.items.find((i: any) => i.id === itemId).components[0].quantity).toBe(
      '0.5',
    );
    expect(run.sourceMetadata.bomRevisions[0].revisionId).toBe(revisionId);
    await request(http)
      .delete(`${path}?expectedUpdatedAt=${encodeURIComponent(fresh.updatedAt)}`)
      .set(auth)
      .expect(409);
  });
  it('freezes used WMS SKU and unit without forbidding ordinary descriptive edits', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    await request(http)
      .patch(`/api/v1/wms/items/${componentId}`)
      .set(auth)
      .send({ unit: 'LB' })
      .expect(409);
    await request(http)
      .patch(`/api/v1/wms/items/${componentId}`)
      .set(auth)
      .send({ sku: 'NEW-RAW' })
      .expect(409);
    await request(http)
      .patch(`/api/v1/wms/items/${componentId}`)
      .set(auth)
      .send({ name: 'Renamed material' })
      .expect(200);
  });
  it('binds a draft OF to a site and revision, captures exact requirements at release, and prevents drift', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const root = '/api/v1/manufacturing/orders';
    const order = (
      await request(http)
        .post(root)
        .set(auth)
        .send({
          name: 'Versioned OF',
          productRef: 'FG',
          quantity: 3,
          dueDate: future,
          releaseDate: today,
          bomId,
        })
        .expect(201)
    ).body;
    const path = `${root}/${order.id}`;
    await request(http).post(`${path}/release`).set(auth).expect(400);
    const body = {
      locationId: siteId,
      bomRevisionId: revisionId,
      expectedUpdatedAt: order.updatedAt,
    };
    await request(http)
      .post(`${path}/material-context`)
      .set('Authorization', `Bearer ${noWms}`)
      .send(body)
      .expect(403);
    await request(http)
      .post(`${path}/material-context`)
      .set(auth)
      .send({ ...body, locationId: 'missing' })
      .expect(400);
    await request(http).post(`${path}/material-context`).set(auth).send(body).expect(201);
    await request(http).post(`${path}/material-context`).set(auth).send(body).expect(409);
    const released = (await request(http).post(`${path}/release`).set(auth).expect(201)).body;
    expect(released.materialSnapshot.product.quantity).toBe('3');
    expect(released.materialSnapshot.components[0].requiredQuantity).toBe('1.5');
    expect(released.materialSnapshot.locationId).toBe(siteId);
    expect(released.materialSnapshot.revision).toBe(1);
    await request(http).patch(path).set(auth).send({ quantity: 4 }).expect(409);
    await request(http).patch(path).set(auth).send({ productRef: 'RAW' }).expect(409);
    await request(http)
      .post(`${path}/material-context`)
      .set(auth)
      .send({ ...body, expectedUpdatedAt: released.updatedAt })
      .expect(409);
    await request(http).patch(path).set(auth).send({ name: 'Safe rename' }).expect(200);
    const current = (await request(http).get(path).set(auth).expect(200)).body;
    expect(current.materialSnapshot).toEqual(released.materialSnapshot);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(3);
    const legacy = await db.manufacturingOrder.create({
      data: {
        tenantId,
        number: `legacy-${randomUUID()}`,
        name: 'Historical',
        productRef: 'FG',
        quantity: 1,
        dueDate: new Date(future),
        releaseDate: new Date(today),
        status: 'RELEASED',
        bomId,
      },
    });
    expect(
      (await request(http).get(`${root}/${legacy.id}`).set(auth).expect(200)).body.materialSnapshot,
    ).toBeNull();
  });
  it('fails closed when WMS is disabled, including historical reads', async () => {
    const module = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: module.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await call('get', `runs/${runId}`).expect(403);
    await calculate().expect(403);
  });
});
