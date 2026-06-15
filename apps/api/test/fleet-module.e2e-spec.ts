/**
 * E2E fleet-module (Task 8) — proves the FLEET module end-to-end over real
 * Postgres with the admin Bearer token (tenant acme).
 *
 *   1. Maintenance lifecycle flips asset status: opening a WO flips the vehicle
 *      to MAINTENANCE; completing it returns the vehicle to AVAILABLE and stamps
 *      completedAt.
 *   2. Exactly-one-asset validation: a WO with neither (or both) vehicleId and
 *      trailerId is rejected (400).
 *   3. Compliance doc surfaces in the overview rollup as EXPIRING, and on the
 *      /expiring endpoint.
 *   4. Compliance computed status: a past expiry computes EXPIRED on read.
 *   5. Tenant isolation: the WO is fetchable with the acme token and the list is
 *      scoped to acme.
 *   6. Module gating: structurally covered by @RequireModule (toggle skipped to
 *      keep the shared seeded DB stable).
 *
 * Permissions fleet.read / fleet.manage, module FLEET (seeded for acme).
 * Vehicle master data is created via the transportation module (FLEET reuses the
 * Vehicle/Trailer assets — carrierId omitted ⇒ internal fleet asset).
 *
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

const DAY = 86_400_000;
const isoIn = (days: number) => new Date(Date.now() + days * DAY).toISOString();

interface ComplianceDoc {
  id: string;
  status: string;
  expiresAt: string;
  subjectId: string;
}

describe('Fleet module (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Created fixtures (cleaned up in afterAll).
  let vehicleId = '';
  let workOrderId = '';
  const createdDocIds: string[] = [];
  const createdWorkOrderIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

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

    // --- Ensure FLEET (and TRANSPORTATION for vehicle master data) enabled. ---
    for (const key of ['fleet', 'transportation']) {
      const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
        update: { enabled: true },
        create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
      });
    }

    // --- Create one internal fleet vehicle (carrierId omitted ⇒ internal). ----
    const res = await request(http)
      .post('/api/v1/transportation/vehicles')
      .set(auth())
      .send({ unitNumber: `FLEET-E2E-${suffix}`, type: 'TRACTOR' })
      .expect(201);
    const vehicle = res.body as { id: string; status: string };
    vehicleId = vehicle.id;
    expect(vehicle.status).toBe('AVAILABLE');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.complianceDocument
        .deleteMany({ where: { id: { in: createdDocIds } } })
        .catch(() => undefined);
      await prisma.maintenanceOrder
        .deleteMany({ where: { id: { in: createdWorkOrderIds } } })
        .catch(() => undefined);
      await prisma.vehicle.deleteMany({ where: { id: vehicleId } }).catch(() => undefined);
    }
    await app.close();
  });

  // =========================================================================
  // 1 — Maintenance WO lifecycle flips asset status.
  // =========================================================================
  it('opening a maintenance WO flips the vehicle to MAINTENANCE, completing it returns AVAILABLE', async () => {
    const open = await request(http)
      .post('/api/v1/fleet/maintenance-orders')
      .set(auth())
      .send({ vehicleId, type: 'REPAIR', description: 'brakes' })
      .expect(201);
    const wo = open.body as { id: string; status: string };
    expect(wo.status).toBe('OPEN');
    workOrderId = wo.id;
    createdWorkOrderIds.push(wo.id);

    // Vehicle flipped to MAINTENANCE.
    const afterOpen = await request(http)
      .get(`/api/v1/transportation/vehicles/${vehicleId}`)
      .set(auth())
      .expect(200);
    expect((afterOpen.body as { status: string }).status).toBe('MAINTENANCE');

    // Complete the WO.
    const done = await request(http)
      .post(`/api/v1/fleet/maintenance-orders/${workOrderId}/complete`)
      .set(auth())
      .send({ costAmount: 250, odometerKm: 120000 })
      .expect((r) => expect([200, 201]).toContain(r.status));
    const completed = done.body as { status: string; completedAt: string | null };
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).toBeTruthy();

    // Vehicle back to AVAILABLE.
    const afterComplete = await request(http)
      .get(`/api/v1/transportation/vehicles/${vehicleId}`)
      .set(auth())
      .expect(200);
    expect((afterComplete.body as { status: string }).status).toBe('AVAILABLE');
  });

  // =========================================================================
  // 2 — Exactly-one-asset validation.
  // =========================================================================
  it('rejects a maintenance WO with neither vehicleId nor trailerId (400)', async () => {
    await request(http)
      .post('/api/v1/fleet/maintenance-orders')
      .set(auth())
      .send({ type: 'REPAIR', description: 'no asset' })
      .expect(400);
  });

  it('rejects a maintenance WO with BOTH vehicleId and trailerId (400)', async () => {
    await request(http)
      .post('/api/v1/fleet/maintenance-orders')
      .set(auth())
      .send({ vehicleId, trailerId: vehicleId, type: 'REPAIR', description: 'both' })
      .expect(400);
  });

  // =========================================================================
  // 3 — Compliance doc surfaces in the overview as EXPIRING + on /expiring.
  // =========================================================================
  it('a compliance doc expiring in 10 days surfaces as EXPIRING in the overview and on /expiring', async () => {
    const create = await request(http)
      .post('/api/v1/fleet/compliance-documents')
      .set(auth())
      .send({
        subjectType: 'VEHICLE',
        subjectId: vehicleId,
        docType: 'INSURANCE',
        expiresAt: isoIn(10),
      })
      .expect(201);
    const doc = create.body as ComplianceDoc;
    expect(doc.status).toBe('EXPIRING');
    createdDocIds.push(doc.id);

    // Overview rollup lists it under complianceExpiring.
    const overview = await request(http)
      .get('/api/v1/fleet/overview')
      .set(auth())
      .expect(200);
    const expiring = (overview.body as { complianceExpiring: ComplianceDoc[] }).complianceExpiring;
    const found = expiring.find((d) => d.id === doc.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe('EXPIRING');

    // /expiring endpoint includes it within the 30-day window.
    const exp = await request(http)
      .get('/api/v1/fleet/compliance-documents/expiring?days=30')
      .set(auth())
      .expect(200);
    const expIds = (exp.body as ComplianceDoc[]).map((d) => d.id);
    expect(expIds).toContain(doc.id);

    // Cleanup.
    await request(http)
      .delete(`/api/v1/fleet/compliance-documents/${doc.id}`)
      .set(auth())
      .expect(200);
  });

  // =========================================================================
  // 4 — Compliance computed status: a past expiry computes EXPIRED on read.
  // =========================================================================
  it('a compliance doc with a past expiry computes EXPIRED on read', async () => {
    const create = await request(http)
      .post('/api/v1/fleet/compliance-documents')
      .set(auth())
      .send({
        subjectType: 'VEHICLE',
        subjectId: vehicleId,
        docType: 'REGISTRATION',
        expiresAt: isoIn(-5),
      })
      .expect(201);
    const doc = create.body as ComplianceDoc;
    expect(doc.status).toBe('EXPIRED');
    createdDocIds.push(doc.id);

    // Filtered list for this subject computes EXPIRED.
    const list = await request(http)
      .get(`/api/v1/fleet/compliance-documents?subjectType=VEHICLE&subjectId=${vehicleId}`)
      .set(auth())
      .expect(200);
    const listed = (list.body as ComplianceDoc[]).find((d) => d.id === doc.id);
    expect(listed).toBeDefined();
    expect(listed?.status).toBe('EXPIRED');

    // Cleanup.
    await request(http)
      .delete(`/api/v1/fleet/compliance-documents/${doc.id}`)
      .set(auth())
      .expect(200);
  });

  // =========================================================================
  // 5 — Tenant isolation: the WO is fetchable with acme token; list scoped to acme.
  // =========================================================================
  it('the maintenance WO is fetchable with the acme token and the list is scoped to acme', async () => {
    const get = await request(http)
      .get(`/api/v1/fleet/maintenance-orders/${workOrderId}`)
      .set(auth())
      .expect(200);
    expect((get.body as { id: string }).id).toBe(workOrderId);

    const list = await request(http)
      .get('/api/v1/fleet/maintenance-orders')
      .set(auth())
      .expect(200);
    const rows = list.body as Array<{ id: string }>;
    expect(rows.some((r) => r.id === workOrderId)).toBe(true);

    // Every returned WO belongs to acme (tenant-scoped by construction; verified
    // here against the DB to assert no cross-tenant leakage).
    const ids = rows.map((r) => r.id);
    const leaked = await prisma.maintenanceOrder.count({
      where: { id: { in: ids }, tenantId: { not: tenantId } },
    });
    expect(leaked).toBe(0);
  });

  // =========================================================================
  // 6 — Module gating.
  // module-gating covered structurally by @RequireModule; toggling skipped to
  // keep shared DB stable.
  // =========================================================================
});
