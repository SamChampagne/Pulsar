import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { MODULE_CATALOG, PERMISSION_CATALOG, PARTY_ACCESS } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { EmailService } from '../src/core/email/email.service';

describe('Company profiles and explicit identity review', () => {
  let app: INestApplication, db: PrismaService, http: any;
  const prefix = `party-profiles-${Date.now()}`;
  const tenants: Array<{ id: string; tokens: Record<string, string> }> = [];
  const call = (
    method: 'get' | 'post' | 'put' | 'patch',
    path: string,
    data?: object,
    role = 'manager',
    tenant = 0,
  ) => {
    const r = request(http)
      [method](`/api/v1/${path}`)
      .set('Authorization', `Bearer ${tenants[tenant].tokens[role]}`);
    return data ? r.send(data) : r;
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
    for (let i = 0; i < 3; i++) {
      const slug = `${prefix}-${i}`,
        tenant = await db.tenant.create({ data: { slug, name: slug } }),
        tokens: Record<string, string> = {};
      for (const m of MODULE_CATALOG.filter((m) => (i === 2 ? m.key === 'purchasing' : true))) {
        const def = await db.moduleDefinition.upsert({
          where: { key: m.key },
          create: m,
          update: m,
        });
        await db.tenantModule.create({
          data: { tenantId: tenant.id, moduleId: def.id, enabled: true },
        });
      }
      for (const [key, keys] of Object.entries({
        manager: PERMISSION_CATALOG.map((p) => p.key),
        reader: ['clients.read'],
        limited: ['clients.read', 'clients.manage'],
        servicescrm: ['services.read', 'services.manage', 'crm.read'],
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
            lastName: 'Profile',
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
    console.log(`PARTY_PROFILES_TENANT=${prefix}-0`);
  }, 120000);
  afterAll(async () => app?.close());
  async function fixture(t = 0) {
    const tenantId = tenants[t].id;
    const customer = await db.customer.create({
      data: { tenantId, code: randomUUID(), name: 'Client du Fleuve' },
    });
    const partner = await db.businessPartner.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Atelier du Fleuve',
        isCustomer: true,
        isSupplier: true,
      },
    });
    const company = await db.crmCompany.create({ data: { tenantId, name: 'Fleuve commercial' } });
    return {
      customer,
      partner,
      company,
      profile: `clients/data/partners/${partner.id}/business-profile`,
      identity: `clients/data/partners/${partner.id}/identity`,
    };
  }
  it('all statically guarded facades support the same private profiles without extra module dependencies', async () => {
    const f = await fixture();
    for (const a of PARTY_ACCESS) {
      const id =
        a.kind === 'customer'
          ? f.customer.id
          : a.kind === 'crm-company'
            ? f.company.id
            : f.partner.id;
      const path = `${a.path}/${id}/business-profile`,
        old = (await call('get', path).expect(200)).body;
      const next = await call('put', path, {
        expectedVersion: old.version,
        data: { legalName: 'Fleuve Inc.', timeZone: 'America/Toronto' },
      }).expect(200);
      expect(next.body.version).toBe(old.version + 1);
    }
    expect(
      await db.partyBusinessProfile.count({
        where: {
          tenantId: tenants[0].id,
          OR: [
            { customerId: f.customer.id },
            { partnerId: f.partner.id },
            { companyId: f.company.id },
          ],
        },
      }),
    ).toBe(3);
  });
  it('purchasing alone maintains a supplier profile without Clients, Catalogue, CRM or Billing', async () => {
    const f = await fixture(2),
      path = `purchasing/data/suppliers/${f.partner.id}`;
    await call(
      'put',
      `${path}/business-profile`,
      { expectedVersion: 0, data: { orderInstructions: 'Commande à vérifier humainement' } },
      'manager',
      2,
    ).expect(200);
    expect(
      (await call('get', `${path}/identity`, undefined, 'manager', 2).expect(200)).body.groups,
    ).toEqual([]);
    await call('get', f.profile, undefined, 'manager', 2).expect(403);
  });
  it('keeps identical names and linked profiles separate, with no data copied to old documents or primary fields', async () => {
    const f = await fixture();
    await db.businessPartner.update({
      where: { id: f.partner.id },
      data: { billingCustomerId: f.customer.id, crmCompanyId: f.company.id },
    });
    await call('put', f.profile, {
      expectedVersion: 0,
      data: {
        legalName: 'Nouveau nom',
        internalNotes: 'PRIVE',
        additional: [{ label: 'Porte', value: '4' }],
      },
    }).expect(200);
    expect(
      (await call('get', `clients/data/customers/${f.customer.id}/business-profile`).expect(200))
        .body.data,
    ).toEqual({});
    expect((await db.businessPartner.findUniqueOrThrow({ where: { id: f.partner.id } })).name).toBe(
      f.partner.name,
    );
    expect(
      (await call('get', `clients/data/partners/${f.partner.id}`).expect(200)).text,
    ).not.toContain('PRIVE');
  });
  it('rejects wrong-tenant owners, wrong partner roles and no read/manage permissions', async () => {
    const f = await fixture();
    await call('get', f.profile, undefined, 'manager', 1).expect(404);
    await call('get', f.profile, undefined, 'none').expect(403);
    await call('get', f.profile, undefined, 'reader').expect(200);
    await call('put', f.profile, { expectedVersion: 0, data: {} }, 'reader').expect(403);
    await db.businessPartner.update({ where: { id: f.partner.id }, data: { isCustomer: false } });
    await call('get', f.profile).expect(404);
    await call('get', `purchasing/data/suppliers/${f.partner.id}/business-profile`).expect(200);
  });
  it('validates closed data, version and bounded additional fields', async () => {
    const f = await fixture();
    for (const body of [
      { data: {} },
      { expectedVersion: -1, data: {} },
      { expectedVersion: 0, data: { tenantId: 'x' } },
      { expectedVersion: 0, data: { timeZone: 'not-a-zone' } },
      { expectedVersion: 0, data: { website: 'javascript:alert(1)' } },
      { expectedVersion: 0, data: { additional: [{ label: 'A', value: 1 }] } },
      { expectedVersion: 0, data: {}, module: 'hr' },
    ])
      await call('put', f.profile, body).expect(400);
  });
  it('serializes concurrent first writes and refuses stale retries without overwriting the winner', async () => {
    const f = await fixture();
    const responses = await Promise.all(
      ['A', 'B'].map((legalName) =>
        call('put', f.profile, { expectedVersion: 0, data: { legalName } }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    await call('put', f.profile, { expectedVersion: 0, data: { legalName: 'Retry' } }).expect(409);
    expect((await call('get', f.profile).expect(200)).body.data.legalName).toBe(
      responses.find((r) => r.status === 200)!.body.data.legalName,
    );
  });
  it('reviews without writes, then confirms explicit partner links with audit and reverse visibility', async () => {
    const f = await fixture(),
      data = {
        expectedUpdatedAt: f.partner.updatedAt.toISOString(),
        billingCustomerId: f.customer.id,
        crmCompanyId: f.company.id,
        reason: 'Identité vérifiée avec le client',
      };
    const preview = await call('post', `${f.identity}/review`, data).expect(201);
    expect(preview.body.customer.name).toBe(f.customer.name);
    expect(
      (await db.businessPartner.findUniqueOrThrow({ where: { id: f.partner.id } }))
        .billingCustomerId,
    ).toBeNull();
    await call('post', `${f.identity}/confirm`, {
      ...data,
      reviewToken: preview.body.reviewToken,
    }).expect(201);
    const reverse = (
      await call('get', `clients/data/customers/${f.customer.id}/identity`).expect(200)
    ).body;
    expect(reverse.groups.find((g: any) => g.family === 'partner').records[0].id).toBe(
      f.partner.id,
    );
    expect(
      (await db.crmCompany.findUniqueOrThrow({ where: { id: f.company.id } })).customerId,
    ).toBeNull();
    expect(
      await db.auditLog.count({
        where: {
          tenantId: tenants[0].id,
          entityType: 'party-identity-review',
          entityId: f.partner.id,
        },
      }),
    ).toBe(1);
    await call('post', `${f.identity}/confirm`, {
      ...data,
      reviewToken: preview.body.reviewToken,
    }).expect(409);
  });
  it('refuses changed target/owner, changed payload and absent or forged review token', async () => {
    const f = await fixture(),
      data = {
        expectedUpdatedAt: f.partner.updatedAt.toISOString(),
        billingCustomerId: f.customer.id,
        reason: 'Identité vérifiée',
      };
    const preview = (await call('post', `${f.identity}/review`, data).expect(201)).body;
    await call('post', `${f.identity}/confirm`, data).expect(400);
    await call('post', `${f.identity}/confirm`, { ...data, reviewToken: '0'.repeat(64) }).expect(
      409,
    );
    await call('post', `${f.identity}/confirm`, {
      ...data,
      reason: 'Autre raison',
      reviewToken: preview.reviewToken,
    }).expect(409);
    await db.customer.update({ where: { id: f.customer.id }, data: { name: 'Changement revu' } });
    await call('post', `${f.identity}/confirm`, {
      ...data,
      reviewToken: preview.reviewToken,
    }).expect(409);
  });
  it('does not expose hidden CRM ids, labels or candidate counts to Clients-only readers', async () => {
    const f = await fixture();
    await db.businessPartner.update({
      where: { id: f.partner.id },
      data: { crmCompanyId: f.company.id },
    });
    const r = await call('get', f.identity, undefined, 'reader').expect(200);
    expect(r.text).not.toContain(f.company.id);
    expect(r.text).not.toContain(f.company.name);
    await call('get', `${f.identity}/candidates?family=crm-company`, undefined, 'reader').expect(
      403,
    );
    await call(
      'post',
      `${f.identity}/review`,
      {
        expectedUpdatedAt: f.partner.updatedAt.toISOString(),
        crmCompanyId: f.company.id,
        reason: 'Vérification',
      },
      'limited',
    ).expect(403);
  });
  it('rejects foreign targets, unavailable modules and duplicate partner mappings', async () => {
    const f = await fixture(),
      other = await fixture(1),
      competitor = await fixture();
    const data = {
      expectedUpdatedAt: f.partner.updatedAt.toISOString(),
      billingCustomerId: other.customer.id,
      reason: 'Revue des liens',
    };
    await call('post', `${f.identity}/review`, data).expect(400);
    await db.businessPartner.update({
      where: { id: competitor.partner.id },
      data: { billingCustomerId: f.customer.id },
    });
    data.billingCustomerId = f.customer.id;
    const p = (await call('post', `${f.identity}/review`, data).expect(201)).body;
    await call('post', `${f.identity}/confirm`, { ...data, reviewToken: p.reviewToken }).expect(
      409,
    );
    await call('get', `${f.identity}/candidates?family=crm-company&tenantId=x`).expect(400);
  });
  it('protects CRM update against contradicting the reviewed partner association', async () => {
    const f = await fixture(),
      other = await fixture();
    await db.businessPartner.update({
      where: { id: f.partner.id },
      data: { billingCustomerId: f.customer.id, crmCompanyId: f.company.id },
    });
    await call('patch', `crm/companies/${f.company.id}`, { customerId: other.customer.id }).expect(
      409,
    );
    await call('patch', `crm/companies/${f.company.id}`, { customerId: f.customer.id }).expect(200);
  });
  it('rejects conversion creating a contradictory customer and serializes concurrent CRM conversions', async () => {
    const f = await fixture();
    await db.businessPartner.update({
      where: { id: f.partner.id },
      data: { billingCustomerId: f.customer.id, crmCompanyId: f.company.id },
    });
    const deal = await db.crmDeal.create({
      data: {
        tenantId: tenants[0].id,
        companyId: f.company.id,
        title: 'Contrat accepté',
        stage: 'WON',
      },
    });
    await call('post', `crm/deals/${deal.id}/convert`, {}).expect(409);
    await call('patch', `crm/companies/${f.company.id}`, { customerId: f.customer.id }).expect(200);
    const r = await Promise.all([
      call('post', `crm/deals/${deal.id}/convert`, {}),
      call('post', `crm/deals/${deal.id}/convert`, {}),
    ]);
    expect(r.map((x) => x.body.customerId)).toEqual([f.customer.id, f.customer.id]);
  });
  it('database rejects multiple owners and foreign-tenant profiles', async () => {
    const f = await fixture(),
      other = await fixture(1);
    await expect(
      db.partyBusinessProfile.create({
        data: {
          tenantId: tenants[0].id,
          customerId: f.customer.id,
          partnerId: f.partner.id,
          data: {},
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.partyBusinessProfile.create({
        data: { tenantId: tenants[0].id, customerId: other.customer.id, data: {} },
      }),
    ).rejects.toThrow();
  });
  it('does not rewrite a converted deal when the company later changes its direct customer mapping', async () => {
    const f = await fixture(),
      other = await fixture();
    await call('patch', `crm/companies/${f.company.id}`, { customerId: f.customer.id }).expect(200);
    const deal = await db.crmDeal.create({
      data: {
        tenantId: tenants[0].id,
        companyId: f.company.id,
        title: 'Accord historique',
        stage: 'WON',
      },
    });
    await call('post', `crm/deals/${deal.id}/convert`, {}).expect(200);
    await call('patch', `crm/companies/${f.company.id}`, { customerId: other.customer.id }).expect(
      200,
    );
    expect(
      (await call('post', `crm/deals/${deal.id}/convert`, {}).expect(200)).body.customerId,
    ).toBe(f.customer.id);
    expect(
      (await db.crmDeal.findUniqueOrThrow({ where: { id: deal.id } })).convertedCustomerId,
    ).toBe(f.customer.id);
  });
  it('does not leak a CRM customer linkage through the review preview without Customer access', async () => {
    const f = await fixture();
    await db.crmCompany.update({
      where: { id: f.company.id },
      data: { customerId: f.customer.id },
    });
    const partner = await db.businessPartner.update({
      where: { id: f.partner.id },
      data: { billingCustomerId: f.customer.id, crmCompanyId: f.company.id },
    });
    const result = await call(
      'post',
      `services/data/customers/${partner.id}/identity/review`,
      {
        expectedUpdatedAt: partner.updatedAt.toISOString(),
        crmCompanyId: f.company.id,
        reason: 'Revue de la société',
      },
      'servicescrm',
    ).expect(201);
    expect(result.body.company.name).toBe(f.company.name);
    expect(result.body.customer).toBeUndefined();
    expect(result.body.company.customerId).toBeUndefined();
    expect(result.text).not.toContain(f.customer.id);
  });
  it('does not change a billing identity after Services has used it, even if the invoice was deleted', async () => {
    const f = await fixture(),
      other = await fixture(),
      tenantId = tenants[0].id;
    const partner = await db.businessPartner.update({
      where: { id: f.partner.id },
      data: { billingCustomerId: f.customer.id },
    });
    const project = await db.serviceProject.create({
      data: {
        tenantId,
        partnerId: partner.id,
        number: randomUUID(),
        title: 'Intervention historique',
      },
    });
    await db.serviceInvoiceBatch.create({
      data: {
        tenantId,
        projectId: project.id,
        operationKey: randomUUID(),
        fingerprint: 'historical-tombstone',
      },
    });
    await call('post', `${f.identity}/review`, {
      expectedUpdatedAt: partner.updatedAt.toISOString(),
      billingCustomerId: other.customer.id,
      reason: 'Changement demandé',
    }).expect(409);
    await call('post', `${f.identity}/review`, {
      expectedUpdatedAt: partner.updatedAt.toISOString(),
      billingCustomerId: null,
      reason: 'Retrait demandé',
    }).expect(409);
  });
  it('rechecks target activation and permissions at confirmation', async () => {
    const f = await fixture(),
      data = {
        expectedUpdatedAt: f.partner.updatedAt.toISOString(),
        crmCompanyId: f.company.id,
        reason: 'Revue commerciale',
      };
    const reviewToken = (await call('post', `${f.identity}/review`, data).expect(201)).body
      .reviewToken;
    const mod = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'crm' } });
    await db.tenantModule.updateMany({
      where: { tenantId: tenants[0].id, moduleId: mod.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenants[0].id);
    try {
      await call('post', `${f.identity}/confirm`, { ...data, reviewToken }).expect(403);
    } finally {
      await db.tenantModule.updateMany({
        where: { tenantId: tenants[0].id, moduleId: mod.id },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(tenants[0].id);
    }
  });
});
