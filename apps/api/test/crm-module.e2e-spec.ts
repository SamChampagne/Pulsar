/**
 * E2E CRM module — proves the CRM module end-to-end over real Postgres
 * with the admin Bearer token (tenant acme):
 *   Task 3: companies + contacts CRUD.
 *   Task 4: deals (advance/convert) + activities + pipeline.
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
 *  10. Create a deal (LEAD stage).
 *  11. Advance deal LEAD→QUALIFIED→PROPOSAL (ok).
 *  12. Advance deal PROPOSAL→LEAD (ok — active stages move freely).
 *  13. Advance to WON.
 *  14. Convert deal → assert Customer created + convertedCustomerId set.
 *  15. Advance WON→LOST rejected (400 — terminal stage).
 *  16. Create activity on the deal → assert lastActivityAt set.
 *  17. GET /crm/pipeline → grouped by stage.
 *
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CrmExceptionsService } from '../src/modules/crm/crm-exceptions.service';
import { DomainEventsService } from '../src/core/operating/domain-events.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { AgentsService } from '../src/core/agents/agents.service';

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

interface Deal {
  id: string;
  title: string;
  stage: string;
  lastActivityAt?: string | null;
  convertedCustomerId?: string | null;
}

interface Activity {
  id: string;
  type: string;
  body: string;
  dealId: string | null;
}

interface PipelineEntry {
  stage: string;
  deals: Array<{ id: string; title: string; companyName: string }>;
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
  let dealId = '';
  let activityId = '';

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
      // Clean up in reverse dependency order
      if (activityId) await prisma.crmActivity.deleteMany({ where: { id: activityId } }).catch(() => undefined);
      if (dealId) await prisma.crmDeal.deleteMany({ where: { id: dealId } }).catch(() => undefined);
      if (contactId) await prisma.crmContact.deleteMany({ where: { id: contactId } }).catch(() => undefined);
      if (companyId) await prisma.crmCompany.deleteMany({ where: { id: companyId } }).catch(() => undefined);
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

  // =========================================================================
  // 10 — Create a deal (LEAD stage).
  // =========================================================================
  it('creates a deal linked to the company (default stage LEAD)', async () => {
    const res = await request(http)
      .post('/api/v1/crm/deals')
      .set(auth())
      .send({ title: `Deal ${suffix}`, companyId, amount: 50000, currency: 'CAD' })
      .expect(201);
    const deal = res.body as Deal;
    expect(deal.title).toBe(`Deal ${suffix}`);
    expect(deal.stage).toBe('LEAD');
    dealId = deal.id;
  });

  // =========================================================================
  // 11 — Advance deal: LEAD→QUALIFIED→PROPOSAL (should succeed).
  // =========================================================================
  it('advances deal LEAD→QUALIFIED and QUALIFIED→PROPOSAL successfully', async () => {
    const q = await request(http)
      .post(`/api/v1/crm/deals/${dealId}/advance`)
      .set(auth())
      .send({ stage: 'QUALIFIED' })
      .expect(200);
    expect((q.body as Deal).stage).toBe('QUALIFIED');

    const p = await request(http)
      .post(`/api/v1/crm/deals/${dealId}/advance`)
      .set(auth())
      .send({ stage: 'PROPOSAL' })
      .expect(200);
    expect((p.body as Deal).stage).toBe('PROPOSAL');
  });

  // =========================================================================
  // 12 — Advance PROPOSAL→LEAD (active stages move freely — should succeed).
  // =========================================================================
  it('advances deal PROPOSAL→LEAD (active stages are freely reversible)', async () => {
    const res = await request(http)
      .post(`/api/v1/crm/deals/${dealId}/advance`)
      .set(auth())
      .send({ stage: 'LEAD' })
      .expect(200);
    expect((res.body as Deal).stage).toBe('LEAD');
  });

  // =========================================================================
  // 13 — Advance to WON.
  // =========================================================================
  it('advances deal LEAD→WON', async () => {
    const res = await request(http)
      .post(`/api/v1/crm/deals/${dealId}/advance`)
      .set(auth())
      .send({ stage: 'WON' })
      .expect(200);
    expect((res.body as Deal).stage).toBe('WON');
  });

  // =========================================================================
  // 14 — Convert deal: assert Customer created + convertedCustomerId set.
  // =========================================================================
  it('converts a WON deal to a Customer and records convertedCustomerId', async () => {
    const res = await request(http)
      .post(`/api/v1/crm/deals/${dealId}/convert`)
      .set(auth())
      .expect(200);
    const body = res.body as { dealId: string; customerId: string };
    expect(body.dealId).toBe(dealId);
    expect(body.customerId).toBeTruthy();

    // Verify the deal has convertedCustomerId set
    const dealRes = await request(http)
      .get(`/api/v1/crm/deals/${dealId}`)
      .set(auth())
      .expect(200);
    const deal = dealRes.body as Deal;
    expect(deal.convertedCustomerId).toBe(body.customerId);

    // Verify Customer exists in the DB with the right tenant
    const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
    expect(customer).not.toBeNull();
    expect(customer!.tenantId).toBe(tenantId);
    expect(customer!.code).toMatch(/^CUST-/);
  });

  // =========================================================================
  // 14b — Re-convert is idempotent: same customerId, no second Customer created.
  // =========================================================================
  it('re-converting a WON deal is idempotent (same customerId, no duplicate Customer)', async () => {
    // We know dealId is already converted from test 14
    const firstRes = await request(http)
      .get(`/api/v1/crm/deals/${dealId}`)
      .set(auth())
      .expect(200);
    const firstCustomerId = (firstRes.body as Deal).convertedCustomerId!;
    expect(firstCustomerId).toBeTruthy();

    // Count customers before second convert
    const beforeCount = await prisma.customer.count({ where: { tenantId } });

    // Second convert call
    const res = await request(http)
      .post(`/api/v1/crm/deals/${dealId}/convert`)
      .set(auth())
      .expect(200);
    const body = res.body as { dealId: string; customerId: string };
    expect(body.customerId).toBe(firstCustomerId);

    // No new Customer should have been created
    const afterCount = await prisma.customer.count({ where: { tenantId } });
    expect(afterCount).toBe(beforeCount);
  });

  // =========================================================================
  // 15 — Advance WON→LOST rejected (terminal stage).
  // =========================================================================
  it('rejects advancing a WON deal to LOST (terminal stage — 400)', async () => {
    await request(http)
      .post(`/api/v1/crm/deals/${dealId}/advance`)
      .set(auth())
      .send({ stage: 'LOST' })
      .expect(400);
  });

  // =========================================================================
  // 16 — Create activity on the deal → assert lastActivityAt set.
  // =========================================================================
  it('creates an activity linked to the deal and bumps deal.lastActivityAt', async () => {
    const res = await request(http)
      .post('/api/v1/crm/activities')
      .set(auth())
      .send({ type: 'NOTE', body: 'Followed up with customer.', dealId })
      .expect(201);
    const activity = res.body as Activity;
    expect(activity.type).toBe('NOTE');
    expect(activity.dealId).toBe(dealId);
    activityId = activity.id;

    // Verify lastActivityAt was updated on the deal
    const dealRes = await request(http)
      .get(`/api/v1/crm/deals/${dealId}`)
      .set(auth())
      .expect(200);
    const deal = dealRes.body as Deal;
    expect(deal.lastActivityAt).not.toBeNull();
  });

  // =========================================================================
  // 17 — GET /crm/pipeline → returns deals grouped by stage.
  // =========================================================================
  it('GET /crm/pipeline returns deals grouped by stage', async () => {
    const res = await request(http).get('/api/v1/crm/pipeline').set(auth()).expect(200);
    const pipeline = res.body as PipelineEntry[];
    expect(Array.isArray(pipeline)).toBe(true);
    // Should have 5 stages (LEAD, QUALIFIED, PROPOSAL, WON, LOST)
    const stages = pipeline.map((p) => p.stage);
    expect(stages).toContain('LEAD');
    expect(stages).toContain('QUALIFIED');
    expect(stages).toContain('PROPOSAL');
    expect(stages).toContain('WON');
    expect(stages).toContain('LOST');

    // Our WON deal should appear in the WON bucket
    const wonBucket = pipeline.find((p) => p.stage === 'WON');
    expect(wonBucket).toBeDefined();
    expect(wonBucket!.deals.some((d) => d.id === dealId)).toBe(true);

    // Each deal entry has required fields
    const ourDeal = wonBucket!.deals.find((d) => d.id === dealId)!;
    expect(ourDeal.companyName).toBeTruthy();
  });

  // =========================================================================
  // 18 — GET /crm/overview → returns the full stats shape with sane values.
  // =========================================================================
  it('GET /crm/overview returns a valid stats shape', async () => {
    const res = await request(http).get('/api/v1/crm/overview').set(auth()).expect(200);
    const overview = res.body as {
      pipeline: { stage: string; count: number; value: number }[];
      openValue: number;
      wonCount: number;
      lostCount: number;
      winRate: number;
      staleDealCount: number;
      dueFollowupCount: number;
      recentActivities: { id: string; type: string; body: string; createdAt: string; dealId: string | null; companyId: string | null }[];
    };

    // Shape assertions
    expect(Array.isArray(overview.pipeline)).toBe(true);
    expect(typeof overview.openValue).toBe('number');
    expect(typeof overview.wonCount).toBe('number');
    expect(typeof overview.lostCount).toBe('number');
    expect(typeof overview.winRate).toBe('number');
    expect(typeof overview.staleDealCount).toBe('number');
    expect(typeof overview.dueFollowupCount).toBe('number');
    expect(Array.isArray(overview.recentActivities)).toBe(true);

    // Pipeline spans all 5 stages
    const pipelineStages = overview.pipeline.map((p) => p.stage);
    expect(pipelineStages).toContain('LEAD');
    expect(pipelineStages).toContain('QUALIFIED');
    expect(pipelineStages).toContain('PROPOSAL');
    expect(pipelineStages).toContain('WON');
    expect(pipelineStages).toContain('LOST');

    // Each pipeline entry has numeric count and value
    for (const entry of overview.pipeline) {
      expect(typeof entry.count).toBe('number');
      expect(typeof entry.value).toBe('number');
    }

    // WON bucket should have at least 1 deal (our dealId was advanced to WON)
    const wonEntry = overview.pipeline.find((p) => p.stage === 'WON');
    expect(wonEntry).toBeDefined();
    expect(wonEntry!.count).toBeGreaterThanOrEqual(1);

    // openValue is a plain number (not stringified Decimal)
    expect(overview.openValue).toBeGreaterThanOrEqual(0);

    // winRate is between 0 and 1
    expect(overview.winRate).toBeGreaterThanOrEqual(0);
    expect(overview.winRate).toBeLessThanOrEqual(1);

    // recentActivities have the expected shape
    if (overview.recentActivities.length > 0) {
      const first = overview.recentActivities[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('type');
      expect(first).toHaveProperty('body');
      expect(first).toHaveProperty('createdAt');
      expect(first).toHaveProperty('dealId');
      expect(first).toHaveProperty('companyId');
    }
  });

  // =========================================================================
  // 19 — GET /crm/activities?overdue=true → only overdue TASK activities.
  // =========================================================================
  it('GET /crm/activities?overdue=true returns only overdue TASK activities', async () => {
    // Create a TASK activity with a past dueAt so it shows as overdue
    const pastDueAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    const createRes = await request(http)
      .post('/api/v1/crm/activities')
      .set(auth())
      .send({
        type: 'TASK',
        body: 'Overdue follow-up task for e2e test',
        companyId,
        dueAt: pastDueAt,
      })
      .expect(201);
    const overdueTaskId = (createRes.body as { id: string }).id;

    // Query overdue
    const res = await request(http)
      .get('/api/v1/crm/activities?overdue=true')
      .set(auth())
      .expect(200);
    const body = res.body as Paginated<Activity>;
    expect(body).toHaveProperty('items');

    // Every returned item must be a TASK with doneAt null
    for (const item of body.items) {
      expect(item.type).toBe('TASK');
    }

    // Our newly created overdue task must appear
    expect(body.items.some((a) => a.id === overdueTaskId)).toBe(true);

    // Clean up the overdue task
    await prisma.crmActivity.deleteMany({ where: { id: overdueTaskId } }).catch(() => undefined);
  });

  // =========================================================================
  // 20 — GET /crm/activities?type=NOTE → only NOTE activities.
  // =========================================================================
  it('GET /crm/activities?type=NOTE returns only NOTE type activities', async () => {
    const res = await request(http)
      .get('/api/v1/crm/activities?type=NOTE')
      .set(auth())
      .expect(200);
    const body = res.body as Paginated<Activity>;
    expect(body).toHaveProperty('items');
    for (const item of body.items) {
      expect(item.type).toBe('NOTE');
    }
  });

  // =========================================================================
  // 21 — GET /crm/activities?pending=true → only activities with doneAt null.
  // =========================================================================
  it('GET /crm/activities?pending=true returns only activities with doneAt null (via direct Prisma check)', async () => {
    const res = await request(http)
      .get('/api/v1/crm/activities?pending=true')
      .set(auth())
      .expect(200);
    const body = res.body as Paginated<Activity & { doneAt?: string | null }>;
    expect(body).toHaveProperty('items');
    // All returned items must have doneAt = null
    for (const item of body.items) {
      const dbRecord = await prisma.crmActivity.findUnique({ where: { id: item.id }, select: { doneAt: true } });
      expect(dbRecord?.doneAt).toBeNull();
    }
  });
});

// =============================================================================
// Task 9 — Autonomous exception loop: stale deal → task auto-assigned to agent
// =============================================================================

/**
 * Minimal no-op stub so the app boots without a real Hermes process.
 * The worker dispatch is fire-and-forget (best-effort, never throws into the
 * caller); stubbing AgentRuntimeService ensures it fails fast (SKIPPED run)
 * rather than actually spawning a child process during the e2e suite.
 */
