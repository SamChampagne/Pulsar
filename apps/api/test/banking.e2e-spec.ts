/**
 * E2E: Banking — bank accounts, CSV import, balance, reconciliation, match/unmatch, tenant isolation.
 *
 * Covers:
 *   1. POST /billing/bank-accounts (glAccountCode 1010) → 201; GET list masks accountNumber.
 *   2. POST /billing/bank-transactions/import with 2 CSV lines → { imported: 2, errors: [] }.
 *   3. GET /billing/bank-accounts/:id/balance → { balance: 88.5, txnCount: 2 }.
 *   4. Create + submit a Payment via the "Banque" mode (accountCode 1010).
 *   5. GET /billing/bank-transactions/reconciliation?bankAccountId= → candidatePayments contains the payment.
 *   6. POST /billing/bank-transactions/:txnId/match { paymentId } → txn RECONCILED; payment.reconciledAt set.
 *   7. POST /billing/bank-transactions/:txnId/unmatch → txn back to UNRECONCILED; payment.reconciledAt null.
 *   8. Tenant isolation: second tenant 404 on first tenant's bank account.
 *
 * Prerequisites: running Postgres, db:migrate + db:seed applied.
 */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentsService } from '../src/core/agents/agents.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';

// ---------------------------------------------------------------------------
// Stub — keeps the app bootable without a real Hermes process
// ---------------------------------------------------------------------------
@Injectable()
class FakeAgentRuntimeService {
  constructor(private readonly _agents: AgentsService) {}
  async openSession(): Promise<string> { return 'fake-session'; }
  async *sendTurn(): AsyncGenerator<never> { /* no turns */ }
  async closeSession(): Promise<void> { /* no-op */ }
  async killAgentSessions(): Promise<void> { /* no-op */ }
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const suffix = `${Date.now()}-bnk`;

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let token = '';
let tenantId = '';

// Master data
let customerId = '';

// Cleanup tracking
const bankAccountIds: string[] = [];
const customerInvoiceIds: string[] = [];
const paymentIds: string[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const auth = () => ({ Authorization: `Bearer ${token}` });

async function enableModule(key: string) {
  const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
  await prisma.tenantModule.upsert({
    where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
    update: { enabled: true },
    create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
  });
}

async function ensurePermission(adminRoleId: string, key: string, module: string) {
  const perm = await prisma.permission.upsert({
    where: { key },
    update: {},
    create: { key, module, description: `Permission: ${key}` },
  });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: adminRoleId, permissionId: perm.id } },
    update: {},
    create: { roleId: adminRoleId, permissionId: perm.id },
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

describe('Banking (e2e)', () => {
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

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    await enableModule('billing');

    // Ensure ledger + payment permissions are assigned to the admin role.
    const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'admin' } });
    for (const [key, module] of [
      ['billing.ledger.read', 'billing'],
      ['billing.ledger.manage', 'billing'],
      ['billing.payments.read', 'billing'],
      ['billing.payments.manage', 'billing'],
    ] as [string, string][]) {
      await ensurePermission(adminRole.id, key, module);
    }

    // Re-login to get a fresh JWT with the newly assigned permissions.
    const loginRefresh = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (loginRefresh.body as { accessToken: string }).accessToken;

    // Ensure ledger auto-post is on.
    await request(http)
      .put('/api/v1/modules/billing/settings')
      .set(auth())
      .send({ settings: { ledgerAutoPost: true } })
      .expect(200);

    // Seed a customer for invoice creation.
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        code: `BNK-CUST-${suffix}`,
        name: `Bank Customer ${suffix}`,
        email: `bnk-cust-${suffix}@example.com`,
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    // Cleanup in dependency order: payments → invoices → bank accounts → customer.
    if (paymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } }).catch(() => undefined);
    }
    if (customerInvoiceIds.length > 0) {
      await prisma.customerInvoice
        .deleteMany({ where: { id: { in: customerInvoiceIds } } })
        .catch(() => undefined);
    }
    if (bankAccountIds.length > 0) {
      await prisma.bankAccount.deleteMany({ where: { id: { in: bankAccountIds } } }).catch(() => undefined);
    }
    await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    await app?.close();
  });

  // ===========================================================================
  // Suite 1 — Create bank account + list (masked accountNumber)
  // ===========================================================================
  describe('Create bank account + list', () => {
    let bankAccountId = '';

    it('1a. POST /billing/bank-accounts with glAccountCode 1010 → 201', async () => {
      const res = await request(http)
        .post('/api/v1/billing/bank-accounts')
        .set(auth())
        .send({
          name: `BNK-ACCT-${suffix}`,
          accountNumber: '1234567890',
          glAccountCode: '1010',
          currency: 'CAD',
        })
        .expect(201);

      const body = res.body as { id: string; glAccountCode: string };
      expect(body.id).toBeTruthy();
      expect(body.glAccountCode).toBe('1010');
      bankAccountId = body.id;
      bankAccountIds.push(bankAccountId);
    });

    it('1b. GET /billing/bank-accounts list masks accountNumber', async () => {
      const res = await request(http)
        .get('/api/v1/billing/bank-accounts')
        .set(auth())
        .expect(200);

      const items = res.body as Array<{ id: string; accountNumber: string }>;
      const acct = items.find((a) => a.id === bankAccountId);
      expect(acct).toBeDefined();
      // maskAccountNumber shows "•••• XXXX" format (last 4 digits only)
      expect(acct!.accountNumber).toMatch(/^•••• /);
      expect(acct!.accountNumber).toBe('•••• 7890');
    });
  });

  // ===========================================================================
  // Suite 2 — CSV import + balance
  // ===========================================================================
  describe('CSV import + balance', () => {
    let bankAccountId = '';

    beforeAll(async () => {
      // Create a fresh bank account for these tests.
      const res = await request(http)
        .post('/api/v1/billing/bank-accounts')
        .set(auth())
        .send({
          name: `BNK-IMPORT-${suffix}`,
          accountNumber: '9876543210',
          glAccountCode: '1010',
          currency: 'CAD',
        })
        .expect(201);
      bankAccountId = (res.body as { id: string }).id;
      bankAccountIds.push(bankAccountId);
    });

    it('2. POST /billing/bank-transactions/import with 2 CSV lines → { imported: 2, errors: [] }', async () => {
      const csv = 'date,description,amount\n2026-01-05,Depot,100.50\n2026-01-06,Frais,-12.00';

      const res = await request(http)
        .post('/api/v1/billing/bank-transactions/import')
        .set(auth())
        .send({ bankAccountId, csv })
        .expect(201);

      const body = res.body as { imported: number; errors: string[] };
      expect(body.imported).toBe(2);
      expect(body.errors).toEqual([]);
    });

    it('3. GET /billing/bank-accounts/:id/balance → balance 88.5, txnCount 2', async () => {
      const res = await request(http)
        .get(`/api/v1/billing/bank-accounts/${bankAccountId}/balance`)
        .set(auth())
        .expect(200);

      const body = res.body as { balance: number; txnCount: number };
      expect(body.balance).toBeCloseTo(88.5, 2);
      expect(body.txnCount).toBe(2);
    });
  });

  // ===========================================================================
  // Suite 3 — Reconciliation: match / unmatch
  // ===========================================================================
  describe('Reconciliation: match and unmatch', () => {
    let bankAccountId = '';
    let txnId = '';
    let paymentId = '';
    let modeOfPaymentId = '';

    beforeAll(async () => {
      // Find the "Banque" mode of payment with accountCode 1010 (seeded).
      const modesRes = await request(http)
        .get('/api/v1/billing/modes-of-payment')
        .set(auth())
        .expect(200);

      const modes = modesRes.body as Array<{ id: string; accountCode: string }>;
      const banqueMode = modes.find((m) => m.accountCode === '1010');
      expect(banqueMode).toBeDefined();
      modeOfPaymentId = banqueMode!.id;

      // Create a bank account with glAccountCode 1010.
      const acctRes = await request(http)
        .post('/api/v1/billing/bank-accounts')
        .set(auth())
        .send({
          name: `BNK-RECON-${suffix}`,
          accountNumber: '5556667778',
          glAccountCode: '1010',
          currency: 'CAD',
        })
        .expect(201);
      bankAccountId = (acctRes.body as { id: string }).id;
      bankAccountIds.push(bankAccountId);

      // Import 1 transaction into this account.
      const csv = 'date,description,amount\n2026-01-10,Virement,200.00';
      await request(http)
        .post('/api/v1/billing/bank-transactions/import')
        .set(auth())
        .send({ bankAccountId, csv })
        .expect(201);

      // Get the transaction ID.
      const txnListRes = await request(http)
        .get(`/api/v1/billing/bank-transactions?bankAccountId=${bankAccountId}`)
        .set(auth())
        .expect(200);
      const txns = txnListRes.body as Array<{ id: string; status: string }>;
      expect(txns.length).toBe(1);
      txnId = txns[0].id;

      // Create an approved customer invoice (direct Prisma).
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `BNK-CINV-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: 200,
          status: 'DRAFT',
        },
      });
      customerInvoiceIds.push(inv.id);

      // Approve via API.
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${inv.id}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      // Create + submit a RECEIVE payment via the Banque mode (accountCode 1010).
      const payRes = await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({
          type: 'RECEIVE',
          partyType: 'CUSTOMER',
          partyId: customerId,
          modeOfPaymentId,
          date: new Date().toISOString(),
          totalAmount: 200,
          allocations: [
            { targetType: 'CUSTOMER_INVOICE', targetId: inv.id, amount: 200 },
          ],
        })
        .expect(201);

      paymentId = (payRes.body as { id: string }).id;
      paymentIds.push(paymentId);

      // Submit the payment (DRAFT → SUBMITTED).
      await request(http)
        .post(`/api/v1/billing/payments/${paymentId}/submit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
    });

    it('5. GET reconciliation?bankAccountId= → payment appears in candidatePayments', async () => {
      const res = await request(http)
        .get(`/api/v1/billing/bank-transactions/reconciliation?bankAccountId=${bankAccountId}`)
        .set(auth())
        .expect(200);

      const body = res.body as {
        unreconciledTransactions: Array<{ id: string }>;
        candidatePayments: Array<{ id: string; modeOfPayment: { accountCode: string } }>;
      };

      // The imported transaction should be in unreconciledTransactions.
      expect(body.unreconciledTransactions.some((t) => t.id === txnId)).toBe(true);

      // The submitted payment should appear in candidatePayments.
      const candidate = body.candidatePayments.find((p) => p.id === paymentId);
      expect(candidate).toBeDefined();
      expect(candidate!.modeOfPayment.accountCode).toBe('1010');
    });

    it('6a. POST :txnId/match { paymentId } → txn becomes RECONCILED', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/bank-transactions/${txnId}/match`)
        .set(auth())
        .send({ paymentId })
        .expect(201);

      const body = res.body as { id: string; status: string; matchedPaymentId: string };
      expect(body.status).toBe('RECONCILED');
      expect(body.matchedPaymentId).toBe(paymentId);
    });

    it('6b. GET /billing/payments/:id shows reconciledAt set', async () => {
      const res = await request(http)
        .get(`/api/v1/billing/payments/${paymentId}`)
        .set(auth())
        .expect(200);

      const body = res.body as { id: string; reconciledAt: string | null };
      expect(body.reconciledAt).not.toBeNull();
      expect(typeof body.reconciledAt).toBe('string');
    });

    it('7a. POST :txnId/unmatch → txn back to UNRECONCILED', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/bank-transactions/${txnId}/unmatch`)
        .set(auth())
        .expect(201);

      const body = res.body as { id: string; status: string; matchedPaymentId: string | null };
      expect(body.status).toBe('UNRECONCILED');
      expect(body.matchedPaymentId).toBeNull();
    });

    it('7b. After unmatch, payment.reconciledAt is null', async () => {
      const res = await request(http)
        .get(`/api/v1/billing/payments/${paymentId}`)
        .set(auth())
        .expect(200);

      const body = res.body as { id: string; reconciledAt: string | null };
      expect(body.reconciledAt).toBeNull();
    });
  });

  // ===========================================================================
  // Suite 4 — Tenant isolation: second tenant cannot read first tenant's bank account
  // ===========================================================================
  describe('Tenant isolation', () => {
    let otherTenantId = '';
    let otherToken = '';
    let targetBankAccountId = '';

    beforeAll(async () => {
      // Create a bank account in the first tenant.
      const acctRes = await request(http)
        .post('/api/v1/billing/bank-accounts')
        .set(auth())
        .send({
          name: `BNK-ISO-${suffix}`,
          glAccountCode: '1010',
          currency: 'CAD',
        })
        .expect(201);
      targetBankAccountId = (acctRes.body as { id: string }).id;
      bankAccountIds.push(targetBankAccountId);

      // Create a second tenant + admin user via Prisma.
      const otherSlug = `bnk-iso-${suffix}`;
      const otherEmail = `bnk-iso-${suffix}@example.test`;
      const other = await prisma.tenant.create({
        data: { slug: otherSlug, name: `Bank Iso ${suffix}` },
      });
      otherTenantId = other.id;

      // Enable billing for the other tenant.
      const billingMod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'billing' } });
      await prisma.tenantModule.create({
        data: { tenantId: otherTenantId, moduleId: billingMod.id, enabled: true, enabledAt: new Date() },
      });

      // Create billing.ledger.read permission on the other role.
      const ledgerReadPerm = await prisma.permission.findUniqueOrThrow({
        where: { key: 'billing.ledger.read' },
      });
      const otherRole = await prisma.role.create({
        data: {
          tenantId: otherTenantId,
          key: 'admin',
          name: 'Admin',
          isSystem: true,
          permissions: { create: [{ permissionId: ledgerReadPerm.id }] },
        },
      });

      const { hashSync } = await import('bcryptjs');
      await prisma.user.create({
        data: {
          tenantId: otherTenantId,
          email: otherEmail,
          passwordHash: hashSync('Test1234!', 10),
          firstName: 'Other',
          lastName: 'Admin',
          status: 'ACTIVE',
          roles: { create: [{ roleId: otherRole.id }] },
        },
      });

      const otherLogin = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: otherEmail, password: 'Test1234!', tenant: otherSlug })
        .expect(200);
      otherToken = (otherLogin.body as { accessToken: string }).accessToken;
    });

    afterAll(async () => {
      await prisma.tenant.deleteMany({ where: { id: otherTenantId } }).catch(() => undefined);
    });

    it('8. Other-tenant token gets 404 on GET /billing/bank-accounts/:id of first tenant', async () => {
      await request(http)
        .get(`/api/v1/billing/bank-accounts/${targetBankAccountId}`)
        .set({ Authorization: `Bearer ${otherToken}` })
        .expect(404);
    });
  });
});
