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

describe('I2m.2c qualified fixed assets', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `asset-currency-${Date.now()}`,
    base = 'billing/fixed-assets';
  const tenants: { id: string; tokens: Record<string, string> }[] = [];
  const R = 'billing.assets.read',
    M = 'billing.assets.manage',
    Q = 'billing.assets.post';
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
        writer: [R, M],
        poster: [R, M, Q],
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
    console.log(`ASSET_CURRENCY_TENANT=${prefix}-0`);
    for (const t of tenants) await app.get(LedgerService).ensureChart(t.id);
  }, 120000);
  afterAll(async () => app?.close());

  const input = (change: object = {}) => ({
    operationKey: randomUUID(),
    assetCode: 'A-' + randomUUID().slice(0, 12),
    name: 'Machine',
    category: 'Atelier',
    acquisitionReference: 'Facture test',
    currency: 'CAD',
    acquisitionDate: '2024-01-25',
    depreciationStartMonth: '2024-01',
    cost: '100.00',
    salvageValue: '0.00',
    usefulLifeMonths: 3,
    depreciationExpenseAccountCode: '5100',
    accumulatedDepreciationAccountCode: '1590',
    ...change,
  });
  const action = (version: number, change: object = {}) => ({
    operationKey: randomUUID(),
    expectedVersion: version,
    confirmed: true,
    ...change,
  });
  const create = async (change: object = {}) =>
    (await call('post', base, input(change)).expect(201)).body;
  async function activate(a: any) {
    const r = (await call('get', base + '/' + a.id + '/schedule').expect(200)).body;
    return (
      await call(
        'post',
        base + '/' + a.id + '/activate',
        action(a.version, { reviewToken: r.reviewToken }),
      ).expect(201)
    ).body;
  }
  it('isolates tenants, modules, readers and dedicated posting permission', async () => {
    await call('get', base, undefined, 'manager', 2).expect(403);
    await call('get', base, undefined, 'carrier').expect(403);
    await call('post', base, input(), 'reader').expect(403);
    expect(
      (await call('get', base + '/accounts', undefined, 'writer').expect(200)).body.some(
        (a: any) => a.code === '5100',
      ),
    ).toBe(true);
    const a = await activate(await create());
    await call(
      'post',
      base + '/' + a.id + '/depreciate',
      action(a.version, { period: '2024-01' }),
      'writer',
    ).expect(403);
    for (const suffix of ['', '/schedule', '/history'])
      await call('get', base + '/' + a.id + suffix, undefined, 'manager', 1).expect(404);
    await call(
      'post',
      base + '/' + a.id + '/depreciate',
      action(a.version, { period: '2024-01' }),
      'manager',
      1,
    ).expect(404);
    await call(
      'post',
      base + '/' + a.id + '/depreciate',
      action(a.version, { period: '2024-01' }),
      'poster',
    ).expect(201);
  });
  it('rejects invalid contracts instead of coercing financial numbers or dates', async () => {
    for (const change of [
      { currency: 'XXX' },
      { cost: 100 },
      { cost: '100.001' },
      { cost: '-1' },
      { salvageValue: '101' },
      { usefulLifeMonths: 0 },
      { acquisitionDate: '2024-02-30' },
      { depreciationStartMonth: '2023-12' },
      { depreciationExpenseAccountCode: '4000' },
      { accumulatedDepreciationAccountCode: '5100' },
      { name: ' ' },
      { tenantId: tenants[1].id },
    ])
      await call('post', base, input(change)).expect(400);
    const d = input();
    delete (d as any).operationKey;
    await call('post', base, d).expect(400);
  });
  it('creates exact currency-qualified drafts, replays actor-bound requests, and versions edits', async () => {
    const d = input({ assetCode: 'EXACT-USD', currency: 'USD' });
    const rs = await Promise.all([
      call('post', base, d).expect(201),
      call('post', base, d).expect(201),
    ]);
    expect(rs[0].body).toEqual(rs[1].body);
    const a = rs[0].body;
    expect(a).toMatchObject({ version: 1, currency: 'USD', status: 'DRAFT', planHash: null });
    expect(a).not.toHaveProperty('planSnapshot');
    await call('post', base, { ...d, cost: '101' }).expect(409);
    await call('post', base, d, 'writer').expect(409);
    const edit = { ...d, operationKey: randomUUID(), expectedVersion: 1, cost: '120.00' };
    const b = (await call('patch', base + '/' + a.id, edit).expect(200)).body;
    expect(b.version).toBe(2);
    await call('patch', base + '/' + a.id, { ...edit, operationKey: randomUUID() }).expect(409);
    expect((await call('patch', base + '/' + a.id, edit).expect(200)).body).toEqual(b);
    const oldReview = (await call('get', base + '/' + a.id + '/schedule')).body;
    await call(
      'post',
      base + '/' + a.id + '/activate',
      action(2, { reviewToken: 'a'.repeat(64) }),
    ).expect(409);
    await call(
      'post',
      base + '/' + a.id + '/activate',
      action(2, { reviewToken: oldReview.reviewToken, confirmed: false }),
    ).expect(400);
    await activate(b);
    await call('patch', base + '/' + a.id, {
      ...edit,
      operationKey: randomUUID(),
      expectedVersion: 3,
    }).expect(409);
    await call('delete', base + '/' + a.id).expect(409);
    expect(
      (await call('get', base + '/' + a.id + '/history')).body.map((h: any) => h.version),
    ).toEqual([3, 2, 1]);
  });
  it('freezes exact schedule and posts chronological months with one GL entry per positive amount', async () => {
    let a = await activate(await create({ assetCode: 'POST-CAD' }));
    const frozen = await db.fixedAsset.findFirstOrThrow({
      where: { tenantId: tenants[0].id, id: a.id },
    });
    const review = (await call('get', base + '/' + a.id + '/schedule')).body;
    expect(review.rows.map((r: any) => r.amount)).toEqual(['33.33', '33.34', '33.33']);
    await call(
      'post',
      base + '/' + a.id + '/depreciate',
      action(a.version, { period: '2024-02' }),
    ).expect(409);
    const d = action(a.version, { period: '2024-01' });
    const rs = await Promise.all([
      call('post', base + '/' + a.id + '/depreciate', d).expect(201),
      call('post', base + '/' + a.id + '/depreciate', d).expect(201),
    ]);
    expect(rs[0].body).toEqual(rs[1].body);
    a = rs[0].body;
    for (const period of ['2024-02', '2024-03'])
      a = (
        await call('post', base + '/' + a.id + '/depreciate', action(a.version, { period })).expect(
          201,
        )
      ).body;
    expect(a.accumulatedDepreciation).toBe('100');
    await call(
      'post',
      base + '/' + a.id + '/depreciate',
      action(a.version, { period: '2024-04' }),
    ).expect(409);
    const entries = await db.depreciationEntry.findMany({
      where: { tenantId: tenants[0].id, assetId: a.id },
      orderBy: { ordinal: 'asc' },
      include: { journalEntry: { include: { lines: true } } },
    });
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.journalEntry?.date.toISOString().slice(0, 10))).toEqual([
      '2024-01-31',
      '2024-02-29',
      '2024-03-31',
    ]);
    for (const e of entries) {
      expect(e.currency).toBe('CAD');
      expect(e.journalEntry?.currency).toBe('CAD');
      expect(e.journalEntry?.lines).toHaveLength(2);
      expect(
        e.journalEntry?.lines.reduce((n, l) => n + Number(l.debit) - Number(l.credit), 0),
      ).toBe(0);
    }
    const after = await db.fixedAsset.findFirstOrThrow({
      where: { tenantId: tenants[0].id, id: a.id },
    });
    expect(after.planSnapshot).toEqual(frozen.planSnapshot);
    expect(after.planHash).toBe(frozen.planHash);
    expect(
      (await call('post', base + '/' + a.id + '/depreciate', d).expect(201)).body.version,
    ).toBe(3);
  });
  it('serializes distinct competing requests and never overruns the base', async () => {
    let a = await activate(await create({ cost: '0.05', usefulLifeMonths: 2 }));
    const rs = await Promise.all([
      call('post', base + '/' + a.id + '/depreciate', action(a.version, { period: '2024-01' })),
      call('post', base + '/' + a.id + '/depreciate', action(a.version, { period: '2024-02' })),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    a = (await call('get', base + '/' + a.id)).body;
    a = (
      await call(
        'post',
        base + '/' + a.id + '/depreciate',
        action(a.version, { period: '2024-02' }),
      ).expect(201)
    ).body;
    expect(a.accumulatedDepreciation).toBe('0.05');
  });
  it('records zero months without fake GL and preserves the residual floor', async () => {
    let a = await activate(await create({ cost: '0.02', salvageValue: '0.01' }));
    for (const period of ['2024-01', '2024-02', '2024-03'])
      a = (
        await call('post', base + '/' + a.id + '/depreciate', action(a.version, { period })).expect(
          201,
        )
      ).body;
    const es = await db.depreciationEntry.findMany({
      where: { tenantId: tenants[0].id, assetId: a.id },
      orderBy: { ordinal: 'asc' },
    });
    expect(es.map((e) => e.amount.toFixed(2))).toEqual(['0.00', '0.01', '0.00']);
    expect(es.filter((e) => e.journalEntryId)).toHaveLength(1);
    expect(a.accumulatedDepreciation).toBe('0.01');
  });
  it('prevents future postings, incomplete bodies and stale reviews', async () => {
    const d = input({ acquisitionDate: '2090-01-01', depreciationStartMonth: '2090-01' });
    let a = (await call('post', base, d)).body;
    const old = (await call('get', base + '/' + a.id + '/schedule')).body;
    a = (
      await call('patch', base + '/' + a.id, {
        ...d,
        operationKey: randomUUID(),
        expectedVersion: 1,
        cost: '50',
      })
    ).body;
    await call(
      'post',
      base + '/' + a.id + '/activate',
      action(a.version, { reviewToken: old.reviewToken }),
    ).expect(409);
    a = await activate(a);
    await call(
      'post',
      base + '/' + a.id + '/depreciate',
      action(a.version, { period: '2090-01' }),
    ).expect(409);
    await call('post', base + '/' + a.id + '/depreciate', { period: '2090-01' }).expect(400);
    await call(
      'post',
      base + '/' + a.id + '/depreciate',
      action(a.version, { period: '2090-01', amount: '1' }),
    ).expect(400);
  });
  it('keeps historical NULL records readable and blocks all new unqualified postings', async () => {
    const a = await db.fixedAsset.create({
      data: {
        tenantId: tenants[0].id,
        assetCode: 'HISTORICAL',
        name: 'Historical asset',
        acquisitionDate: new Date('2020-01-01'),
        cost: '100',
        usefulLifeMonths: 12,
        status: 'ACTIVE',
      },
    });
    const r = (await call('get', base + '/' + a.id + '/schedule').expect(200)).body;
    expect(r).toMatchObject({ qualified: false, rows: [], next: null, reviewToken: null });
    await call('post', base + '/' + a.id + '/depreciate', action(1, { period: '2024-01' })).expect(
      409,
    );
    await call('post', base + '/' + a.id + '/dispose', action(1, { reason: 'Legacy stop' })).expect(
      409,
    );
    await call('patch', base + '/' + a.id, { ...input(), expectedVersion: 1 }).expect(409);
    await expect(
      db.$transaction((tx) =>
        app.get(LedgerService).postTx(tx, tenants[0].id, {
          currency: null,
          sourceType: 'depreciation',
          sourceId: randomUUID(),
          lines: [
            { accountCode: '5100', debit: '1' },
            { accountCode: '1590', credit: '1' },
          ],
        }),
      ),
    ).rejects.toThrow('Devise');
  });
  it('rechecks active account types before activation/posting without breaking exact replay', async () => {
    let a = await create();
    const r = (await call('get', base + '/' + a.id + '/schedule')).body;
    await db.chartOfAccount.updateMany({
      where: { tenantId: tenants[0].id, code: '5100' },
      data: { active: false },
    });
    try {
      await call(
        'post',
        base + '/' + a.id + '/activate',
        action(a.version, { reviewToken: r.reviewToken }),
      ).expect(400);
    } finally {
      await db.chartOfAccount.updateMany({
        where: { tenantId: tenants[0].id, code: '5100' },
        data: { active: true },
      });
    }
    a = await activate(a);
    const d = action(a.version, { period: '2024-01' });
    a = (await call('post', base + '/' + a.id + '/depreciate', d)).body;
    await db.chartOfAccount.updateMany({
      where: { tenantId: tenants[0].id, code: '5100' },
      data: { active: false },
    });
    try {
      expect((await call('post', base + '/' + a.id + '/depreciate', d).expect(201)).body).toEqual(
        a,
      );
      await call(
        'post',
        base + '/' + a.id + '/depreciate',
        action(a.version, { period: '2024-02' }),
      ).expect(400);
    } finally {
      await db.chartOfAccount.updateMany({
        where: { tenantId: tenants[0].id, code: '5100' },
        data: { active: true },
      });
    }
  });
  it('rolls back GL, period, cumulative amount, operation and version when audit fails', async () => {
    const a = await activate(await create());
    const audit = app.get(AuditLogsService),
      original = audit.log.bind(audit);
    const spy = jest.spyOn(audit, 'log').mockImplementation(async (entry: any, tx: any) => {
      if (entry.entityType === 'fixed-asset') throw Error('Audit unavailable');
      return original(entry, tx);
    });
    try {
      await call(
        'post',
        base + '/' + a.id + '/depreciate',
        action(a.version, { period: '2024-01' }),
      ).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await call('get', base + '/' + a.id)).body.version).toBe(a.version);
    expect(
      await db.depreciationEntry.count({ where: { tenantId: tenants[0].id, assetId: a.id } }),
    ).toBe(0);
    expect(
      await db.fixedAssetOperation.count({ where: { tenantId: tenants[0].id, assetId: a.id } }),
    ).toBe(2);
    expect(
      await db.journalEntry.count({
        where: { tenantId: tenants[0].id, memo: 'Dotation ' + a.assetCode + ' 2024-01' },
      }),
    ).toBe(0);
  });
  it('withdraws with reason and version without pretending to dispose accounting balances', async () => {
    let a = await activate(await create());
    a = (
      await call(
        'post',
        base + '/' + a.id + '/depreciate',
        action(a.version, { period: '2024-01' }),
      )
    ).body;
    const count = await db.journalEntry.count({ where: { tenantId: tenants[0].id } });
    await call('post', base + '/' + a.id + '/dispose', action(a.version, { reason: '  ' })).expect(
      400,
    );
    const d = action(a.version, { reason: 'Remplacement équipement' });
    const retired = (await call('post', base + '/' + a.id + '/dispose', d).expect(201)).body;
    expect(retired).toMatchObject({
      status: 'DISPOSED',
      accumulatedDepreciation: a.accumulatedDepreciation,
    });
    expect((await call('post', base + '/' + a.id + '/dispose', d).expect(201)).body).toEqual(
      retired,
    );
    await call(
      'post',
      base + '/' + a.id + '/depreciate',
      action(retired.version, { period: '2024-02' }),
    ).expect(409);
    expect(await db.journalEntry.count({ where: { tenantId: tenants[0].id } })).toBe(count);
    expect((await call('get', base + '/' + a.id + '/history')).body[0].reason).toBe(
      'Remplacement équipement',
    );
  });
});
