/**
 * E2E dispatch-plans (Continuous Planning v1) — versioned PlanProposal/PlanCommit.
 *
 * Proves the dispatch-plan lifecycle over real Postgres with the admin Bearer token:
 *   1. create DRAFT plan of a consolidation item (shipment ownership validated).
 *   2. diff   read-only preview reports the item as committable.
 *   3. propose DRAFT → PROPOSED (claim-guarded).
 *   4. commit PROPOSED → COMMITTED reusing LoadsService.consolidate: a load is created,
 *      shipments become PLANNED + assigned + legs, item.resultLoadId is set.
 *   5. double-commit is rejected (409) — claim is race-safe.
 *   6. stale item: a plan whose shipment got assigned elsewhere commits to COMMITTED but
 *      records item.error (best-effort) without crashing.
 *   7. ownership/not-found: a bogus shipmentId rejects create (400); unknown id 404s.
 *
 * Permission transportation.planning.read|manage, module TRANSPORTATION (seeded for acme).
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

interface PlanResponse {
  id: string;
  planNumber: string;
  status: string;
  items: Array<{ id: string; shipmentIds: string[]; resultLoadId: string | null; error: string | null }>;
}

describe('Dispatch plans / Continuous Planning (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  let customerId = '';
  let originId = '';
  let destId = '';
  let orderId = '';
  let s1 = '';
  let s2 = '';
  let s3 = '';
  const planIds: string[] = [];
  const createdLoadIds: string[] = [];

  async function seedShipment(label: string): Promise<string> {
    const sh = await prisma.shipment.create({
      data: {
        tenantId,
        shipmentNumber: `SH-DP-${label}-${suffix}`,
        transportOrderId: orderId,
        originLocationId: originId,
        destinationLocationId: destId,
        status: 'PENDING',
        weightKg: 800,
        palletCount: 3,
      },
    });
    return sh.id;
  }

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

    const tmsModule = await prisma.moduleDefinition.findUniqueOrThrow({
      where: { key: 'transportation' },
    });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: tmsModule.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: tmsModule.id, enabled: true, enabledAt: new Date() },
    });

    const customer = await prisma.customer.create({
      data: { tenantId, code: `DP-CUST-${suffix}`, name: `DP Customer ${suffix}` },
    });
    customerId = customer.id;
    const origin = await prisma.location.create({
      data: { tenantId, code: `DP-ORIG-${suffix}`, name: 'DP Origin', addressLine1: '1 St', city: 'Montreal', country: 'CA' },
    });
    originId = origin.id;
    const dest = await prisma.location.create({
      data: { tenantId, code: `DP-DEST-${suffix}`, name: 'DP Dest', addressLine1: '2 Ave', city: 'Toronto', country: 'CA' },
    });
    destId = dest.id;
    const order = await prisma.transportOrder.create({
      data: { tenantId, orderNumber: `TO-DP-${suffix}`, customerId, originLocationId: originId, destinationLocationId: destId },
    });
    orderId = order.id;

    s1 = await seedShipment('1');
    s2 = await seedShipment('2');
    s3 = await seedShipment('3');
  });

  afterAll(async () => {
    if (prisma) {
      const shipmentIds = [s1, s2, s3].filter(Boolean);
      await prisma.dispatchPlanItem.deleteMany({ where: { planId: { in: planIds } } }).catch(() => undefined);
      await prisma.dispatchPlan.deleteMany({ where: { id: { in: planIds } } }).catch(() => undefined);
      await prisma.shipmentLoadLeg.deleteMany({ where: { shipmentId: { in: shipmentIds } } }).catch(() => undefined);
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } }).catch(() => undefined);
      await prisma.load.deleteMany({ where: { id: { in: createdLoadIds } } }).catch(() => undefined);
      await prisma.transportOrder.deleteMany({ where: { id: orderId } }).catch(() => undefined);
      await prisma.location.deleteMany({ where: { id: { in: [originId, destId] } } }).catch(() => undefined);
      await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    }
    await app.close();
  });

  let planId = '';

  it('S1: create a DRAFT plan with one consolidation item', async () => {
    const res = await request(http)
      .post('/api/v1/transportation/dispatch-plans')
      .set(auth())
      .send({ items: [{ shipmentIds: [s1, s2] }], note: 'e2e plan' })
      .expect(201);
    const plan = res.body as PlanResponse;
    expect(plan.id).toBeTruthy();
    expect(plan.planNumber).toMatch(/^PLAN-/);
    expect(plan.status).toBe('DRAFT');
    expect(plan.items).toHaveLength(1);
    planId = plan.id;
    planIds.push(planId);
  });

  it('S2: diff reports the item as committable', async () => {
    const res = await request(http)
      .get(`/api/v1/transportation/dispatch-plans/${planId}/diff`)
      .set(auth())
      .expect(200);
    const diff = res.body as { committable: boolean; items: Array<{ committable: boolean }> };
    expect(diff.committable).toBe(true);
    expect(diff.items[0].committable).toBe(true);
  });

  it('S3: propose moves DRAFT → PROPOSED', async () => {
    const res = await request(http)
      .post(`/api/v1/transportation/dispatch-plans/${planId}/propose`)
      .set(auth())
      .expect(201);
    expect((res.body as PlanResponse).status).toBe('PROPOSED');
  });

  it('S4: commit creates a load, assigns shipments, sets resultLoadId', async () => {
    const res = await request(http)
      .post(`/api/v1/transportation/dispatch-plans/${planId}/commit`)
      .set(auth())
      .expect(201);
    const plan = res.body as PlanResponse;
    expect(plan.status).toBe('COMMITTED');
    const loadId = plan.items[0].resultLoadId;
    expect(loadId).toBeTruthy();
    expect(plan.items[0].error).toBeNull();
    createdLoadIds.push(loadId!);

    const shipments = await prisma.shipment.findMany({
      where: { id: { in: [s1, s2] } },
      select: { loadId: true, status: true },
    });
    for (const sh of shipments) {
      expect(sh.loadId).toBe(loadId);
      expect(sh.status).toBe('PLANNED');
    }
    const legs = await prisma.shipmentLoadLeg.findMany({ where: { loadId: loadId!, shipmentId: { in: [s1, s2] } } });
    expect(legs).toHaveLength(2);
  });

  it('S5: double-commit is rejected (409)', async () => {
    await request(http)
      .post(`/api/v1/transportation/dispatch-plans/${planId}/commit`)
      .set(auth())
      .expect(409);
  });

  it('S6: a stale item commits the plan but records item.error without crashing', async () => {
    // Assign s3 elsewhere first so the plan item becomes stale.
    const pre = await request(http)
      .post('/api/v1/transportation/loads/consolidate')
      .set(auth())
      .send({ shipmentIds: [s3] })
      .expect(201);
    createdLoadIds.push((pre.body as { id: string }).id);

    const created = await request(http)
      .post('/api/v1/transportation/dispatch-plans')
      .set(auth())
      .send({ items: [{ shipmentIds: [s3] }] })
      .expect(201);
    const stalePlan = created.body as PlanResponse;
    planIds.push(stalePlan.id);

    await request(http)
      .post(`/api/v1/transportation/dispatch-plans/${stalePlan.id}/propose`)
      .set(auth())
      .expect(201);

    const committed = await request(http)
      .post(`/api/v1/transportation/dispatch-plans/${stalePlan.id}/commit`)
      .set(auth())
      .expect(201);
    const plan = committed.body as PlanResponse;
    expect(plan.status).toBe('COMMITTED');
    expect(plan.items[0].resultLoadId).toBeNull();
    expect(plan.items[0].error).toBeTruthy();
  });

  it('S7: create with a bogus shipmentId rejects (400); unknown plan id 404s', async () => {
    await request(http)
      .post('/api/v1/transportation/dispatch-plans')
      .set(auth())
      .send({ items: [{ shipmentIds: ['bogus-shipment-id'] }] })
      .expect(400);

    await request(http)
      .get('/api/v1/transportation/dispatch-plans/bogus-plan-id')
      .set(auth())
      .expect(404);
  });
});