@Injectable()
class FakeAgentRuntimeService {
  constructor(private readonly _agents: AgentsService) {}
  async openSession(): Promise<string> {
    return 'fake-session';
  }
  async *sendTurn(): AsyncGenerator<never> {
    /* no turns in this suite */
  }
  async closeSession(): Promise<void> {
    /* no-op */
  }
  async killAgentSessions(): Promise<void> {
    /* no-op */
  }
}

describe('CRM autonomous exception loop (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let crmExceptions: CrmExceptionsService;
  let domainEvents: DomainEventsService;
  let token = '';
  let tenantId = '';

  const suffix = `loop-${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // IDs to clean up after the suite
  let loopAgentId = '';
  let loopCompanyId = '';
  let loopDealId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentRuntimeService)
      .useClass(FakeAgentRuntimeService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();

    prisma = app.get(PrismaService);
    crmExceptions = app.get(CrmExceptionsService);
    domainEvents = app.get(DomainEventsService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Ensure CRM module is enabled for acme.
    const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });
  });

  afterAll(async () => {
    if (prisma) {
      // Remove the stale task(s) created by our deal so dedup doesn't bleed into other runs.
      if (loopDealId) {
        await prisma.operationalTask.deleteMany({
          where: { tenantId, dedupKey: `CRM_STALE_DEAL:${loopDealId}` },
        }).catch(() => undefined);
        await prisma.crmDeal.deleteMany({ where: { id: loopDealId } }).catch(() => undefined);
      }
      if (loopCompanyId) {
        await prisma.crmCompany.deleteMany({ where: { id: loopCompanyId } }).catch(() => undefined);
      }
      if (loopAgentId) {
        await prisma.agent.deleteMany({ where: { id: loopAgentId } }).catch(() => undefined);
      }
    }
    await app.close();
  });

  // =========================================================================
  // Step 1 — Register a crm-sdr–style always-on AUTONOMOUS agent.
  // =========================================================================
  it('creates an always-on CRM SDR agent (AUTONOMOUS, handlesCategories CRM_STALE_DEAL)', async () => {
    const res = await request(http)
      .post('/api/v1/agents')
      .set(auth())
      .send({
        name: `crm-sdr-${suffix}`,
        persona: "Je suis l'agent commercial 24/7. Je relance les deals en stagnation.",
        role: 'crm-sdr',
        model: 'anthropic:claude-sonnet-4-6',
        autonomyLevel: 'AUTONOMOUS',
        permissions: ['crm.read', 'crm.manage', 'core.operating.tasks.read', 'core.operating.tasks.manage'],
        caps: {
          alwaysOn: true,
          handlesCategories: ['CRM_STALE_DEAL', 'CRM_FOLLOWUP_DUE'],
          maxAmountPerAction: 1000,
        },
      })
      .expect(201);

    const body = res.body as { id: string; autonomyLevel: string; name: string };
    loopAgentId = body.id;
    expect(loopAgentId).toBeTruthy();
    expect(body.autonomyLevel).toBe('AUTONOMOUS');
    expect(body.name).toBe(`crm-sdr-${suffix}`);
  });

  // =========================================================================
  // Step 2 — Create a company + a LEAD deal, then back-date lastActivityAt
  //          to 10 days ago (via direct Prisma update) to make it stale.
  // =========================================================================
  it('creates a stale deal (lastActivityAt 10 days ago) via Prisma direct update', async () => {
    // Create the company.
    const companyRes = await request(http)
      .post('/api/v1/crm/companies')
      .set(auth())
      .send({ name: `Loop Company ${suffix}` })
      .expect(201);
    loopCompanyId = (companyRes.body as { id: string }).id;
    expect(loopCompanyId).toBeTruthy();

    // Create the deal (default stage = LEAD).
    const dealRes = await request(http)
      .post('/api/v1/crm/deals')
      .set(auth())
      .send({ title: `Stale Deal ${suffix}`, companyId: loopCompanyId, amount: 25000, currency: 'CAD' })
      .expect(201);
    loopDealId = (dealRes.body as { id: string }).id;
    expect(loopDealId).toBeTruthy();

    // Back-date lastActivityAt by 10 days so tick() considers it stale (threshold = 7 days).
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.crmDeal.update({
      where: { id: loopDealId },
      data: { lastActivityAt: tenDaysAgo },
    });

    // Verify the deal is now stale in the DB.
    const deal = await prisma.crmDeal.findUniqueOrThrow({ where: { id: loopDealId } });
    expect(deal.lastActivityAt!.getTime()).toBeLessThan(Date.now() - 7 * 24 * 60 * 60 * 1000);
  });

  // =========================================================================
  // Step 3 — Run CrmExceptionsService.tick(now) to emit the domain events,
  //          then DomainEventsService.processPending() to create the tasks.
  // =========================================================================
  it('tick() detects the stale deal and emits a crm.deal.stale domain event', async () => {
    const now = new Date();
    const [staleCount] = await crmExceptions.tick(now);
    // At least our deal must have been detected (there may be others in the DB).
    expect(staleCount).toBeGreaterThanOrEqual(1);

    // Confirm the PENDING event for our specific deal was written.
    const event = await prisma.domainEvent.findFirst({
      where: {
        tenantId,
        type: 'crm.deal.stale',
        subjectId: loopDealId,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(event).not.toBeNull();
    expect(event!.status).toBe('PENDING');
  });

  it('processPending() creates a CRM_STALE_DEAL task auto-assigned to the crm-sdr agent', async () => {
    const processed = await domainEvents.processPending(50);
    expect(processed).toBeGreaterThanOrEqual(1);

    // Assert the task was created for our deal and auto-assigned to our agent.
    const task = await prisma.operationalTask.findFirst({
      where: {
        tenantId,
        category: 'CRM_STALE_DEAL',
        subjectId: loopDealId,
        subjectType: 'deal',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(task).not.toBeNull();
    expect(task!.category).toBe('CRM_STALE_DEAL');
    expect(task!.subjectId).toBe(loopDealId);
    expect(task!.assigneeType).toBe('AGENT');
    expect(task!.assigneeAgentId).toBe(loopAgentId);
    expect(task!.tenantId).toBe(tenantId);
    // Verify the dedupKey matches the expected format.
    expect(task!.dedupKey).toBe(`CRM_STALE_DEAL:${loopDealId}`);
  });

  // =========================================================================
  // Step 4 — Idempotency: re-running tick + processPending must NOT create
  //          a duplicate task (dedupKey unique constraint).
  // =========================================================================
  it('re-running tick + processPending is idempotent — no duplicate task created', async () => {
    const before = await prisma.operationalTask.count({
      where: { tenantId, dedupKey: `CRM_STALE_DEAL:${loopDealId}` },
    });
    expect(before).toBe(1);

    await crmExceptions.tick(new Date());
    await domainEvents.processPending(50);

    const after = await prisma.operationalTask.count({
      where: { tenantId, dedupKey: `CRM_STALE_DEAL:${loopDealId}` },
    });
    expect(after).toBe(1);
  });

  // =========================================================================
  // Step 5 — Tenant isolation: the task's tenantId is acme's and the assigned
  //          agent belongs to the same tenant.
  // =========================================================================
  it('tenant isolation: task tenantId matches acme and assigned agent belongs to same tenant', async () => {
    const task = await prisma.operationalTask.findFirst({
      where: { tenantId, dedupKey: `CRM_STALE_DEAL:${loopDealId}` },
    });
    expect(task!.tenantId).toBe(tenantId);

    const agent = await prisma.agent.findUnique({ where: { id: loopAgentId } });
    expect(agent!.tenantId).toBe(tenantId);
  });
});
