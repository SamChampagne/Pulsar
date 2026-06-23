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
 *
 * Prerequisites: running, seeded PostgreSQL (pnpm db:seed).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailService } from '../src/core/email/email.service';

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
