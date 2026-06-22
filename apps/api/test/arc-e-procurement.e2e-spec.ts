/**
 * E2E: procurement configurable — prefix + custom fields (arc-E Task 6).
 *
 * Mirrors tms-configurable.e2e-spec.ts. Covers:
 *   1. documentPrefixRfp — PUT settings { documentPrefixRfp: 'RFQ' } → next RFP
 *      number starts with RFQ-; 2nd create → counter incremented (not reset).
 *   2. Default prefix — no setting → RFP number starts with RFP-.
 *   3. Custom fields — PUT /procurement/custom-fields (required SELECT on RFP) →
 *      create RFP without value = 400 → out-of-options = 400 → valid = 201 + customData
 *      in GET projection.
 *   4. Tenant isolation — tenant B's definitions absent from tenant A's GET.
 *
 * Prerequisites: running Postgres, db:migrate + db:seed applied.
 * Run: pnpm --filter @pulsar/api test:e2e -- arc-e-procurement
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const suffix = `${Date.now()}-ap`;

let sharedApp: INestApplication;
let sharedHttp: ReturnType<INestApplication['getHttpServer']>;
let sharedToken = '';
let sharedTenantId = '';
let sharedPrisma: PrismaService;

async function login(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send(ADMIN)
    .expect(200);
  return (res.body as { accessToken: string }).accessToken;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function putProcurementSettings(
  http: ReturnType<INestApplication['getHttpServer']>,
  token: string,
  settings: Record<string, unknown>,
) {
  await request(http)
    .put('/api/v1/modules/procurement/settings')
    .set(auth(token))
    .send({ settings })
    .expect(200);
}

// ---------------------------------------------------------------------------
// Main suite
// ---------------------------------------------------------------------------
describe('Procurement configurable (e2e)', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    sharedApp = moduleRef.createNestApplication();
    sharedApp.setGlobalPrefix('api/v1');
    sharedApp.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await sharedApp.listen(0);
    sharedHttp = sharedApp.getHttpServer();
    sharedPrisma = sharedApp.get(PrismaService);

    sharedToken = await login(sharedApp);
    const tenant = await sharedPrisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    sharedTenantId = tenant.id;

    // Ensure PROCUREMENT is enabled for acme
    const procMod = await sharedPrisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'procurement' } });
    await sharedPrisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: sharedTenantId, moduleId: procMod.id } },
      update: { enabled: true },
      create: { tenantId: sharedTenantId, moduleId: procMod.id, enabled: true, enabledAt: new Date() },
    });
  });

  afterAll(async () => {
    // Best-effort: reset procurement settings to defaults
    await putProcurementSettings(sharedHttp, sharedToken, { documentPrefixRfp: 'RFP' }).catch(() => undefined);
    await sharedApp.close();
  });

  // ===========================================================================
  // Suite 1 — documentPrefixRfp
  // ===========================================================================
  describe('documentPrefixRfp prefix', () => {
    let counterBefore = 0;

    afterAll(async () => {
      // Reset to default
      await putProcurementSettings(sharedHttp, sharedToken, { documentPrefixRfp: 'RFP' });
    });

    it('captures the current counter under default RFP- prefix', async () => {
      const res = await request(sharedHttp)
        .post('/api/v1/procurement/rfps')
        .set(auth(sharedToken))
        .send({ title: `AE Baseline RFP ${suffix}` })
        .expect(201);
      const num: string = (res.body as { rfpNumber: string }).rfpNumber;
      expect(num).toMatch(/^RFP-/);
      counterBefore = parseInt(num.split('-')[1], 10);
      expect(counterBefore).toBeGreaterThan(0);
    });

    it('after setting prefix to RFQ, next RFP number starts with RFQ- and counter is strictly higher', async () => {
      await putProcurementSettings(sharedHttp, sharedToken, { documentPrefixRfp: 'RFQ' });

      const res = await request(sharedHttp)
        .post('/api/v1/procurement/rfps')
        .set(auth(sharedToken))
        .send({ title: `AE RFQ Test ${suffix}` })
        .expect(201);

      const num: string = (res.body as { rfpNumber: string }).rfpNumber;
      expect(num).toMatch(/^RFQ-/);

      const counterAfter = parseInt(num.split('-')[1], 10);
      // Counter must be strictly higher (never reset; only the prefix changed)
      expect(counterAfter).toBeGreaterThan(counterBefore);
    });

    it('2nd create under RFQ- prefix: counter incremented again (not reset)', async () => {
      const res1 = await request(sharedHttp)
        .post('/api/v1/procurement/rfps')
        .set(auth(sharedToken))
        .send({ title: `AE RFQ Test2a ${suffix}` })
        .expect(201);
      const num1: string = (res1.body as { rfpNumber: string }).rfpNumber;
      const c1 = parseInt(num1.split('-')[1], 10);

      const res2 = await request(sharedHttp)
        .post('/api/v1/procurement/rfps')
        .set(auth(sharedToken))
        .send({ title: `AE RFQ Test2b ${suffix}` })
        .expect(201);
      const num2: string = (res2.body as { rfpNumber: string }).rfpNumber;
      const c2 = parseInt(num2.split('-')[1], 10);

      // Counter strictly increasing
      expect(c2).toBe(c1 + 1);
    });
  });

  // ===========================================================================
  // Suite 2 — Default prefix (no setting override)
  // ===========================================================================
  describe('Default prefix — no documentPrefixRfp set', () => {
    beforeAll(async () => {
      // Ensure the prefix is the default 'RFP'
      await putProcurementSettings(sharedHttp, sharedToken, { documentPrefixRfp: 'RFP' });
    });

    it('RFP created with default settings uses RFP- prefix', async () => {
      const res = await request(sharedHttp)
        .post('/api/v1/procurement/rfps')
        .set(auth(sharedToken))
        .send({ title: `AE Default RFP ${suffix}` })
        .expect(201);
      const num: string = (res.body as { rfpNumber: string }).rfpNumber;
      expect(num).toMatch(/^RFP-/);
    });
  });

  // ===========================================================================
  // Suite 3 — Custom fields: RFP
  // ===========================================================================
  describe('Custom fields — RFP', () => {
    const entityType = 'RFP';
    const fieldKey = 'priorityLevel';

    afterAll(async () => {
      // Clear custom-field definitions so other suites are unaffected
      await request(sharedHttp)
        .put('/api/v1/procurement/custom-fields')
        .set(auth(sharedToken))
        .send({ entityType, definitions: [] })
        .expect(200);
    });

    it('PUT custom-field definitions: required SELECT field for RFP → 200', async () => {
      await request(sharedHttp)
        .put('/api/v1/procurement/custom-fields')
        .set(auth(sharedToken))
        .send({
          entityType,
          definitions: [
            {
              key: fieldKey,
              label: 'Priority Level',
              type: 'SELECT',
              required: true,
              showInList: true,
              sortOrder: 0,
              options: [
                { value: 'LOW', label: 'Low' },
                { value: 'HIGH', label: 'High' },
              ],
            },
          ],
        })
        .expect(200);
    });

    it('GET custom-field definitions returns the new field', async () => {
      const res = await request(sharedHttp)
        .get(`/api/v1/procurement/custom-fields?entityType=${entityType}`)
        .set(auth(sharedToken))
        .expect(200);
      const defs = res.body as { key: string }[];
      expect(defs.some((d) => d.key === fieldKey)).toBe(true);
    });

    it('create RFP without required custom field → 400', async () => {
      await request(sharedHttp)
        .post('/api/v1/procurement/rfps')
        .set(auth(sharedToken))
        .send({ title: `AE Missing Custom ${suffix}` })
        .expect(400);
    });

    it('create RFP with value outside allowed options → 400', async () => {
      await request(sharedHttp)
        .post('/api/v1/procurement/rfps')
        .set(auth(sharedToken))
        .send({
          title: `AE Bad Option ${suffix}`,
          customData: { [fieldKey]: 'INVALID_OPTION' },
        })
        .expect(400);
    });

    it('create RFP with valid option → 201, GET reflects customData', async () => {
      const res = await request(sharedHttp)
        .post('/api/v1/procurement/rfps')
        .set(auth(sharedToken))
        .send({
          title: `AE Valid Custom ${suffix}`,
          customData: { [fieldKey]: 'HIGH' },
        })
        .expect(201);

      const rfpId = (res.body as { id: string }).id;

      const detail = await request(sharedHttp)
        .get(`/api/v1/procurement/rfps/${rfpId}`)
        .set(auth(sharedToken))
        .expect(200);

      const customData = (detail.body as { customData: Record<string, unknown> }).customData;
      expect(customData).toBeTruthy();
      expect(customData[fieldKey]).toBe('HIGH');
    });
  });

  // ===========================================================================
  // Suite 4 — Tenant isolation: second tenant sees NO definitions
  // ===========================================================================
  describe('Tenant isolation — custom-field definitions', () => {
    let otherTenantId = '';
    let foreignFieldId = '';
    const otherSlug = `ae-proc-isol-${Date.now()}`;

    beforeAll(async () => {
      // Create a fabricated second tenant directly via Prisma
      const otherTenant = await sharedPrisma.tenant.create({
        data: { slug: otherSlug, name: `AE Proc Isol ${Date.now()}` },
      });
      otherTenantId = otherTenant.id;

      // Insert a CustomFieldDefinition belonging to the OTHER tenant
      const foreignDef = await sharedPrisma.customFieldDefinition.create({
        data: {
          tenantId: otherTenantId,
          module: 'procurement',
          entityType: 'RFP',
          key: 'foreignprocfield',
          label: 'Foreign Proc',
          type: 'TEXT',
          required: false,
          showInList: false,
          sortOrder: 0,
        },
      });
      foreignFieldId = foreignDef.id;

      // Ensure acme has at least one of its own RFP definitions
      await sharedPrisma.customFieldDefinition.upsert({
        where: {
          tenantId_module_entityType_key: {
            tenantId: sharedTenantId,
            module: 'procurement',
            entityType: 'RFP',
            key: 'rfpIsolTest',
          },
        },
        update: {},
        create: {
          tenantId: sharedTenantId,
          module: 'procurement',
          entityType: 'RFP',
          key: 'rfpIsolTest',
          label: 'RFP Isolation Test',
          type: 'TEXT',
          required: false,
          showInList: false,
          sortOrder: 0,
        },
      });
    });

    afterAll(async () => {
      if (foreignFieldId) {
        await sharedPrisma.customFieldDefinition
          .deleteMany({ where: { id: foreignFieldId } })
          .catch(() => undefined);
      }
      await sharedPrisma.customFieldDefinition
        .deleteMany({ where: { tenantId: sharedTenantId, key: 'rfpIsolTest' } })
        .catch(() => undefined);
      if (otherTenantId) {
        await sharedPrisma.tenant.deleteMany({ where: { id: otherTenantId } }).catch(() => undefined);
      }
    });

    it('acme GET /procurement/custom-fields does NOT see the foreign tenant definition', async () => {
      const res = await request(sharedHttp)
        .get('/api/v1/procurement/custom-fields?entityType=RFP')
        .set(auth(sharedToken))
        .expect(200);

      const defs = res.body as { key: string }[];
      const keys = defs.map((d) => d.key);
      // acme must NEVER see the foreign tenant's key
      expect(keys).not.toContain('foreignprocfield');
      // acme must see its own definition
      expect(keys).toContain('rfpIsolTest');
    });
  });
});
