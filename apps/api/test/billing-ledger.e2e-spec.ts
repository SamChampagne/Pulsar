/**
 * E2E: Billing General Ledger — chart of accounts, auto-post on approve/pay,
 * idempotence, trial-balance, unbalanced 400, SO-sourced free lines, tenant isolation.
 *
 * Approve path chosen: direct Prisma insertion of a DRAFT CustomerInvoice
 * (mirrors billing-configurable.e2e-spec.ts). ledgerAutoPost defaults to true
 * (packages/shared/src/config/module-settings.ts line 129).
 *
 * SO-sourced lines: SalesOrder + CrmCompany + Customer created via Prisma directly,
 * then createDraftFromSalesOrder() called on the service instance.
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
import { CustomerInvoicesService } from '../src/modules/billing/customer-invoices.service';

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
const suffix = `${Date.now()}-bgl`;

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let token = '';
let tenantId = '';

// Master data
let customerId = '';

// Invoice IDs for cleanup
const invoiceIds: string[] = [];

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

async function putBillingSettings(settings: Record<string, unknown>) {
  await request(http)
    .put('/api/v1/modules/billing/settings')
    .set(auth())
    .send({ settings })
    .expect(200);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

describe('Billing General Ledger (e2e)', () => {
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
    await enableModule('crm');

    // Ensure ledger permissions exist and are assigned to the admin role.
    // The seed does this globally, but may pre-date the addition of these permission keys.
    const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'admin' } });
    for (const key of ['billing.ledger.read', 'billing.ledger.manage']) {
      const perm = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, module: 'billing', description: `Ledger permission: ${key}` },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: adminRole.id, permissionId: perm.id },
      });
    }

    // Re-login to get a fresh JWT that includes the newly assigned ledger permissions.
    const loginRefresh = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (loginRefresh.body as { accessToken: string }).accessToken;

    // Ensure ledgerAutoPost is true (it defaults to true, but be explicit).
    await putBillingSettings({ ledgerAutoPost: true });

    // Seed a customer (with email so send() works).
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        code: `BGL-CUST-${suffix}`,
        name: `BGL Customer ${suffix}`,
        email: `bgl-${suffix}@example.com`,
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    // Clean up invoices (cascades lines).
    if (invoiceIds.length > 0) {
      await prisma.customerInvoice.deleteMany({ where: { id: { in: invoiceIds } } }).catch(() => undefined);
    }
    // Clean up chart of accounts seeded for this tenant (avoid test pollution across suites).
    // We leave them — ensureChart is idempotent and seeding them won't break other tests.
    await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    await putBillingSettings({ ledgerAutoPost: true }).catch(() => undefined);
    await app?.close();
  });

  // ===========================================================================
  // Suite 1 — Chart of accounts (default seed)
  // ===========================================================================
  describe('Chart of accounts', () => {
    it('GET /billing/ledger/accounts seeds and returns default chart (codes 1000/1100/2000/4000/5000)', async () => {
      const res = await request(http)
        .get('/api/v1/billing/ledger/accounts')
        .set(auth())
        .expect(200);

      const accounts = res.body as { code: string }[];
      expect(accounts.length).toBeGreaterThanOrEqual(5);
      const codes = accounts.map((a) => a.code);
      for (const expected of ['1000', '1100', '2000', '4000', '5000']) {
        expect(codes).toContain(expected);
      }
    });
  });

  // ===========================================================================
  // Suite 2 — Auto-post on approve: DR AR / CR Revenue
  // ===========================================================================
  describe('Auto-post: approve → DR AR (1100) / CR Revenue (4000)', () => {
    let invoiceId = '';
    const AMOUNT = 500;

    beforeAll(async () => {
      // Insert a DRAFT invoice directly via Prisma (no TMS pipeline needed).
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `BGL-CINV-APR-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: AMOUNT,
          status: 'DRAFT',
        },
      });
      invoiceId = inv.id;
      invoiceIds.push(invoiceId);
    });

    it('approve → status APPROVED', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceId}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('APPROVED');
    });

    it('a balanced JournalEntry (sourceKind=approved) exists: DR AR / CR Revenue = totalAmount', async () => {
      const entry = await prisma.journalEntry.findFirst({
        where: { tenantId, sourceType: 'customer-invoice', sourceId: invoiceId, sourceKind: 'approved' },
        include: { lines: { include: { account: true } } },
      });
      expect(entry).not.toBeNull();
      // Must be balanced.
      const totalDebit = entry!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = entry!.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(totalDebit).toBe(AMOUNT);
      expect(totalCredit).toBe(AMOUNT);
      // Check sides: AR (1100) is DR, Revenue (4000) is CR.
      const arLine = entry!.lines.find((l) => l.account.code === '1100');
      const revLine = entry!.lines.find((l) => l.account.code === '4000');
      expect(arLine).toBeDefined();
      expect(Number(arLine!.debit)).toBe(AMOUNT);
      expect(revLine).toBeDefined();
      expect(Number(revLine!.credit)).toBe(AMOUNT);
    });

    it('re-approving (idempotence) does not double-post: journalEntry count stable', async () => {
      // Re-approve should return 400 (invoice is no longer DRAFT).
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceId}/approve`)
        .set(auth())
        .expect(400);

      const count = await prisma.journalEntry.count({
        where: { tenantId, sourceType: 'customer-invoice', sourceId: invoiceId, sourceKind: 'approved' },
      });
      expect(count).toBe(1);
    });
  });

  // ===========================================================================
  // Suite 3 — Auto-post on pay: DR Cash (1000) / CR AR (1100)
  // ===========================================================================
  describe('Auto-post: pay → DR Cash (1000) / CR AR (1100)', () => {
    let invoiceId = '';
    const AMOUNT = 300;

    beforeAll(async () => {
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `BGL-CINV-PAY-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: AMOUNT,
          status: 'DRAFT',
        },
      });
      invoiceId = inv.id;
      invoiceIds.push(invoiceId);

      // Approve first.
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceId}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      // Send (required before pay; customer has email so this works with EMAIL_DRIVER=log).
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceId}/send`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
    });

    it('pay → status PAID', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceId}/pay`)
        .set(auth())
        .send({})
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('PAID');
    });

    it('a balanced JournalEntry (sourceType=payment) exists: DR Cash / CR AR = totalAmount', async () => {
      // Task 8 routed markPaid through PaymentsService: GL is now posted under
      // sourceType='payment' (keyed by the payment's id), not 'customer-invoice'/'paid'.
      // Find the payment created for this invoice via its allocation.
      const alloc = await prisma.paymentAllocation.findFirst({
        where: { tenantId, targetType: 'CUSTOMER_INVOICE', targetId: invoiceId },
        select: { paymentId: true },
      });
      expect(alloc).not.toBeNull();

      const entry = await prisma.journalEntry.findFirst({
        where: { tenantId, sourceType: 'payment', sourceId: alloc!.paymentId },
        include: { lines: { include: { account: true } } },
      });
      expect(entry).not.toBeNull();

      const totalDebit = entry!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = entry!.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(totalDebit).toBe(AMOUNT);
      expect(totalCredit).toBe(AMOUNT);

      const cashLine = entry!.lines.find((l) => l.account.code === '1000');
      const arLine = entry!.lines.find((l) => l.account.code === '1100');
      expect(cashLine).toBeDefined();
      expect(Number(cashLine!.debit)).toBe(AMOUNT);
      expect(arLine).toBeDefined();
      expect(Number(arLine!.credit)).toBe(AMOUNT);
    });

    it('re-paying does not double-post: journalEntry count for this payment stable at 1', async () => {
      // Re-pay should return 400 (invoice is no longer SENT after markPaid).
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceId}/pay`)
        .set(auth())
        .send({})
        .expect(400);

      // The payment created by markPaid has exactly 1 GL entry (no re-post on re-pay attempt).
      const alloc = await prisma.paymentAllocation.findFirst({
        where: { tenantId, targetType: 'CUSTOMER_INVOICE', targetId: invoiceId },
        select: { paymentId: true },
      });
      const count = await prisma.journalEntry.count({
        where: { tenantId, sourceType: 'payment', sourceId: alloc?.paymentId ?? 'none' },
      });
      expect(count).toBe(1);
    });
  });

  // ===========================================================================
  // Suite 4 — Trial balance: Σdebit === Σcredit
  // ===========================================================================
  describe('Trial balance: Σdebit === Σcredit', () => {
    it('GET /billing/ledger/trial-balance returns balanced totals', async () => {
      const res = await request(http)
        .get('/api/v1/billing/ledger/trial-balance')
        .set(auth())
        .expect(200);

      const body = res.body as { totalDebit: number; totalCredit: number };
      expect(typeof body.totalDebit).toBe('number');
      expect(typeof body.totalCredit).toBe('number');
      // The entire ledger must balance.
      expect(Number(body.totalDebit)).toBe(Number(body.totalCredit));
    });
  });

  // ===========================================================================
  // Suite 5 — POST /billing/ledger/entries with unbalanced body → 400
  // ===========================================================================
  describe('POST /billing/ledger/entries: unbalanced → 400', () => {
    it('unbalanced lines (debit ≠ credit) are rejected with 400', async () => {
      await request(http)
        .post('/api/v1/billing/ledger/entries')
        .set(auth())
        .send({
          memo: 'unbalanced test',
          lines: [
            { accountCode: '1000', debit: 100 },
            { accountCode: '4000', credit: 200 }, // credit 200 ≠ debit 100
          ],
        })
        .expect(400);
    });
  });

  // ===========================================================================
  // Suite 6 — SO-sourced CustomerInvoice has free lines (transportOrderId null, source='sales-order')
  // ===========================================================================
  describe('SO-sourced CustomerInvoice: free lines', () => {
    it('createDraftFromSalesOrder yields lines with transportOrderId null and source=sales-order', async () => {
      // Create a CRM company via Prisma.
      const company = await prisma.crmCompany.create({
        data: { tenantId, name: `BGL Company ${suffix}` },
      });

      // Create a SalesOrder with line items via Prisma (no full CRM pipeline needed).
      const so = await prisma.salesOrder.create({
        data: {
          tenantId,
          number: `BGL-SO-${suffix}`,
          companyId: company.id,
          customerId,
          currency: 'CAD',
          totalAmount: 150,
          lineItems: {
            create: [
              { tenantId, name: 'Service A', quantity: 1, unitPrice: 100, discountPct: 0 },
              { tenantId, name: 'Service B', quantity: 2, unitPrice: 25, discountPct: 0 },
            ],
          },
        },
      });

      // Call service method directly (no endpoint exposed for createDraftFromSalesOrder).
      const svc = app.get(CustomerInvoicesService);
      const userId = await prisma.user.findFirstOrThrow({ where: { tenantId } }).then((u) => u.id);
      const result = await svc.createDraftFromSalesOrder(tenantId, userId, so.id);
      expect(result.created).toBe(true);
      expect(result.invoiceId).toBeTruthy();
      if (result.invoiceId) invoiceIds.push(result.invoiceId);

      // Fetch the invoice with its lines.
      const inv = await prisma.customerInvoice.findUniqueOrThrow({
        where: { id: result.invoiceId! },
        include: { lines: true },
      });

      expect(inv.lines.length).toBe(2);
      for (const line of inv.lines) {
        expect(line.transportOrderId).toBeNull();
        expect(line.source).toBe('sales-order');
      }

      // Idempotence: calling again returns { created: false }.
      const result2 = await svc.createDraftFromSalesOrder(tenantId, userId, so.id);
      expect(result2.created).toBe(false);

      // Cleanup.
      await prisma.salesOrder.deleteMany({ where: { id: so.id } }).catch(() => undefined);
      await prisma.crmCompany.deleteMany({ where: { id: company.id } }).catch(() => undefined);
    });
  });

  // ===========================================================================
  // Suite 7 — Tenant isolation
  // ===========================================================================
  describe('Tenant isolation', () => {
    let otherTenantId = '';

    beforeAll(async () => {
      const other = await prisma.tenant.create({
        data: { slug: `bgl-iso-${suffix}`, name: `BGL Iso ${suffix}` },
      });
      otherTenantId = other.id;
    });

    afterAll(async () => {
      await prisma.journalEntry.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => undefined);
      await prisma.chartOfAccount.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => undefined);
      await prisma.tenant.deleteMany({ where: { id: otherTenantId } }).catch(() => undefined);
    });

    it('journal entries from another tenant are NOT visible in the trial balance of acme', async () => {
      // Snapshot acme's trial balance BEFORE posting the other-tenant entry.
      const before = await request(http)
        .get('/api/v1/billing/ledger/trial-balance')
        .set(auth())
        .expect(200);
      const totalDebitBefore = Number(before.body.totalDebit);

      // Post a journal entry directly for the other tenant.
      const { LedgerService } = await import('../src/modules/billing/ledger/ledger.service');
      const ledgerSvc = app.get(LedgerService);
      await ledgerSvc.post(
        otherTenantId,
        {
          memo: 'isolation-test',
          sourceType: 'test',
          sourceId: 'iso-only',
          sourceKind: 'test',
          lines: [
            { accountCode: '1000', debit: 9999 },
            { accountCode: '4000', credit: 9999 },
          ],
        },
      );

      // acme's trial balance should NOT include the 9999 from the other tenant.
      const res = await request(http)
        .get('/api/v1/billing/ledger/trial-balance')
        .set(auth())
        .expect(200);

      const body = res.body as { totalDebit: number };
      // The acme trial balance must remain balanced (primary isolation invariant).
      expect(Number(res.body.totalDebit)).toBe(Number(res.body.totalCredit));
      // And it must not have grown by 9999 (the other tenant's amount must be invisible).
      expect(Number(body.totalDebit)).toBe(totalDebitBefore);
    });
  });
});
