/**
 * E2E: Taxes — apply/split-GL/clear/type-mismatch/isolation
 *
 * Covers:
 *   1. POST /billing/tax-templates — create a SALES template (GST 5% → 2100).
 *   2. Create customer invoice (net 100) → starts tax-free (taxAmount 0, total 100);
 *      PATCH :id/tax {taxTemplateId} → taxAmount 5, total 105.
 *   3. Approve → balanced GL entry (sourceType='customer-invoice', sourceKind='approved'):
 *      AR(1100) debit 105, Revenue(4000) credit 100, Tax(2100) credit 5.
 *   4. PATCH :id/tax {taxTemplateId:null} on a fresh DRAFT → taxAmount 0, total back to net.
 *   5. Type mismatch: applying a PURCHASE template to a customer invoice → 400.
 *   6. Carrier invoice symmetric: PURCHASE template (GST 5% → 1150), approve →
 *      Expense(5000) debit net, Tax(1150) debit, AP(2000) credit gross — all balanced.
 *   7. Tenant isolation: second tenant gets 404 on GET /billing/tax-templates/:id
 *      of the first tenant's template.
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
const suffix = `${Date.now()}-tax`;

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let token = '';
let tenantId = '';

// Master data
let customerId = '';
let carrierId = '';

// Tax template IDs (created during tests)
let salesTemplateId = '';
let purchaseTemplateId = '';

// Cleanup tracking
const customerInvoiceIds: string[] = [];
const carrierInvoiceIds: string[] = [];
const taxTemplateIds: string[] = [];

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

describe('Taxes (e2e)', () => {
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

    // Ensure taxes + ledger permissions are assigned to the admin role.
    const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'admin' } });
    for (const [key, mod] of [
      ['billing.taxes.read', 'billing'],
      ['billing.taxes.manage', 'billing'],
      ['billing.ledger.read', 'billing'],
      ['billing.ledger.manage', 'billing'],
    ]) {
      await ensurePermission(adminRole.id, key, mod);
    }

    // Re-login to get a fresh JWT that includes the newly assigned permissions.
    const loginRefresh = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (loginRefresh.body as { accessToken: string }).accessToken;

    // Ensure ledgerAutoPost is true.
    await request(http)
      .put('/api/v1/modules/billing/settings')
      .set(auth())
      .send({ settings: { ledgerAutoPost: true } })
      .expect(200);

    // Seed a customer (with email so send() works if needed).
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        code: `TAX-CUST-${suffix}`,
        name: `Tax Customer ${suffix}`,
        email: `tax-cust-${suffix}@example.com`,
      },
    });
    customerId = customer.id;

    // Seed a carrier.
    const carrier = await prisma.carrier.create({
      data: {
        tenantId,
        code: `TAX-CARR-${suffix}`,
        name: `Tax Carrier ${suffix}`,
      },
    });
    carrierId = carrier.id;
  });

  afterAll(async () => {
    // Cleanup in dependency order.
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
    if (taxTemplateIds.length > 0) {
      await prisma.taxTemplate
        .deleteMany({ where: { id: { in: taxTemplateIds } } })
        .catch(() => undefined);
    }
    await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    await prisma.carrier.deleteMany({ where: { id: carrierId } }).catch(() => undefined);
    await app?.close();
  });

  // ===========================================================================
  // Suite 1 — Create tax templates
  // ===========================================================================
  describe('POST /billing/tax-templates', () => {
    it('1a. creates a SALES template (GST 5% → 2100) → 201 with id, lines', async () => {
      const res = await request(http)
        .post('/api/v1/billing/tax-templates')
        .set(auth())
        .send({
          name: `GST-SALES-${suffix}`,
          type: 'SALES',
          isDefault: false,
          lines: [
            { description: 'GST', rate: 5, accountCode: '2100', sortOrder: 0 },
          ],
        })
        .expect(201);

      const body = res.body as { id: string; type: string; lines: Array<{ rate: number; accountCode: string }> };
      expect(body.id).toBeTruthy();
      expect(body.type).toBe('SALES');
      expect(body.lines).toHaveLength(1);
      expect(Number(body.lines[0].rate)).toBe(5);
      expect(body.lines[0].accountCode).toBe('2100');

      salesTemplateId = body.id;
      taxTemplateIds.push(salesTemplateId);
    });

    it('1b. creates a PURCHASE template (GST 5% → 1150) → 201', async () => {
      const res = await request(http)
        .post('/api/v1/billing/tax-templates')
        .set(auth())
        .send({
          name: `GST-PURCHASE-${suffix}`,
          type: 'PURCHASE',
          isDefault: false,
          lines: [
            { description: 'GST', rate: 5, accountCode: '1150', sortOrder: 0 },
          ],
        })
        .expect(201);

      const body = res.body as { id: string; type: string; lines: Array<{ rate: number; accountCode: string }> };
      expect(body.id).toBeTruthy();
      expect(body.type).toBe('PURCHASE');
      expect(body.lines[0].accountCode).toBe('1150');

      purchaseTemplateId = body.id;
      taxTemplateIds.push(purchaseTemplateId);
    });

    it('1c. GET /billing/tax-templates lists both templates', async () => {
      const res = await request(http)
        .get('/api/v1/billing/tax-templates')
        .set(auth())
        .expect(200);

      const ids = (res.body as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(salesTemplateId);
      expect(ids).toContain(purchaseTemplateId);
    });
  });

  // ===========================================================================
  // Suite 2 — Customer invoice: apply tax, verify taxAmount/total
  // ===========================================================================
  describe('Customer invoice: apply SALES tax', () => {
    let invoiceId = '';
    const NET = 100;

    beforeAll(async () => {
      // Create a DRAFT customer invoice with net 100 via Prisma.
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `TAX-CINV-APPLY-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: NET,
          status: 'DRAFT',
        },
      });
      invoiceId = inv.id;
      customerInvoiceIds.push(invoiceId);
    });

    it('2a. freshly created invoice is tax-free (taxAmount=0, total=100)', async () => {
      const res = await request(http)
        .get(`/api/v1/billing/customer-invoices/${invoiceId}`)
        .set(auth())
        .expect(200);

      const body = res.body as { taxAmount: number; totalAmount: number };
      expect(Number(body.taxAmount)).toBe(0);
      expect(Number(body.totalAmount)).toBe(NET);
    });

    it('2b. PATCH :id/tax {taxTemplateId} → taxAmount=5, total=105', async () => {
      const res = await request(http)
        .patch(`/api/v1/billing/customer-invoices/${invoiceId}/tax`)
        .set(auth())
        .send({ taxTemplateId: salesTemplateId })
        .expect(200);

      const body = res.body as { taxAmount: number; totalAmount: number; taxTemplateId: string };
      expect(Number(body.taxAmount)).toBe(5);
      expect(Number(body.totalAmount)).toBe(105);
      expect(body.taxTemplateId).toBe(salesTemplateId);
    });
  });

  // ===========================================================================
  // Suite 3 — Approve with tax → GL split: AR debit 105, Revenue credit 100, Tax credit 5
  // ===========================================================================
  describe('Approve customer invoice with tax → split GL entry', () => {
    let invoiceId = '';
    const NET = 100;

    beforeAll(async () => {
      // Create DRAFT + apply tax, then approve.
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `TAX-CINV-GL-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: NET,
          status: 'DRAFT',
        },
      });
      invoiceId = inv.id;
      customerInvoiceIds.push(invoiceId);

      // Apply SALES tax.
      await request(http)
        .patch(`/api/v1/billing/customer-invoices/${invoiceId}/tax`)
        .set(auth())
        .send({ taxTemplateId: salesTemplateId })
        .expect(200);
    });

    it('3a. approve → status APPROVED', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceId}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('APPROVED');
    });

    it('3b. balanced GL entry (sourceType=customer-invoice, sourceKind=approved): AR debit 105, Revenue credit 100, Tax(2100) credit 5', async () => {
      const entry = await prisma.journalEntry.findFirst({
        where: { tenantId, sourceType: 'customer-invoice', sourceId: invoiceId, sourceKind: 'approved' },
        include: { lines: { include: { account: true } } },
      });
      expect(entry).not.toBeNull();

      const totalDebit = entry!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = entry!.lines.reduce((s, l) => s + Number(l.credit), 0);
      // Entry must be balanced.
      expect(totalDebit).toBeCloseTo(totalCredit, 5);
      expect(totalDebit).toBeCloseTo(105, 5);

      // AR (1100) debited for the gross amount.
      const arLine = entry!.lines.find((l) => l.account.code === '1100');
      expect(arLine).toBeDefined();
      expect(Number(arLine!.debit)).toBeCloseTo(105, 5);

      // Revenue (4000) credited for the net.
      const revLine = entry!.lines.find((l) => l.account.code === '4000');
      expect(revLine).toBeDefined();
      expect(Number(revLine!.credit)).toBeCloseTo(100, 5);

      // Tax payable (2100) credited for the tax portion.
      const taxLine = entry!.lines.find((l) => l.account.code === '2100');
      expect(taxLine).toBeDefined();
      expect(Number(taxLine!.credit)).toBeCloseTo(5, 5);
    });
  });

  // ===========================================================================
  // Suite 4 — Clear tax on DRAFT: PATCH :id/tax {taxTemplateId:null} → taxAmount 0
  // ===========================================================================
  describe('Clear tax on DRAFT invoice', () => {
    let invoiceId = '';
    const NET = 100;

    beforeAll(async () => {
      // Create DRAFT, apply tax, then clear it.
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `TAX-CINV-CLR-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: NET,
          status: 'DRAFT',
        },
      });
      invoiceId = inv.id;
      customerInvoiceIds.push(invoiceId);

      // Apply first.
      await request(http)
        .patch(`/api/v1/billing/customer-invoices/${invoiceId}/tax`)
        .set(auth())
        .send({ taxTemplateId: salesTemplateId })
        .expect(200);
    });

    it('4. PATCH :id/tax {taxTemplateId:null} → taxAmount=0, total back to net (100)', async () => {
      const res = await request(http)
        .patch(`/api/v1/billing/customer-invoices/${invoiceId}/tax`)
        .set(auth())
        .send({ taxTemplateId: null })
        .expect(200);

      const body = res.body as { taxAmount: number; totalAmount: number; taxTemplateId: string | null };
      expect(Number(body.taxAmount)).toBe(0);
      expect(Number(body.totalAmount)).toBe(NET);
      expect(body.taxTemplateId).toBeNull();
    });
  });

  // ===========================================================================
  // Suite 5 — Type mismatch: PURCHASE template applied to customer invoice → 400
  // ===========================================================================
  describe('Type mismatch rejected', () => {
    let invoiceId = '';

    beforeAll(async () => {
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `TAX-CINV-MISMATCH-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: 100,
          status: 'DRAFT',
        },
      });
      invoiceId = inv.id;
      customerInvoiceIds.push(invoiceId);
    });

    it('5. applying a PURCHASE template to a customer invoice → 400', async () => {
      await request(http)
        .patch(`/api/v1/billing/customer-invoices/${invoiceId}/tax`)
        .set(auth())
        .send({ taxTemplateId: purchaseTemplateId })
        .expect(400);
    });
  });

  // ===========================================================================
  // Suite 6 — Carrier invoice: apply PURCHASE tax, approve → split GL
  // ===========================================================================
  describe('Carrier invoice: apply PURCHASE tax → split GL on approve', () => {
    let invoiceId = '';
    const NET = 100;

    beforeAll(async () => {
      // Create DRAFT carrier invoice with net 100.
      const inv = await prisma.invoice.create({
        data: {
          tenantId,
          invoiceNumber: `TAX-INV-GL-${suffix}`,
          carrierId,
          currency: 'CAD',
          totalAmount: NET,
          status: 'DRAFT',
        },
      });
      invoiceId = inv.id;
      carrierInvoiceIds.push(invoiceId);

      // Apply PURCHASE tax template (GST 5% → 1150).
      await request(http)
        .patch(`/api/v1/billing/invoices/${invoiceId}/tax`)
        .set(auth())
        .send({ taxTemplateId: purchaseTemplateId })
        .expect(200);
    });

    it('6a. after applying PURCHASE tax: taxAmount=5, total=105', async () => {
      const res = await request(http)
        .get(`/api/v1/billing/invoices/${invoiceId}`)
        .set(auth())
        .expect(200);

      const body = res.body as { taxAmount: number; totalAmount: number };
      expect(Number(body.taxAmount)).toBe(5);
      expect(Number(body.totalAmount)).toBe(105);
    });

    it('6b. approve → status APPROVED', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/invoices/${invoiceId}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      expect((res.body as { status: string }).status).toBe('APPROVED');
    });

    it('6c. balanced GL entry (sourceType=invoice, sourceKind=approved): Expense(5000) debit 100, Tax(1150) debit 5, AP(2000) credit 105', async () => {
      const entry = await prisma.journalEntry.findFirst({
        where: { tenantId, sourceType: 'invoice', sourceId: invoiceId, sourceKind: 'approved' },
        include: { lines: { include: { account: true } } },
      });
      expect(entry).not.toBeNull();

      const totalDebit = entry!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = entry!.lines.reduce((s, l) => s + Number(l.credit), 0);
      // Must be balanced.
      expect(totalDebit).toBeCloseTo(totalCredit, 5);
      expect(totalDebit).toBeCloseTo(105, 5);

      // Expense (5000) debited for the net.
      const expLine = entry!.lines.find((l) => l.account.code === '5000');
      expect(expLine).toBeDefined();
      expect(Number(expLine!.debit)).toBeCloseTo(NET, 5);

      // Input tax recoverable (1150) debited for the tax.
      const taxLine = entry!.lines.find((l) => l.account.code === '1150');
      expect(taxLine).toBeDefined();
      expect(Number(taxLine!.debit)).toBeCloseTo(5, 5);

      // AP (2000) credited for the gross.
      const apLine = entry!.lines.find((l) => l.account.code === '2000');
      expect(apLine).toBeDefined();
      expect(Number(apLine!.credit)).toBeCloseTo(105, 5);
    });
  });

  // ===========================================================================
  // Suite 7 — Tenant isolation: second tenant cannot see first tenant's template
  // ===========================================================================
  describe('Tenant isolation', () => {
    let otherTenantId = '';
    let otherToken = '';

    beforeAll(async () => {
      const otherSlug = `tax-iso-${suffix}`;
      const otherEmail = `tax-iso-${suffix}@example.test`;

      // Create a second tenant.
      const other = await prisma.tenant.create({
        data: { slug: otherSlug, name: `Tax Iso ${suffix}` },
      });
      otherTenantId = other.id;

      // Enable billing for the other tenant.
      const billingMod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'billing' } });
      await prisma.tenantModule.create({
        data: { tenantId: otherTenantId, moduleId: billingMod.id, enabled: true, enabledAt: new Date() },
      });

      // Give the other role taxes.read permission.
      const taxesReadPerm = await prisma.permission.findUniqueOrThrow({
        where: { key: 'billing.taxes.read' },
      });
      const otherRole = await prisma.role.create({
        data: {
          tenantId: otherTenantId,
          key: 'admin',
          name: 'Admin',
          isSystem: true,
          permissions: { create: [{ permissionId: taxesReadPerm.id }] },
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

      // Login as the other tenant user.
      const otherLogin = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: otherEmail, password: 'Test1234!', tenant: otherSlug })
        .expect(200);
      otherToken = (otherLogin.body as { accessToken: string }).accessToken;
    });

    afterAll(async () => {
      await prisma.tenant.deleteMany({ where: { id: otherTenantId } }).catch(() => undefined);
    });

    it('7. Other-tenant token gets 404 on GET /billing/tax-templates/:id of first tenant template', async () => {
      await request(http)
        .get(`/api/v1/billing/tax-templates/${salesTemplateId}`)
        .set({ Authorization: `Bearer ${otherToken}` })
        .expect(404);
    });
  });
});
