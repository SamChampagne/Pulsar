/**
 * E2E CRM email threads — proves inbound threading end-to-end over real Postgres
 * (tenant acme) via the dev simulate endpoint:
 *  1. Enable CRM; create a company + contact with a unique email.
 *  2. Simulate inbound from that contact → thread LINKED, contactId set.
 *  3. Simulate a reply (References the first messageId) → same thread, count grows.
 *  4. Simulate inbound from an unknown sender → thread UNLINKED.
 *  5. Link the unlinked thread to the contact → status LINKED.
 *  6. Reply to a thread → outbound queued.
 *  7. Idempotence: re-simulate the same messageId → no new message.
 * Creates its own master data with unique codes so reruns are safe.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/core/email/mail.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

describe('CRM email threads (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';

  // IDs created during the suite (cleaned up in afterAll)
  let companyId = '';
  let contactId = '';
  let linkedThreadId = '';
  let unlinkedThreadId = '';

  // Unique suffix per run so reruns never collide on emails / messageIds / subjects
  const suffix = `thr-${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Unique sender email for the known contact
  const senderEmail = `jane.${suffix}@inbound.test`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    // Login — returns HTTP 200, body.accessToken
    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Enable CRM module via Prisma upsert (avoids relying on the admin endpoint which is itself
    // gated by the module being enabled — same pattern as crm-module.e2e-spec.ts).
    const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });
  });

  afterAll(async () => {
    if (prisma) {
      // Clean up in reverse dependency order.
      // Remove email messages linked to the threads we created.
      if (linkedThreadId) {
        await prisma.emailMessage
          .deleteMany({ where: { tenantId, threadId: linkedThreadId } })
          .catch(() => undefined);
        await prisma.emailThread
          .deleteMany({ where: { id: linkedThreadId } })
          .catch(() => undefined);
      }
      if (unlinkedThreadId) {
        await prisma.emailMessage
          .deleteMany({ where: { tenantId, threadId: unlinkedThreadId } })
          .catch(() => undefined);
        await prisma.emailThread
          .deleteMany({ where: { id: unlinkedThreadId } })
          .catch(() => undefined);
      }
      if (contactId) {
        await prisma.crmContact.deleteMany({ where: { id: contactId } }).catch(() => undefined);
      }
      if (companyId) {
        await prisma.crmCompany.deleteMany({ where: { id: companyId } }).catch(() => undefined);
      }
    }
    await app.close();
  });

  // ===========================================================================
  // 1 — Create master data: company + contact with a unique email.
  // ===========================================================================
  it('creates a company and a contact with a unique email', async () => {
    const companyRes = await request(http)
      .post('/api/v1/crm/companies')
      .set(auth())
      .send({ name: `Thread Corp ${suffix}` })
      .expect(201);
    companyId = (companyRes.body as { id: string }).id;
    expect(companyId).toBeTruthy();

    const contactRes = await request(http)
      .post('/api/v1/crm/contacts')
      .set(auth())
      .send({ name: `Jane Inbound ${suffix}`, email: senderEmail, companyId })
      .expect(201);
    contactId = (contactRes.body as { id: string }).id;
    expect(contactId).toBeTruthy();
  });

  // ===========================================================================
  // 2 — Simulate inbound from the known contact → thread LINKED, contactId set.
  // ===========================================================================
  it('simulate inbound from known contact → creates a LINKED thread with contactId', async () => {
    const mid1 = `<m1.${suffix}@inbound.test>`;
    const res = await request(http)
      .post('/api/v1/emails/_simulate-inbound')
      .set(auth())
      .send({
        from: senderEmail,
        subject: `Quote request ${suffix}`,
        text: 'Need a quote',
        messageId: mid1,
      })
      .expect(201);

    const body = res.body as { threadId: string; messageId: string; deduped: boolean };
    expect(body.threadId).toBeTruthy();
    expect(body.deduped).toBe(false);
    linkedThreadId = body.threadId;

    // Verify in the DB that the thread is LINKED and contactId matches.
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: linkedThreadId },
    });
    expect(thread.status).toBe('LINKED');
    expect(thread.contactId).toBe(contactId);
    expect(thread.tenantId).toBe(tenantId);
  });

  // ===========================================================================
  // 3 — Simulate a reply that References the first messageId → same thread.
  // ===========================================================================
  it('simulate reply referencing first messageId → appended to the same thread, message count ≥ 2', async () => {
    // Grab mid1 from the DB (the inbound message we just created).
    const firstMsg = await prisma.emailMessage.findFirst({
      where: { tenantId, threadId: linkedThreadId, direction: 'INBOUND' },
      orderBy: { createdAt: 'asc' },
      select: { messageId: true },
    });
    expect(firstMsg?.messageId).toBeTruthy();
    const mid1 = firstMsg!.messageId!;

    const mid2 = `<m2.${suffix}@inbound.test>`;
    const res = await request(http)
      .post('/api/v1/emails/_simulate-inbound')
      .set(auth())
      .send({
        from: senderEmail,
        subject: `Re: Quote request ${suffix}`,
        text: 'Following up',
        messageId: mid2,
        references: [mid1],
      })
      .expect(201);

    const body = res.body as { threadId: string; deduped: boolean };
    // Must land in the SAME thread.
    expect(body.threadId).toBe(linkedThreadId);
    expect(body.deduped).toBe(false);

    // GET the thread and verify messages array has grown.
    const threadRes = await request(http)
      .get(`/api/v1/crm/threads/${linkedThreadId}`)
      .set(auth())
      .expect(200);
    const full = threadRes.body as { messages: unknown[] };
    expect(full.messages.length).toBeGreaterThanOrEqual(2);
  });

  // ===========================================================================
  // 4 — Simulate inbound from an unknown sender → creates an UNLINKED thread.
  // ===========================================================================
  it('simulate inbound from unknown sender → creates an UNLINKED thread', async () => {
    const unknownEmail = `stranger.${suffix}@stranger.test`;
    const mid3 = `<m3.${suffix}@stranger.test>`;
    const uniqueSubject = `Unknown sender msg ${suffix}`;

    const res = await request(http)
      .post('/api/v1/emails/_simulate-inbound')
      .set(auth())
      .send({
        from: unknownEmail,
        subject: uniqueSubject,
        text: 'Who are you?',
        messageId: mid3,
      })
      .expect(201);

    const body = res.body as { threadId: string; deduped: boolean };
    expect(body.threadId).toBeTruthy();
    expect(body.deduped).toBe(false);
    unlinkedThreadId = body.threadId;

    // Must be different from the linked thread.
    expect(unlinkedThreadId).not.toBe(linkedThreadId);

    // Verify status is UNLINKED in the DB.
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: unlinkedThreadId },
    });
    expect(thread.status).toBe('UNLINKED');
    expect(thread.contactId).toBeNull();
    expect(thread.tenantId).toBe(tenantId);
  });

  // ===========================================================================
  // 5 — List threads: filter UNLINKED, find the one we just created by threadId.
  // ===========================================================================
  it('GET /crm/threads?status=UNLINKED returns the unlinked thread we just created', async () => {
    const res = await request(http)
      .get('/api/v1/crm/threads?status=UNLINKED')
      .set(auth())
      .expect(200);

    const body = res.body as { items: Array<{ id: string; status: string }>; total: number };
    expect(Array.isArray(body.items)).toBe(true);

    // Find our specific thread by id (robust to other UNLINKED threads in seed data).
    const found = body.items.find((t) => t.id === unlinkedThreadId);
    expect(found).toBeDefined();
    expect(found!.status).toBe('UNLINKED');
  });

  // ===========================================================================
  // 6 — Link the unlinked thread to the contact → status LINKED.
  // ===========================================================================
  it('POST /crm/threads/:id/link → thread becomes LINKED with contactId set', async () => {
    const res = await request(http)
      .post(`/api/v1/crm/threads/${unlinkedThreadId}/link`)
      .set(auth())
      .send({ contactId })
      .expect(201);

    const linked = res.body as { id: string; status: string; contactId: string };
    expect(linked.id).toBe(unlinkedThreadId);
    expect(linked.status).toBe('LINKED');
    expect(linked.contactId).toBe(contactId);

    // Verify in the DB too.
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: unlinkedThreadId },
    });
    expect(thread.status).toBe('LINKED');
    expect(thread.contactId).toBe(contactId);
  });

  // ===========================================================================
  // 7 — Reply to the linked thread → outbound message queued.
  // ===========================================================================
  it('POST /crm/threads/:id/reply → queues an outbound message and increments message count', async () => {
    // Stub deliver to avoid fire-and-forget noise (reply() calls mail.queue which triggers deliver).
    const mailSvc = app.get(MailService);
    const deliverSpy = jest.spyOn(mailSvc, 'deliver').mockResolvedValue(undefined);

    const countBefore = (
      await request(http).get(`/api/v1/crm/threads/${linkedThreadId}`).set(auth()).expect(200)
    ).body as { messages: unknown[] };
    const msgsBefore = countBefore.messages.length;

    const res = await request(http)
      .post(`/api/v1/crm/threads/${linkedThreadId}/reply`)
      .set(auth())
      .send({ html: '<p>Here is your quote.</p>' })
      .expect(201);

    deliverSpy.mockRestore();

    const msg = res.body as { id: string; status: string };
    expect(msg.id).toBeTruthy();
    expect(msg.status).toBe('QUEUED');

    // Thread message count must have grown.
    const threadAfter = await request(http)
      .get(`/api/v1/crm/threads/${linkedThreadId}`)
      .set(auth())
      .expect(200);
    const msgsAfter = (threadAfter.body as { messages: unknown[] }).messages.length;
    expect(msgsAfter).toBeGreaterThan(msgsBefore);
  });

  // ===========================================================================
  // 8 — Idempotence: re-simulate the same messageId → no new message.
  // ===========================================================================
  it('re-simulating the same messageId is idempotent — no duplicate created', async () => {
    // Get the second inbound message's messageId (mid2) from the DB.
    const msgs = await prisma.emailMessage.findMany({
      where: { tenantId, threadId: linkedThreadId, direction: 'INBOUND' },
      orderBy: { createdAt: 'asc' },
      select: { messageId: true },
    });
    // We have at least 2 INBOUND messages; use the second one.
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    const mid2 = msgs[1].messageId!;

    const firstMsg = msgs[0].messageId!;

    // Count messages before the duplicate attempt.
    const before = await prisma.emailMessage.count({
      where: { tenantId, threadId: linkedThreadId },
    });

    // Re-submit the same mid2.
    const res = await request(http)
      .post('/api/v1/emails/_simulate-inbound')
      .set(auth())
      .send({
        from: senderEmail,
        subject: `Re: Quote request ${suffix}`,
        text: 'This is a duplicate',
        messageId: mid2,
        references: [firstMsg],
      })
      .expect(201);

    const body = res.body as { threadId: string; deduped: boolean };
    expect(body.deduped).toBe(true);

    // Message count must be unchanged.
    const after = await prisma.emailMessage.count({
      where: { tenantId, threadId: linkedThreadId },
    });
    expect(after).toBe(before);
  });

  // ===========================================================================
  // 9 — Tenant isolation: GET /crm/threads returns only this tenant's threads.
  // ===========================================================================
  it('all returned threads belong to the acme tenant (no cross-tenant leak)', async () => {
    const res = await request(http).get('/api/v1/crm/threads').set(auth()).expect(200);
    const body = res.body as { items: Array<{ id: string }> };
    const ids = body.items.map((t) => t.id);
    if (ids.length === 0) return; // empty is fine
    const leaked = await prisma.emailThread.count({
      where: { id: { in: ids }, tenantId: { not: tenantId } },
    });
    expect(leaked).toBe(0);
  });
});
