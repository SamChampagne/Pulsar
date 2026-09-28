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

describe('Supplier order coordinates — purchasing alone, E1b.6', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `supplier-coordinates-${Date.now()}`;
  const tenants: Array<{ id: string; token: string; reader: string }> = [];
  const entryData = (label = 'Siège fournisseur') => ({
    kind: 'ADDRESS',
    label,
    role: 'Achats',
    active: true,
    validFrom: null,
    validUntil: null,
    email: '',
    phone: '',
    notes: 'Note privée',
    address: {
      line1: '12 rue des Ateliers',
      line2: '',
      city: 'Québec',
      region: 'QC',
      countryCode: 'CA',
      postalCode: 'G1K 3X2',
    },
  });
  const call = (
    method: 'get' | 'post' | 'patch',
    path: string,
    body?: any,
    actor = 0,
    reader = false,
  ) =>
    request(http)
      [method](`/api/v1/${path}`)
      .set('Authorization', `Bearer ${reader ? tenants[actor].reader : tenants[actor].token}`)
      .send(body);
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
    const definition = MODULE_CATALOG.find((m) => m.key === 'purchasing')!;
    const module = await db.moduleDefinition.upsert({
      where: { key: 'purchasing' },
      create: definition,
      update: definition,
    });
    for (let i = 0; i < 3; i++) {
      const slug = `${prefix}-${i}`;
      const t = await db.tenant.create({ data: { slug, name: slug } });
      if (i < 2)
        await db.tenantModule.create({
          data: { tenantId: t.id, moduleId: module.id, enabled: true },
        });
      const tokens: string[] = [];
      for (const key of ['manager', 'reader']) {
        const permissions = await db.permission.findMany({
          where: {
            key: {
              in:
                key === 'manager' ? ['purchasing.read', 'purchasing.manage'] : ['purchasing.read'],
            },
          },
        });
        const role = await db.role.create({
          data: {
            tenantId: t.id,
            key,
            name: key,
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
        const email = `${key}@${slug}.test`;
        await db.user.create({
          data: {
            tenantId: t.id,
            email,
            firstName: key,
            lastName: 'Achats',
            status: 'ACTIVE',
            passwordHash: hashSync('Test1234!', 4),
            roles: { create: { roleId: role.id } },
          },
        });
        tokens.push(
          (
            await request(http)
              .post('/api/v1/auth/login')
              .send({ tenant: slug, email, password: 'Test1234!' })
              .expect(200)
          ).body.accessToken,
        );
      }
      tenants.push({ id: t.id, token: tokens[0], reader: tokens[1] });
    }
    console.log(`SUPPLIER_COORDINATES_TENANT=${prefix}-0`);
  }, 120000);
  afterAll(async () => {
    await app?.close();
  });
  async function fixture() {
    const supplier = (
      await call('post', 'purchasing/data/suppliers', {
        code: randomUUID(),
        name: 'Fournisseur indépendant',
      }).expect(201)
    ).body;
    const item = (
      await call('post', 'purchasing/data/items', {
        code: randomUUID(),
        name: 'Pièce',
        kind: 'GOODS',
        unit: 'EA',
      }).expect(201)
    ).body;
    const path = `purchasing/data/suppliers/${supplier.id}/directory`;
    const address = (
      await call('post', path, {
        operationKey: randomUUID(),
        reason: 'Adresse vérifiée',
        entry: entryData(),
      }).expect(201)
    ).body;
    const contact = (
      await call('post', path, {
        operationKey: randomUUID(),
        reason: 'Interlocuteur vérifié',
        entry: {
          ...entryData('Contact commandes'),
          kind: 'CONTACT',
          address: null,
          email: 'commandes@example.test',
        },
      }).expect(201)
    ).body;
    const body = {
      supplierId: supplier.id,
      currency: 'CAD',
      lines: [{ catalogItemId: item.id, quantity: 7, unitPrice: 12.37 }],
    };
    const order = (await call('post', 'purchasing/orders', body).expect(201)).body;
    const orderPath = `purchasing/orders/${order.id}`;
    const selections = {
      billingAddress: { id: address.id, version: 1 },
      deliveryAddress: null,
      contact: { id: contact.id, version: 1 },
    };
    const save = (version = order.updatedAt, choices: any = selections) => ({
      expectedUpdatedAt: version,
      reason: 'Accord fournisseur vérifié',
      selections: choices,
    });
    const confirm = (version: string) =>
      call('post', `${orderPath}/transition`, { status: 'CONFIRMED', expectedUpdatedAt: version });
    return {
      supplier,
      item,
      address,
      contact,
      path,
      body,
      order,
      orderPath,
      selections,
      save,
      confirm,
    };
  }
  it('purchasing alone freezes supplier address/contact without stock, billing, mail or customer creation', async () => {
    const f = await fixture();
    expect(f.supplier.isCustomer).toBe(false);
    const selected = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    expect(selected.roles).toEqual(['billingAddress', 'contact']);
    expect(selected.labels.billingAddress).toBe('Adresse du fournisseur');
    expect(selected.captured.owner.kind).toBe('supplier');
    const committed = (await f.confirm(selected.updatedAt).expect(201)).body;
    expect(committed.documentCoordinates.frozenAt).toBeTruthy();
    expect(committed.documentCoordinates.entries.contact.data.email).toBe('commandes@example.test');
    expect(committed.total).toBe('86.59');
    await call('patch', `${f.orderPath}/coordinates`, f.save(committed.updatedAt)).expect(409);
    await call('patch', f.orderPath, {
      ...f.body,
      currency: 'USD',
      expectedUpdatedAt: committed.updatedAt,
    }).expect(409);
    await call('patch', `${f.path}/${f.address.id}`, {
      operationKey: randomUUID(),
      reason: 'Nouvelle adresse',
      expectedVersion: 1,
      entry: entryData('Siège actuel'),
    }).expect(200);
    await call('patch', `purchasing/data/suppliers/${f.supplier.id}`, {
      expectedUpdatedAt: f.supplier.updatedAt,
      name: 'Nouveau nom',
      active: false,
    }).expect(200);
    const historic = (await call('get', `${f.orderPath}/coordinates`).expect(200)).body;
    expect(historic.captured).toEqual(committed.documentCoordinates);
    expect(historic.issues).toEqual([]);
    expect(historic.identityIssue).toBeNull();
    const closed = (
      await call('post', `${f.orderPath}/transition`, {
        status: 'CLOSED',
        expectedUpdatedAt: committed.updatedAt,
        closeReason: 'Solde abandonné sans stock',
      }).expect(201)
    ).body;
    expect(closed.documentCoordinates).toEqual(committed.documentCoordinates);
    expect(await db.stockMovement.count({ where: { tenantId: tenants[0].id } })).toBe(0);
    expect(await db.customer.count({ where: { tenantId: tenants[0].id } })).toBe(0);
    expect(await db.customerInvoice.count({ where: { tenantId: tenants[0].id } })).toBe(0);
    expect(await db.emailMessage.count({ where: { tenantId: tenants[0].id } })).toBe(0);
    await call('get', 'catalog/partners').expect(403);
    await call('get', 'wms/items').expect(403);
  });
  it('never accepts the supplier directory as buyer receiving destination or a client-supplied snapshot', async () => {
    const f = await fixture();
    await call(
      'patch',
      `${f.orderPath}/coordinates`,
      f.save(f.order.updatedAt, { ...f.selections, deliveryAddress: f.selections.billingAddress }),
    ).expect(400);
    await call('patch', `${f.orderPath}/coordinates`, { ...f.save(), captured: {} }).expect(400);
    await call(
      'patch',
      `${f.orderPath}/coordinates`,
      f.save(f.order.updatedAt, { ...f.selections, contact: f.selections.billingAddress }),
    ).expect(409);
    expect((await call('get', f.orderPath).expect(200)).body.documentCoordinates).toBeNull();
  });
  it('a changed/expired address blocks confirmation until explicit reselection', async () => {
    const f = await fixture();
    const selected = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    await call('patch', `${f.path}/${f.address.id}`, {
      operationKey: randomUUID(),
      reason: 'Adresse changée',
      expectedVersion: 1,
      entry: entryData('Adresse v2'),
    }).expect(200);
    await f.confirm(selected.updatedAt).expect(409);
    expect((await call('get', `${f.orderPath}/coordinates`).expect(200)).body.issues).toHaveLength(
      1,
    );
    await call('patch', `${f.orderPath}/coordinates`, f.save(selected.updatedAt)).expect(409);
    const fresh = (
      await call(
        'patch',
        `${f.orderPath}/coordinates`,
        f.save(selected.updatedAt, {
          ...f.selections,
          billingAddress: { id: f.address.id, version: 2 },
        }),
      ).expect(200)
    ).body;
    await call('patch', `${f.path}/${f.contact.id}`, {
      operationKey: randomUUID(),
      reason: 'Contact expiré',
      expectedVersion: 1,
      entry: {
        ...entryData('Contact expiré'),
        kind: 'CONTACT',
        address: null,
        validUntil: '2020-01-01',
      },
    }).expect(200);
    await f.confirm(fresh.updatedAt).expect(409);
  });
  it('role and identity changes are rechecked, even when the partner is still a customer', async () => {
    const f = await fixture();
    const selected = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    await call('patch', `purchasing/data/suppliers/${f.supplier.id}`, {
      expectedUpdatedAt: f.supplier.updatedAt,
      name: 'Identité changée',
    }).expect(200);
    expect(
      (await call('get', `${f.orderPath}/coordinates`).expect(200)).body.identityIssue,
    ).toBeTruthy();
    await f.confirm(selected.updatedAt).expect(409);
    // Simulate role withdrawal by the partner authority, not by a consumer façade.
    await db.businessPartner.updateMany({
      where: { tenantId: tenants[0].id, id: f.supplier.id },
      data: { isSupplier: false, isCustomer: true },
    });
    await call('patch', `${f.orderPath}/coordinates`, f.save(selected.updatedAt)).expect(409);
    await f.confirm(selected.updatedAt).expect(400);
  });
  it('requires clearing a draft copy before changing supplier; old entry ids are rejected', async () => {
    const f = await fixture(),
      other = await fixture();
    const selected = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    await call('patch', f.orderPath, {
      ...f.body,
      supplierId: other.supplier.id,
      expectedUpdatedAt: selected.updatedAt,
    }).expect(409);
    const cleared = (
      await call(
        'patch',
        `${f.orderPath}/coordinates`,
        f.save(selected.updatedAt, { billingAddress: null, deliveryAddress: null, contact: null }),
      ).expect(200)
    ).body;
    const changed = (
      await call('patch', f.orderPath, {
        ...f.body,
        supplierId: other.supplier.id,
        expectedUpdatedAt: cleared.updatedAt,
      }).expect(200)
    ).body;
    await call('patch', `${f.orderPath}/coordinates`, f.save(changed.updatedAt)).expect(404);
    expect(changed.documentCoordinates).toBeNull();
  });
  it('enforces module, tenant and read-only access on captured data and mutations', async () => {
    const f = await fixture(),
      other = await fixture();
    await call(
      'patch',
      `${f.orderPath}/coordinates`,
      f.save(f.order.updatedAt, other.selections),
    ).expect(404);
    await call('get', `${f.orderPath}/coordinates`, undefined, 1).expect(404);
    await call('patch', `${f.orderPath}/coordinates`, f.save(), 1).expect(404);
    await call('get', `${f.orderPath}/coordinates`, undefined, 2).expect(403);
    await call('get', `${f.orderPath}/coordinates`, undefined, 0, true).expect(200);
    await call('patch', `${f.orderPath}/coordinates`, f.save(), 0, true).expect(403);
    await call(
      'post',
      `${f.orderPath}/transition`,
      { status: 'CONFIRMED', expectedUpdatedAt: f.order.updatedAt },
      0,
      true,
    ).expect(403);
  });
  it('metadata/line edits invalidate the selected parent version and preserve copies', async () => {
    const f = await fixture();
    const selected = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    const edited = (
      await call('patch', f.orderPath, {
        ...f.body,
        lines: [{ ...f.body.lines[0], quantity: 8 }],
        expectedUpdatedAt: selected.updatedAt,
      }).expect(200)
    ).body;
    expect(edited.documentCoordinates).toEqual(selected.captured);
    await f.confirm(selected.updatedAt).expect(409);
    await f.confirm(edited.updatedAt).expect(201);
  });
  it('save/confirm race has one winner and no partial frozen state; lost replies are inspected', async () => {
    const f = await fixture();
    const selected = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(409);
    const res = await Promise.all([
      f.confirm(selected.updatedAt),
      call('patch', `${f.orderPath}/coordinates`, f.save(selected.updatedAt)),
    ]);
    const statuses = res.map((r) => r.status);
    expect(statuses.filter((s) => s >= 200 && s < 300)).toHaveLength(1);
    expect(statuses).toContain(409);
    const current = (await call('get', f.orderPath).expect(200)).body;
    expect(!!current.documentCoordinates.frozenAt).toBe(current.status === 'CONFIRMED');
  });
  it('orders without a copy remain compatible and cancellation preserves a committed copy', async () => {
    const f = await fixture();
    const legacy = (await f.confirm(f.order.updatedAt).expect(201)).body;
    expect(legacy.documentCoordinates).toBeNull();
    const copied = await fixture();
    const selected = (
      await call('patch', `${copied.orderPath}/coordinates`, copied.save()).expect(200)
    ).body;
    const committed = (await copied.confirm(selected.updatedAt).expect(201)).body;
    const cancelled = (
      await call('post', `${copied.orderPath}/transition`, {
        status: 'CANCELLED',
        expectedUpdatedAt: committed.updatedAt,
      }).expect(201)
    ).body;
    expect(cancelled.documentCoordinates).toEqual(committed.documentCoordinates);
  });
});
