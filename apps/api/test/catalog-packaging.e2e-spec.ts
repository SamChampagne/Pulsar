import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { MODULE_CATALOG, PERMISSION_CATALOG } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { EmailService } from '../src/core/email/email.service';

describe('Catalog packages and explicit supplier receiving I1b', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `catalog-packaging-${Date.now()}`;
  const tenants: Array<{ id: string; tokens: Record<string, string> }> = [];
  const call = (
    method: 'get' | 'post' | 'patch',
    path: string,
    data?: object,
    role = 'manager',
    tenant = 0,
  ) => {
    const r = request(http)
      [method](`/api/v1/${path}`)
      .set('Authorization', `Bearer ${tenants[tenant].tokens[role]}`);
    return data ? r.send(data) : r;
  };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ channel: 'log', send: jest.fn(async () => true) })
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
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    for (const p of PERMISSION_CATALOG)
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    for (let i = 0; i < 3; i++) {
      const slug = `${prefix}-${i}`,
        tenant = await db.tenant.create({ data: { slug, name: slug } }),
        tokens: Record<string, string> = {};
      for (const m of MODULE_CATALOG.filter(
        (m) =>
          ['catalog', 'services', 'purchasing', 'wms'].includes(m.key) &&
          (i !== 2 || m.key === 'purchasing'),
      )) {
        const def = await db.moduleDefinition.upsert({
          where: { key: m.key },
          create: m,
          update: m,
        });
        await db.tenantModule.create({
          data: { tenantId: tenant.id, moduleId: def.id, enabled: true },
        });
      }
      for (const [key, keys] of Object.entries({
        manager: PERMISSION_CATALOG.map((p) => p.key),
        reader: ['purchasing.read'],
        services: ['services.read', 'services.manage'],
      })) {
        const ps = await db.permission.findMany({ where: { key: { in: keys } } });
        const role = await db.role.create({
          data: {
            tenantId: tenant.id,
            key,
            name: key,
            permissions: { create: ps.map((p) => ({ permissionId: p.id })) },
          },
        });
        const email = `${key}@${slug}.test`;
        await db.user.create({
          data: {
            tenantId: tenant.id,
            email,
            firstName: key,
            lastName: 'Packaging',
            status: 'ACTIVE',
            passwordHash: hashSync('Test1234!', 4),
            roles: { create: { roleId: role.id } },
          },
        });
        tokens[key] = (
          await request(http)
            .post('/api/v1/auth/login')
            .send({ tenant: slug, email, password: 'Test1234!' })
            .expect(200)
        ).body.accessToken;
      }
      tenants.push({ id: tenant.id, tokens });
    }
    console.log(`CATALOG_PACKAGING_TENANT=${prefix}-0`);
  }, 120000);
  afterAll(async () => app?.close());
  async function fixture(t = 0, factor = '12', wholeOnly = true) {
    const item = (
      await call(
        'post',
        'purchasing/data/items',
        { code: randomUUID(), name: 'Joint I1b', kind: 'GOODS', unit: 'EA' },
        'manager',
        t,
      ).expect(201)
    ).body;
    const supplier = (
      await call(
        'post',
        'purchasing/data/suppliers',
        { code: randomUUID(), name: 'Fournisseur I1b' },
        'manager',
        t,
      ).expect(201)
    ).body;
    const path = `purchasing/data/items/${item.id}/packages`;
    const data = {
      code: 'BOX',
      label: 'Carton de 12',
      unitsPerPackage: factor,
      wholeOnly,
      barcode: `00Ab-${randomUUID()}`,
    };
    const pack = (await call('post', path, data, 'manager', t).expect(201)).body;
    const line = {
      catalogItemId: item.id,
      quantity: 24,
      unitPrice: 2,
      packageId: pack.id,
      packageVersion: pack.version,
      packageCount: '2',
    };
    return {
      item,
      supplier,
      path,
      data,
      pack,
      line,
      body: { supplierId: supplier.id, currency: 'CAD', lines: [line] },
    };
  }
  async function confirmed(f: Awaited<ReturnType<typeof fixture>>, lines = [f.line]) {
    const d = (await call('post', 'purchasing/orders', { ...f.body, lines }).expect(201)).body;
    return (
      await call('post', `purchasing/orders/${d.id}/transition`, {
        status: 'CONFIRMED',
        expectedUpdatedAt: d.updatedAt,
      }).expect(201)
    ).body;
  }
  async function stocked() {
    const f = await fixture(),
      tenantId = tenants[0].id;
    const stock = await db.wmsItem.create({
      data: { tenantId, sku: randomUUID(), name: 'Stock I1b', unit: 'EA' },
    });
    const site = await db.location.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Réception I1b',
        type: 'WAREHOUSE',
        addressLine1: '1 Test',
        city: 'Québec',
      },
    });
    const bin = await db.bin.create({ data: { tenantId, locationId: site.id, code: 'A' } });
    await call('patch', `purchasing/items/${f.item.id}/stock-link`, {
      wmsItemId: stock.id,
      expectedUpdatedAt: f.item.updatedAt,
    }).expect(200);
    const order = await confirmed(f),
      route = `purchasing/orders/${order.id}`;
    const receipt = {
      operationKey: randomUUID(),
      expectedUpdatedAt: order.updatedAt,
      locationId: site.id,
      reference: 'BL-I1b',
      lines: [{ orderLineId: order.lines[0].id, binId: bin.id, quantity: 12, packageCount: '1' }],
    };
    const balance = async () =>
      (
        await db.inventoryLevel.findFirst({ where: { tenantId, itemId: stock.id, binId: bin.id } })
      )?.qtyOnHand.toString() ?? '0';
    return { ...f, stock, site, bin, order, route, receipt, balance };
  }
  it('works in Purchasing alone and shares package records with the authorized consumers', async () => {
    const f = await fixture(2);
    await call('post', 'purchasing/orders', f.body, 'manager', 2).expect(201);
    await call('get', `catalog/items/${f.item.id}/packages`, undefined, 'manager', 2).expect(403);
    const g = await fixture();
    const r = await call(
      'get',
      `services/data/items/${g.item.id}/packages`,
      undefined,
      'services',
    ).expect(200);
    expect(r.body.items[0].id).toBe(g.pack.id);
    expect(r.body.baseUnit).toBe('EA');
    expect(JSON.stringify(r.body)).not.toMatch(/unitPrice|supplierTerms/);
  });
  it('enforces read/manage permissions and tenant/item ownership', async () => {
    const a = await fixture(),
      b = await fixture(1);
    await call('get', a.path, undefined, 'reader').expect(200);
    await call('post', a.path, { ...a.data, code: 'OTHER' }, 'reader').expect(403);
    await call(
      'patch',
      `${a.path}/${a.pack.id}`,
      { expectedVersion: 1, label: 'No', active: false },
      'reader',
    ).expect(403);
    await call('get', a.path, undefined, 'manager', 1).expect(404);
    await call('patch', `${a.path}/${b.pack.id}`, {
      expectedVersion: 1,
      label: 'No',
      active: false,
    }).expect(404);
    await call('post', 'purchasing/orders', {
      ...a.body,
      lines: [{ ...a.line, packageId: b.pack.id }],
    }).expect(400);
  });
  it('reserves barcodes including inactive packages while preserving zeros and case per tenant', async () => {
    const f = await fixture(),
      g = await fixture();
    await call('post', g.path, { ...g.data, code: 'OTHER', barcode: f.pack.barcode }).expect(409);
    await call('patch', `${f.path}/${f.pack.id}`, {
      expectedVersion: 1,
      label: f.pack.label,
      active: false,
    }).expect(200);
    await call('post', g.path, { ...g.data, code: 'OTHER', barcode: f.pack.barcode }).expect(409);
    const h = await fixture(1);
    const same = (
      await call(
        'post',
        h.path,
        { ...h.data, code: 'OTHER', barcode: f.pack.barcode },
        'manager',
        1,
      ).expect(201)
    ).body;
    expect(same.barcode).toBe(f.pack.barcode);
    expect(
      (
        await call('post', g.path, {
          ...g.data,
          code: 'CASE',
          barcode: f.pack.barcode.toLowerCase(),
        }).expect(201)
      ).body.barcode,
    ).toBe(f.pack.barcode.toLowerCase());
  });
  it('rejects unknown immutable fields, invalid ratios, control codes and service packages', async () => {
    const f = await fixture();
    await call('patch', `${f.path}/${f.pack.id}`, {
      expectedVersion: 1,
      label: 'New',
      active: true,
      unitsPerPackage: '10',
    }).expect(400);
    for (const factor of ['0', '-1', '1e2', '1.1234567', '1000000001'])
      await call('post', f.path, { ...f.data, code: 'BAD', unitsPerPackage: factor }).expect(400);
    await call('post', f.path, { ...f.data, barcode: 'abc\u001d123' }).expect(400);
    const service = (
      await call('post', 'purchasing/data/items', {
        code: randomUUID(),
        name: 'Prestation',
        kind: 'SERVICE',
        unit: 'H',
      }).expect(201)
    ).body;
    await call('post', `purchasing/data/items/${service.id}/packages`, f.data).expect(400);
  });
  it('allows only one concurrent package version and audits creation/updates', async () => {
    const f = await fixture();
    const results = await Promise.all(
      ['A', 'B'].map((label) =>
        call('patch', `${f.path}/${f.pack.id}`, { expectedVersion: 1, label, active: true }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const row = await db.catalogPackage.findFirstOrThrow({
      where: { tenantId: tenants[0].id, id: f.pack.id },
    });
    expect(row.version).toBe(2);
    expect(
      await db.auditLog.count({
        where: { tenantId: tenants[0].id, entityType: 'catalog-package' },
      }),
    ).toBeGreaterThan(0);
  });
  it('captures server package data while prices and total remain in base units', async () => {
    const f = await fixture(),
      o = (await call('post', 'purchasing/orders', f.body).expect(201)).body;
    expect(o.lines[0].packageSnapshot).toMatchObject({
      barcode: f.pack.barcode,
      unitsPerPackage: '12',
      orderedCount: '2',
      baseQuantity: '24',
      baseUnit: 'EA',
    });
    expect(o.lines[0].quantity).toBe('24');
    expect(o.total).toBe('48.00');
    await call('post', 'purchasing/orders', {
      ...f.body,
      lines: [{ ...f.line, packageSnapshot: { unitsPerPackage: '1' } }],
    }).expect(400);
  });
  it('rejects partial package choices, mismatched quantities and fractional whole packages', async () => {
    const f = await fixture();
    const { packageCount, ...partial } = f.line;
    for (const line of [
      partial,
      { ...f.line, quantity: 2 },
      { ...f.line, packageCount: '0.5', quantity: 6 },
      { ...f.line, packageCount: '0' },
    ])
      await call('post', 'purchasing/orders', { ...f.body, lines: [line] }).expect(400);
  });
  it('blocks stale or inactive choices at confirmation without changing the draft', async () => {
    const f = await fixture(),
      o = (await call('post', 'purchasing/orders', f.body).expect(201)).body;
    await call('patch', `${f.path}/${f.pack.id}`, {
      expectedVersion: 1,
      label: 'Révisé',
      active: false,
    }).expect(200);
    await call('post', `purchasing/orders/${o.id}/transition`, {
      status: 'CONFIRMED',
      expectedUpdatedAt: o.updatedAt,
    }).expect(409);
    expect((await call('get', `purchasing/orders/${o.id}`).expect(200)).body.status).toBe('DRAFT');
    await call('post', 'purchasing/orders', f.body).expect(409);
  });
  it('keeps legacy base-unit lines confirmable without inventing a package', async () => {
    const f = await fixture(),
      o = await confirmed(f, [{ catalogItemId: f.item.id, quantity: 24, unitPrice: 2 } as any]);
    expect(o.lines[0].packageSnapshot).toBeNull();
    await call('post', `purchasing/orders/${o.id}/resolve-package`, {
      code: f.pack.barcode,
    }).expect(404);
  });
  it('accepts exact fractional packages without rounding', async () => {
    const f = await fixture(0, '0.1', false),
      o = await confirmed(f, [{ ...f.line, packageCount: '0.3', quantity: 0.03 }]);
    expect(o.lines[0].packageSnapshot.baseQuantity).toBe('0.03');
    const g = await fixture(0, '0.333333', false);
    await call('post', 'purchasing/orders', {
      ...g.body,
      lines: [{ ...g.line, packageCount: '3', quantity: 0.9999 }],
    }).expect(400);
  });
  it('receives a frozen carton after master deactivation, then loose units, preserving proof', async () => {
    const f = await stocked();
    await call('patch', `${f.path}/${f.pack.id}`, {
      expectedVersion: 1,
      label: 'Historique remplacé',
      active: false,
    }).expect(200);
    const scan = await call(
      'post',
      `${f.route}/resolve-package`,
      { code: f.pack.barcode },
      'reader',
    ).expect(200);
    expect(scan.body.packageSnapshot.label).toBe('Carton de 12');
    expect(await f.balance()).toBe('0');
    const r = (await call('post', `${f.route}/receipts`, f.receipt).expect(201)).body;
    expect(r.replayed).toBe(false);
    expect(await f.balance()).toBe('12');
    const current = (await call('get', f.route).expect(200)).body;
    await call('post', `${f.route}/receipts`, {
      ...f.receipt,
      operationKey: randomUUID(),
      expectedUpdatedAt: current.updatedAt,
      lines: [{ orderLineId: f.order.lines[0].id, binId: f.bin.id, quantity: 3 }],
    }).expect(201);
    expect(await f.balance()).toBe('15');
    const history = (await call('get', `${f.route}/receipts`, undefined, 'reader').expect(200)).body
      .items;
    expect(history.map((h: any) => h.lines[0].packageCount).sort()).toEqual(['1', null].sort());
    expect((await call('get', f.route).expect(200)).body.lines[0].remaining).toBe('9');
  });
  it('replays a lost receipt response exactly once and rejects changes of meaning', async () => {
    const f = await stocked();
    const first = (await call('post', `${f.route}/receipts`, f.receipt).expect(201)).body;
    const again = (await call('post', `${f.route}/receipts`, f.receipt).expect(201)).body;
    expect(again).toEqual({ ...first, replayed: true });
    expect(await f.balance()).toBe('12');
    const { packageCount, ...base } = f.receipt.lines[0];
    await call('post', `${f.route}/receipts`, { ...f.receipt, lines: [base] }).expect(409);
    await call('post', `${f.route}/receipts`, { ...f.receipt, reference: 'Other' }).expect(409);
    expect(
      await db.supplierReceipt.count({ where: { tenantId: tenants[0].id, orderId: f.order.id } }),
    ).toBe(1);
  });
  it('rejects invalid package receipts, unknown packages and overreceiving atomically', async () => {
    const f = await stocked();
    for (const change of [
      { packageCount: '2', quantity: 12 },
      { packageCount: '0.5', quantity: 6 },
      { packageCount: '0', quantity: 12 },
    ])
      await call('post', `${f.route}/receipts`, {
        ...f.receipt,
        lines: [{ ...f.receipt.lines[0], ...change }],
      }).expect(400);
    await call('post', `${f.route}/receipts`, {
      ...f.receipt,
      lines: [{ ...f.receipt.lines[0], packageCount: '3', quantity: 36 }],
    }).expect(409);
    await call('post', `${f.route}/receipts`, {
      ...f.receipt,
      lines: [f.receipt.lines[0], { ...f.receipt.lines[0], quantity: 1 }],
    }).expect(400);
    expect(await f.balance()).toBe('0');
  });
  it('rejects stock precision loss rather than silently rounding', async () => {
    const f = await fixture(0, '0.0001', false),
      o = await confirmed(f, [{ ...f.line, quantity: 0.0001, packageCount: '1' }]),
      g = await stocked();
    await call('post', `purchasing/orders/${o.id}/receipts`, {
      ...g.receipt,
      expectedUpdatedAt: o.updatedAt,
      lines: [
        { ...g.receipt.lines[0], orderLineId: o.lines[0].id, quantity: 0.001, packageCount: '1' },
      ],
    }).expect(400);
  });
  it('serializes concurrent receipts and leaves exactly one stock movement', async () => {
    const f = await stocked();
    const rs = await Promise.all(
      [1, 2].map(() =>
        call('post', `${f.route}/receipts`, { ...f.receipt, operationKey: randomUUID() }),
      ),
    );
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await f.balance()).toBe('12');
    expect(
      await db.stockMovement.count({ where: { tenantId: tenants[0].id, itemId: f.stock.id } }),
    ).toBe(1);
  });
  it('does not infer a scan target for ambiguous, foreign or fully received orders', async () => {
    const f = await fixture(),
      o = await confirmed(f, [f.line, f.line]);
    await call('post', `purchasing/orders/${o.id}/resolve-package`, {
      code: f.pack.barcode,
    }).expect(409);
    await call(
      'post',
      `purchasing/orders/${o.id}/resolve-package`,
      { code: f.pack.barcode },
      'manager',
      1,
    ).expect(404);
    const g = await stocked();
    await call('post', `${g.route}/receipts`, {
      ...g.receipt,
      lines: [{ ...g.receipt.lines[0], quantity: 24, packageCount: '2' }],
    }).expect(201);
    await call('post', `${g.route}/resolve-package`, { code: g.pack.barcode }).expect(404);
    await call('post', `${g.route}/receipts`, g.receipt, 'reader').expect(403);
  });
});
