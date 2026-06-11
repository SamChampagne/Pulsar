/**
 * E2E for phase 7.4 — security hardening: MFA lifecycle (opt-in enrollment,
 * step-token login, one-shot recovery), step-token rejection on platform routes,
 * wrong-code rejection, CSV formula-injection guard, and throttle gate.
 *
 * Prerequisites: reachable PostgreSQL with the seed applied.
 *
 * Test order matters for two reasons:
 *  1. MFA tests share a dedicated PlatformUser created in beforeAll; the enrollment
 *     state is mutated across tests (enrolled in test 1, re-used in 2-4).
 *  2. The throttle test (last) exhausts the shared 20/min/IP ThrottlerGuard budget.
 *     It fires up to 25 bad-password attempts and then waits 61 s (timeout 90 s) so
 *     the sliding window resets before any later suite logs in.
 *
 * The SEEDED platform admin (platform@pulsar.dev) is NEVER enrolled in MFA here —
 * phase6-platform.e2e-spec.ts relies on plain login with that account and runs in
 * the same pnpm test:e2e process.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { hash } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Phase 7.4 — security hardening (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;

  // Dedicated MFA test user — never the seeded platform admin.
  const suffix = `p74${Date.now().toString(36)}`;
  const mfaUserEmail = `${suffix}-mfa@platform.test`;
  const mfaUserPassword = 'Mfa-Test-P@ss1';
  let mfaUserId = '';

  // Persisted across tests after enrollment in test 1.
  let recoveryCodes: string[] = [];
  let enrolledSecret = '';

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

    // Insert the dedicated MFA test user directly via Prisma.
    const created = await prisma.platformUser.create({
      data: {
        email: mfaUserEmail,
        passwordHash: await hash(mfaUserPassword, 10),
        firstName: 'MFA',
        lastName: 'Tester',
        status: 'ACTIVE',
      },
    });
    mfaUserId = created.id;
  });

  afterAll(async () => {
    // Clean up the dedicated MFA user.
    await prisma.platformUser.delete({ where: { id: mfaUserId } }).catch(() => {
      /* already gone — ignore */
    });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. Opt-in enrollment
  // ---------------------------------------------------------------------------
  it('opt-in enrollment: login → enroll-start → enroll → 8 recovery codes + accessToken', async () => {
    // Step 1: Login without MFA — should return plain accessToken (not enrolled yet).
    const loginRes = await request(http)
      .post('/api/v1/platform/auth/login')
      .send({ email: mfaUserEmail, password: mfaUserPassword })
      .expect(200);
    expect(loginRes.body.accessToken).toBeDefined();
    expect(loginRes.body.mfaRequired).toBeUndefined();
    const accessToken = loginRes.body.accessToken as string;

    // Step 2: enroll-start — authenticated endpoint, returns enrollToken + otpauthUrl.
    const startRes = await request(http)
      .post('/api/v1/platform/auth/mfa/enroll-start')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(201);
    expect(startRes.body.enrollToken).toBeDefined();
    expect(startRes.body.otpauthUrl).toContain('otpauth://totp/');
    const { enrollToken, otpauthUrl } = startRes.body as { enrollToken: string; otpauthUrl: string };

    // Step 3: Extract the TOTP secret from the otpauthUrl.
    const secret = new URL(otpauthUrl).searchParams.get('secret');
    expect(secret).toBeTruthy();
    enrolledSecret = secret!;

    // Step 4: Confirm enrollment with a live TOTP code.
    const enrollRes = await request(http)
      .post('/api/v1/platform/auth/mfa/enroll')
      .send({ enrollToken, code: authenticator.generate(enrolledSecret) })
      .expect(200);
    expect(enrollRes.body.recoveryCodes).toHaveLength(8);
    expect(enrollRes.body.accessToken).toBeDefined();
    recoveryCodes = enrollRes.body.recoveryCodes as string[];
  });

  // ---------------------------------------------------------------------------
  // 2. Step-token login: MFA required path + step-token rejection
  // ---------------------------------------------------------------------------
  it('step login: login → {mfaRequired, mfaToken}; verify → accessToken; mfaToken rejected on platform route', async () => {
    // Login now returns a step token (MFA enrolled).
    const loginRes = await request(http)
      .post('/api/v1/platform/auth/login')
      .send({ email: mfaUserEmail, password: mfaUserPassword })
      .expect(200);
    expect(loginRes.body.mfaRequired).toBe(true);
    expect(loginRes.body.mfaToken).toBeDefined();
    expect(loginRes.body.accessToken).toBeUndefined();
    const mfaToken = loginRes.body.mfaToken as string;

    // The raw step token (scope=mfa-pending) must be rejected by platform routes.
    await request(http)
      .get('/api/v1/platform/tenants')
      .set({ Authorization: `Bearer ${mfaToken}` })
      .expect(401);

    // Verify with a live TOTP → full access token.
    const verifyRes = await request(http)
      .post('/api/v1/platform/auth/mfa/verify')
      .send({ mfaToken, code: authenticator.generate(enrolledSecret) })
      .expect(200);
    expect(verifyRes.body.accessToken).toBeDefined();
    const accessToken = verifyRes.body.accessToken as string;

    // The access token must be accepted on a platform route.
    await request(http)
      .get('/api/v1/platform/tenants')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(200);
  });

  // ---------------------------------------------------------------------------
  // 3. Recovery one-shot: first use succeeds, repeat use fails
  // ---------------------------------------------------------------------------
  it('recovery one-shot: first use → accessToken; same code again → 401', async () => {
    // Login 1 → get step token.
    const login1 = await request(http)
      .post('/api/v1/platform/auth/login')
      .send({ email: mfaUserEmail, password: mfaUserPassword })
      .expect(200);
    const mfaToken1 = login1.body.mfaToken as string;

    // Use recovery code[0] → should succeed.
    const verifyRes = await request(http)
      .post('/api/v1/platform/auth/mfa/verify')
      .send({ mfaToken: mfaToken1, code: recoveryCodes[0] })
      .expect(200);
    expect(verifyRes.body.accessToken).toBeDefined();

    // Login 2 → get a fresh step token.
    const login2 = await request(http)
      .post('/api/v1/platform/auth/login')
      .send({ email: mfaUserEmail, password: mfaUserPassword })
      .expect(200);
    const mfaToken2 = login2.body.mfaToken as string;

    // Re-use the same recovery code → must fail (consumed).
    await request(http)
      .post('/api/v1/platform/auth/mfa/verify')
      .send({ mfaToken: mfaToken2, code: recoveryCodes[0] })
      .expect(401);
  });

  // ---------------------------------------------------------------------------
  // 4. Wrong TOTP code → 401
  // ---------------------------------------------------------------------------
  it('wrong TOTP code → 401', async () => {
    const loginRes = await request(http)
      .post('/api/v1/platform/auth/login')
      .send({ email: mfaUserEmail, password: mfaUserPassword })
      .expect(200);
    const mfaToken = loginRes.body.mfaToken as string;

    await request(http)
      .post('/api/v1/platform/auth/mfa/verify')
      .send({ mfaToken, code: '000000' })
      .expect(401);
  });

  // ---------------------------------------------------------------------------
  // 5. CSV formula-injection guard
  //    Full buy-side flow: carrier + load → reconciled invoice → export.csv
  //    with carrierInvoiceNumber starting with '=' — assert cell is prefixed with '
  // ---------------------------------------------------------------------------
  it('CSV guard: formula-injection in carrierInvoiceNumber is prefixed in export', async () => {
    // Login as the tenant admin (acme).
    const tenantLogin = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    const token = tenantLogin.body.accessToken as string;
    const auth = () => ({ Authorization: `Bearer ${token}` });

    // Ensure billing module is enabled.
    await request(http).patch('/api/v1/modules/billing').set(auth()).send({ enabled: true });

    const csvSuffix = `P74CSV${Date.now().toString(36).toUpperCase()}`;

    // Create master data.
    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${csvSuffix}-CUST`, name: 'CSV Guard Customer' })
      .expect(201);
    const origin = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${csvSuffix}-ORI`,
        name: 'CSV Origin',
        type: 'WAREHOUSE',
        addressLine1: '1 CSV St',
        city: 'Quebec',
      })
      .expect(201);
    const destination = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${csvSuffix}-DST`,
        name: 'CSV Destination',
        type: 'WAREHOUSE',
        addressLine1: '2 CSV Ave',
        city: 'Montreal',
      })
      .expect(201);
    const carrier = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: `${csvSuffix}-CARR`, name: 'CSV Carrier' })
      .expect(201);
    const rate = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({ name: `${csvSuffix} flat`, rateType: 'FLAT', baseAmount: 500, carrierId: carrier.body.id })
      .expect(201);

    // Run one transport order through to COMPLETED.
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: customer.body.id,
        originLocationId: origin.body.id,
        destinationLocationId: destination.body.id,
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    const shipmentId = planned.body.shipments[0].id;
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
      .set(auth())
      .send({ loadId: load.body.id })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/assign`)
      .set(auth())
      .send({ carrierId: carrier.body.id, rateId: rate.body.id })
      .expect(201);
    for (const verb of ['dispatch', 'start-transit', 'complete']) {
      await request(http)
        .post(`/api/v1/transportation/loads/${load.body.id}/${verb}`)
        .set(auth())
        .expect(201);
    }

    // Draft an invoice.
    const invoice = await request(http)
      .post('/api/v1/billing/invoices/draft')
      .set(auth())
      .send({ carrierId: carrier.body.id })
      .expect(201);

    // Reconcile with a formula-injection value in carrierInvoiceNumber.
    const injectionValue = '=2+2';
    await request(http)
      .post(`/api/v1/billing/invoices/${invoice.body.id}/reconcile`)
      .set(auth())
      .send({
        carrierInvoiceNumber: injectionValue,
        lines: [{ lineId: invoice.body.lines[0].id, invoicedAmount: 500 }],
      })
      .expect(201);

    // Export as CSV and assert the injection value is prefixed with a single quote.
    const csvRes = await request(http)
      .get('/api/v1/billing/invoices/export.csv')
      .set(auth())
      .expect(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    // The csvSafe guard prepends ' to any value starting with = + - @ or tab.
    expect(csvRes.text).toContain(`'${injectionValue}`);
    // Sanity: raw injection value must NOT appear unguarded.
    const lines = csvRes.text.split('\n');
    const dataLines = lines.slice(1); // skip header
    const hasUnguarded = dataLines.some(
      (line) => line.includes(`,${injectionValue},`) || line.includes(`,${injectionValue}`),
    );
    expect(hasUnguarded).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 6. Throttling — MUST be last (consumes the shared IP budget)
  //    Fire bad-password attempts until 429; wait 61 s to reset the window.
  // ---------------------------------------------------------------------------
  it(
    'throttling: repeated bad logins → 429 (then wait 61 s for window reset)',
    async () => {
      // Use a non-existent email so we never accidentally consume the MFA user's
      // valid login budget.  The ThrottlerGuard is per-IP so email doesn't matter.
      const fakeEmail = `no-such-user-${suffix}@throttle.test`;
      let got429 = false;
      const maxAttempts = 25;

      for (let i = 0; i < maxAttempts; i++) {
        const res = await request(http)
          .post('/api/v1/platform/auth/login')
          .send({ email: fakeEmail, password: 'wrong' });
        if (res.status === 429) {
          got429 = true;
          break;
        }
        // Expect either 401 (bad credentials) or 429.
        expect([401, 429]).toContain(res.status);
      }

      expect(got429).toBe(true);

      // Wait for the throttle window to reset so suites that run after this one
      // (alphabetically later) don't inherit a depleted IP budget.
      await new Promise<void>((r) => setTimeout(r, 61_000));
    },
    90_000, // Jest test timeout: 90 s
  );
});
