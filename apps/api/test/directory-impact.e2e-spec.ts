import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { MODULE_CATALOG, PERMISSION_CATALOG } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { EmailService } from '../src/core/email/email.service';

describe('Directory impact — read-only, exact identity and consumer rights', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `directory-impact-${Date.now()}`;
  const tenants: Array<{ id: string; tokens: Record<string, string> }> = [];
  const call = (path: string, actor = 'manager', t = 0) =>
    request(http).get(`/api/v1/${path}`).set('Authorization', `Bearer ${tenants[t].tokens[actor]}`);
  const entryData = {
    kind: 'ADDRESS',
    label: 'Siège commercial',
    role: 'Facturation',
    active: true,
    validFrom: null,
    validUntil: null,
    email: '',
    phone: '',
    notes: 'NOTE-PRIVEE-NON-PROJETEE',
    address: {
      line1: '42 rue du Parc',
      line2: '',
      city: 'Québec',
      region: 'QC',
      countryCode: 'CA',
      postalCode: 'G1K 3X2',
    },
  };
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
    const roles = {
      manager: PERMISSION_CATALOG.map((p) => p.key),
      directory: ['clients.read'],
      billing: ['clients.read', 'billing.customer-invoices.read'],
      services: ['services.read'],
      purchasing: ['purchasing.read'],
      crm: ['crm.read'],
      none: [],
    };
    for (let i = 0; i < 3; i++) {
      const slug = `${prefix}-${i}`,
        tenant = await db.tenant.create({ data: { slug, name: slug } }),
        tokens: Record<string, string> = {};
      for (const m of MODULE_CATALOG.filter((m) =>
        i === 2
          ? m.key === 'purchasing'
          : [
              'clients',
              'services',
              'billing',
              'transportation',
              'crm',
              'purchasing',
              'support',
            ].includes(m.key),
      )) {
        const definition = await db.moduleDefinition.upsert({
          where: { key: m.key },
          create: m,
          update: m,
        });
        await db.tenantModule.create({
          data: { tenantId: tenant.id, moduleId: definition.id, enabled: true },
        });
      }
      for (const [key, keys] of Object.entries(roles)) {
        const ps = await db.permission.findMany({ where: { key: { in: keys } } });
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
            lastName: 'Impact',
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
      tenants.push({ id: tenant.id, tokens });
    }
    console.log(`DIRECTORY_IMPACT_TENANT=${prefix}-0`);
  }, 120000);
  afterAll(async () => {
    await app?.close();
  });
  async function fixture(t = 0) {
    const tenantId = tenants[t].id;
    const customer = await db.customer.create({
      data: { tenantId, code: randomUUID(), name: 'Client Est' },
    });
    const partner = await db.businessPartner.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Atelier Nord',
        isCustomer: true,
        isSupplier: true,
      },
    });
    const company = await db.crmCompany.create({
      data: { tenantId, name: 'Société indépendante' },
    });
    const address = async (owner: object) =>
      db.partyDirectoryEntry.create({
        data: { tenantId, ...owner, kind: 'ADDRESS', label: entryData.label, data: entryData },
      });
    const customerEntry = await address({ customerId: customer.id }),
      partnerEntry = await address({ partnerId: partner.id }),
      companyEntry = await address({ companyId: company.id });
    const location = await db.location.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Site',
        type: 'WAREHOUSE',
        addressLine1: '42 rue du Parc',
        city: 'Québec',
        country: 'CA',
      },
    });
    // Deliberate immutable read fixtures; workflow writers have their dedicated regression suites.
    const snapshot = (kind: string, owner: any, entry: any, frozen = false) => ({
      schemaVersion: 1,
      owner: { kind, id: owner.id, code: owner.code ?? '', name: owner.name },
      entries: {
        billingAddress: { id: entry.id, version: 1, data: entryData },
        deliveryAddress: kind === 'customer' ? { id: entry.id, version: 1, data: entryData } : null,
        contact: null,
      },
      selectedAt: '2026-09-01T00:00:00Z',
      selectedBy: 'fixture',
      reason: 'Fixture lecture',
      referenceDate: '2026-09-01',
      timeZone: 'America/Toronto',
      frozenAt: frozen ? '2026-09-01T01:00:00Z' : null,
    });
    const invoice = await db.customerInvoice.create({
      data: {
        tenantId,
        customerId: customer.id,
        invoiceNumber: `INV-${randomUUID()}`,
        totalAmount: 23.79,
        documentCoordinates: snapshot('customer', customer, customerEntry),
      },
    });
    const transport = await db.transportOrder.create({
      data: {
        tenantId,
        customerId: customer.id,
        orderNumber: `TO-${randomUUID()}`,
        originLocationId: location.id,
        destinationLocationId: location.id,
        documentCoordinates: snapshot('customer', customer, customerEntry),
      },
    });
    const quote = await db.serviceQuote.create({
      data: {
        tenantId,
        partnerId: partner.id,
        number: `SQ-${randomUUID()}`,
        title: 'Installation',
        currency: 'CAD',
        totalAmount: 41.53,
        lines: [],
        operationKey: randomUUID(),
        fingerprint: 'fixture',
        documentCoordinates: snapshot('partner', partner, partnerEntry),
      },
    });
    const purchase = await db.supplierOrder.create({
      data: {
        tenantId,
        supplierId: partner.id,
        number: `PO-${randomUUID()}`,
        documentCoordinates: snapshot('supplier', partner, partnerEntry),
      },
    });
    const crm = await db.salesOrder.create({
      data: {
        tenantId,
        companyId: company.id,
        customerId: customer.id,
        number: `SO-${randomUUID()}`,
        documentCoordinates: snapshot('crm-company', company, companyEntry),
      },
    });
    const frozen = await db.supplierOrder.create({
      data: {
        tenantId,
        supplierId: partner.id,
        number: `PO-HIST-${randomUUID()}`,
        status: 'CLOSED',
        documentCoordinates: snapshot('supplier', partner, partnerEntry, true),
      },
    });
    const customerPath = `clients/data/customers/${customer.id}/directory/${customerEntry.id}/impact`;
    const partnerPath = `services/data/customers/${partner.id}/directory/${partnerEntry.id}/impact`;
    const supplierPath = `purchasing/data/suppliers/${partner.id}/directory/${partnerEntry.id}/impact`;
    const companyPath = `crm/companies/${company.id}/directory/${companyEntry.id}/impact`;
    return {
      tenantId,
      customer,
      partner,
      company,
      customerEntry,
      partnerEntry,
      companyEntry,
      invoice,
      transport,
      quote,
      purchase,
      crm,
      frozen,
      customerPath,
      partnerPath,
      supplierPath,
      companyPath,
    };
  }
  it('finds all five consumers, exact roles, deep links and no private snapshots', async () => {
    const f = await fixture();
    for (const [path, source, id, link] of [
      [f.customerPath, 'customer-invoice', f.invoice.id, '/invoices?statement='],
      [f.customerPath, 'transport-order', f.transport.id, '/transport-orders/'],
      [f.partnerPath, 'service-quote', f.quote.id, '/services/quotes?quoteId='],
      [f.supplierPath, 'supplier-order', f.purchase.id, '/purchasing?orderId='],
      [f.companyPath, 'crm-sales-order', f.crm.id, '/crm/sales-orders/'],
    ]) {
      const result = (await call(`${path}?source=${source}`).expect(200)).body;
      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({ id, href: link + id });
      expect(JSON.stringify(result)).not.toContain(entryData.notes);
      expect(result.items[0]).not.toHaveProperty('documentCoordinates');
    }
    const r = (await call(f.customerPath).expect(200)).body;
    expect(r.items[0].roles).toHaveLength(2);
    expect(r.sources.map((s: any) => s.key)).toEqual(['customer-invoice', 'transport-order']);
  });
  it('directory access alone reveals no source, count or record; explicit forbidden sources are denied', async () => {
    const f = await fixture(),
      r = (await call(f.customerPath, 'directory').expect(200)).body;
    expect(r).toMatchObject({ sources: [], source: null, items: [], total: 0 });
    await call(`${f.customerPath}?source=transport-order`, 'directory').expect(403);
    const b = (await call(f.customerPath, 'billing').expect(200)).body;
    expect(b.sources.map((s: any) => s.key)).toEqual(['customer-invoice']);
    expect(b.items[0].id).toBe(f.invoice.id);
    await call(`${f.customerPath}?source=transport-order`, 'billing').expect(403);
  });
  it('a partner shared between client and supplier does not bypass the other module rights', async () => {
    const f = await fixture();
    const s = (await call(f.partnerPath, 'services').expect(200)).body;
    expect(s.sources.map((s: any) => s.key)).toEqual(['service-quote']);
    const p = (await call(f.supplierPath, 'purchasing').expect(200)).body;
    expect(p.sources.map((s: any) => s.key)).toEqual(['supplier-order']);
    expect(p.sources[0]).toMatchObject({ drafts: 1, frozen: 1 });
    await call(`${f.partnerPath}?source=supplier-order`, 'services').expect(403);
  });
  it('disabled consumers vanish even with permissions; the directory facade still requires its own module', async () => {
    const f = await fixture(),
      m = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'transportation' } });
    await db.tenantModule.updateMany({
      where: { tenantId: f.tenantId, moduleId: m.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(f.tenantId);
    try {
      expect((await call(f.customerPath).expect(200)).body.sources.map((s: any) => s.key)).toEqual([
        'customer-invoice',
      ]);
      await call(`${f.customerPath}?source=transport-order`).expect(403);
    } finally {
      await db.tenantModule.updateMany({
        where: { tenantId: f.tenantId, moduleId: m.id },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(f.tenantId);
    }
    const isolated = await fixture(2);
    expect(
      (await call(isolated.supplierPath, 'purchasing', 2).expect(200)).body.sources.map(
        (s: any) => s.key,
      ),
    ).toEqual(['supplier-order']);
    await call(isolated.customerPath, 'manager', 2).expect(403);
  });
  it('rejects foreign tenants, wrong parent entries and anonymous/no-read access', async () => {
    const f = await fixture(),
      other = await fixture();
    await call(f.customerPath, 'manager', 1).expect(404);
    await call(
      `clients/data/customers/${other.customer.id}/directory/${f.customerEntry.id}/impact`,
    ).expect(404);
    await call(f.customerPath, 'none').expect(403);
    await request(http).get(`/api/v1/${f.customerPath}`).expect(401);
  });
  it('marks changed versions in drafts only and preserves frozen history without writes', async () => {
    const f = await fixture();
    await request(http)
      .patch(`/api/v1/purchasing/data/suppliers/${f.partner.id}/directory/${f.partnerEntry.id}`)
      .set('Authorization', `Bearer ${tenants[0].tokens.manager}`)
      .send({
        operationKey: randomUUID(),
        expectedVersion: 1,
        reason: 'Adresse remplacée',
        entry: { ...entryData, label: 'Siège v2' },
      })
      .expect(200);
    const before = await db.supplierOrder.findMany({
        where: { tenantId: f.tenantId, supplierId: f.partner.id },
        orderBy: { id: 'asc' },
      }),
      audits = await db.auditLog.count({ where: { tenantId: f.tenantId } });
    const draft = (await call(`${f.supplierPath}?source=supplier-order`).expect(200)).body;
    expect(draft.entry.version).toBe(2);
    expect(draft.items[0].roles[0].issue).toContain('version 2');
    const historical = (
      await call(`${f.supplierPath}?source=supplier-order&scope=FROZEN`).expect(200)
    ).body;
    expect(historical.total).toBe(1);
    expect(historical.items[0]).toMatchObject({ id: f.frozen.id, status: 'CLOSED' });
    expect(historical.items[0].roles[0].issue).toBeNull();
    expect(
      await db.supplierOrder.findMany({
        where: { tenantId: f.tenantId, supplierId: f.partner.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(await db.auditLog.count({ where: { tenantId: f.tenantId } })).toBe(audits);
  });
  it('shows expired same-version entries without asserting overall document readiness', async () => {
    const f = await fixture();
    await db.partyDirectoryEntry.update({
      where: { id: f.companyEntry.id },
      data: { data: { ...entryData, validUntil: '2020-01-01' } },
    });
    const r = (await call(f.companyPath, 'crm').expect(200)).body;
    expect(r.items[0].roles[0].issue).toContain('validité');
    expect(r.items[0]).not.toHaveProperty('ready');
  });
  it('does not infer links from CRM customer mappings, unselected entries or legacy documents', async () => {
    const f = await fixture();
    const otherEntry = await db.partyDirectoryEntry.create({
      data: {
        tenantId: f.tenantId,
        customerId: f.customer.id,
        kind: 'ADDRESS',
        label: 'Autre',
        data: entryData,
      },
    });
    expect(
      (
        await call(
          `clients/data/customers/${f.customer.id}/directory/${otherEntry.id}/impact`,
        ).expect(200)
      ).body.total,
    ).toBe(0);
    await db.customerInvoice.update({
      where: { id: f.invoice.id },
      data: { documentCoordinates: Prisma.DbNull },
    });
    const r = (await call(f.customerPath).expect(200)).body;
    expect(r.sources.find((s: any) => s.key === 'customer-invoice').drafts).toBe(0);
    expect(r.sources.some((s: any) => s.key === 'crm-sales-order')).toBe(false);
  });
  it('requires both exact snapshot ownership and actual document parent', async () => {
    const f = await fixture(),
      other = await fixture();
    await db.supplierOrder.create({
      data: {
        tenantId: f.tenantId,
        supplierId: other.partner.id,
        number: randomUUID(),
        documentCoordinates: f.purchase.documentCoordinates!,
      },
    });
    expect((await call(`${f.supplierPath}?source=supplier-order`).expect(200)).body.total).toBe(1);
  });
  it('paginates deterministically with an accurate count beyond page size and an empty last page', async () => {
    const f = await fixture();
    await db.supplierOrder.createMany({
      data: Array.from({ length: 24 }, (_, i) => ({
        tenantId: f.tenantId,
        supplierId: f.partner.id,
        number: `PAG-${i}-${randomUUID()}`,
        documentCoordinates: f.purchase.documentCoordinates!,
        updatedAt: new Date('2026-09-01T00:00:00Z'),
      })),
    });
    const results = [];
    for (let p = 1; p <= 3; p++)
      results.push(
        (await call(`${f.supplierPath}?source=supplier-order&page=${p}&pageSize=10`).expect(200))
          .body,
      );
    expect(results.map((r) => r.total)).toEqual([25, 25, 25]);
    expect(new Set(results.flatMap((r) => r.items.map((i: any) => i.id))).size).toBe(25);
    const again = (
      await call(`${f.supplierPath}?source=supplier-order&page=2&pageSize=10`).expect(200)
    ).body;
    expect(again.items.map((i: any) => i.id)).toEqual(results[1].items.map((i: any) => i.id));
    const empty = (
      await call(`${f.supplierPath}?source=supplier-order&page=99&pageSize=10`).expect(200)
    ).body;
    expect(empty.total).toBe(25);
    expect(empty.items).toEqual([]);
  });
  it('rejects unsupported sources/scopes/pagination and ignores unengaged cancelled copies', async () => {
    const f = await fixture();
    for (const query of ['source=secret', 'scope=ALL', 'page=0', 'pageSize=101', 'tenantId=other'])
      await call(`${f.supplierPath}?${query}`).expect(400);
    await db.supplierOrder.update({ where: { id: f.purchase.id }, data: { status: 'CANCELLED' } });
    expect((await call(`${f.supplierPath}?source=supplier-order`).expect(200)).body.total).toBe(0);
    expect(
      (await call(`${f.supplierPath}?source=supplier-order&scope=FROZEN`).expect(200)).body.total,
    ).toBe(1);
  });
});
