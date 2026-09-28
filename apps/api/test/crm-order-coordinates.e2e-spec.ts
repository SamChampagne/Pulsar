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

describe('CRM-only order coordinates — E1b.5', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `crm-coordinates-${Date.now()}`;
  const tenants: Array<{ id: string; token: string; reader: string }> = [];
  const data = (label = 'Adresse commerciale') => ({
    kind: 'ADDRESS',
    label,
    role: 'Facturation',
    active: true,
    validFrom: null,
    validUntil: null,
    email: '',
    phone: '',
    notes: 'Note privée',
    address: {
      line1: '42 rue du Parc',
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
    const entry = MODULE_CATALOG.find((m) => m.key === 'crm')!;
    const module = await db.moduleDefinition.upsert({
      where: { key: 'crm' },
      create: entry,
      update: entry,
    });
    for (let i = 0; i < 3; i++) {
      const slug = `${prefix}-${i}`;
      const tenant = await db.tenant.create({ data: { slug, name: slug } });
      if (i < 2)
        await db.tenantModule.create({
          data: { tenantId: tenant.id, moduleId: module.id, enabled: true },
        });
      const tokens: string[] = [];
      for (const key of ['manager', 'reader']) {
        const ps = await db.permission.findMany({
          where: { key: { in: key === 'manager' ? ['crm.read', 'crm.manage'] : ['crm.read'] } },
        });
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
            lastName: 'CRM',
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
      tenants.push({ id: tenant.id, token: tokens[0], reader: tokens[1] });
    }
    console.log(`CRM_COORDINATES_TENANT=${prefix}-0`);
  }, 120000);
  afterAll(async () => {
    await app?.close();
  });
  async function fixture() {
    const company = (
      await call('post', 'crm/companies', { name: `Société ${randomUUID().slice(0, 6)}` }).expect(
        201,
      )
    ).body;
    const path = `crm/companies/${company.id}/directory`;
    const entry = (
      await call('post', path, {
        operationKey: randomUUID(),
        reason: 'Adresse choisie',
        entry: data(),
      }).expect(201)
    ).body;
    const order = (await call('post', 'crm/sales-orders', { companyId: company.id }).expect(201))
      .body;
    const orderPath = `crm/sales-orders/${order.id}`;
    const selections = {
      billingAddress: { id: entry.id, version: 1 },
      deliveryAddress: null,
      contact: null,
    };
    const save = (version = order.updatedAt, choices = selections) => ({
      expectedUpdatedAt: version,
      reason: 'Accord commercial vérifié',
      selections: choices,
    });
    return { company, path, entry, order, orderPath, selections, save };
  }
  it('CRM alone captures its company, freezes on confirmation and never creates linked data', async () => {
    const f = await fixture();
    const chosen = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    expect(chosen.captured.owner).toMatchObject({
      kind: 'crm-company',
      id: f.company.id,
      name: f.company.name,
      code: '',
    });
    const confirmed = (
      await call('post', `${f.orderPath}/confirm`, { expectedUpdatedAt: chosen.updatedAt }).expect(
        200,
      )
    ).body;
    expect(confirmed.documentCoordinates.frozenAt).toBeTruthy();
    await call('patch', f.orderPath, {
      currency: 'USD',
      expectedUpdatedAt: confirmed.updatedAt,
    }).expect(409);
    await call('patch', `${f.orderPath}/coordinates`, f.save(confirmed.updatedAt)).expect(409);
    await call('patch', `${f.path}/${f.entry.id}`, {
      operationKey: randomUUID(),
      expectedVersion: 1,
      reason: 'Nouvelle adresse',
      entry: data('Nouveau siège'),
    }).expect(200);
    await call('patch', `crm/companies/${f.company.id}`, {
      name: 'Nouveau nom',
      status: 'INACTIVE',
    }).expect(200);
    const historical = (await call('get', `${f.orderPath}/coordinates`).expect(200)).body;
    expect(historical.captured).toEqual(confirmed.documentCoordinates);
    expect(historical.issues).toEqual([]);
    expect(historical.identityIssue).toBeNull();
    expect(await db.customer.count({ where: { tenantId: tenants[0].id } })).toBe(0);
    expect(await db.customerInvoice.count({ where: { tenantId: tenants[0].id } })).toBe(0);
    expect(await db.transportOrder.count({ where: { tenantId: tenants[0].id } })).toBe(0);
    await call('get', 'transportation/customers').expect(403);
    await call('get', 'billing/customer-invoices').expect(403);
  });
  it('requires explicit refreshed directory version and company identity before commitment', async () => {
    const f = await fixture();
    const chosen = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    await call('post', `${f.orderPath}/confirm`).expect(409);
    await call('patch', `${f.path}/${f.entry.id}`, {
      operationKey: randomUUID(),
      expectedVersion: 1,
      reason: 'Nouvelle version',
      entry: data('Siège v2'),
    }).expect(200);
    expect((await call('get', `${f.orderPath}/coordinates`).expect(200)).body.issues).toHaveLength(
      1,
    );
    await call('post', `${f.orderPath}/confirm`, { expectedUpdatedAt: chosen.updatedAt }).expect(
      409,
    );
    await call('patch', `${f.orderPath}/coordinates`, f.save(chosen.updatedAt)).expect(409);
    const fresh = (
      await call(
        'patch',
        `${f.orderPath}/coordinates`,
        f.save(chosen.updatedAt, {
          ...f.selections,
          billingAddress: { id: f.entry.id, version: 2 },
        }),
      ).expect(200)
    ).body;
    await call('patch', `crm/companies/${f.company.id}`, { name: 'Identité modifiée' }).expect(200);
    expect(
      (await call('get', `${f.orderPath}/coordinates`).expect(200)).body.identityIssue,
    ).toBeTruthy();
    await call('post', `${f.orderPath}/confirm`, { expectedUpdatedAt: fresh.updatedAt }).expect(
      409,
    );
    expect((await call('get', f.orderPath).expect(200)).body.status).toBe('DRAFT');
  });
  it('invalid, expired, inactive and foreign-company selections are rejected', async () => {
    const f = await fixture(),
      other = await fixture();
    await call(
      'patch',
      `${f.orderPath}/coordinates`,
      f.save(f.order.updatedAt, other.selections),
    ).expect(404);
    await call('patch', `${f.orderPath}/coordinates`, { ...f.save(), captured: {} }).expect(400);
    await call('patch', `${f.orderPath}/coordinates`, {
      ...f.save(),
      selections: { ...f.selections, contact: f.selections.billingAddress },
    }).expect(409);
    await call('patch', `${f.path}/${f.entry.id}`, {
      operationKey: randomUUID(),
      expectedVersion: 1,
      reason: 'Fin de validité',
      entry: { ...data(), validUntil: '2020-01-01' },
    }).expect(200);
    await call(
      'patch',
      `${f.orderPath}/coordinates`,
      f.save(f.order.updatedAt, {
        ...f.selections,
        billingAddress: { id: f.entry.id, version: 2 },
      }),
    ).expect(409);
    await call('patch', `crm/companies/${other.company.id}`, { status: 'INACTIVE' }).expect(200);
    await call('patch', `${other.orderPath}/coordinates`, other.save()).expect(409);
  });
  it('enforces tenant, module and read-only boundaries on directory, history and document', async () => {
    const f = await fixture();
    await call('get', f.path, undefined, 1).expect(404);
    await call('get', `${f.path}/${f.entry.id}/history`, undefined, 1).expect(404);
    await call('get', `${f.orderPath}/coordinates`, undefined, 1).expect(404);
    await call('patch', `${f.orderPath}/coordinates`, f.save(), 1).expect(404);
    await call('get', f.path, undefined, 2).expect(403);
    await call('get', `${f.orderPath}/coordinates`, undefined, 2).expect(403);
    await call('get', f.path, undefined, 0, true).expect(200);
    await call('get', `${f.orderPath}/coordinates`, undefined, 0, true).expect(200);
    await call('patch', `${f.orderPath}/coordinates`, f.save(), 0, true).expect(403);
    await call(
      'post',
      f.path,
      { operationKey: randomUUID(), reason: 'Interdit', entry: data() },
      0,
      true,
    ).expect(403);
    await call(
      'post',
      `${f.orderPath}/confirm`,
      { expectedUpdatedAt: f.order.updatedAt },
      0,
      true,
    ).expect(403);
  });
  it('line edits invalidate the reviewed parent version; currency is never implicitly converted', async () => {
    const f = await fixture();
    const chosen = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    await call('post', `${f.orderPath}/line-items`, {
      name: 'Service',
      quantity: 2,
      unitPrice: 100,
    }).expect(201);
    await call('post', `${f.orderPath}/confirm`, { expectedUpdatedAt: chosen.updatedAt }).expect(
      409,
    );
    const current = (await call('get', f.orderPath).expect(200)).body;
    await call('patch', f.orderPath, {
      currency: 'USD',
      expectedUpdatedAt: current.updatedAt,
    }).expect(409);
    await call('post', `${f.orderPath}/confirm`, { expectedUpdatedAt: current.updatedAt }).expect(
      200,
    );
    await call('post', `${f.orderPath}/line-items`, {
      name: 'Late',
      quantity: 1,
      unitPrice: 1,
    }).expect(409);
  });
  it('coordinate-save/confirm concurrency has one winner and an atomic frozen copy', async () => {
    const f = await fixture();
    const chosen = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    const results = await Promise.all([
      call('post', `${f.orderPath}/confirm`, { expectedUpdatedAt: chosen.updatedAt }),
      call('patch', `${f.orderPath}/coordinates`, f.save(chosen.updatedAt)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = (await call('get', f.orderPath).expect(200)).body;
    expect(!!current.documentCoordinates.frozenAt).toBe(current.status === 'CONFIRMED');
  });
  it('lost-save recovery reads persisted copy; directory receipt replay never rewinds history', async () => {
    const f = await fixture();
    await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200);
    await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(409);
    expect(
      (await call('get', `${f.orderPath}/coordinates`).expect(200)).body.captured.entries
        .billingAddress.id,
    ).toBe(f.entry.id);
    const intent = {
      operationKey: randomUUID(),
      reason: 'Contact métier',
      entry: {
        ...data('Contact de livraison'),
        kind: 'CONTACT',
        address: null,
        email: 'livraison@example.test',
      },
    };
    const contact = (await call('post', f.path, intent).expect(201)).body;
    await call('patch', `${f.path}/${contact.id}`, {
      ...intent,
      operationKey: randomUUID(),
      expectedVersion: 1,
      entry: { ...intent.entry, active: false },
    }).expect(200);
    expect((await call('post', f.path, intent).expect(201)).body).toEqual(contact);
    const history = (await call('get', `${f.path}/${contact.id}/history`).expect(200)).body;
    expect(history.items.map((r: any) => r.version)).toEqual([2, 1]);
  });
  it('legacy orders stay unbackfilled, and an explicit clear restores a draft without coordinates', async () => {
    const f = await fixture();
    const chosen = (await call('patch', `${f.orderPath}/coordinates`, f.save()).expect(200)).body;
    await call('patch', `${f.orderPath}/coordinates`, {
      ...f.save(chosen.updatedAt),
      selections: { billingAddress: null, deliveryAddress: null, contact: null },
    }).expect(200);
    const confirmed = (await call('post', `${f.orderPath}/confirm`).expect(200)).body;
    expect(confirmed.documentCoordinates).toBeNull();
    await call('patch', f.orderPath, { currency: 'USD' }).expect(409);
  });
  it('an explicit Customer link never changes directory ownership or copies billing addresses', async () => {
    const f = await fixture();
    const customer = await db.customer.create({
      data: { tenantId: tenants[0].id, code: randomUUID(), name: 'Client comptable distinct' },
    });
    const order = (
      await call('post', 'crm/sales-orders', {
        companyId: f.company.id,
        customerId: customer.id,
      }).expect(201)
    ).body;
    const selected = (
      await call(
        'patch',
        `crm/sales-orders/${order.id}/coordinates`,
        f.save(order.updatedAt),
      ).expect(200)
    ).body;
    expect(selected.captured.owner.kind).toBe('crm-company');
    expect(selected.captured.owner.name).toBe(f.company.name);
    const confirmed = (
      await call('post', `crm/sales-orders/${order.id}/confirm`, {
        expectedUpdatedAt: selected.updatedAt,
      }).expect(200)
    ).body;
    expect(confirmed.customerId).toBe(customer.id);
    expect(confirmed.documentCoordinates.owner.id).toBe(f.company.id);
    expect(
      await db.partyDirectoryEntry.count({
        where: { tenantId: tenants[0].id, customerId: customer.id },
      }),
    ).toBe(0);
  });
  it('database enforces exactly one owner and the company tenant FK', async () => {
    const f = await fixture();
    const customer = await db.customer.create({
      data: { tenantId: tenants[0].id, code: randomUUID(), name: 'Autre propriétaire' },
    });
    await expect(
      db.partyDirectoryEntry.update({
        where: { id: f.entry.id },
        data: { customerId: customer.id },
      }),
    ).rejects.toThrow();
    const foreign = await db.crmCompany.create({
      data: { tenantId: tenants[1].id, name: 'Société autre tenant' },
    });
    await expect(
      db.partyDirectoryEntry.update({ where: { id: f.entry.id }, data: { companyId: foreign.id } }),
    ).rejects.toThrow();
    expect(
      (await db.partyDirectoryEntry.findUniqueOrThrow({ where: { id: f.entry.id } })).companyId,
    ).toBe(f.company.id);
  });
});
