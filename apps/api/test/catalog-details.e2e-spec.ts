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

describe('Catalogue information and explicit supplier terms I1a', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `catalog-details-${Date.now()}`;
  const tenants: Array<{ id: string; tokens: Record<string, string> }> = [];
  const call = (
    method: 'get' | 'post' | 'put' | 'patch',
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
          ['catalog', 'services', 'purchasing'].includes(m.key) &&
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
        manager: [
          'catalog.read',
          'catalog.manage',
          'services.read',
          'services.manage',
          'purchasing.read',
          'purchasing.manage',
        ],
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
            lastName: 'Catalogue',
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
    console.log(`CATALOG_DETAILS_TENANT=${prefix}-0`);
  }, 120000);
  afterAll(async () => app?.close());
  async function fixture(t = 0, kind = 'GOODS') {
    const item = (
      await call(
        'post',
        'purchasing/data/items',
        { code: randomUUID(), name: 'Pompe doseuse', kind, unit: kind === 'GOODS' ? 'EA' : 'H' },
        'manager',
        t,
      ).expect(201)
    ).body;
    const supplier = (
      await call(
        'post',
        'purchasing/data/suppliers',
        { code: randomUUID(), name: 'Fournisseur local' },
        'manager',
        t,
      ).expect(201)
    ).body;
    const path = `purchasing/data/items/${item.id}`;
    const data = {
      expectedVersion: 0,
      supplierId: supplier.id,
      supplierReference: 'FOU-P100',
      currency: 'CAD',
      unitPrice: '12.3456',
      minimumQuantity: '6',
      orderMultiple: '3',
      leadTimeDays: 7,
      validFrom: null,
      validUntil: null,
      packaging: 'Lot fournisseur de 3 pièces',
      terms: 'Appeler avant livraison',
      active: true,
    };
    const offer = (await call('put', `${path}/supplier-offers`, data, 'manager', t).expect(200))
      .body;
    const orderData = {
      supplierId: supplier.id,
      currency: 'CAD',
      lines: [
        {
          catalogItemId: item.id,
          quantity: 6,
          unitPrice: 12.3456,
          supplierOfferId: offer.id,
          supplierOfferVersion: offer.version,
        },
      ],
    };
    return { item, supplier, path, data, offer, orderData };
  }
  it('works with Purchasing alone and exposes no costs through Services item details', async () => {
    const f = await fixture(2);
    await call(
      'put',
      `${f.path}/details`,
      { expectedVersion: 0, data: { manufacturer: 'Atelier', netWeightKg: '1.2345' } },
      'manager',
      2,
    ).expect(200);
    await call('post', 'purchasing/orders', f.orderData, 'manager', 2).expect(201);
    await call('get', `catalog/items/${f.item.id}/details`, undefined, 'manager', 2).expect(403);
    const s = await fixture();
    const r = await call(
      'get',
      `services/data/items/${s.item.id}/details`,
      undefined,
      'services',
    ).expect(200);
    expect(JSON.stringify(r.body)).not.toMatch(/unitPrice|supplierReference|supplierOffers/);
    await call(
      'get',
      `services/data/items/${s.item.id}/supplier-offers`,
      undefined,
      'services',
    ).expect(404);
    await call('get', `${s.path}/supplier-offers`, undefined, 'services').expect(403);
  });
  it('supports all three consumer detail facades with one versioned record', async () => {
    const f = await fixture();
    for (const [version, base] of [
      'catalog/items',
      'purchasing/data/items',
      'services/data/items',
    ].entries()) {
      const r = await call('put', `${base}/${f.item.id}/details`, {
        expectedVersion: version,
        data: { brand: `V${version}` },
      }).expect(200);
      expect(r.body.version).toBe(version + 1);
    }
    expect(
      await db.catalogItemDetails.count({
        where: { tenantId: tenants[0].id, catalogItemId: f.item.id },
      }),
    ).toBe(1);
  });
  it('checks tenant, module and read/manage grants on every surface', async () => {
    const f = await fixture();
    await call('get', `${f.path}/details`, undefined, 'reader').expect(200);
    await call('put', `${f.path}/details`, { expectedVersion: 0, data: {} }, 'reader').expect(403);
    await call('put', `${f.path}/supplier-offers`, f.data, 'reader').expect(403);
    for (const suffix of ['details', 'supplier-offers', 'supplier-offers/suppliers'])
      await call('get', `${f.path}/${suffix}`, undefined, 'manager', 1).expect(
        suffix.endsWith('suppliers') ? 200 : 404,
      );
    await call('put', `${f.path}/details`, { expectedVersion: 0, data: {} }, 'manager', 1).expect(
      404,
    );
    const other = await fixture(1);
    await call('put', `${f.path}/supplier-offers`, {
      ...f.data,
      supplierId: other.supplier.id,
    }).expect(400);
    await call('post', 'purchasing/orders', {
      ...f.orderData,
      lines: [{ ...f.orderData.lines[0], supplierOfferId: other.offer.id }],
    }).expect(400);
  });
  it('rejects operational keys and unsuitable service measurements, without changing base data', async () => {
    const f = await fixture(0, 'SERVICE');
    for (const data of [{ netWeightKg: '3' }, { scope: 3 }, { stock: 100 }])
      await call('put', `${f.path}/details`, { expectedVersion: 0, data }).expect(400);
    await call('put', `${f.path}/details`, { data: {} }).expect(400);
    await call('put', `${f.path}/details`, {
      expectedVersion: 0,
      data: { scope: 'Maintenance', deliverables: 'Rapport', exclusions: 'Pièces' },
    }).expect(200);
    expect((await call('get', f.path).expect(200)).body.unit).toBe('H');
  });
  it('protects profile concurrency, including first creation and stale retry', async () => {
    const f = await fixture();
    const results = await Promise.all(
      ['A', 'B'].map((brand) =>
        call('put', `${f.path}/details`, { expectedVersion: 0, data: { brand } }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    await call('put', `${f.path}/details`, { expectedVersion: 0, data: {} }).expect(409);
    expect((await call('get', `${f.path}/details`).expect(200)).body.version).toBe(1);
  });
  it('validates supplier quantities, dates, currency and closed DTOs', async () => {
    const f = await fixture();
    for (const fields of [
      { minimumQuantity: '0' },
      { orderMultiple: '-1' },
      { unitPrice: '1.23456' },
      { currency: 'ZZZ' },
      { validFrom: '2026-12-31', validUntil: '2026-01-01' },
      { validUntil: '2026-02-31' },
      { stock: 3 },
    ])
      await call('put', `${f.path}/supplier-offers`, {
        ...f.data,
        expectedVersion: 1,
        ...fields,
      }).expect(400);
    await call('put', `${f.path}/supplier-offers`, f.data).expect(409);
  });
  it('allows one version winner on concurrent supplier edits', async () => {
    const f = await fixture();
    const r = await Promise.all(
      ['15', '16'].map((unitPrice) =>
        call('put', `${f.path}/supplier-offers`, { ...f.data, expectedVersion: 1, unitPrice }),
      ),
    );
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
  });
  it('copies selected conditions from the server, preserving exact quantities and totals', async () => {
    const f = await fixture();
    const r = (await call('post', 'purchasing/orders', f.orderData).expect(201)).body;
    expect(r.lines[0].supplierTermsSnapshot).toMatchObject({
      supplierReference: 'FOU-P100',
      version: 1,
      unitPrice: '12.3456',
      unit: 'EA',
      minimumQuantity: '6',
      orderMultiple: '3',
    });
    expect(r.total).toBe('74.07');
    await call('post', 'purchasing/orders', {
      ...f.orderData,
      lines: [{ ...f.orderData.lines[0], supplierTermsSnapshot: { supplierReference: 'Forged' } }],
    }).expect(400);
  });
  it.each([{ quantity: 3 }, { quantity: 7 }, { unitPrice: 1 }, { supplierOfferVersion: 2 }])(
    'rejects incompatible chosen terms %j',
    async (change) => {
      const f = await fixture();
      const r = await call('post', 'purchasing/orders', {
        ...f.orderData,
        lines: [{ ...f.orderData.lines[0], ...change }],
      });
      expect([400, 409]).toContain(r.status);
    },
  );
  it('never chooses a reference implicitly or converts currencies/units', async () => {
    const f = await fixture();
    await call('post', 'purchasing/orders', { ...f.orderData, currency: 'USD' }).expect(409);
    const manual = (
      await call('post', 'purchasing/orders', {
        ...f.orderData,
        currency: 'USD',
        lines: [{ catalogItemId: f.item.id, quantity: 1, unitPrice: 7 }],
      }).expect(201)
    ).body;
    expect(manual.lines[0].supplierTermsSnapshot).toBeNull();
    expect(manual.lines[0].unitSnapshot).toBe('EA');
    await call('post', 'purchasing/orders', {
      ...f.orderData,
      lines: [
        { catalogItemId: f.item.id, quantity: 6, unitPrice: 12.3456, supplierOfferVersion: 1 },
      ],
    }).expect(400);
  });
  it('blocks stale drafts at confirmation, allows explicit refreshed choice, and freezes engaged history', async () => {
    const f = await fixture();
    let order = (await call('post', 'purchasing/orders', f.orderData).expect(201)).body;
    await call('put', `${f.path}/supplier-offers`, {
      ...f.data,
      expectedVersion: 1,
      terms: 'Nouvelle consigne',
    }).expect(200);
    await call('post', `purchasing/orders/${order.id}/transition`, {
      status: 'CONFIRMED',
      expectedUpdatedAt: order.updatedAt,
    }).expect(409);
    order = (
      await call('patch', `purchasing/orders/${order.id}`, {
        ...f.orderData,
        expectedUpdatedAt: order.updatedAt,
        lines: [{ ...f.orderData.lines[0], supplierOfferVersion: 2 }],
      }).expect(200)
    ).body;
    order = (
      await call('post', `purchasing/orders/${order.id}/transition`, {
        status: 'CONFIRMED',
        expectedUpdatedAt: order.updatedAt,
      }).expect(201)
    ).body;
    const snapshot = order.lines[0].supplierTermsSnapshot;
    await call('put', `${f.path}/supplier-offers`, {
      ...f.data,
      expectedVersion: 2,
      active: false,
      unitPrice: '99',
    }).expect(200);
    expect(
      (await call('get', `purchasing/orders/${order.id}`).expect(200)).body.lines[0]
        .supplierTermsSnapshot,
    ).toEqual(snapshot);
    await call('patch', `purchasing/orders/${order.id}`, {
      ...f.orderData,
      expectedUpdatedAt: order.updatedAt,
    }).expect(409);
    expect(await db.stockMovement.count({ where: { tenantId: tenants[0].id } })).toBe(0);
  });
  it('rechecks validity and activity at confirmation without rewriting the snapshot', async () => {
    const f = await fixture();
    const order = (await call('post', 'purchasing/orders', f.orderData).expect(201)).body;
    await call('put', `${f.path}/supplier-offers`, {
      ...f.data,
      expectedVersion: 1,
      validUntil: '2000-01-01',
    }).expect(200);
    await call('post', 'purchasing/orders', {
      ...f.orderData,
      lines: [{ ...f.orderData.lines[0], supplierOfferVersion: 2 }],
    }).expect(409);
    await call('post', `purchasing/orders/${order.id}/transition`, {
      status: 'CONFIRMED',
      expectedUpdatedAt: order.updatedAt,
    }).expect(409);
    expect((await call('get', `purchasing/orders/${order.id}`).expect(200)).body.status).toBe(
      'DRAFT',
    );
  });
  it('keeps manual historical drafts confirmable without any profile or terms', async () => {
    const f = await fixture();
    const order = (
      await call('post', 'purchasing/orders', {
        ...f.orderData,
        lines: [{ catalogItemId: f.item.id, quantity: 1, unitPrice: 1 }],
      }).expect(201)
    ).body;
    await call('post', `purchasing/orders/${order.id}/transition`, {
      status: 'CONFIRMED',
      expectedUpdatedAt: order.updatedAt,
    }).expect(201);
  });
  it('checks fractional order multiples with exact decimal arithmetic', async () => {
    const f = await fixture();
    await call('put', `${f.path}/supplier-offers`, {
      ...f.data,
      expectedVersion: 1,
      minimumQuantity: '0.1',
      orderMultiple: '0.1',
    }).expect(200);
    await call('post', 'purchasing/orders', {
      ...f.orderData,
      lines: [{ ...f.orderData.lines[0], quantity: 0.3, supplierOfferVersion: 2 }],
    }).expect(201);
    await call('post', 'purchasing/orders', {
      ...f.orderData,
      lines: [{ ...f.orderData.lines[0], quantity: 0.3001, supplierOfferVersion: 2 }],
    }).expect(400);
  });
  it('rechecks expiry and supplier activation even if the selected version is unchanged', async () => {
    const f = await fixture();
    const order = (await call('post', 'purchasing/orders', f.orderData).expect(201)).body;
    // Simulate a date rolling over without a reference edit; no production writer bypass.
    await db.catalogSupplierOffer.updateMany({
      where: { tenantId: tenants[0].id, id: f.offer.id },
      data: { validUntil: new Date('2000-01-01') },
    });
    const r = await call('post', `purchasing/orders/${order.id}/transition`, {
      status: 'CONFIRMED',
      expectedUpdatedAt: order.updatedAt,
    }).expect(409);
    expect(r.body.message).toContain('hors validité');
    await db.catalogSupplierOffer.updateMany({
      where: { tenantId: tenants[0].id, id: f.offer.id },
      data: { validUntil: null },
    });
    await call('patch', `purchasing/data/suppliers/${f.supplier.id}`, {
      expectedUpdatedAt: f.supplier.updatedAt,
      active: false,
    }).expect(200);
    await call('post', `purchasing/orders/${order.id}/transition`, {
      status: 'CONFIRMED',
      expectedUpdatedAt: order.updatedAt,
    }).expect(400);
    expect(
      (await call('get', `purchasing/orders/${order.id}`).expect(200)).body.lines[0]
        .supplierTermsSnapshot,
    ).toEqual(order.lines[0].supplierTermsSnapshot);
  });
});
