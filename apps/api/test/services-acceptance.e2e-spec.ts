import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { MODULE_CATALOG, PERMISSION_CATALOG } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { EmailService } from '../src/core/email/email.service';
import { AuditLogsService } from '../src/core/audit-logs/audit-logs.service';

describe('Services work acceptance — HTTP and isolated PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, tenantId: string, foreignId: string;
  const slug = `service-acceptance-${Date.now()}`;
  const actors: Record<string, { id: string; token: string }> = {};
  const call = (method: 'get' | 'post' | 'patch', path: string, body?: object, role = 'manager') =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .auth(actors[role].token, { type: 'bearer' })
      .send(body);
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ channel: 'log', send: jest.fn(async () => true) })
      .overrideProvider(AgentRuntimeService)
      .useValue({ killAgentSessions: async () => {}, closeSession: async () => {} })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    db = app.get(PrismaService);
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    tenantId = (await db.tenant.create({ data: { slug, name: slug } })).id;
    foreignId = (await db.tenant.create({ data: { slug: `${slug}-other`, name: 'Other' } })).id;
    for (const p of PERMISSION_CATALOG)
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    for (const entry of MODULE_CATALOG.filter((m) => ['services', 'billing'].includes(m.key))) {
      const m = await db.moduleDefinition.upsert({
        where: { key: entry.key },
        create: entry,
        update: entry,
      });
      await db.tenantModule.create({ data: { tenantId, moduleId: m.id, enabled: true } });
    }
    for (const [key, permissions] of Object.entries({
      manager: PERMISSION_CATALOG.map((p) => p.key),
      reader: ['services.read'],
      planner: ['services.read', 'services.manage'],
      reviewer: ['services.read', 'services.work.accept'],
      blind: ['services.work.accept'],
    })) {
      const ps = await db.permission.findMany({ where: { key: { in: permissions } } });
      const role = await db.role.create({
        data: {
          tenantId,
          key,
          name: key,
          permissions: { create: ps.map((p) => ({ permissionId: p.id })) },
        },
      });
      const email = `${key}@${slug}.test`;
      const user = await db.user.create({
        data: {
          tenantId,
          email,
          firstName: key,
          lastName: 'Recette',
          status: 'ACTIVE',
          passwordHash: hashSync('Test1234!', 4),
          roles: { create: { roleId: role.id } },
        },
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenant: slug, email, password: 'Test1234!' })
        .expect(200);
      actors[key] = { id: user.id, token: res.body.accessToken };
    }
    console.log(`SERVICE_ACCEPTANCE_TENANT=${slug}`);
  }, 120000);
  afterAll(async () => app?.close());
  async function fixture(required = true, foreign = false) {
    const tid = foreign ? foreignId : tenantId;
    const customer = await db.customer.create({
      data: { tenantId: tid, code: randomUUID(), name: 'Atelier des Rives' },
    });
    const partner = await db.businessPartner.create({
      data: {
        tenantId: tid,
        code: randomUUID(),
        name: 'Atelier des Rives',
        isCustomer: true,
        billingCustomerId: customer.id,
      },
    });
    const project = await db.serviceProject.create({
      data: {
        tenantId: tid,
        number: randomUUID(),
        partnerId: partner.id,
        title: 'Remise en service',
        status: 'ACTIVE',
        acceptanceRequired: required,
      },
    });
    const job = await db.serviceJob.create({
      data: {
        tenantId: tid,
        projectId: project.id,
        number: randomUUID(),
        title: 'Inspection électrique',
        status: 'COMPLETED',
        report: 'Contrôles réalisés, résultat conforme.',
        completedAt: new Date(),
      },
    });
    return { project, job, partner };
  }
  const decision = (job: { updatedAt: Date }, status = 'ACCEPTED') => ({
    operationKey: randomUUID(),
    expectedUpdatedAt: job.updatedAt.toISOString(),
    status,
    representative: 'Alex Tremblay',
    reference: 'Courriel client du 27 septembre',
    note: 'Compte rendu examiné et accepté.',
    confirm: true,
  });
  const path = (id: string) => `services/jobs/${id}/acceptance`;
  async function timeFor(jobId: string) {
    return db.serviceTimeEntry.create({
      data: {
        tenantId,
        jobId,
        userId: actors.planner.id,
        createdById: actors.planner.id,
        workDate: new Date('2026-09-27'),
        minutes: 90,
        billable: true,
        note: 'Travaux contrôlés',
        status: 'APPROVED',
        operationKey: randomUUID(),
        requestFingerprint: 'fixture',
      },
    });
  }
  const invoice = (projectId: string, time: { id: string; updatedAt: Date }) =>
    call('post', `services/projects/${projectId}/invoice`, {
      operationKey: randomUUID(),
      currency: 'CAD',
      sources: [
        {
          kind: 'time',
          id: time.id,
          expectedVersion: time.updatedAt.toISOString(),
          unitPrice: 87.25,
        },
      ],
    });

  it('defaults projects to optional, allows DRAFT configuration, rejects disabling after activation', async () => {
    const f = await fixture();
    let p = (
      await call('post', 'services/projects', {
        title: 'Nouveau dossier',
        partnerId: f.partner.id,
      }).expect(201)
    ).body;
    expect(p.acceptanceRequired).toBe(false);
    p = (
      await call('patch', `services/projects/${p.id}`, {
        expectedUpdatedAt: p.updatedAt,
        acceptanceRequired: true,
      }).expect(200)
    ).body;
    p = (
      await call('post', `services/projects/${p.id}/transition`, {
        expectedUpdatedAt: p.updatedAt,
        status: 'ACTIVE',
      }).expect(201)
    ).body;
    await call('patch', `services/projects/${p.id}`, {
      expectedUpdatedAt: p.updatedAt,
      acceptanceRequired: false,
    }).expect(409);
    await call('patch', `services/projects/${p.id}`, {
      expectedUpdatedAt: p.updatedAt,
      acceptanceRequired: null,
    }).expect(400);
  });
  it('requires source read plus a dedicated acceptance permission', async () => {
    const { job } = await fixture();
    for (const role of ['reader', 'planner', 'blind'])
      await call('post', path(job.id), decision(job), role).expect(403);
    await call('get', path(job.id), undefined, 'reader').expect(200);
    await call('get', path(job.id), undefined, 'blind').expect(403);
    await call('post', path(job.id), decision(job), 'reviewer').expect(201);
  });
  it('does not read or mutate another tenant, even with all permissions', async () => {
    const { job } = await fixture(true, true);
    await call('get', path(job.id)).expect(404);
    await call('post', path(job.id), decision(job)).expect(404);
    expect(await db.serviceAcceptanceRecord.count({ where: { jobId: job.id } })).toBe(0);
  });
  it('validates required confirmation, trimmed fields, enum, version and page bounds', async () => {
    const { job } = await fixture();
    for (const changes of [
      { confirm: false },
      { representative: '   ' },
      { reference: '' },
      { note: '' },
      { status: 'PENDING' },
      { expectedUpdatedAt: 'bad' },
      { tenantId: foreignId },
    ])
      await call('post', path(job.id), { ...decision(job), ...changes }).expect(400);
    await call('get', `${path(job.id)}?page=0`).expect(400);
    await call('get', `${path(job.id)}?page=100001`).expect(400);
  });
  it('requires completed work in an active project', async () => {
    const { job, project } = await fixture();
    await db.serviceJob.update({
      where: { id: job.id },
      data: { status: 'IN_PROGRESS', updatedAt: job.updatedAt },
    });
    await call('post', path(job.id), decision(job)).expect(409);
    await db.serviceJob.update({
      where: { id: job.id },
      data: { status: 'COMPLETED', updatedAt: job.updatedAt },
    });
    await db.serviceProject.update({ where: { id: project.id }, data: { status: 'CANCELLED' } });
    await call('post', path(job.id), decision(job)).expect(409);
  });
  it('keeps reservations and captures immutable report, then accepts without rewriting history', async () => {
    const { job, project, partner } = await fixture();
    await call('post', path(job.id), decision(job, 'RESERVATIONS')).expect(201);
    const current = await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
    await call('post', path(job.id), decision(current)).expect(201);
    const h = (await call('get', path(job.id)).expect(200)).body;
    expect(h.total).toBe(2);
    expect(h.job.acceptanceStatus).toBe('ACCEPTED');
    expect(h.items[0].snapshot).toMatchObject({
      report: job.report,
      partnerId: partner.id,
      scope: 'completed-work-report-v1',
    });
    expect(h.items[0]).not.toHaveProperty('fingerprint');
    expect(h.items[0]).not.toHaveProperty('operationKey');
    const final = await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
    await call('post', path(job.id), decision(final, 'RESERVATIONS')).expect(409);
    const other = await fixture();
    await call('patch', `services/projects/${project.id}`, {
      partnerId: other.partner.id,
      expectedUpdatedAt: project.updatedAt.toISOString(),
    }).expect(409);
  });
  it('replays the exact request once and rejects another actor, body or target on the same key', async () => {
    const { job } = await fixture();
    const dto = decision(job);
    const one = (await call('post', path(job.id), dto).expect(201)).body;
    const two = (await call('post', path(job.id), dto).expect(201)).body;
    expect(two).toEqual({ id: one.id, created: false });
    await call('post', path(job.id), { ...dto, note: 'Autre note' }).expect(409);
    await call('post', path(job.id), dto, 'reviewer').expect(409);
    const other = await fixture();
    await call('post', path(other.job.id), dto).expect(409);
    expect(await db.serviceAcceptanceRecord.count({ where: { tenantId, jobId: job.id } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { tenantId, entityId: job.id, entityType: 'service-job' } }),
    ).toBe(1);
  });
  it('serializes concurrent requests and rejects stale versions', async () => {
    const { job } = await fixture();
    const results = await Promise.all([
      call('post', path(job.id), decision(job, 'RESERVATIONS')),
      call('post', path(job.id), decision(job)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.serviceAcceptanceRecord.count({ where: { tenantId, jobId: job.id } })).toBe(1);
  });
  it('rolls back both decision and status when the atomic audit fails', async () => {
    const { job } = await fixture();
    const mock = jest
      .spyOn(app.get(AuditLogsService), 'log')
      .mockRejectedValueOnce(new Error('audit-test-failure'));
    try {
      await call('post', path(job.id), decision(job)).expect(500);
    } finally {
      mock.mockRestore();
    }
    expect(await db.serviceAcceptanceRecord.count({ where: { tenantId, jobId: job.id } })).toBe(0);
    expect(
      (await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).acceptanceStatus,
    ).toBe('PENDING');
  });
  it('blocks invoice sources and project completion until acceptance, then allows a draft', async () => {
    const { job, project } = await fixture();
    const time = await timeFor(job.id);
    let b = (await call('get', `services/projects/${project.id}/billable`).expect(200)).body;
    expect(b.sources[0]).toMatchObject({ jobId: job.id, blockedReason: expect.any(String) });
    await invoice(project.id, time).expect(409);
    await call('post', `services/projects/${project.id}/transition`, {
      status: 'COMPLETED',
      expectedUpdatedAt: project.updatedAt.toISOString(),
    }).expect(409);
    await call('post', path(job.id), decision(job)).expect(201);
    b = (await call('get', `services/projects/${project.id}/billable`).expect(200)).body;
    expect(b.sources[0].blockedReason).toBeNull();
    const result = (await invoice(project.id, time).expect(201)).body;
    expect(
      (await db.customerInvoice.findFirstOrThrow({ where: { tenantId, id: result.invoiceId } }))
        .status,
    ).toBe('DRAFT');
    await call('post', `services/projects/${project.id}/transition`, {
      status: 'COMPLETED',
      expectedUpdatedAt: project.updatedAt.toISOString(),
    }).expect(201);
  });
  it('preserves optional historical billing and keeps quantity approval separate', async () => {
    const { job, project } = await fixture(false);
    const time = await timeFor(job.id);
    expect(
      (await call('get', `services/projects/${project.id}/billable`).expect(200)).body.sources[0]
        .blockedReason,
    ).toBeNull();
    await invoice(project.id, time).expect(201);
    expect(
      (await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).acceptanceStatus,
    ).toBe('PENDING');
  });
  it('bills accepted interventions separately without accepting the others', async () => {
    const { project, job } = await fixture();
    const other = await db.serviceJob.create({
      data: {
        tenantId,
        projectId: project.id,
        number: randomUUID(),
        title: 'Deuxième lot',
        status: 'COMPLETED',
        report: 'À examiner',
      },
    });
    const t1 = await timeFor(job.id),
      t2 = await timeFor(other.id);
    await call('post', path(job.id), decision(job)).expect(201);
    await invoice(project.id, t1).expect(201);
    await invoice(project.id, t2).expect(409);
    expect(
      (await call('get', `services/projects/${project.id}/billable`).expect(200)).body.sources,
    ).toHaveLength(1);
    await call('post', `services/projects/${project.id}/transition`, {
      status: 'COMPLETED',
      expectedUpdatedAt: project.updatedAt.toISOString(),
    }).expect(409);
  });
  it('also gates net part sources and creates no stock movement from acceptance', async () => {
    const { project, job } = await fixture();
    const location = await db.location.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Atelier test',
        type: 'WAREHOUSE',
        addressLine1: '1 rue Test',
        city: 'Québec',
      },
    });
    const bin = await db.bin.create({ data: { tenantId, locationId: location.id, code: 'A1' } });
    const item = await db.wmsItem.create({
      data: { tenantId, sku: randomUUID(), name: 'Joint de test' },
    });
    const catalog = await db.catalogItem.create({
      data: { tenantId, code: randomUUID(), name: 'Joint', kind: 'GOODS', unit: 'EA' },
    });
    const movement = await db.stockMovement.create({
      data: {
        tenantId,
        itemId: item.id,
        fromBinId: bin.id,
        type: 'PICK',
        qty: 4,
        unitSnapshot: 'EA',
      },
    });
    const part = await db.servicePartUsage.create({
      data: {
        tenantId,
        jobId: job.id,
        catalogItemId: catalog.id,
        wmsItemId: item.id,
        binId: bin.id,
        quantity: 4,
        returnedQuantity: 1,
        movementId: movement.id,
        nameSnapshot: 'Joint',
        codeSnapshot: catalog.code,
        unitSnapshot: 'EA',
        binSnapshot: 'A1',
        note: 'Fixture historique partiellement retournée',
        createdById: actors.manager.id,
        operationKey: randomUUID(),
        requestFingerprint: 'fixture',
      },
    });
    const makeInvoice = () =>
      call('post', `services/projects/${project.id}/invoice`, {
        operationKey: randomUUID(),
        currency: 'CAD',
        sources: [
          {
            kind: 'part',
            id: part.id,
            expectedVersion: part.updatedAt.toISOString(),
            unitPrice: 13.5,
          },
        ],
      });
    const before = await db.stockMovement.count({ where: { tenantId } });
    expect(
      (await call('get', `services/projects/${project.id}/billable`).expect(200)).body.sources[0],
    ).toMatchObject({ quantity: '3', blockedReason: expect.any(String) });
    await makeInvoice().expect(409);
    await call('post', path(job.id), decision(job)).expect(201);
    await makeInvoice().expect(201);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(before);
  });
  it('works with Services alone and paginates append-only reservations', async () => {
    const { job } = await fixture();
    const m = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'billing' } });
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: m.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    try {
      let current = job;
      for (let i = 0; i < 21; i++) {
        await call('post', path(job.id), {
          ...decision(current, 'RESERVATIONS'),
          note: `Réserve ${i}`,
        }).expect(201);
        current = await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
      }
      const first = (await call('get', path(job.id)).expect(200)).body;
      const second = (await call('get', `${path(job.id)}?page=2`).expect(200)).body;
      expect(first.total).toBe(21);
      expect(first.items).toHaveLength(20);
      expect(second.items).toHaveLength(1);
      expect(first.items[0].note).toBe('Réserve 20');
      expect(second.items[0].note).toBe('Réserve 0');
    } finally {
      await db.tenantModule.updateMany({
        where: { tenantId, moduleId: m.id },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(tenantId);
    }
  });
  it('replays simultaneous identical requests as a single record', async () => {
    const { job } = await fixture();
    const dto = decision(job);
    const result = await Promise.all([
      call('post', path(job.id), dto),
      call('post', path(job.id), dto),
    ]);
    expect(result.map((r) => r.status)).toEqual([201, 201]);
    expect(result.map((r) => r.body.created).sort()).toEqual([false, true]);
    expect(await db.serviceAcceptanceRecord.count({ where: { tenantId, jobId: job.id } })).toBe(1);
  });
  it('cannot record with a disabled account or disabled Services module', async () => {
    const { job } = await fixture();
    await db.user.update({ where: { id: actors.reviewer.id }, data: { status: 'DISABLED' } });
    try {
      expect(
        (await call('post', path(job.id), decision(job), 'reviewer')).status,
      ).toBeGreaterThanOrEqual(400);
    } finally {
      await db.user.update({ where: { id: actors.reviewer.id }, data: { status: 'ACTIVE' } });
    }
    const m = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'services' } });
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: m.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    try {
      await call('get', path(job.id)).expect(403);
      await call('post', path(job.id), decision(job)).expect(403);
    } finally {
      await db.tenantModule.updateMany({
        where: { tenantId, moduleId: m.id },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(tenantId);
    }
  });
});
