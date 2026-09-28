import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { MODULE_CATALOG, PERMISSION_CATALOG, ledgerAmount, ledgerCents } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { EmailService } from '../src/core/email/email.service';
import { LedgerService } from '../src/modules/billing/ledger/ledger.service';
import { AuditLogsService } from '../src/core/audit-logs/audit-logs.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('I2m.2d.1 historical qualification', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `ledger-qualification-${Date.now()}`,
    base = 'billing/ledger-qualification';
  const tenants: { id: string; tokens: Record<string, string> }[] = [];
  const R = 'billing.ledger.read',
    M = 'billing.ledger.manage',
    Q = 'billing.ledger.qualify';
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
        paymentQualifier: [R, Q, 'billing.payments.read'],
        invoiceQualifier: [R, Q, 'billing.customer-invoices.read', 'billing.invoices.read'],
        assetQualifier: [R, Q, 'billing.assets.read'],
        assetReader: ['billing.assets.read'],
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
        const email = `${key.toLowerCase()}@${slug}.test`;
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
    console.log(`LEDGER_QUALIFICATION_TENANT=${prefix}-0`);
    for (const t of tenants) await app.get(LedgerService).ensureChart(t.id);
  }, 120000);
  afterAll(async () => app?.close());

  async function legacy(change: object = {}, tenant = 0, amount = '12.34') {
    const tenantId = tenants[tenant].id;
    const accounts = await db.chartOfAccount.findMany({
      where: { tenantId, code: { in: ['1000', '4000'] } },
    });
    return db.journalEntry.create({
      data: {
        tenantId,
        currency: null,
        date: new Date('2024-06-15T00:00:00Z'),
        memo: 'Reprise historique ' + randomUUID(),
        ...change,
        lines: {
          create: accounts.map((a) => ({
            tenantId,
            accountId: a.id,
            debit: a.code === '1000' ? amount : '0',
            credit: a.code === '4000' ? amount : '0',
          })),
        },
      },
      include: { lines: true },
    });
  }
  const file = Buffer.from('%PDF-1.4\nHistorical currency proof\n%%EOF');
  function upload(id: string, key = randomUUID(), role = 'manager', tenant = 0, buffer = file) {
    return call('post', base + '/' + id + '/evidence', undefined, role, tenant)
      .field('operationKey', key)
      .field('caption', 'Devise confirmée par le justificatif original')
      .attach('file', buffer, { filename: 'preuve.pdf', contentType: 'application/pdf' });
  }
  async function decision(id: string, change: object = {}, role = 'manager') {
    const evidence = (await upload(id, randomUUID(), role).expect(201)).body;
    const d = {
      action: 'QUALIFY',
      currency: 'CAD',
      reason: 'Le justificatif original confirme cette devise.',
      expectedVersion: 0,
      evidenceId: evidence.id,
      ...change,
    };
    const review = (await call('post', base + '/' + id + '/review', d, role).expect(201)).body;
    return { ...d, operationKey: randomUUID(), confirmed: true, reviewToken: review.reviewToken };
  }
  const original = (id: string) =>
    db.journalEntry.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
  it('gates tenants, modules, dedicated rights and source workflows', async () => {
    const e = await legacy();
    await call('get', base, undefined, 'manager', 2).expect(403);
    await call('get', base, undefined, 'carrier').expect(403);
    await call('get', base + '/' + e.id, undefined, 'manager', 1).expect(404);
    for (const role of ['reader', 'writer', 'planner'])
      await upload(e.id, randomUUID(), role).expect(403);
    await upload(e.id, randomUUID(), 'manager', 1).expect(404);
    for (const change of [
      { currency: 'CAD' },
      { sourceType: 'payment', sourceId: randomUUID() },
      { sourceType: 'depreciation', sourceId: randomUUID() },
      { sourceId: randomUUID() },
    ]) {
      const linked = await legacy(change);
      expect(
        (await call('get', base + '/' + linked.id).expect(200)).body.blockedReason,
      ).toBeTruthy();
      await upload(linked.id).expect(409);
    }
  });
  it('protects, validates and idempotently attaches immutable evidence', async () => {
    const e = await legacy(),
      key = randomUUID(),
      first = (await upload(e.id, key).expect(201)).body;
    expect((await upload(e.id, key).expect(201)).body).toMatchObject({
      id: first.id,
      replayed: true,
    });
    await upload(e.id, key, 'qualifier').expect(409);
    await upload(e.id, key, 'manager', 0, Buffer.from('%PDF-1.4\nchanged')).expect(409);
    await upload(e.id, randomUUID(), 'manager', 0, Buffer.from('not a PDF')).expect(400);
    const evidence = await db.ledgerCurrencyEvidence.findFirstOrThrow({
      where: { tenantId: tenants[0].id, id: first.id },
    });
    expect(
      await db.auditLog.count({
        where: {
          tenantId: tenants[0].id,
          entityId: first.id,
          entityType: 'ledger-currency-evidence',
        },
      }),
    ).toBe(1);
    await call('get', 'documents/' + evidence.documentId + '/download').expect(403);
    await call('delete', 'documents/' + evidence.documentId).expect(403);
    await call(
      'get',
      base + '/' + e.id + '/evidence/' + first.id + '/download',
      undefined,
      'reader',
    ).expect(200);
    await call(
      'get',
      base + '/' + e.id + '/evidence/' + first.id + '/download',
      undefined,
      'manager',
      1,
    ).expect(404);
    await call(
      'get',
      base + '/' + e.id + '/evidence/requests/' + key,
      undefined,
      'qualifier',
    ).expect(404);
    expect(
      JSON.stringify((await call('get', base + '/' + e.id + '/evidence').expect(200)).body),
    ).not.toMatch(/storageKey|fingerprint|uploadedById/);
  });
  it('qualifies once, keeps original rows, and consistently updates journal, reports and budgets', async () => {
    const e = await legacy({ date: new Date('2023-06-15') }),
      before = await original(e.id),
      d = await decision(e.id);
    const r = await Promise.all([
      call('post', base + '/' + e.id + '/confirm', d).expect(201),
      call('post', base + '/' + e.id + '/confirm', d).expect(201),
    ]);
    expect(r.map((x) => x.body.replayed).sort()).toEqual([false, true]);
    expect(await original(e.id)).toEqual(before);
    expect(
      await db.ledgerCurrencyRevision.count({ where: { tenantId: tenants[0].id, entryId: e.id } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: {
          tenantId: tenants[0].id,
          entityId: e.id,
          entityType: 'ledger-currency-qualification',
        },
      }),
    ).toBe(1);
    const journal = (await call('get', 'billing/ledger/journal?currency=CAD').expect(200)).body;
    expect(journal.items.find((x: any) => x.id === e.id)).toMatchObject({
      currency: 'CAD',
      originalCurrency: null,
      currencyQualification: { state: 'QUALIFIED' },
    });
    expect(
      (await call('get', 'billing/ledger/journal?unqualified=true').expect(200)).body.items.some(
        (x: any) => x.id === e.id,
      ),
    ).toBe(false);
    const report = (
      await call(
        'get',
        'billing/reports/profit-and-loss?currency=CAD&from=2023-01-01&to=2023-12-31',
      ).expect(200)
    ).body;
    expect(report).toMatchObject({
      netIncome: '12.34',
      coverage: { qualifiedHistoricalEntries: 1, selectedEntries: 1, unknownEntries: 0 },
    });
    await call('post', base + '/' + e.id + '/confirm', {
      ...d,
      reason: 'Une autre justification explicite.',
    }).expect(409);
    await call('post', base + '/' + e.id + '/confirm', d, 'qualifier').expect(409);
    await call('get', base + '/requests/' + d.operationKey, undefined, 'qualifier').expect(404);
    expect(
      (await call('get', base + '/requests/' + d.operationKey).expect(200)).body.replayed,
    ).toBe(true);
    const budget = (
      await call('post', 'billing/budgets', {
        operationKey: randomUUID(),
        name: 'Contrôle reprise',
        fiscalYear: 2023,
        currency: 'CAD',
        periodFrom: '2023-01-01',
        periodTo: '2023-12-31',
        isActive: true,
        lines: [{ accountCode: '4000', amount: '100.00' }],
      }).expect(201)
    ).body;
    const variance = (await call('get', 'billing/budgets/' + budget.id + '/variance').expect(200))
      .body;
    expect(variance.coverage.qualifiedHistoricalEntries).toBe(1);
    expect(variance.rows[0].actual).toBe('12.34');
  });
  it('withdraws without reversal, then permits a different currency with a new review', async () => {
    const e = await legacy({ date: new Date('2022-01-20') }),
      before = await original(e.id),
      d = await decision(e.id);
    await call('post', base + '/' + e.id + '/confirm', d).expect(201);
    const reviewDto = {
      action: 'WITHDRAW',
      currency: '',
      expectedVersion: 1,
      evidenceId: d.evidenceId,
      reason: 'La preuve doit être réexaminée.',
    };
    const rev = (await call('post', base + '/' + e.id + '/review', reviewDto).expect(201)).body;
    const w = {
      ...reviewDto,
      confirmed: true,
      operationKey: randomUUID(),
      reviewToken: rev.reviewToken,
    };
    await call('post', base + '/' + e.id + '/confirm', w).expect(201);
    expect((await call('post', base + '/' + e.id + '/confirm', d).expect(201)).body.replayed).toBe(
      true,
    );
    expect(
      (await call('get', base + '/' + e.id).expect(200)).body.currencyQualification,
    ).toMatchObject({ state: 'WITHDRAWN', currency: null, version: 2 });
    const report = (
      await call(
        'get',
        'billing/reports/profit-and-loss?currency=CAD&from=2022-01-01&to=2022-12-31',
      ).expect(200)
    ).body;
    expect(report).toMatchObject({
      netIncome: '0.00',
      coverage: { qualifiedHistoricalEntries: 0, unknownEntries: 1 },
    });
    const next = await decision(e.id, { currency: 'USD', expectedVersion: 2 });
    await call('post', base + '/' + e.id + '/confirm', next).expect(201);
    expect(await original(e.id)).toEqual(before);
    expect(
      (await call('get', base + '/' + e.id).expect(200)).body.history.map((h: any) => h.version),
    ).toEqual([3, 2, 1]);
    await call('get', base + '/' + e.id + '/evidence/' + d.evidenceId + '/download').expect(200);
  });
  it('blocks stale reviews, wrong evidence, malformed amounts and races', async () => {
    const e = await legacy(),
      d = await decision(e.id);
    const { operationKey, reviewToken, confirmed, ...q } = d;
    await call('post', base + '/' + e.id + '/review', { ...q, evidenceId: 'missing' }).expect(404);
    const other = await legacy(),
      otherProof = (await upload(other.id).expect(201)).body;
    await call('post', base + '/' + e.id + '/review', { ...q, evidenceId: otherProof.id }).expect(
      404,
    );
    await call('post', base + '/' + e.id + '/confirm', { ...d, confirmed: false }).expect(400);
    await call('post', base + '/' + e.id + '/confirm', { ...d, tenantId: tenants[1].id }).expect(
      400,
    );
    await db.journalEntry.update({
      where: { id: e.id },
      data: { memo: 'Concurrent historical change' },
    });
    await call('post', base + '/' + e.id + '/confirm', d).expect(409);
    const fresh = await decision(e.id);
    const race = await Promise.all([
      call('post', base + '/' + e.id + '/confirm', fresh),
      call('post', base + '/' + e.id + '/confirm', { ...fresh, operationKey: randomUUID() }),
    ]);
    expect(race.map((x) => x.status).sort()).toEqual([201, 409]);
    for (const amount of ['1.001', '-1', '0']) {
      const invalid = await legacy({}, 0, amount),
        proof = (await upload(invalid.id).expect(201)).body;
      await call('post', base + '/' + invalid.id + '/review', {
        ...q,
        evidenceId: proof.id,
      }).expect(409);
    }
  });
  it('rolls back qualification and replay record together when audit fails', async () => {
    const e = await legacy(),
      d = await decision(e.id);
    const spy = jest
      .spyOn(app.get(AuditLogsService), 'log')
      .mockRejectedValueOnce(new Error('forced atomic audit failure'));
    try {
      await call('post', base + '/' + e.id + '/confirm', d).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await db.ledgerCurrencyQualification.count({
        where: { tenantId: tenants[0].id, entryId: e.id },
      }),
    ).toBe(0);
    expect(
      await db.ledgerCurrencyRevision.count({
        where: { tenantId: tenants[0].id, operationKey: d.operationKey },
      }),
    ).toBe(0);
    await call('post', base + '/' + e.id + '/confirm', d).expect(201);
  });
  it('leaves an eligible UI fixture', async () => {
    await legacy({ memo: 'UI · qualification historique' });
  });

  async function historicalPayment(pay = false, declaredTotal = '12.34') {
    const tenantId = tenants[0].id,
      suffix = randomUUID();
    const party = pay
      ? await db.carrier.create({
          data: { tenantId, code: suffix, name: 'Transporteur historique' },
        })
      : await db.customer.create({ data: { tenantId, code: suffix, name: 'Client historique' } });
    const mode = await db.modeOfPayment.create({
      data: { tenantId, name: suffix, accountCode: '1010' },
    });
    const invoice = pay
      ? await db.invoice.create({
          data: {
            tenantId,
            invoiceNumber: suffix,
            carrierId: party.id,
            status: 'PAID',
            currency: 'CAD',
            totalAmount: '12.34',
            amountPaid: '12.34',
          },
        })
      : await db.customerInvoice.create({
          data: {
            tenantId,
            invoiceNumber: suffix,
            customerId: party.id,
            status: 'PAID',
            currency: 'CAD',
            totalAmount: '12.34',
            amountPaid: '12.34',
          },
        });
    const date = new Date('2024-06-15T00:00:00Z');
    const payment = await db.payment.create({
      data: {
        tenantId,
        paymentNumber: suffix,
        type: pay ? 'PAY' : 'RECEIVE',
        status: 'SUBMITTED',
        partyType: pay ? 'CARRIER' : 'CUSTOMER',
        partyId: party.id,
        modeOfPaymentId: mode.id,
        date,
        currency: 'CAD',
        totalAmount: declaredTotal,
        submittedAt: date,
        allocations: {
          create: {
            tenantId,
            targetType: pay ? 'CARRIER_INVOICE' : 'CUSTOMER_INVOICE',
            targetId: invoice.id,
            amount: '12.34',
          },
        },
      },
    });
    const accounts = await db.chartOfAccount.findMany({
      where: { tenantId, code: { in: ['1010', pay ? '2000' : '1100'] } },
    });
    const entry = await db.journalEntry.create({
      data: {
        tenantId,
        date,
        sourceType: 'payment',
        sourceId: payment.id,
        currency: null,
        memo: 'Paiement historique ' + suffix,
        lines: {
          create: accounts.map((a) => ({
            tenantId,
            accountId: a.id,
            debit: (a.code === '1010') !== pay ? '12.34' : '0',
            credit: (a.code === '1010') !== pay ? '0' : '12.34',
          })),
        },
      },
      include: { lines: true },
    });
    return { payment, entry, invoice, mode };
  }
  const annotations = (id: string) =>
    db.ledgerCurrencyQualification.findMany({
      where: { tenantId: tenants[0].id, sourceEntryId: id },
      orderBy: { entryId: 'asc' },
    });

  it('requires payment-read for source, evidence, history and replay, without requiring invoice-read', async () => {
    const { entry } = await historicalPayment();
    await call('get', base + '/' + entry.id, undefined, 'qualifier').expect(403);
    await upload(entry.id, randomUUID(), 'qualifier').expect(403);
    const d = await decision(entry.id, {}, 'paymentQualifier');
    await call('post', base + '/' + entry.id + '/confirm', d, 'paymentQualifier').expect(201);
    const evidence = (
      await call('get', base + '/' + entry.id + '/evidence', undefined, 'paymentQualifier').expect(
        200,
      )
    ).body[0];
    await call(
      'get',
      base + '/' + entry.id + '/evidence/' + evidence.id + '/download',
      undefined,
      'qualifier',
    ).expect(403);
    await call('get', base + '/requests/' + d.operationKey, undefined, 'qualifier').expect(404); // actor-bound
    const detail = (
      await call('get', base + '/' + entry.id, undefined, 'paymentQualifier').expect(200)
    ).body;
    expect(detail.source).toMatchObject({ currency: 'CAD', total: '12.34', allocationCount: 1 });
    expect(JSON.stringify(detail.source)).not.toContain('targetId');
    expect((await original(entry.id)).currency).toBeNull();
    const role = await db.role.findFirstOrThrow({
      where: { tenantId: tenants[0].id, key: 'paymentQualifier' },
    });
    const permission = await db.permission.findUniqueOrThrow({
      where: { key: 'billing.payments.read' },
    });
    await db.rolePermission.delete({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    const token = (
      await request(http)
        .post('/api/v1/auth/login')
        .send({
          tenant: prefix + '-0',
          email: `paymentqualifier@${prefix}-0.test`,
          password: 'Test1234!',
        })
        .expect(200)
    ).body.accessToken;
    tenants[0].tokens.paymentQualifier = token;
    await call('get', base + '/requests/' + d.operationKey, undefined, 'paymentQualifier').expect(
      403,
    );
    await call('post', base + '/' + entry.id + '/confirm', d, 'paymentQualifier').expect(403);
    await call('get', base + '/' + entry.id + '/evidence', undefined, 'paymentQualifier').expect(
      403,
    );
  });
  it('reverses the original accounts after mode changes and carries qualification atomically', async () => {
    for (const pay of [false, true]) {
      const balances = async () =>
        (
          (await call('get', 'billing/ledger/trial-balance?currency=CAD').expect(200)).body
            .rows as { code: string; balance: string }[]
        )
          .filter((r) => r.balance !== '0.00')
          .map((r) => [r.code, r.balance]);
      const beforeBalances = await balances();
      const { entry, payment, mode } = await historicalPayment(pay),
        d = await decision(entry.id);
      await call('post', base + '/' + entry.id + '/confirm', d).expect(201);
      await db.modeOfPayment.update({ where: { id: mode.id }, data: { accountCode: '1000' } });
      await call('post', 'billing/payments/' + payment.id + '/cancel').expect(201);
      const reversal = await db.journalEntry.findFirstOrThrow({
        where: {
          tenantId: tenants[0].id,
          sourceType: 'payment',
          sourceId: payment.id,
          sourceKind: 'reversal',
        },
        include: { lines: true },
      });
      expect(reversal.currency).toBeNull();
      for (const l of entry.lines) {
        const inverse = reversal.lines.find((r) => r.accountId === l.accountId)!;
        expect(inverse.debit.toString()).toBe(l.credit.toString());
        expect(inverse.credit.toString()).toBe(l.debit.toString());
      }
      expect(await annotations(entry.id)).toHaveLength(2);
      expect(await balances()).toEqual(beforeBalances);
      expect(
        (await call('post', base + '/' + entry.id + '/confirm', d).expect(201)).body.replayed,
      ).toBe(true);
      expect((await call('get', base + '/' + reversal.id).expect(200)).body.anchorEntryId).toBe(
        entry.id,
      );
      await upload(reversal.id).expect(409);
      const withdraw = await decision(entry.id, {
        action: 'WITHDRAW',
        currency: '',
        expectedVersion: 1,
      });
      await call('post', base + '/' + entry.id + '/confirm', withdraw).expect(201);
      expect((await annotations(entry.id)).map((a) => [a.state, a.currency, a.version])).toEqual([
        ['WITHDRAWN', null, 2],
        ['WITHDRAWN', null, 2],
      ]);
      const again = await decision(entry.id, { expectedVersion: 2 });
      await call('post', base + '/' + entry.id + '/confirm', again).expect(201);
      expect(
        (await annotations(entry.id)).every((a) => a.state === 'QUALIFIED' && a.version === 3),
      ).toBe(true);
    }
  });
  it('rejects stale review after cancellation, then qualifies original and existing reversal together', async () => {
    const { entry, payment } = await historicalPayment(),
      d = await decision(entry.id);
    await call('post', 'billing/payments/' + payment.id + '/cancel').expect(201);
    await call('post', base + '/' + entry.id + '/confirm', d).expect(409);
    const fresh = await decision(entry.id);
    await call('post', base + '/' + entry.id + '/confirm', fresh).expect(201);
    expect(await annotations(entry.id)).toHaveLength(2);
  });
  it('blocks wrong currency, excessive allocations, foreign targets, duplicates and mismatched reversal', async () => {
    const { entry, payment } = await historicalPayment(),
      evidence = (await upload(entry.id).expect(201)).body;
    await call('post', base + '/' + entry.id + '/review', {
      action: 'QUALIFY',
      currency: 'USD',
      reason: 'Devise non conforme au paiement',
      evidenceId: evidence.id,
      expectedVersion: 0,
    }).expect(409);
    await db.payment.update({ where: { id: payment.id }, data: { totalAmount: '12' } });
    await upload(entry.id).expect(409);
    await db.payment.update({ where: { id: payment.id }, data: { totalAmount: '12.34' } });
    await db.paymentAllocation.updateMany({
      where: { tenantId: tenants[0].id, paymentId: payment.id },
      data: { targetId: 'absent' },
    });
    await upload(entry.id).expect(409);
    const dup = await historicalPayment();
    await legacy({ sourceType: 'payment', sourceId: dup.payment.id });
    await upload(dup.entry.id).expect(409);
    const cancelled = await historicalPayment();
    await call('post', 'billing/payments/' + cancelled.payment.id + '/cancel').expect(201);
    const wrong = await db.chartOfAccount.findFirstOrThrow({
      where: { tenantId: tenants[0].id, code: '1000' },
    });
    const reverse = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: tenants[0].id, sourceId: cancelled.payment.id, sourceKind: 'reversal' },
    });
    await db.journalLine.updateMany({
      where: { tenantId: tenants[0].id, journalEntryId: reverse.id, credit: { gt: 0 } },
      data: { accountId: wrong.id },
    });
    await upload(cancelled.entry.id).expect(409);
  });
  it('accepts banking only after qualification and blocks withdrawal until unmatch', async () => {
    const { entry, payment } = await historicalPayment();
    const account = await db.bankAccount.create({
      data: { tenantId: tenants[0].id, name: randomUUID(), currency: 'CAD', glAccountCode: '1010' },
    });
    const txn = await db.bankTransaction.create({
      data: {
        tenantId: tenants[0].id,
        bankAccountId: account.id,
        date: payment.date,
        amount: '12.34',
        description: 'Historical bank proof',
      },
    });
    const route = 'billing/bank-transactions/' + txn.id;
    await call('post', route + '/match', { paymentId: payment.id }).expect(400);
    const d = await decision(entry.id);
    await call('post', base + '/' + entry.id + '/confirm', d).expect(201);
    const withdrawal = await decision(entry.id, {
      action: 'WITHDRAW',
      currency: '',
      expectedVersion: 1,
    });
    await call('post', route + '/match', { paymentId: payment.id }).expect(201);
    await call('post', base + '/' + entry.id + '/confirm', withdrawal).expect(409);
    await call('post', route + '/unmatch').expect(201);
    const fresh = await decision(entry.id, {
      action: 'WITHDRAW',
      currency: '',
      expectedVersion: 1,
    });
    await call('post', base + '/' + entry.id + '/confirm', fresh).expect(201);
  });
  it('rolls back cancellation, invoice balance, reversal and annotation if carried audit fails', async () => {
    const { entry, payment, invoice } = await historicalPayment(),
      d = await decision(entry.id);
    await call('post', base + '/' + entry.id + '/confirm', d).expect(201);
    const audit = app.get(AuditLogsService),
      real = audit.log.bind(audit);
    const spy = jest.spyOn(audit, 'log').mockImplementation(async (input, tx) => {
      if (input.entityType === 'ledger-currency-qualification')
        throw Error('forced carry audit failure');
      return real(input, tx);
    });
    try {
      await call('post', 'billing/payments/' + payment.id + '/cancel').expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'SUBMITTED',
    );
    expect(
      (
        await db.customerInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
      ).amountPaid.toString(),
    ).toBe('12.34');
    expect(
      await db.journalEntry.count({ where: { tenantId: tenants[0].id, sourceId: payment.id } }),
    ).toBe(1);
    expect(await annotations(entry.id)).toHaveLength(1);
  });
  it('leaves a coherent historical payment UI fixture', async () => {
    const { entry } = await historicalPayment();
    await db.journalEntry.update({
      where: { id: entry.id },
      data: { memo: 'UI · reprise paiement historique' },
    });
  });

  async function historicalInvoice(carrier = false) {
    const tenantId = tenants[0].id,
      suffix = randomUUID(),
      date = new Date('2024-06-15T00:00:00Z');
    const party = carrier
      ? await db.carrier.create({ data: { tenantId, code: suffix, name: 'Transporteur reprise' } })
      : await db.customer.create({ data: { tenantId, code: suffix, name: 'Client reprise' } });
    const taxCode = carrier ? 'TREC' : 'TPAY';
    await db.chartOfAccount.upsert({
      where: { tenantId_code: { tenantId, code: taxCode } },
      create: {
        tenantId,
        code: taxCode,
        name: 'Taxe figée',
        type: carrier ? 'ASSET' : 'LIABILITY',
      },
      update: {},
    });
    const taxDetail = {
      lines: [{ accountCode: taxCode, amount: 15, rate: 15, description: 'Taxe historique' }],
    };
    const load = carrier ? await db.load.create({ data: { tenantId, loadNumber: suffix } }) : null;
    const data = {
      tenantId,
      invoiceNumber: suffix,
      status: 'APPROVED' as const,
      currency: 'CAD',
      totalAmount: '115',
      taxAmount: '15',
      taxDetail,
      approvedAt: date,
    };
    const invoice = carrier
      ? await db.invoice.create({
          data: {
            ...data,
            carrierId: party.id,
            lines: {
              create: { loadId: load!.id, description: 'Transport historique', amount: '100' },
            },
          },
          include: { lines: true },
        })
      : await db.customerInvoice.create({
          data: {
            ...data,
            customerId: party.id,
            lines: { create: { description: 'Service historique', quantity: '10', amount: '100' } },
          },
          include: { lines: true },
        });
    const codes = carrier ? ['2000', '5000', taxCode] : ['1100', '4000', taxCode];
    const accounts = await db.chartOfAccount.findMany({ where: { tenantId, code: { in: codes } } });
    const entry = await db.journalEntry.create({
      data: {
        tenantId,
        date,
        currency: null,
        sourceType: carrier ? 'invoice' : 'customer-invoice',
        sourceId: invoice.id,
        sourceKind: 'approved',
        memo: 'Facture historique ' + suffix,
        lines: {
          create: codes.map((code, i) => ({
            tenantId,
            accountId: accounts.find((a) => a.code === code)!.id,
            debit: carrier ? (i === 0 ? '0' : i === 1 ? '100' : '15') : i === 0 ? '115' : '0',
            credit: carrier ? (i === 0 ? '115' : '0') : i === 0 ? '0' : i === 1 ? '100' : '15',
          })),
        },
      },
      include: { lines: true },
    });
    return { invoice, entry, taxCode };
  }
  async function historicalCredit(f: Awaited<ReturnType<typeof historicalInvoice>>, known = false) {
    const tenantId = tenants[0].id;
    const actor = await db.user.findFirstOrThrow({
      where: { tenantId, email: `manager@${prefix}-0.test` },
    });
    const note = await db.customerCreditNote.create({
      data: {
        tenantId,
        invoiceId: f.invoice.id,
        number: randomUUID(),
        reason: 'Avoir historique',
        currency: 'CAD',
        status: 'ISSUED',
        invoiceVersion: 0,
        netAmount: '20',
        taxAmount: '3',
        totalAmount: '23',
        issuedAt: new Date('2024-06-16T00:00:00Z'),
        issuedById: actor.id,
        createdById: actor.id,
        operationKey: randomUUID(),
        fingerprint: randomUUID(),
        lines: {
          create: {
            invoiceLineId: f.invoice.lines[0].id,
            description: 'Crédit partiel',
            quantity: '2',
            netAmount: '20',
            taxAmount: '3',
            totalAmount: '23',
            taxDetail: [
              { accountCode: f.taxCode, amount: 3, rate: 15, description: 'Taxe historique' },
            ],
          },
        },
      },
    });
    const entry = await db.journalEntry.create({
      data: {
        tenantId,
        date: note.issuedAt!,
        currency: known ? 'CAD' : null,
        sourceType: 'customer-credit',
        sourceId: note.id,
        sourceKind: 'issued',
        memo: 'Avoir historique ' + note.number,
        lines: {
          create: f.entry.lines.map((l) => ({
            tenantId,
            accountId: l.accountId,
            debit: l.credit.div(5),
            credit: l.debit.div(5),
          })),
        },
      },
    });
    await db.customerInvoice.update({
      where: { id: f.invoice.id },
      data: { creditedAmount: { increment: '23' }, creditVersion: { increment: 1 } },
    });
    return { note, entry };
  }
  it('qualifies and withdraws invoice and historical credits together, preserving original lines', async () => {
    const f = await historicalInvoice(),
      credit = await historicalCredit(f),
      before = await original(f.entry.id),
      beforeCredit = await original(credit.entry.id);
    const view = (
      await call('get', base + '/' + f.entry.id, undefined, 'invoiceQualifier').expect(200)
    ).body;
    expect(view.source).toMatchObject({
      kind: 'CUSTOMER_INVOICE',
      netAmount: '100.00',
      taxAmount: '15.00',
      total: '115.00',
      issuedCreditCount: 1,
      knownCreditCount: 0,
    });
    expect((await call('get', base + '/' + credit.entry.id).expect(200)).body.anchorEntryId).toBe(
      f.entry.id,
    );
    await upload(credit.entry.id).expect(409);
    const d = await decision(f.entry.id, {}, 'invoiceQualifier');
    await call('post', base + '/' + f.entry.id + '/confirm', d, 'invoiceQualifier').expect(201);
    expect(await annotations(f.entry.id)).toHaveLength(2);
    expect(await original(f.entry.id)).toEqual(before);
    expect(await original(credit.entry.id)).toEqual(beforeCredit);
    const withdrawal = await decision(
      f.entry.id,
      { action: 'WITHDRAW', currency: '', expectedVersion: 1 },
      'invoiceQualifier',
    );
    await call('post', base + '/' + f.entry.id + '/confirm', withdrawal, 'invoiceQualifier').expect(
      201,
    );
    expect(
      (await annotations(f.entry.id)).every((a) => a.state === 'WITHDRAWN' && a.version === 2),
    ).toBe(true);
    expect(
      (await call('post', base + '/' + f.entry.id + '/confirm', d, 'invoiceQualifier').expect(201))
        .body.replayed,
    ).toBe(true);
  });
  it('supports carrier invoices with Finance only, never requiring Transport activation', async () => {
    const f = await historicalInvoice(true),
      d = await decision(f.entry.id, {}, 'invoiceQualifier');
    expect(
      (await call('get', base + '/' + f.entry.id, undefined, 'invoiceQualifier').expect(200)).body
        .source.kind,
    ).toBe('CARRIER_INVOICE');
    await call('post', base + '/' + f.entry.id + '/confirm', d, 'invoiceQualifier').expect(201);
    expect(await annotations(f.entry.id)).toHaveLength(1);
  });
  it('gates invoice source rights on proof, review, confirmation and actor-bound replay after role loss', async () => {
    const f = await historicalInvoice();
    await call('get', base + '/' + f.entry.id, undefined, 'qualifier').expect(403);
    await upload(f.entry.id, randomUUID(), 'qualifier').expect(403);
    await call('get', base + '/' + f.entry.id, undefined, 'manager', 1).expect(404);
    const d = await decision(f.entry.id, {}, 'invoiceQualifier');
    const { operationKey: _k, confirmed: _c, reviewToken: _t, ...review } = d;
    await call('post', base + '/' + f.entry.id + '/review', review, 'qualifier').expect(403);
    await call('post', base + '/' + f.entry.id + '/confirm', d, 'invoiceQualifier').expect(201);
    const role = await db.role.findFirstOrThrow({
      where: { tenantId: tenants[0].id, key: 'invoiceQualifier' },
    });
    const permission = await db.permission.findUniqueOrThrow({
      where: { key: 'billing.customer-invoices.read' },
    });
    await db.rolePermission.delete({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    tenants[0].tokens.invoiceQualifier = (
      await request(http)
        .post('/api/v1/auth/login')
        .send({
          tenant: prefix + '-0',
          email: `invoicequalifier@${prefix}-0.test`,
          password: 'Test1234!',
        })
        .expect(200)
    ).body.accessToken;
    await call('post', base + '/' + f.entry.id + '/confirm', d, 'invoiceQualifier').expect(403);
    await call('get', base + '/requests/' + d.operationKey, undefined, 'invoiceQualifier').expect(
      403,
    );
    await call('get', base + '/' + f.entry.id + '/evidence', undefined, 'invoiceQualifier').expect(
      403,
    );
    await call(
      'get',
      base + '/' + f.entry.id + '/evidence/' + d.evidenceId + '/download',
      undefined,
      'invoiceQualifier',
    ).expect(403);
  });
  it('rejects changed source, wrong currency, malformed taxes, missing GL and foreign invoice lines', async () => {
    const f = await historicalInvoice(),
      d = await decision(f.entry.id);
    const { operationKey: _k, confirmed: _c, reviewToken: _t, ...review } = d;
    await call('post', base + '/' + f.entry.id + '/review', { ...review, currency: 'USD' }).expect(
      409,
    );
    await historicalCredit(f);
    await call('post', base + '/' + f.entry.id + '/confirm', d).expect(409);
    await db.customerInvoice.update({
      where: { id: f.invoice.id },
      data: { taxDetail: { lines: [{ accountCode: f.taxCode, amount: 14 }] } },
    });
    await upload(f.entry.id).expect(409);
    const missing = await historicalInvoice();
    await db.journalEntry.update({
      where: { id: missing.entry.id },
      data: { sourceId: 'missing' },
    });
    await upload(missing.entry.id).expect(409);
    const bad = await historicalInvoice(),
      credit = await historicalCredit(bad);
    await db.customerCreditLine.updateMany({
      where: { tenantId: tenants[0].id, creditNoteId: credit.note.id },
      data: { invoiceLineId: f.invoice.lines[0].id },
    });
    await upload(bad.entry.id).expect(409);
    const missingGl = await historicalInvoice();
    await historicalCredit(missingGl);
    const child = await db.journalEntry.findFirstOrThrow({
      where: {
        tenantId: tenants[0].id,
        sourceType: 'customer-credit',
        sourceId: {
          in: (
            await db.customerCreditNote.findMany({
              where: { tenantId: tenants[0].id, invoiceId: missingGl.invoice.id },
            })
          ).map((n) => n.id),
        },
      },
    });
    await db.journalEntry.update({ where: { id: child.id }, data: { sourceId: 'orphan' } });
    await upload(missingGl.entry.id).expect(409);
  });
  it('keeps known credit currencies and prevents withdrawing their historical invoice alone', async () => {
    const f = await historicalInvoice(),
      credit = await historicalCredit(f, true),
      d = await decision(f.entry.id);
    await call('post', base + '/' + f.entry.id + '/confirm', d).expect(201);
    expect(await annotations(f.entry.id)).toHaveLength(1);
    expect((await original(credit.entry.id)).currency).toBe('CAD');
    const { operationKey: _k, confirmed: _c, reviewToken: _t, ...review } = d;
    await call('post', base + '/' + f.entry.id + '/review', {
      ...review,
      action: 'WITHDRAW',
      currency: '',
      expectedVersion: 1,
    }).expect(409);
  });
  it('allows a new known-currency credit after historical invoice qualification and blocks stale withdrawal', async () => {
    const f = await historicalInvoice(),
      d = await decision(f.entry.id);
    await call('post', base + '/' + f.entry.id + '/confirm', d).expect(201);
    const withdrawal = await decision(f.entry.id, {
      action: 'WITHDRAW',
      currency: '',
      expectedVersion: 1,
    });
    const path = 'billing/customer-invoices/' + f.invoice.id + '/credits';
    const draft = (
      await call('post', path, {
        operationKey: randomUUID(),
        expectedVersion: 0,
        reason: 'Avoir après reprise historique',
        lines: [{ invoiceLineId: f.invoice.lines[0].id, quantity: 2 }],
      }).expect(201)
    ).body;
    await call('post', path + '/' + draft.id + '/issue').expect(201);
    const posted = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: tenants[0].id, sourceType: 'customer-credit', sourceId: draft.id },
    });
    expect(posted.currency).toBe('CAD');
    expect(
      (await call('get', base + '/' + f.entry.id).expect(200)).body.source.knownCreditCount,
    ).toBe(1);
    await call('post', base + '/' + f.entry.id + '/confirm', withdrawal).expect(409);
    expect((await annotations(f.entry.id))[0].state).toBe('QUALIFIED');
  });
  it('rolls back every invoice annotation and revision when audit fails', async () => {
    const f = await historicalInvoice();
    await historicalCredit(f);
    const d = await decision(f.entry.id);
    const audit = app.get(AuditLogsService),
      real = audit.log.bind(audit);
    const spy = jest.spyOn(audit, 'log').mockImplementation(async (input, tx) => {
      if (input.entityType === 'ledger-currency-qualification')
        throw Error('forced invoice audit failure');
      return real(input, tx);
    });
    try {
      await call('post', base + '/' + f.entry.id + '/confirm', d).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await annotations(f.entry.id)).toHaveLength(0);
    expect(
      await db.ledgerCurrencyRevision.count({
        where: { tenantId: tenants[0].id, entryId: f.entry.id },
      }),
    ).toBe(0);
    await call('post', base + '/' + f.entry.id + '/confirm', d).expect(201);
  });
  it('leaves historical invoice UI fixtures with unknown and known credit children', async () => {
    const f = await historicalInvoice();
    await historicalCredit(f);
    await db.journalEntry.update({
      where: { id: f.entry.id },
      data: { memo: 'UI · reprise facture historique' },
    });
    const known = await historicalInvoice();
    await historicalCredit(known, true);
    const d = await decision(known.entry.id);
    await call('post', base + '/' + known.entry.id + '/confirm', d).expect(201);
    await db.journalEntry.update({
      where: { id: known.entry.id },
      data: { memo: 'UI · facture avec avoir connu' },
    });
  });
  async function acceptedCarrier(total = '120') {
    const f = await historicalInvoice(true);
    const variance = ledgerCents(total) - 10000n;
    await db.invoiceLine.update({
      where: { id: f.invoice.lines[0].id },
      data: {
        invoicedAmount: total,
        variance: ledgerAmount(variance),
      },
    });
    await db.invoice.update({
      where: { id: f.invoice.id },
      data: {
        status: 'DISPUTED',
        invoicedTotal: total,
        varianceTotal: ledgerAmount(variance),
        varianceGross: ledgerAmount(variance < 0n ? -variance : variance),
        carrierInvoiceNumber: 'TR-2024-0187',
        reconciledAt: new Date('2024-06-15T00:00:00Z'),
      },
    });
    await call('post', 'billing/invoices/' + f.invoice.id + '/resolve-dispute', {
      resolution: 'ACCEPT_INVOICED',
      reasonCode: 'RATE_MISMATCH',
      note: 'Montant transporteur accepté sur pièce historique.',
    }).expect(201);
    // Existing historical journal; recovery must never generate it itself.
    const accounts = await db.chartOfAccount.findMany({ where: { tenantId: tenants[0].id } });
    for (const line of f.entry.lines) {
      const code = accounts.find((a) => a.id === line.accountId)!.code;
      if (code === '2000' || code === '5000')
        await db.journalLine.update({
          where: { id: line.id },
          data:
            code === '2000'
              ? { credit: total }
              : { debit: ledgerAmount(ledgerCents(total) - 1500n) },
        });
    }
    const acceptance = await db.auditLog.findFirstOrThrow({
      where: {
        tenantId: tenants[0].id,
        entityId: f.invoice.id,
        entityType: 'invoice',
        after: { path: ['resolution'], equals: 'ACCEPT_INVOICED' },
      },
    });
    return { ...f, acceptance };
  }
  it('recovers audited accepted carrier payables without rewriting expected lines, taxes or journal', async () => {
    for (const total of ['120', '90']) {
      const f = await acceptedCarrier(total);
      const before = await original(f.entry.id),
        source = await db.invoice.findUniqueOrThrow({
          where: { id: f.invoice.id },
          include: { lines: true },
        });
      const view = (await call('get', base + '/' + f.entry.id).expect(200)).body;
      expect(view.blockedReason).toBeNull();
      expect(view.source.adjustment).toMatchObject({
        resolution: 'ACCEPT_INVOICED',
        expectedLinesAmount: '100.00',
        receivedLinesAmount: total + '.00',
        expectedTotalWithFrozenTax: '115.00',
        payableAdjustment: total === '120' ? '5.00' : '-25.00',
      });
      expect(JSON.stringify(view.source)).not.toContain(f.acceptance.userId!);
      const d = await decision(f.entry.id);
      const r = (await call('post', base + '/' + f.entry.id + '/confirm', d).expect(201)).body;
      expect(r.snapshot.schemaVersion).toBe(6);
      expect(r.snapshot.impact.totalDebit).toBe(total + '.00');
      expect(await original(f.entry.id)).toEqual(before);
      expect(
        await db.invoice.findUniqueOrThrow({
          where: { id: f.invoice.id },
          include: { lines: true },
        }),
      ).toEqual(source);
      const withdrawal = await decision(f.entry.id, {
        action: 'WITHDRAW',
        currency: '',
        expectedVersion: 1,
      });
      await call('post', base + '/' + f.entry.id + '/confirm', withdrawal).expect(201);
      expect((await annotations(f.entry.id))[0]).toMatchObject({ state: 'WITHDRAWN', version: 2 });
      expect(
        (await call('post', base + '/' + f.entry.id + '/confirm', d).expect(201)).body.snapshot,
      ).toEqual(r.snapshot);
    }
  });
  it('requires a unique tenant-owned acceptance, never inferring it from a header alone', async () => {
    for (const variant of ['missing', 'keep', 'duplicate', 'foreign', 'actor', 'reason', 'date']) {
      const f = await acceptedCarrier();
      if (variant === 'missing') await db.auditLog.delete({ where: { id: f.acceptance.id } });
      if (variant === 'keep')
        await db.auditLog.update({
          where: { id: f.acceptance.id },
          data: {
            after: {
              status: 'APPROVED',
              resolution: 'KEEP_EXPECTED',
              reasonCode: 'RATE_MISMATCH',
            },
          },
        });
      if (variant === 'duplicate')
        await db.auditLog.create({
          data: {
            tenantId: tenants[0].id,
            userId: f.acceptance.userId,
            entityType: 'invoice',
            entityId: f.invoice.id,
            action: 'STATUS_CHANGE',
            before: { status: 'DISPUTED' },
            after: {
              status: 'APPROVED',
              resolution: 'ACCEPT_INVOICED',
              reasonCode: 'RATE_MISMATCH',
            },
          },
        });
      if (variant === 'foreign')
        await db.auditLog.update({
          where: { id: f.acceptance.id },
          data: { tenantId: tenants[1].id },
        });
      if (variant === 'actor')
        await db.auditLog.update({ where: { id: f.acceptance.id }, data: { userId: null } });
      if (variant === 'reason')
        await db.auditLog.update({
          where: { id: f.acceptance.id },
          data: {
            after: { status: 'APPROVED', resolution: 'ACCEPT_INVOICED', reasonCode: 'OTHER' },
          },
        });
      if (variant === 'date')
        await db.auditLog.update({
          where: { id: f.acceptance.id },
          data: { createdAt: new Date('2020-01-01') },
        });
      expect((await call('get', base + '/' + f.entry.id).expect(200)).body.blockedReason).toContain(
        'acceptation',
      );
      await upload(f.entry.id).expect(409);
      expect(await annotations(f.entry.id)).toHaveLength(0);
    }
  });
  it('rejects incomplete or incoherent adjusted sources and a journal still posted for expected amounts', async () => {
    for (const variant of [
      'line',
      'variance',
      'gross',
      'total',
      'tax',
      'journal',
      'reference',
      'reconciliation',
    ]) {
      const f = await acceptedCarrier();
      if (variant === 'line')
        await db.invoiceLine.update({
          where: { id: f.invoice.lines[0].id },
          data: { invoicedAmount: null },
        });
      if (variant === 'variance')
        await db.invoiceLine.update({
          where: { id: f.invoice.lines[0].id },
          data: { variance: '19' },
        });
      if (variant === 'gross')
        await db.invoice.update({ where: { id: f.invoice.id }, data: { varianceGross: '19' } });
      if (variant === 'total')
        await db.invoice.update({ where: { id: f.invoice.id }, data: { invoicedTotal: '119' } });
      if (variant === 'tax')
        await db.invoice.update({
          where: { id: f.invoice.id },
          data: { taxDetail: { lines: [] } },
        });
      if (variant === 'reference')
        await db.invoice.update({
          where: { id: f.invoice.id },
          data: { carrierInvoiceNumber: '' },
        });
      if (variant === 'reconciliation')
        await db.invoice.update({ where: { id: f.invoice.id }, data: { reconciledAt: null } });
      if (variant === 'journal')
        for (const line of f.entry.lines)
          await db.journalLine.update({
            where: { id: line.id },
            data: { debit: line.debit, credit: line.credit },
          });
      expect(
        (await call('get', base + '/' + f.entry.id).expect(200)).body.blockedReason,
      ).toBeTruthy();
      await upload(f.entry.id).expect(409);
    }
  });
  it('invalidates adjusted invoice reviews when acceptance evidence changes and keeps source permissions', async () => {
    const f = await acceptedCarrier(),
      d = await decision(f.entry.id);
    await call('get', base + '/' + f.entry.id, undefined, 'reader').expect(403);
    await upload(f.entry.id, randomUUID(), 'qualifier').expect(403);
    await call('get', base + '/' + f.entry.id, undefined, 'manager', 1).expect(404);
    await db.auditLog.update({
      where: { id: f.acceptance.id },
      data: { createdAt: new Date(f.acceptance.createdAt.getTime() + 1) },
    });
    await call('post', base + '/' + f.entry.id + '/confirm', d).expect(409);
    expect(await annotations(f.entry.id)).toHaveLength(0);
    const fresh = await decision(f.entry.id);
    const results = await Promise.all([
      call('post', base + '/' + f.entry.id + '/confirm', fresh),
      call('post', base + '/' + f.entry.id + '/confirm', fresh),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results.filter((r) => r.body.replayed)).toHaveLength(1);
    expect(await annotations(f.entry.id)).toHaveLength(1);
  });
  it('rolls back adjusted invoice qualification on audit failure and resumes the same request', async () => {
    const f = await acceptedCarrier(),
      d = await decision(f.entry.id),
      before = await original(f.entry.id);
    const audit = app.get(AuditLogsService),
      log = audit.log.bind(audit);
    const spy = jest.spyOn(audit, 'log').mockImplementation(async (input, tx) => {
      if (input.entityType === 'ledger-currency-qualification')
        throw Error('forced adjusted invoice audit failure');
      return log(input, tx);
    });
    try {
      await call('post', base + '/' + f.entry.id + '/confirm', d).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await annotations(f.entry.id)).toHaveLength(0);
    expect(await original(f.entry.id)).toEqual(before);
    await call('post', base + '/' + f.entry.id + '/confirm', d).expect(201);
  });
  it('leaves an accepted carrier invoice UI fixture', async () => {
    const f = await acceptedCarrier();
    await db.journalEntry.update({
      where: { id: f.entry.id },
      data: { memo: 'UI · facture transporteur ajustée' },
    });
  });
  it('never recalculates an adjusted carrier payable from expected lines', async () => {
    const f = await historicalInvoice(true);
    await db.invoice.update({
      where: { id: f.invoice.id },
      data: { totalAmount: '120', invoicedTotal: '120' },
    });
    const view = (await call('get', base + '/' + f.entry.id).expect(200)).body;
    expect(view.blockedReason).toContain('Facture transporteur ajustée');
    await upload(f.entry.id).expect(409);
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).totalAmount.toString(),
    ).toBe('120');
  });
  it('serializes credit issuance against withdrawal without a split qualified state', async () => {
    const f = await historicalInvoice(),
      d = await decision(f.entry.id);
    await call('post', base + '/' + f.entry.id + '/confirm', d).expect(201);
    const path = 'billing/customer-invoices/' + f.invoice.id + '/credits';
    const draft = (
      await call('post', path, {
        operationKey: randomUUID(),
        expectedVersion: 0,
        reason: 'Avoir concurrent à la reprise',
        lines: [{ invoiceLineId: f.invoice.lines[0].id, quantity: 2 }],
      }).expect(201)
    ).body;
    const withdrawal = await decision(f.entry.id, {
      action: 'WITHDRAW',
      currency: '',
      expectedVersion: 1,
    });
    const [withdrawn, issued] = await Promise.all([
      call('post', base + '/' + f.entry.id + '/confirm', withdrawal),
      call('post', path + '/' + draft.id + '/issue'),
    ]);
    expect([withdrawn.status, issued.status].sort()).toEqual([201, 409]);
    const state = (await annotations(f.entry.id))[0].state;
    const note = await db.customerCreditNote.findUniqueOrThrow({ where: { id: draft.id } });
    expect([state, note.status]).toEqual(
      issued.status === 201 ? ['QUALIFIED', 'ISSUED'] : ['WITHDRAWN', 'DRAFT'],
    );
  });
  it('qualifies only posted allocations for partial receive/pay, preserves remainder and reverses exactly', async () => {
    for (const pay of [false, true]) {
      const { entry, payment, invoice } = await historicalPayment(pay, '15.01');
      const before = await original(entry.id);
      const source = (await call('get', base + '/' + entry.id).expect(200)).body.source;
      expect(source).toMatchObject({
        total: '15.01',
        allocatedAmount: '12.34',
        unallocatedAmount: '2.67',
        allocationState: 'PARTIAL',
        qualificationScope: 'ALLOCATIONS_ONLY',
      });
      await call('get', base + '/' + entry.id, undefined, 'qualifier').expect(403);
      const d = await decision(entry.id);
      const result = (await call('post', base + '/' + entry.id + '/confirm', d).expect(201)).body;
      expect(result.snapshot.impact.totalDebit).toBe('12.34');
      expect(result.snapshot.source.unallocatedAmount).toBe('2.67');
      expect(await original(entry.id)).toEqual(before);
      expect(await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(payment);
      const invoiceRead = () =>
        pay
          ? db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
          : db.customerInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect((await invoiceRead()).amountPaid.toString()).toBe('12.34');
      await call('post', 'billing/payments/' + payment.id + '/cancel').expect(201);
      const reversal = await db.journalEntry.findFirstOrThrow({
        where: {
          tenantId: tenants[0].id,
          sourceType: 'payment',
          sourceId: payment.id,
          sourceKind: 'reversal',
        },
        include: { lines: true },
      });
      expect(reversal.currency).toBeNull();
      for (const l of before.lines) {
        const inverse = reversal.lines.find((r) => r.accountId === l.accountId)!;
        expect(inverse.debit.toString()).toBe(l.credit.toString());
        expect(inverse.credit.toString()).toBe(l.debit.toString());
      }
      expect((await invoiceRead()).amountPaid.toString()).toBe('0');
      expect(
        (await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).totalAmount.toString(),
      ).toBe('15.01');
      expect(await annotations(entry.id)).toHaveLength(2);
      const withdrawal = await decision(entry.id, {
        action: 'WITHDRAW',
        currency: '',
        expectedVersion: 1,
      });
      await call('post', base + '/' + entry.id + '/confirm', withdrawal).expect(201);
      expect(
        (await annotations(entry.id)).every((a) => a.state === 'WITHDRAWN' && a.version === 2),
      ).toBe(true);
    }
  });
  it('rejects partial journals posted for the declared total, missing allocations and stale remainder reviews', async () => {
    const f = await historicalPayment(false, '15.01'),
      d = await decision(f.entry.id);
    await db.payment.update({ where: { id: f.payment.id }, data: { totalAmount: '16.01' } });
    await call('post', base + '/' + f.entry.id + '/confirm', d).expect(409);
    const fresh = await decision(f.entry.id);
    expect(
      (await call('post', base + '/' + f.entry.id + '/confirm', fresh).expect(201)).body.snapshot
        .source.unallocatedAmount,
    ).toBe('3.67');
    const wrong = await historicalPayment(false, '15.01');
    for (const l of wrong.entry.lines)
      await db.journalLine.update({
        where: { id: l.id },
        data: l.debit.gt(0) ? { debit: '15.01' } : { credit: '15.01' },
      });
    expect(
      (await call('get', base + '/' + wrong.entry.id).expect(200)).body.blockedReason,
    ).toContain('total affecté');
    await upload(wrong.entry.id).expect(409);
    const empty = await historicalPayment(false, '15.01');
    await db.paymentAllocation.deleteMany({
      where: { tenantId: tenants[0].id, paymentId: empty.payment.id },
    });
    await upload(empty.entry.id).expect(409);
  });
  it('keeps bank reconciliation blocked for both declared and posted amounts on a qualified partial payment', async () => {
    const f = await historicalPayment(false, '15.01'),
      d = await decision(f.entry.id);
    await call('post', base + '/' + f.entry.id + '/confirm', d).expect(201);
    const account = await db.bankAccount.create({
      data: { tenantId: tenants[0].id, name: randomUUID(), currency: 'CAD', glAccountCode: '1010' },
    });
    for (const amount of ['15.01', '12.34']) {
      const txn = await db.bankTransaction.create({
        data: {
          tenantId: tenants[0].id,
          bankAccountId: account.id,
          date: f.payment.date,
          amount,
          description: 'Partial payment guard',
        },
      });
      const rejected = await call('post', 'billing/bank-transactions/' + txn.id + '/match', {
        paymentId: f.payment.id,
      }).expect(400);
      expect(rejected.body.message).toContain('entièrement alloué');
      expect(
        (await db.bankTransaction.findUniqueOrThrow({ where: { id: txn.id } })).matchedPaymentId,
      ).toBeNull();
    }
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).reconciledAt,
    ).toBeNull();
  });
  it('qualifies an already cancelled partial group atomically and rolls everything back on audit failure', async () => {
    const f = await historicalPayment(false, '15.01');
    await call('post', 'billing/payments/' + f.payment.id + '/cancel').expect(201);
    const d = await decision(f.entry.id),
      audit = app.get(AuditLogsService),
      real = audit.log.bind(audit);
    const spy = jest.spyOn(audit, 'log').mockImplementation(async (input, tx) => {
      if (input.entityType === 'ledger-currency-qualification')
        throw Error('forced partial payment audit failure');
      return real(input, tx);
    });
    try {
      await call('post', base + '/' + f.entry.id + '/confirm', d).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await annotations(f.entry.id)).toHaveLength(0);
    expect(
      await db.ledgerCurrencyRevision.count({
        where: { tenantId: tenants[0].id, entryId: f.entry.id },
      }),
    ).toBe(0);
    await call('post', base + '/' + f.entry.id + '/confirm', d).expect(201);
    expect(await annotations(f.entry.id)).toHaveLength(2);
    expect(
      (await call('post', base + '/' + f.entry.id + '/confirm', d).expect(201)).body.replayed,
    ).toBe(true);
  });
  it('serializes partial payment qualification with cancellation without losing child provenance', async () => {
    const f = await historicalPayment(false, '15.01'),
      d = await decision(f.entry.id);
    const [qualified, cancelled] = await Promise.all([
      call('post', base + '/' + f.entry.id + '/confirm', d),
      call('post', 'billing/payments/' + f.payment.id + '/cancel'),
    ]);
    expect(cancelled.status).toBe(201);
    expect([201, 409]).toContain(qualified.status);
    if (qualified.status === 409) {
      const fresh = await decision(f.entry.id);
      await call('post', base + '/' + f.entry.id + '/confirm', fresh).expect(201);
    }
    expect((await annotations(f.entry.id)).map((a) => [a.state, a.version])).toEqual([
      ['QUALIFIED', 1],
      ['QUALIFIED', 1],
    ]);
  });
  async function historicalAsset() {
    const tenantId = tenants[0].id;
    const asset = await db.fixedAsset.create({
      data: {
        tenantId,
        assetCode: 'HIST-' + randomUUID(),
        name: 'Presse atelier historique',
        acquisitionDate: new Date('2024-01-15T00:00:00Z'),
        cost: '1200',
        salvageValue: '0',
        usefulLifeMonths: 12,
        status: 'ACTIVE',
        accumulatedDepreciation: '200',
      },
    });
    const accounts = await db.chartOfAccount.findMany({
      where: { tenantId, code: { in: ['5100', '1590'] } },
    });
    const entries = [],
      depreciations = [];
    for (const month of ['01', '03']) {
      const period = new Date(`2024-${month}-01T00:00:00Z`);
      const d = await db.depreciationEntry.create({
        data: { tenantId, assetId: asset.id, period, amount: '100' },
      });
      const e = await db.journalEntry.create({
        data: {
          tenantId,
          date: period,
          currency: null,
          sourceType: 'depreciation',
          sourceId: d.id,
          memo: `Dotation historique ${asset.assetCode} ${month}`,
          lines: {
            create: accounts.map((a) => ({
              tenantId,
              accountId: a.id,
              debit: a.code === '5100' ? '100' : '0',
              credit: a.code === '1590' ? '100' : '0',
            })),
          },
        },
        include: { lines: true },
      });
      depreciations.push(d);
      entries.push(e);
    }
    return { asset, entries, depreciations };
  }
  it('qualifies all recorded asset depreciations on explicit evidence without rebuilding the plan', async () => {
    const f = await historicalAsset(),
      id = f.entries[0].id;
    const before = await Promise.all(f.entries.map((e) => original(e.id)));
    const detail = (await call('get', base + '/' + id).expect(200)).body;
    expect(detail.source).toMatchObject({
      kind: 'FIXED_ASSET',
      currency: null,
      total: '200.00',
      unrecordedMonthCount: 1,
      futurePlanBlocked: true,
    });
    const child = (await call('get', base + '/' + f.entries[1].id).expect(200)).body;
    expect(child.anchorEntryId).toBe(id);
    expect(child.blockedReason).toContain('ensemble');
    await upload(f.entries[1].id).expect(409);
    const d = await decision(id, { currency: 'USD' }, 'assetQualifier');
    const r = (await call('post', base + '/' + id + '/confirm', d, 'assetQualifier').expect(201))
      .body;
    expect(r.snapshot.impact).toMatchObject({ groupTotal: '200.00', entryCount: 2 });
    expect(
      (await annotations(id)).every((a) => a.currency === 'USD' && a.sourceEntryId === id),
    ).toBe(true);
    expect(await annotations(id)).toHaveLength(2);
    expect(await Promise.all(f.entries.map((e) => original(e.id)))).toEqual(before);
    expect(await db.fixedAsset.findUnique({ where: { id: f.asset.id } })).toEqual(f.asset);
    expect(
      await db.depreciationEntry.findMany({
        where: { tenantId: tenants[0].id, assetId: f.asset.id },
        orderBy: { period: 'asc' },
      }),
    ).toEqual(f.depreciations);
    const schedule = (
      await call('get', 'billing/fixed-assets/' + f.asset.id + '/schedule').expect(200)
    ).body;
    expect(schedule).toMatchObject({
      qualified: false,
      next: null,
      rows: [],
      historicalAnchorEntryId: id,
    });
    expect(
      (
        await call(
          'get',
          'billing/fixed-assets/' + f.asset.id + '/schedule',
          undefined,
          'assetReader',
        ).expect(200)
      ).body,
    ).not.toHaveProperty('historicalAnchorEntryId');
    await call('post', 'billing/fixed-assets/' + f.asset.id + '/depreciate', {
      operationKey: randomUUID(),
      expectedVersion: 1,
      confirmed: true,
      period: '2024-04',
    }).expect(409);
  });
  it('withdraws all asset annotations before a new currency and replays the original decision', async () => {
    const reportPath = 'billing/reports/profit-and-loss?currency=USD&from=2024-01-01&to=2024-03-31';
    const reportBefore = (await call('get', reportPath).expect(200)).body;
    const f = await historicalAsset(),
      id = f.entries[0].id,
      d = await decision(id, { currency: 'USD' });
    const r = (await call('post', base + '/' + id + '/confirm', d).expect(201)).body;
    const reportQualified = (await call('get', reportPath).expect(200)).body;
    expect(reportQualified.netIncome).toBe(
      ledgerAmount(ledgerCents(reportBefore.netIncome) - 20000n),
    );
    expect(reportQualified.coverage.qualifiedHistoricalEntries).toBe(
      reportBefore.coverage.qualifiedHistoricalEntries + 2,
    );
    const w = await decision(id, { action: 'WITHDRAW', currency: '', expectedVersion: 1 });
    await call('post', base + '/' + id + '/confirm', w).expect(201);
    const reportWithdrawn = (await call('get', reportPath).expect(200)).body;
    expect(reportWithdrawn.netIncome).toBe(reportBefore.netIncome);
    expect(reportWithdrawn.coverage.qualifiedHistoricalEntries).toBe(
      reportBefore.coverage.qualifiedHistoricalEntries,
    );
    expect((await annotations(id)).every((a) => a.state === 'WITHDRAWN' && a.version === 2)).toBe(
      true,
    );
    await call(
      'post',
      base + '/' + id + '/confirm',
      await decision(id, { currency: 'CAD', expectedVersion: 2 }),
    ).expect(201);
    expect((await annotations(id)).every((a) => a.currency === 'CAD' && a.version === 3)).toBe(
      true,
    );
    expect((await call('post', base + '/' + id + '/confirm', d).expect(201)).body.snapshot).toEqual(
      r.snapshot,
    );
  });
  it('blocks missing, mixed, excessive or inconsistent asset journals and foreign relations', async () => {
    for (const variant of [
      'cumulative',
      'missing',
      'mixed',
      'foreign',
      'date',
      'amount',
      'draft',
      'plan',
    ]) {
      const f = await historicalAsset(),
        id = f.entries[0].id;
      if (variant === 'cumulative')
        await db.fixedAsset.update({
          where: { id: f.asset.id },
          data: { accumulatedDepreciation: '201' },
        });
      if (variant === 'missing') await db.journalEntry.delete({ where: { id: f.entries[1].id } });
      if (variant === 'mixed')
        await db.journalEntry.update({ where: { id: f.entries[1].id }, data: { currency: 'CAD' } });
      if (variant === 'foreign')
        await db.depreciationEntry.update({
          where: { id: f.depreciations[1].id },
          data: { tenantId: tenants[1].id },
        });
      if (variant === 'date')
        await db.journalEntry.update({
          where: { id: f.entries[1].id },
          data: { date: new Date('2024-03-02') },
        });
      if (variant === 'amount')
        await db.depreciationEntry.update({
          where: { id: f.depreciations[1].id },
          data: { amount: '101' },
        });
      if (variant === 'draft')
        await db.fixedAsset.update({ where: { id: f.asset.id }, data: { status: 'DRAFT' } });
      if (variant === 'plan')
        await db.fixedAsset.update({
          where: { id: f.asset.id },
          data: {
            currency: 'CAD',
            version: 1,
            depreciationStartDate: new Date('2024-01-01'),
            planSnapshot: { unexpected: true },
            planHash: 'a'.repeat(64),
          },
        });
      expect((await call('get', base + '/' + id).expect(200)).body.blockedReason).toBeTruthy();
      await upload(id).expect(409);
      expect(await annotations(id)).toHaveLength(0);
    }
  });
  it('binds the asset review to all source records and serializes competing group decisions', async () => {
    const f = await historicalAsset(),
      id = f.entries[0].id,
      d = await decision(id);
    await db.fixedAsset.update({
      where: { id: f.asset.id },
      data: { name: 'Nom relu après la revue' },
    });
    await call('post', base + '/' + id + '/confirm', d).expect(409);
    const one = await decision(id),
      two = await decision(id, { currency: 'USD' });
    const r = await Promise.all([
      call('post', base + '/' + id + '/confirm', one),
      call('post', base + '/' + id + '/confirm', two),
    ]);
    expect(r.map((v) => v.status).sort()).toEqual([201, 409]);
    const qs = await annotations(id);
    expect(qs).toHaveLength(2);
    expect(new Set(qs.map((q) => q.currency)).size).toBe(1);
  });
  it('rolls back a complete asset group when audit fails and resumes the same request', async () => {
    const f = await historicalAsset(),
      id = f.entries[0].id,
      d = await decision(id);
    const audit = app.get(AuditLogsService),
      log = audit.log.bind(audit);
    const spy = jest.spyOn(audit, 'log').mockImplementation(async (input, tx) => {
      if (input.entityType === 'ledger-currency-qualification')
        throw Error('forced asset group audit failure');
      return log(input, tx);
    });
    try {
      await call('post', base + '/' + id + '/confirm', d).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await annotations(id)).toHaveLength(0);
    await call('post', base + '/' + id + '/confirm', d).expect(201);
    expect(await annotations(id)).toHaveLength(2);
  });
  it('guards asset history, evidence and exact replay after source rights are revoked', async () => {
    const f = await historicalAsset(),
      id = f.entries[0].id;
    await call('get', base + '/' + id, undefined, 'reader').expect(403);
    await upload(id, randomUUID(), 'qualifier').expect(403);
    await call('get', base + '/' + id, undefined, 'manager', 1).expect(404);
    const d = await decision(id, {}, 'assetQualifier');
    await call('post', base + '/' + id + '/confirm', d, 'assetQualifier').expect(201);
    await db.rolePermission.deleteMany({
      where: {
        role: { tenantId: tenants[0].id, key: 'assetQualifier' },
        permission: { key: 'billing.assets.read' },
      },
    });
    tenants[0].tokens.assetQualifier = (
      await request(http)
        .post('/api/v1/auth/login')
        .send({
          tenant: prefix + '-0',
          email: `assetqualifier@${prefix}-0.test`,
          password: 'Test1234!',
        })
        .expect(200)
    ).body.accessToken;
    await call('get', base + '/' + id, undefined, 'assetQualifier').expect(403);
    await call('get', base + '/' + id + '/evidence', undefined, 'assetQualifier').expect(403);
    await call(
      'get',
      base + '/' + id + '/evidence/' + d.evidenceId + '/download',
      undefined,
      'assetQualifier',
    ).expect(403);
    await call('get', base + '/requests/' + d.operationKey, undefined, 'assetQualifier').expect(
      403,
    );
    await call('post', base + '/' + id + '/confirm', d, 'assetQualifier').expect(403);
  });
  it('leaves a grouped historical asset UI fixture with a visible missing month', async () => {
    const f = await historicalAsset();
    await db.fixedAsset.update({
      where: { id: f.asset.id },
      data: { assetCode: 'HIST-PRESSE-01' },
    });
    await db.journalEntry.update({
      where: { id: f.entries[0].id },
      data: { memo: 'UI · dotations historiques immobilisation' },
    });
    await db.journalEntry.update({
      where: { id: f.entries[1].id },
      data: { memo: 'UI · dotation enfant immobilisation' },
    });
  });
  it('leaves a partial payment UI fixture with an explicit unposted remainder', async () => {
    const f = await historicalPayment(false, '15.01');
    await db.journalEntry.update({
      where: { id: f.entry.id },
      data: { memo: 'UI · paiement avec reste non affecté' },
    });
  });
});
