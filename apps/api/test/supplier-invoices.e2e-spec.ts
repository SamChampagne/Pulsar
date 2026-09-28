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

describe('I2l.1 general supplier invoices', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `supplier-invoices-${Date.now()}`,
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
            ? ['billing', 'purchasing'].includes(m.key)
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
        qualifier: [R, Q],
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
    console.log(`SUPPLIER_INVOICES_TENANT=${prefix}-0`);
    console.log(`SUPPLIER_INVOICES_LINKED_TENANT=${prefix}-1`);
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
  it('works with Finance alone, captures supplier identity and declared totals without any stock or payment', async () => {
    const f = await fixture();
    expect(f.row).toMatchObject({
      status: 'DRAFT',
      netAmount: '10.1',
      taxAmount: '0.25',
      totalAmount: '10.35',
      supplierSnapshot: { name: f.supplier.name },
      purchaseVisible: false,
    });
    expect(f.row.number).toMatch(/^FF-/);
    expect(await db.stockMovement.count({ where: { tenantId: tenants[0].id } })).toBe(0);
    expect(await db.payment.count({ where: { tenantId: tenants[0].id } })).toBe(0);
    expect((await call('post', base, f.body).expect(201)).body).toEqual({
      id: f.row.id,
      replayed: true,
    });
    await call('post', base, { ...f.body, notes: 'Other content' }).expect(409);
  });
  it('requires current versions, updates exact totals, and recovers only for the same actor', async () => {
    const f = await fixture(),
      body = {
        ...f.body,
        operationKey: randomUUID(),
        expectedUpdatedAt: f.row.updatedAt,
        notes: 'Brouillon corrigé',
      };
    await call('put', `${base}/${f.row.id}`, body).expect(200);
    expect((await call('put', `${base}/${f.row.id}`, body).expect(200)).body.replayed).toBe(true);
    await call('put', `${base}/${f.row.id}`, { ...body, operationKey: randomUUID() }).expect(409);
    await call('get', `${base}/requests/${body.operationKey}`).expect(200);
    await call('get', `${base}/requests/${body.operationKey}`, undefined, 'writer').expect(404);
    expect(
      await db.supplierInvoiceOperation.count({
        where: { tenantId: tenants[0].id, invoiceId: f.row.id },
      }),
    ).toBe(2);
  });
  it('blocks normalized duplicates and races on the same supplier number', async () => {
    const f = await fixture();
    await call('post', base, {
      ...f.body,
      operationKey: randomUUID(),
      externalNumber: ` ${f.body.externalNumber.toLowerCase()} `,
    }).expect(409);
    const number = randomUUID();
    const results = await Promise.all(
      [1, 2].map(() =>
        call('post', base, { ...f.body, externalNumber: number, operationKey: randomUUID() }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it.each([
    { invoiceDate: '2026-02-30' },
    { dueDate: '2025-01-01' },
    { currency: 'XYZ' },
    { tenantId: 'attacker' },
    { lines: [{ description: 'X', quantity: '0', unit: 'h', netAmount: '5' }] },
    { lines: [{ description: 'X', quantity: '1', unit: 'h', netAmount: '1.001' }] },
  ])('rejects invalid or untrusted input %j', async (patch) => {
    const f = await fixture();
    await call('post', base, {
      ...f.body,
      ...patch,
      operationKey: randomUUID(),
      externalNumber: randomUUID(),
    }).expect(400);
  });
  it('enforces tenant isolation, activation and separate rights', async () => {
    const f = await fixture();
    await call('get', `${base}/${f.row.id}`, undefined, 'manager', 1).expect(404);
    await call('get', base, undefined, 'manager', 2).expect(403);
    await call('get', base, undefined, 'carrier').expect(403);
    await call('post', base, f.body, 'reader').expect(403);
    await call('get', 'billing/data/suppliers', undefined, 'reader').expect(200);
    await call('post', 'billing/data/suppliers', { code: 'NO', name: 'Denied' }, 'reader').expect(
      403,
    );
    await call(
      'put',
      `${base}/${f.row.id}`,
      { ...f.body, operationKey: randomUUID(), expectedUpdatedAt: f.row.updatedAt },
      'manager',
      1,
    ).expect(404);
  });
  it('requires a selected original and qualification rights, then freezes the entire dossier', async () => {
    const f = await fixture(),
      q = await qualify(f);
    await call('post', `${base}/${f.row.id}/qualify`, { ...q.body, evidenceId: undefined }).expect(
      400,
    );
    await call('post', `${base}/${f.row.id}/qualify`, q.body, 'writer').expect(403);
    await call('post', `${base}/${f.row.id}/qualify`, q.body, 'qualifier').expect(201);
    expect(
      (await call('post', `${base}/${f.row.id}/qualify`, q.body, 'qualifier').expect(201)).body
        .replayed,
    ).toBe(true);
    await call('put', `${base}/${f.row.id}`, {
      ...f.body,
      operationKey: randomUUID(),
      expectedUpdatedAt: f.row.updatedAt,
    }).expect(409);
    await upload(f).expect(409);
    await call('post', `${base}/${f.row.id}/cancel`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: f.row.updatedAt,
      note: 'Impossible après qualification',
    }).expect(409);
    const r = (await call('get', `${base}/${f.row.id}`).expect(200)).body;
    expect(r).toMatchObject({
      status: 'QUALIFIED',
      originalEvidenceId: q.evidence.id,
      totalAmount: '10.35',
    });
    expect(await db.payment.count({ where: { tenantId: tenants[0].id } })).toBe(0);
  });
  it('does not accept evidence from another invoice or tenant', async () => {
    const f = await fixture(),
      other = await fixture(),
      q = await qualify(other);
    await call('post', `${base}/${f.row.id}/qualify`, {
      ...q.body,
      expectedUpdatedAt: f.row.updatedAt,
    }).expect(400);
    await call('get', `${base}/${f.row.id}/evidence/${q.evidence.id}/download`).expect(404);
    await call(
      'get',
      `${base}/${other.row.id}/evidence/${q.evidence.id}/download`,
      undefined,
      'manager',
      1,
    ).expect(404);
  });
  it('keeps cancellation documentary and preserves duplicate protection', async () => {
    const f = await fixture(),
      q = await qualify(f);
    const body = {
      operationKey: randomUUID(),
      expectedUpdatedAt: f.row.updatedAt,
      note: 'Annulé pour erreur de saisie du document.',
    };
    await call('post', `${base}/${f.row.id}/cancel`, body).expect(201);
    await call('post', `${base}/${f.row.id}/cancel`, body).expect(201);
    await call('get', `${base}/${f.row.id}/evidence/${q.evidence.id}/download`).expect(200);
    await call('post', base, { ...f.body, operationKey: randomUUID() }).expect(409);
    await upload(f).expect(409);
  });
  it('stores immutable evidence with exact concurrent replay and no generic document bypass', async () => {
    const f = await fixture(),
      key = randomUUID();
    const results = await Promise.all([upload(f, key), upload(f, key)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(
      await db.supplierInvoiceEvidence.count({
        where: { tenantId: tenants[0].id, invoiceId: f.row.id },
      }),
    ).toBe(1);
    await upload(f, key, Buffer.from('%PDF-1.4\nchanged')).expect(409);
    await upload(f, randomUUID(), Buffer.from('not PDF')).expect(400);
    await call('get', `${base}/${f.row.id}/evidence/requests/${key}`).expect(200);
    await call('get', `${base}/${f.row.id}/evidence/requests/${key}`, undefined, 'writer').expect(
      404,
    );
    const row = await db.supplierInvoiceEvidence.findFirstOrThrow({
      where: { tenantId: tenants[0].id, invoiceId: f.row.id },
    });
    const docs = app.get(DocumentsService);
    await expect(docs.download(tenants[0].id, row.documentId)).rejects.toThrow();
    await expect(
      docs.remove(tenants[0].id, row.documentId, 'supplier-invoice-evidence'),
    ).rejects.toThrow();
    await call(
      'get',
      `${base}/${f.row.id}/evidence/${row.id}/download`,
      undefined,
      'reader',
    ).expect(200);
  });
  async function linked() {
    const f = await fixture(1);
    const item = (
      await call(
        'post',
        'purchasing/data/items',
        { code: randomUUID(), name: 'Entretien', kind: 'SERVICE', unit: 'H' },
        'manager',
        1,
      ).expect(201)
    ).body;
    const draft = (
      await call(
        'post',
        'purchasing/orders',
        {
          supplierId: f.supplier.id,
          currency: 'CAD',
          lines: [{ catalogItemId: item.id, quantity: 3, unitPrice: 8 }],
        },
        'manager',
        1,
      ).expect(201)
    ).body;
    const order = (
      await call(
        'post',
        `purchasing/orders/${draft.id}/transition`,
        { status: 'CONFIRMED', expectedUpdatedAt: draft.updatedAt },
        'manager',
        1,
      ).expect(201)
    ).body;
    const body = {
      ...f.body,
      operationKey: randomUUID(),
      expectedUpdatedAt: f.row.updatedAt,
      lines: [{ ...f.body.lines[0], purchaseLineId: order.lines[0].id }],
    };
    await call('put', `${base}/${f.row.id}`, body, 'manager', 1).expect(200);
    f.row = (await call('get', `${base}/${f.row.id}`, undefined, 'manager', 1).expect(200)).body;
    return { ...f, order, body };
  }
  it('captures explicit purchase lines without WMS or implicit amount matching', async () => {
    const f = await linked();
    expect(f.row.lines[0].purchaseSnapshot).toMatchObject({
      orderNumber: f.order.number,
      quantity: '3',
      unitPrice: '8',
    });
    expect(f.row.totalAmount).toBe('10.35');
    expect(
      (await call('get', `${base}/sources/${f.supplier.id}`, undefined, 'manager', 1).expect(200))
        .body.items[0].id,
    ).toBe(f.order.lines[0].id);
    const q = await qualify(f);
    await call('post', `${base}/${f.row.id}/qualify`, q.body, 'manager', 1).expect(201);
    expect(await db.stockMovement.count({ where: { tenantId: tenants[1].id } })).toBe(0);
  });
  it('redacts purchase context and prevents removing a hidden dependency', async () => {
    const f = await linked();
    const read = (await call('get', `${base}/${f.row.id}`, undefined, 'writer', 1).expect(200))
      .body;
    expect(read.lines[0].hasPurchaseLink).toBe(true);
    expect(read.lines[0]).not.toHaveProperty('purchaseLineId');
    expect(read.lines[0]).not.toHaveProperty('purchaseSnapshot');
    await call('get', `${base}/sources/${f.supplier.id}`, undefined, 'writer', 1).expect(403);
    await call(
      'put',
      `${base}/${f.row.id}`,
      {
        ...f.body,
        operationKey: randomUUID(),
        expectedUpdatedAt: f.row.updatedAt,
        lines: f.body.lines.map(({ purchaseLineId, ...l }) => l),
      },
      'writer',
      1,
    ).expect(403);
    await call('get', `${base}/requests/${f.body.operationKey}`, undefined, 'writer', 1).expect(
      404,
    );
  });
  it('requires supplier, unit and currency compatibility and source activation on replay', async () => {
    const f = await linked();
    for (const patch of [{ currency: 'USD' }, { lines: [{ ...f.body.lines[0], unit: 'EA' }] }])
      await call(
        'put',
        `${base}/${f.row.id}`,
        { ...f.body, ...patch, operationKey: randomUUID(), expectedUpdatedAt: f.row.updatedAt },
        'manager',
        1,
      ).expect(409);
    const m = await db.tenantModule.findFirstOrThrow({
      where: { tenantId: tenants[1].id, module: { key: 'purchasing' } },
    });
    try {
      await db.tenantModule.update({
        where: { tenantId_moduleId: { tenantId: m.tenantId, moduleId: m.moduleId } },
        data: { enabled: false },
      });
      app.get(TenantModulesCacheService).invalidate(m.tenantId);
      const read = (await call('get', `${base}/${f.row.id}`, undefined, 'manager', 1).expect(200))
        .body;
      expect(read.purchaseVisible).toBe(false);
      expect(read.lines[0]).not.toHaveProperty('purchaseSnapshot');
      await call('put', `${base}/${f.row.id}`, f.body, 'manager', 1).expect(403);
    } finally {
      await db.tenantModule.update({
        where: { tenantId_moduleId: { tenantId: m.tenantId, moduleId: m.moduleId } },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(m.tenantId);
    }
  });
});
