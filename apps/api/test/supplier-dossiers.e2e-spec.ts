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

describe('I2l.3 supplier dossiers', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `supplier-dossiers-${Date.now()}`,
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
    console.log(`SUPPLIER_DOSSIERS_TENANT=${prefix}-0`);
    console.log(`SUPPLIER_DOSSIERS_LINKED_TENANT=${prefix}-1`);
  }, 120000);
  afterAll(async () => app?.close());

  const dossier = 'billing/supplier-dossiers';
  const creditBase = 'billing/supplier-credits';
  const pdf = Buffer.from('%PDF-1.4\nDossier fixture\n%%EOF');
  let supplier: any, inv: any, usd: any, draft: any, credit: any, cancelled: any;
  async function invoice(supplierId: string, currency = 'CAD', amount = '10.10', tenant = 0) {
    const made = (
      await call(
        'post',
        base,
        {
          operationKey: randomUUID(),
          supplierId,
          externalNumber: `DOS-${randomUUID()}`,
          invoiceDate: '2026-09-26',
          currency,
          notes: 'Dossier documentaire',
          lines: [{ description: 'Entretien', quantity: '1', unit: 'H', netAmount: amount }],
          taxes: [{ label: 'Taxe déclarée', amount: '0.25' }],
        },
        'manager',
        tenant,
      ).expect(201)
    ).body;
    return (await call('get', `${base}/${made.id}`, undefined, 'manager', tenant).expect(200)).body;
  }
  async function close(row: any, family = base, status = 'qualify') {
    const f =
      status === 'qualify'
        ? (
            await call('post', `${family}/${row.id}/evidence`)
              .field('operationKey', randomUUID())
              .field('caption', 'Original dossier')
              .attach('file', pdf, {
                filename: family === base ? 'facture-dossier.pdf' : 'avoir-dossier.pdf',
                contentType: 'application/pdf',
              })
              .expect(201)
          ).body
        : null;
    await call('post', `${family}/${row.id}/${status}`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: row.updatedAt,
      ...(f ? { evidenceId: f.id } : {}),
      note: 'Vérification documentaire humaine complète.',
    }).expect(201);
    return (await call('get', `${family}/${row.id}`).expect(200)).body;
  }
  async function newCredit(amount: string) {
    const made = (
      await call('post', creditBase, {
        operationKey: randomUUID(),
        invoiceId: inv.id,
        externalNumber: `AV-${randomUUID()}`,
        creditDate: '2026-09-27',
        reason: 'Correction commerciale reçue du fournisseur',
        lines: [{ invoiceLineId: inv.lines[0].id, netAmount: amount }],
        taxes: [{ position: 0, amount: '0.05' }],
      }).expect(201)
    ).body;
    return (await call('get', `${creditBase}/${made.id}`).expect(200)).body;
  }
  it('centralizes Finance-only identities, full qualified amounts by currency, without mutating documents', async () => {
    supplier = (
      await call('post', 'billing/data/suppliers', {
        code: 'DOSSIER',
        name: 'Fournisseur dossier',
      }).expect(201)
    ).body;
    inv = await close(await invoice(supplier.id));
    usd = await close(await invoice(supplier.id, 'USD', '20.10'));
    draft = await invoice(supplier.id, 'CAD', '55.00');
    credit = await close(await newCredit('2.10'), creditBase);
    cancelled = await close(await newCredit('0.50'), creditBase, 'cancel');
    const prior = await db.supplierInvoice.findFirstOrThrow({
      where: { tenantId: tenants[0].id, id: inv.id },
    });
    const r = (await call('get', `${dossier}/${supplier.id}`, undefined, 'reader').expect(200))
      .body;
    expect(r.supplier).toMatchObject({
      id: supplier.id,
      code: 'DOSSIER',
      name: 'Fournisseur dossier',
    });
    expect(r.counts).toEqual({
      invoiceDraft: 1,
      invoiceQualified: 2,
      invoiceCancelled: 0,
      creditDraft: 0,
      creditQualified: 1,
      creditCancelled: 1,
    });
    expect(r.currencies).toEqual([
      {
        currency: 'CAD',
        invoiceCount: 1,
        creditCount: 1,
        qualifiedInvoices: '10.35',
        qualifiedCredits: '2.15',
        documentaryRemaining: '8.20',
        inconsistent: false,
      },
      {
        currency: 'USD',
        invoiceCount: 1,
        creditCount: 0,
        qualifiedInvoices: '20.35',
        qualifiedCredits: '0.00',
        documentaryRemaining: '20.35',
        inconsistent: false,
      },
    ]);
    expect(r).not.toHaveProperty('amountPaid');
    expect(r).not.toHaveProperty('payable');
    expect(
      await db.supplierInvoice.findFirstOrThrow({ where: { tenantId: tenants[0].id, id: inv.id } }),
    ).toEqual(prior);
  });
  it('paginates the mixed history in stable order and filters dates, types, status and currency at the database', async () => {
    const all = (
      await call(
        'get',
        `${dossier}/${supplier.id}/documents?pageSize=100`,
        undefined,
        'reader',
      ).expect(200)
    ).body;
    expect(all.total).toBe(5);
    expect(all.items).toHaveLength(5);
    const paged = [];
    for (let page = 1; page <= 5; page++) {
      const r = (
        await call('get', `${dossier}/${supplier.id}/documents?pageSize=1&page=${page}`).expect(200)
      ).body;
      expect(r.total).toBe(5);
      paged.push(r.items[0].id);
    }
    expect(paged).toEqual(all.items.map((x: any) => x.id));
    expect(new Set(paged).size).toBe(5);
    const only = (
      await call(
        'get',
        `${dossier}/${supplier.id}/documents?kind=CREDIT&status=QUALIFIED&currency=CAD&from=2026-09-27&to=2026-09-27`,
      ).expect(200)
    ).body;
    expect(only.total).toBe(1);
    expect(only.items[0]).toMatchObject({
      id: credit.id,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      totalAmount: '2.15',
      kind: 'CREDIT',
      hasOriginal: true,
    });
    expect(
      (await call('get', `${dossier}/${supplier.id}/documents?to=2026-09-25`).expect(200)).body
        .total,
    ).toBe(0);
    expect(
      (
        await call(
          'get',
          `${dossier}/${supplier.id}/documents?search=${encodeURIComponent(inv.number)}`,
        ).expect(200)
      ).body.total,
    ).toBe(3);
    for (const search of ['%', '_', "' OR 1=1 --"])
      expect(
        (
          await call(
            'get',
            `${dossier}/${supplier.id}/documents?search=${encodeURIComponent(search)}`,
          ).expect(200)
        ).body.total,
      ).toBe(0);
  });
  it('indexes protected evidence and original selection; no generic storage keys or operational snapshots', async () => {
    const result = (
      await call(
        'get',
        `${dossier}/${supplier.id}/evidence?pageSize=1&kind=CREDIT&status=QUALIFIED&search=avoir-dossier`,
        undefined,
        'reader',
      ).expect(200)
    ).body;
    expect(result.total).toBe(1);
    const row = result.items[0];
    expect(row).toMatchObject({
      kind: 'CREDIT',
      parentId: credit.id,
      invoiceId: inv.id,
      fileName: 'avoir-dossier.pdf',
      isOriginal: true,
    });
    for (const key of [
      'documentId',
      'storageKey',
      'sha256',
      'fingerprint',
      'returnSnapshot',
      'purchaseSnapshot',
      'returnReportId',
    ])
      expect(row).not.toHaveProperty(key);
    await call(
      'get',
      `${creditBase}/${row.parentId}/evidence/${row.id}/download`,
      undefined,
      'reader',
    ).expect(200);
    await call(
      'get',
      `${creditBase}/${row.parentId}/evidence/${row.id}/download`,
      undefined,
      'reader',
      1,
    ).expect(404);
    const all = (await call('get', `${dossier}/${supplier.id}/evidence`).expect(200)).body;
    expect(all.total).toBe(3);
    expect(
      (await call('get', `${dossier}/${supplier.id}/evidence?from=2026-09-27`).expect(200)).body
        .total,
    ).toBe(1);
  });
  it('keeps inactive historical suppliers and captured names; excludes unrelated nonsuppliers', async () => {
    await db.businessPartner.updateMany({
      where: { tenantId: tenants[0].id, id: supplier.id },
      data: { name: 'Fournisseur renommé', active: false, isSupplier: false, isCustomer: true },
    });
    const unrelated = await db.businessPartner.create({
      data: {
        tenantId: tenants[0].id,
        code: randomUUID(),
        name: 'Partenaire non fournisseur',
        isSupplier: false,
        isCustomer: true,
      },
    });
    const r = (
      await call('get', `${dossier}?search=renommé&activity=INACTIVE`, undefined, 'reader').expect(
        200,
      )
    ).body;
    expect(r.items.map((x: any) => x.id)).toContain(supplier.id);
    expect(
      (await call('get', `${dossier}?activity=ACTIVE`).expect(200)).body.items.map(
        (x: any) => x.id,
      ),
    ).not.toContain(supplier.id);
    const docs = (await call('get', `${dossier}/${supplier.id}/documents`).expect(200)).body;
    expect(docs.items.every((x: any) => x.supplierNameSnapshot === 'Fournisseur dossier')).toBe(
      true,
    );
    await call('get', `${dossier}/${unrelated.id}`).expect(404);
  });
  it('rejects wrong tenant, module and permission on every read route', async () => {
    for (const suffix of ['', '/documents', '/evidence']) {
      await call('get', `${dossier}/${supplier.id}${suffix}`, undefined, 'reader', 1).expect(404);
      await call('get', `${dossier}/${supplier.id}${suffix}`, undefined, 'carrier').expect(403);
      await call('get', `${dossier}/${supplier.id}${suffix}`, undefined, 'manager', 2).expect(403);
    }
    await call('get', dossier, undefined, 'carrier').expect(403);
    await call('get', dossier, undefined, 'manager', 2).expect(403);
    expect(
      (await call('get', dossier, undefined, 'reader', 1).expect(200)).body.items.map(
        (x: any) => x.id,
      ),
    ).not.toContain(supplier.id);
  });
  it('validates actual civil dates, bounded queries and closed filters', async () => {
    for (const q of [
      'from=2026-02-30',
      'from=1899-12-31',
      'to=2200-01-01',
      'from=2026-09-28&to=2026-09-27',
      'kind=PAYMENT',
      'status=PAID',
      'currency=NOPE',
      'pageSize=101',
      'page=1000001',
      'page=1.5',
      'page=NaN',
      'page=0',
      'tenantId=other',
      `search=${'x'.repeat(201)}`,
    ]) {
      await call('get', `${dossier}/${supplier.id}/documents?${q}`).expect(400);
      await call('get', `${dossier}/${supplier.id}/evidence?${q}`).expect(400);
    }
    await call('get', `${dossier}?activity=DELETED`).expect(400);
    for (const page of ['0', '-1', '1.5', 'NaN', '1000001'])
      await call('get', `${dossier}?page=${page}`).expect(400);
  });
  it('returns an empty dossier without inventing a currency or balance', async () => {
    const s = (
      await call('post', 'billing/data/suppliers', { code: 'EMPTY', name: 'Sans document' }).expect(
        201,
      )
    ).body;
    expect((await call('get', `${dossier}/${s.id}`).expect(200)).body.currencies).toEqual([]);
    expect((await call('get', `${dossier}/${s.id}/evidence`).expect(200)).body.total).toBe(0);
    expect((await call('get', `${dossier}/${s.id}/documents`).expect(200)).body.total).toBe(0);
  });
});
