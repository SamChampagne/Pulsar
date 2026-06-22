/**
 * E2E CRM module (Task 3) — proves the CRM module end-to-end over real Postgres
 * with the admin Bearer token (tenant acme): companies + contacts CRUD.
 *
 *   1. Enable the CRM module on the acme tenant.
 *   2. Create a company (PROSPECT → verified in response).
 *   3. List companies — our company is present; result is paginated.
 *   4. GET the company — contacts array is present (empty initially).
 *   5. Create a contact linked to the company.
 *   6. List contacts — our contact is present; companyId filter works.
 *   7. GET the company again — contacts array now includes our contact.
 *   8. PATCH the company (name update) — response reflects the change.
 *   9. Tenant isolation: all returned company ids belong to acme (no cross-tenant leak).
 *
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

interface Company {
  id: string;
  name: string;
  status: string;
  contacts?: Array<{ id: string }>;
  deals?: Array<{ id: string }>;
}

interface Contact {
  id: string;
  name: string;
  companyId: string | null;
}

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

describe('CRM module (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  let companyId = '';
  let contactId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );

    await app.listen(0);
    http = app.getHttpServer();

    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Ensure CRM module is enabled for acme via Prisma upsert (avoids relying on
    // the admin endpoint gating — which itself requires CRM enabled).
    const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.crmContact.deleteMany({ where: { id: contactId } }).catch(() => undefined);
      await prisma.crmCompany.deleteMany({ where: { id: companyId } }).catch(() => undefined);
    }
    await app.close();
  });

  // =========================================================================
  // 1 — Module enabled: endpoint is reachable (the upsert in beforeAll does this,
  //     so we just verify the list returns 200 as a smoke test).
  // =========================================================================
  it('CRM endpoints are reachable after the module is enabled', async () => {
    await request(http).get('/api/v1/crm/companies').set(auth()).expect(200);
  });

  // =========================================================================
  // 2 — Create a company.
  // =========================================================================
  it('creates a company with status PROSPECT', async () => {
    const res = await request(http)
      .post('/api/v1/crm/companies')
      .set(auth())
      .send({ name: `Acme Transport ${suffix}` })
      .expect(201);
    const company = res.body as Company;
    expect(company.name).toBe(`Acme Transport ${suffix}`);
    expect(company.status).toBe('PROSPECT');
    companyId = company.id;
  });

  // =========================================================================
  // 3 — List companies: our company appears; response is paginated.
  // =========================================================================
  it('lists companies and our new company is present in a paginated response', async () => {
    const res = await request(http).get('/api/v1/crm/companies').set(auth()).expect(200);
    const body = res.body as Paginated<Company>;
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('pageSize');
    expect(body.items.some((c) => c.id === companyId)).toBe(true);
  });

  // =========================================================================
  // 4 — GET the company: contacts array is present (empty initially).
  // =========================================================================
  it('GET company includes contacts and deals arrays (empty initially)', async () => {
    const res = await request(http)
      .get(`/api/v1/crm/companies/${companyId}`)
      .set(auth())
      .expect(200);
    const company = res.body as Company;
    expect(company.id).toBe(companyId);
    expect(Array.isArray(company.contacts)).toBe(true);
    expect(Array.isArray(company.deals)).toBe(true);
    expect(company.contacts!.length).toBe(0);
  });

  // =========================================================================
  // 5 — Create a contact linked to the company.
  // =========================================================================
  it('creates a contact linked to the company', async () => {
    const res = await request(http)
      .post('/api/v1/crm/contacts')
      .set(auth())
      .send({ name: `Alice Shipper ${suffix}`, companyId, title: 'Logistics Manager' })
      .expect(201);
    const contact = res.body as Contact;
    expect(contact.name).toBe(`Alice Shipper ${suffix}`);
    expect(contact.companyId).toBe(companyId);
    contactId = contact.id;
  });

  // =========================================================================
  // 6 — List contacts: our contact appears; companyId filter works.
  // =========================================================================
  it('lists contacts and the companyId filter returns only the linked contact', async () => {
    const res = await request(http)
      .get(`/api/v1/crm/contacts?companyId=${companyId}`)
      .set(auth())
      .expect(200);
    const body = res.body as Paginated<Contact>;
    expect(body.items.some((c) => c.id === contactId)).toBe(true);
    // Every returned contact must belong to this company.
    expect(body.items.every((c) => c.companyId === companyId)).toBe(true);
  });

  // =========================================================================
  // 7 — GET company again: contacts array now includes our contact.
  // =========================================================================
  it('GET company after contact creation includes the contact in the response', async () => {
    const res = await request(http)
      .get(`/api/v1/crm/companies/${companyId}`)
      .set(auth())
      .expect(200);
    const company = res.body as Company;
    expect(company.contacts!.some((c) => c.id === contactId)).toBe(true);
  });

  // =========================================================================
  // 8 — PATCH the company: name update is reflected in the response.
  // =========================================================================
  it('PATCH company updates the name and returns the updated record', async () => {
    const newName = `Acme Transport Updated ${suffix}`;
    const res = await request(http)
      .patch(`/api/v1/crm/companies/${companyId}`)
      .set(auth())
      .send({ name: newName })
      .expect(200);
    expect((res.body as Company).name).toBe(newName);
  });

  // =========================================================================
  // 9 — Tenant isolation: no cross-tenant data in list results.
  // =========================================================================
  it('no cross-tenant companies are exposed in the list', async () => {
    const res = await request(http).get('/api/v1/crm/companies').set(auth()).expect(200);
    const body = res.body as Paginated<Company>;
    const ids = body.items.map((c) => c.id);
    const leaked = await prisma.crmCompany.count({
      where: { id: { in: ids }, tenantId: { not: tenantId } },
    });
    expect(leaked).toBe(0);
  });
});
