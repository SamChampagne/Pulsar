/**
 * E2E: Financial Reports — P&L / Balance Sheet / Cash Flow / AR Aging / AP Aging / Isolation
 *
 * Covers:
 *   1. Approve a customer invoice (AMOUNT_REV = 400) → ledgerAutoPost posts AR/Revenue GL.
 *      GET /billing/reports/profit-and-loss → totalRevenue >= AMOUNT_REV; netIncome = totalRevenue − totalExpense.
 *   2. GET /billing/reports/balance-sheet?asOf=far-future → balanced === true; totalAssets > 0 (AR present).
 *   3. Record a full payment on that invoice → GET /billing/reports/cash-flow → cash account (code 1000)
 *      appears in `accounts`; netChange > 0.
 *   4. Leave a second customer invoice APPROVED (unpaid) → GET /billing/reports/ar-aging →
 *      that customer appears in `rows`; grandTotal >= AMOUNT_AR.
 *   5. Approve a carrier invoice (AMOUNT_AP) unpaid → GET /billing/reports/ap-aging →
 *      that carrier appears in `rows`; grandTotal >= AMOUNT_AP.
 *   6. Tenant isolation: brand-new tenant with no activity → ar-aging grandTotal===0, ap-aging grandTotal===0,
 *      balance-sheet balanced===true with totalAssets===0 (or balanced), profit-and-loss netIncome===0.
 *
 * Note: use a wide date range (from=2000-01-01 / asOf=2999-12-31) so all posted GL is in scope.
 * Because other e2e suites may also post GL, we assert "includes our activity" (deltas / contains)
 * rather than exact absolute totals across the board — except for the isolation tenant which has no activity.
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
const suffix = `${Date.now()}-rpt`;

// Wide date range so all GL activity is in scope regardless of other suites.
const FROM = '2000-01-01';
const AS_OF = '2999-12-31';

// Amounts for this suite.
const AMOUNT_REV = 400;  // customer invoice paid via payment
const AMOUNT_AR = 250;   // customer invoice left unpaid (AR aging)
const AMOUNT_AP = 180;   // carrier invoice left unpaid (AP aging)

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let token = '';
let tenantId = '';

// Master data
let customerId = '';
let carrierId = '';
let modeOfPaymentId = '';

// Invoice / payment IDs for cleanup
const customerInvoiceIds: string[] = [];
const carrierInvoiceIds: string[] = [];
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

describe('Financial Reports (e2e)', () => {
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

    // Ensure billing + ledger permissions are assigned to the admin role.
    const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'admin' } });
    for (const [key, mod] of [
      ['billing.read', 'billing'],
      ['billing.manage', 'billing'],
      ['billing.ledger.read', 'billing'],
      ['billing.ledger.manage', 'billing'],
      ['billing.payments.read', 'billing'],
      ['billing.payments.manage', 'billing'],
    ]) {
      await ensurePermission(adminRole.id, key, mod);
    }

    // Re-login to get a fresh JWT that includes the newly assigned permissions.
    const loginRefresh = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (loginRefresh.body as { accessToken: string }).accessToken;

    // Ensure ledgerAutoPost is true and cash/bank account codes are set.
    await request(http)
      .put('/api/v1/modules/billing/settings')
      .set(auth())
      .send({ settings: { ledgerAutoPost: true, cashAccountCode: '1000' } })
      .expect(200);

    // Seed a customer.
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        code: `RPT-CUST-${suffix}`,
        name: `RPT Customer ${suffix}`,
        email: `rpt-cust-${suffix}@example.com`,
      },
    });
    customerId = customer.id;

    // Seed a carrier.
    const carrier = await prisma.carrier.create({
      data: {
        tenantId,
        code: `RPT-CARR-${suffix}`,
        name: `RPT Carrier ${suffix}`,
      },
    });
    carrierId = carrier.id;

    // Seed a mode of payment (reuse first seeded one, or create).
    const existingMode = await prisma.modeOfPayment.findFirst({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    if (existingMode) {
      modeOfPaymentId = existingMode.id;
    } else {
      const mode = await prisma.modeOfPayment.create({
        data: {
          tenantId,
          name: `RPT-MODE-${suffix}`,
          accountCode: '1000',
          isDefault: true,
        },
      });
      modeOfPaymentId = mode.id;
    }
  });

  afterAll(async () => {
    // Cleanup in dependency order: payments → invoices → master data.
    if (paymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } }).catch(() => undefined);
    }
    if (customerInvoiceIds.length > 0) {
      await prisma.customerInvoice
        .deleteMany({ where: { id: { in: customerInvoiceIds } } })
        .catch(() => undefined);
    }
    if (carrierInvoiceIds.length > 0) {
      await prisma.invoice
        .deleteMany({ where: { id: { in: carrierInvoiceIds } } })
        .catch(() => undefined);
    }
    await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    await prisma.carrier.deleteMany({ where: { id: carrierId } }).catch(() => undefined);
    await app?.close();
  });

  // ===========================================================================
  // Suite 1 — Profit & Loss: approve invoice → revenue appears
  // ===========================================================================
  describe('1. Profit & Loss: approved invoice drives revenue', () => {
    let invoicePaidId = '';

    beforeAll(async () => {
      // Create a DRAFT customer invoice (net AMOUNT_REV) → approve it → posts AR/Revenue GL.
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `RPT-CINV-REV-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: AMOUNT_REV,
          status: 'DRAFT',
        },
      });
      invoicePaidId = inv.id;
      customerInvoiceIds.push(invoicePaidId);

      // Approve → ledgerAutoPost fires: DR AR (1100) / CR Revenue (4000).
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoicePaidId}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
    });

    it('GET /billing/reports/profit-and-loss → totalRevenue >= AMOUNT_REV; netIncome = totalRevenue − totalExpense', async () => {
      const res = await request(http)
        .get('/api/v1/billing/reports/profit-and-loss')
        .query({ from: FROM, to: AS_OF })
        .set(auth())
        .expect(200);

      const body = res.body as {
        revenue: Array<{ code: string; name: string; amount: number }>;
        expense: Array<{ code: string; name: string; amount: number }>;
        totalRevenue: number;
        totalExpense: number;
        netIncome: number;
      };

      expect(typeof body.totalRevenue).toBe('number');
      expect(typeof body.totalExpense).toBe('number');
      expect(typeof body.netIncome).toBe('number');

      // Revenue must include at least AMOUNT_REV (other suites may add more).
      expect(Number(body.totalRevenue)).toBeGreaterThanOrEqual(AMOUNT_REV);

      // Revenue account 4000 must be present in the revenue lines.
      const rev4000 = body.revenue.find((l) => l.code === '4000');
      expect(rev4000).toBeDefined();
      expect(Number(rev4000!.amount)).toBeGreaterThanOrEqual(AMOUNT_REV);

      // netIncome must equal the difference.
      const expectedNet = Math.round((Number(body.totalRevenue) - Number(body.totalExpense)) * 100) / 100;
      expect(Number(body.netIncome)).toBeCloseTo(expectedNet, 2);
    });
  });

  // ===========================================================================
  // Suite 2 — Balance Sheet: balanced === true; assets > 0
  // ===========================================================================
  describe('2. Balance Sheet: balanced and assets present', () => {
    it('GET /billing/reports/balance-sheet?asOf=far-future → balanced===true; totalAssets > 0', async () => {
      const res = await request(http)
        .get('/api/v1/billing/reports/balance-sheet')
        .query({ asOf: AS_OF })
        .set(auth())
        .expect(200);

      const body = res.body as {
        assets: Array<{ code: string; name: string; amount: number }>;
        liabilities: Array<{ code: string; name: string; amount: number }>;
        equity: Array<{ code: string; name: string; amount: number }>;
        totalAssets: number;
        totalLiabilities: number;
        totalEquity: number;
        netIncome: number;
        balanced: boolean;
      };

      expect(body.balanced).toBe(true);
      // AR (1100) was posted — assets must be positive.
      expect(Number(body.totalAssets)).toBeGreaterThan(0);
      // AR account 1100 present in assets.
      const ar1100 = body.assets.find((a) => a.code === '1100');
      expect(ar1100).toBeDefined();
      expect(Number(ar1100!.amount)).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Suite 3 — Cash Flow: payment posts cash debit → netChange > 0
  // ===========================================================================
  describe('3. Cash Flow: payment on invoice reflected in cash account', () => {
    let invoicePaidId2 = '';
    let paymentId = '';

    beforeAll(async () => {
      // Create + approve another customer invoice.
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `RPT-CINV-CASH-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: AMOUNT_REV,
          status: 'DRAFT',
        },
      });
      invoicePaidId2 = inv.id;
      customerInvoiceIds.push(invoicePaidId2);

      await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoicePaidId2}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      // Create a RECEIVE payment for the full amount and submit it.
      const payRes = await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({
          type: 'RECEIVE',
          partyType: 'CUSTOMER',
          partyId: customerId,
          modeOfPaymentId,
          date: new Date().toISOString(),
          totalAmount: AMOUNT_REV,
          allocations: [
            { targetType: 'CUSTOMER_INVOICE', targetId: invoicePaidId2, amount: AMOUNT_REV },
          ],
        })
        .expect(201);

      paymentId = (payRes.body as { id: string }).id;
      paymentIds.push(paymentId);

      // Submit → posts DR Cash (1000) / CR AR (1100).
      await request(http)
        .post(`/api/v1/billing/payments/${paymentId}/submit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
    });

    it('GET /billing/reports/cash-flow → cash account (1000) present; netChange >= AMOUNT_REV', async () => {
      const res = await request(http)
        .get('/api/v1/billing/reports/cash-flow')
        .query({ from: FROM, to: AS_OF })
        .set(auth())
        .expect(200);

      const body = res.body as {
        accounts: Array<{ code: string; name: string; amount: number }>;
        netChange: number;
      };

      expect(Array.isArray(body.accounts)).toBe(true);
      // Cash account 1000 must appear (cashAccountCode=1000 set in beforeAll).
      const cash = body.accounts.find((a) => a.code === '1000');
      expect(cash).toBeDefined();
      // Payment debit on cash should be positive (net debit > 0).
      expect(Number(cash!.amount)).toBeGreaterThanOrEqual(AMOUNT_REV);
      // netChange must be > 0 (payments received exceed any disbursements in this test).
      expect(Number(body.netChange)).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Suite 4 — AR Aging: unpaid approved invoice appears in rows
  // ===========================================================================
  describe('4. AR Aging: unpaid approved invoice ages correctly', () => {
    let arInvoiceId = '';

    beforeAll(async () => {
      // Create + approve a customer invoice — leave it UNPAID.
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `RPT-CINV-AR-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: AMOUNT_AR,
          status: 'DRAFT',
        },
      });
      arInvoiceId = inv.id;
      customerInvoiceIds.push(arInvoiceId);

      await request(http)
        .post(`/api/v1/billing/customer-invoices/${arInvoiceId}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
    });

    it('GET /billing/reports/ar-aging?asOf=far-future → customer in rows; grandTotal >= AMOUNT_AR', async () => {
      const res = await request(http)
        .get('/api/v1/billing/reports/ar-aging')
        .query({ asOf: AS_OF })
        .set(auth())
        .expect(200);

      const body = res.body as {
        rows: Array<{
          partyId: string;
          partyName: string;
          buckets: Record<string, number>;
          total: number;
        }>;
        totals: Record<string, number>;
        grandTotal: number;
      };

      expect(Array.isArray(body.rows)).toBe(true);
      expect(typeof body.grandTotal).toBe('number');

      // Our customer must appear.
      const row = body.rows.find((r) => r.partyId === customerId);
      expect(row).toBeDefined();
      expect(Number(row!.total)).toBeGreaterThanOrEqual(AMOUNT_AR);

      // Grand total must include our outstanding.
      expect(Number(body.grandTotal)).toBeGreaterThanOrEqual(AMOUNT_AR);
    });
  });

  // ===========================================================================
  // Suite 5 — AP Aging: unpaid approved carrier invoice appears in rows
  // ===========================================================================
  describe('5. AP Aging: unpaid approved carrier invoice ages correctly', () => {
    let apInvoiceId = '';

    beforeAll(async () => {
      // Create a DRAFT carrier invoice directly via Prisma and approve it — leave it UNPAID.
      const inv = await prisma.invoice.create({
        data: {
          tenantId,
          invoiceNumber: `RPT-INV-AP-${suffix}`,
          carrierId,
          currency: 'CAD',
          totalAmount: AMOUNT_AP,
          status: 'DRAFT',
        },
      });
      apInvoiceId = inv.id;
      carrierInvoiceIds.push(apInvoiceId);

      // Approve via API → ledgerAutoPost fires: DR Expense (5000) / CR AP (2000).
      await request(http)
        .post(`/api/v1/billing/invoices/${apInvoiceId}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
    });

    it('GET /billing/reports/ap-aging?asOf=far-future → carrier in rows; grandTotal >= AMOUNT_AP', async () => {
      const res = await request(http)
        .get('/api/v1/billing/reports/ap-aging')
        .query({ asOf: AS_OF })
        .set(auth())
        .expect(200);

      const body = res.body as {
        rows: Array<{
          partyId: string;
          partyName: string;
          buckets: Record<string, number>;
          total: number;
        }>;
        totals: Record<string, number>;
        grandTotal: number;
      };

      expect(Array.isArray(body.rows)).toBe(true);
      expect(typeof body.grandTotal).toBe('number');

      // Our carrier must appear.
      const row = body.rows.find((r) => r.partyId === carrierId);
      expect(row).toBeDefined();
      expect(Number(row!.total)).toBeGreaterThanOrEqual(AMOUNT_AP);

      // Grand total must include our outstanding.
      expect(Number(body.grandTotal)).toBeGreaterThanOrEqual(AMOUNT_AP);
    });
  });

  // ===========================================================================
  // Suite 6 — Tenant isolation: brand-new tenant has zero activity
  // ===========================================================================
  describe('6. Tenant isolation: second tenant sees no acme figures', () => {
    let otherTenantId = '';
    let otherToken = '';
    let otherHttp: ReturnType<INestApplication['getHttpServer']>;

    beforeAll(async () => {
      // Create an isolated second tenant with its own admin user.
      const otherSlug = `rpt-iso-${suffix}`;
      const other = await prisma.tenant.create({
        data: { slug: otherSlug, name: `RPT Iso ${suffix}` },
      });
      otherTenantId = other.id;

      // Create an admin role for the second tenant.
      const adminRole2 = await prisma.role.create({
        data: { tenantId: otherTenantId, key: 'admin', name: 'Admin' },
      });

      // Ensure billing permissions exist (global table) and assign to new role.
      for (const [key, mod] of [
        ['billing.ledger.read', 'billing'],
        ['billing.ledger.manage', 'billing'],
        ['billing.payments.read', 'billing'],
        ['billing.payments.manage', 'billing'],
      ]) {
        const perm = await prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key, module: mod, description: `Permission: ${key}` },
        });
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: adminRole2.id, permissionId: perm.id } },
          update: {},
          create: { roleId: adminRole2.id, permissionId: perm.id },
        });
      }

      // Create an admin user for the second tenant.
      const { hashSync } = await import('bcryptjs');
      const otherUser = await prisma.user.create({
        data: {
          tenantId: otherTenantId,
          email: `rpt-admin-${suffix}@iso.example.com`,
          passwordHash: hashSync('admin123', 10),
          firstName: 'RPT',
          lastName: 'Admin',
          status: 'ACTIVE',
          roles: { create: [{ roleId: adminRole2.id }] },
        },
      });

      // Enable billing module for second tenant.
      const billingMod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'billing' } });
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId: otherTenantId, moduleId: billingMod.id } },
        update: { enabled: true },
        create: { tenantId: otherTenantId, moduleId: billingMod.id, enabled: true, enabledAt: new Date() },
      });

      // Log in as the second tenant's admin — use the same http server.
      otherHttp = http;
      const loginRes = await request(otherHttp)
        .post('/api/v1/auth/login')
        .send({ email: otherUser.email, password: 'admin123', tenant: otherSlug })
        .expect(200);
      otherToken = (loginRes.body as { accessToken: string }).accessToken;
    });

    afterAll(async () => {
      // Clean up isolation tenant: pre-delete GL rows (no cascade).
      await prisma.journalEntry.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => undefined);
      await prisma.chartOfAccount.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => undefined);
      // Then delete the tenant itself.
      await prisma.tenant.deleteMany({ where: { id: otherTenantId } }).catch(() => undefined);
    });

    it('6a. ar-aging grandTotal === 0 (no acme invoices)', async () => {
      const res = await request(otherHttp)
        .get('/api/v1/billing/reports/ar-aging')
        .query({ asOf: AS_OF })
        .set({ Authorization: `Bearer ${otherToken}` })
        .expect(200);

      const body = res.body as { grandTotal: number; rows: unknown[] };
      expect(Number(body.grandTotal)).toBe(0);
      expect(body.rows).toHaveLength(0);
    });

    it('6b. ap-aging grandTotal === 0 (no acme invoices)', async () => {
      const res = await request(otherHttp)
        .get('/api/v1/billing/reports/ap-aging')
        .query({ asOf: AS_OF })
        .set({ Authorization: `Bearer ${otherToken}` })
        .expect(200);

      const body = res.body as { grandTotal: number; rows: unknown[] };
      expect(Number(body.grandTotal)).toBe(0);
      expect(body.rows).toHaveLength(0);
    });

    it('6c. profit-and-loss netIncome === 0 (no GL for this tenant)', async () => {
      const res = await request(otherHttp)
        .get('/api/v1/billing/reports/profit-and-loss')
        .query({ from: FROM, to: AS_OF })
        .set({ Authorization: `Bearer ${otherToken}` })
        .expect(200);

      const body = res.body as { totalRevenue: number; totalExpense: number; netIncome: number };
      expect(Number(body.totalRevenue)).toBe(0);
      expect(Number(body.totalExpense)).toBe(0);
      expect(Number(body.netIncome)).toBe(0);
    });

    it('6d. balance-sheet balanced === true; totalAssets === 0 (no GL for this tenant)', async () => {
      const res = await request(otherHttp)
        .get('/api/v1/billing/reports/balance-sheet')
        .query({ asOf: AS_OF })
        .set({ Authorization: `Bearer ${otherToken}` })
        .expect(200);

      const body = res.body as { totalAssets: number; balanced: boolean };
      expect(body.balanced).toBe(true);
      expect(Number(body.totalAssets)).toBe(0);
    });
  });
});
