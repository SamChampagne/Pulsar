/**
 * E2E: Billing Fixed Assets — create, schedule, activate, depreciate (GL + idempotence),
 * dispose, and tenant isolation.
 *
 * Covers:
 *   1. POST /billing/fixed-assets → 201, status DRAFT.
 *   2. GET  /billing/fixed-assets/:id/schedule → 12 rows × 100, last bookValue 0, sum 1200.
 *   3. POST /billing/fixed-assets/:id/activate → status ACTIVE.
 *   4. POST /billing/fixed-assets/:id/depreciate {period} → 200; accumulatedDepreciation 100;
 *      balanced GL entry sourceType='depreciation' with Dr 5100 = 100 and Cr 1590 = 100.
 *   5. Re-depreciate same month → 409 'Period already depreciated'.
 *   6. Depreciate a second distinct month → accumulatedDepreciation 200.
 *   7. POST /billing/fixed-assets/:id/dispose → status DISPOSED.
 *   8. Tenant isolation: second-tenant token gets 404 on first tenant's asset.
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
const suffix = `${Date.now()}-ast`;

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let token = '';
let tenantId = '';

// Cleanup tracking
const assetIds: string[] = [];

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

describe('Fixed Assets (e2e)', () => {
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

    // Ensure assets permissions are assigned to the admin role.
    const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'admin' } });
    for (const [key, module] of [
      ['billing.assets.read', 'billing'],
      ['billing.assets.manage', 'billing'],
    ] as [string, string][]) {
      await ensurePermission(adminRole.id, key, module);
    }

    // Re-login to get a fresh JWT that includes the newly assigned assets permissions.
    const loginRefresh = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (loginRefresh.body as { accessToken: string }).accessToken;

    // Ensure the depreciation GL accounts (5100/1590) exist for acme.
    // These were added to DEFAULT_CHART after the initial seed and may not be present
    // if db:seed has not been re-run. Upsert them explicitly so the test is self-contained.
    for (const { code, name, type } of [
      { code: '5100', name: 'Dotation aux amortissements', type: 'EXPENSE' },
      { code: '1590', name: 'Amortissement cumulé', type: 'ASSET' },
    ]) {
      await prisma.chartOfAccount.upsert({
        where: { tenantId_code: { tenantId, code } },
        update: { name, type: type as any },
        create: { tenantId, code, name, type: type as any },
      });
    }
  });

  afterAll(async () => {
    // Clean up depreciation entries first (FK → asset), then assets.
    if (assetIds.length > 0) {
      await prisma.depreciationEntry.deleteMany({ where: { assetId: { in: assetIds } } }).catch(() => undefined);
      await prisma.fixedAsset.deleteMany({ where: { id: { in: assetIds } } }).catch(() => undefined);
    }
    await app?.close();
  });

  // ===========================================================================
  // Main happy-path suite
  // ===========================================================================
  describe('Happy path: create → schedule → activate → depreciate → dispose', () => {
    const COST = 1200;
    const SALVAGE = 0;
    const LIFE = 12;
    const assetCode = `FA-${suffix}`;
    const thisYear = new Date().getUTCFullYear();
    const period1 = `${thisYear}-01-15`; // first month
    const period2 = `${thisYear}-02-15`; // second month

    let assetId = '';

    // -----------------------------------------------------------------------
    // 1. Create asset → 201, status DRAFT
    // -----------------------------------------------------------------------
    it('1. POST /billing/fixed-assets → 201, status DRAFT', async () => {
      const res = await request(http)
        .post('/api/v1/billing/fixed-assets')
        .set(auth())
        .send({
          assetCode,
          name: `Test Asset ${suffix}`,
          acquisitionDate: `${thisYear}-01-01`,
          cost: COST,
          salvageValue: SALVAGE,
          usefulLifeMonths: LIFE,
        })
        .expect(201);

      const body = res.body as { id: string; status: string };
      expect(body.id).toBeTruthy();
      expect(body.status).toBe('DRAFT');
      assetId = body.id;
      assetIds.push(assetId);
    });

    // -----------------------------------------------------------------------
    // 2. GET :id/schedule → 12 rows × 100, last bookValue 0, sum 1200
    // -----------------------------------------------------------------------
    it('2. GET :id/schedule → 12 rows × 100, last bookValue 0, sum 1200', async () => {
      const res = await request(http)
        .get(`/api/v1/billing/fixed-assets/${assetId}/schedule`)
        .set(auth())
        .expect(200);

      const rows = res.body as Array<{ period: number; amount: number; accumulated: number; bookValue: number }>;
      expect(rows).toHaveLength(12);

      // Every row has amount 100
      for (const row of rows) {
        expect(row.amount).toBe(100);
      }

      // Last row bookValue is 0
      const last = rows[rows.length - 1];
      expect(last.bookValue).toBe(0);

      // Sum of amounts = 1200
      const total = rows.reduce((s, r) => s + r.amount, 0);
      expect(total).toBe(COST - SALVAGE);
    });

    // -----------------------------------------------------------------------
    // 3. Activate → status ACTIVE
    // -----------------------------------------------------------------------
    it('3. POST :id/activate → status ACTIVE', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/fixed-assets/${assetId}/activate`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      expect((res.body as { status: string }).status).toBe('ACTIVE');
    });

    // -----------------------------------------------------------------------
    // 4. Depreciate period1 → accumulatedDepreciation 100; balanced GL entry
    // -----------------------------------------------------------------------
    it('4a. POST :id/depreciate {period1} → 200/201; accumulatedDepreciation 100', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/fixed-assets/${assetId}/depreciate`)
        .set(auth())
        .send({ period: period1 })
        .expect((r) => expect([200, 201]).toContain(r.status));

      const body = res.body as { accumulatedDepreciation: string | number };
      expect(Number(body.accumulatedDepreciation)).toBe(100);
    });

    it('4b. Balanced GL entry: sourceType=depreciation, Dr 5100 = 100, Cr 1590 = 100', async () => {
      // Look up the DepreciationEntry for this asset + period
      const d = new Date(period1);
      const periodUtc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

      const depEntry = await prisma.depreciationEntry.findFirst({
        where: { tenantId, assetId },
        orderBy: { period: 'asc' },
      });
      expect(depEntry).not.toBeNull();

      // The GL entry is keyed by the DepreciationEntry id
      const glEntry = await prisma.journalEntry.findFirst({
        where: { tenantId, sourceType: 'depreciation', sourceId: depEntry!.id },
        include: { lines: { include: { account: true } } },
      });
      expect(glEntry).not.toBeNull();

      const totalDebit = glEntry!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = glEntry!.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(totalDebit).toBe(100);
      expect(totalCredit).toBe(100);

      // Dr 5100 (depreciation expense) = 100
      const drLine = glEntry!.lines.find((l) => l.account.code === '5100');
      expect(drLine).toBeDefined();
      expect(Number(drLine!.debit)).toBe(100);

      // Cr 1590 (accumulated depreciation contra-asset) = 100
      const crLine = glEntry!.lines.find((l) => l.account.code === '1590');
      expect(crLine).toBeDefined();
      expect(Number(crLine!.credit)).toBe(100);
    });

    // -----------------------------------------------------------------------
    // 5. Re-depreciate same month → 409
    // -----------------------------------------------------------------------
    it('5. POST :id/depreciate same period again → 409 (Period already depreciated)', async () => {
      await request(http)
        .post(`/api/v1/billing/fixed-assets/${assetId}/depreciate`)
        .set(auth())
        .send({ period: period1 })
        .expect(409);
    });

    // -----------------------------------------------------------------------
    // 6. Depreciate a second distinct month → accumulatedDepreciation 200
    // -----------------------------------------------------------------------
    it('6. Depreciate second month → accumulatedDepreciation 200', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/fixed-assets/${assetId}/depreciate`)
        .set(auth())
        .send({ period: period2 })
        .expect((r) => expect([200, 201]).toContain(r.status));

      const body = res.body as { accumulatedDepreciation: string | number };
      expect(Number(body.accumulatedDepreciation)).toBe(200);
    });

    // -----------------------------------------------------------------------
    // 7. Dispose → status DISPOSED
    // -----------------------------------------------------------------------
    it('7. POST :id/dispose → status DISPOSED', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/fixed-assets/${assetId}/dispose`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      expect((res.body as { status: string }).status).toBe('DISPOSED');
    });
  });

  // ===========================================================================
  // Suite 2 — Tenant isolation
  // ===========================================================================
  describe('Tenant isolation', () => {
    let firstTenantAssetId = '';
    let otherTenantId = '';
    let otherToken = '';

    beforeAll(async () => {
      // Create a DRAFT asset in the first (acme) tenant to probe.
      const res = await request(http)
        .post('/api/v1/billing/fixed-assets')
        .set(auth())
        .send({
          assetCode: `FA-ISO-${suffix}`,
          name: `Iso Asset ${suffix}`,
          acquisitionDate: `${new Date().getUTCFullYear()}-01-01`,
          cost: 500,
          salvageValue: 0,
          usefulLifeMonths: 5,
        })
        .expect(201);

      firstTenantAssetId = (res.body as { id: string }).id;
      assetIds.push(firstTenantAssetId);

      // Create a second tenant + admin user.
      const otherSlug = `ast-iso-${suffix}`;
      const otherEmail = `ast-iso-${suffix}@example.test`;

      const other = await prisma.tenant.create({
        data: { slug: otherSlug, name: `Ast Iso ${suffix}` },
      });
      otherTenantId = other.id;

      // Enable billing for the other tenant.
      const billingMod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'billing' } });
      await prisma.tenantModule.create({
        data: { tenantId: otherTenantId, moduleId: billingMod.id, enabled: true, enabledAt: new Date() },
      });

      // Grant billing.assets.read to the other tenant role.
      const assetsReadPerm = await prisma.permission.findUniqueOrThrow({
        where: { key: 'billing.assets.read' },
      });
      const otherRole = await prisma.role.create({
        data: {
          tenantId: otherTenantId,
          key: 'admin',
          name: 'Admin',
          isSystem: true,
          permissions: { create: [{ permissionId: assetsReadPerm.id }] },
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

    it('8. Other-tenant token gets 404 on GET /billing/fixed-assets/:id of first tenant', async () => {
      await request(http)
        .get(`/api/v1/billing/fixed-assets/${firstTenantAssetId}`)
        .set({ Authorization: `Bearer ${otherToken}` })
        .expect(404);
    });
  });
});
