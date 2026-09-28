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
import { DocumentsService } from '../src/core/documents/documents.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('I2m.1 supplier schedules', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `supplier-schedules-${Date.now()}`,
    base = 'billing/supplier-invoices';
  const tenants: { id: string; tokens: Record<string, string> }[] = [];
  const R = 'billing.supplier-invoices.read',
    M = 'billing.supplier-invoices.manage',
    Q = 'billing.supplier-invoices.qualify';
  function call(
    method: 'get' | 'post' | 'put' | 'delete' | 'patch',
    path: string,
    data?: object,
    role = 'manager',
    tenant = 0,
  ) {
    const r = request(http)
      [method](`/api/v1/${path}`)
      .set('Authorization', `Bearer ${tenants[tenant].tokens[role]}`);
    return data ? r.send(data) : r;
  }
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
        t = await db.tenant.create({ data: { slug, name: slug } }),
        tokens: Record<string, string> = {};
      for (const m of MODULE_CATALOG.filter((m) =>
        i === 0
          ? m.key === 'billing'
          : i === 1
            ? ['billing', 'purchasing', 'wms'].includes(m.key)
            : m.key === 'purchasing',
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
        writer: [R, M, 'billing.supplier-credits.manage'],
        qualifier: [R, Q, 'billing.supplier-credits.qualify'],
        reader: [R],
        planner: [R, 'billing.supplier-schedules.manage'],
        carrier: ['billing.invoices.read', 'billing.invoices.manage'],
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
            lastName: 'Invoices',
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
    console.log(`SUPPLIER_SCHEDULES_TENANT=${prefix}-0`);
    console.log(`SUPPLIER_SCHEDULES_LINKED_TENANT=${prefix}-1`);
  }, 120000);
  afterAll(async () => app?.close());

  const schedule = 'billing/supplier-schedules',
    credits = 'billing/supplier-credits';
  const pdf = Buffer.from('%PDF-1.4\nSchedule fixture\n%%EOF');
  async function fixture(currency = 'CAD') {
    const supplier = (
      await call('post', 'billing/data/suppliers', {
        code: randomUUID(),
        name: 'Fournisseur échéancier',
      }).expect(201)
    ).body;
    const made = (
      await call('post', base, {
        operationKey: randomUUID(),
        supplierId: supplier.id,
        externalNumber: randomUUID(),
        invoiceDate: '2026-09-26',
        dueDate: '2026-10-26',
        currency,
        notes: 'Préparer échéances',
        lines: [{ description: 'Prestation', quantity: '1', unit: 'H', netAmount: '10.10' }],
        taxes: [{ label: 'Taxe déclarée', amount: '0.25' }],
      }).expect(201)
    ).body;
    let row = (await call('get', `${base}/${made.id}`).expect(200)).body;
    row = await qualify(base, row);
    return { supplier, row };
  }
  async function qualify(family: string, row: any) {
    const f = (
      await call('post', `${family}/${row.id}/evidence`)
        .field('operationKey', randomUUID())
        .field('caption', 'Original pour échéancier')
        .attach('file', pdf, { filename: 'original.pdf', contentType: 'application/pdf' })
        .expect(201)
    ).body;
    await call('post', `${family}/${row.id}/qualify`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: row.updatedAt,
      evidenceId: f.id,
      note: 'Fournisseur et montants contrôlés manuellement.',
    }).expect(201);
    return (await call('get', `${family}/${row.id}`).expect(200)).body;
  }
  const plan = (amount = '10.35') => ({
    status: 'CONFIRMED',
    note: 'Dates convenues avec le fournisseur',
    installments: [{ dueDate: '2026-10-26', amount, note: 'Solde prévu' }],
  });
  async function review(id: string, input = plan(), role = 'planner') {
    const r = (await call('post', `${schedule}/invoice/${id}/review`, input, role).expect(201))
      .body;
    return {
      ...r.input,
      reviewToken: r.reviewToken,
      expectedRevisionId: r.expectedRevisionId,
      operationKey: randomUUID(),
      confirmed: true,
    };
  }
  const confirm = (id: string, d: any, role = 'planner') =>
    call('post', `${schedule}/invoice/${id}/confirm`, d, role);
  async function credit(row: any, net = '2.10', tax = '0.05') {
    const made = (
      await call('post', credits, {
        operationKey: randomUUID(),
        invoiceId: row.id,
        externalNumber: randomUUID(),
        creditDate: '2026-09-27',
        reason: 'Réduction financière reçue du fournisseur',
        lines: [{ invoiceLineId: row.lines[0].id, netAmount: net }],
        taxes: [{ position: 0, amount: tax }],
      }).expect(201)
    ).body;
    return qualify(credits, (await call('get', `${credits}/${made.id}`).expect(200)).body);
  }
  async function listed(supplierId: string, extra = '') {
    return (
      await call(
        'get',
        `${schedule}?referenceDate=2026-09-27&supplierId=${supplierId}${extra}`,
        undefined,
        'reader',
      ).expect(200)
    ).body;
  }
  async function physicalCounts() {
    const tenantId = tenants[0].id;
    return Promise.all([
      db.journalEntry.count({ where: { tenantId } }),
      db.payment.count({ where: { tenantId } }),
      db.stockMovement.count({ where: { tenantId } }),
    ]);
  }
  it('reviews without writes and confirms exact installments in Finance alone, without GL/payment/stock effects', async () => {
    const f = await fixture(),
      before = await physicalCounts();
    const d = await review(f.row.id, {
      ...plan(),
      installments: [
        { dueDate: '2026-09-26', amount: '0.10', note: 'Premier versement prévu' },
        { dueDate: '2026-10-26', amount: '10.25', note: 'Solde' },
      ],
    });
    expect(
      await db.supplierInvoiceSchedule.count({
        where: { tenantId: tenants[0].id, invoiceId: f.row.id },
      }),
    ).toBe(0);
    expect(d.expectedRevisionId).toBeNull();
    const made = (await confirm(f.row.id, d).expect(201)).body;
    expect(made.revision).toBe(1);
    const view = (
      await call('get', `${schedule}/invoice/${f.row.id}`, undefined, 'reader').expect(200)
    ).body;
    expect(view.latest).toMatchObject({
      revision: 1,
      status: 'CONFIRMED',
      amountSnapshot: '10.35',
      creditsSnapshot: [],
    });
    expect(view.latest).not.toHaveProperty('fingerprint');
    expect(view.latest).not.toHaveProperty('operationKey');
    const list = await listed(f.supplier.id);
    expect(list.items[0].state).toBe('CONFIRMED');
    expect(list.summary.buckets).toEqual(
      expect.arrayContaining([
        { currency: 'CAD', bucket: 'OVERDUE', amount: '0.10' },
        { currency: 'CAD', bucket: 'WITHIN_30', amount: '10.25' },
      ]),
    );
    expect(await physicalCounts()).toEqual(before);
    expect((await call('get', `${base}/${f.row.id}`).expect(200)).body).toEqual(f.row);
  });
  it('replays exact requests, scopes recovery to actor and refuses a reused key with a different body', async () => {
    const f = await fixture(),
      d = await review(f.row.id),
      made = (await confirm(f.row.id, d).expect(201)).body;
    expect((await confirm(f.row.id, d).expect(201)).body).toEqual({ ...made, replayed: true });
    expect(
      (
        await call('get', `${schedule}/requests/${d.operationKey}`, undefined, 'planner').expect(
          200,
        )
      ).body.id,
    ).toBe(made.id);
    await call('get', `${schedule}/requests/${d.operationKey}`, undefined, 'manager').expect(404);
    await confirm(f.row.id, { ...d, note: 'Autre contenu pour la même demande' }).expect(409);
    await confirm(f.row.id, d, 'manager').expect(409);
  });
  it('serializes competing confirmations and same-key retries', async () => {
    const f = await fixture(),
      d = await review(f.row.id);
    const results = await Promise.all([
      confirm(f.row.id, d),
      confirm(f.row.id, { ...d, operationKey: randomUUID() }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const g = await fixture(),
      same = await review(g.row.id),
      responses = await Promise.all([confirm(g.row.id, same), confirm(g.row.id, same)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
  });
  it('marks new credits for review and excludes the old plan until a fresh exact revision', async () => {
    const f = await fixture(),
      d = await review(f.row.id);
    await confirm(f.row.id, d).expect(201);
    const stale = await review(f.row.id);
    await credit(f.row);
    const list = await listed(f.supplier.id);
    expect(list.items[0]).toMatchObject({
      state: 'REVIEW',
      remaining: '8.20',
      amountSnapshot: '10.35',
    });
    expect(list.summary.buckets).toEqual([]);
    const attempted = await confirm(f.row.id, stale);
    expect([400, 409]).toContain(attempted.status);
    const updated = await review(f.row.id, plan('8.20'));
    await confirm(f.row.id, updated).expect(201);
    const history = (
      await call(
        'get',
        `${schedule}/invoice/${f.row.id}/history?pageSize=1`,
        undefined,
        'reader',
      ).expect(200)
    ).body;
    expect(history.total).toBe(2);
    expect(history.items[0].amountSnapshot).toBe('8.2');
    expect((await listed(f.supplier.id)).items[0].state).toBe('CONFIRMED');
    const old = (
      await call('get', `${schedule}/invoice/${f.row.id}/history?pageSize=1&page=2`).expect(200)
    ).body;
    expect(old.items[0].amountSnapshot).toBe('10.35');
    expect(old.items[0].creditsSnapshot).toEqual([]);
  });
  it('withdraws and reinstates append-only, and replay never replaces a newer revision', async () => {
    const f = await fixture(),
      d = await review(f.row.id);
    await confirm(f.row.id, d).expect(201);
    const withdrawn = await review(f.row.id, {
      status: 'WITHDRAWN',
      note: 'Planning retiré après revue fournisseur',
      installments: [],
    });
    await confirm(f.row.id, withdrawn).expect(201);
    expect((await listed(f.supplier.id)).items[0].state).toBe('WITHDRAWN');
    expect((await listed(f.supplier.id)).summary.buckets).toEqual([]);
    const reinstated = await review(f.row.id, plan());
    await confirm(f.row.id, reinstated).expect(201);
    await confirm(f.row.id, withdrawn).expect(201);
    expect(
      (await call('get', `${schedule}/invoice/${f.row.id}`).expect(200)).body.latest.revision,
    ).toBe(3);
    expect((await listed(f.supplier.id)).items[0].state).toBe('CONFIRMED');
  });
  it('fully credited does not mean paid, and confirms an explicit empty schedule', async () => {
    const f = await fixture();
    await confirm(f.row.id, await review(f.row.id)).expect(201);
    await credit(f.row, '10.10', '0.25');
    expect((await listed(f.supplier.id)).items[0].state).toBe('REVIEW');
    await confirm(f.row.id, await review(f.row.id, { ...plan(), installments: [] })).expect(201);
    const r = await listed(f.supplier.id);
    expect(r.items[0]).toMatchObject({ state: 'ZERO', remaining: '0.00' });
    expect(r.summary.buckets).toEqual([]);
    expect((await call('get', `${base}/${f.row.id}`).expect(200)).body.status).toBe('QUALIFIED');
  });
  it('keeps currencies separated, filters all summary pages, and treats reference dates as classification only', async () => {
    const f = await fixture('USD');
    await confirm(f.row.id, await review(f.row.id)).expect(201);
    const r = await listed(f.supplier.id, '&pageSize=1&currency=USD&state=CONFIRMED');
    expect(r.total).toBe(1);
    expect(r.summary.buckets).toEqual([{ currency: 'USD', bucket: 'WITHIN_30', amount: '10.35' }]);
    const future = (
      await call('get', `${schedule}?referenceDate=2026-11-01&supplierId=${f.supplier.id}`).expect(
        200,
      )
    ).body;
    expect(future.summary.buckets[0].bucket).toBe('OVERDUE');
    expect((await listed(f.supplier.id, '&currency=CAD')).total).toBe(0);
    expect((await listed(f.supplier.id, '&search=%25')).total).toBe(0);
  });
  it('gates every endpoint by module, tenant and dedicated write right', async () => {
    const f = await fixture(),
      d = await review(f.row.id);
    await confirm(f.row.id, d, 'reader').expect(403);
    await confirm(f.row.id, d, 'qualifier').expect(403);
    await call('post', `${schedule}/invoice/${f.row.id}/review`, plan(), 'reader').expect(403);
    await call('get', `${schedule}/invoice/${f.row.id}`, undefined, 'reader', 1).expect(404);
    await call('get', `${schedule}/invoice/${f.row.id}/history`, undefined, 'reader', 1).expect(
      404,
    );
    await call('get', `${schedule}?referenceDate=2026-09-27`, undefined, 'carrier').expect(403);
    await call('get', `${schedule}?referenceDate=2026-09-27`, undefined, 'manager', 2).expect(403);
    await call('post', `${schedule}/invoice/${f.row.id}/confirm`, d, 'manager', 1).expect(400);
  });
  it('requires valid dates, exact amounts, closed bodies, review, version and explicit human confirmation', async () => {
    const f = await fixture(),
      d = await review(f.row.id);
    for (const bad of [
      { ...plan(), installments: [{ dueDate: '2026-02-30', amount: '10.35', note: '' }] },
      { ...plan(), installments: [{ dueDate: '2026-09-25', amount: '10.35', note: '' }] },
      plan('10.34'),
      { ...plan(), note: 'short' },
      { ...plan(), tenantId: 'fake' },
    ])
      await call('post', `${schedule}/invoice/${f.row.id}/review`, bad, 'planner').expect(400);
    await confirm(f.row.id, { ...d, confirmed: false }).expect(400);
    const { expectedRevisionId, ...missing } = d;
    await confirm(f.row.id, missing).expect(400);
    await confirm(f.row.id, { ...d, reviewToken: '0'.repeat(64) }).expect(409);
    for (const q of [
      'referenceDate=2026-02-30',
      'referenceDate=2200-01-01',
      'referenceDate=2026-09-27&page=0',
      'referenceDate=2026-09-27&page=1.5',
      'referenceDate=2026-09-27&page=1000001',
      'referenceDate=2026-09-27&pageSize=101',
      'referenceDate=2026-09-27&state=PAID',
      'referenceDate=2026-09-27&currency=ABC',
      '',
    ])
      await call('get', `${schedule}?${q}`).expect(400);
    await confirm(f.row.id, d).expect(201);
    await confirm(f.row.id, { ...d, operationKey: randomUUID() }).expect(409);
  });
});
