import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('WMS putaway and movement history (HTTP)', () => {
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
  const slug = `wms-moves-${Date.now()}`;
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

  const newStock = async (qty = 10) => {
    const i = (
      await post('items', {
        sku: 'T-' + randomUUID(),
        name: 'Article scénario',
        unit: 'KG',
      }).expect(201)
    ).body;
    await post('inventory/adjust', {
      itemId: i.id,
      binId: receiving,
      qtyDelta: qty,
      note: 'Stock du scénario de test',
    }).expect(201);
    return i.id as string;
  };
  const move = (itemId: string, qty = 1, operationKey = randomUUID()) => ({
    itemId,
    fromBinId: receiving,
    toBinId: storage,
    locationId: site,
    qty,
    operationKey,
  });

  it('connects a real receipt, putaway, pick and immutable unit snapshots in the journal', async () => {
    const i = (
      await post('items', {
        sku: 'FLOW-' + randomUUID(),
        name: 'Matière de test',
        unit: 'KG',
      }).expect(201)
    ).body;
    const receipt = (
      await post('receipts', { locationId: site, reference: 'Parcours complet' }).expect(201)
    ).body;
    await post(`receipts/${receipt.id}/lines`, {
      itemId: i.id,
      toBinId: receiving,
      qty: 6.375,
    }).expect(201);
    await post(`receipts/${receipt.id}/post`, {}).expect(201);
    const requestBody = move(i.id, 2.125);
    const first = (await post('inventory/move', requestBody).expect(201)).body;
    const replay = (await post('inventory/move', requestBody).expect(201)).body;
    expect(replay).toEqual({ ...first, replayed: true });
    const pick = (await post('pick-orders', { locationId: site }).expect(201)).body;
    await post(`pick-orders/${pick.id}/lines`, {
      itemId: i.id,
      fromBinId: storage,
      qty: 0.125,
    }).expect(201);
    await post(`pick-orders/${pick.id}/complete`, {}).expect(201);
    const work = (await get('putaway').query({ locationId: site, q: i.sku }).expect(200)).body;
    expect(work.items).toHaveLength(1);
    expect(work.items[0]).toMatchObject({ qtyOnHand: '4.25', unit: 'KG', binId: receiving });
    await request(http)
      .patch(`/api/v1/wms/items/${i.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ unit: 'L' })
      .expect(200);
    const journal = (await get('inventory/movements').query({ itemId: i.id }).expect(200)).body;
    expect(journal.total).toBe(3);
    expect(journal.items.map((r: any) => r.type)).toEqual(['PICK', 'MOVE', 'RECEIPT']);
    expect(journal.items.every((r: any) => r.unit === 'KG' && r.unitCaptured)).toBe(true);
    expect(journal.items[0].source).toMatchObject({ kind: 'pick-order', id: pick.id });
    expect(journal.items[2].source).toMatchObject({ kind: 'receipt', id: receipt.id });
    expect(journal.items[1].fromBin).toMatchObject({ id: receiving, locationId: site });
    expect(journal.items[1].toBin.id).toBe(storage);
    expect(journal.items[1].actor).toBe('WMS operator');
    expect(JSON.stringify(journal)).not.toMatch(
      /requestFingerprint|operationKey|passwordHash|tenantId/,
    );
    const level = await db.inventoryLevel.findFirstOrThrow({
      where: { tenantId: tid, itemId: i.id, binId: storage },
    });
    expect(level.qtyOnHand.toString()).toBe('2');
  });

  it('serializes concurrent identical keys into exactly one movement and one audit', async () => {
    const id = await newStock();
    const body = move(id, 2);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post('inventory/move', body).expect(201)),
    );
    expect(new Set(results.map((r) => r.body.movementId)).size).toBe(1);
    expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
    expect(
      await db.stockMovement.count({ where: { tenantId: tid, itemId: id, type: 'MOVE' } }),
    ).toBe(1);
    const level = await db.inventoryLevel.findFirstOrThrow({
      where: { tenantId: tid, itemId: id, binId: receiving },
    });
    expect(+level.qtyOnHand).toBe(8);
    const audits = await db.auditLog.findMany({
      where: { tenantId: tid, entityType: 'wms-inventory', entityId: id },
    });
    expect(
      audits.filter((a: any) => a.after?.movementId === results[0].body.movementId),
    ).toHaveLength(1);
  });

  it('rejects altered payloads sharing a key and validates UUID, site and ownership', async () => {
    const id = await newStock(),
      body = move(id);
    await post('inventory/move', body).expect(201);
    for (const changed of [{ qty: 2 }, { note: 'changed' }, { locationId: remoteSite }])
      await post('inventory/move', { ...body, ...changed }).expect(409);
    await post('inventory/move', { ...body, operationKey: 'bad-key' }).expect(400);
    await post('inventory/move', { ...move(id), toBinId: foreignBin }).expect(400);
    await post('inventory/move', { ...move(id), locationId: remoteSite }).expect(400);
    expect(
      await db.stockMovement.count({ where: { tenantId: tid, itemId: id, type: 'MOVE' } }),
    ).toBe(1);
  });

  it('does not reserve a key on rollback; the exact failed request can later succeed', async () => {
    const id = await newStock(1),
      body = move(id, 2);
    await post('inventory/move', body).expect(409);
    expect(
      await db.stockMovement.count({ where: { tenantId: tid, operationKey: body.operationKey } }),
    ).toBe(0);
    await post('inventory/adjust', { itemId: id, binId: receiving, qtyDelta: 2 }).expect(201);
    await post('inventory/move', body).expect(201);
    await post('inventory/move', body)
      .expect(201)
      .expect((r) => expect(r.body.replayed).toBe(true));
  });

  it('replays after stock has gone and bin configuration has changed, without reapplying', async () => {
    const b = (
      await post('bins', {
        locationId: site,
        code: 'TEMP-' + randomUUID(),
        kind: 'RECEIVING',
      }).expect(201)
    ).body;
    const id = await newStock(1);
    await post('inventory/adjust', { itemId: id, binId: b.id, qtyDelta: 1 }).expect(201);
    const body = { ...move(id), fromBinId: b.id };
    const first = (await post('inventory/move', body).expect(201)).body;
    await patch(b.id, { isActive: false }).expect(200);
    const next = (await post('inventory/move', body).expect(201)).body;
    expect(next).toEqual({ ...first, replayed: true });
  });

  it('keeps legacy unkeyed moves compatible and marks old units explicitly', async () => {
    const id = await newStock();
    const { operationKey, ...body } = move(id);
    await post('inventory/move', body).expect(201);
    await post('inventory/move', body).expect(201);
    expect(
      await db.stockMovement.count({ where: { tenantId: tid, itemId: id, type: 'MOVE' } }),
    ).toBe(2);
    await db.stockMovement.updateMany({
      where: { tenantId: tid, itemId: id },
      data: { unitSnapshot: null },
    });
    const r = (await get('inventory/movements').query({ itemId: id, type: 'MOVE' }).expect(200))
      .body;
    expect(r.total).toBe(2);
    expect(r.items.every((m: any) => !m.unitCaptured && m.unit === 'KG')).toBe(true);
  });

  it('filters source OR destination, intersects context and paginates without foreign data', async () => {
    const id = await newStock();
    await post('inventory/move', { ...move(id), note: 'TRACE-TEST' }).expect(201);
    for (const binId of [receiving, storage]) {
      const r = (
        await get('inventory/movements')
          .query({ itemId: id, binId, locationId: site, type: 'MOVE', search: 'TRACE-TEST' })
          .expect(200)
      ).body;
      expect(r.total).toBe(1);
    }
    const empty = (
      await get('inventory/movements').query({ itemId: id, locationId: remoteSite }).expect(200)
    ).body;
    expect(empty.total).toBe(0);
    const paged = (
      await get('inventory/movements').query({ itemId: id, pageSize: 1, page: 2 }).expect(200)
    ).body;
    expect(paged.items).toHaveLength(1);
    expect(paged).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    await get('inventory/movements').query({ itemId: foreignItem }).expect(400);
    await get('inventory/movements').query({ binId: foreignBin }).expect(400);
    await get('inventory/movements').query({ locationId: foreignSite }).expect(400);
    await get('inventory/movements').query({ type: 'DELETE' }).expect(400);
    await get('inventory/movements').query({ pageSize: 101 }).expect(400);
  });

  it('offers paginated putaway for WMS readers with inactive sources visible, no mixed totals', async () => {
    await db.inventoryLevel.create({
      data: { tenantId: tid, itemId: item, binId: inactive, qtyOnHand: 3 },
    });
    const inactiveReceiptBin = (
      await post('bins', {
        locationId: site,
        code: 'OFF-RC',
        kind: 'RECEIVING',
        isActive: false,
      }).expect(201)
    ).body;
    await db.inventoryLevel.create({
      data: { tenantId: tid, itemId: item, binId: inactiveReceiptBin.id, qtyOnHand: 3 },
    });
    const r = (await get('putaway', reader).query({ locationId: site, q: 'OFF-RC' }).expect(200))
      .body;
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ binActive: false, qtyOnHand: '3', unit: 'EA' });
    expect(r).not.toHaveProperty('totalQuantity');
    await get('putaway').query({ locationId: foreignSite }).expect(404);
    await get('putaway').query({ locationId: site, page: 0 }).expect(400);
    const local = (await get('putaway').query({ locationId: remoteSite }).expect(200)).body;
    expect(local.total).toBe(0);
  });

  it('rechecks rights and module activation even for an already applied key', async () => {
    const id = await newStock(),
      body = move(id);
    await post('inventory/move', body).expect(201);
    await post('inventory/move', body, reader).expect(403);
    await get('inventory/movements', reader).expect(200);
    await db.tenantModule.updateMany({ where: { tenantId: tid }, data: { enabled: false } });
    app.get(TenantModulesCacheService).invalidate(tid);
    await post('inventory/move', body).expect(403);
    await get('inventory/movements').expect(403);
    await get('putaway').query({ locationId: site }).expect(403);
    await db.tenantModule.updateMany({ where: { tenantId: tid }, data: { enabled: true } });
    app.get(TenantModulesCacheService).invalidate(tid);
  });
});
