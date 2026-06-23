/**
 * E2E — Email core: per-tenant SMTP config (encrypted) + sendTest.
 *
 * Covers:
 *   - PUT /email-config with password → GET returns config WITHOUT password,
 *     hasPassword:true; raw password never leaks in API response or DB column.
 *   - PUT /email-config without password → existing passwordEnc preserved
 *     (hasPassword still true).
 *   - POST /email-config/test returns { ok: true } (EMAIL_DRIVER=log, no config).
 *   - POST /email-config/test with a stored config passes a defined transport to
 *     EmailService.send regardless of EMAIL_DRIVER (review fix).
 *   - MailService.queue persists EmailMessage (QUEUED) + EmailAttachment rows.
 *   - MailService.deliver (EMAIL_DRIVER=log) → status SENT + sentAt set.
 *   - MailService.processQueue picks up stuck QUEUED messages.
 *   - Agent tools: draft_email (LOW) runs live; send_email (SENSITIVE) is enqueued as
 *     a ProposedAction (PENDING) and does NOT send directly.
 *
 * Prerequisites: running, seeded PostgreSQL (pnpm db:seed).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailService } from '../src/core/email/email.service';
import { MailService } from '../src/core/email/mail.service';
import { DocumentsService } from '../src/core/documents/documents.service';
import { TOOL_BY_NAME } from '../src/core/agents/tool-registry';
import { ProposedActionsService } from '../src/core/agents/proposed-actions.service';
import { AiDraftService } from '../src/core/email/ai-draft.service';
import { RiskTier, AgentAutonomy } from '@pulsar/shared';
import type { AgentPrincipal } from '../src/core/agents/agent-principal';
import type { ToolServices } from '../src/core/agents/tool-types';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const SMTP_PASSWORD = 'super-secret-smtp-password';

describe('Email core — per-tenant SMTP config (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Clean slate so assertions are deterministic.
    await prisma.tenantEmailConfig.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await prisma.tenantEmailConfig.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await app.close();
  });

  it('GET before any config returns null/empty (not configured)', async () => {
    const res = await request(http).get('/api/v1/email-config').set(auth()).expect(200);
    // NestJS serializes a null return as an empty JSON object {}; either is acceptable.
    const body = res.body as Record<string, unknown> | null;
    const isUnconfigured = body === null || (typeof body === 'object' && Object.keys(body ?? {}).length === 0);
    expect(isUnconfigured).toBe(true);
  });

  it('PUT with password → persists encrypted, GET returns config without password + hasPassword:true', async () => {
    await request(http)
      .put('/api/v1/email-config')
      .set(auth())
      .send({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: 'user@example.com',
        password: SMTP_PASSWORD,
        fromName: 'Pulsar Test',
        fromEmail: 'noreply@example.com',
      })
      .expect(200);

    const res = await request(http).get('/api/v1/email-config').set(auth()).expect(200);
    const body = res.body as Record<string, unknown>;

    // Basic fields present and correct.
    expect(body.host).toBe('smtp.example.com');
    expect(body.port).toBe(587);
    expect(body.username).toBe('user@example.com');
    expect(body.fromEmail).toBe('noreply@example.com');
    expect(body.hasPassword).toBe(true);

    // The raw password must NEVER appear in the response.
    expect(JSON.stringify(body)).not.toContain(SMTP_PASSWORD);
    // `passwordEnc` must not be exposed.
    expect(body).not.toHaveProperty('passwordEnc');

    // At rest the column is ciphertext (not the plaintext password).
    const row = await prisma.tenantEmailConfig.findUnique({ where: { tenantId } });
    expect(row).toBeTruthy();
    expect(row!.passwordEnc).toBeTruthy();
    expect(row!.passwordEnc).not.toBe(SMTP_PASSWORD);
  });

  it('PUT without password → existing passwordEnc preserved, hasPassword still true', async () => {
    // Capture current encrypted secret.
    const before = await prisma.tenantEmailConfig.findUnique({ where: { tenantId } });
    expect(before?.passwordEnc).toBeTruthy();

    // Update without supplying a new password.
    await request(http)
      .put('/api/v1/email-config')
      .set(auth())
      .send({ fromName: 'Updated Name' })
      .expect(200);

    const after = await prisma.tenantEmailConfig.findUnique({ where: { tenantId } });
    // Encrypted secret is preserved (same ciphertext — deterministic for same plaintext with same key,
    // but regardless: non-null and matches before).
    expect(after?.passwordEnc).toBe(before?.passwordEnc);

    // API projection still reports hasPassword:true.
    const res = await request(http).get('/api/v1/email-config').set(auth()).expect(200);
    expect((res.body as Record<string, unknown>).hasPassword).toBe(true);
    expect((res.body as Record<string, unknown>).fromName).toBe('Updated Name');
  });

  it('POST /email-config/test returns { ok: true } with EMAIL_DRIVER=log (no tenant config)', async () => {
    // Delete any existing config so resolve() returns null → log fallback.
    await prisma.tenantEmailConfig.deleteMany({ where: { tenantId } });

    const res = await request(http)
      .post('/api/v1/email-config/test')
      .set(auth())
      .send({ to: 'tester@example.com' })
      .expect(200);

    expect((res.body as Record<string, unknown>).ok).toBe(true);
  });

  it('POST /email-config/test passes a defined transport to EmailService.send when tenant config exists (review fix)', async () => {
    // Ensure the tenant has a config so resolve() returns non-null.
    await request(http)
      .put('/api/v1/email-config')
      .set(auth())
      .send({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: 'user@example.com',
        password: SMTP_PASSWORD,
        fromName: 'Pulsar Test',
        fromEmail: 'noreply@example.com',
      })
      .expect(200);

    // Spy on EmailService.send BEFORE the request so we capture the argument.
    const emailService = app.get(EmailService);
    const sendSpy = jest.spyOn(emailService, 'send').mockResolvedValue(true);

    const res = await request(http)
      .post('/api/v1/email-config/test')
      .set(auth())
      .send({ to: 'tester@example.com' })
      .expect(200);

    expect((res.body as Record<string, unknown>).ok).toBe(true);

    // The key assertion: transport must be a defined object (not undefined),
    // proving the tenant SMTP config was passed regardless of EMAIL_DRIVER.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, transportArg] = sendSpy.mock.calls[0];
    expect(transportArg).toBeDefined();
    expect(typeof transportArg).toBe('object');
    expect((transportArg as { host: string }).host).toBe('smtp.example.com');

    sendSpy.mockRestore();

    // Verify lastTestAt and lastTestOk were updated.
    const config = await prisma.tenantEmailConfig.findUnique({ where: { tenantId } });
    expect(config?.lastTestAt).toBeTruthy();
    expect(config?.lastTestOk).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MailService outbox + delivery worker
// ---------------------------------------------------------------------------
describe('Email core — MailService outbox + delivery worker (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailService: MailService;
  let documentsService: DocumentsService;
  let tenantId = '';

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    mailService = app.get(MailService);
    documentsService = app.get(DocumentsService);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Clean up any leftover email messages from this test suite.
    await prisma.emailMessage.deleteMany({
      where: { tenantId, subject: { startsWith: '[test-mail]' } },
    });
  });

  afterAll(async () => {
    await prisma.emailMessage.deleteMany({
      where: { tenantId, subject: { startsWith: '[test-mail]' } },
    }).catch(() => undefined);
    await app.close();
  });

  it('queue() creates EmailMessage with status QUEUED (message object) and persists to DB', async () => {
    // Stub deliver so the fire-and-forget doesn't race with our DB read.
    const deliverSpy = jest.spyOn(mailService, 'deliver').mockResolvedValue(undefined);

    const msg = await mailService.queue(tenantId, {
      toAddresses: ['recipient@example.com'],
      subject: '[test-mail] basic queue',
      html: '<p>Hello world</p>',
    });

    deliverSpy.mockRestore();

    // The returned message object was created with QUEUED status.
    expect(msg.id).toBeTruthy();
    expect(msg.status).toBe('QUEUED');
    expect(msg.toAddresses).toEqual(['recipient@example.com']);

    // Verify it's actually in the DB — row exists (status may be QUEUED or advanced by the stub).
    const row = await prisma.emailMessage.findUnique({ where: { id: msg.id } });
    expect(row).toBeTruthy();
  });

  it('deliver() with EMAIL_DRIVER=log → status SENT + sentAt set', async () => {
    // Insert a QUEUED message directly to avoid the queue() fire-and-forget race.
    const inserted = await prisma.emailMessage.create({
      data: {
        tenantId,
        toAddresses: ['recipient@example.com'],
        subject: '[test-mail] deliver direct',
        html: '<p>Test deliver</p>',
        status: 'QUEUED',
      },
    });

    await mailService.deliver(inserted.id);

    const row = await prisma.emailMessage.findUnique({ where: { id: inserted.id } });
    expect(row!.status).toBe('SENT');
    expect(row!.sentAt).toBeTruthy();
  });

  it('queue() with attachment creates EmailAttachment row and deliver() does not throw', async () => {
    // Create a real Document in the tenant's name so the FK lookup passes.
    const doc = await documentsService.upload(tenantId, {
      entityType: 'email-test',
      entityId: 'test-entity-1',
      fileName: 'test.txt',
      mimeType: 'text/plain',
      body: Buffer.from('attachment content'),
    });

    // Stub deliver on queue() to avoid the fire-and-forget race.
    const deliverSpy = jest.spyOn(mailService, 'deliver').mockResolvedValue(undefined);

    const msg = await mailService.queue(tenantId, {
      toAddresses: ['recipient@example.com'],
      subject: '[test-mail] with attachment',
      html: '<p>See attachment</p>',
      attachments: [{ documentId: doc.id, filename: 'test.txt' }],
    });

    deliverSpy.mockRestore();

    // Verify EmailAttachment row was created.
    const attachments = await prisma.emailAttachment.findMany({
      where: { emailMessageId: msg.id },
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0].documentId).toBe(doc.id);
    expect(attachments[0].filename).toBe('test.txt');

    // Now deliver for real (message is still QUEUED since we stubbed the first attempt).
    await expect(mailService.deliver(msg.id)).resolves.toBeUndefined();

    const row = await prisma.emailMessage.findUnique({ where: { id: msg.id } });
    expect(row!.status).toBe('SENT');

    // Clean up the uploaded document.
    await documentsService.remove(tenantId, doc.id).catch(() => undefined);
  });

  it('processQueue() delivers stuck QUEUED messages', async () => {
    // Insert a QUEUED message backdated so processQueue picks it up.
    const stuck = await prisma.emailMessage.create({
      data: {
        tenantId,
        toAddresses: ['stuck@example.com'],
        subject: '[test-mail] stuck queued',
        html: '<p>Stuck</p>',
        status: 'QUEUED',
        createdAt: new Date(Date.now() - 2 * 60_000), // 2 minutes ago
      },
    });

    await mailService.processQueue();

    const row = await prisma.emailMessage.findUnique({ where: { id: stuck.id } });
    expect(row!.status).toBe('SENT');
  });

  it('queue() rejects an attachment documentId not owned by the tenant', async () => {
    await expect(
      mailService.queue(tenantId, {
        toAddresses: ['recipient@example.com'],
        subject: '[test-mail] bad attachment',
        html: '<p>Bad</p>',
        attachments: [{ documentId: 'nonexistent-document-id', filename: 'bad.pdf' }],
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EmailTemplatesService — CRUD + render with {variable} interpolation
// ---------------------------------------------------------------------------
describe('Email core — EmailTemplatesService CRUD + render (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';
  let createdTemplateId = '';

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const UNIQUE_KEY = `test-tmpl-${Date.now()}`;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    // Clean up test templates.
    await prisma.emailTemplate
      .deleteMany({ where: { tenantId, key: { startsWith: 'test-tmpl-' } } })
      .catch(() => undefined);
    await app.close();
  });

  it('POST /emails/templates — creates a template', async () => {
    const res = await request(http)
      .post('/api/v1/emails/templates')
      .set(auth())
      .send({
        key: UNIQUE_KEY,
        name: 'Test Template',
        subject: 'Hello {name}',
        html: '<p>Dear {name}, your order {orderId} is ready.</p>',
        category: 'transactional',
      })
      .expect(201);

    const body = res.body as Record<string, unknown>;
    expect(body.id).toBeTruthy();
    expect(body.key).toBe(UNIQUE_KEY);
    expect(body.subject).toBe('Hello {name}');
    createdTemplateId = body.id as string;
  });

  it('GET /emails/templates — lists templates including the created one', async () => {
    const res = await request(http).get('/api/v1/emails/templates').set(auth()).expect(200);
    const items = res.body as Array<Record<string, unknown>>;
    const found = items.find((t) => t.id === createdTemplateId);
    expect(found).toBeTruthy();
  });

  it('GET /emails/templates/:id — fetches by id', async () => {
    const res = await request(http)
      .get(`/api/v1/emails/templates/${createdTemplateId}`)
      .set(auth())
      .expect(200);
    expect((res.body as Record<string, unknown>).key).toBe(UNIQUE_KEY);
  });

  it('render interpolates {variable} tokens from payload via EmailTemplatesService', async () => {
    // Use service directly to test render.
    const { EmailTemplatesService: TemplatesService } = await import('../src/core/email/email-templates.service');
    const svc = app.get(TemplatesService);

    const { subject, html } = await svc.render(tenantId, UNIQUE_KEY, {
      name: 'Alice',
      orderId: 'ORD-001',
    });

    expect(subject).toBe('Hello Alice');
    expect(html).toBe('<p>Dear Alice, your order ORD-001 is ready.</p>');
  });

  it('PUT /emails/templates/:id — updates a template', async () => {
    const res = await request(http)
      .put(`/api/v1/emails/templates/${createdTemplateId}`)
      .set(auth())
      .send({ name: 'Updated Name' })
      .expect(200);
    expect((res.body as Record<string, unknown>).name).toBe('Updated Name');
  });

  it('DELETE /emails/templates/:id — removes a template', async () => {
    await request(http)
      .delete(`/api/v1/emails/templates/${createdTemplateId}`)
      .set(auth())
      .expect(204);

    const gone = await prisma.emailTemplate.findUnique({ where: { id: createdTemplateId } });
    expect(gone).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EmailsController — POST /emails (compose) + GET /emails
// ---------------------------------------------------------------------------
describe('Email core — EmailsController compose + list (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';
  let composedMessageId = '';

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Clean any residual test messages.
    await prisma.emailMessage.deleteMany({
      where: { tenantId, subject: { startsWith: '[e2e-compose]' } },
    });
  });

  afterAll(async () => {
    await prisma.emailMessage
      .deleteMany({ where: { tenantId, subject: { startsWith: '[e2e-compose]' } } })
      .catch(() => undefined);
    await app.close();
  });

  it('POST /emails — compose queues an EmailMessage with status QUEUED', async () => {
    const { MailService: MS } = await import('../src/core/email/mail.service');
    const mailSvc = app.get(MS);
    // Stub deliver to avoid the fire-and-forget race.
    const deliverSpy = jest.spyOn(mailSvc, 'deliver').mockResolvedValue(undefined);

    const res = await request(http)
      .post('/api/v1/emails')
      .set(auth())
      .send({
        to: ['test-recipient@example.com'],
        subject: '[e2e-compose] basic compose',
        html: '<p>Hello from e2e</p>',
      })
      .expect(201);

    deliverSpy.mockRestore();

    const body = res.body as Record<string, unknown>;
    expect(body.id).toBeTruthy();
    expect(body.status).toBe('QUEUED');
    expect(body.subject).toBe('[e2e-compose] basic compose');
    composedMessageId = body.id as string;
  });

  it('GET /emails — lists messages including the composed one', async () => {
    const res = await request(http).get('/api/v1/emails').set(auth()).expect(200);
    const body = res.body as { items: Array<Record<string, unknown>>; total: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
    const found = body.items.find((m) => m.id === composedMessageId);
    expect(found).toBeTruthy();
  });

  it('GET /emails/:id — fetches by id with attachments', async () => {
    const res = await request(http)
      .get(`/api/v1/emails/${composedMessageId}`)
      .set(auth())
      .expect(200);
    const body = res.body as Record<string, unknown>;
    expect(body.id).toBe(composedMessageId);
    expect(Array.isArray(body.attachments)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AiDraftService — POST /emails/draft returns 400 when no LLM configured
// ---------------------------------------------------------------------------
describe('Email core — AiDraftService guard (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Ensure no AgentRuntimeConfig exists for this tenant during the test.
    await prisma.agentRuntimeConfig.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /emails/draft returns 400 when tenant has no AgentRuntimeConfig', async () => {
    const res = await request(http)
      .post('/api/v1/emails/draft')
      .set(auth())
      .send({ prompt: 'Write a welcome email for a new customer' })
      .expect(400);

    const body = res.body as Record<string, unknown>;
    expect(typeof body.message).toBe('string');
    expect((body.message as string).toLowerCase()).toContain('llm');
  });
});

// ---------------------------------------------------------------------------
// Agent tools — draft_email (LOW) + send_email (SENSITIVE) governance
// ---------------------------------------------------------------------------
describe('Email core — agent tools governance (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let mailService: MailService;
  let proposedActionsService: ProposedActionsService;
  let tenantId = '';
  let token = '';
  let agentId = '';

  /** Resolved principal built from the registered agent row. */
  let principal: AgentPrincipal;

  /** Minimal ToolServices stub — only the email delegate needs to be real. */
  let services: ToolServices;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    prisma = app.get(PrismaService);
    mailService = app.get(MailService);
    proposedActionsService = app.get(ProposedActionsService);
    const aiDraftService = app.get(AiDraftService);

    const loginRes = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (loginRes.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Register the agent via the real HTTP endpoint — handles prefix/secretHash/serviceUserId.
    const agentRes = await request(http)
      .post('/api/v1/agents')
      .set(auth())
      .send({
        name: `[e2e] email-tools-${Date.now()}`,
        role: 'email_tester',
        model: 'test',
        autonomyLevel: 'PROPOSE',
        permissions: ['core.email.send'],
      })
      .expect(201);

    agentId = (agentRes.body as { id: string }).id;

    // Load the agent's service user so we can build a valid principal.
    const agentRow = await prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
      select: { serviceUserId: true, name: true },
    });
    const serviceUser = await prisma.user.findUniqueOrThrow({
      where: { id: agentRow.serviceUserId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    principal = {
      agentId,
      name: agentRow.name,
      caps: {},
      autonomyLevel: AgentAutonomy.PROPOSE,
      user: {
        id: serviceUser.id,
        tenantId,
        email: serviceUser.email,
        firstName: serviceUser.firstName,
        lastName: serviceUser.lastName,
        permissions: ['core.email.send' as const],
      } as AgentPrincipal['user'],
    };

    // Wire only the email delegate; the rest are stubs (never called in these tests).
    services = {
      email: {
        draft: (tid: string, input: { prompt: string; context?: string }) =>
          aiDraftService.draft(tid, input),
        send: (tid: string, input: Parameters<MailService['queue']>[1], author: { agentId: string }) =>
          mailService.queue(tid, { ...input, agentId: author.agentId }),
      },
    } as unknown as ToolServices;

    // Clean up residual proposals from any previous interrupted run.
    await prisma.proposedAction.deleteMany({ where: { agentId } });
  });

  afterAll(async () => {
    if (agentId) {
      await prisma.proposedAction.deleteMany({ where: { agentId } }).catch(() => undefined);
      await request(http).delete(`/api/v1/agents/${agentId}`).set(auth()).catch(() => undefined);
    }
    await app.close();
  });

  // ── Registry contract ────────────────────────────────────────────────────

  it('draft_email is in TOOL_REGISTRY with tier LOW', () => {
    const def = TOOL_BY_NAME.get('draft_email');
    expect(def).toBeDefined();
    expect(def!.tier).toBe(RiskTier.LOW);
    expect(def!.permission).toBe('core.email.send');
    expect(def!.module).toBeUndefined();
  });

  it('send_email is in TOOL_REGISTRY with tier SENSITIVE', () => {
    const def = TOOL_BY_NAME.get('send_email');
    expect(def).toBeDefined();
    expect(def!.tier).toBe(RiskTier.SENSITIVE);
    expect(def!.permission).toBe('core.email.send');
    expect(def!.module).toBeUndefined();
  });

  // ── send_email → governance gate enqueues ProposedAction ─────────────────

  it('send_email: handleMutatingTool enqueues a PENDING ProposedAction and does NOT queue an EmailMessage', async () => {
    // Stub deliver to avoid fire-and-forget noise; we assert no message is created.
    const deliverSpy = jest.spyOn(mailService, 'deliver').mockResolvedValue(undefined);

    const def = TOOL_BY_NAME.get('send_email')!;
    const args = {
      to: 'recipient@example.com',
      subject: '[e2e-agent-tool] send_email governance',
      html: '<p>From agent governance test</p>',
    };

    const decision = await proposedActionsService.handleMutatingTool(
      principal,
      def,
      args,
      services,
    );

    deliverSpy.mockRestore();

    // Must be PROPOSE (agent is base-PROPOSE autonomy).
    expect(decision.effect).toBe('PROPOSE');
    expect(decision.proposalId).toBeTruthy();

    // DB: ProposedAction exists and is PENDING.
    const row = await prisma.proposedAction.findUniqueOrThrow({
      where: { id: decision.proposalId },
    });
    expect(row.status).toBe('PENDING');
    expect(row.tool).toBe('send_email');
    expect(row.riskTier).toBe(RiskTier.SENSITIVE);

    // No EmailMessage was created — the action was only proposed, not executed.
    const messages = await prisma.emailMessage.findMany({
      where: { tenantId, subject: '[e2e-agent-tool] send_email governance' },
    });
    expect(messages).toHaveLength(0);
  });

  // ── services.email.send wires to MailService.queue ───────────────────────

  it('services.email.send (direct) queues an EmailMessage with agentId set', async () => {
    const deliverSpy = jest.spyOn(mailService, 'deliver').mockResolvedValue(undefined);

    const msg = await services.email.send(
      tenantId,
      {
        toAddresses: ['direct-test@example.com'],
        subject: '[e2e-agent-tool] direct send wire',
        html: '<p>Direct wire test</p>',
      },
      { agentId: principal.agentId },
    ) as { id: string; status: string; agentId: string | null };

    deliverSpy.mockRestore();

    expect(msg.id).toBeTruthy();
    expect(msg.status).toBe('QUEUED');
    expect(msg.agentId).toBe(principal.agentId);

    // Clean up.
    await prisma.emailMessage.delete({ where: { id: msg.id } }).catch(() => undefined);
  });
});
