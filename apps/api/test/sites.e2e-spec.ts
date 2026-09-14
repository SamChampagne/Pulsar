/**
 * E2E Sites module — landing pages (admin CRUD + public projection + submit → lead).
 *
 * Scenarios:
 *  1. POST /sites/pages → slug auto-generated from title; status = DRAFT.
 *  2. Duplicate slug → 409.
 *  3. POST :id/publish with empty content → 400; add a block via PATCH then publish → PUBLISHED.
 *  4. GET /public/sites/:slug (published) → 200 with title+blocks; NO tenantId anywhere in JSON.
 *  5. GET /public/sites/:slug for a DRAFT page → 404.
 *  6. POST /public/sites/:slug/submit { name, email, company } → { ok: true };
 *     LandingPageSubmission row exists + CrmContact created (CRM active);
 *     re-submit same email → contact deduped (still one).
 *  7. Honeypot: submit with _hp: 'x' → { ok: true } but NO new submission row.
 *  8. Tenant isolation: admin GET /sites/pages returns only acme's pages.
 *
 * Prerequisites: reachable PostgreSQL with seed applied (admin@pulsar.dev / admin123, tenant acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const uniq = () => Math.random().toString(36).slice(2, 10);

describe('Sites module (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);

    // Login
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(ADMIN)
      .expect(200);
    token = login.body.accessToken;

    // Get tenant id
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Enable sites module
    const sitesMod = await prisma.moduleDefinition.findFirstOrThrow({ where: { key: 'sites' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: sitesMod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: sitesMod.id, enabled: true, enabledAt: new Date() },
    });

    // Enable CRM module (needed for lead capture assertions)
    const crmMod = await prisma.moduleDefinition.findFirstOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: crmMod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: crmMod.id, enabled: true, enabledAt: new Date() },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const srv = () => app.getHttpServer();

  it('1. POST /sites/pages → slug auto-generated; status = DRAFT', async () => {
    const suffix = uniq();
    const res = await request(srv())
      .post('/api/v1/sites/pages')
      .set(auth())
      .send({ title: `Test Page ${suffix}` })
      .expect(201);

    expect(res.body.status).toBe('DRAFT');
    expect(res.body.slug).toBeTruthy();
    // slug should be derived from the title
    expect(res.body.slug).toContain('test-page');
  });

  it('2. Duplicate slug → 409', async () => {
    const suffix = uniq();
    // create the first page with an explicit slug
    await request(srv())
      .post('/api/v1/sites/pages')
      .set(auth())
      .send({ title: `Dup Test ${suffix}`, slug: `dup-slug-${suffix}` })
      .expect(201);

    // second creation with the same slug → conflict
    await request(srv())
      .post('/api/v1/sites/pages')
      .set(auth())
      .send({ title: `Dup Test 2 ${suffix}`, slug: `dup-slug-${suffix}` })
      .expect(409);
  });

  it('3. publish with empty content → 400; add block + publish → PUBLISHED', async () => {
    const suffix = uniq();
    const page = (
      await request(srv())
        .post('/api/v1/sites/pages')
        .set(auth())
        .send({ title: `Publish Test ${suffix}` })
        .expect(201)
    ).body;

    // Publish with no content → 400
    await request(srv())
      .post(`/api/v1/sites/pages/${page.id}/publish`)
      .set(auth())
      .expect(400);

    // Add a content block
    await request(srv())
      .patch(`/api/v1/sites/pages/${page.id}`)
      .set(auth())
      .send({ content: [{ type: 'heading', text: 'Hello' }] })
      .expect(200);

    // Publish now → PUBLISHED (NestJS POST returns 201)
    const published = (
      await request(srv())
        .post(`/api/v1/sites/pages/${page.id}/publish`)
        .set(auth())
        .expect(201)
    ).body;

    expect(published.status).toBe('PUBLISHED');
  });

  it('4. GET /public/sites/:slug → title+blocks; NO tenantId in JSON', async () => {
    const suffix = uniq();
    // Create and publish a page
    const page = (
      await request(srv())
        .post('/api/v1/sites/pages')
        .set(auth())
        .send({ title: `Public Page ${suffix}`, slug: `public-page-${suffix}` })
        .expect(201)
    ).body;

    await request(srv())
      .patch(`/api/v1/sites/pages/${page.id}`)
      .set(auth())
      .send({ content: [{ type: 'text', text: 'Welcome' }] })
      .expect(200);

    await request(srv())
      .post(`/api/v1/sites/pages/${page.id}/publish`)
      .set(auth())
      .expect(201);

    // Public GET
    const res = await request(srv())
      .get(`/api/v1/public/sites/public-page-${suffix}`)
      .expect(200);

    expect(res.body.title).toBe(`Public Page ${suffix}`);
    expect(Array.isArray(res.body.blocks)).toBe(true);

    // R10: tenantId must NOT appear anywhere in the JSON response
    const jsonStr = JSON.stringify(res.body);
    expect(jsonStr).not.toContain(tenantId);
    // Also must not expose internal id or captureListId
    expect(res.body).not.toHaveProperty('id');
    expect(res.body).not.toHaveProperty('tenantId');
    expect(res.body).not.toHaveProperty('captureListId');
  });

  it('5. GET /public/sites/:slug for a DRAFT page → 404', async () => {
    const suffix = uniq();
    await request(srv())
      .post('/api/v1/sites/pages')
      .set(auth())
      .send({ title: `Draft Page ${suffix}`, slug: `draft-page-${suffix}` })
      .expect(201);

    // DRAFT page → public route returns 404
    await request(srv())
      .get(`/api/v1/public/sites/draft-page-${suffix}`)
      .expect(404);
  });

  it('6. submit { name, email, company } → { ok:true }; submission row + CrmContact created; re-submit → deduped', async () => {
    const suffix = uniq();
    const email = `lead-${suffix}@example.com`;

    // Create and publish a page
    const page = (
      await request(srv())
        .post('/api/v1/sites/pages')
        .set(auth())
        .send({ title: `Lead Page ${suffix}`, slug: `lead-page-${suffix}` })
        .expect(201)
    ).body;

    await request(srv())
      .patch(`/api/v1/sites/pages/${page.id}`)
      .set(auth())
      .send({ content: [{ type: 'form', fields: ['name', 'email', 'company'] }] })
      .expect(200);

    await request(srv())
      .post(`/api/v1/sites/pages/${page.id}/publish`)
      .set(auth())
      .expect(201);

    // Submit the form
    const res = await request(srv())
      .post(`/api/v1/public/sites/lead-page-${suffix}/submit`)
      .send({ name: 'Jane Doe', email, company: 'Acme Corp' })
      .expect(201);

    expect(res.body).toEqual({ ok: true });

    // Submission row exists
    const submission = await prisma.landingPageSubmission.findFirst({
      where: { tenantId, landingPageId: page.id },
    });
    expect(submission).toBeTruthy();

    // CrmContact created with that email
    const contact = await prisma.crmContact.findFirst({
      where: { tenantId, email: { equals: email, mode: 'insensitive' } },
    });
    expect(contact).toBeTruthy();
    expect(contact!.name).toBe('Jane Doe');

    // Re-submit same email → same contact (dedup, still one)
    await request(srv())
      .post(`/api/v1/public/sites/lead-page-${suffix}/submit`)
      .send({ name: 'Jane Doe', email, company: 'Different Corp' })
      .expect(201);

    const contactCount = await prisma.crmContact.count({
      where: { tenantId, email: { equals: email, mode: 'insensitive' } },
    });
    expect(contactCount).toBe(1);
  });

  it('7. Honeypot: submit with _hp → { ok:true } but NO new submission row', async () => {
    const suffix = uniq();

    // Create and publish a page
    const page = (
      await request(srv())
        .post('/api/v1/sites/pages')
        .set(auth())
        .send({ title: `Honeypot Page ${suffix}`, slug: `honeypot-page-${suffix}` })
        .expect(201)
    ).body;

    await request(srv())
      .patch(`/api/v1/sites/pages/${page.id}`)
      .set(auth())
      .send({ content: [{ type: 'form', fields: ['name', 'email'] }] })
      .expect(200);

    await request(srv())
      .post(`/api/v1/sites/pages/${page.id}/publish`)
      .set(auth())
      .expect(201);

    const countBefore = await prisma.landingPageSubmission.count({
      where: { tenantId, landingPageId: page.id },
    });

    // Submit with filled honeypot → silently discarded
    const res = await request(srv())
      .post(`/api/v1/public/sites/honeypot-page-${suffix}/submit`)
      .send({ name: 'Bot', email: 'bot@example.com', _hp: 'I am a bot' })
      .expect(201);

    expect(res.body).toEqual({ ok: true });

    // No new submission row
    const countAfter = await prisma.landingPageSubmission.count({
      where: { tenantId, landingPageId: page.id },
    });
    expect(countAfter).toBe(countBefore);
  });

  it('8. Tenant isolation: admin GET /sites/pages returns only acme pages', async () => {
    const res = await request(srv())
      .get('/api/v1/sites/pages')
      .set(auth())
      .expect(200);

    expect(res.body.items).toBeDefined();
    // All items must have the acme tenantId
    for (const item of res.body.items) {
      expect(item.tenantId).toBe(tenantId);
    }
  });

  it('9. GET /sites/pages includes _count.submissions for each row (UI contract)', async () => {
    // Create a page and publish it, then push two submissions through the public form.
    const suffix = uniq();
    const page = (
      await request(srv())
        .post('/api/v1/sites/pages')
        .set(auth())
        .send({ title: `Count Page ${suffix}`, slug: `count-page-${suffix}` })
        .expect(201)
    ).body;

    await request(srv())
      .patch(`/api/v1/sites/pages/${page.id}`)
      .set(auth())
      .send({ content: [{ type: 'form', fields: ['name', 'email'] }] })
      .expect(200);

    await request(srv())
      .post(`/api/v1/sites/pages/${page.id}/publish`)
      .set(auth())
      .expect(201);

    await request(srv())
      .post(`/api/v1/public/sites/count-page-${suffix}/submit`)
      .send({ name: 'Lead A', email: `a-${suffix}@example.com` })
      .expect(201);
    await request(srv())
      .post(`/api/v1/public/sites/count-page-${suffix}/submit`)
      .send({ name: 'Lead B', email: `b-${suffix}@example.com` })
      .expect(201);

    // The list endpoint (not just the detail) must carry _count.submissions — the table renders it.
    const res = await request(srv())
      .get('/api/v1/sites/pages')
      .set(auth())
      .query({ search: `count-page-${suffix}` })
      .expect(200);

    const row = res.body.items.find((p: { slug: string }) => p.slug === `count-page-${suffix}`);
    expect(row).toBeTruthy();
    expect(row._count).toBeDefined();
    expect(row._count.submissions).toBe(2);
  });
});
