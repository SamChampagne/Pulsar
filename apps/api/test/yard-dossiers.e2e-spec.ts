import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';

describe('Yard connected dossiers (HTTP)', () => {
  let app: INestApplication, db: PrismaService, http: any, tenantId: string, foreignTenant: string;
  let site: string,
    otherSite: string,
    foreignSite: string,
    token: string,
    yardOnly: string,
    reader: string;
  let loadId: string,
    receiptId: string,
    pickId: string,
    remoteReceipt: string,
    foreignReceipt: string;
  const slug = `yard-links-${Date.now()}`;
  let seq = 0;
  const headers = (t = token) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t = token) => request(http).get(`/api/v1/yard/${p}`).set(headers(t));
  const post = (p: string, body: object, t = token) =>
    request(http).post(`/api/v1/yard/${p}`).set(headers(t)).send(body);
  const del = (p: string, t = token) => request(http).delete(`/api/v1/yard/${p}`).set(headers(t));
  const visit = async (extra = {}) =>
    (
      await post('visits', {
        locationId: site,
        trailerRef: `RF-${++seq}`,
        direction: 'OTHER',
        ...extra,
      }).expect(201)
    ).body;
  const appointment = async (extra = {}) =>
    (
      await post('appointments', {
        locationId: site,
        direction: 'OTHER',
        windowStart: '2026-09-14T14:00:00Z',
        windowEnd: '2026-09-14T16:00:00Z',
        ...extra,
      }).expect(201)
    ).body;
  const link = (source: string, kind: string, targetId: string, t = token) =>
    post(`dossiers/${source}/links`, { kind, targetId }, t);
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
    tenantId = (await db.tenant.create({ data: { slug, name: slug } })).id;
    foreignTenant = (await db.tenant.create({ data: { slug: `${slug}-foreign`, name: 'Foreign' } }))
      .id;
    for (const key of ['yard', 'wms', 'transportation']) {
      const mod = await db.moduleDefinition.findUniqueOrThrow({ where: { key } });
      await db.tenantModule.create({ data: { tenantId, moduleId: mod.id, enabled: true } });
    }
    for (const profile of ['operator', 'yard-only', 'reader']) {
      const keys =
        profile === 'operator'
          ? ['yard.read', 'yard.manage', 'transportation.planning.read', 'wms.read']
          : profile === 'yard-only'
            ? ['yard.read', 'yard.manage']
            : ['yard.read', 'transportation.planning.read', 'wms.read'];
      const permissions = await db.permission.findMany({ where: { key: { in: keys } } });
      const role = await db.role.create({
        data: {
          tenantId,
          key: profile,
          name: profile,
          permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
        },
      });
      const email = `${profile}@${slug}.test`;
      await db.user.create({
        data: {
          tenantId,
          email,
          passwordHash: hashSync('Test1234!', 4),
          firstName: 'Yard',
          lastName: profile,
          status: 'ACTIVE',
          roles: { create: { roleId: role.id } },
        },
      });
      const r = await request(http)
        .post('/api/v1/auth/login')
        .send({ tenant: slug, email, password: 'Test1234!' })
        .expect(200);
      if (profile === 'operator') token = r.body.accessToken;
      else if (profile === 'reader') reader = r.body.accessToken;
      else yardOnly = r.body.accessToken;
    }
    const location = async (tid: string, code: string) =>
      (
        await db.location.create({
          data: {
            tenantId: tid,
            code,
            name: code,
            type: 'WAREHOUSE',
            addressLine1: '1 Test',
            city: 'Québec',
            timezone: 'America/Toronto',
          },
        })
      ).id;
    site = await location(tenantId, 'DC-A');
    otherSite = await location(tenantId, 'DC-B');
    foreignSite = await location(foreignTenant, 'FOREIGN');
    loadId = (
      await db.load.create({
        data: {
          tenantId,
          loadNumber: 'LD-LINK',
          estimatedCost: 125,
          costCurrency: 'CAD',
          driverToken: 'never-expose-this-token-' + slug,
          route: {
            create: {
              tenantId,
              stops: {
                create: [
                  { tenantId, sequence: 1, type: 'PICKUP', locationId: site },
                  { tenantId, sequence: 2, type: 'DELIVERY', locationId: site },
                ],
              },
            },
          },
        },
      })
    ).id;
    receiptId = (
      await db.receipt.create({ data: { tenantId, number: 'RC-LINK', locationId: site } })
    ).id;
    pickId = (
      await db.pickOrder.create({ data: { tenantId, number: 'PK-LINK', locationId: site } })
    ).id;
    remoteReceipt = (
      await db.receipt.create({ data: { tenantId, number: 'RC-REMOTE', locationId: otherSite } })
    ).id;
    foreignReceipt = (
      await db.receipt.create({
        data: { tenantId: foreignTenant, number: 'RC-FOREIGN', locationId: foreignSite },
      })
    ).id;
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it('links several real dossiers without mutating stock, workflow or load costs', async () => {
    const v = await visit();
    const source = `visit/${v.id}`;
    const before = await db.stockMovement.count({ where: { tenantId } });
    for (const [kind, id] of [
      ['load', loadId],
      ['receipt', receiptId],
      ['pick-order', pickId],
    ])
      await link(source, kind, id).expect(201);
    const context = (await get(`dossiers/${source}`).expect(200)).body;
    expect(context.groups.map((g: any) => g.items.length)).toEqual([1, 1, 1]);
    expect(JSON.stringify(context)).not.toContain('never-expose');
    expect(JSON.stringify(context)).not.toContain('tenantId');
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(before);
    const load = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    expect(load.status).toBe('OPEN');
    expect(+load.estimatedCost!).toBe(125);
    expect((await db.receipt.findFirstOrThrow({ where: { tenantId, id: receiptId } })).status).toBe(
      'DRAFT',
    );
    const back = (await get(`dossiers/related/receipt/${receiptId}`).expect(200)).body;
    expect(back.items.some((i: any) => i.href.includes(`visit=${v.id}`))).toBe(true);
  });
  it('appointment and arrival share a single canonical list; parallel requests create one link', async () => {
    const a = await appointment({ direction: 'INBOUND' });
    const v = (await post('visits', { locationId: site, appointmentId: a.id }).expect(201)).body;
    expect(v.direction).toBe('INBOUND');
    const results = await Promise.all([
      link(`appointment/${a.id}`, 'receipt', receiptId),
      link(`visit/${v.id}`, 'receipt', receiptId),
    ]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results.map((r) => r.body.created).sort()).toEqual([false, true]);
    const context = (await get(`dossiers/visit/${v.id}`)).body;
    expect(context.source).toMatchObject({
      id: a.id,
      type: 'appointment',
      sharedWithAppointment: true,
    });
    expect(await db.yardDossierLink.count({ where: { tenantId, appointmentId: a.id } })).toBe(1);
    expect(await db.yardDossierLink.count({ where: { tenantId, visitId: v.id } })).toBe(0);
    const reverse = (await get(`dossiers/related/receipt/${receiptId}`)).body.items.find((i: any) =>
      i.href.includes(`appointment=${a.id}`),
    );
    expect(reverse.href).toContain('date=2026-09-14');
    expect(
      await db.auditLog.count({
        where: { tenantId, entityType: 'yard-dossier-link', entityId: results[0].body.linkId },
      }),
    ).toBe(1);
  });
  it('rejects foreign, wrong-site, wrong-direction and cancelled targets', async () => {
    const v = await visit({ direction: 'OUTBOUND' });
    const source = `visit/${v.id}`;
    await link(source, 'receipt', receiptId).expect(400);
    await link(source, 'receipt', foreignReceipt).expect(400);
    const other = await visit();
    await link(`visit/${other.id}`, 'receipt', remoteReceipt).expect(400);
    const cancelled = await db.pickOrder.create({
      data: { tenantId, number: 'PK-CANCEL', locationId: site, status: 'CANCELLED' },
    });
    await link(source, 'pick-order', cancelled.id).expect(400);
    const absentLoad = await db.load.create({ data: { tenantId, loadNumber: 'LD-UNRELATED' } });
    await link(source, 'load', absentLoad.id).expect(400);
    await link(source, 'pick-order', pickId).expect(201);
  });
  it('masks unavailable modules and permissions without disclosing linked IDs or counts', async () => {
    const v = await visit();
    await link(`visit/${v.id}`, 'receipt', receiptId).expect(201);
    const limited = (await get(`dossiers/visit/${v.id}`, yardOnly).expect(200)).body;
    expect(
      limited.groups.every((g: any) => !g.available && g.items.length === 0 && !g.truncated),
    ).toBe(true);
    expect(JSON.stringify(limited)).not.toContain(receiptId);
    await get(`dossiers/visit/${v.id}/candidates?kind=receipt`, yardOnly).expect(403);
    await link(`visit/${v.id}`, 'receipt', receiptId, yardOnly).expect(403);
    await link(`visit/${v.id}`, 'receipt', receiptId, reader).expect(403);
    await get(`dossiers/related/receipt/${foreignReceipt}`).expect(404);
    await get('dossiers/visit/foreign-id').expect(404);
  });
  it('enforces disabled target modules even with a previously valid token', async () => {
    const v = await visit();
    const mod = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: mod.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    try {
      await link(`visit/${v.id}`, 'receipt', receiptId).expect(403);
      await get(`dossiers/related/receipt/${receiptId}`).expect(403);
      expect(
        (await get(`dossiers/visit/${v.id}`)).body.groups.find((g: any) => g.kind === 'receipt')
          .available,
      ).toBe(false);
    } finally {
      await db.tenantModule.updateMany({
        where: { tenantId, moduleId: mod.id },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(tenantId);
    }
  });
  it('blocks every dossier surface when the Yard module is disabled', async () => {
    const v = await visit();
    const mod = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'yard' } });
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: mod.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    try {
      await get(`dossiers/visit/${v.id}`).expect(403);
      await get(`dossiers/visit/${v.id}/candidates?kind=receipt`).expect(403);
      await get(`dossiers/related/receipt/${receiptId}`).expect(403);
      await link(`visit/${v.id}`, 'receipt', receiptId).expect(403);
      await del(`dossiers/visit/${v.id}/links/absent`).expect(403);
    } finally {
      await db.tenantModule.updateMany({
        where: { tenantId, moduleId: mod.id },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(tenantId);
    }
  });
  it('fails closed for a legacy visit attached to an appointment on another site', async () => {
    const a = await appointment({ locationId: otherSite });
    const v = await visit();
    await db.yardVisit.updateMany({ where: { tenantId, id: v.id }, data: { appointmentId: a.id } });
    await get(`dossiers/visit/${v.id}`).expect(409);
    await link(`visit/${v.id}`, 'receipt', remoteReceipt).expect(409);
    expect(await db.yardDossierLink.count({ where: { tenantId, appointmentId: a.id } })).toBe(0);
  });
  it('removes only the association, is retry-safe, and records an audit', async () => {
    const v = await visit();
    const source = `visit/${v.id}`;
    const created = (await link(source, 'pick-order', pickId)).body;
    const other = await visit();
    expect(
      (await del(`dossiers/visit/${other.id}/links/${created.linkId}`).expect(200)).body.removed,
    ).toBe(false);
    await del(`dossiers/${source}/links/${created.linkId}`, yardOnly).expect(403);
    expect((await del(`dossiers/${source}/links/${created.linkId}`).expect(200)).body.removed).toBe(
      true,
    );
    expect((await del(`dossiers/${source}/links/${created.linkId}`).expect(200)).body.removed).toBe(
      false,
    );
    expect(await db.pickOrder.count({ where: { tenantId, id: pickId } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: {
          tenantId,
          entityType: 'yard-dossier-link',
          entityId: created.linkId,
          action: 'DELETE',
        },
      }),
    ).toBe(1);
    await del(`dossiers/invalid/${v.id}/links/${created.linkId}`).expect(400);
  });
  it('freezes both appointment and visit associations after departure', async () => {
    const a = await appointment();
    const v = await visit({ appointmentId: a.id });
    const created = (await link(`visit/${v.id}`, 'load', loadId)).body;
    await post(`visits/${v.id}/check-out`, {}).expect(201);
    await link(`appointment/${a.id}`, 'receipt', receiptId).expect(409);
    await del(`dossiers/visit/${v.id}/links/${created.linkId}`).expect(409);
    expect((await get(`dossiers/visit/${v.id}`)).body.editable).toBe(false);
    expect((await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } })).status).toBe(
      'OPEN',
    );
  });
  it('searches compatible targets server-side beyond the initial result window', async () => {
    await db.receipt.createMany({
      data: Array.from({ length: 23 }, (_, i) => ({
        tenantId,
        number: `RC-SEARCH-${i}`,
        locationId: site,
      })),
    });
    const v = await visit();
    const list = (await get(`dossiers/visit/${v.id}/candidates?kind=receipt`).expect(200)).body;
    expect(list.items).toHaveLength(20);
    expect(list.truncated).toBe(true);
    const narrowed = (
      await get(`dossiers/visit/${v.id}/candidates?kind=receipt&q=RC-SEARCH-22`).expect(200)
    ).body;
    expect(narrowed.items.map((i: any) => i.number)).toEqual(['RC-SEARCH-22']);
  });
  it('keeps a changed target visible with a warning, not as a silently valid link', async () => {
    const v = await visit();
    const r = await db.receipt.create({
      data: { tenantId, number: 'RC-CHANGED', locationId: site },
    });
    await link(`visit/${v.id}`, 'receipt', r.id).expect(201);
    await db.receipt.updateMany({ where: { tenantId, id: r.id }, data: { status: 'CANCELLED' } });
    const item = (await get(`dossiers/visit/${v.id}`)).body.groups.find(
      (g: any) => g.kind === 'receipt',
    ).items[0];
    expect(item.warning).toContain('revérifier');
    expect(item.id).toBe(r.id);
  });
  it('rejects contradictory arrival direction and invalid source/target cardinality in the database', async () => {
    const a = await appointment({ direction: 'INBOUND' });
    await post('visits', { locationId: site, appointmentId: a.id, direction: 'OUTBOUND' }).expect(
      400,
    );
    const v = await visit();
    await expect(
      db.yardDossierLink.create({
        data: { tenantId, visitId: v.id, appointmentId: a.id, receiptId },
      }),
    ).rejects.toThrow();
    await expect(
      db.yardDossierLink.create({
        data: { tenantId, visitId: v.id, receiptId, pickOrderId: pickId },
      }),
    ).rejects.toThrow();
  });
});
