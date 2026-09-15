import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('WMS guided operations (HTTP)', () => {
  let app: INestApplication, db: PrismaService, http: any, tid: string, otherTid: string;
  let site: string,
    remoteSite: string,
    foreignSite: string,
    receiving: string,
    storage: string,
    inactive: string,
    foreignBin: string,
    item: string,
    foreignItem: string;
  let token: string, reader: string;
  const slug = `wms-guided-${Date.now()}`;
  const get = (path: string, t = token) =>
    request(http).get(`/api/v1/wms/${path}`).set('Authorization', `Bearer ${t}`);
  const post = (path: string, body: object, t = token) =>
    request(http).post(`/api/v1/wms/${path}`).set('Authorization', `Bearer ${t}`).send(body);
  const patch = (id: string, body: object, t = token) =>
    request(http).patch(`/api/v1/wms/bins/${id}`).set('Authorization', `Bearer ${t}`).send(body);
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentRuntimeService)
      .useValue({ killAgentSessions: async () => {}, closeSession: async () => {} })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();
    db = app.get(PrismaService);
    tid = (await db.tenant.create({ data: { slug, name: slug } })).id;
    otherTid = (await db.tenant.create({ data: { slug: `${slug}-foreign`, name: 'Foreign' } })).id;
    const wm = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    await db.tenantModule.create({ data: { tenantId: tid, moduleId: wm.id, enabled: true } });
    for (const mode of ['operator', 'reader']) {
      const perms = await db.permission.findMany({
        where: { key: { in: mode === 'operator' ? ['wms.read', 'wms.manage'] : ['wms.read'] } },
      });
      const role = await db.role.create({
        data: {
          tenantId: tid,
          key: mode,
          name: mode,
          permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
        },
      });
      const email = `${mode}@${slug}.test`;
      await db.user.create({
        data: {
          tenantId: tid,
          email,
          firstName: 'WMS',
          lastName: mode,
          passwordHash: hashSync('Test1234!', 4),
          status: 'ACTIVE',
          roles: { create: { roleId: role.id } },
        },
      });
      const login = await request(http)
        .post('/api/v1/auth/login')
        .send({ tenant: slug, email, password: 'Test1234!' })
        .expect(200);
      if (mode === 'operator') token = login.body.accessToken;
      else reader = login.body.accessToken;
    }
    const loc = async (tenantId: string, code: string) =>
      (
        await db.location.create({
          data: {
            tenantId,
            code,
            name: code,
            type: 'WAREHOUSE',
            addressLine1: '1 Test',
            city: 'Québec',
          },
        })
      ).id;
    site = await loc(tid, 'NORD');
    remoteSite = await loc(tid, 'SUD');
    foreignSite = await loc(otherTid, 'FOREIGN');
    const bin = async (
      tenantId: string,
      locationId: string,
      code: string,
      kind: any,
      isActive = true,
    ) => (await db.bin.create({ data: { tenantId, locationId, code, kind, isActive } })).id;
    receiving = await bin(tid, site, 'RC-01', 'RECEIVING');
    storage = await bin(tid, site, 'A-01', 'STORAGE');
    inactive = await bin(tid, site, 'OFF', 'STORAGE', false);
    foreignBin = await bin(otherTid, foreignSite, 'FOREIGN', 'STORAGE');
    item = (
      await db.wmsItem.create({ data: { tenantId: tid, sku: 'VIS', name: 'Visserie', unit: 'EA' } })
    ).id;
    foreignItem = (
      await db.wmsItem.create({ data: { tenantId: otherTid, sku: 'FOREIGN', name: 'Foreign' } })
    ).id;
    const kg = await db.wmsItem.create({
      data: { tenantId: tid, sku: 'VRAC', name: 'Matière en vrac', unit: 'KG' },
    });
    await db.inventoryLevel.createMany({
      data: [
        { tenantId: tid, itemId: item, binId: receiving, qtyOnHand: 17 },
        { tenantId: tid, itemId: kg.id, binId: receiving, qtyOnHand: 2.125 },
      ],
    });
    await db.receipt.createMany({
      data: [
        { tenantId: tid, locationId: site, number: 'RC-LOCAL' },
        { tenantId: tid, locationId: remoteSite, number: 'RC-REMOTE' },
      ],
    });
    await db.pickOrder.createMany({
      data: [
        { tenantId: tid, locationId: site, number: 'PK-OPEN' },
        { tenantId: tid, locationId: site, number: 'PK-PICKED', status: 'PICKED' },
        { tenantId: tid, locationId: site, number: 'PK-DONE', status: 'COMPLETED' },
      ],
    });
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  const updateLine = (kind: string, id: string, lineId: string, body: object, t = token) =>
    request(http)
      .patch(`/api/v1/wms/${kind}/${id}/lines/${lineId}`)
      .set('Authorization', `Bearer ${t}`)
      .send(body);
  const newReceipt = async () => (await post('receipts', { locationId: site }).expect(201)).body;
  const newPick = async () => (await post('pick-orders', { locationId: site }).expect(201)).body;

  it('reads units, site and readiness without requiring TMS permissions', async () => {
    const r = await newReceipt();
    const v = (
      await post(`receipts/${r.id}/lines`, { itemId: item, toBinId: receiving, qty: 0.125 }).expect(
        201,
      )
    ).body;
    const read = (await get(`receipts/${r.id}`, reader).expect(200)).body;
    expect(read.location.id).toBe(site);
    expect(read.lines[0].item.unit).toBe('EA');
    expect(read.lines[0].qty).toBe('0.125');
    expect(read.readiness.canExecute).toBe(true);
    expect(read.readiness.lines[0].stockOnHand).toBeNull();
    expect(new Date(v.updatedAt).getTime()).toBeGreaterThan(new Date(r.updatedAt).getTime());
  });

  it('scopes searchable bin and article pickers, with pagination and inactive exclusion', async () => {
    const bins = (await get(`sites/${site}/bins?search=RC&pageSize=1`).expect(200)).body;
    expect(bins.items.map((b: any) => b.id)).toEqual([receiving]);
    expect(bins.items[0].name).toContain('RC-01');
    await get(`sites/${foreignSite}/bins`).expect(404);
    await get(`sites/${site}/bins/${foreignBin}`).expect(404);
    await get(`sites/${remoteSite}/bins/${receiving}`).expect(404);
    await get(`choices/items/${foreignItem}`).expect(404);
    expect((await get('choices/items?search=VIS&pageSize=1')).body.items[0].id).toBe(item);
    expect((await get(`sites/${site}/bins`)).body.items.some((b: any) => b.id === inactive)).toBe(
      false,
    );
  });

  it('rejects wrong-site, inactive, foreign and overprecision line references before persisting', async () => {
    const r = await newReceipt(),
      p = await newPick();
    const remoteBin = await db.bin.create({
      data: { tenantId: tid, locationId: remoteSite, code: 'REMOTE' },
    });
    for (const [kind, doc, field] of [
      ['receipts', r, 'toBinId'],
      ['pick-orders', p, 'fromBinId'],
    ] as const) {
      for (const [bin, status] of [
        [remoteBin.id, 400],
        [inactive, 409],
        [foreignBin, 400],
      ] as const)
        await post(`${kind}/${doc.id}/lines`, { itemId: item, [field]: bin, qty: 1 }).expect(
          status,
        );
      await post(`${kind}/${doc.id}/lines`, {
        itemId: foreignItem,
        [field]: receiving,
        qty: 1,
      }).expect(400);
      await post(`${kind}/${doc.id}/lines`, {
        itemId: item,
        [field]: receiving,
        qty: 0.0001,
      }).expect(400);
      expect((await get(`${kind}/${doc.id}`)).body.lines).toHaveLength(0);
    }
  });

  it('updates a line with a document version and refuses a stale second editor or validation', async () => {
    const r = await newReceipt();
    const v = (await post(`receipts/${r.id}/lines`, { itemId: item, toBinId: receiving, qty: 1 }))
      .body;
    const body = { itemId: item, toBinId: storage, qty: 2, expectedUpdatedAt: v.updatedAt };
    const updated = (await updateLine('receipts', r.id, v.lines[0].id, body).expect(200)).body;
    expect(updated.lines[0]).toMatchObject({ qty: '2', toBinId: storage });
    await updateLine('receipts', r.id, v.lines[0].id, { ...body, qty: 3 }).expect(409);
    await post(`receipts/${r.id}/post`, { expectedUpdatedAt: v.updatedAt }).expect(409);
    expect(await db.stockMovement.count({ where: { tenantId: tid, refId: r.id } })).toBe(0);
    expect(
      await db.auditLog.count({
        where: { tenantId: tid, entityType: 'wms-receipt-line', action: 'UPDATE' },
      }),
    ).toBeGreaterThan(0);
  });

  it('aggregates duplicate source lines and rolls back all stock on shortage', async () => {
    const p = await newPick();
    const i = await db.wmsItem.create({
      data: { tenantId: tid, sku: 'AGGREGATE', name: 'Aggregate', unit: 'KG' },
    });
    await post('inventory/adjust', { itemId: i.id, binId: storage, qtyDelta: 0.3 }).expect(201);
    await post(`pick-orders/${p.id}/lines`, { itemId: i.id, fromBinId: storage, qty: 0.2 }).expect(
      201,
    );
    const v = (
      await post(`pick-orders/${p.id}/lines`, {
        itemId: i.id,
        fromBinId: storage,
        qty: 0.2,
      }).expect(201)
    ).body;
    expect(v.readiness.canExecute).toBe(false);
    expect(v.readiness.blockedLines).toBe(2);
    expect(v.readiness.lines[0]).toMatchObject({
      requiredFromBin: '0.4',
      stockOnHand: '0.3',
      shortage: '0.1',
    });
    await post(`pick-orders/${p.id}/complete`, { expectedUpdatedAt: v.updatedAt }).expect(409);
    expect(await db.stockMovement.count({ where: { tenantId: tid, refId: p.id } })).toBe(0);
    expect((await get(`pick-orders/${p.id}`)).body.status).toBe('OPEN');
    await updateLine('pick-orders', p.id, v.lines[1].id, {
      itemId: i.id,
      fromBinId: storage,
      qty: 0.1,
      expectedUpdatedAt: v.updatedAt,
    }).expect(200);
    const ready = (await get(`pick-orders/${p.id}`)).body;
    expect(ready.readiness.canExecute).toBe(true);
    await post(`pick-orders/${p.id}/complete`, { expectedUpdatedAt: ready.updatedAt }).expect(201);
    const done = (await get(`pick-orders/${p.id}`)).body;
    expect(done.readiness.applicable).toBe(false);
    expect(done.readiness.lines[0].stockOnHand).toBeNull();
    expect(
      (
        await db.inventoryLevel.findFirstOrThrow({
          where: { tenantId: tid, itemId: i.id, binId: storage },
        })
      ).qtyOnHand.toString(),
    ).toBe('0');
  });

  it('rechecks a historically wrong-site line at posting and reports the blocker at read time', async () => {
    const r = await newReceipt();
    const b = await db.bin.create({
      data: { tenantId: tid, locationId: remoteSite, code: 'LEGACY' },
    });
    await db.receiptLine.create({
      data: { tenantId: tid, receiptId: r.id, itemId: item, toBinId: b.id, qty: 1 },
    });
    const read = (await get(`receipts/${r.id}`)).body;
    expect(read.readiness.lines[0].issues).toContain('Emplacement d’un autre site');
    await post(`receipts/${r.id}/post`, {}).expect(400);
    expect((await get(`receipts/${r.id}`)).body.status).toBe('DRAFT');
  });

  it('serializes legacy add-line versus post so every posted line has exactly one movement', async () => {
    const r = await newReceipt();
    await post(`receipts/${r.id}/lines`, { itemId: item, toBinId: receiving, qty: 1 }).expect(201);
    const [add, posted] = await Promise.all([
      post(`receipts/${r.id}/lines`, { itemId: item, toBinId: receiving, qty: 2 }),
      post(`receipts/${r.id}/post`, {}),
    ]);
    expect(posted.status).toBe(201);
    expect([201, 409]).toContain(add.status);
    const doc = (await get(`receipts/${r.id}`)).body;
    const movements = await db.stockMovement.findMany({
      where: { tenantId: tid, refId: r.id, type: 'RECEIPT' },
    });
    expect(movements).toHaveLength(doc.lines.length);
    expect(movements.reduce((n, m) => n + +m.qty, 0)).toBe(
      doc.lines.reduce((n: number, l: any) => n + +l.qty, 0),
    );
    await post(`receipts/${r.id}/post`, {}).expect(409);
  });

  it('a concurrent edit and confirmation with the same version cannot both succeed', async () => {
    const r = await newReceipt();
    const v = (await post(`receipts/${r.id}/lines`, { itemId: item, toBinId: receiving, qty: 1 }))
      .body;
    const results = await Promise.all([
      updateLine('receipts', r.id, v.lines[0].id, {
        itemId: item,
        toBinId: receiving,
        qty: 4,
        expectedUpdatedAt: v.updatedAt,
      }),
      post(`receipts/${r.id}/post`, { expectedUpdatedAt: v.updatedAt }),
    ]);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const doc = (await get(`receipts/${r.id}`)).body;
    const movements = await db.stockMovement.findMany({ where: { tenantId: tid, refId: r.id } });
    if (doc.status === 'POSTED') {
      expect(doc.lines[0].qty).toBe('1');
      expect(movements).toHaveLength(1);
    } else {
      expect(doc.lines[0].qty).toBe('4');
      expect(movements).toHaveLength(0);
    }
  });

  it('protects deletion by parent and version, permissions, and terminal documents', async () => {
    const r = await newReceipt(),
      other = await newReceipt();
    const v = (await post(`receipts/${r.id}/lines`, { itemId: item, toBinId: receiving, qty: 1 }))
      .body;
    await updateLine('receipts', other.id, v.lines[0].id, {
      itemId: item,
      toBinId: receiving,
      qty: 2,
    }).expect(404);
    await updateLine(
      'receipts',
      r.id,
      v.lines[0].id,
      { itemId: item, toBinId: receiving, qty: 2 },
      reader,
    ).expect(403);
    await request(http)
      .delete(`/api/v1/wms/receipts/${r.id}/lines/${v.lines[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .query({ expectedUpdatedAt: r.updatedAt })
      .expect(409);
    await post(`receipts/${r.id}/cancel`, { expectedUpdatedAt: v.updatedAt }).expect(201);
    await updateLine('receipts', r.id, v.lines[0].id, {
      itemId: item,
      toBinId: receiving,
      qty: 2,
    }).expect(409);
    await request(http)
      .patch(`/api/v1/wms/receipts/${r.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Too late' })
      .expect(409);
  });
});
