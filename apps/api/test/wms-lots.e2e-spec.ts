import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { MODULE_CATALOG, PERMISSION_CATALOG, StockMovementType } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { EmailService } from '../src/core/email/email.service';
import { InventoryService } from '../src/modules/wms/inventory/inventory.service';
import { MrpService } from '../src/modules/manufacturing/mrp/mrp.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { DocumentsService } from '../src/core/documents/documents.service';

describe('WMS explicit lots I2a', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `wms-lots-${Date.now()}`;
  const tenants: { id: string; tokens: Record<string, string> }[] = [];
  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
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
    for (let i = 0; i < 5; i++) {
      const slug = `${prefix}-${i}`,
        t = await db.tenant.create({ data: { slug, name: slug } }),
        tokens: Record<string, string> = {};
      for (const m of MODULE_CATALOG.filter(
        (m) =>
          ['wms', 'purchasing', 'catalog', 'services', 'manufacturing', 'quality'].includes(
            m.key,
          ) &&
          (i !== 1 || m.key === 'wms') &&
          (i !== 2 || m.key === 'purchasing') &&
          (i !== 3 || ['wms', 'services'].includes(m.key)) &&
          (i !== 4 || ['wms', 'manufacturing'].includes(m.key)),
      )) {
        const def = await db.moduleDefinition.upsert({
          where: { key: m.key },
          create: m,
          update: m,
        });
        await db.tenantModule.create({ data: { tenantId: t.id, moduleId: def.id, enabled: true } });
      }
      for (const [key, keys] of Object.entries({
        manager: PERMISSION_CATALOG.map((p) => p.key),
        manager2: PERMISSION_CATALOG.map((p) => p.key),
        'stock-manager': ['wms.read', 'wms.manage'],
        'stock-release': ['wms.read', 'wms.manage', 'wms.lots.release'],
        'quality-only': ['quality.read', 'quality.manage'],
        reader: ['wms.read', 'purchasing.read'],
        'service-reader': ['services.read'],
        'manufacturing-reader': ['manufacturing.read', 'wms.read'],
      })) {
        const ps = await db.permission.findMany({ where: { key: { in: keys } } });
        const role = await db.role.create({
          data: {
            tenantId: t.id,
            key,
            name: key,
            permissions: { create: ps.map((p) => ({ permissionId: p.id })) },
          },
        });
        const email = `${key}@${slug}.test`;
        await db.user.create({
          data: {
            tenantId: t.id,
            email,
            firstName: key,
            lastName: 'Lots',
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
      tenants.push({ id: t.id, tokens });
    }
    console.log(`WMS_LOTS_TENANT=${prefix}-0`);
    console.log(`SERVICES_LOTS_TENANT=${prefix}-3`);
    console.log(`MANUFACTURING_LOTS_TENANT=${prefix}-4`);
  }, 120000);
  afterAll(async () => app?.close());
  async function purchaseReturnFixture() {
    const f = await fixture();
    const item = (
      await call('post', 'purchasing/data/items', {
        code: randomUUID(),
        name: 'Article retour',
        kind: 'GOODS',
        unit: 'EA',
      }).expect(201)
    ).body;
    const supplier = (
      await call('post', 'purchasing/data/suppliers', {
        code: randomUUID(),
        name: 'Fournisseur retour',
      }).expect(201)
    ).body;
    await call('patch', `purchasing/items/${item.id}/stock-link`, {
      wmsItemId: f.item.id,
      expectedUpdatedAt: item.updatedAt,
    }).expect(200);
    const draft = (
      await call('post', 'purchasing/orders', {
        supplierId: supplier.id,
        currency: 'CAD',
        lines: [{ catalogItemId: item.id, quantity: 12, unitPrice: 2.25 }],
      }).expect(201)
    ).body;
    const order = (
      await call('post', `purchasing/orders/${draft.id}/transition`, {
        status: 'CONFIRMED',
        expectedUpdatedAt: draft.updatedAt,
      }).expect(201)
    ).body;
    const receiptBody = {
      operationKey: randomUUID(),
      expectedUpdatedAt: order.updatedAt,
      locationId: f.site.id,
      reference: 'BL-RETOUR',
      lines: [{ orderLineId: order.lines[0].id, binId: f.a.id, quantity: 12, lotId: f.lot.id }],
    };
    const receipt = (
      await call('post', `purchasing/orders/${order.id}/receipts`, receiptBody).expect(201)
    ).body;
    const sourcePath = `wms/stock-exits/purchase-sources?${new URLSearchParams({ supplierId: supplier.id, itemId: f.item.id, lotId: f.lot.id, binId: f.a.id })}`;
    const source = (await call('get', sourcePath).expect(200)).body.items[0];
    expect(source).toBeDefined();
    const body = {
      ...exitBody(f, '5'),
      kind: 'SUPPLIER_RETURN',
      supplierId: supplier.id,
      reference: 'RMA-TEST',
      destination: '100 rue du retour, Québec',
      purchaseSourceId: source.id,
      purchaseSourceToken: source.token,
    };
    return { ...f, supplier, order, receipt, sourcePath, source, body };
  }
  it('I2j captures an explicit purchase receipt, hides commercial data and never reverses received quantities', async () => {
    const f = await purchaseReturnFixture();
    const made = (await call('post', 'wms/stock-exits', f.body).expect(201)).body;
    expect((await call('post', 'wms/stock-exits', f.body).expect(201)).body).toEqual({
      ...made,
      replayed: true,
    });
    const row = (await call('get', `wms/stock-exits/${made.id}`).expect(200)).body;
    expect(row).not.toHaveProperty('purchaseSourceId');
    expect(row).not.toHaveProperty('purchaseSnapshot');
    const view = (await call('get', `wms/stock-exits/${made.id}/purchase`).expect(200)).body;
    expect(view.snapshot).toMatchObject({
      orderId: f.order.id,
      unitPrice: '2.25',
      receivedQuantity: '12',
      currency: 'CAD',
    });
    expect(
      (
        await call('get', `wms/stock-exits/${made.id}/purchase`, undefined, 'stock-manager').expect(
          200,
        )
      ).body,
    ).toEqual({ available: false });
    await call('get', f.sourcePath, undefined, 'stock-manager').expect(403);
    await call('post', 'wms/stock-exits', f.body, 'stock-manager').expect(403);
    await call(
      'get',
      `wms/stock-exits?purchaseOrderId=${f.order.id}`,
      undefined,
      'stock-manager',
    ).expect(403);
    await call('get', `wms/stock-exits/${made.id}/review`, undefined, 'stock-manager').expect(403);
    const post = await exitPost(made.id);
    await call('post', `wms/stock-exits/${made.id}/post`, post).expect(201);
    expect(
      (await call('post', `wms/stock-exits/${made.id}/post`, post).expect(201)).body.replayed,
    ).toBe(true);
    const received = (await call('get', `purchasing/orders/${f.order.id}/receipts`).expect(200))
      .body.items[0];
    expect(received.lines[0].receiptLine.qty).toBe('12');
    const source = (await call('get', f.sourcePath).expect(200)).body.items[0];
    expect(source.remaining).toBe('7');
    const filtered = (
      await call('get', `wms/stock-exits?purchaseOrderId=${f.order.id}`).expect(200)
    ).body;
    expect(filtered.items.map((r: any) => r.id)).toContain(made.id);
    await call('get', `wms/stock-exits/${made.id}/purchase`, undefined, 'manager', 1)
      .expect(200)
      .expect({ available: false });
    await assertBalances(f);
  });
  it('I2j stale allocation and concurrent drafts cannot over-return a receipt; cancellation releases only documentary allocation', async () => {
    const f = await purchaseReturnFixture();
    const results = await Promise.all([
      call('post', 'wms/stock-exits', { ...f.body, quantity: '8' }),
      call('post', 'wms/stock-exits', { ...f.body, operationKey: randomUUID(), quantity: '8' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const made = results.find((r) => r.status === 201)!.body;
    let s = (await call('get', f.sourcePath).expect(200)).body.items[0];
    expect(s.remaining).toBe('4');
    await call('post', 'wms/stock-exits', {
      ...f.body,
      operationKey: randomUUID(),
      purchaseSourceToken: s.token,
      quantity: '5',
    }).expect(409);
    const row = (await call('get', `wms/stock-exits/${made.id}`).expect(200)).body;
    await call('post', `wms/stock-exits/${made.id}/cancel`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: row.updatedAt,
      reason: 'Autorisation retirée',
    }).expect(201);
    s = (await call('get', f.sourcePath).expect(200)).body.items[0];
    expect(s.remaining).toBe('12');
    await call('post', 'wms/stock-exits', {
      ...f.body,
      operationKey: randomUUID(),
      purchaseSourceToken: s.token,
      quantity: '12',
    }).expect(201);
    expect(
      await db.stockMovement.count({
        where: { tenantId: f.tenantId, lotId: f.lot.id, type: 'SUPPLIER_RETURN' },
      }),
    ).toBe(0);
  });
  it('I2j rejects foreign/mismatched purchase sources and permits the same lot moved within its receipt site', async () => {
    const f = await purchaseReturnFixture(),
      other = await fixture();
    await call('post', 'wms/stock-exits', { ...f.body, purchaseSourceId: 'foreign' }).expect(404);
    await call('post', 'wms/stock-exits', { ...f.body, binId: other.a.id }).expect(409);
    await call('post', 'wms/stock-exits', {
      ...f.body,
      lotId: other.lot.id,
      itemId: other.item.id,
    }).expect(409);
    await call('post', 'wms/stock-exits', { ...f.body, purchaseSourceToken: undefined }).expect(
      400,
    );
    await call('post', 'wms/stock-exits', {
      ...exitBody(f),
      purchaseSourceToken: f.source.token,
    }).expect(400);
    const otherSupplier = (
      await call('post', 'wms/data/suppliers', {
        code: randomUUID(),
        name: 'Autre fournisseur',
      }).expect(201)
    ).body;
    await call('post', 'wms/stock-exits', { ...f.body, supplierId: otherSupplier.id }).expect(409);
    await call('post', 'wms/inventory/move', {
      operationKey: randomUUID(),
      itemId: f.item.id,
      lotId: f.lot.id,
      fromBinId: f.a.id,
      toBinId: f.b.id,
      qty: 5,
    }).expect(201);
    const r = (await call('post', 'wms/stock-exits', { ...f.body, binId: f.b.id }).expect(201))
      .body;
    await call('post', `wms/stock-exits/${r.id}/post`, await exitPost(r.id)).expect(201);
    await assertBalances(f);
  });
  it('I2j incomplete historical receipt proof is flagged without blocking another valid receipt', async () => {
    const f = await purchaseReturnFixture();
    const line = await db.supplierOrderLine.findFirstOrThrow({
      where: { tenantId: f.tenantId, orderId: f.order.id },
    });
    const draft = (
      await call('post', 'purchasing/orders', {
        supplierId: f.supplier.id,
        currency: 'CAD',
        lines: [{ catalogItemId: line.catalogItemId, quantity: 2, unitPrice: 2.25 }],
      }).expect(201)
    ).body;
    const order = (
      await call('post', `purchasing/orders/${draft.id}/transition`, {
        status: 'CONFIRMED',
        expectedUpdatedAt: draft.updatedAt,
      }).expect(201)
    ).body;
    await call('post', `purchasing/orders/${order.id}/receipts`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: order.updatedAt,
      locationId: f.site.id,
      reference: 'BL-PREUVE-VALIDE',
      lines: [{ orderLineId: order.lines[0].id, binId: f.a.id, quantity: 2, lotId: f.lot.id }],
    }).expect(201);
    const old = await db.supplierReceiptLine.findFirstOrThrow({
      where: { tenantId: f.tenantId, id: f.source.id },
      include: { supplierReceipt: true },
    });
    await db.stockMovement.updateMany({
      where: { tenantId: f.tenantId, refType: 'receipt', refId: old.supplierReceipt.receiptId },
      data: { unitSnapshot: null },
    });
    const rows = (await call('get', f.sourcePath).expect(200)).body.items;
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.id === f.source.id)).toMatchObject({
      token: null,
      remaining: null,
    });
    const valid = rows.find((r: any) => r.token);
    expect(valid).toBeDefined();
    await call('post', 'wms/stock-exits', {
      ...f.body,
      quantity: '1',
      purchaseSourceId: valid.id,
      purchaseSourceToken: valid.token,
    }).expect(201);
    await call('post', 'wms/stock-exits', { ...f.body, operationKey: randomUUID() }).expect(409);
  });
  const proofFile = Buffer.from('%PDF-1.7\nProof fixture');
  async function supplierReportFixture(tenant = 1) {
    const f = await fixture(tenant);
    await adjust(f, 10);
    const supplier = (
      await call(
        'post',
        'wms/data/suppliers',
        { code: randomUUID(), name: 'Suivi fournisseur autonome' },
        'manager',
        tenant,
      ).expect(201)
    ).body;
    const exit = (
      await call(
        'post',
        'wms/stock-exits',
        {
          ...exitBody(f, '5.125'),
          kind: 'SUPPLIER_RETURN',
          supplierId: supplier.id,
          reference: 'RMA-REPORT',
          destination: '100 rue du Retour, Québec',
        },
        'manager',
        tenant,
      ).expect(201)
    ).body;
    await call(
      'post',
      `wms/stock-exits/${exit.id}/post`,
      await exitPost(exit.id, tenant),
      'manager',
      tenant,
    ).expect(201);
    const proof = (
      await uploadProof(exit.id, randomUUID(), 'Constat du fournisseur', 'manager', tenant).expect(
        201,
      )
    ).body;
    const path = `wms/stock-exits/${exit.id}/supplier-reports`;
    const body = {
      operationKey: randomUUID(),
      expectedRevision: 0,
      received: '3.125',
      accepted: '2',
      refused: '0.125',
      evidenceId: proof.id,
      reportedAt: new Date().toISOString(),
      reference: 'CR-RETOUR',
      note: 'Trois unités reçues et tri en cours.',
    };
    return { ...f, supplier, exit, proof, path, body, tenant };
  }
  it('I2k cumulative partial receipts and corrections preserve stock and original exit proof, WMS alone', async () => {
    const f = await supplierReportFixture();
    const original = await db.wmsStockExit.findFirstOrThrow({
      where: { tenantId: f.tenantId, id: f.exit.id },
    });
    const movements = await db.stockMovement.findMany({
      where: { tenantId: f.tenantId, itemId: f.item.id },
      orderBy: { id: 'asc' },
    });
    expect((await call('get', f.path, undefined, 'reader', 1).expect(200)).body).toMatchObject({
      revision: 0,
      current: null,
      balance: { awaitingReceipt: '5.125', awaitingDecision: '0' },
    });
    const first = (await call('post', f.path, f.body, 'manager', 1).expect(201)).body;
    expect(first).toMatchObject({ revision: 1, replayed: false });
    const firstRead = (await call('get', f.path, undefined, 'reader', 1).expect(200)).body;
    expect(firstRead.balance).toEqual({ awaitingReceipt: '2', awaitingDecision: '1' });
    expect(firstRead.current).not.toHaveProperty('fingerprint');
    expect(firstRead.current).not.toHaveProperty('operationKey');
    expect(firstRead.current).not.toHaveProperty('tenantId');
    const next = {
      ...f.body,
      operationKey: randomUUID(),
      expectedRevision: 1,
      received: '5.125',
      accepted: '4',
      refused: '1.125',
    };
    await call('post', f.path, next, 'manager', 1).expect(201);
    const correction = {
      ...next,
      operationKey: randomUUID(),
      expectedRevision: 2,
      accepted: '3',
      refused: '2.125',
    };
    await call('post', f.path, correction, 'manager', 1).expect(400);
    await call(
      'post',
      f.path,
      { ...correction, correctionReason: 'Le fournisseur a corrigé son tri.' },
      'manager',
      1,
    ).expect(201);
    const read = (
      await call('get', `${f.path}?page=2&pageSize=1`, undefined, 'reader', 1).expect(200)
    ).body;
    expect(read).toMatchObject({
      revision: 3,
      balance: { awaitingReceipt: '0', awaitingDecision: '0' },
      history: { total: 3, page: 2, pageSize: 1 },
    });
    expect(read.history.items[0].revision).toBe(2);
    expect(read.current).toMatchObject({
      accepted: '3',
      refused: '2.125',
      correctionReason: 'Le fournisseur a corrigé son tri.',
    });
    expect(
      await db.wmsStockExit.findFirst({ where: { tenantId: f.tenantId, id: f.exit.id } }),
    ).toEqual(original);
    expect(
      await db.stockMovement.findMany({
        where: { tenantId: f.tenantId, itemId: f.item.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(movements);
    await assertBalances(f);
    expect((await call('post', f.path, f.body, 'manager', 1).expect(201)).body).toMatchObject({
      id: first.id,
      revision: 1,
      replayed: true,
    });
    expect(
      (
        await call(
          'get',
          `${f.path}/requests/${f.body.operationKey}`,
          undefined,
          'manager',
          1,
        ).expect(200)
      ).body.id,
    ).toBe(first.id);
    await call('get', `${f.path}/requests/${f.body.operationKey}`, undefined, 'manager2', 1).expect(
      404,
    );
  });
  it('I2k replay is actor/body-bound and concurrent revisions never overwrite one another', async () => {
    const f = await supplierReportFixture();
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => call('post', f.path, f.body, 'manager', 1)),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    await call(
      'post',
      f.path,
      { ...f.body, note: 'Un autre compte rendu différent' },
      'manager',
      1,
    ).expect(409);
    await call('post', f.path, f.body, 'manager2', 1).expect(409);
    const races = await Promise.all(
      ['4', '5'].map((received) =>
        call(
          'post',
          f.path,
          { ...f.body, operationKey: randomUUID(), expectedRevision: 1, received },
          'manager',
          1,
        ),
      ),
    );
    expect(races.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db.supplierReturnReport.count({
        where: { tenantId: f.tenantId, stockExitId: f.exit.id },
      }),
    ).toBe(2);
  });
  it('I2k rejects invalid quantities, dates and unsupported corrections without consuming the request', async () => {
    const f = await supplierReportFixture();
    for (const patch of [
      { received: '6' },
      { accepted: '3.125', refused: '0.001' },
      { received: '-1' },
      { accepted: '0.0001' },
      { reportedAt: '2026-01-01T00:00:00Z' },
      { reportedAt: new Date(Date.now() + 3600000).toISOString() },
      { reportedAt: '2026-09-26' },
      { note: '          ' },
      { reference: '   ' },
      { correctionReason: '          ' },
      { expectedRevision: -1 },
      { tenantId: f.tenantId },
    ])
      await call('post', f.path, { ...f.body, ...patch }, 'manager', 1).expect(400);
    expect(
      await db.supplierReturnReport.count({
        where: { tenantId: f.tenantId, stockExitId: f.exit.id },
      }),
    ).toBe(0);
    await call('post', f.path, f.body, 'manager', 1).expect(201);
  });
  it('I2k enforces permissions, module, tenant and exact evidence ownership', async () => {
    const f = await supplierReportFixture(),
      other = await supplierReportFixture();
    await call('post', f.path, f.body, 'reader', 1).expect(403);
    await call('post', f.path, f.body, 'stock-manager', 1).expect(403);
    await call('post', f.path, f.body, 'manager', 2).expect(403);
    await call('post', f.path, f.body, 'manager', 0).expect(404);
    await call('get', f.path, undefined, 'reader', 0).expect(404);
    await call('post', f.path, { ...f.body, evidenceId: other.proof.id }, 'manager', 1).expect(404);
    await call('post', f.path, f.body, 'manager', 1).expect(201);
    const mod = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId: f.tenantId, moduleId: mod.id } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(f.tenantId);
    try {
      await call('post', f.path, f.body, 'manager', 1).expect(403);
    } finally {
      await db.tenantModule.update({
        where: { tenantId_moduleId: { tenantId: f.tenantId, moduleId: mod.id } },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(f.tenantId);
    }
  });
  it('I2k cannot follow a disposal, draft or cancelled return and cannot edit history', async () => {
    const f = await supplierReportFixture();
    const draft = (
      await call('post', 'wms/stock-exits', exitBody(f, '1'), 'manager', 1).expect(201)
    ).body;
    const path = `wms/stock-exits/${draft.id}/supplier-reports`;
    await call('get', path, undefined, 'manager', 1).expect(409);
    await call('post', path, f.body, 'manager', 1).expect(409);
    await call(
      'post',
      `wms/stock-exits/${draft.id}/post`,
      await exitPost(draft.id, 1),
      'manager',
      1,
    ).expect(201);
    await call('post', path, f.body, 'manager', 1).expect(409);
    const cancelled = (
      await call(
        'post',
        'wms/stock-exits',
        {
          ...exitBody(f, '1'),
          kind: 'SUPPLIER_RETURN',
          supplierId: f.supplier.id,
          reference: 'RMA-CANCEL',
          destination: 'Destination du retour annulé',
        },
        'manager',
        1,
      ).expect(201)
    ).body;
    await call(
      'post',
      `wms/stock-exits/${cancelled.id}/cancel`,
      {
        operationKey: randomUUID(),
        expectedUpdatedAt: (
          await call('get', `wms/stock-exits/${cancelled.id}`, undefined, 'manager', 1).expect(200)
        ).body.updatedAt,
        reason: 'Retour annulé avant remise',
      },
      'manager',
      1,
    ).expect(201);
    await call(
      'post',
      `wms/stock-exits/${cancelled.id}/supplier-reports`,
      f.body,
      'manager',
      1,
    ).expect(409);
    const r = (await call('post', f.path, f.body, 'manager', 1).expect(201)).body;
    await call('patch', `${f.path}/${r.id}`, { received: '0' }, 'manager', 1).expect(404);
    await call('delete', `${f.path}/${r.id}`, undefined, 'manager', 1).expect(404);
  });
  it('I2k physical follow-up on a linked return remains independent from commercial module access', async () => {
    const f = await purchaseReturnFixture();
    const exit = (await call('post', 'wms/stock-exits', f.body).expect(201)).body;
    await call('post', `wms/stock-exits/${exit.id}/post`, await exitPost(exit.id)).expect(201);
    const proof = (await uploadProof(exit.id, randomUUID()).expect(201)).body;
    const mod = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'purchasing' } });
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId: f.tenantId, moduleId: mod.id } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(f.tenantId);
    try {
      await call('post', `wms/stock-exits/${exit.id}/supplier-reports`, {
        operationKey: randomUUID(),
        expectedRevision: 0,
        received: '1',
        accepted: '0',
        refused: '0',
        evidenceId: proof.id,
        reportedAt: new Date().toISOString(),
        reference: 'CR-IND',
        note: 'Constat physique sans données commerciales',
      }).expect(201);
      const r = (
        await call(
          'get',
          `wms/stock-exits/${exit.id}/supplier-reports`,
          undefined,
          'stock-manager',
        ).expect(200)
      ).body;
      expect(r.current.received).toBe('1');
      expect(JSON.stringify(r)).not.toContain(f.order.number);
      expect((await call('get', `wms/stock-exits/${exit.id}/purchase`).expect(200)).body).toEqual({
        available: false,
      });
    } finally {
      await db.tenantModule.update({
        where: { tenantId_moduleId: { tenantId: f.tenantId, moduleId: mod.id } },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(f.tenantId);
    }
  });
  function uploadProof(
    id: string,
    key: string,
    caption = 'Bon de retour vérifié',
    role = 'manager',
    tenant = 0,
    buffer = proofFile,
  ) {
    return call('post', `wms/stock-exits/${id}/evidence`, undefined, role, tenant)
      .field('operationKey', key)
      .field('caption', caption)
      .attach('file', buffer, { filename: 'preuve.pdf', contentType: 'application/pdf' });
  }
  it('I2j evidence exact concurrent replay, append-only history and protected download preserve stock proof', async () => {
    const f = await fixture();
    await adjust(f, 5);
    const made = (await call('post', 'wms/stock-exits', exitBody(f, '2')).expect(201)).body;
    const row = (await call('get', `wms/stock-exits/${made.id}`).expect(200)).body;
    const key = randomUUID(),
      results = await Promise.all(Array.from({ length: 3 }, () => uploadProof(made.id, key)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
    const proof = results[0].body;
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect((await call('get', `wms/stock-exits/${made.id}`).expect(200)).body.updatedAt).toBe(
      row.updatedAt,
    );
    expect(
      (await call('get', `wms/stock-exits/${made.id}/evidence/requests/${key}`).expect(200)).body
        .id,
    ).toBe(proof.id);
    await call(
      'get',
      `wms/stock-exits/${made.id}/evidence/requests/${key}`,
      undefined,
      'manager2',
    ).expect(404);
    await uploadProof(made.id, key, 'Changed caption').expect(409);
    await uploadProof(made.id, key, undefined, 'manager2').expect(409);
    const stored = await db.wmsStockExitEvidence.findFirstOrThrow({
      where: { tenantId: f.tenantId, id: proof.id },
    });
    await call('get', `documents/${stored.documentId}/download`).expect(403);
    await call('get', `documents/${stored.documentId}/download-url`).expect(403);
    await call('delete', `documents/${stored.documentId}`).expect(403);
    await call('get', `documents?entityType=wms-stock-exit-evidence&entityId=${made.id}`).expect(
      403,
    );
    const dl = await call(
      'get',
      `wms/stock-exits/${made.id}/evidence/${proof.id}/download`,
      undefined,
      'reader',
    ).expect(200);
    expect(dl.headers['content-type']).toContain('application/octet-stream');
    expect(dl.body).toEqual(proofFile);
    await call(
      'get',
      `wms/stock-exits/${made.id}/evidence/${proof.id}/download`,
      undefined,
      'manager',
      1,
    ).expect(404);
    await call('post', `wms/stock-exits/${made.id}/post`, await exitPost(made.id)).expect(201);
    const frozen = (await call('get', `wms/stock-exits/${made.id}`).expect(200)).body;
    await uploadProof(made.id, randomUUID(), 'Photo après remise physique').expect(201);
    const history = (await call('get', `wms/stock-exits/${made.id}/evidence`).expect(200)).body;
    expect(history.map((x: any) => x.recordedStatus)).toEqual(['DRAFT', 'POSTED']);
    expect(JSON.stringify(history)).not.toMatch(/storageKey|documentId|fingerprint|operationKey/);
    expect((await call('get', `wms/stock-exits/${made.id}`).expect(200)).body).toEqual(frozen);
    expect(
      await db.document.count({
        where: { tenantId: f.tenantId, entityType: 'wms-stock-exit-evidence', entityId: made.id },
      }),
    ).toBe(2);
    await assertBalances(f);
  });
  it('I2j file formats, foreign tenant, permissions and cancelled dossiers are guarded without consuming a key', async () => {
    const f = await fixture(1);
    const made = (await call('post', 'wms/stock-exits', exitBody(f), 'manager', 1).expect(201))
      .body;
    const key = randomUUID();
    await uploadProof(made.id, key, 'Justificatif', 'manager', 1, Buffer.from('not a pdf')).expect(
      400,
    );
    await uploadProof(made.id, key, 'Justificatif', 'reader', 1).expect(403);
    await uploadProof(made.id, key).expect(404);
    await uploadProof(made.id, key, 'Justificatif', 'manager', 1).expect(201);
    const row = (
      await call('get', `wms/stock-exits/${made.id}`, undefined, 'manager', 1).expect(200)
    ).body;
    await call(
      'post',
      `wms/stock-exits/${made.id}/cancel`,
      { operationKey: randomUUID(), expectedUpdatedAt: row.updatedAt, reason: 'Erreur vérifiée' },
      'manager',
      1,
    ).expect(201);
    await uploadProof(made.id, randomUUID(), 'Justificatif', 'manager', 1).expect(409);
    expect(
      (await uploadProof(made.id, key, 'Justificatif', 'manager', 1).expect(201)).body.replayed,
    ).toBe(true);
    await call(
      'post',
      'documents/presign-upload',
      {
        entityType: 'wms-stock-exit-evidence',
        entityId: made.id,
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
      },
      'manager',
      1,
    ).expect(403);
  });
  it('I2j linked posting and exact replay recheck purchasing activation, while WMS history stays available', async () => {
    const f = await purchaseReturnFixture(),
      made = (await call('post', 'wms/stock-exits', f.body).expect(201)).body,
      post = await exitPost(made.id);
    const module = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'purchasing' } });
    const set = async (enabled: boolean) => {
      await db.tenantModule.updateMany({
        where: { tenantId: f.tenantId, moduleId: module.id },
        data: { enabled },
      });
      app.get(TenantModulesCacheService).invalidate(f.tenantId);
    };
    await set(false);
    try {
      await call('post', 'wms/stock-exits', f.body).expect(403);
      await call('post', `wms/stock-exits/${made.id}/post`, post).expect(403);
      await call('get', `wms/stock-exits/${made.id}`).expect(200);
      await call('get', `wms/stock-exits/${made.id}/purchase`)
        .expect(200)
        .expect({ available: false });
    } finally {
      await set(true);
    }
    await call('post', `wms/stock-exits/${made.id}/post`, post).expect(201);
    await set(false);
    try {
      await call('post', `wms/stock-exits/${made.id}/post`, post).expect(403);
    } finally {
      await set(true);
    }
  });
  it('I2j concurrent cancellation during upload discards the unlinked file without changing stock or consuming the evidence key', async () => {
    const f = await fixture(),
      made = (await call('post', 'wms/stock-exits', exitBody(f)).expect(201)).body;
    const row = (await call('get', `wms/stock-exits/${made.id}`).expect(200)).body;
    const docs = app.get(DocumentsService),
      original = docs.upload.bind(docs),
      key = randomUUID();
    const spy = jest
      .spyOn(docs, 'upload')
      .mockImplementationOnce(async (...args: Parameters<typeof docs.upload>) => {
        const doc = await original(...args);
        await call('post', `wms/stock-exits/${made.id}/cancel`, {
          operationKey: randomUUID(),
          expectedUpdatedAt: row.updatedAt,
          reason: 'Annulation pendant transfert',
        }).expect(201);
        return doc;
      });
    try {
      await uploadProof(made.id, key).expect(409);
    } finally {
      spy.mockRestore();
    }
    expect(
      await db.wmsStockExitEvidence.count({ where: { tenantId: f.tenantId, operationKey: key } }),
    ).toBe(0);
    expect(
      await db.document.count({
        where: { tenantId: f.tenantId, entityType: 'wms-stock-exit-evidence', entityId: made.id },
      }),
    ).toBe(0);
  });
  it('I2j evidence limits are enforced and replay remains valid when the dossier is full', async () => {
    const f = await fixture(),
      made = (await call('post', 'wms/stock-exits', exitBody(f)).expect(201)).body,
      first = randomUUID();
    await uploadProof(
      made.id,
      randomUUID(),
      'Fichier volumineux',
      'manager',
      0,
      Buffer.alloc(10 * 1024 * 1024 + 1),
    ).expect(413);
    await uploadProof(made.id, first).expect(201);
    for (let i = 1; i < 30; i++) await uploadProof(made.id, randomUUID()).expect(201);
    await uploadProof(made.id, randomUUID()).expect(409);
    expect((await uploadProof(made.id, first).expect(201)).body.replayed).toBe(true);
    expect(
      (await call('get', `wms/stock-exits/${made.id}/evidence`).expect(200)).body,
    ).toHaveLength(30);
  });
  function exitBody(f: Awaited<ReturnType<typeof fixture>>, quantity = '2.125') {
    return {
      operationKey: randomUUID(),
      kind: 'DISPOSAL',
      itemId: f.item.id,
      lotId: f.lot.id,
      binId: f.a.id,
      quantity,
      reason: 'Matière endommagée vérifiée',
    };
  }
  async function exitPost(id: string, tenant = 0) {
    const review = (
      await call('get', `wms/stock-exits/${id}/review`, undefined, 'manager', tenant).expect(200)
    ).body;
    return {
      operationKey: randomUUID(),
      expectedUpdatedAt: review.expectedUpdatedAt,
      reviewToken: review.reviewToken,
      completionNote: 'Sortie physique contrôlée par le responsable.',
      confirmed: true,
    };
  }
  it('I2i partial disposal preserves quarantine, atomically records evidence and replays exactly', async () => {
    const f = await fixture();
    await adjust(f, 10);
    await holdLot(f);
    const body = exitBody(f),
      path = 'wms/stock-exits';
    const created = (await call('post', path, body).expect(201)).body;
    expect((await call('post', path, body).expect(201)).body).toEqual({
      ...created,
      replayed: true,
    });
    await call('post', path, { ...body, quantity: '3' }).expect(409);
    await call('post', path, body, 'manager2').expect(409);
    expect(
      await db.stockMovement.count({ where: { tenantId: f.tenantId, refId: created.id } }),
    ).toBe(0);
    const payload = await exitPost(created.id),
      postPath = `${path}/${created.id}/post`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call('post', postPath, payload)),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.movementId)).size).toBe(1);
    await call('post', postPath, {
      ...payload,
      completionNote: 'Autre compte rendu de sortie',
    }).expect(409);
    await call('post', postPath, payload, 'manager2').expect(409);
    const d = (await call('get', `${path}/${created.id}`).expect(200)).body;
    expect(d).toMatchObject({
      status: 'POSTED',
      quantity: '2.125',
      evidence: {
        version: 1,
        confirmed: true,
        review: { disposition: 'QUARANTINED', remaining: '7.875' },
      },
    });
    expect(d.operationKey).toBeUndefined();
    expect(d.requestFingerprint).toBeUndefined();
    expect((await call('get', `${f.path}/${f.lot.id}`).expect(200)).body.disposition).toBe(
      'QUARANTINED',
    );
    expect(
      (
        await db.wmsLotBalance.findFirstOrThrow({
          where: { tenantId: f.tenantId, lotId: f.lot.id, binId: f.a.id },
        })
      ).qtyOnHand.toFixed(),
    ).toBe('7.875');
    const journal = (
      await call('get', `wms/inventory/movements?refType=stock-exit&refId=${d.id}`).expect(200)
    ).body;
    expect(journal.items).toHaveLength(1);
    expect(journal.items[0].source).toMatchObject({
      kind: 'stock-exit',
      id: d.id,
      number: d.number,
    });
    await call('post', `${path}/${d.id}/cancel`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: d.updatedAt,
      reason: 'Trop tard',
    }).expect(409);
    await assertBalances(f);
  });
  it('I2i returns work with WMS alone, explicit supplier and captured destination, with no purchase/finance side effects', async () => {
    const f = await fixture(1);
    await adjust(f, 5);
    const supplier = (
      await call(
        'post',
        'wms/data/suppliers',
        { code: randomUUID(), name: 'Fournisseur retour autonome' },
        'manager',
        1,
      ).expect(201)
    ).body;
    const body = {
      ...exitBody(f, '1'),
      kind: 'SUPPLIER_RETURN',
      supplierId: supplier.id,
      reference: 'RMA-TEST',
      destination: '123 rue du Retour, Montréal QC',
    };
    const d = (await call('post', 'wms/stock-exits', body, 'manager', 1).expect(201)).body;
    await call(
      'post',
      `wms/stock-exits/${d.id}/post`,
      await exitPost(d.id, 1),
      'manager',
      1,
    ).expect(201);
    expect(
      (await call('get', `wms/stock-exits/${d.id}`, undefined, 'manager', 1).expect(200)).body,
    ).toMatchObject({
      status: 'POSTED',
      reference: 'RMA-TEST',
      snapshot: { supplier: { id: supplier.id, name: supplier.name } },
    });
    expect(
      await db.stockMovement.count({
        where: { tenantId: f.tenantId, refId: d.id, type: 'SUPPLIER_RETURN' },
      }),
    ).toBe(1);
    await call('get', 'purchasing/orders', undefined, 'manager', 1).expect(403);
    await call(
      'post',
      'wms/stock-exits',
      { ...body, operationKey: randomUUID(), supplierId: 'foreign' },
      'manager',
      1,
    ).expect(400);
    await call(
      'post',
      'wms/stock-exits',
      { ...body, operationKey: randomUUID(), reference: '' },
      'manager',
      1,
    ).expect(400);
    await call(
      'post',
      'wms/stock-exits',
      { ...exitBody(f), supplierId: supplier.id },
      'manager',
      1,
    ).expect(400);
    await assertBalances(f);
  });
  it('I2i enforces module, tenant, distinct posting rights and closed draft cancellation replay', async () => {
    const f = await fixture();
    await adjust(f, 5);
    const body = exitBody(f);
    await call('post', 'wms/stock-exits', body, 'reader').expect(403);
    await call('post', 'wms/stock-exits', body, 'manager', 2).expect(403);
    await call('post', 'wms/stock-exits', body, 'manager', 1).expect(400);
    const d = (await call('post', 'wms/stock-exits', body, 'stock-manager').expect(201)).body;
    for (const suffix of ['', '/review'])
      await call('get', `wms/stock-exits/${d.id}${suffix}`, undefined, 'manager', 1).expect(404);
    const p = await exitPost(d.id);
    await call('post', `wms/stock-exits/${d.id}/post`, p, 'stock-manager').expect(403);
    await call('post', `wms/stock-exits/${d.id}/post`, { ...p, confirmed: false }).expect(400);
    const cancellation = {
      operationKey: randomUUID(),
      expectedUpdatedAt: p.expectedUpdatedAt,
      reason: 'Dossier erroné',
    };
    await call('post', `wms/stock-exits/${d.id}/cancel`, cancellation, 'stock-manager').expect(201);
    expect(
      (
        await call('post', `wms/stock-exits/${d.id}/cancel`, cancellation, 'stock-manager').expect(
          201,
        )
      ).body.replayed,
    ).toBe(true);
    await call('post', `wms/stock-exits/${d.id}/cancel`, cancellation, 'manager2').expect(409);
    await call('post', `wms/stock-exits/${d.id}/post`, p).expect(409);
    expect(await db.stockMovement.count({ where: { tenantId: f.tenantId, refId: d.id } })).toBe(0);
  });
  it('I2i rejects stale stock reviews, including net-zero movements, and does not overspend across drafts', async () => {
    const f = await fixture();
    await adjust(f, 3);
    const a = (await call('post', 'wms/stock-exits', exitBody(f, '2')).expect(201)).body;
    const stale = await exitPost(a.id);
    await adjust(f, 1);
    await adjust(f, -1);
    await call('post', `wms/stock-exits/${a.id}/post`, stale).expect(409);
    const b = (await call('post', 'wms/stock-exits', exitBody(f, '2')).expect(201)).body;
    const [pa, pb] = await Promise.all([exitPost(a.id), exitPost(b.id)]);
    const res = await Promise.all([
      call('post', `wms/stock-exits/${a.id}/post`, pa),
      call('post', `wms/stock-exits/${b.id}/post`, pb),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    const unposted = res[0].status === 409 ? a : b;
    expect(
      (
        await call('get', `wms/stock-exits/${unposted.id}/review`).expect(200)
      ).body.blockedReasons.join(' '),
    ).toMatch(/insuffisant/);
    await assertBalances(f);
  });
  it('I2i cannot consume another bin or lot and rejects supplier changes after preparation', async () => {
    const f = await fixture();
    await adjust(f, 5, f.lot.id, f.b.id);
    const a = (await call('post', 'wms/stock-exits', exitBody(f)).expect(201)).body;
    await call('post', `wms/stock-exits/${a.id}/post`, await exitPost(a.id)).expect(409);
    const sources = (
      await call('get', `wms/stock-exits/sources?itemId=${f.item.id}&lotId=${f.lot.id}`).expect(200)
    ).body;
    expect(sources.items.map((r: any) => r.id)).toEqual([f.b.id]);
    await call(
      'get',
      `wms/stock-exits/sources?itemId=${f.item.id}&lotId=${f.lot.id}`,
      undefined,
      'manager',
      1,
    ).expect(404);
    const supplier = (
      await call('post', 'wms/data/suppliers', {
        code: randomUUID(),
        name: 'Supplier before',
      }).expect(201)
    ).body;
    const d = (
      await call('post', 'wms/stock-exits', {
        ...exitBody(f, '1'),
        binId: f.b.id,
        kind: 'SUPPLIER_RETURN',
        supplierId: supplier.id,
        reference: 'RMA-2',
        destination: 'Destination confirmée originale',
      }).expect(201)
    ).body;
    await db.businessPartner.updateMany({
      where: { tenantId: f.tenantId, id: supplier.id },
      data: { name: 'Supplier after', updatedAt: new Date(Date.now() + 100) },
    });
    expect(
      (await call('get', `wms/stock-exits/${d.id}/review`).expect(200)).body.blockedReasons.join(
        ' ',
      ),
    ).toMatch(/fournisseur a changé/);
    await call('post', `wms/stock-exits/${d.id}/post`, await exitPost(d.id)).expect(409);
    expect(
      (await call('get', `wms/stock-exits/${d.id}`).expect(200)).body.snapshot.supplier.name,
    ).toBe('Supplier before');
  });
  it('I2i stock ledger failure rolls back the document, proof and all balances', async () => {
    const f = await fixture();
    await adjust(f, 4);
    const d = (await call('post', 'wms/stock-exits', exitBody(f)).expect(201)).body;
    const p = await exitPost(d.id),
      inventory = app.get(InventoryService),
      original = inventory.postMovement.bind(inventory);
    const spy = jest.spyOn(inventory, 'postMovement').mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('I2i injected rollback');
    });
    try {
      await call('post', `wms/stock-exits/${d.id}/post`, p).expect(500);
    } finally {
      spy.mockRestore();
    }
    const row = await db.wmsStockExit.findFirstOrThrow({
      where: { tenantId: f.tenantId, id: d.id },
    });
    expect(row.status).toBe('DRAFT');
    expect(row.resolutionKey).toBeNull();
    expect(row.evidence).toBeNull();
    expect(await db.stockMovement.count({ where: { tenantId: f.tenantId, refId: d.id } })).toBe(0);
    expect(
      (
        await db.wmsLotBalance.findFirstOrThrow({
          where: { tenantId: f.tenantId, lotId: f.lot.id, binId: f.a.id },
        })
      ).qtyOnHand.toFixed(),
    ).toBe('4');
    await call('post', `wms/stock-exits/${d.id}/post`, p).expect(201);
    await assertBalances(f);
  });
  it('I2i central ledger rejects undocumented exit types and misuse of the reserved source', async () => {
    const f = await fixture();
    await adjust(f, 5);
    const inventory = app.get(InventoryService);
    const user = await db.user.findFirstOrThrow({
      where: { tenantId: f.tenantId, firstName: 'manager' },
    });
    for (const type of [
      StockMovementType.DISPOSAL,
      StockMovementType.SUPPLIER_RETURN,
      StockMovementType.ADJUSTMENT,
    ]) {
      await expect(
        db.$transaction((tx) =>
          inventory.postMovement(tx, {
            tenantId: f.tenantId,
            userId: user.id,
            type,
            itemId: f.item.id,
            lotId: f.lot.id,
            fromBinId: f.a.id,
            qty: 1,
            refType: 'stock-exit',
            refId: 'missing',
          }),
        ),
      ).rejects.toThrow(/sortie|Sortie/);
    }
    const d = (await call('post', 'wms/stock-exits', exitBody(f)).expect(201)).body;
    await expect(
      db.$transaction((tx) =>
        inventory.postMovement(tx, {
          tenantId: f.tenantId,
          userId: user.id,
          type: StockMovementType.DISPOSAL,
          itemId: f.item.id,
          lotId: f.lot.id,
          fromBinId: f.a.id,
          qty: 1,
          refType: 'stock-exit',
          refId: d.id,
        }),
      ),
    ).rejects.toThrow(/incohérente/);
    await assertBalances(f);
  });
  async function lotControl(f: Awaited<ReturnType<typeof fixture>>, outcome?: 'PASS' | 'FAIL') {
    const plan = (
      await call('post', 'quality/plans', {
        code: 'QC-' + randomUUID().slice(0, 8).toUpperCase(),
        name: 'Inspection du lot',
        instructions: 'Vérifier la matière avant reprise.',
        active: true,
        criteria: [{ key: 'aspect', label: 'Aspect', kind: 'CHECK' }],
      }).expect(201)
    ).body;
    const body = {
      planId: plan.id,
      title: 'Contrôle lot isolé',
      sourceKind: 'LOT',
      sourceId: f.lot.id,
      operationKey: randomUUID(),
    };
    let row = (await call('post', 'quality/inspections', body).expect(201)).body;
    expect((await call('post', 'quality/inspections', body).expect(201)).body.id).toBe(row.id);
    if (outcome) {
      row = (
        await call('post', `quality/inspections/${row.id}/transition`, {
          expectedUpdatedAt: row.updatedAt,
          status: 'IN_PROGRESS',
          note: 'Vérification physique',
        }).expect(201)
      ).body;
      row = (
        await call('patch', `quality/inspections/${row.id}/results`, {
          expectedUpdatedAt: row.updatedAt,
          results: [{ key: 'aspect', value: outcome, note: 'Inspection visuelle' }],
        }).expect(200)
      ).body;
    }
    return row;
  }
  async function finishControl(row: any) {
    return (
      await call('post', `quality/inspections/${row.id}/transition`, {
        expectedUpdatedAt: row.updatedAt,
        status: 'COMPLETED',
        note: 'Contrôle documenté et terminé',
      }).expect(201)
    ).body;
  }
  async function holdLot(f: Awaited<ReturnType<typeof fixture>>, revision = 0) {
    await call('post', `${f.path}/${f.lot.id}/quarantine`, {
      operationKey: randomUUID(),
      expectedRevision: revision,
      reason: 'Contrôle matière requis',
    }).expect(201);
  }
  function releaseBody(row: any, revision = 1) {
    return {
      operationKey: randomUUID(),
      expectedRevision: revision,
      reason: 'Lot vérifié conforme',
      controlNote: 'Inspection visuelle et validation physique réalisées.',
      qualityInspectionId: row.id,
      expectedInspectionUpdatedAt: row.updatedAt,
    };
  }
  it('I2g links controls before execution, exposes exact open preparations, and releases with an immutable PASS proof', async () => {
    const f = await fixture();
    expect((await adjust(f, 10)).status).toBe(201);
    const pick = await doc(f, 'pick-orders', [{ qty: 2, lotId: f.lot.id }]);
    await holdLot(f);
    let qc = await lotControl(f, 'PASS');
    expect(qc.source.id).toBe(f.lot.id);
    expect(qc.lotContext).toMatchObject({
      fresh: true,
      snapshot: { code: f.lot.code, dispositionRevision: 1 },
    });
    const count = await db.stockMovement.count({
      where: { tenantId: f.tenantId, lotId: f.lot.id },
    });
    qc = await finishControl(qc);
    expect((await call('get', `${f.path}/${f.lot.id}`).expect(200)).body.disposition).toBe(
      'QUARANTINED',
    );
    const related = (await call('get', `${f.path}/${f.lot.id}/affected-preparations`).expect(200))
      .body;
    expect(related.items.map((r: any) => r.id)).toEqual([pick.id]);
    expect(related.items[0].lines).toHaveLength(1);
    expect(
      (await call('get', `${f.path}?lotId=${f.lot.id}`).expect(200)).body.items.map(
        (r: any) => r.id,
      ),
    ).toEqual([f.lot.id]);
    expect(
      (
        await call('get', `${f.path}/${f.lot.id}/quality-inspections?releaseEligible=true`).expect(
          200,
        )
      ).body.items[0],
    ).toMatchObject({ id: qc.id, eligibleForRelease: true });
    const body = releaseBody(qc),
      result = await Promise.all(
        [1, 2].map(() => call('post', `${f.path}/${f.lot.id}/release`, body).expect(201)),
      );
    expect(new Set(result.map((r) => r.body.decisionId)).size).toBe(1);
    await call('post', `${f.path}/${f.lot.id}/release`, {
      ...body,
      qualityInspectionId: 'changed',
    }).expect(409);
    const history = (await call('get', `${f.path}/${f.lot.id}/decisions`).expect(200)).body.items;
    expect(history[0].qualitySnapshot).toMatchObject({
      id: qc.id,
      outcome: 'PASS',
      lotDispositionRevision: 1,
      lotMovementCount: count,
    });
    expect(await db.stockMovement.count({ where: { tenantId: f.tenantId, lotId: f.lot.id } })).toBe(
      count,
    );
    expect((await call('get', `wms/pick-orders/${pick.id}`).expect(200)).body.status).toBe('OPEN');
    await holdLot(f, 2);
    await call('post', `${f.path}/${f.lot.id}/release`, releaseBody(qc, 3)).expect(409);
    expect(
      (await call('get', `${f.path}/${f.lot.id}/decisions`).expect(200)).body.items[1]
        .qualitySnapshot,
    ).toEqual(history[0].qualitySnapshot);
  });
  it('I2g rejects draft, failed, foreign-lot and stale-version controls without changing stock decisions', async () => {
    const f = await fixture();
    await holdLot(f);
    const draft = await lotControl(f);
    await call('post', `${f.path}/${f.lot.id}/release`, releaseBody(draft)).expect(409);
    const failed = await finishControl(await lotControl(f, 'FAIL'));
    expect(failed.nonconformity).not.toBeNull();
    await call('post', `${f.path}/${f.lot.id}/release`, releaseBody(failed)).expect(409);
    const pass = await finishControl(await lotControl(f, 'PASS'));
    await call('post', `${f.path}/${f.lot.id}/release`, {
      ...releaseBody(pass),
      expectedInspectionUpdatedAt: '2020-01-01T00:00:00.000Z',
    }).expect(409);
    await call('post', `${f.path}/${f.lot.id}/release`, {
      ...releaseBody(pass),
      expectedInspectionUpdatedAt: undefined,
    }).expect(400);
    await call('post', `${f.path}/${f.lot.id}/release`, {
      ...releaseBody(pass),
      qualityInspectionId: undefined,
    }).expect(400);
    const other = await fixture();
    await holdLot(other);
    await call('post', `${other.path}/${other.lot.id}/release`, releaseBody(pass)).expect(404);
    expect(
      await db.wmsLotDecision.count({ where: { tenantId: f.tenantId, lotId: f.lot.id } }),
    ).toBe(1);
  });
  it('I2g invalidates a control on a net-zero move and a completed proof on a later incoming movement', async () => {
    const f = await fixture();
    expect((await adjust(f, 10)).status).toBe(201);
    await holdLot(f);
    const qc = await lotControl(f, 'PASS');
    for (const [from, to] of [
      [f.a, f.b],
      [f.b, f.a],
    ])
      await call('post', 'wms/inventory/move', {
        operationKey: randomUUID(),
        itemId: f.item.id,
        lotId: f.lot.id,
        fromBinId: from.id,
        toBinId: to.id,
        qty: 1,
      }).expect(201);
    expect(
      (await call('get', `quality/inspections/${qc.id}`).expect(200)).body.lotContext.fresh,
    ).toBe(false);
    await call('post', `quality/inspections/${qc.id}/transition`, {
      expectedUpdatedAt: qc.updatedAt,
      status: 'COMPLETED',
      note: 'Ancien échantillon',
    }).expect(409);
    await call('post', `quality/inspections/${qc.id}/transition`, {
      expectedUpdatedAt: qc.updatedAt,
      status: 'CANCELLED',
      note: 'Matière déplacée, refaire le contrôle',
    }).expect(201);
    const pass = await finishControl(await lotControl(f, 'PASS'));
    expect((await adjust(f, 1)).status).toBe(201);
    await call('post', `${f.path}/${f.lot.id}/release`, releaseBody(pass)).expect(409);
    expect(
      (
        await call('get', `${f.path}/${f.lot.id}/quality-inspections?releaseEligible=true`).expect(
          200,
        )
      ).body.total,
    ).toBe(0);
  });
  it('I2g gates source and evidence by current modules/rights including replay, without coupling WMS-only release', async () => {
    const f = await fixture();
    await holdLot(f);
    let qc = await lotControl(f, 'PASS');
    const hidden = (
      await call('get', `quality/inspections/${qc.id}`, undefined, 'quality-only').expect(200)
    ).body;
    expect(hidden.source).toEqual({ kind: 'LOT', available: false });
    expect(hidden).not.toHaveProperty('lotContext');
    await call(
      'post',
      `quality/inspections/${qc.id}/transition`,
      { expectedUpdatedAt: qc.updatedAt, status: 'COMPLETED', note: 'Sans lecture WMS' },
      'quality-only',
    ).expect(403);
    await call('get', 'quality/references?kind=LOT', undefined, 'quality-only').expect(403);
    qc = await finishControl(qc);
    const body = releaseBody(qc);
    await call('post', `${f.path}/${f.lot.id}/release`, body, 'stock-release').expect(403);
    await call('get', `${f.path}/${f.lot.id}/quality-inspections`, undefined, 'reader').expect(403);
    await call(
      'get',
      `${f.path}/${f.lot.id}/affected-preparations`,
      undefined,
      'manager',
      1,
    ).expect(404);
    await call('post', `${f.path}/${f.lot.id}/release`, body).expect(201);
    const masked = (
      await call('get', `${f.path}/${f.lot.id}/decisions`, undefined, 'stock-release').expect(200)
    ).body.items[0];
    expect(masked).not.toHaveProperty('qualitySnapshot');
    expect(masked).not.toHaveProperty('qualityInspectionId');
    const mod = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'quality' } });
    await db.tenantModule.updateMany({
      where: { tenantId: f.tenantId, moduleId: mod.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(f.tenantId);
    try {
      await call('post', `${f.path}/${f.lot.id}/release`, body).expect(403);
      await call('get', `${f.path}/${f.lot.id}/quality-inspections`).expect(403);
      expect(
        (await call('get', `${f.path}/${f.lot.id}/decisions`).expect(200)).body.items[0],
      ).not.toHaveProperty('qualitySnapshot');
    } finally {
      await db.tenantModule.updateMany({
        where: { tenantId: f.tenantId, moduleId: mod.id },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(f.tenantId);
    }
  });
  it('quarantines a whole lot atomically, blocks exits, permits isolation and requires a separate release right', async () => {
    const f = await fixture();
    expect((await adjust(f, 10)).status).toBe(201);
    const pick = await doc(f, 'pick-orders', [{ qty: 2, lotId: f.lot.id }]);
    const hold = {
      operationKey: randomUUID(),
      expectedRevision: 0,
      reason: 'Emballage endommagé à inspecter',
    };
    await call('post', `${f.path}/${f.lot.id}/quarantine`, hold, 'reader').expect(403);
    const results = await Promise.all(
      [1, 2].map(() =>
        call('post', `${f.path}/${f.lot.id}/quarantine`, hold, 'stock-manager').expect(201),
      ),
    );
    expect(new Set(results.map((r) => r.body.decisionId)).size).toBe(1);
    await call('post', `${f.path}/${f.lot.id}/quarantine`, hold, 'manager').expect(409);
    await call(
      'post',
      `${f.path}/${f.lot.id}/quarantine`,
      { ...hold, reason: 'Autre motif' },
      'stock-manager',
    ).expect(409);
    expect(
      await db.wmsLotDecision.count({ where: { tenantId: f.tenantId, lotId: f.lot.id } }),
    ).toBe(1);
    const readiness = (await call('get', `wms/pick-orders/${pick.id}`).expect(200)).body.readiness;
    expect(readiness.canExecute).toBe(false);
    expect(readiness.lines[0].issues.join(' ')).toContain('quarantaine');
    await call('post', `wms/pick-orders/${pick.id}/complete`, {
      expectedUpdatedAt: pick.updatedAt,
    }).expect(409);
    expect((await adjust(f, -1)).status).toBe(409);
    expect((await adjust(f, 1)).status).toBe(201);
    const move = {
      operationKey: randomUUID(),
      itemId: f.item.id,
      lotId: f.lot.id,
      fromBinId: f.a.id,
      toBinId: f.b.id,
      qty: 3,
    };
    await call('post', 'wms/inventory/move', move).expect(201);
    const stock = (await call('get', `wms/inventory?itemId=${f.item.id}`).expect(200)).body;
    expect(stock.every((r: any) => r.availableQty === '0')).toBe(true);
    expect(stock.reduce((n: number, r: any) => n + Number(r.quarantinedQty), 0)).toBe(11);
    const release = {
      operationKey: randomUUID(),
      expectedRevision: 1,
      reason: 'Contrôle terminé',
      controlNote: 'Inspection visuelle et échantillon conformes, dossier QC-124.',
    };
    await call('post', `${f.path}/${f.lot.id}/release`, release, 'stock-manager').expect(403);
    await call('post', `${f.path}/${f.lot.id}/release`, { ...release, expectedRevision: 0 }).expect(
      409,
    );
    await call('post', `${f.path}/${f.lot.id}/release`, { ...release, controlNote: 'ok' }).expect(
      400,
    );
    await call('post', `${f.path}/${f.lot.id}/release`, release).expect(201);
    await call('post', `${f.path}/${f.lot.id}/release`, release).expect(201);
    const history = (await call('get', `${f.path}/${f.lot.id}/decisions`).expect(200)).body;
    expect(history.total).toBe(2);
    expect(history.items[0].controlNote).toBe(release.controlNote);
    expect(history.items[0]).not.toHaveProperty('fingerprint');
    expect(history.items[0]).not.toHaveProperty('operationKey');
    await call('get', `${f.path}/${f.lot.id}/decisions`, undefined, 'manager', 1).expect(404);
    expect((await adjust(f, -1)).status).toBe(201);
    await assertBalances(f);
  });
  it('supports a WMS-only tenant and rolls back a failed decision without changing lot state', async () => {
    const f = await fixture(1);
    const body = {
      operationKey: randomUUID(),
      expectedRevision: 0,
      reason: 'Attente de contrôle local',
    };
    const real = db.$transaction.bind(db);
    const spy = jest.spyOn(db, '$transaction').mockImplementationOnce(
      (fn: any) =>
        real(async (tx: any) =>
          fn(
            new Proxy(tx, {
              get(target, prop) {
                return prop === 'wmsLot'
                  ? new Proxy(target.wmsLot, {
                      get(model, key) {
                        return key === 'update'
                          ? async () => {
                              throw Error('Injected lot decision failure');
                            }
                          : model[key];
                      },
                    })
                  : target[prop];
              },
            }),
          ),
        ) as any,
    );
    await call('post', `${f.path}/${f.lot.id}/quarantine`, body, 'manager', 1).expect(500);
    spy.mockRestore();
    expect(
      await db.wmsLotDecision.count({ where: { tenantId: f.tenantId, lotId: f.lot.id } }),
    ).toBe(0);
    expect(
      (await db.wmsLot.findFirstOrThrow({ where: { tenantId: f.tenantId, id: f.lot.id } }))
        .disposition,
    ).toBe('UNRESTRICTED');
    await call('post', `${f.path}/${f.lot.id}/quarantine`, body, 'manager', 1).expect(201);
    expect((await adjust(f, 3)).status).toBe(201);
    expect((await adjust(f, -1)).status).toBe(409);
  });
  async function fixture(tenant = 0, tracked = true) {
    const item = (
      await call(
        'post',
        'wms/items',
        { sku: randomUUID(), name: 'Article lots I2a', unit: 'EA', lotTracked: tracked },
        'manager',
        tenant,
      ).expect(201)
    ).body;
    const tenantId = tenants[tenant].id;
    const site = await db.location.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Entrepôt lots',
        type: 'WAREHOUSE',
        addressLine1: '1 Test',
        city: 'Québec',
      },
    });
    const a = await db.bin.create({ data: { tenantId, locationId: site.id, code: 'A' } }),
      b = await db.bin.create({ data: { tenantId, locationId: site.id, code: 'B' } });
    const path = `wms/items/${item.id}/lots`;
    const lot = tracked
      ? (
          await call(
            'post',
            path,
            {
              code: 'LOT-A',
              supplierLot: 'FOURN-A',
              manufacturedOn: '2026-09-01',
              expiresOn: '2027-09-01',
            },
            'manager',
            tenant,
          ).expect(201)
        ).body
      : null;
    return { item, site, a, b, path, lot, tenantId, tenantIndex: tenant };
  }
  async function adjust(
    f: Awaited<ReturnType<typeof fixture>>,
    qtyDelta: number,
    lotId = f.lot?.id,
    binId = f.a.id,
  ) {
    return call(
      'post',
      'wms/inventory/adjust',
      {
        itemId: f.item.id,
        binId,
        qtyDelta,
        ...(lotId ? { lotId } : {}),
      },
      'manager',
      f.tenantIndex,
    );
  }
  async function doc(
    f: Awaited<ReturnType<typeof fixture>>,
    kind: 'receipts' | 'pick-orders',
    lines: { qty: number; lotId?: string }[],
  ) {
    const d = (await call('post', `wms/${kind}`, { locationId: f.site.id }).expect(201)).body;
    for (const l of lines)
      await call('post', `wms/${kind}/${d.id}/lines`, {
        itemId: f.item.id,
        [kind === 'receipts' ? 'toBinId' : 'fromBinId']: f.a.id,
        ...l,
      }).expect(201);
    return (await call('get', `wms/${kind}/${d.id}`).expect(200)).body;
  }
  async function assertBalances(f: Awaited<ReturnType<typeof fixture>>) {
    const levels = await db.inventoryLevel.findMany({
      where: { tenantId: f.tenantId, itemId: f.item.id },
    });
    for (const l of levels) {
      const sum = await db.wmsLotBalance.aggregate({
        where: { tenantId: f.tenantId, itemId: f.item.id, binId: l.binId },
        _sum: { qtyOnHand: true },
      });
      expect(l.qtyOnHand.eq(sum._sum.qtyOnHand ?? 0)).toBe(true);
    }
  }
  async function manufacturingFixture() {
    const f = await fixture(4);
    const mc = (method: 'get' | 'post', path: string, data?: object, role = 'manager') =>
      call(method, path, data, role, 4);
    const post = async (path: string, data: object) =>
      (await mc('post', path, data).expect(201)).body;
    const product = await post('wms/items', {
      sku: randomUUID(),
      name: 'Produit traçable',
      unit: 'EA',
      lotTracked: true,
    });
    const output = await post(`wms/items/${product.id}/lots`, {
      code: 'FINISHED-A',
      manufacturedOn: '2026-09-25',
    });
    const second = await post(`wms/items/${f.item.id}/lots`, { code: 'RAW-B' });
    expect((await adjust(f, 3)).status).toBe(201);
    expect((await adjust(f, 4, second.id)).status).toBe(201);
    let bom = await post('manufacturing/boms', {
      code: randomUUID(),
      name: 'Nomenclature lots',
      productRef: product.sku,
    });
    await post(`manufacturing/boms/${bom.id}/lines`, {
      materialRef: f.item.sku,
      quantityPerUnit: '1',
      expectedUpdatedAt: bom.updatedAt,
    });
    bom = (await mc('get', `manufacturing/boms/${bom.id}`).expect(200)).body;
    const rev = await post(`manufacturing/boms/${bom.id}/revisions`, {
      expectedUpdatedAt: bom.updatedAt,
      acknowledgeUnits: true,
    });
    let order = await post('manufacturing/orders', {
      name: 'OF lots atelier',
      productRef: product.sku,
      quantity: 5,
      dueDate: '2026-10-10T00:00:00Z',
      releaseDate: '2026-09-25T00:00:00Z',
      bomId: bom.id,
    });
    await post(`manufacturing/orders/${order.id}/material-context`, {
      expectedUpdatedAt: order.updatedAt,
      locationId: f.site.id,
      bomRevisionId: rev.id,
    });
    await post(`manufacturing/orders/${order.id}/release`, {});
    order = await post(`manufacturing/orders/${order.id}/start`, {});
    const path = `manufacturing/shop-floor/orders/${order.id}`;
    const body = {
      operationKey: randomUUID(),
      expectedUpdatedAt: order.updatedAt,
      goodQuantity: 2,
      scrapQuantity: 1,
      toBinId: f.b.id,
      outputLotId: output.id,
      note: 'Deux lots consommés avec un rebut',
      consumptions: [
        { itemId: f.item.id, fromBinId: f.a.id, quantity: '1.625', lotId: f.lot.id },
        { itemId: f.item.id, fromBinId: f.a.id, quantity: '1.375', lotId: second.id },
      ],
    };
    return { ...f, mc, post, order, product, output, second, path, body };
  }
  async function traceNext(
    f: Awaited<ReturnType<typeof manufacturingFixture>>,
    source: any,
    lot: any,
    target?: any,
  ) {
    const product =
      target?.product ??
      (await f.post('wms/items', {
        sku: randomUUID(),
        name: 'Produit niveau suivant',
        unit: 'EA',
        lotTracked: true,
      }));
    const output =
      target?.output ?? (await f.post(`wms/items/${product.id}/lots`, { code: 'NEXT' }));
    let bom = await f.post('manufacturing/boms', {
      code: randomUUID(),
      name: 'Assemblage suivant',
      productRef: product.sku,
    });
    await f.post(`manufacturing/boms/${bom.id}/lines`, {
      materialRef: source.sku,
      quantityPerUnit: '1',
      expectedUpdatedAt: bom.updatedAt,
    });
    bom = (await f.mc('get', `manufacturing/boms/${bom.id}`).expect(200)).body;
    const revision = await f.post(`manufacturing/boms/${bom.id}/revisions`, {
      expectedUpdatedAt: bom.updatedAt,
      acknowledgeUnits: true,
    });
    let order = await f.post('manufacturing/orders', {
      name: 'Chaîne lots',
      productRef: product.sku,
      quantity: 2,
      dueDate: '2026-10-10T00:00:00Z',
      releaseDate: '2026-09-25T00:00:00Z',
      bomId: bom.id,
    });
    await f.post(`manufacturing/orders/${order.id}/material-context`, {
      expectedUpdatedAt: order.updatedAt,
      locationId: f.site.id,
      bomRevisionId: revision.id,
    });
    await f.post(`manufacturing/orders/${order.id}/release`, {});
    order = await f.post(`manufacturing/orders/${order.id}/start`, {});
    const path = `manufacturing/shop-floor/orders/${order.id}`;
    const declaration = await f.post(`${path}/declarations`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: order.updatedAt,
      goodQuantity: 1,
      scrapQuantity: 0,
      toBinId: f.b.id,
      outputLotId: output.id,
      note: 'Assemblage traçable',
      consumptions: [{ itemId: source.id, fromBinId: f.b.id, quantity: '1', lotId: lot.id }],
    });
    return { product, output, declaration, order, path };
  }
  it('I2h follows a real multi-level chain both ways, bounds depth and never writes on read', async () => {
    const f = await manufacturingFixture();
    const first = await f.post(`${f.path}/declarations`, f.body);
    const next = await traceNext(f, f.product, f.output);
    const before = await db.stockMovement.count({ where: { tenantId: f.tenantId } });
    const url = `wms/items/${f.item.id}/lots/${f.lot.id}/trace`;
    const down = (await f.mc('get', url).expect(200)).body;
    expect(down.nodes.map((n: any) => n.id).sort()).toEqual(
      [f.lot.id, f.output.id, next.output.id].sort(),
    );
    expect(down.edges).toHaveLength(2);
    expect(down.edges[0]).toMatchObject({
      declarationId: first.id,
      input: { quantity: '1.625' },
      output: { quantity: '2' },
    });
    expect(down.bounded).toBe(false);
    const up = (
      await f
        .mc('get', `wms/items/${next.product.id}/lots/${next.output.id}/trace?direction=upstream`)
        .expect(200)
    ).body;
    expect(up.nodes.map((n: any) => n.id).sort()).toEqual(
      [f.lot.id, f.second.id, f.output.id, next.output.id].sort(),
    );
    expect(up.edges).toHaveLength(3); // Production quantity remains 2 on each edge, not allocated or summed.
    const shallow = (await f.mc('get', `${url}?depth=1`).expect(200)).body;
    expect(shallow.nodes).toHaveLength(2);
    expect(shallow.bounded).toBe(true);
    const hidden = (await f.mc('get', url, undefined, 'reader').expect(200)).body;
    expect(hidden.nodes).toHaveLength(1);
    expect(hidden.edges).toEqual([]);
    expect(hidden.notices).toEqual([]);
    expect(hidden.scopes.manufacturing).toBe(false);
    expect(JSON.stringify(hidden)).not.toContain(first.id);
    await call('get', url, undefined, 'manager', 0).expect(404);
    await f.mc('get', url, undefined, 'service-reader').expect(403);
    for (const query of ['depth=0', 'depth=5', 'depth=1.5', 'direction=bad', 'tenantId=foreign'])
      await f.mc('get', `${url}?${query}`).expect(400);
    expect(await db.stockMovement.count({ where: { tenantId: f.tenantId } })).toBe(before);
  });
  it('I2h excludes a real reversal, flags legacy proof and handles lot cycles without recursion', async () => {
    const f = await manufacturingFixture();
    const d = await f.post(`${f.path}/declarations`, f.body);
    const url = `wms/items/${f.item.id}/lots/${f.lot.id}/trace`;
    const p = (await f.mc('get', `${f.path}/declarations/${d.id}/reversal-preview`).expect(200))
      .body;
    await f.post(`${f.path}/declarations/${d.id}/reverse`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: p.expectedUpdatedAt,
      reviewToken: p.reviewToken,
      reason: 'Correction test traçabilité',
    });
    const reversed = (await f.mc('get', url).expect(200)).body;
    expect(reversed.edges).toEqual([]);
    expect(reversed.notices).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'REVERSED', declarationId: d.id })]),
    );
    const legacy = await manufacturingFixture();
    const ld = await legacy.post(`${legacy.path}/declarations`, legacy.body);
    // Deliberately degraded fixture only: production never rewrites append-only evidence.
    await db.manufacturingDeclaration.update({
      where: { id: ld.id },
      data: { evidence: { version: 1 } },
    });
    const old = (
      await legacy.mc('get', `wms/items/${legacy.item.id}/lots/${legacy.lot.id}/trace`).expect(200)
    ).body;
    expect(old.edges).toEqual([]);
    expect(old.notices[0].code).toBe('UNVERIFIED');
    const cycle = await manufacturingFixture();
    await cycle.post(`${cycle.path}/declarations`, cycle.body);
    await traceNext(cycle, cycle.product, cycle.output, { product: cycle.item, output: cycle.lot });
    const circular = (
      await cycle.mc('get', `wms/items/${cycle.item.id}/lots/${cycle.lot.id}/trace`).expect(200)
    ).body;
    expect(circular.nodes).toHaveLength(2);
    expect(circular.edges).toHaveLength(2);
    expect(circular.notices.some((n: any) => n.code === 'CYCLE')).toBe(true);
  });
  it('I2h paginates WMS dossiers, distinguishes planned lines and keeps WMS autonomous', async () => {
    const f = await fixture();
    const receipt = await doc(f, 'receipts', [{ qty: 2, lotId: f.lot.id }]);
    await doc(f, 'receipts', [{ qty: 3, lotId: f.lot.id }]);
    const pick = await doc(f, 'pick-orders', [{ qty: 1, lotId: f.lot.id }]);
    const base = `${f.path}/${f.lot.id}`;
    const r = (await call('get', `${base}/trace-dossiers?kind=receipts&pageSize=1`).expect(200))
      .body;
    expect(r.total).toBe(2);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].unitCaptured).toBe(false);
    const p = (await call('get', `${base}/trace-dossiers?kind=picks`).expect(200)).body;
    expect(p.items[0]).toMatchObject({ number: pick.number, status: 'OPEN' });
    expect(p.items[0]).not.toHaveProperty('context');
    await call('get', `${base}/trace-dossiers?kind=services`, undefined, 'reader').expect(403);
    await call('get', `${base}/trace-dossiers?kind=receipts`, undefined, 'manager', 1).expect(404);
    for (const query of ['kind=invalid', 'pageSize=101', 'page=0'])
      await call('get', `${base}/trace-dossiers?${query}`).expect(400);
    const alone = await fixture(1);
    const v = (
      await call('get', `${alone.path}/${alone.lot.id}/trace`, undefined, 'manager', 1).expect(200)
    ).body;
    expect(v.nodes).toHaveLength(1);
    expect(v.scopes.manufacturing).toBe(false);
    expect(receipt.status).toBe('DRAFT');
  });
  it('I2h keeps Services returns visible with their captured unit and guards the module', async () => {
    const f = await serviceFixture();
    const usage = await f.post(f.path, f.body);
    await f.post(`${f.path}/${usage.id}/return`, {
      operationKey: randomUUID(),
      quantity: 0.625,
      reason: 'Retour partiel',
      expectedUpdatedAt: await f.version(),
    });
    const url = `wms/items/${f.item.id}/lots/${f.lot.id}/trace-dossiers?kind=services`;
    const r = (await f.sc('get', url).expect(200)).body;
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({
      quantity: '2',
      returnedQuantity: '0.625',
      retainedQuantity: '1.375',
      unit: 'EA',
      unitCaptured: true,
      href: `/services/interventions?jobId=${f.job.id}&section=parts`,
    });
    await f.sc('get', url, undefined, 'reader').expect(403);
    const module = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'services' } });
    await db.tenantModule.updateMany({
      where: { tenantId: f.tenantId, moduleId: module.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(f.tenantId);
    try {
      await f.sc('get', url).expect(403);
    } finally {
      await db.tenantModule.updateMany({
        where: { tenantId: f.tenantId, moduleId: module.id },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(f.tenantId);
    }
  });
  it('I2e compensates once, keeps the original proof and uses net quantities for completion/materials', async () => {
    const f = await manufacturingFixture();
    const d = await f.post(`${f.path}/declarations`, f.body);
    await db.mrpItemPolicy.create({
      data: {
        tenantId: f.tenantId,
        locationId: f.site.id,
        itemId: f.product.id,
        unitSnapshot: 'EA',
      },
    });
    const capture = () =>
      db.$transaction(
        (tx) =>
          app.get(MrpService).captureInTransaction(
            tx,
            f.tenantId,
            f.site.id,
            '2026-09-25',
            '2026-10-10',
            PERMISSION_CATALOG.map((p) => p.key),
          ),
        { isolationLevel: 'RepeatableRead' },
      );
    const before = await capture();
    const original = await db.manufacturingDeclaration.findFirstOrThrow({
      where: { tenantId: f.tenantId, id: d.id },
    });
    const reviewPath = `${f.path}/declarations/${d.id}/reversal-preview`,
      reversePath = `${f.path}/declarations/${d.id}/reverse`;
    const preview = (await f.mc('get', reviewPath).expect(200)).body;
    expect(preview.blockedReasons).toEqual([]);
    expect(preview.effects).toHaveLength(3);
    const body = {
      operationKey: randomUUID(),
      expectedUpdatedAt: preview.expectedUpdatedAt,
      reviewToken: preview.reviewToken,
      reason: 'Mauvais relevé opérateur; stock physique vérifié',
    };
    await f.mc('post', reversePath, body, 'manufacturing-reader').expect(403);
    await call('get', reviewPath, undefined, 'manager', 1).expect(403); // Manufacturing disabled
    await call('get', reviewPath, undefined, 'manager', 0).expect(404); // Both modules, foreign tenant
    await f.mc('post', reversePath, { ...body, reviewToken: '0'.repeat(64) }).expect(409);
    await f.mc('post', reversePath, { ...body, reason: '   ' }).expect(400);
    const results = await Promise.all([
      f.mc('post', reversePath, body).expect(201),
      f.mc('post', reversePath, body).expect(201),
    ]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(results.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    const reversalId = results[0].body.id;
    await f.mc('post', reversePath, { ...body, reason: 'Autre motif' }).expect(409);
    await f.mc('post', reversePath, body, 'manager2').expect(409);
    await f.mc('post', reversePath, { ...body, operationKey: randomUUID() }).expect(409);
    expect(
      await db.manufacturingDeclaration.findFirstOrThrow({
        where: { tenantId: f.tenantId, id: d.id },
      }),
    ).toEqual(original);
    let view = (await f.mc('get', f.path).expect(200)).body;
    expect(view).toMatchObject({ good: 0, scrap: 0, remaining: 5 });
    expect(view.declarations[0].reversal.id).toBe(reversalId);
    const after = await capture();
    expect(after.sourceHash).not.toBe(before.sourceHash);
    expect(before.sourceMetadata.productionDeclarations[0]).not.toHaveProperty('reversal');
    expect(after.sourceMetadata.productionDeclarations[0].reversal?.id).toBe(reversalId);
    const history = (
      await f
        .mc('get', `wms/inventory/movements?refType=manufacturing-reversal&refId=${reversalId}`)
        .expect(200)
    ).body;
    expect(history.items).toHaveLength(3);
    expect(
      history.items.every((m: any) => m.type === 'ADJUSTMENT' && m.source?.id === f.order.id),
    ).toBe(true);
    expect(
      (
        await f
          .mc('get', `wms/inventory/movements?refId=${reversalId}`, undefined, 'reader')
          .expect(200)
      ).body.items.every((m: any) => m.source === null),
    ).toBe(true);
    expect(
      (
        await db.inventoryLevel.findFirstOrThrow({
          where: { tenantId: f.tenantId, itemId: f.item.id, binId: f.a.id },
        })
      ).qtyOnHand.toFixed(),
    ).toBe('7');
    expect(
      (
        await db.inventoryLevel.findFirstOrThrow({
          where: { tenantId: f.tenantId, itemId: f.product.id, binId: f.b.id },
        })
      ).qtyOnHand.toFixed(),
    ).toBe('0');
    const impact = (
      await f
        .mc('get', `manufacturing/scheduling/material-impact?locationId=${f.site.id}`)
        .expect(200)
    ).body;
    expect(impact.orders[0].hasActuals).toBe(false);
    await f.mc('post', `manufacturing/orders/${f.order.id}/complete`, {}).expect(409);
    // Historical replay does not resurrect an annulled declaration or its stock.
    expect((await f.post(`${f.path}/declarations`, f.body)).replayed).toBe(true);
    await f.post(`${f.path}/declarations`, {
      ...f.body,
      expectedUpdatedAt: view.updatedAt,
      operationKey: randomUUID(),
      goodQuantity: 4,
      scrapQuantity: 1,
    });
    await f.post(`manufacturing/orders/${f.order.id}/complete`, {});
    expect((await f.post(reversePath, body)).replayed).toBe(true);
    expect(
      await db.auditLog.count({
        where: { tenantId: f.tenantId, entityType: 'manufacturing-reversal', entityId: reversalId },
      }),
    ).toBe(1);
    const wms = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    const where = { tenantId_moduleId: { tenantId: f.tenantId, moduleId: wms.id } };
    await db.tenantModule.update({ where, data: { enabled: false } });
    app.get(TenantModulesCacheService).invalidate(f.tenantId);
    try {
      await f.mc('get', reviewPath).expect(403);
      await f.mc('post', reversePath, body).expect(403);
    } finally {
      await db.tenantModule.update({ where, data: { enabled: true } });
      app.get(TenantModulesCacheService).invalidate(f.tenantId);
    }
  });
  it('quarantine blocks manufacturing consumption and output reversals, and is excluded from immutable MRP captures', async () => {
    const f = await manufacturingFixture();
    await db.mrpItemPolicy.create({
      data: { tenantId: f.tenantId, locationId: f.site.id, itemId: f.item.id, unitSnapshot: 'EA' },
    });
    const capture = () =>
      db.$transaction(
        (tx) =>
          app.get(MrpService).captureInTransaction(
            tx,
            f.tenantId,
            f.site.id,
            '2026-09-25',
            '2026-10-10',
            PERMISSION_CATALOG.map((p) => p.key),
          ),
        { isolationLevel: 'RepeatableRead' },
      );
    const before = await capture();
    expect(before.snapshot.items[0].on_hand).toBe('7');
    await f.post(`wms/items/${f.item.id}/lots/${f.lot.id}/quarantine`, {
      operationKey: randomUUID(),
      expectedRevision: 0,
      reason: 'Contrôle matière requis',
    });
    const after = await capture();
    expect(after.snapshot.items[0].on_hand).toBe('4');
    expect(before.snapshot.items[0].on_hand).toBe('7');
    expect(after.sourceHash).not.toBe(before.sourceHash);
    expect(after.sourceMetadata.quarantineExclusions).toEqual([
      { itemId: f.item.id, quantity: '3' },
    ]);
    await f.mc('post', `${f.path}/declarations`, f.body).expect(409);
    expect(
      await db.manufacturingDeclaration.count({
        where: { tenantId: f.tenantId, orderId: f.order.id },
      }),
    ).toBe(0);
    await f.post(`wms/items/${f.item.id}/lots/${f.lot.id}/release`, {
      operationKey: randomUUID(),
      expectedRevision: 1,
      reason: 'Matière conforme',
      controlNote: 'Échantillon revérifié et conforme à la fiche technique.',
    });
    const d = await f.post(`${f.path}/declarations`, f.body);
    await f.post(`wms/items/${f.product.id}/lots/${f.output.id}/quarantine`, {
      operationKey: randomUUID(),
      expectedRevision: 0,
      reason: 'Produit à vérifier',
    });
    const preview = (
      await f.mc('get', `${f.path}/declarations/${d.id}/reversal-preview`).expect(200)
    ).body;
    expect(preview.blockedReasons.join(' ')).toContain('quarantaine');
    await f
      .mc('post', `${f.path}/declarations/${d.id}/reverse`, {
        operationKey: randomUUID(),
        expectedUpdatedAt: preview.expectedUpdatedAt,
        reviewToken: preview.reviewToken,
        reason: 'Erreur opérateur, à contrôler',
      })
      .expect(409);
    await assertBalances(f);
  });

  it('I2e rejects stale review, moved output, legacy proof and completed orders without partial compensation', async () => {
    const f = await manufacturingFixture();
    const d = await f.post(`${f.path}/declarations`, f.body);
    const reviewPath = `${f.path}/declarations/${d.id}/reversal-preview`,
      reversePath = `${f.path}/declarations/${d.id}/reverse`;
    const preview = (await f.mc('get', reviewPath).expect(200)).body;
    const body = {
      operationKey: randomUUID(),
      expectedUpdatedAt: preview.expectedUpdatedAt,
      reviewToken: preview.reviewToken,
      reason: 'Correction bloquée',
    };
    const withdraw = { itemId: f.product.id, binId: f.b.id, lotId: f.output.id, qtyDelta: -1 };
    await f.post('wms/inventory/adjust', withdraw);
    const blocked = (await f.mc('get', reviewPath).expect(200)).body;
    expect(blocked.blockedReasons.join(' ')).toMatch(/disponible/);
    await f.mc('post', reversePath, body).expect(409);
    expect(
      await db.manufacturingDeclarationReversal.count({
        where: { tenantId: f.tenantId, declarationId: d.id },
      }),
    ).toBe(0);
    expect(
      (
        await db.inventoryLevel.findFirstOrThrow({
          where: { tenantId: f.tenantId, itemId: f.item.id, binId: f.a.id },
        })
      ).qtyOnHand.toFixed(),
    ).toBe('4');
    await f.post('wms/inventory/adjust', { ...withdraw, qtyDelta: 2 });
    await f.mc('post', reversePath, body).expect(409); // now sufficient, but reviewed quantity changed
    const original = await db.manufacturingDeclaration.findFirstOrThrow({
      where: { tenantId: f.tenantId, id: d.id },
    });
    await db.manufacturingDeclaration.update({
      where: { id: d.id },
      data: { evidence: { ...(original.evidence as any), version: 1 } },
    });
    expect((await f.mc('get', reviewPath).expect(200)).body.blockedReasons.join(' ')).toMatch(/v2/);
    await f.mc('post', reversePath, body).expect(409);
    await db.manufacturingDeclaration.update({
      where: { id: d.id },
      data: { evidence: original.evidence as any },
    });
    const view = (await f.mc('get', f.path).expect(200)).body;
    await f.post(`${f.path}/declarations`, {
      ...f.body,
      operationKey: randomUUID(),
      expectedUpdatedAt: view.updatedAt,
      goodQuantity: 0,
      scrapQuantity: 2,
      outputLotId: undefined,
      consumptions: [{ itemId: f.item.id, fromBinId: f.a.id, quantity: '0' }],
    });
    await f.mc('post', reversePath, body).expect(409); // order version changed
    await f.post(`manufacturing/orders/${f.order.id}/complete`, {});
    expect((await f.mc('get', reviewPath).expect(200)).body.blockedReasons.join(' ')).toMatch(
      /terminé/,
    );
    await f.mc('post', reversePath, body).expect(409);
  });

  it('I2e can reverse a scrap-only declaration without manufacturing stock', async () => {
    const f = await manufacturingFixture();
    const d = await f.post(`${f.path}/declarations`, {
      ...f.body,
      goodQuantity: 0,
      scrapQuantity: 1,
      outputLotId: undefined,
      consumptions: [{ itemId: f.item.id, fromBinId: f.a.id, quantity: '0' }],
    });
    const base = `${f.path}/declarations/${d.id}`;
    const preview = (await f.mc('get', `${base}/reversal-preview`).expect(200)).body;
    expect(preview.effects).toEqual([]);
    await f.post(`${base}/reverse`, {
      expectedUpdatedAt: preview.expectedUpdatedAt,
      reviewToken: preview.reviewToken,
      operationKey: randomUUID(),
      reason: 'Rebut saisi en double',
    });
    expect((await f.mc('get', f.path).expect(200)).body).toMatchObject({ remaining: 5, scrap: 0 });
    expect(
      await db.stockMovement.count({
        where: { tenantId: f.tenantId, refType: 'manufacturing-reversal', itemId: f.product.id },
      }),
    ).toBe(0);
  });

  it('I2e rolls back a mid-compensation failure and still accepts the exact retry', async () => {
    const f = await manufacturingFixture();
    const d = await f.post(`${f.path}/declarations`, f.body);
    const base = `${f.path}/declarations/${d.id}`;
    const p = (await f.mc('get', `${base}/reversal-preview`).expect(200)).body;
    const body = {
      operationKey: randomUUID(),
      expectedUpdatedAt: p.expectedUpdatedAt,
      reviewToken: p.reviewToken,
      reason: 'Test atomique',
    };
    const inventory = app.get(InventoryService),
      original = inventory.postMovement.bind(inventory);
    let writes = 0;
    const spy = jest.spyOn(inventory, 'postMovement').mockImplementation(async (tx, args) => {
      if (++writes === 2) throw new Error('Injected stock writer failure');
      return original(tx, args);
    });
    try {
      await f.mc('post', `${base}/reverse`, body).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await db.manufacturingDeclarationReversal.count({
        where: { tenantId: f.tenantId, declarationId: d.id },
      }),
    ).toBe(0);
    expect(
      (
        await db.inventoryLevel.findFirstOrThrow({
          where: { tenantId: f.tenantId, itemId: f.product.id, binId: f.b.id },
        })
      ).qtyOnHand.toFixed(),
    ).toBe('2');
    expect((await f.mc('get', f.path).expect(200)).body).toMatchObject({
      good: 2,
      scrap: 1,
      remaining: 2,
    });
    expect((await f.post(`${base}/reverse`, body)).replayed).toBe(false);
  });

  it('I2d validates input/output lots and rolls every movement back if a chosen lot is short', async () => {
    const f = await manufacturingFixture(),
      foreign = await fixture(1);
    const post = (data: object) => f.mc('post', `${f.path}/declarations`, data);
    const { outputLotId, ...withoutOutput } = f.body;
    await post(withoutOutput).expect(409);
    const { lotId, ...withoutInput } = f.body.consumptions[0];
    await post({ ...f.body, consumptions: [withoutInput] }).expect(409);
    for (const id of [null, '', 42, f.lot.id, foreign.lot.id])
      await post({ ...f.body, outputLotId: id }).expect(400);
    await post({
      ...f.body,
      consumptions: [{ ...f.body.consumptions[0], lotId: foreign.lot.id }],
    }).expect(400);
    await post({
      ...f.body,
      consumptions: [f.body.consumptions[0], { ...f.body.consumptions[1], quantity: '4.001' }],
    }).expect(409);
    await post({ ...f.body, goodQuantity: 0 }).expect(400);
    await post({ ...f.body, consumptions: [{ ...f.body.consumptions[0], quantity: '0' }] }).expect(
      400,
    );
    expect(
      await db.manufacturingDeclaration.count({
        where: { tenantId: f.tenantId, orderId: f.order.id },
      }),
    ).toBe(0);
    expect(
      await db.stockMovement.count({ where: { tenantId: f.tenantId, itemId: f.product.id } }),
    ).toBe(0);
    expect(
      (
        await db.inventoryLevel.findFirstOrThrow({
          where: { tenantId: f.tenantId, itemId: f.item.id, binId: f.a.id },
        })
      ).qtyOnHand.toString(),
    ).toBe('7');
    expect((await f.mc('get', f.path).expect(200)).body.updatedAt).toBe(f.order.updatedAt);
    await assertBalances(f);
  });
  it('I2d captures multi-lot genealogy once, guards read links and records scrap without output stock', async () => {
    const f = await manufacturingFixture();
    const replies = await Promise.all([
      f.mc('post', `${f.path}/declarations`, f.body).expect(201),
      f.mc('post', `${f.path}/declarations`, f.body).expect(201),
    ]);
    expect(replies[0].body.id).toBe(replies[1].body.id);
    expect(replies.filter((r) => r.body.replayed)).toHaveLength(1);
    await f.mc('post', `${f.path}/declarations`, { ...f.body, outputLotId: 'changed' }).expect(409);
    await f.mc('post', `${f.path}/declarations`, f.body, 'manager2').expect(409);
    await f.mc('post', `${f.path}/declarations`, f.body, 'manufacturing-reader').expect(403);
    const view = (await f.mc('get', f.path, undefined, 'manufacturing-reader').expect(200)).body;
    expect(view).toMatchObject({ good: 2, scrap: 1, remaining: 2 });
    const evidence = view.declarations[0].evidence;
    expect(evidence.version).toBe(2);
    expect(evidence.movements.map((m: any) => m.lot.code)).toEqual([
      'LOT-A',
      'RAW-B',
      'FINISHED-A',
    ]);
    expect(evidence.movements[0].lot).toMatchObject({
      supplierLot: 'FOURN-A',
      expiresOn: '2027-09-01',
    });
    expect(view.declarations[0]).not.toHaveProperty('fingerprint');
    const journal = `wms/inventory/movements?lotId=${f.output.id}`;
    expect((await f.mc('get', journal).expect(200)).body.items[0].source).toMatchObject({
      kind: 'manufacturing-order',
      id: f.order.id,
    });
    expect(
      (await f.mc('get', journal, undefined, 'reader').expect(200)).body.items[0].source,
    ).toBeNull();
    await call('get', f.path).expect(404);
    const { outputLotId, ...scrapOnly } = f.body;
    await f.post(`${f.path}/declarations`, {
      ...scrapOnly,
      operationKey: randomUUID(),
      expectedUpdatedAt: view.updatedAt,
      goodQuantity: 0,
      scrapQuantity: 2,
      consumptions: [{ itemId: f.item.id, fromBinId: f.a.id, quantity: '0' }],
    });
    expect(
      (
        await db.wmsLotBalance.findFirstOrThrow({
          where: { tenantId: f.tenantId, lotId: f.output.id },
        })
      ).qtyOnHand.toString(),
    ).toBe('2');
    const final = (await f.mc('get', f.path).expect(200)).body;
    expect(final.declarations[1].evidence.movements).toEqual([]);
    await f.post(`manufacturing/orders/${f.order.id}/complete`, {});
    expect((await f.post(`${f.path}/declarations`, f.body)).replayed).toBe(true);
    const wms = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    const where = { tenantId_moduleId: { tenantId: f.tenantId, moduleId: wms.id } };
    await db.tenantModule.update({ where, data: { enabled: false } });
    app.get(TenantModulesCacheService).invalidate(f.tenantId);
    try {
      await f.mc('get', f.path).expect(403);
      await f.mc('post', `${f.path}/declarations`, f.body).expect(403);
    } finally {
      await db.tenantModule.update({ where, data: { enabled: true } });
      app.get(TenantModulesCacheService).invalidate(f.tenantId);
    }
    await assertBalances(f);
  });
  async function serviceFixture(tracked = true) {
    const f = await fixture(3, tracked);
    const sc = (method: 'get' | 'post' | 'patch', path: string, data?: object, role = 'manager') =>
      call(method, path, data, role, 3);
    const post = async (path: string, data: object) =>
      (await sc('post', path, data).expect(201)).body;
    const product = await post('services/data/items', {
      code: randomUUID(),
      name: 'Pièce avec provenance',
      kind: 'GOODS',
      unit: 'EA',
    });
    await sc('patch', `services/items/${product.id}/stock-link`, {
      wmsItemId: f.item.id,
      expectedUpdatedAt: product.updatedAt,
    }).expect(200);
    const partner = await post('services/data/customers', {
      code: randomUUID(),
      name: 'Client lots I2c',
    });
    let project = await post('services/projects', {
      title: 'Intervention lots I2c',
      partnerId: partner.id,
    });
    project = await post(`services/projects/${project.id}/transition`, {
      status: 'ACTIVE',
      expectedUpdatedAt: project.updatedAt,
    });
    let job = await post('services/jobs', { title: 'Pose de pièces', projectId: project.id });
    job = await post(`services/jobs/${job.id}/transition`, {
      status: 'IN_PROGRESS',
      expectedUpdatedAt: job.updatedAt,
    });
    expect((await adjust(f, 5)).status).toBe(201);
    const path = `services/jobs/${job.id}/parts`;
    const body = {
      catalogItemId: product.id,
      binId: f.a.id,
      ...(f.lot ? { lotId: f.lot.id } : {}),
      quantity: 2,
      note: 'Installation',
      expectedUpdatedAt: job.updatedAt,
      operationKey: randomUUID(),
    };
    const version = async () =>
      (await sc('get', `services/jobs/${job.id}`).expect(200)).body.updatedAt;
    return { ...f, sc, post, product, project, job, path, body, version };
  }
  it('I2c validates explicit lot ownership and rolls back shortages without using another lot', async () => {
    const f = await serviceFixture(),
      foreign = await fixture(1),
      other = await fixture(3);
    const lotB = await f.post(`wms/items/${f.item.id}/lots`, { code: 'LOT-B' });
    expect((await adjust(f, 20, lotB.id)).status).toBe(201);
    const { lotId, ...withoutLot } = f.body;
    await f.sc('post', f.path, withoutLot).expect(409);
    for (const invalid of [null, '', 42])
      await f.sc('post', f.path, { ...f.body, lotId: invalid }).expect(400);
    for (const invalid of [foreign.lot.id, other.lot.id])
      await f.sc('post', f.path, { ...f.body, lotId: invalid }).expect(400);
    await f.sc('post', f.path, { ...f.body, quantity: 6 }).expect(409);
    expect(
      await db.servicePartUsage.count({ where: { tenantId: f.tenantId, jobId: f.job.id } }),
    ).toBe(0);
    expect(
      await db.stockMovement.count({
        where: { tenantId: f.tenantId, itemId: f.item.id, type: 'PICK' },
      }),
    ).toBe(0);
    expect(await f.version()).toBe(f.job.updatedAt);
    await assertBalances(f);
    const plain = await serviceFixture(false);
    await plain.sc('post', plain.path, { ...plain.body, lotId }).expect(400);
    const legacy = await plain.post(plain.path, plain.body);
    expect(legacy.lotId).toBeNull();
    expect(legacy.lotSnapshot).toBeNull();
    expect((await plain.post(plain.path, plain.body)).replayed).toBe(true);
  });
  it('blocks Services use but accepts return into a quarantined lot without releasing it', async () => {
    const f = await serviceFixture();
    const part = await f.post(f.path, f.body);
    await f.post(`wms/items/${f.item.id}/lots/${f.lot.id}/quarantine`, {
      operationKey: randomUUID(),
      expectedRevision: 0,
      reason: 'Pièce suspecte après montage',
    });
    await f
      .sc('post', f.path, {
        ...f.body,
        operationKey: randomUUID(),
        expectedUpdatedAt: await f.version(),
      })
      .expect(409);
    await f.post(`${f.path}/${part.id}/return`, {
      operationKey: randomUUID(),
      quantity: 1,
      reason: 'Retour pour inspection',
      expectedUpdatedAt: await f.version(),
    });
    const lot = (await f.sc('get', `wms/items/${f.item.id}/lots/${f.lot.id}`).expect(200)).body;
    expect(lot.disposition).toBe('QUARANTINED');
    expect(lot.balances[0].qtyOnHand).toBe('4');
    await assertBalances(f);
  });
  it('I2c captures a lot once, replays exactly and returns to that lot after unlinking the product', async () => {
    const f = await serviceFixture();
    const replies = await Promise.all([
      f.sc('post', f.path, f.body).expect(201),
      f.sc('post', f.path, f.body).expect(201),
    ]);
    expect(replies.filter((r) => r.body.replayed)).toHaveLength(1);
    const part = replies[0].body;
    expect(part.lotSnapshot).toEqual({
      code: 'LOT-A',
      supplierLot: 'FOURN-A',
      manufacturedOn: '2026-09-01',
      expiresOn: '2027-09-01',
    });
    expect(part.lotId).toBe(f.lot.id);
    await f.sc('post', f.path, { ...f.body, lotId: 'different' }).expect(409);
    await f.sc('post', f.path, f.body, 'manager2').expect(409);
    await f.sc('post', f.path, f.body, 'service-reader').expect(403);
    const link = (await f.sc('get', `services/items/${f.product.id}/stock-link`).expect(200)).body;
    await f
      .sc('patch', `services/items/${f.product.id}/stock-link`, {
        wmsItemId: null,
        expectedUpdatedAt: link.updatedAt,
      })
      .expect(200);
    const returnPath = `${f.path}/${part.id}/return`;
    const rb = {
      operationKey: randomUUID(),
      quantity: 0.625,
      reason: 'Pièces non utilisées',
      expectedUpdatedAt: await f.version(),
    };
    await f.sc('post', returnPath, { ...rb, lotId: f.lot.id }).expect(400);
    const returns = await Promise.all([
      f.sc('post', returnPath, rb).expect(201),
      f.sc('post', returnPath, rb).expect(201),
    ]);
    expect(returns.filter((r) => r.body.replayed)).toHaveLength(1);
    await f
      .sc('post', returnPath, {
        ...rb,
        operationKey: randomUUID(),
        quantity: 1.5,
        expectedUpdatedAt: await f.version(),
      })
      .expect(409);
    const history = (await f.sc('get', f.path, undefined, 'service-reader').expect(200)).body
      .items[0];
    expect(history.remainingQuantity).toBe('1.375');
    const moves = await db.stockMovement.findMany({
      where: { tenantId: f.tenantId, itemId: f.item.id },
    });
    expect(moves).toHaveLength(3);
    expect(moves.every((m) => m.lotId === f.lot.id)).toBe(true);
    expect(moves.find((m) => m.type === 'RECEIPT')?.toBinId).toBe(f.a.id);
    expect(
      (
        await db.wmsLotBalance.findFirstOrThrow({
          where: { tenantId: f.tenantId, lotId: f.lot.id },
        })
      ).qtyOnHand.toString(),
    ).toBe('3.625');
    await assertBalances(f);
    const wms = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    const where = { tenantId_moduleId: { tenantId: f.tenantId, moduleId: wms.id } };
    await db.tenantModule.update({ where, data: { enabled: false } });
    app.get(TenantModulesCacheService).invalidate(f.tenantId);
    try {
      const archived = (await f.sc('get', f.path, undefined, 'service-reader').expect(200)).body
        .items[0];
      expect(archived.lotSnapshot).toEqual(part.lotSnapshot);
      expect(JSON.stringify(archived)).not.toMatch(/qtyOnHand|totalAmount|secretHash/);
      await f.sc('post', f.path, f.body).expect(403);
      await f.sc('post', returnPath, rb).expect(403);
      await call('get', f.path).expect(404);
    } finally {
      await db.tenantModule.update({ where, data: { enabled: true } });
      app.get(TenantModulesCacheService).invalidate(f.tenantId);
    }
  });
  it('keeps existing/untracked items unchanged and tracking immutable', async () => {
    await call('post', 'wms/items', {
      sku: randomUUID(),
      name: 'Invalid tracking',
      lotTracked: null,
    }).expect(400);
    const f = await fixture(0, false);
    expect(f.item.lotTracked).toBe(false);
    await call('patch', `wms/items/${f.item.id}`, { lotTracked: true }).expect(409);
    await call('post', f.path, { code: 'NO' }).expect(409);
    expect((await adjust(f, 2)).status).toBe(201);
    expect((await call('get', 'wms/inventory?itemId=' + f.item.id)).body[0].qtyOnHand).toBe('2');
    const tracked = await fixture();
    await call('patch', `wms/items/${tracked.item.id}`, { lotTracked: false }).expect(409);
  });
  it.each([
    { code: '' },
    { code: 'A\nB' },
    { code: 'X', expiresOn: '2026-02-30' },
    { code: 'X', manufacturedOn: '2026-10-01', expiresOn: '2026-09-01' },
    { code: 'X', expiresOn: '2026-09-01T00:00:00Z' },
  ])('validates lot identity/dates %j', async (data) => {
    const f = await fixture();
    await call('post', f.path, data).expect(400);
  });
  it('duplicate identity is conflict; same code allowed on another item; no stock from lot creation', async () => {
    const f = await fixture();
    await call('post', f.path, { code: ' LOT-A ' }).expect(409);
    await fixture();
    expect(
      await db.stockMovement.count({ where: { tenantId: f.tenantId, itemId: f.item.id } }),
    ).toBe(0);
    expect((await call('get', f.path)).body.items[0].qtyOnHand).toBe('0');
  });
  it('enforces module, permissions and tenant/item/bin boundaries', async () => {
    const f = await fixture(),
      foreign = await fixture(1),
      other = await fixture();
    await call('post', f.path, { code: 'READER' }, 'reader').expect(403);
    await call('get', f.path, undefined, 'reader').expect(200);
    await call('get', f.path, undefined, 'manager', 1).expect(404);
    await call('get', f.path, undefined, 'manager', 2).expect(403);
    await call('get', `${f.path}?binId=${foreign.a.id}`).expect(404);
    expect((await adjust(f, 1, foreign.lot.id)).status).toBe(400);
    expect((await adjust(f, 1, other.lot.id)).status).toBe(400);
    await call('get', `wms/inventory/movements?lotId=${foreign.lot.id}`).expect(400);
  });
  it('rejects all missing-lot stock writes, and lots on untracked items', async () => {
    const f = await fixture(),
      plain = await fixture(0, false);
    await call('post', 'wms/inventory/adjust', {
      itemId: f.item.id,
      binId: f.a.id,
      qtyDelta: 1,
    }).expect(409);
    expect((await adjust(plain, 1, f.lot.id)).status).toBe(400);
    for (const kind of ['receipts', 'pick-orders']) {
      const d = (await call('post', `wms/${kind}`, { locationId: f.site.id }).expect(201)).body;
      await call('post', `wms/${kind}/${d.id}/lines`, {
        itemId: f.item.id,
        [kind === 'receipts' ? 'toBinId' : 'fromBinId']: f.a.id,
        qty: 1,
      }).expect(409);
    }
    await expect(
      db.$transaction((tx) =>
        app.get(InventoryService).postMovement(tx, {
          tenantId: f.tenantId,
          itemId: f.item.id,
          toBinId: f.a.id,
          type: StockMovementType.RECEIPT,
          qty: 1,
        }),
      ),
    ).rejects.toThrow('lot explicite');
    expect(
      await db.stockMovement.count({ where: { tenantId: f.tenantId, itemId: f.item.id } }),
    ).toBe(0);
  });
  it('receives decimals, persists proof, and does not post twice', async () => {
    const f = await fixture(),
      d = await doc(f, 'receipts', [
        { qty: 0.1, lotId: f.lot.id },
        { qty: 0.2, lotId: f.lot.id },
      ]);
    expect(d.lines[0].lot.code).toBe('LOT-A');
    await call('post', `wms/receipts/${d.id}/post`, { expectedUpdatedAt: d.updatedAt }).expect(201);
    await call('post', `wms/receipts/${d.id}/post`, { expectedUpdatedAt: d.updatedAt }).expect(409);
    expect((await call('get', f.path)).body.items[0].qtyOnHand).toBe('0.3');
    await assertBalances(f);
  });
  it('readiness sums repeated lot lines, refuses aggregate fallback, and posting rolls back atomically', async () => {
    const f = await fixture(),
      second = (await call('post', f.path, { code: 'LOT-B' }).expect(201)).body;
    expect((await adjust(f, 3)).status).toBe(201);
    expect((await adjust(f, 10, second.id)).status).toBe(201);
    const d = await doc(f, 'pick-orders', [
      { qty: 2, lotId: f.lot.id },
      { qty: 2, lotId: f.lot.id },
    ]);
    expect(d.readiness.canExecute).toBe(false);
    expect(
      d.readiness.lines.every((l: any) => l.stockOnHand === '3' && l.requiredFromBin === '4'),
    ).toBe(true);
    await call('post', `wms/pick-orders/${d.id}/complete`, {
      expectedUpdatedAt: d.updatedAt,
    }).expect(409);
    expect(await db.stockMovement.count({ where: { tenantId: f.tenantId, refId: d.id } })).toBe(0);
    expect((await call('get', `wms/pick-orders/${d.id}`)).body.status).toBe('OPEN');
    await assertBalances(f);
  });
  it('moves the chosen lot; exact replay after source empties; different lot conflicts', async () => {
    const f = await fixture();
    await adjust(f, 1.125);
    const body = {
      operationKey: randomUUID(),
      itemId: f.item.id,
      lotId: f.lot.id,
      fromBinId: f.a.id,
      toBinId: f.b.id,
      qty: 1.125,
    };
    const first = (await call('post', 'wms/inventory/move', body).expect(201)).body;
    expect((await call('post', 'wms/inventory/move', body).expect(201)).body).toMatchObject({
      movementId: first.movementId,
      replayed: true,
    });
    await call('post', 'wms/inventory/move', { ...body, lotId: 'different' }).expect(409);
    expect((await call('get', `${f.path}?binId=${f.a.id}`)).body.total).toBe(0);
    expect((await call('get', `${f.path}?binId=${f.b.id}`)).body.items[0].qtyOnHand).toBe('1.125');
    const journal = (await call('get', `wms/inventory/movements?lotId=${f.lot.id}`).expect(200))
      .body;
    expect(journal.total).toBe(2);
    expect(
      journal.items.every((m: any) => m.lot.code === 'LOT-A' && m.lot.expiresOn === '2027-09-01'),
    ).toBe(true);
    await assertBalances(f);
  });
  it('concurrent moves cannot overspend one lot; negative adjustments cannot borrow another lot', async () => {
    const f = await fixture(),
      other = (await call('post', f.path, { code: 'OTHER' }).expect(201)).body;
    await adjust(f, 2);
    await adjust(f, 10, other.id);
    const results = await Promise.all(
      [1, 2].map(() =>
        call('post', 'wms/inventory/move', {
          operationKey: randomUUID(),
          itemId: f.item.id,
          lotId: f.lot.id,
          fromBinId: f.a.id,
          toBinId: f.b.id,
          qty: 2,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await adjust(f, -1)).status).toBe(409);
    await assertBalances(f);
  });
  it('completes explicit lot picks and dates remain advisory; counts capture explicit lots', async () => {
    const f = await fixture(),
      expired = (await call('post', f.path, { code: 'OLD', expiresOn: '2020-01-01' }).expect(201))
        .body;
    await adjust(f, 2, expired.id);
    const cc = (await call('post', 'wms/cycle-counts', { binId: f.a.id }).expect(201)).body;
    expect(cc.lines).toHaveLength(1);
    expect(cc.lines[0].lotId).toBe(expired.id);
    const d = await doc(f, 'pick-orders', [{ qty: 1, lotId: expired.id }]);
    expect(d.readiness.canExecute).toBe(true);
    await call('post', `wms/pick-orders/${d.id}/complete`, {
      expectedUpdatedAt: d.updatedAt,
    }).expect(201);
    await assertBalances(f);
  });
  it('I2b counts mixed stock by item/lot, requires every line including zero and reconciles once', async () => {
    const f = await fixture(),
      plain = await fixture(0, false);
    const lot2 = (await call('post', f.path, { code: 'LOT-B' }).expect(201)).body;
    await adjust(f, 1.125);
    await adjust(f, 4, lot2.id);
    await adjust(plain, 3, undefined, f.a.id);
    const c = (await call('post', 'wms/cycle-counts', { binId: f.a.id }).expect(201)).body;
    expect(c.lines).toHaveLength(3);
    expect(c.freshness.valid).toBe(true);
    expect(c.lines.every((l: any) => l.unitSnapshot === 'EA')).toBe(true);
    const path = `wms/cycle-counts/${c.id}`;
    const counts = c.lines.map((l: any) => ({
      lineId: l.id,
      countedQty: l.lotId === f.lot.id ? 0 : l.lotId === lot2.id ? 4.25 : 3,
    }));
    await call('post', `${path}/counts`, { counts: counts.slice(0, 2) }).expect(400);
    await call('post', `${path}/counts`, { counts: [counts[0], counts[0], counts[2]] }).expect(400);
    await call('post', `${path}/counts`, {
      counts: [...counts.slice(0, 2), { lineId: 'foreign', countedQty: 0 }],
    }).expect(400);
    await call('post', `${path}/counts`, {
      counts,
      expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
    }).expect(409);
    const saved = (
      await call('post', `${path}/counts`, { counts, expectedUpdatedAt: c.updatedAt }).expect(201)
    ).body;
    expect(await db.stockMovement.count({ where: { tenantId: f.tenantId, refId: c.id } })).toBe(0);
    const replies = await Promise.all(
      [1, 2, 3].map(() =>
        call('post', `${path}/reconcile`, { expectedUpdatedAt: saved.updatedAt }),
      ),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const moves = await db.stockMovement.findMany({ where: { tenantId: f.tenantId, refId: c.id } });
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => m.lotId).sort()).toEqual([f.lot.id, lot2.id].sort());
    expect(moves.every((m) => m.unitSnapshot === 'EA')).toBe(true);
    expect(
      Number(
        (await db.wmsLotBalance.findFirstOrThrow({ where: { lotId: f.lot.id, binId: f.a.id } }))
          .qtyOnHand,
      ),
    ).toBe(0);
    await assertBalances(f);
    expect((await call('get', path).expect(200)).body.freshness).toBeNull();
  });
  it('I2b catches net-zero movements before recording and between recording/reconciliation', async () => {
    for (const recorded of [false, true]) {
      const f = await fixture();
      await adjust(f, 5);
      let c = (await call('post', 'wms/cycle-counts', { binId: f.a.id }).expect(201)).body;
      const path = `wms/cycle-counts/${c.id}`,
        counts = [{ lineId: c.lines[0].id, countedQty: 4 }];
      if (recorded) c = (await call('post', `${path}/counts`, { counts }).expect(201)).body;
      await adjust(f, 1);
      await adjust(f, -1);
      expect((await call('get', path).expect(200)).body.freshness.valid).toBe(false);
      await call(
        'post',
        `${path}/${recorded ? 'reconcile' : 'counts'}`,
        recorded ? {} : { counts },
      ).expect(409);
      expect(await db.stockMovement.count({ where: { tenantId: f.tenantId, refId: c.id } })).toBe(
        0,
      );
      await call('post', `${path}/cancel`, { expectedUpdatedAt: c.updatedAt }).expect(201);
    }
  });
  it('cannot bypass a hold through negative cycle count reconciliation', async () => {
    const f = await fixture();
    await adjust(f, 5);
    const c = (await call('post', 'wms/cycle-counts', { binId: f.a.id }).expect(201)).body;
    const path = `wms/cycle-counts/${c.id}`;
    const counted = (
      await call('post', `${path}/counts`, {
        expectedUpdatedAt: c.updatedAt,
        counts: [{ lineId: c.lines[0].id, countedQty: 3 }],
      }).expect(201)
    ).body;
    await call('post', `${f.path}/${f.lot.id}/quarantine`, {
      operationKey: randomUUID(),
      expectedRevision: 0,
      reason: 'Lot à vérifier',
    }).expect(201);
    await call('post', `${path}/reconcile`, { expectedUpdatedAt: counted.updatedAt }).expect(409);
    expect((await call('get', path).expect(200)).body.status).toBe('COUNTED');
    expect(await db.stockMovement.count({ where: { tenantId: f.tenantId, refId: c.id } })).toBe(0);
  });
  it('I2b movement in another bin does not invalidate the count, but a newly arriving lot does', async () => {
    const f = await fixture();
    await adjust(f, 5);
    const c = (await call('post', 'wms/cycle-counts', { binId: f.a.id }).expect(201)).body;
    await adjust(f, 2, f.lot.id, f.b.id);
    expect((await call('get', `wms/cycle-counts/${c.id}`).expect(200)).body.freshness.valid).toBe(
      true,
    );
    const lot2 = (await call('post', f.path, { code: 'NEW' }).expect(201)).body;
    await adjust(f, 1, lot2.id);
    expect((await call('get', `wms/cycle-counts/${c.id}`).expect(200)).body.freshness.valid).toBe(
      false,
    );
  });
  it('I2b keeps legacy snapshots read-only for reconciliation, never fabricates a watermark', async () => {
    const f = await fixture();
    await adjust(f, 1);
    const old = await db.cycleCount.create({
      data: {
        tenantId: f.tenantId,
        binId: f.a.id,
        number: randomUUID(),
        status: 'COUNTED',
        lines: { create: { tenantId: f.tenantId, itemId: f.item.id, systemQty: 1, countedQty: 0 } },
      },
    });
    const path = `wms/cycle-counts/${old.id}`;
    expect((await call('get', path).expect(200)).body.freshness.reason).toMatch(/historique/);
    await call('post', `${path}/reconcile`, {}).expect(409);
    await call('post', `${path}/cancel`, {}).expect(201);
    expect(await db.stockMovement.count({ where: { refId: old.id } })).toBe(0);
  });
  it('I2b count reads/writes enforce tenant, module and manage rights', async () => {
    const f = await fixture();
    await adjust(f, 1);
    const c = (await call('post', 'wms/cycle-counts', { binId: f.a.id }).expect(201)).body;
    await call('get', `wms/cycle-counts/${c.id}`, undefined, 'reader').expect(200);
    await call('get', `wms/cycle-counts/${c.id}`, undefined, 'manager', 1).expect(404);
    await call('get', `wms/cycle-counts/${c.id}`, undefined, 'manager', 2).expect(403);
    await call('post', 'wms/cycle-counts', { binId: f.a.id }, 'reader').expect(403);
    for (const action of ['counts', 'cancel', 'reconcile'])
      await call(
        'post',
        `wms/cycle-counts/${c.id}/${action}`,
        { counts: [{ lineId: c.lines[0].id, countedQty: 0 }] },
        'reader',
      ).expect(403);
  });
  it('I2b adjustment exact concurrent replay only posts once, even after the lot is emptied', async () => {
    const f = await fixture();
    await adjust(f, 2.125);
    const body = {
      itemId: f.item.id,
      binId: f.a.id,
      lotId: f.lot.id,
      qtyDelta: -2.125,
      note: 'Correction vérifiée',
      operationKey: randomUUID(),
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => call('post', 'wms/inventory/adjust', body)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.movementId)).size).toBe(1);
    expect((await call('post', 'wms/inventory/adjust', body).expect(201)).body.replayed).toBe(true);
    await call('post', 'wms/inventory/adjust', { ...body, qtyDelta: 1 }).expect(409);
    await call('post', 'wms/inventory/adjust', { ...body, lotId: 'other' }).expect(409);
    await call('post', 'wms/inventory/adjust', body, 'reader').expect(403);
    await call('post', 'wms/inventory/adjust', body, 'manager2').expect(409);
    await call('post', 'wms/inventory/adjust', body, 'manager', 2).expect(403);
    await assertBalances(f);
  });
  it('I2b failed adjustment rolls back its key; keys cannot be borrowed from a MOVE', async () => {
    const f = await fixture(),
      operationKey = randomUUID();
    const body = { itemId: f.item.id, binId: f.a.id, lotId: f.lot.id, qtyDelta: -1, operationKey };
    await call('post', 'wms/inventory/adjust', body).expect(409);
    expect(await db.stockMovement.count({ where: { tenantId: f.tenantId, operationKey } })).toBe(0);
    await adjust(f, 3);
    await call('post', 'wms/inventory/adjust', body).expect(201);
    await call('post', 'wms/inventory/move', {
      itemId: f.item.id,
      fromBinId: f.a.id,
      toBinId: f.b.id,
      qty: 1,
      lotId: f.lot.id,
      operationKey,
    }).expect(409);
    await call('post', 'wms/inventory/adjust', body, 'manager', 1).expect(400);
  });
  it('supplier packages and lot proof stay distinct; replay and foreign-lot rejection are atomic', async () => {
    const f = await fixture();
    const item = (
      await call('post', 'purchasing/data/items', {
        code: randomUUID(),
        name: 'Cartons lots',
        kind: 'GOODS',
        unit: 'EA',
      }).expect(201)
    ).body;
    const supplier = (
      await call('post', 'purchasing/data/suppliers', {
        code: randomUUID(),
        name: 'Lots fournisseur',
      }).expect(201)
    ).body;
    const pack = (
      await call('post', `purchasing/data/items/${item.id}/packages`, {
        code: 'BOX',
        label: 'Boîte',
        unitsPerPackage: '12',
        wholeOnly: true,
      }).expect(201)
    ).body;
    await call('patch', `purchasing/items/${item.id}/stock-link`, {
      wmsItemId: f.item.id,
      expectedUpdatedAt: item.updatedAt,
    }).expect(200);
    const draft = (
      await call('post', 'purchasing/orders', {
        supplierId: supplier.id,
        currency: 'CAD',
        lines: [
          {
            catalogItemId: item.id,
            quantity: 24,
            unitPrice: 2,
            packageId: pack.id,
            packageVersion: pack.version,
            packageCount: '2',
          },
        ],
      }).expect(201)
    ).body;
    const order = (
      await call('post', `purchasing/orders/${draft.id}/transition`, {
        status: 'CONFIRMED',
        expectedUpdatedAt: draft.updatedAt,
      }).expect(201)
    ).body;
    const body = {
        operationKey: randomUUID(),
        expectedUpdatedAt: order.updatedAt,
        locationId: f.site.id,
        reference: 'BL-LOTS',
        lines: [
          {
            orderLineId: order.lines[0].id,
            binId: f.a.id,
            quantity: 12,
            packageCount: '1',
            lotId: f.lot.id,
          },
        ],
      },
      path = `purchasing/orders/${order.id}/receipts`;
    await call('post', path, { ...body, lines: [{ ...body.lines[0], lotId: 'foreign' }] }).expect(
      400,
    );
    expect(
      await db.supplierReceipt.count({ where: { tenantId: f.tenantId, orderId: order.id } }),
    ).toBe(0);
    await call('post', path, body).expect(201);
    expect((await call('post', path, body).expect(201)).body.replayed).toBe(true);
    const proof = (await call('get', path, undefined, 'reader').expect(200)).body.items[0].lines[0];
    expect(proof.packageCount).toBe('1');
    expect(proof.receiptLine.lot.code).toBe('LOT-A');
    expect(proof.receiptLine.qty).toBe('12');
    await assertBalances(f);
  });
});
