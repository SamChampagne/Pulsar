import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('WMS visual workspace (HTTP)', () => {
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
  const slug = `wms-visual-${Date.now()}`;
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

  it('works with WMS alone and separates site queues without inventing mixed-unit totals', async () => {
    const before = await db.stockMovement.count({ where: { tenantId: tid } });
    const sites = (await get('sites').expect(200)).body;
    expect(sites.items.map((s: any) => s.id).sort()).toEqual([site, remoteSite].sort());
    await get(`sites/${site}`).expect(200);
    await request(http)
      .get('/api/v1/transportation/locations')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    const w = (await get(`workspace?locationId=${site}`).expect(200)).body;
    expect(w.receiving.items.map((r: any) => r.number)).toEqual(['RC-LOCAL']);
    expect(w.picking.total).toBe(1);
    expect(w.finishing.total).toBe(1);
    expect(w.putaway.total).toBe(1);
    expect(w.putaway.items[0].stockedItems).toBe(2);
    expect(w).not.toHaveProperty('totalOnHand');
    expect(JSON.stringify(w)).not.toContain('tenantId');
    expect(await db.stockMovement.count({ where: { tenantId: tid } })).toBe(before);
  });
  it('keeps tenant and warehouse boundaries on every read surface', async () => {
    await get(`sites/${foreignSite}`).expect(404);
    await get(`workspace?locationId=${foreignSite}`).expect(404);
    await get(`workspace/bins/${foreignBin}`).expect(404);
    await get('workspace?locationId=x&page=0').expect(400);
    const customer = await db.location.create({
      data: {
        tenantId: tid,
        code: 'CLIENT',
        name: 'Client',
        type: 'CUSTOMER_SITE',
        addressLine1: 'Test',
        city: 'Test',
      },
    });
    await get(`workspace?locationId=${customer.id}`).expect(404);
  });
  it('reports quantities with their units and paginates item searches', async () => {
    const detail = (await get(`workspace/bins/${receiving}`).expect(200)).body;
    expect(detail.levels.items.map((l: any) => `${l.qtyOnHand} ${l.unit}`).sort()).toEqual([
      '17 EA',
      '2.125 KG',
    ]);
    const result = (await get(`workspace/bins/${receiving}?q=vrac`).expect(200)).body;
    expect(result.levels.total).toBe(1);
    expect(result.levels.items[0].sku).toBe('VRAC');
  });
  it('saves zone metadata only, rejects stale edits and audits the change', async () => {
    const original = (await get(`workspace/bins/${storage}`)).body.bin;
    const before = await db.stockMovement.count({ where: { tenantId: tid } });
    await patch(storage, {
      zone: '  Allée froide  ',
      expectedUpdatedAt: original.updatedAt,
    }).expect(200);
    expect((await get(`workspace/bins/${storage}`)).body.bin.zone).toBe('Allée froide');
    await patch(storage, { zone: 'Écrasement', expectedUpdatedAt: original.updatedAt }).expect(409);
    expect(
      (await get(`workspace?locationId=${site}&q=froide`)).body.bins.items.map((b: any) => b.id),
    ).toEqual([storage]);
    expect(await db.stockMovement.count({ where: { tenantId: tid } })).toBe(before);
    expect(
      await db.auditLog.count({
        where: { tenantId: tid, entityId: storage, entityType: 'wms-bin' },
      }),
    ).toBeGreaterThan(0);
    await patch(storage, { zone: 'x'.repeat(81) }).expect(400);
  });
  it('does not re-site or disable stocked bins under the guise of configuration', async () => {
    await patch(receiving, { locationId: remoteSite }).expect(400);
    await patch(receiving, { isActive: false }).expect(409);
    await patch(receiving, { kind: 'STORAGE' }).expect(409);
    await patch(receiving, { zone: 'Quai nord' }).expect(200);
  });
  it('moves stock through the ledger and changes the receiving queue only when empty', async () => {
    const before = await db.stockMovement.count({ where: { tenantId: tid } });
    await post('inventory/move', {
      itemId: item,
      fromBinId: receiving,
      toBinId: storage,
      locationId: site,
      qty: 7,
    }).expect(201);
    const detail = (await get(`workspace/bins/${receiving}`)).body;
    expect(detail.levels.items.find((l: any) => l.itemId === item).qtyOnHand).toBe('10');
    expect((await get(`workspace?locationId=${site}`)).body.putaway.total).toBe(1);
    expect(await db.stockMovement.count({ where: { tenantId: tid } })).toBe(before + 1);
    expect(
      (await db.receipt.findFirstOrThrow({ where: { tenantId: tid, number: 'RC-LOCAL' } })).status,
    ).toBe('DRAFT');
  });
  it('rejects foreign references, inactive destinations, wrong sites and excess precision', async () => {
    const base = { itemId: item, fromBinId: receiving, toBinId: storage, locationId: site, qty: 1 };
    const before = await db.stockMovement.count({ where: { tenantId: tid } });
    await post('inventory/move', { ...base, toBinId: foreignBin }).expect(400);
    await post('inventory/move', { ...base, itemId: foreignItem }).expect(400);
    await post('inventory/move', { ...base, toBinId: inactive }).expect(409);
    await post('inventory/move', { ...base, locationId: remoteSite }).expect(400);
    await post('inventory/move', { ...base, qty: 0.0001 }).expect(400);
    await post('inventory/adjust', { itemId: foreignItem, binId: storage, qtyDelta: 1 }).expect(
      400,
    );
    expect(await db.stockMovement.count({ where: { tenantId: tid } })).toBe(before);
  });
  it('serializes concurrent withdrawals: one loses with 409 and no stock is invented', async () => {
    const i = await db.wmsItem.create({ data: { tenantId: tid, sku: 'RACE', name: 'Race' } });
    await post('inventory/adjust', { itemId: i.id, binId: receiving, qtyDelta: 5 }).expect(201);
    const before = await db.stockMovement.count({ where: { tenantId: tid, itemId: i.id } });
    const results = await Promise.all(
      [1, 2].map(() =>
        post('inventory/move', { itemId: i.id, fromBinId: receiving, toBinId: storage, qty: 4 }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const levels = await db.inventoryLevel.findMany({ where: { tenantId: tid, itemId: i.id } });
    expect(levels.map((l) => +l.qtyOnHand).sort()).toEqual([1, 4]);
    expect(await db.stockMovement.count({ where: { tenantId: tid, itemId: i.id } })).toBe(
      before + 1,
    );
  });
  it('serializes concurrent increments into an absent balance row', async () => {
    const i = await db.wmsItem.create({
      data: { tenantId: tid, sku: 'NEW-RACE', name: 'New balance' },
    });
    const results = await Promise.all(
      [1, 2].map(() => post('inventory/adjust', { itemId: i.id, binId: storage, qtyDelta: 1 })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(
      +(
        await db.inventoryLevel.findFirstOrThrow({
          where: { tenantId: tid, itemId: i.id, binId: storage },
        })
      ).qtyOnHand,
    ).toBe(2);
  });
  it('paginates the schematic and searches beyond the first page without shrinking site KPIs', async () => {
    await db.bin.createMany({
      data: Array.from({ length: 83 }, (_, i) => ({
        tenantId: tid,
        locationId: site,
        code: `Z-${String(i).padStart(3, '0')}`,
        zone: 'Réserve',
      })),
    });
    const first = (await get(`workspace?locationId=${site}`)).body;
    expect(first.bins.items).toHaveLength(80);
    expect(first.bins.total).toBe(86);
    const second = (await get(`workspace?locationId=${site}&page=2`)).body;
    expect(second.bins.items).toHaveLength(6);
    const searched = (await get(`workspace?locationId=${site}&q=Z-082`)).body;
    expect(searched.bins.items[0].code).toBe('Z-082');
    expect(searched.summary.bins).toBe(86);
  });
  it('shows inactive or corrupt legacy stock explicitly', async () => {
    await db.inventoryLevel.create({
      data: { tenantId: tid, itemId: item, binId: inactive, qtyOnHand: -2 },
    });
    const w = (await get(`workspace?locationId=${site}&q=OFF`)).body;
    expect(w.summary.negativeLevels).toBe(1);
    expect(w.bins.items[0]).toMatchObject({ isActive: false, negativeItems: 1 });
  });
  it('reconciles fractional cycle counts through the same precision-checked ledger', async () => {
    const bin = await db.bin.create({
      data: { tenantId: tid, locationId: remoteSite, code: 'DECIMAL' },
    });
    await post('inventory/adjust', { itemId: item, binId: bin.id, qtyDelta: 0.1 }).expect(201);
    const count = (await post('cycle-counts', { binId: bin.id }).expect(201)).body;
    await post(`cycle-counts/${count.id}/counts`, {
      counts: [{ lineId: count.lines[0].id, countedQty: 0.3 }],
    }).expect(201);
    await post(`cycle-counts/${count.id}/reconcile`, {}).expect(201);
    const level = await db.inventoryLevel.findFirstOrThrow({
      where: { tenantId: tid, binId: bin.id, itemId: item },
    });
    expect(level.qtyOnHand.toString()).toBe('0.3');
    const movement = await db.stockMovement.findFirstOrThrow({
      where: { tenantId: tid, refType: 'cycle-count', refId: count.id },
    });
    expect(movement.qty.toString()).toBe('0.2');
  });
  it('enforces read-only roles and hot module deactivation', async () => {
    await get(`workspace?locationId=${site}`, reader).expect(200);
    await patch(storage, { zone: 'Refused' }, reader).expect(403);
    await post(
      'inventory/move',
      { itemId: item, fromBinId: receiving, toBinId: storage, qty: 1 },
      reader,
    ).expect(403);
    const wm = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    await db.tenantModule.updateMany({
      where: { tenantId: tid, moduleId: wm.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tid);
    await get('sites').expect(403);
    await get(`workspace?locationId=${site}`).expect(403);
    await get(`workspace/bins/${storage}`).expect(403);
  });
});
