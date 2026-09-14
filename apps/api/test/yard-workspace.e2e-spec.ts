/** Real HTTP, isolated test tenant. No mutations of the development/demo yard. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';

describe('Yard visual workspace (e2e)', () => {
  let app: INestApplication,
    prisma: PrismaService,
    http: any,
    tenantId: string,
    otherTenant: string;
  let site: string,
    otherSite: string,
    foreignSite: string,
    door: string,
    parking: string,
    remoteDoor: string;
  let token: string, reader: string;
  const suffix = `yard-workspace-${Date.now()}`;
  let n = 0;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (p: string, body = {}) =>
    request(http).post(`/api/v1/yard/${p}`).set(auth()).send(body);
  const get = (p: string) => request(http).get(`/api/v1/yard/${p}`).set(auth());
  const put = (p: string, body: object) =>
    request(http).put(`/api/v1/yard/${p}`).set(auth()).send(body);
  const snapshot = () => get(`workspace?locationId=${site}&date=2026-09-14`);
  const visit = async (extra = {}) =>
    (await post('visits', { locationId: site, trailerRef: `RF-${++n}`, ...extra }).expect(201))
      .body;
  const spot = async () =>
    (await post('spots', { locationId: site, code: `DOOR-${++n}`, type: 'DOCK_DOOR' }).expect(201))
      .body;
  const window = { windowStart: '2026-09-14T14:00:00Z', windowEnd: '2026-09-14T15:00:00Z' };
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
    prisma = app.get(PrismaService);
    tenantId = (await prisma.tenant.create({ data: { slug: suffix, name: suffix } })).id;
    otherTenant = (await prisma.tenant.create({ data: { slug: `${suffix}-other`, name: 'Other' } }))
      .id;
    const module = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'yard' } });
    await prisma.tenantModule.create({
      data: {
        tenantId,
        moduleId: module.id,
        enabled: true,
        settings: { spotConflictPolicy: 'WARN' },
      },
    });
    const permissions = await prisma.permission.findMany({ where: { module: 'yard' } });
    for (const limited of [false, true]) {
      const role = await prisma.role.create({
        data: {
          tenantId,
          key: limited ? 'reader' : 'yard-operator',
          name: 'Yard test',
          permissions: {
            create: permissions
              .filter((p) => !limited || p.key === 'yard.read')
              .map((p) => ({ permissionId: p.id })),
          },
        },
      });
      const email = `${limited ? 'reader' : 'admin'}@${suffix}.test`;
      await prisma.user.create({
        data: {
          tenantId,
          email,
          passwordHash: hashSync('Test1234!', 4),
          firstName: 'Yard',
          lastName: 'Test',
          status: 'ACTIVE',
          roles: { create: [{ roleId: role.id }] },
        },
      });
      const res = await request(http)
        .post('/api/v1/auth/login')
        .send({ tenant: suffix, email, password: 'Test1234!' })
        .expect(200);
      if (limited) reader = res.body.accessToken;
      else token = res.body.accessToken;
    }
    const makeSite = async (tid: string, code: string) =>
      (
        await prisma.location.create({
          data: {
            tenantId: tid,
            code,
            name: code,
            addressLine1: '1 Test',
            city: 'Québec',
            type: 'WAREHOUSE',
            timezone: 'America/Toronto',
          },
        })
      ).id;
    site = await makeSite(tenantId, 'DC-A');
    otherSite = await makeSite(tenantId, 'DC-B');
    foreignSite = await makeSite(otherTenant, 'FOREIGN');
    door = (await spot()).id;
    parking = (await post('spots', { locationId: site, code: 'PARK', type: 'PARKING' }).expect(201))
      .body.id;
    remoteDoor = (
      await post('spots', { locationId: otherSite, code: 'REMOTE', type: 'DOCK_DOOR' }).expect(201)
    ).body.id;
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
  });

  it('works with only Yard permissions/module and excludes other tenants/sites', async () => {
    const res = await get('sites').expect(200);
    expect(res.body.items.map((s: any) => s.id)).toEqual(expect.arrayContaining([site, otherSite]));
    expect(res.body.items.some((s: any) => s.id === foreignSite)).toBe(false);
    const w = (await snapshot().expect(200)).body;
    expect(w.spots).toHaveLength(2);
    expect(w.spots.some((s: any) => s.id === remoteDoor)).toBe(false);
    expect(w.start).toBe('2026-09-14T04:00:00.000Z');
    expect(w.timeZone).toBe('America/Toronto');
    await get(`workspace?locationId=${foreignSite}`).expect(404);
  });
  it('persists a display-only plan with no visit/move mutations and rejects a stale save', async () => {
    const w = (await snapshot()).body;
    const before = await prisma.yardMove.count({ where: { tenantId } });
    const body = {
      expectedVersion: w.planVersion,
      shapes: [
        {
          id: 'building',
          kind: 'BUILDING',
          label: 'Entrepôt nord',
          x: 0,
          y: 0,
          width: 5,
          height: 2,
        },
      ],
      positions: w.spots.map((s: any, i: number) => ({ id: s.id, posX: i, posY: 2 })),
    };
    await put(`sites/${site}/plan`, body).expect(200);
    const after = (await snapshot()).body;
    expect(after.shapes[0].label).toBe('Entrepôt nord');
    expect(after.spots[0].posY).toBe(2);
    expect(await prisma.yardMove.count({ where: { tenantId } })).toBe(before);
    await put(`sites/${site}/plan`, body).expect(409);
    expect(
      await prisma.auditLog.count({ where: { tenantId, entityType: 'yard-plan', entityId: site } }),
    ).toBe(1);
  });
  it('rejects invalid geometry, repeated cells, wrong-site IDs and missing permissions', async () => {
    const w = (await snapshot()).body,
      body = {
        expectedVersion: w.planVersion,
        shapes: w.shapes,
        positions: w.spots.map((s: any) => ({ id: s.id, posX: s.posX, posY: s.posY })),
      };
    await put(`sites/${site}/plan`, { ...body, shapes: [{ ...w.shapes[0], x: 63 }] }).expect(400);
    await put(`sites/${site}/plan`, {
      ...body,
      positions: body.positions.map((p: any) => ({ ...p, posX: 1, posY: 1 })),
    }).expect(400);
    await put(`sites/${site}/plan`, {
      ...body,
      positions: [{ id: remoteDoor, posX: 1, posY: 1 }],
    }).expect(400);
    await request(http)
      .put(`/api/v1/yard/sites/${site}/plan`)
      .set({ Authorization: `Bearer ${reader}` })
      .send(body)
      .expect(403);
    await get(`workspace?locationId=${site}&date=2026-02-30`).expect(400);
  });
  it('shows bookings overlapping the site-local day, not an arbitrary first-100 history', async () => {
    await post('appointments', {
      locationId: site,
      spotId: door,
      ...window,
      reference: 'TODAY',
    }).expect(201);
    await post('appointments', {
      locationId: site,
      spotId: door,
      windowStart: '2026-09-14T03:00:00Z',
      windowEnd: '2026-09-14T05:00:00Z',
      reference: 'OVERNIGHT',
    }).expect(201);
    await post('appointments', {
      locationId: otherSite,
      spotId: remoteDoor,
      ...window,
      reference: 'OTHER',
    }).expect(201);
    expect((await snapshot()).body.appointments.map((a: any) => a.reference).sort()).toEqual([
      'OVERNIGHT',
      'TODAY',
    ]);
  });
  it('rejects same-tenant wrong-site and inactive assignments and foreign-tenant targets', async () => {
    const v = await visit();
    await post(`visits/${v.id}/assign`, { spotId: remoteDoor }).expect(400);
    const off = await spot();
    await prisma.yardSpot.updateMany({
      where: { tenantId, id: off.id },
      data: { isActive: false },
    });
    await post(`visits/${v.id}/assign`, { spotId: off.id }).expect(400);
    const foreign = await prisma.yardSpot.create({
      data: { tenantId: otherTenant, locationId: foreignSite, code: 'FOREIGN' },
    });
    await post(`visits/${v.id}/assign`, { spotId: foreign.id }).expect(400);
    expect(await prisma.yardMove.count({ where: { tenantId, visitId: v.id } })).toBe(0);
  });
  it('serializes two competing assignments even under the legacy WARN setting', async () => {
    const s = await spot(),
      a = await visit(),
      b = await visit();
    const results = await Promise.all([
      post(`visits/${a.id}/assign`, { spotId: s.id }),
      post(`visits/${b.id}/assign`, { spotId: s.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.yardVisit.count({ where: { tenantId, spotId: s.id } })).toBe(1);
  });
  it('moves, retries idempotently, checks out and never resurrects a departed visit', async () => {
    const s = await spot(),
      t = await spot(),
      v = await visit({ spotId: s.id });
    await post(`visits/${v.id}/move`, { spotId: t.id }).expect(201);
    await post(`visits/${v.id}/move`, { spotId: t.id }).expect(201);
    expect(await prisma.yardMove.count({ where: { tenantId, visitId: v.id } })).toBe(2);
    await post(`visits/${v.id}/check-out`).expect(201);
    await post(`visits/${v.id}/assign`, { spotId: s.id }).expect(400);
    const result = (await get(`visits/${v.id}`)).body;
    expect(result.status).toBe('DEPARTED');
    expect(result.spotId).toBeNull();
    expect(result.moves.at(-1).fromSpot.code).toBe(t.code);
  });
  it('serializes checkout against assignment, and cancellation writes the final move', async () => {
    const s = await spot(),
      t = await spot(),
      v = await visit({ spotId: s.id });
    await Promise.all([
      post(`visits/${v.id}/move`, { spotId: t.id }),
      post(`visits/${v.id}/check-out`),
    ]);
    expect((await get(`visits/${v.id}`)).body).toMatchObject({ status: 'DEPARTED', spotId: null });
    const cancel = await visit({ spotId: s.id });
    await post(`visits/${cancel.id}/cancel`).expect(201);
    const result = (await get(`visits/${cancel.id}`)).body;
    expect(result.spotId).toBeNull();
    expect(result.moves.at(-1).note).toBe('Visite annulée');
  });
  it('arrival links one appointment, refuses wrong sites and duplicate arrivals', async () => {
    const a = (await post('appointments', { locationId: site, spotId: door, ...window })).body;
    await post('visits', { locationId: otherSite, appointmentId: a.id }).expect(400);
    await visit({ appointmentId: a.id });
    expect((await get(`appointments/${a.id}`)).body.status).toBe('ARRIVED');
    await post('visits', { locationId: site, appointmentId: a.id }).expect(409);
    await post('appointments', { locationId: site, spotId: remoteDoor, ...window }).expect(400);
    await post('appointments', { locationId: site, spotId: parking, ...window }).expect(400);
  });
});
