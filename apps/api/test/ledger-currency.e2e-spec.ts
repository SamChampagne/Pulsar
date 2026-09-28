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

describe('I2m.2a qualified ledger', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `ledger-currency-${Date.now()}`,
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
    console.log(`LEDGER_CURRENCY_TENANT=${prefix}-0`);
    for (const t of tenants) await app.get(LedgerService).ensureChart(t.id);
  }, 120000);
  afterAll(async () => app?.close());

  const input = (currency = 'CAD', date = '2026-09-27') => ({
    operationKey: randomUUID(),
    currency,
    date,
    memo: 'Currency proof',
    lines: [
      { accountCode: '1000', debit: '0.10' },
      { accountCode: '1000', debit: '0.20' },
      { accountCode: '4000', credit: '0.30' },
    ],
  });
  async function legacy(
    currency: string | null,
    date = '2026-07-01T23:59:59.999Z',
    amount = '12.34',
    tenant = 0,
  ) {
    const accounts = await db.chartOfAccount.findMany({
      where: { tenantId: tenants[tenant].id, code: { in: ['1000', '4000'] } },
    });
    return db.journalEntry.create({
      data: {
        tenantId: tenants[tenant].id,
        currency,
        date: new Date(date),
        memo: 'Legacy proof',
        lines: {
          create: accounts.map((a) => ({
            tenantId: tenants[tenant].id,
            accountId: a.id,
            debit: a.code === '1000' ? amount : '0',
            credit: a.code === '4000' ? amount : '0',
          })),
        },
      },
    });
  }
  it('requires currency, UUID, real civil date and exact balanced positive cents', async () => {
    for (const change of [
      { currency: undefined },
      { currency: 'ZZZ' },
      { operationKey: undefined },
      { date: '2026-02-30' },
      { date: '2026-09-27T04:00:00Z' },
      {
        lines: [
          { accountCode: '1000', debit: '1.001' },
          { accountCode: '4000', credit: '1.001' },
        ],
      },
      {
        lines: [
          { accountCode: '1000', debit: '0.10' },
          { accountCode: '4000', credit: '0.11' },
        ],
      },
      {
        lines: [
          { accountCode: '1000', debit: '0' },
          { accountCode: '4000', credit: '0' },
        ],
      },
    ]) {
      await call('post', base + '/entries', { ...input(), ...change }).expect(400);
    }
  });
  it('claims concurrent identical requests once, keeps exact money and audit', async () => {
    const p = input();
    const r = await Promise.all([
      call('post', base + '/entries', p).expect(201),
      call('post', base + '/entries', p).expect(201),
    ]);
    expect(r.map((x) => x.body.posted).sort()).toEqual([false, true]);
    expect(r[0].body.journalEntryId).toBe(r[1].body.journalEntryId);
    const e = await db.journalEntry.findUniqueOrThrow({
      where: { id: r[0].body.journalEntryId },
      include: { lines: true },
    });
    expect(e.currency).toBe('CAD');
    expect(e.date.toISOString()).toBe('2026-09-27T00:00:00.000Z');
    expect(e.lines.reduce((n, l) => n + Math.round(Number(l.debit) * 100), 0)).toBe(30);
    expect(
      await db.auditLog.count({
        where: { tenantId: tenants[0].id, entityId: e.id, entityType: 'journal-entry' },
      }),
    ).toBe(1);
    await call('get', base + '/requests/' + p.operationKey).expect(200);
    await call('get', base + '/requests/' + p.operationKey, undefined, 'writer').expect(404);
    await call('get', base + '/requests/' + p.operationKey, undefined, 'manager', 1).expect(404);
    await call('post', base + '/entries', { ...p, currency: 'USD' }).expect(409);
    await call('post', base + '/entries', p, 'writer').expect(409);
  });
  it('replays before revalidating now-inactive accounts', async () => {
    const p = input(),
      r = (await call('post', base + '/entries', p).expect(201)).body;
    await db.chartOfAccount.updateMany({
      where: { tenantId: tenants[0].id, code: '1000' },
      data: { active: false },
    });
    try {
      expect((await call('post', base + '/entries', p).expect(201)).body).toEqual({
        posted: false,
        journalEntryId: r.journalEntryId,
      });
    } finally {
      await db.chartOfAccount.updateMany({
        where: { tenantId: tenants[0].id, code: '1000' },
        data: { active: true },
      });
    }
  });
  it('rolls back journal when transactional audit fails', async () => {
    const p = input(),
      audit = app.get(AuditLogsService),
      real = audit.log.bind(audit);
    const spy = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
      if (entry.entityType === 'journal-entry') throw Error('test atomic audit');
      return real(entry, tx);
    });
    try {
      await call('post', base + '/entries', p).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await db.journalEntry.count({ where: { tenantId: tenants[0].id, sourceId: p.operationKey } }),
    ).toBe(0);
    expect((await call('post', base + '/entries', p).expect(201)).body.posted).toBe(true);
  });
  it('enforces tenant/module/permissions and rejects foreign account codes', async () => {
    await call('post', base + '/entries', input(), 'reader').expect(403);
    await call('post', base + '/entries', input(), 'manager', 2).expect(403);
    await call('get', base + '/trial-balance?currency=CAD', undefined, 'carrier').expect(403);
    await db.chartOfAccount.create({
      data: { tenantId: tenants[1].id, code: 'FOREIGN', name: 'Private', type: 'ASSET' },
    });
    const p = input();
    p.lines[0].accountCode = 'FOREIGN';
    await call('post', base + '/entries', p).expect(400);
    await call('post', base + '/entries', { ...input(), tenantId: tenants[1].id }).expect(400);
  });
  it('never totals CAD, USD or unknown history together; includes entire end date', async () => {
    await legacy('CAD');
    await legacy('USD', undefined, '999.99');
    await legacy(null, undefined, '888.88');
    await legacy('CAD', undefined, '777.77', 1);
    const r = (await call('get', base + '/trial-balance?currency=CAD&asOf=2026-07-01').expect(200))
      .body;
    expect(r).toMatchObject({
      currency: 'CAD',
      totalDebit: '12.34',
      totalCredit: '12.34',
      balanced: true,
      basis: 'TRANSACTION_CURRENCY',
      coverage: {
        selectedEntries: 1,
        unknownEntries: 1,
        otherCurrencies: [{ currency: 'USD', count: 1 }],
      },
    });
    const j = (await call('get', base + '/journal?unqualified=true').expect(200)).body;
    expect(j.items).toHaveLength(1);
    expect(j.items[0].currency).toBeNull();
    expect(j.items[0]).not.toHaveProperty('fingerprint');
    const filtered = (
      await call(
        'get',
        base + '/journal?currency=CAD&dateFrom=2026-07-01&dateTo=2026-07-01',
      ).expect(200)
    ).body;
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].date).toContain('23:59:59.999');
  });
  it.each(['trial-balance', 'journal?currency=CAD&unqualified=true'])(
    'rejects ambiguous ledger view %s',
    async (path) => {
      await call('get', base + '/' + path).expect(400);
    },
  );
  it.each(['profit-and-loss', 'balance-sheet', 'cash-flow', 'ar-aging', 'ap-aging'])(
    'requires explicit currency on %s',
    async (path) => {
      await call('get', 'billing/reports/' + path).expect(400);
    },
  );
  it('projects exact reports and rejects invalid/inverted dates', async () => {
    for (const [path, field] of [
      ['profit-and-loss', 'netIncome'],
      ['balance-sheet', 'totalAssets'],
      ['cash-flow', 'netChange'],
    ]) {
      const q = path === 'balance-sheet' ? 'asOf=2026-07-01' : 'from=2026-07-01&to=2026-07-01';
      const r = (await call('get', 'billing/reports/' + path + '?currency=CAD&' + q).expect(200))
        .body;
      expect(r[field]).toBe('12.34');
      expect(r.coverage.unknownEntries).toBe(1);
    }
    await call(
      'get',
      'billing/reports/profit-and-loss?currency=CAD&from=2026-03-01&to=2026-02-28',
    ).expect(400);
    await call('get', base + '/trial-balance?currency=CAD&asOf=2026-02-30').expect(400);
  });
  it('keeps SQL numeric aggregates exact above safe integer cents', async () => {
    await legacy('EUR', '2026-08-01T00:00:00Z', '90071992547409930.01');
    const r = (await call('get', base + '/trial-balance?currency=EUR').expect(200)).body;
    expect(r.totalDebit).toBe('90071992547409930.01');
    expect(r.totalCredit).toBe(r.totalDebit);
  });
  it('captures invoice and payment currencies, reverses exactly and filters current aging', async () => {
    const tenantId = tenants[0].id;
    const customer = await db.customer.create({
      data: { tenantId, code: randomUUID(), name: 'Currency customer' },
    });
    const mode = await db.modeOfPayment.create({
      data: { tenantId, name: randomUUID(), accountCode: '1000' },
    });
    const invoices = [];
    for (const amount of ['0.10', '0.20']) {
      const inv = await db.customerInvoice.create({
        data: {
          tenantId,
          customerId: customer.id,
          invoiceNumber: randomUUID(),
          currency: 'GBP',
          totalAmount: amount,
          status: 'DRAFT',
        },
      });
      await call('post', 'billing/customer-invoices/' + inv.id + '/approve').expect(201);
      invoices.push(inv);
      const original = await db.journalEntry.findFirstOrThrow({
        where: {
          tenantId,
          sourceType: 'customer-invoice',
          sourceId: inv.id,
          sourceKind: 'approved',
        },
      });
      expect(original.currency).toBe('GBP');
    }
    const p = (
      await call('post', 'billing/payments', {
        type: 'RECEIVE',
        partyType: 'CUSTOMER',
        partyId: customer.id,
        modeOfPaymentId: mode.id,
        date: '2026-09-27',
        currency: 'GBP',
        totalAmount: 0.3,
        allocations: invoices.map((i) => ({
          targetType: 'CUSTOMER_INVOICE',
          targetId: i.id,
          amount: Number(i.totalAmount),
        })),
      }).expect(201)
    ).body;
    await call('post', 'billing/payments/' + p.id + '/submit').expect(201);
    const original = await db.journalEntry.findFirstOrThrow({
      where: { tenantId, sourceType: 'payment', sourceId: p.id, sourceKind: null },
      include: { lines: true },
    });
    expect(original.currency).toBe('GBP');
    expect(original.lines.find((l) => l.debit.gt(0))!.debit.toString()).toBe('0.3');
    const settled = (await call('get', 'billing/reports/ar-aging?currency=GBP').expect(200)).body;
    expect(settled.grandTotal).toBe('0.00');
    // A bank reconciliation cannot qualify historical NULL as GBP.
    const bank = await db.bankAccount.create({
      data: { tenantId, name: randomUUID(), currency: 'GBP', glAccountCode: '1000' },
    });
    const txn = await db.bankTransaction.create({
      data: {
        tenantId,
        bankAccountId: bank.id,
        date: new Date('2026-09-27'),
        amount: '0.30',
        description: 'Currency proof',
      },
    });
    await db.journalEntry.update({ where: { id: original.id }, data: { currency: null } });
    await call('post', 'billing/bank-transactions/' + txn.id + '/match', {
      paymentId: p.id,
    }).expect(400);
    await db.journalEntry.update({ where: { id: original.id }, data: { currency: 'USD' } });
    await call('post', 'billing/payments/' + p.id + '/cancel').expect(409);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('SUBMITTED');
    expect(
      (
        await db.customerInvoice.findUniqueOrThrow({ where: { id: invoices[0].id } })
      ).amountPaid.toString(),
    ).toBe('0.1');
    await db.journalEntry.update({ where: { id: original.id }, data: { currency: 'GBP' } });
    await call('post', 'billing/payments/' + p.id + '/cancel').expect(201);
    const rev = await db.journalEntry.findFirstOrThrow({
      where: { tenantId, sourceType: 'payment', sourceId: p.id, sourceKind: 'reversal' },
      include: { lines: true },
    });
    expect(rev.currency).toBe('GBP');
    expect(rev.lines.find((l) => l.credit.gt(0))!.credit.toString()).toBe('0.3');
    const open = (
      await call('get', 'billing/reports/ar-aging?currency=GBP&asOf=2026-01-01').expect(200)
    ).body;
    expect(open.grandTotal).toBe('0.30');
    expect(open.basis).toBe('CURRENT_BALANCE_BY_APPROVAL_AGE');
    expect(
      (await call('get', 'billing/reports/ar-aging?currency=USD').expect(200)).body.grandTotal,
    ).toBe('0.00');
  });
  it('blocks unqualified historical budgets without currency inference', async () => {
    const r = await db.budget.create({
      data: {
        tenantId: tenants[0].id,
        name: 'Unsafe mixed budget',
        fiscalYear: 2026,
        lines: { create: { tenantId: tenants[0].id, accountCode: '1000', amount: 100 } },
      },
    });
    const response = await call('get', 'billing/budgets/' + r.id + '/variance').expect(409);
    expect(response.body.message).toContain('non qualifié');
  });
  it('refuses to round historical fractional cents in a qualified report', async () => {
    await legacy('MXN', '2026-08-03T00:00:00Z', '1.001');
    const r = await call('get', base + '/trial-balance?currency=MXN').expect(409);
    expect(r.body.message).toContain('fractions de cent');
  });
  it('requires known matching original currency to issue a customer credit', async () => {
    const tenantId = tenants[0].id;
    const customer = await db.customer.create({
      data: { tenantId, code: randomUUID(), name: 'Credit proof' },
    });
    const inv = await db.customerInvoice.create({
      data: {
        tenantId,
        customerId: customer.id,
        invoiceNumber: randomUUID(),
        currency: 'USD',
        totalAmount: '10.10',
        status: 'DRAFT',
        lines: { create: [{ description: 'Service', amount: '10.10', quantity: 1 }] },
      },
      include: { lines: true },
    });
    await call('post', 'billing/customer-invoices/' + inv.id + '/approve').expect(201);
    const original = await db.journalEntry.findFirstOrThrow({
      where: { tenantId, sourceType: 'customer-invoice', sourceId: inv.id, sourceKind: 'approved' },
    });
    const path = 'billing/customer-invoices/' + inv.id + '/credits';
    const draft = (
      await call('post', path, {
        operationKey: randomUUID(),
        expectedVersion: 0,
        reason: 'Correction financière',
        lines: [{ invoiceLineId: inv.lines[0].id, quantity: 1 }],
      }).expect(201)
    ).body;
    await db.journalEntry.update({ where: { id: original.id }, data: { currency: null } });
    await call('post', path + '/' + draft.id + '/issue').expect(409);
    expect(
      (await db.customerCreditNote.findUniqueOrThrow({ where: { id: draft.id } })).status,
    ).toBe('DRAFT');
    await db.journalEntry.update({ where: { id: original.id }, data: { currency: 'USD' } });
    await call('post', path + '/' + draft.id + '/issue').expect(201);
    expect(
      (
        await db.journalEntry.findFirstOrThrow({
          where: { tenantId, sourceType: 'customer-credit', sourceId: draft.id },
        })
      ).currency,
    ).toBe('USD');
  });
  it('legacy replay and reversal preserve unknown currency without guessing', async () => {
    const e = await legacy(null, '2026-08-02T00:00:00Z');
    await db.journalEntry.update({
      where: { id: e.id },
      data: { sourceType: 'payment', sourceId: e.id },
    });
    const service = app.get(LedgerService);
    expect(
      await service.post(tenants[0].id, {
        ...input(),
        date: new Date('2026-08-02'),
        sourceType: 'payment',
        sourceId: e.id,
      }),
    ).toEqual({ posted: false, journalEntryId: e.id });
    const rev = await service.post(tenants[0].id, {
      ...input(),
      date: new Date('2026-08-02'),
      currency: null,
      sourceType: 'payment',
      sourceId: e.id,
      sourceKind: 'reversal',
    });
    expect(
      (await db.journalEntry.findUniqueOrThrow({ where: { id: rev.journalEntryId } })).currency,
    ).toBeNull();
    await expect(
      service.post(tenants[0].id, {
        ...input(),
        date: new Date('2026-08-02'),
        currency: null,
        sourceType: 'payment',
        sourceId: 'absent',
        sourceKind: 'reversal',
      }),
    ).rejects.toThrow();
    expect((await db.journalEntry.findUniqueOrThrow({ where: { id: e.id } })).currency).toBeNull();
  });
});
