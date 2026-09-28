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

describe('I2l.2 supplier credits', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `supplier-credits-${Date.now()}`,
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
    console.log(`SUPPLIER_CREDITS_TENANT=${prefix}-0`);
    console.log(`SUPPLIER_CREDITS_LINKED_TENANT=${prefix}-1`);
  }, 120000);
  afterAll(async () => app?.close());
  async function fixture(tenant = 0) {
    const supplier = (
      await call(
        'post',
        'billing/data/suppliers',
        { code: randomUUID(), name: 'Fournisseur de services' },
        'manager',
        tenant,
      ).expect(201)
    ).body;
    const body = {
      operationKey: randomUUID(),
      supplierId: supplier.id,
      externalNumber: `FV-${randomUUID()}`,
      invoiceDate: '2026-09-26',
      dueDate: '2026-10-26',
      currency: 'CAD',
      notes: 'Document reçu à vérifier',
      lines: [{ description: 'Entretien', quantity: '1.25', unit: 'H', netAmount: '10.10' }],
      taxes: [{ label: 'Taxe déclarée', amount: '0.25' }],
    };
    const made = (await call('post', base, body, 'manager', tenant).expect(201)).body;
    const row = (await call('get', `${base}/${made.id}`, undefined, 'manager', tenant).expect(200))
      .body;
    return { supplier, body, row, tenant };
  }
  const pdf = Buffer.from('%PDF-1.4\nInvoice fixture\n%%EOF');
  function upload(
    f: Awaited<ReturnType<typeof fixture>>,
    key = randomUUID(),
    bytes = pdf,
    filename = 'facture.pdf',
  ) {
    return call('post', `${base}/${f.row.id}/evidence`, undefined, 'manager', f.tenant)
      .field('operationKey', key)
      .field('caption', 'Facture originale reçue')
      .attach('file', bytes, { filename, contentType: 'application/pdf' });
  }
  async function qualify(f: Awaited<ReturnType<typeof fixture>>) {
    const evidence = (await upload(f).expect(201)).body;
    const body = {
      operationKey: randomUUID(),
      expectedUpdatedAt: f.row.updatedAt,
      evidenceId: evidence.id,
      note: 'Original et montants déclarés contrôlés manuellement.',
    };
    return { body, evidence };
  }

  const credits = 'billing/supplier-credits';
  async function returnFixture(f: Awaited<ReturnType<typeof fixture>>) {
    const tenantId = tenants[f.tenant].id;
    const site = await db.location.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Entrepôt test avoir',
        type: 'WAREHOUSE',
        addressLine1: '1 Test',
        city: 'Québec',
      },
    });
    const bin = await db.bin.create({ data: { tenantId, locationId: site.id, code: 'RET' } });
    const item = await db.wmsItem.create({
      data: { tenantId, sku: randomUUID(), name: 'Article retourné', unit: 'EA', lotTracked: true },
    });
    const lot = await db.wmsLot.create({ data: { tenantId, itemId: item.id, code: 'LOT-AV' } });
    await call(
      'post',
      'wms/inventory/adjust',
      {
        operationKey: randomUUID(),
        itemId: item.id,
        lotId: lot.id,
        binId: bin.id,
        qtyDelta: 2,
        note: 'Stock initial de test',
      },
      'manager',
      f.tenant,
    ).expect(201);
    const exit = (
      await call(
        'post',
        'wms/stock-exits',
        {
          operationKey: randomUUID(),
          kind: 'SUPPLIER_RETURN',
          itemId: item.id,
          lotId: lot.id,
          binId: bin.id,
          quantity: '1',
          supplierId: f.supplier.id,
          reference: 'RMA-AV',
          destination: 'Adresse du fournisseur pour test',
          reason: 'Produit endommagé à retourner',
        },
        'manager',
        f.tenant,
      ).expect(201)
    ).body;
    const review = (
      await call('get', `wms/stock-exits/${exit.id}/review`, undefined, 'manager', f.tenant).expect(
        200,
      )
    ).body;
    await call(
      'post',
      `wms/stock-exits/${exit.id}/post`,
      {
        operationKey: randomUUID(),
        expectedUpdatedAt: review.expectedUpdatedAt,
        reviewToken: review.reviewToken,
        confirmed: true,
        completionNote: 'Remise physique confirmée au fournisseur',
      },
      'manager',
      f.tenant,
    ).expect(201);
    const evidence = (
      await call('post', `wms/stock-exits/${exit.id}/evidence`, undefined, 'manager', f.tenant)
        .field('operationKey', randomUUID())
        .field('caption', 'Réponse du fournisseur')
        .attach('file', pdf, { filename: 'retour.pdf', contentType: 'application/pdf' })
        .expect(201)
    ).body;
    const body = {
      operationKey: randomUUID(),
      expectedRevision: 0,
      received: '1',
      accepted: '1',
      refused: '0',
      reportedAt: new Date().toISOString(),
      reference: 'Acceptation RMA-AV',
      note: 'Acceptation déclarée par le fournisseur',
      evidenceId: evidence.id,
    };
    const path = `wms/stock-exits/${exit.id}/supplier-reports`;
    const report = (await call('post', path, body, 'manager', f.tenant).expect(201)).body;
    return { exit, report, path, body };
  }
  it('captures a versioned WMS return, masks it without WMS rights, and rejects stale qualification', async () => {
    const f = await source(1),
      r = await returnFixture(f),
      c = await make(f, '3.21', '0', { returnReportId: r.report.id });
    expect(c.row.returnSnapshot).toMatchObject({ revision: 1, accepted: '1', unit: 'EA' });
    const pick = (
      await call('get', `${credits}/returns/${f.row.id}`, undefined, 'manager', 1).expect(200)
    ).body;
    expect(pick.items[0].id).toBe(r.report.id);
    const hidden = (await call('get', `${credits}/${c.row.id}`, undefined, 'reader', 1).expect(200))
      .body;
    expect(hidden.hasReturnLink).toBe(true);
    expect(hidden).not.toHaveProperty('returnReportId');
    expect(hidden).not.toHaveProperty('returnSnapshot');
    await call(
      'put',
      `${credits}/${c.row.id}`,
      {
        ...c.body,
        returnReportId: undefined,
        expectedUpdatedAt: c.row.updatedAt,
        operationKey: randomUUID(),
      },
      'writer',
      1,
    ).expect(403);
    const q = await closing(c),
      before = await db.wmsStockExit.findUnique({ where: { id: r.exit.id } }),
      movements = await db.stockMovement.count({ where: { tenantId: tenants[1].id } });
    const newer = (
      await call(
        'post',
        r.path,
        {
          ...r.body,
          operationKey: randomUUID(),
          expectedRevision: 1,
          reportedAt: new Date().toISOString(),
          note: 'Confirmation détaillée reçue ensuite',
        },
        'manager',
        1,
      ).expect(201)
    ).body;
    await call('post', `${credits}/${c.row.id}/qualify`, q, 'manager', 1).expect(409);
    await call(
      'put',
      `${credits}/${c.row.id}`,
      {
        ...c.body,
        returnReportId: newer.id,
        expectedUpdatedAt: c.row.updatedAt,
        operationKey: randomUUID(),
      },
      'manager',
      1,
    ).expect(200);
    const updated = (await call('get', `${credits}/${c.row.id}`, undefined, 'manager', 1)).body;
    await call(
      'post',
      `${credits}/${c.row.id}/qualify`,
      { ...q, operationKey: randomUUID(), expectedUpdatedAt: updated.updatedAt },
      'manager',
      1,
    ).expect(201);
    expect(await db.wmsStockExit.findUnique({ where: { id: r.exit.id } })).toEqual(before);
    expect(await db.stockMovement.count({ where: { tenantId: tenants[1].id } })).toBe(movements);
    expect(
      (await call('get', `${credits}/invoice/${f.row.id}`, undefined, 'manager', 1)).body.balance
        .credited,
    ).toBe('3.21');
  });
  it('refuses wrong suppliers and rechecks WMS activation even on exact replay', async () => {
    const f = await source(1),
      other = await source(1),
      r = await returnFixture(f),
      c = await make(f, '1', '0', { returnReportId: r.report.id });
    await call(
      'post',
      credits,
      {
        ...c.body,
        operationKey: randomUUID(),
        invoiceId: other.row.id,
        lines: [{ invoiceLineId: other.row.lines[0].id, netAmount: '1' }],
      },
      'manager',
      1,
    ).expect(409);
    const mod = await db.tenantModule.findFirstOrThrow({
      where: { tenantId: tenants[1].id, module: { key: 'wms' } },
    });
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId: mod.tenantId, moduleId: mod.moduleId } },
      data: { enabled: false },
    });
    try {
      await call('post', credits, c.body, 'manager', 1).expect(403);
      await call(
        'get',
        `${credits}/requests/${c.body.operationKey}`,
        undefined,
        'manager',
        1,
      ).expect(403);
      const hidden = (
        await call('get', `${credits}/${c.row.id}`, undefined, 'manager', 1).expect(200)
      ).body;
      expect(hidden).not.toHaveProperty('returnReportId');
      await call('post', `${credits}/${c.row.id}/evidence`, undefined, 'manager', 1)
        .field('operationKey', randomUUID())
        .field('caption', 'Copie non autorisée')
        .attach('file', pdf, { filename: 'avoir.pdf', contentType: 'application/pdf' })
        .expect(403);
    } finally {
      await db.tenantModule.update({
        where: { tenantId_moduleId: { tenantId: mod.tenantId, moduleId: mod.moduleId } },
        data: { enabled: true },
      });
    }
  });
  async function source(tenant = 0) {
    const f = await fixture(tenant),
      q = await qualify(f);
    await call('post', `${base}/${f.row.id}/qualify`, q.body, 'manager', tenant).expect(201);
    return f;
  }
  async function make(
    f: Awaited<ReturnType<typeof fixture>>,
    net = '4.10',
    tax = '0.10',
    extra = {},
  ) {
    const body = {
      operationKey: randomUUID(),
      invoiceId: f.row.id,
      externalNumber: `AV-${randomUUID()}`,
      creditDate: '2026-09-27',
      reason: 'Remise commerciale documentée',
      lines: [{ invoiceLineId: f.row.lines[0].id, netAmount: net }],
      taxes: [{ position: 0, amount: tax }],
      ...extra,
    };
    const made = (await call('post', credits, body, 'manager', f.tenant).expect(201)).body;
    const row = (
      await call('get', `${credits}/${made.id}`, undefined, 'manager', f.tenant).expect(200)
    ).body;
    return { body, row, tenant: f.tenant };
  }
  async function original(c: Awaited<ReturnType<typeof make>>, key = randomUUID(), bytes = pdf) {
    return call('post', `${credits}/${c.row.id}/evidence`, undefined, 'manager', c.tenant)
      .field('operationKey', key)
      .field('caption', 'Original de l’avoir reçu')
      .attach('file', bytes, { filename: 'avoir.pdf', contentType: 'application/pdf' });
  }
  async function closing(c: Awaited<ReturnType<typeof make>>) {
    const e = await original(c);
    expect(e.status).toBe(201);
    return {
      operationKey: randomUUID(),
      expectedUpdatedAt: c.row.updatedAt,
      evidenceId: e.body.id,
      note: 'Montants et original reçus vérifiés.',
    };
  }
  it('works with Finance alone; qualification changes only the documentary balance', async () => {
    const f = await source(),
      before = await db.supplierInvoice.findUnique({ where: { id: f.row.id } }),
      c = await make(f),
      d = await closing(c);
    expect(c.row.number).toMatch(/^AVF-/);
    const draftBalance = (await call('get', `${credits}/invoice/${f.row.id}`).expect(200)).body
      .balance;
    expect(draftBalance).toMatchObject({ credited: '0.00', remaining: '10.35' });
    await call('post', `${credits}/${c.row.id}/qualify`, d).expect(201);
    const b = (await call('get', `${credits}/invoice/${f.row.id}`).expect(200)).body.balance;
    expect(b).toMatchObject({ credited: '4.20', remaining: '6.15' });
    expect(await db.supplierInvoice.findUnique({ where: { id: f.row.id } })).toEqual(before);
    expect(await db.stockMovement.count({ where: { tenantId: tenants[0].id } })).toBe(0);
    expect(await db.payment.count({ where: { tenantId: tenants[0].id } })).toBe(0);
  });
  it('requires a qualified source and rejects foreign invoice lines, invalid dates and excessive tax', async () => {
    const f = await fixture();
    const d = {
      operationKey: randomUUID(),
      invoiceId: f.row.id,
      externalNumber: 'AV',
      creditDate: '2026-09-27',
      reason: 'Correction explicite reçue',
      lines: [{ invoiceLineId: f.row.lines[0].id, netAmount: '1' }],
      taxes: [],
    };
    await call('post', credits, d).expect(409);
    const a = await source(),
      b = await source();
    await call('post', credits, {
      ...d,
      invoiceId: a.row.id,
      lines: [{ invoiceLineId: b.row.lines[0].id, netAmount: '1' }],
    }).expect(409);
    await call('post', credits, {
      ...d,
      invoiceId: a.row.id,
      lines: [],
      taxes: [{ position: 0, amount: '0.26' }],
    }).expect(409);
    await call('post', credits, { ...d, invoiceId: a.row.id, creditDate: '2026-09-25' }).expect(
      400,
    );
    await call('post', credits, { ...d, invoiceId: a.row.id, creditDate: '2026-02-30' }).expect(
      400,
    );
    await call('post', credits, { ...d, invoiceId: a.row.id, currency: 'USD' }).expect(400);
  });
  it('bounds partial credits exactly and freezes qualified records and files', async () => {
    const f = await source(),
      a = await make(f),
      qa = await closing(a);
    await call('post', `${credits}/${a.row.id}/qualify`, qa).expect(201);
    const b = await make(f, '6.00', '0.15'),
      qb = await closing(b);
    await call('post', `${credits}/${b.row.id}/qualify`, qb).expect(201);
    expect((await call('get', `${credits}/invoice/${f.row.id}`)).body.balance.remaining).toBe(
      '0.00',
    );
    await call('post', credits, {
      ...a.body,
      externalNumber: 'over',
      operationKey: randomUUID(),
      lines: [{ invoiceLineId: f.row.lines[0].id, netAmount: '0.01' }],
      taxes: [],
    }).expect(409);
    await call('put', `${credits}/${a.row.id}`, {
      ...a.body,
      expectedUpdatedAt: a.row.updatedAt,
      operationKey: randomUUID(),
    }).expect(409);
    await call('post', `${credits}/${a.row.id}/cancel`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: a.row.updatedAt,
      note: 'Tentative après qualification',
    }).expect(409);
    expect((await original(a)).status).toBe(409);
  });
  it('serializes competing qualifications without letting drafts reserve the balance', async () => {
    const f = await source(),
      a = await make(f, '8', '0'),
      b = await make(f, '8', '0'),
      qa = await closing(a),
      qb = await closing(b);
    const replies = await Promise.all([
      call('post', `${credits}/${a.row.id}/qualify`, qa),
      call('post', `${credits}/${b.row.id}/qualify`, qb),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await call('get', `${credits}/invoice/${f.row.id}`)).body.balance.credited).toBe(
      '8.00',
    );
  });
  it('supports versions and exact actor-bound replay before stale-version checks', async () => {
    const f = await source(),
      c = await make(f);
    expect((await call('post', credits, c.body).expect(201)).body).toEqual({
      id: c.row.id,
      replayed: true,
    });
    await call('post', credits, { ...c.body, reason: 'Un autre contenu explicite' }).expect(409);
    await call('post', credits, c.body, 'writer').expect(409);
    await call('get', `${credits}/requests/${c.body.operationKey}`, undefined, 'writer').expect(
      404,
    );
    const edit = {
      ...c.body,
      operationKey: randomUUID(),
      expectedUpdatedAt: c.row.updatedAt,
      reason: 'Rabais négocié après vérification',
    };
    await call('put', `${credits}/${c.row.id}`, edit).expect(200);
    await call('put', `${credits}/${c.row.id}`, { ...edit, operationKey: randomUUID() }).expect(
      409,
    );
    expect((await call('put', `${credits}/${c.row.id}`, edit)).body.replayed).toBe(true);
    expect((await call('get', `${credits}/requests/${edit.operationKey}`)).body.id).toBe(c.row.id);
  });
  it('keeps source and external number identity; cancellation never frees a qualified amount', async () => {
    const f = await source(),
      c = await make(f),
      other = await source();
    await call('put', `${credits}/${c.row.id}`, {
      ...c.body,
      invoiceId: other.row.id,
      expectedUpdatedAt: c.row.updatedAt,
      operationKey: randomUUID(),
    }).expect(409);
    await call('post', `${credits}/${c.row.id}/cancel`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: c.row.updatedAt,
      note: 'Doublon documentaire identifié',
    }).expect(201);
    await call('post', credits, {
      ...c.body,
      operationKey: randomUUID(),
      externalNumber: ' ' + c.body.externalNumber.toLowerCase() + ' ',
    }).expect(409);
    expect((await call('get', `${credits}/invoice/${f.row.id}`)).body.balance.credited).toBe(
      '0.00',
    );
  });
  it('separates read, write and qualification; checks tenant and module isolation', async () => {
    const f = await source(),
      c = await make(f),
      d = await closing(c);
    await call('post', credits, c.body, 'reader').expect(403);
    await call('post', `${credits}/${c.row.id}/qualify`, d, 'writer').expect(403);
    await call('get', `${credits}/${c.row.id}`, undefined, 'reader').expect(200);
    await call('get', `${credits}/${c.row.id}`, undefined, 'carrier').expect(403);
    await call('get', `${credits}/${c.row.id}`, undefined, 'manager', 1).expect(404);
    await call('get', `${credits}/${c.row.id}`, undefined, 'manager', 2).expect(403);
    await call('post', credits, { ...c.body, operationKey: randomUUID() }, 'manager', 1).expect(
      400,
    );
    await call('post', `${credits}/${c.row.id}/qualify`, d, 'qualifier').expect(201);
    await call('get', `${credits}/requests/${d.operationKey}`, undefined, 'writer').expect(404);
  });
  it('requires the original of the same credit and protects generic document paths', async () => {
    const f = await source(),
      a = await make(f),
      b = await make(f),
      d = await closing(a);
    await call('post', `${credits}/${b.row.id}/qualify`, {
      ...d,
      operationKey: randomUUID(),
      expectedUpdatedAt: b.row.updatedAt,
    }).expect(400);
    await call('post', `${credits}/${a.row.id}/qualify`, { ...d, evidenceId: undefined }).expect(
      400,
    );
    const e = await db.supplierCreditEvidence.findUnique({ where: { id: d.evidenceId } });
    await call(
      'get',
      `${credits}/${a.row.id}/evidence/${d.evidenceId}/download`,
      undefined,
      'reader',
    ).expect(200);
    await call('get', `${credits}/${b.row.id}/evidence/${d.evidenceId}/download`).expect(404);
    await call('get', `documents/${e!.documentId}/download`).expect(403);
    await expect(
      app.get(DocumentsService).remove(tenants[0].id, e!.documentId, 'supplier-credit-evidence'),
    ).rejects.toThrow();
  });
  it('replays uncertain uploads exactly and qualifications without duplicate credit', async () => {
    const f = await source(),
      c = await make(f),
      key = randomUUID(),
      a = await original(c, key),
      b = await original(c, key);
    expect(a.status).toBe(201);
    expect(b.body).toMatchObject({ id: a.body.id, replayed: true });
    expect((await original(c, key, Buffer.from('%PDF-1.4\nOther\n%%EOF'))).status).toBe(409);
    const d = {
      operationKey: randomUUID(),
      expectedUpdatedAt: c.row.updatedAt,
      evidenceId: a.body.id,
      note: 'Original relu et montants vérifiés',
    };
    await call('post', `${credits}/${c.row.id}/qualify`, d).expect(201);
    expect((await call('post', `${credits}/${c.row.id}/qualify`, d)).body.replayed).toBe(true);
    expect((await call('get', `${credits}/invoice/${f.row.id}`)).body.balance.credited).toBe(
      '4.20',
    );
  });
});
