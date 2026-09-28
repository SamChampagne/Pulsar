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
import { LedgerService } from '../src/modules/billing/ledger/ledger.service';
import { AuditLogsService } from '../src/core/audit-logs/audit-logs.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('I2m.2b accounting profile and qualified budgets', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `finance-planning-${Date.now()}`,
    base = 'billing/ledger';
  const tenants: { id: string; tokens: Record<string, string> }[] = [];
  const R = 'billing.ledger.read',
    M = 'billing.ledger.manage',
    Q = 'billing.ledger.manage';
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
        planner: [R, 'billing.ledger-currency.manage'],
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
    console.log(`FINANCE_PLANNING_TENANT=${prefix}-0`);
    for (const t of tenants) await app.get(LedgerService).ensureChart(t.id);
  }, 120000);
  afterAll(async () => app?.close());

  const budget = (currency = 'CAD') => ({
    operationKey: randomUUID(),
    name: 'Budget ' + randomUUID(),
    fiscalYear: 2026,
    currency,
    periodFrom: '2026-01-01',
    periodTo: '2026-12-31',
    isActive: true,
    lines: [{ accountCode: '4000', amount: '0.50' }],
  });
  const profile = (target = 'EXTERNAL') => ({
    operationKey: randomUUID(),
    expectedVersion: 0,
    target,
    targetCurrency: 'CAD',
    externalSystem: target === 'EXTERNAL' ? 'External books' : '',
    reason: 'Choix explicite pour les essais',
  });
  let saved: any, input: any;
  it('requires module, read/manage rights and dedicated configuration permission', async () => {
    for (const path of ['billing/accounting-profile', 'billing/budgets']) {
      await call('get', path, undefined, 'manager', 2).expect(403);
      await call('get', path, undefined, 'carrier').expect(403);
    }
    await call('put', 'billing/accounting-profile', profile(), 'reader').expect(403);
    await call('put', 'billing/accounting-profile', profile(), 'writer').expect(403);
    await call('post', 'billing/budgets', budget(), 'reader').expect(403);
  });
  it('starts unconfigured; captures explicit profile without activating accounting', async () => {
    expect((await call('get', 'billing/accounting-profile').expect(200)).body.current).toBeNull();
    for (const change of [
      { target: 'UNKNOWN' },
      { targetCurrency: 'XXX' },
      { externalSystem: ' ' },
      { expectedVersion: 3 },
      { reason: '  ' },
    ]) {
      await call('put', 'billing/accounting-profile', { ...profile(), ...change }).expect(
        change.expectedVersion ? 409 : 400,
      );
    }
    const p = profile();
    const responses = await Promise.all([
      call('put', 'billing/accounting-profile', p).expect(200),
      call('put', 'billing/accounting-profile', p).expect(200),
    ]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    await call('put', 'billing/accounting-profile', { ...p, targetCurrency: 'USD' }).expect(409);
    const r = (await call('get', 'billing/accounting-profile').expect(200)).body;
    expect(r.current).toMatchObject({ version: 1, target: 'EXTERNAL', targetCurrency: 'CAD' });
    expect(r.capabilities).toEqual({
      officialAccounting: false,
      exchangeConversion: false,
      externalSync: false,
    });
    expect(r.history).toHaveLength(1);
    expect(r.current).not.toHaveProperty('actorId');
    expect(
      (await call('get', 'billing/accounting-profile', undefined, 'manager', 1).expect(200)).body
        .current,
    ).toBeNull();
  });
  it('revises target without mutating historical profile or journals', async () => {
    const count = await db.journalEntry.count({ where: { tenantId: tenants[0].id } });
    await call('put', 'billing/accounting-profile', {
      ...profile('NATIVE'),
      expectedVersion: 1,
      targetCurrency: 'USD',
    }).expect(200);
    const r = (await call('get', 'billing/accounting-profile').expect(200)).body;
    expect(r.history.map((h: any) => h.target)).toEqual(['NATIVE', 'EXTERNAL']);
    expect(await db.journalEntry.count({ where: { tenantId: tenants[0].id } })).toBe(count);
    await call('put', 'billing/accounting-profile', { ...profile(), expectedVersion: 1 }).expect(
      409,
    );
  });
  it('requires UUID, exact currency, real frozen period, unique active owned accounts', async () => {
    for (const change of [
      { operationKey: undefined },
      { currency: undefined },
      { currency: 'ZZZ' },
      { periodFrom: '2026-02-30' },
      { periodTo: '2027-01-02' },
      { fiscalYear: 2025 },
      { name: ' ' },
      { lines: [] },
      { lines: [{ accountCode: '4000', amount: 0.5 }] },
      { lines: [{ accountCode: '4000', amount: '0.001' }] },
      { lines: [{ accountCode: 'FOREIGN', amount: '1' }] },
      {
        lines: [
          { accountCode: '4000', amount: '1' },
          { accountCode: '4000', amount: '2' },
        ],
      },
    ])
      await call('post', 'billing/budgets', { ...budget(), ...change }).expect(400);
  });
  it('creates exactly once under concurrency and binds the operation to actor/body', async () => {
    input = budget();
    const r = await Promise.all([
      call('post', 'billing/budgets', input).expect(201),
      call('post', 'billing/budgets', input).expect(201),
    ]);
    saved = r[0].body;
    expect(r[0].body).toEqual(r[1].body);
    expect(saved).toMatchObject({
      currency: 'CAD',
      version: 1,
      lines: [expect.objectContaining({ amount: '0.5' })],
    });
    await call('post', 'billing/budgets', { ...input, currency: 'USD' }).expect(409);
    await call('post', 'billing/budgets', input, 'writer').expect(409);
    expect(
      await db.budgetRevision.count({ where: { tenantId: tenants[0].id, budgetId: saved.id } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { tenantId: tenants[0].id, entityType: 'budget', entityId: saved.id },
      }),
    ).toBe(1);
  });
  it('does not leak budgets, history, or variance across tenants', async () => {
    for (const path of [saved.id, saved.id + '/history', saved.id + '/variance'])
      await call('get', 'billing/budgets/' + path, undefined, 'manager', 1).expect(404);
    expect(
      (await call('get', 'billing/budgets', undefined, 'manager', 1).expect(200)).body,
    ).toEqual([]);
  });
  it('replays committed create before now inactive account checks', async () => {
    await db.chartOfAccount.updateMany({
      where: { tenantId: tenants[0].id, code: '4000' },
      data: { active: false },
    });
    expect((await call('post', 'billing/budgets', input).expect(201)).body).toEqual(saved);
    await call('post', 'billing/budgets', budget()).expect(400);
    await db.chartOfAccount.updateMany({
      where: { tenantId: tenants[0].id, code: '4000' },
      data: { active: true },
    });
  });
  it('stores exact per-currency actuals and scoped exclusions, ignoring current settings', async () => {
    const accounts = await db.chartOfAccount.findMany({
      where: { tenantId: tenants[0].id, code: { in: ['1000', '4000'] } },
    });
    for (const [currency, date, amount] of [
      ['CAD', '2026-01-01', '0.10'],
      ['CAD', '2026-12-31', '0.20'],
      ['USD', '2026-07-01', '90'],
      [null, '2026-07-01', '40'],
      ['CAD', '2027-01-01', '70'],
    ] as const) {
      await db.journalEntry.create({
        data: {
          tenantId: tenants[0].id,
          currency,
          date: new Date(date + 'T23:59:59.999Z'),
          memo: 'Planning tests',
          lines: {
            create: accounts.map((a) => ({
              tenantId: tenants[0].id,
              accountId: a.id,
              debit: a.code === '1000' ? amount : '0',
              credit: a.code === '4000' ? amount : '0',
            })),
          },
        },
      });
    }
    await call('put', 'modules/billing/settings', { settings: { fiscalYearStartMonth: 4 } }).expect(
      200,
    );
    const r = (await call('get', 'billing/budgets/' + saved.id + '/variance').expect(200)).body;
    expect(r.rows[0]).toMatchObject({ budget: '0.50', actual: '0.30', variance: '0.20' });
    expect(r).toMatchObject({
      currency: 'CAD',
      periodFrom: '2026-01-01',
      periodTo: '2026-12-31',
      coverageScope: 'BUDGET_ACCOUNTS',
      coverage: {
        unknownEntries: 1,
        selectedEntries: 2,
        otherCurrencies: [{ currency: 'USD', count: 1 }],
      },
    });
    expect(r).not.toHaveProperty('totalVariance');
  });
  it('rejects immutable field edits; versions concurrent changes and archives without deletion', async () => {
    const body = {
      operationKey: randomUUID(),
      expectedVersion: 1,
      name: saved.name,
      isActive: false,
      lines: input.lines,
    };
    await call('patch', 'billing/budgets/' + saved.id, { ...body, currency: 'USD' }).expect(400);
    const responses = await Promise.all([
      call('patch', 'billing/budgets/' + saved.id, body),
      call('patch', 'billing/budgets/' + saved.id, {
        ...body,
        operationKey: randomUUID(),
        name: 'Race alternative',
      }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    saved = (await call('get', 'billing/budgets/' + saved.id).expect(200)).body;
    expect(saved.version).toBe(2);
    expect(saved.isActive).toBe(false);
    await call('delete', 'billing/budgets/' + saved.id).expect(409);
    expect(
      (await call('get', 'billing/budgets/' + saved.id + '/history').expect(200)).body,
    ).toHaveLength(2);
  });
  it('never infers a currency or period for a historical budget', async () => {
    const old = await db.budget.create({
      data: {
        tenantId: tenants[0].id,
        name: 'Historical',
        fiscalYear: 2026,
        lines: { create: { tenantId: tenants[0].id, accountCode: '4000', amount: 20 } },
      },
    });
    expect((await call('get', 'billing/budgets/' + old.id).expect(200)).body.currency).toBeNull();
    await call('get', 'billing/budgets/' + old.id + '/variance').expect(409);
    await call('patch', 'billing/budgets/' + old.id, {
      operationKey: randomUUID(),
      expectedVersion: 1,
      name: 'Changed',
      isActive: false,
      lines: input.lines,
    }).expect(409);
  });
  it('rolls back both profile and budget when the audit write fails', async () => {
    const a = jest
      .spyOn(app.get(AuditLogsService), 'log')
      .mockRejectedValueOnce(new Error('Audit failure'));
    const b = budget();
    await call('post', 'billing/budgets', b).expect(500);
    a.mockRestore();
    expect(await db.budget.count({ where: { tenantId: tenants[0].id, name: b.name } })).toBe(0);
    expect(
      await db.budgetRevision.count({
        where: { tenantId: tenants[0].id, operationKey: b.operationKey },
      }),
    ).toBe(0);
    const audit = jest
      .spyOn(app.get(AuditLogsService), 'log')
      .mockRejectedValueOnce(new Error('Audit failure'));
    await call('put', 'billing/accounting-profile', { ...profile(), expectedVersion: 2 }).expect(
      500,
    );
    audit.mockRestore();
    expect((await call('get', 'billing/accounting-profile').expect(200)).body.current.version).toBe(
      2,
    );
  });
});
