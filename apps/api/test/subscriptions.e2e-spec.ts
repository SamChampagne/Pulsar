/**
 * E2E: Billing Subscriptions — recurring generation, lifecycle, idempotence, tenant isolation.
 *
 * Covers:
 *   1. Create subscription → ACTIVE, nextRunDate = startDate
 *   2. POST :id/generate → DRAFT CustomerInvoice (total 50, one line), nextRunDate advanced
 *   3. Idempotence: reset nextRunDate via Prisma → generate again → 409
 *   4. pause → generate → 400 (not ACTIVE)
 *   5. resume → run-due (set nextRunDate to past) → generated >= 1
 *   6. cancel → status CANCELLED
 *   7. Tenant isolation: second tenant 404 on first tenant's subscription
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
const suffix = `${Date.now()}-sub`;
const THIS_YEAR = new Date().getUTCFullYear();

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let token = '';
let tenantId = '';

let customerId = '';
let subscriptionId = '';
let generatedInvoiceId = '';

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

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

describe('Billing Subscriptions (e2e)', () => {
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

    // Initial login
    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Enable billing module
    await enableModule('billing');

    // Ensure subscription permissions exist and are assigned to admin role
    const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'admin' } });
    const permKeys = [
      'billing.subscriptions.read',
      'billing.subscriptions.manage',
      'billing.customer-invoices.read',
    ];
    for (const key of permKeys) {
      const perm = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, module: 'billing', description: `Permission: ${key}` },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: adminRole.id, permissionId: perm.id },
      });
    }

    // Re-login to get fresh JWT with new permissions
    const loginRefresh = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (loginRefresh.body as { accessToken: string }).accessToken;

    // Seed a customer for the subscription
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        code: `SUB-CUST-${suffix}`,
        name: `Sub Customer ${suffix}`,
        email: `sub-${suffix}@example.com`,
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    // Cleanup: remove subscription invoices, subscriptions, customer
    if (subscriptionId) {
      await prisma.subscriptionInvoice
        .deleteMany({ where: { subscriptionId } })
        .catch(() => undefined);
      await prisma.subscription
        .deleteMany({ where: { id: subscriptionId } })
        .catch(() => undefined);
    }
    if (generatedInvoiceId) {
      await prisma.customerInvoice
        .deleteMany({ where: { id: generatedInvoiceId } })
        .catch(() => undefined);
    }
    if (customerId) {
      await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    }
    await app?.close();
  });

  // ===========================================================================
  // Suite 1 — Create subscription
  // ===========================================================================
  describe('Create subscription', () => {
    it('POST /billing/subscriptions → 201, ACTIVE, nextRunDate = startDate', async () => {
      const res = await request(http)
        .post('/api/v1/billing/subscriptions')
        .set(auth())
        .send({
          name: `Monthly Plan ${suffix}`,
          customerId,
          interval: 'MONTHLY',
          startDate: `${THIS_YEAR}-01-01`,
          lines: [{ description: 'Plan', amount: 50 }],
        })
        .expect(201);

      const body = res.body as {
        id: string;
        status: string;
        nextRunDate: string;
        lines: { description: string; amount: string }[];
      };
      subscriptionId = body.id;

      expect(body.status).toBe('ACTIVE');
      expect(body.nextRunDate).toContain(`${THIS_YEAR}-01-01`);
      expect(body.lines).toHaveLength(1);
      expect(body.lines[0].description).toBe('Plan');
    });
  });

  // ===========================================================================
  // Suite 2 — Generate invoice
  // ===========================================================================
  describe('Generate invoice', () => {
    it('POST :id/generate → CustomerInvoice DRAFT, totalAmount 50, line description=Plan', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/subscriptions/${subscriptionId}/generate`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      const inv = res.body as {
        id: string;
        status: string;
        totalAmount: number | string;
        lines: { description: string }[];
      };
      generatedInvoiceId = inv.id;

      expect(inv.status).toBe('DRAFT');
      expect(Number(inv.totalAmount)).toBe(50);
      expect(inv.lines).toHaveLength(1);
      expect(inv.lines[0].description).toBe('Plan');
    });

    it('GET /billing/customer-invoices/:id → DRAFT, totalAmount 50', async () => {
      const res = await request(http)
        .get(`/api/v1/billing/customer-invoices/${generatedInvoiceId}`)
        .set(auth())
        .expect(200);

      const inv = res.body as { status: string; totalAmount: number | string };
      expect(inv.status).toBe('DRAFT');
      expect(Number(inv.totalAmount)).toBe(50);
    });

    it('Subscription nextRunDate advanced to <thisYear>-02-01', async () => {
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      const next = sub.nextRunDate;
      expect(next.getUTCFullYear()).toBe(THIS_YEAR);
      expect(next.getUTCMonth()).toBe(1); // 0-indexed: 1 = February
      expect(next.getUTCDate()).toBe(1);
    });
  });

  // ===========================================================================
  // Suite 3 — Idempotence: same period → 409
  // ===========================================================================
  describe('Idempotence: generating for an already-generated period → 409', () => {
    it('reset nextRunDate to Jan 1 via Prisma, then POST :id/generate → 409', async () => {
      // Reset nextRunDate to the original period start so generate targets the same periodStart
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { nextRunDate: new Date(`${THIS_YEAR}-01-01T00:00:00.000Z`) },
      });

      await request(http)
        .post(`/api/v1/billing/subscriptions/${subscriptionId}/generate`)
        .set(auth())
        .expect(409);
    });
  });

  // ===========================================================================
  // Suite 4 — Pause blocks generation
  // ===========================================================================
  describe('Pause → generate blocked', () => {
    it('POST :id/pause → status PAUSED', async () => {
      // Advance nextRunDate past the already-generated period so pause works (sub must be ACTIVE)
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { nextRunDate: new Date(`${THIS_YEAR}-03-01T00:00:00.000Z`) },
      });

      const res = await request(http)
        .post(`/api/v1/billing/subscriptions/${subscriptionId}/pause`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      expect((res.body as { status: string }).status).toBe('PAUSED');
    });

    it('POST :id/generate on PAUSED subscription → 400', async () => {
      await request(http)
        .post(`/api/v1/billing/subscriptions/${subscriptionId}/generate`)
        .set(auth())
        .expect(400);
    });
  });

  // ===========================================================================
  // Suite 5 — Resume + run-due
  // ===========================================================================
  describe('Resume + run-due', () => {
    it('POST :id/resume → status ACTIVE', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/subscriptions/${subscriptionId}/resume`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      expect((res.body as { status: string }).status).toBe('ACTIVE');
    });

    it('POST /billing/subscriptions/run-due → { generated, skipped, errors } with generated >= 1', async () => {
      // Set nextRunDate to a past date so the subscription is due
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { nextRunDate: new Date('2020-01-01T00:00:00.000Z') },
      });

      const res = await request(http)
        .post('/api/v1/billing/subscriptions/run-due')
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      const body = res.body as { generated: number; skipped: number; errors: number };
      expect(typeof body.generated).toBe('number');
      expect(typeof body.skipped).toBe('number');
      expect(typeof body.errors).toBe('number');
      expect(body.generated).toBeGreaterThanOrEqual(1);
      expect(body.errors).toBe(0);
    });
  });

  // ===========================================================================
  // Suite 6 — Cancel
  // ===========================================================================
  describe('Cancel', () => {
    it('POST :id/cancel → status CANCELLED', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/subscriptions/${subscriptionId}/cancel`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      expect((res.body as { status: string }).status).toBe('CANCELLED');
    });
  });

  // ===========================================================================
  // Suite 7 — Tenant isolation
  // ===========================================================================
  describe('Tenant isolation', () => {
    let otherTenantToken = '';
    let otherTenantId = '';

    beforeAll(async () => {
      // Create a second tenant with its own admin user
      const otherTenant = await prisma.tenant.create({
        data: { slug: `sub-iso-${suffix}`, name: `Sub Iso Tenant ${suffix}` },
      });
      otherTenantId = otherTenant.id;

      // Create a user in the other tenant
      const { hash } = await import('bcryptjs');
      const passwordHash = await hash('admin123', 10);
      const otherUser = await prisma.user.create({
        data: {
          tenantId: otherTenantId,
          email: `sub-iso-admin-${suffix}@example.com`,
          passwordHash,
          firstName: 'Sub',
          lastName: 'IsoAdmin',
          status: 'ACTIVE',
        },
      });

      // Create an admin role for the other tenant
      const otherRole = await prisma.role.create({
        data: {
          tenantId: otherTenantId,
          key: 'admin',
          name: 'Admin',
        },
      });

      // Assign user to that role
      await prisma.userRole.create({
        data: { userId: otherUser.id, roleId: otherRole.id },
      });

      // Grant billing.subscriptions.read to the other tenant's admin
      const subsReadPerm = await prisma.permission.findUniqueOrThrow({
        where: { key: 'billing.subscriptions.read' },
      });
      await prisma.rolePermission.create({
        data: { roleId: otherRole.id, permissionId: subsReadPerm.id },
      });

      // Enable billing for the other tenant
      const billingModule = await prisma.moduleDefinition.findUniqueOrThrow({
        where: { key: 'billing' },
      });
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId: otherTenantId, moduleId: billingModule.id } },
        update: { enabled: true },
        create: {
          tenantId: otherTenantId,
          moduleId: billingModule.id,
          enabled: true,
          enabledAt: new Date(),
        },
      });

      // Login as the other tenant user
      const login = await request(http)
        .post('/api/v1/auth/login')
        .send({
          email: `sub-iso-admin-${suffix}@example.com`,
          password: 'admin123',
          tenant: `sub-iso-${suffix}`,
        })
        .expect(200);
      otherTenantToken = (login.body as { accessToken: string }).accessToken;
    });

    afterAll(async () => {
      // Clean up the other tenant (cascades to roles, users, etc.)
      await prisma.rolePermission
        .deleteMany({
          where: { role: { tenantId: otherTenantId } },
        })
        .catch(() => undefined);
      await prisma.userRole
        .deleteMany({ where: { role: { tenantId: otherTenantId } } })
        .catch(() => undefined);
      await prisma.role.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => undefined);
      await prisma.tenantModule
        .deleteMany({ where: { tenantId: otherTenantId } })
        .catch(() => undefined);
      await prisma.tenant.deleteMany({ where: { id: otherTenantId } }).catch(() => undefined);
    });

    it('GET /billing/subscriptions/:id from other tenant → 404', async () => {
      await request(http)
        .get(`/api/v1/billing/subscriptions/${subscriptionId}`)
        .set({ Authorization: `Bearer ${otherTenantToken}` })
        .expect(404);
    });
  });
});
