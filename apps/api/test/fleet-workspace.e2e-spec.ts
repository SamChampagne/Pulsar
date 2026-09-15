import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('Fleet visual workspace (HTTP, isolated tenants)', () => {
  let app: INestApplication, db: PrismaService, http: any, tid: string, other: string;
  let token: string, reader: string, planner: string, vehicle: string, foreign: string;
  const slug = `fleet-ui-${Date.now()}`;
  const get = (path: string, t = token) =>
    request(http).get(`/api/v1/fleet/${path}`).set('Authorization', `Bearer ${t}`);
  const post = (path: string, body: object, t = token) =>
    request(http).post(`/api/v1/fleet/${path}`).set('Authorization', `Bearer ${t}`).send(body);
  const patch = (id: string, body: object, t = token) =>
    request(http)
      .patch(`/api/v1/fleet/maintenance-orders/${id}`)
      .set('Authorization', `Bearer ${t}`)
      .send(body);
  const newVehicle = async (status: any = 'AVAILABLE') =>
    (await db.vehicle.create({ data: { tenantId: tid, unitNumber: randomUUID(), status } })).id;
  const open = async (id: string, extra = {}) =>
    (
      await post('maintenance-orders', {
        vehicleId: id,
        type: 'REPAIR',
        description: 'Réparation de test',
        ...extra,
      }).expect(201)
    ).body;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentRuntimeService)
      .useValue({ killAgentSessions: async () => {}, closeSession: async () => {} })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();
    db = app.get(PrismaService);
    tid = (await db.tenant.create({ data: { slug, name: slug } })).id;
    other = (await db.tenant.create({ data: { slug: `${slug}-other`, name: 'Other' } })).id;
    for (const key of ['fleet', 'transportation']) {
      const m = await db.moduleDefinition.findUniqueOrThrow({ where: { key } });
      await db.tenantModule.create({ data: { tenantId: tid, moduleId: m.id, enabled: true } });
    }
    for (const mode of ['operator', 'reader', 'planner']) {
      const keys = [
        'fleet.read',
        ...(mode === 'operator' ? ['fleet.manage'] : []),
        ...(mode === 'planner' ? ['transportation.planning.read'] : []),
      ];
      const perms = await db.permission.findMany({ where: { key: { in: keys } } });
      expect(perms).toHaveLength(keys.length);
      const role = await db.role.create({
        data: {
          tenantId: tid,
          key: mode,
          name: mode,
          permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
        },
      });
      const email = `${mode}@${slug}.test`;
      await db.user.create({
        data: {
          tenantId: tid,
          email,
          firstName: 'Fleet',
          lastName: mode,
          status: 'ACTIVE',
          passwordHash: hashSync('Test1234!', 4),
          roles: { create: { roleId: role.id } },
        },
      });
      const login = await request(http)
        .post('/api/v1/auth/login')
        .send({ tenant: slug, email, password: 'Test1234!' })
        .expect(200);
      if (mode === 'operator') token = login.body.accessToken;
      if (mode === 'reader') reader = login.body.accessToken;
      if (mode === 'planner') planner = login.body.accessToken;
    }
    vehicle = (
      await db.vehicle.create({ data: { tenantId: tid, unitNumber: 'LOCAL-001', plate: 'ABC123' } })
    ).id;
    foreign = (await db.vehicle.create({ data: { tenantId: other, unitNumber: 'FOREIGN' } })).id;
    const carrier = await db.carrier.create({
      data: { tenantId: tid, code: 'EXT', name: 'External' },
    });
    await db.vehicle.create({
      data: { tenantId: tid, unitNumber: 'EXTERNAL', carrierId: carrier.id },
    });
    await db.trailer.create({ data: { tenantId: tid, unitNumber: 'TRAILER' } });
    await db.vehicle.createMany({
      data: Array.from({ length: 33 }, (_, i) => ({
        tenantId: tid,
        unitNumber: `PAGE-${String(i).padStart(2, '0')}`,
      })),
    });
    await db.load.create({ data: { tenantId: tid, loadNumber: 'LD-FLEET', vehicleId: vehicle } });
    await db.complianceDocument.create({
      data: {
        tenantId: tid,
        subjectType: 'VEHICLE',
        subjectId: vehicle,
        docType: 'INSURANCE',
        expiresAt: new Date('2020-01-01'),
      },
    });
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it('paginates assets with exact counts, ownership and tenant isolation, without TMS permission', async () => {
    const first = (await get('workspace?pageSize=30', reader).expect(200)).body;
    expect(first.total).toBe(34);
    expect(first.summary.total).toBe(34);
    expect(first.items).toHaveLength(30);
    const second = (await get('workspace?pageSize=30&page=2', reader).expect(200)).body;
    expect(second.items).toHaveLength(4);
    expect(new Set([...first.items, ...second.items].map((a) => a.id)).size).toBe(34);
    expect((await get('workspace?ownership=all').expect(200)).body.total).toBe(35);
    expect((await get('workspace?kind=trailer').expect(200)).body.total).toBe(1);
    const found = (await get('workspace?search=abc123').expect(200)).body;
    expect(found.total).toBe(1);
    expect(found.items[0].expiredDocuments).toBe(1);
    expect(found.items[0]).not.toHaveProperty('tenantId');
    expect(found.items[0]).not.toHaveProperty('carrierId');
    expect((await get('workspace?search=FOREIGN').expect(200)).body.total).toBe(0);
  });
  it('rejects foreign assets, malformed filters and unpermitted writes', async () => {
    await get(`workspace/assets/vehicle/${foreign}`).expect(404);
    await get('workspace?kind=driver').expect(400);
    await get('workspace/orders?from=2026-02-30').expect(400);
    await get('workspace/order-fields', reader).expect(403);
    await get('workspace/order-fields').expect(200);
    await post(
      'maintenance-orders',
      { vehicleId: vehicle, type: 'REPAIR', description: 'Denied' },
      reader,
    ).expect(403);
    await post('maintenance-orders', {
      vehicleId: foreign,
      type: 'REPAIR',
      description: 'Foreign',
    }).expect(400);
    await post('maintenance-orders', {
      tenantId: other,
      vehicleId: vehicle,
      type: 'REPAIR',
      description: 'Spoof',
    }).expect(400);
  });
  it('only exposes TMS context to a planner when transportation is enabled', async () => {
    expect(
      (await get(`workspace/assets/vehicle/${vehicle}`, reader).expect(200)).body.transport,
    ).toBeNull();
    const detail = (await get(`workspace/assets/vehicle/${vehicle}`, planner).expect(200)).body;
    expect(detail.transport.items.map((l: any) => l.loadNumber)).toEqual(['LD-FLEET']);
    expect(detail.documents.items[0].status).toBe('EXPIRED');
    const module = await db.moduleDefinition.findUniqueOrThrow({
      where: { key: 'transportation' },
    });
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId: tid, moduleId: module.id } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tid);
    expect(
      (await get(`workspace/assets/vehicle/${vehicle}`, planner).expect(200)).body.transport,
    ).toBeNull();
  });
  it('reports seven UTC days, overdue, undated and paginated history independently', async () => {
    const v = await newVehicle();
    await open(v, { dueDate: '2026-09-14T00:00:00Z' });
    await open(v, { dueDate: '2026-09-20T23:59:59Z' });
    await open(v, { dueDate: '2026-09-21T00:00:00Z' });
    await open(v, { dueDate: '2026-09-13T23:59:59Z' });
    const undated = await open(v);
    const a = (await get('workspace/orders?from=2026-09-14&pageSize=1').expect(200)).body;
    expect(a.counts).toEqual({ dated: 2, overdue: 1, undated: 1, history: 0 });
    expect(a.items).toHaveLength(1);
    expect(a.total).toBe(2);
    expect(a.days.map((d: any) => d.count)).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(a.days.reduce((s: number, d: any) => s + d.count, 0)).toBe(a.counts.dated);
    await post(`maintenance-orders/${undated.id}/cancel`, {}).expect(201);
    const history = (
      await get('workspace/orders?from=2026-09-14&bucket=history', reader).expect(200)
    ).body;
    expect(history.total).toBe(1);
    expect(history.items[0].status).toBe('CANCELLED');
  });
  it('keeps an asset immobilized until all orders are closed, including concurrent completion', async () => {
    const v = await newVehicle();
    const a = await open(v);
    const b = await open(v);
    const c = await open(v);
    await post(`maintenance-orders/${a.id}/complete`, {}).expect(201);
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: v } })).status).toBe('MAINTENANCE');
    await Promise.all([
      post(`maintenance-orders/${b.id}/complete`, {}).expect(201),
      post(`maintenance-orders/${c.id}/cancel`, {}).expect(201),
    ]);
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: v } })).status).toBe('AVAILABLE');
  });
  it('serializes create versus final close without leaving an active order on an available asset', async () => {
    const v = await newVehicle(),
      a = await open(v);
    await Promise.all([post(`maintenance-orders/${a.id}/complete`, {}).expect(201), open(v)]);
    expect(
      await db.maintenanceOrder.count({ where: { tenantId: tid, vehicleId: v, status: 'OPEN' } }),
    ).toBe(1);
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: v } })).status).toBe('MAINTENANCE');
  });
  it('version-checks competing edits and stale actions; nullable due date remains supported', async () => {
    const v = await newVehicle(),
      a = await open(v);
    await patch(a.id, { description: null }).expect(400);
    await patch(a.id, { description: '   ' }).expect(400);
    const replies = await Promise.all(
      ['2026-10-01', '2026-10-02'].map((day) =>
        patch(a.id, { dueDate: `${day}T00:00:00Z`, expectedUpdatedAt: a.updatedAt }),
      ),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    await post(`maintenance-orders/${a.id}/start`, { expectedUpdatedAt: a.updatedAt }).expect(409);
    const current = (await get(`maintenance-orders/${a.id}`).expect(200)).body;
    const cleared = (
      await patch(a.id, { dueDate: null, expectedUpdatedAt: current.updatedAt }).expect(200)
    ).body;
    expect(cleared.dueDate).toBeNull();
    await patch(a.id, { description: 'Denied' }, reader).expect(403);
    await post(`maintenance-orders/${a.id}/complete`, { costAmount: -1 }).expect(400);
    await post(`maintenance-orders/${a.id}/complete`, { costAmount: 12.345 }).expect(400);
    await post(`maintenance-orders/${a.id}/complete`, {
      costAmount: 125.5,
      costCurrency: 'CAD',
      odometerKm: 1000,
      expectedUpdatedAt: cleared.updatedAt,
    }).expect(201);
    await patch(a.id, { description: 'Closed' }).expect(409);
    expect(
      await db.auditLog.count({ where: { tenantId: tid, entityId: a.id, action: 'UPDATE' } }),
    ).toBe(2);
  });
  it('does not revive a retired asset', async () => {
    const v = await newVehicle('RETIRED'),
      a = await open(v);
    await post(`maintenance-orders/${a.id}/cancel`, {}).expect(201);
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: v } })).status).toBe('RETIRED');
  });
  it('generates one active work order per preventive plan under simultaneous requests', async () => {
    const v = await newVehicle();
    const plan = await db.maintenanceSchedule.create({
      data: {
        tenantId: tid,
        vehicleId: v,
        name: 'Inspection',
        type: 'INSPECTION',
        intervalDays: 30,
        anchorDate: new Date(),
      },
    });
    const results = await Promise.all([
      post(`maintenance-schedules/${plan.id}/generate-order`, {}).expect(201),
      post(`maintenance-schedules/${plan.id}/generate-order`, {}).expect(201),
    ]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(await db.maintenanceOrder.count({ where: { tenantId: tid, scheduleId: plan.id } })).toBe(
      1,
    );
  });
  it('gates all workspace routes when fleet is disabled', async () => {
    const m = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'fleet' } });
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId: tid, moduleId: m.id } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tid);
    for (const path of [
      'workspace',
      'workspace/orders',
      'workspace/order-fields',
      `workspace/assets/vehicle/${vehicle}`,
    ])
      await get(path).expect(403);
  });
});
