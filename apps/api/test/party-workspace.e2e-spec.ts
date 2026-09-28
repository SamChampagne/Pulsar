import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import {
  MODULE_CATALOG,
  PERMISSION_CATALOG,
  PARTY_ACCESS,
  PARTY_WORKSPACE_SOURCES,
} from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { EmailService } from '../src/core/email/email.service';

describe('Party 360 workspace — explicit links, independent modules, read-only', () => {
  let app: INestApplication, db: PrismaService;
  const prefix = `party-workspace-${Date.now()}`;
  const tenants: Array<{ id: string; tokens: Record<string, string> }> = [];
  const get = (path: string, role = 'manager', tenant = 0) =>
    request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .auth(tenants[tenant].tokens[role], { type: 'bearer' });
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
    db = app.get(PrismaService);
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    for (const p of PERMISSION_CATALOG)
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    for (let i = 0; i < 3; i++) {
      const slug = `${prefix}-${i}`;
      const tenant = await db.tenant.create({ data: { slug, name: slug } });
      for (const m of MODULE_CATALOG.filter((m) => i !== 2 || m.key === 'services')) {
        const def = await db.moduleDefinition.upsert({
          where: { key: m.key },
          create: m,
          update: m,
        });
        await db.tenantModule.create({
          data: { tenantId: tenant.id, moduleId: def.id, enabled: true },
        });
      }
      const tokens: Record<string, string> = {};
      for (const [key, keys] of Object.entries({
        manager: PERMISSION_CATALOG.map((p) => p.key),
        reader: ['clients.read'],
        services: ['services.read'],
        payments: ['clients.read', 'billing.payments.read'],
        none: [],
      })) {
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
            lastName: 'Workspace',
            status: 'ACTIVE',
            passwordHash: hashSync('Test1234!', 4),
            roles: { create: { roleId: role.id } },
          },
        });
        tokens[key] = (
          await request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ tenant: slug, email, password: 'Test1234!' })
            .expect(200)
        ).body.accessToken;
      }
      tenants.push({ id: tenant.id, tokens });
    }
    console.log(`PARTY_WORKSPACE_TENANT=${prefix}-0`);
  }, 120000);
  afterAll(async () => app?.close());
  async function fixture(t = 0) {
    const tenantId = tenants[t].id;
    const customer = await db.customer.create({
      data: { tenantId, code: randomUUID(), name: 'Entreprise des Rives' },
    });
    const company = await db.crmCompany.create({
      data: { tenantId, name: 'Rives commercial', customerId: customer.id },
    });
    const partner = await db.businessPartner.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Rives Services',
        isCustomer: true,
        isSupplier: true,
        billingCustomerId: customer.id,
        crmCompanyId: company.id,
      },
    });
    const project = await db.serviceProject.create({
      data: { tenantId, partnerId: partner.id, number: randomUUID(), title: 'Installation réseau' },
    });
    const job = await db.serviceJob.create({
      data: { tenantId, projectId: project.id, number: randomUUID(), title: 'Inspection du site' },
    });
    const quote = await db.serviceQuote.create({
      data: {
        tenantId,
        partnerId: partner.id,
        number: randomUUID(),
        title: 'Offre de maintenance',
        currency: 'CAD',
        lines: [],
        totalAmount: '327.15',
        operationKey: randomUUID(),
        fingerprint: 'fixture',
      },
    });
    const support = await db.supportCase.create({
      data: {
        tenantId,
        partnerId: partner.id,
        number: randomUUID(),
        title: 'Suivi installation',
        description: 'Ne jamais projeter cette note privée.',
        operationKey: randomUUID(),
        requestFingerprint: 'fixture',
      },
    });
    const invoice = await db.customerInvoice.create({
      data: {
        tenantId,
        customerId: customer.id,
        invoiceNumber: randomUUID(),
        totalAmount: '327.15',
        currency: 'CAD',
        customData: { private: 'not projected' },
      },
    });
    const deal = await db.crmDeal.create({
      data: { tenantId, companyId: company.id, title: 'Maintenance annuelle' },
    });
    const order = await db.salesOrder.create({
      data: { tenantId, companyId: company.id, number: randomUUID() },
    });
    const location = await db.location.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Site local',
        type: 'WAREHOUSE',
        addressLine1: '123 rue Test',
        city: 'Québec',
        state: 'QC',
        postalCode: 'G1A1A1',
        country: 'CA',
      },
    });
    const transport = await db.transportOrder.create({
      data: {
        tenantId,
        customerId: customer.id,
        orderNumber: randomUUID(),
        originLocationId: location.id,
        destinationLocationId: location.id,
      },
    });
    return {
      customer,
      company,
      partner,
      project,
      job,
      quote,
      support,
      invoice,
      deal,
      order,
      transport,
      path: `clients/data/partners/${partner.id}/workspace`,
    };
  }
  it('serves every guarded facade and preserves each source grant', async () => {
    const f = await fixture();
    for (const access of PARTY_ACCESS) {
      const id =
        access.kind === 'customer'
          ? f.customer.id
          : access.kind === 'crm-company'
            ? f.company.id
            : f.partner.id;
      const view = (await get(`${access.path}/${id}/workspace`).expect(200)).body;
      expect(view.sections).toHaveLength(8);
      expect(view.sections.every((s: any) => s.total === 1)).toBe(true);
    }
    for (const source of PARTY_WORKSPACE_SOURCES) {
      const view = (await get(`${f.path}?source=${source.key}`).expect(200)).body;
      expect(view.items).toHaveLength(1);
      expect(Object.keys(view.items[0]).sort()).toEqual([
        'href',
        'id',
        'reference',
        'status',
        'title',
        'updatedAt',
      ]);
      expect(JSON.stringify(view)).not.toMatch(
        /fingerprint|customData|private|tenantId|documentCoordinates|totalAmount/,
      );
    }
  });
  it('Services works alone and Clients is not required', async () => {
    const f = await fixture(2);
    const r = (
      await get(`services/data/customers/${f.partner.id}/workspace`, 'services', 2).expect(200)
    ).body;
    expect(r.sections.map((s: any) => s.key)).toEqual([
      'service-project',
      'service-job',
      'service-quote',
    ]);
    await get(f.path, 'manager', 2).expect(403);
    await get(
      `services/data/customers/${f.partner.id}/workspace?source=customer-invoice`,
      'manager',
      2,
    ).expect(403);
  });
  it('source access never implies target access; hidden counts and IDs are absent', async () => {
    const f = await fixture();
    for (const role of ['reader', 'payments']) {
      const r = (await get(f.path, role).expect(200)).body;
      expect(r.sections).toEqual([]);
      expect(r.items).toEqual([]);
      expect(JSON.stringify(r)).not.toContain(f.invoice.id);
      await get(`${f.path}?source=customer-invoice`, role).expect(403);
    }
    await get(f.path, 'none').expect(403);
    await request(app.getHttpServer()).get(`/api/v1/${f.path}`).expect(401);
  });
  it('isolates tenants, including indirect child and legacy relation joins', async () => {
    const f = await fixture();
    await get(f.path, 'manager', 1).expect(404);
    const foreign = await fixture(1);
    const poisoned = await db.crmDeal.create({
      data: {
        tenantId: tenants[0].id,
        companyId: foreign.company.id,
        title: 'Legacy invalid foreign link',
      },
    });
    const view = (
      await get(`clients/data/customers/${f.customer.id}/workspace?source=crm-deal`).expect(200)
    ).body;
    expect(view.items.map((r: any) => r.id)).toEqual([f.deal.id]);
    expect(JSON.stringify(view)).not.toContain(poisoned.id);
  });
  it('follows a single direct identity link, never a transitive or same-name match', async () => {
    const f = await fixture();
    await db.crmCompany.update({ where: { id: f.company.id }, data: { customerId: null } });
    const unrelated = await db.businessPartner.create({
      data: { tenantId: tenants[0].id, code: randomUUID(), name: f.partner.name },
    });
    await db.serviceProject.create({
      data: {
        tenantId: tenants[0].id,
        partnerId: unrelated.id,
        number: randomUUID(),
        title: 'Not the same customer',
      },
    });
    const fromCustomer = (
      await get(`clients/data/customers/${f.customer.id}/workspace?source=crm-deal`).expect(200)
    ).body;
    expect(fromCustomer.items).toEqual([]);
    expect(fromCustomer.sections.find((s: any) => s.key === 'service-project').total).toBe(1);
    expect((await get(`${f.path}?source=crm-deal`).expect(200)).body.items[0].id).toBe(f.deal.id);
    const fromCrm = (
      await get(`crm/companies/${f.company.id}/workspace?source=customer-invoice`).expect(200)
    ).body;
    expect(fromCrm.items).toEqual([]); // partner -> customer is NOT a CRM link.
  });
  it('does not truncate direct CRM companies and rejects legacy foreign customer links', async () => {
    const f = await fixture();
    for (let i = 0; i < 21; i++) {
      const company = await db.crmCompany.create({
        data: { tenantId: tenants[0].id, customerId: f.customer.id, name: `Division ${i}` },
      });
      await db.crmDeal.create({
        data: { tenantId: tenants[0].id, companyId: company.id, title: `Dossier division ${i}` },
      });
    }
    const view = (
      await get(
        `clients/data/customers/${f.customer.id}/workspace?source=crm-deal&pageSize=5`,
      ).expect(200)
    ).body;
    expect(view.total).toBe(22);
    expect(view.items).toHaveLength(5);
    const foreign = await fixture(1);
    await db.crmCompany.update({
      where: { id: f.company.id },
      data: { customerId: foreign.customer.id },
    });
    expect(
      (await get(`crm/companies/${f.company.id}/workspace?source=customer-invoice`).expect(200))
        .body.items,
    ).toEqual([]);
  });
  it('paginates and searches in the database with stable ordering, without changing section counts', async () => {
    const f = await fixture();
    for (let i = 0; i < 12; i++)
      await db.serviceProject.create({
        data: {
          tenantId: tenants[0].id,
          partnerId: f.partner.id,
          number: `P-${randomUUID()}`,
          title: `Contrat récurrent ${i}`,
          updatedAt: new Date('2026-01-01'),
        },
      });
    const first = (await get(`${f.path}?pageSize=5`).expect(200)).body;
    const second = (await get(`${f.path}?pageSize=5&page=2`).expect(200)).body;
    expect(first.total).toBe(13);
    expect(first.items).toHaveLength(5);
    expect(second.items.some((r: any) => first.items.some((x: any) => x.id === r.id))).toBe(false);
    const filtered = (await get(`${f.path}?search=Installation`).expect(200)).body;
    expect(filtered.total).toBe(1);
    expect(filtered.sections[0].total).toBe(13);
    console.log(`PARTY_WORKSPACE_PARTNER=${f.partner.id}`);
  });
  it('re-evaluates disabled targets and rejects invalid/unbounded queries', async () => {
    const f = await fixture();
    const mod = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'billing' } });
    await db.tenantModule.updateMany({
      where: { tenantId: tenants[0].id, moduleId: mod.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenants[0].id);
    try {
      expect(
        (await get(f.path).expect(200)).body.sections.some(
          (s: any) => s.key === 'customer-invoice',
        ),
      ).toBe(false);
      await get(`${f.path}?source=customer-invoice`).expect(403);
    } finally {
      await db.tenantModule.updateMany({
        where: { tenantId: tenants[0].id, moduleId: mod.id },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(tenants[0].id);
    }
    for (const query of [
      'source=unknown',
      'page=0',
      'page=1.5',
      'page=not-a-number',
      'page=100001',
      'pageSize=101',
      `search=${'a'.repeat(121)}`,
      'tenantId=other',
    ])
      await get(`${f.path}?${query}`).expect(400);
  });
  it('does not mutate documents, audit, stock or agent runs', async () => {
    const f = await fixture();
    const counts = () =>
      Promise.all([
        db.auditLog.count(),
        db.stockMovement.count(),
        db.agentRun.count(),
        db.customerInvoice.count(),
      ]);
    const before = await counts();
    await get(f.path).expect(200);
    await get(`${f.path}?source=customer-invoice`).expect(200);
    expect(await counts()).toEqual(before);
    expect(await db.serviceProject.findUnique({ where: { id: f.project.id } })).toEqual(f.project);
  });
});
