import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { ModuleRegistryService } from '../src/core/module-registry/module-registry.service';

describe('Business foundations (real HTTP + Postgres)', () => {
  let app: INestApplication,
    db: PrismaService,
    http: any,
    tenantId: string,
    foreign: string,
    token: string,
    reader: string;
  let partner: any, item: any, foreignPartner: any, foreignItem: any;
  let operatorId: string,
    workerId: string,
    worker: string,
    reviewer: string,
    reviewerId: string,
    disabledId: string,
    foreignUserId: string;
  const slug = 'business-' + Date.now();
  const call = (method: 'get' | 'post' | 'patch', path: string, body?: object, auth = token) =>
    request(http)
      [method]('/api/v1/' + path)
      .set('Authorization', `Bearer ${auth}`)
      .send(body);
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
    foreign = (await db.tenant.create({ data: { slug: slug + '-other', name: 'Other' } })).id;
    const modules = await db.moduleDefinition.findMany({
      where: { key: { in: ['catalog', 'purchasing', 'services', 'wms', 'support'] } },
    });
    expect(modules).toHaveLength(5);
    await db.tenantModule.createMany({
      data: modules.map((m) => ({ tenantId, moduleId: m.id, enabled: true })),
    });
    for (const mode of ['operator', 'reader', 'worker', 'reviewer']) {
      const ps = await db.permission.findMany({
        where: {
          key: {
            in:
              mode === 'operator'
                ? [
                    'catalog.read',
                    'catalog.manage',
                    'wms.read',
                    'wms.manage',
                    'services.read',
                    'services.manage',
                    'purchasing.read',
                    'purchasing.manage',
                    'support.read',
                    'support.manage',
                  ]
                : mode === 'reviewer'
                  ? [
                      'services.read',
                      'services.time.approve',
                      'services.time.write',
                      'services.manage',
                    ]
                  : mode === 'worker'
                    ? ['services.read', 'services.time.write']
                    : ['services.read'],
          },
        },
      });
      const role = await db.role.create({
        data: {
          tenantId,
          key: mode,
          name: mode,
          permissions: { create: ps.map((p) => ({ permissionId: p.id })) },
        },
      });
      const email = `${mode}@${slug}.test`;
      const user = await db.user.create({
        data: {
          tenantId,
          email,
          firstName: 'Business',
          lastName: mode,
          status: 'ACTIVE',
          passwordHash: hashSync('Test1234!', 4),
          roles: { create: { roleId: role.id } },
        },
      });
      const r = await request(http)
        .post('/api/v1/auth/login')
        .send({ tenant: slug, email, password: 'Test1234!' })
        .expect(200);
      if (mode === 'operator') {
        token = r.body.accessToken;
        operatorId = user.id;
      } else if (mode === 'worker') {
        worker = r.body.accessToken;
        workerId = user.id;
      } else if (mode === 'reviewer') {
        reviewer = r.body.accessToken;
        reviewerId = user.id;
      } else reader = r.body.accessToken;
    }
    disabledId = (
      await db.user.create({
        data: {
          tenantId,
          email: `disabled@${slug}.test`,
          firstName: 'Disabled',
          lastName: 'Person',
          passwordHash: 'disabled',
          status: 'DISABLED',
        },
      })
    ).id;
    foreignUserId = (
      await db.user.create({
        data: {
          tenantId: foreign,
          email: `foreign@${slug}.test`,
          firstName: 'Foreign',
          lastName: 'Person',
          passwordHash: 'disabled',
          status: 'ACTIVE',
        },
      })
    ).id;
    partner = (
      await call('post', 'catalog/partners', {
        code: 'CLIENT-SUPPLIER',
        name: 'Atelier de test',
        email: 'qa@example.test',
        isCustomer: true,
        isSupplier: true,
      }).expect(201)
    ).body;
    item = (
      await call('post', 'catalog/items', {
        code: 'INSPECT',
        name: 'Inspection',
        kind: 'SERVICE',
        unit: 'H',
      }).expect(201)
    ).body;
    foreignPartner = await db.businessPartner.create({
      data: { tenantId: foreign, code: 'OTHER', name: 'Other', isCustomer: true, isSupplier: true },
    });
    foreignItem = await db.catalogItem.create({
      data: { tenantId: foreign, code: 'OTHER', name: 'Other', kind: 'SERVICE', unit: 'H' },
    });
  }, 60000);
  afterAll(async () => {
    try {
      if (db) {
        const tids = [tenantId, foreign].filter(Boolean);
        await db.supportCaseEvent.deleteMany({ where: { tenantId: { in: tids } } });
        await db.supportCase.deleteMany({ where: { tenantId: { in: tids } } });
        await db.supplierReceiptLine.deleteMany({ where: { tenantId: { in: tids } } });
        await db.supplierReceipt.deleteMany({ where: { tenantId: { in: tids } } });
        await db.servicePartUsage.deleteMany({ where: { tenantId: { in: tids } } });
        await db.catalogStockLink.deleteMany({ where: { tenantId: { in: tids } } });
        await db.stockMovement.deleteMany({ where: { tenantId: { in: tids } } });
        await db.inventoryLevel.deleteMany({ where: { tenantId: { in: tids } } });
        await db.serviceTimeReview.deleteMany({ where: { tenantId: { in: tids } } });
        await db.serviceTimeEntry.deleteMany({ where: { tenantId: { in: tids } } });
        await db.supplierOrderLine.deleteMany({ where: { tenantId: { in: tids } } });
        await db.supplierOrder.deleteMany({ where: { tenantId: { in: tids } } });
        await db.serviceJob.deleteMany({ where: { tenantId: { in: tids } } });
        await db.serviceProject.deleteMany({ where: { tenantId: { in: tids } } });
        await db.catalogItem.deleteMany({ where: { tenantId: { in: tids } } });
        await db.businessPartner.deleteMany({ where: { tenantId: { in: tids } } });
      }
    } finally {
      await app?.close();
    }
  });
  const project = async () =>
    (
      await call('post', 'services/projects', {
        title: 'Installation',
        partnerId: partner.id,
        dueDate: '2026-10-20',
      }).expect(201)
    ).body;
  const activate = async (p: any) =>
    (
      await call('post', `services/projects/${p.id}/transition`, {
        expectedUpdatedAt: p.updatedAt,
        status: 'ACTIVE',
      }).expect(201)
    ).body;
  const orderBody = () => ({
    supplierId: partner.id,
    currency: 'CAD',
    lines: [{ catalogItemId: item.id, quantity: 2.5, unitPrice: 19.95 }],
  });
  it('first activation is safe when two administrators enable the same app', async () => {
    const registry = app.get(ModuleRegistryService);
    const results = await Promise.all([
      registry.setEnabled(foreign, 'catalog', true),
      registry.setEnabled(foreign, 'catalog', true),
    ]);
    expect(results.every((r) => r.enabled)).toBe(true);
    expect(
      await db.tenantModule.count({ where: { tenantId: foreign, module: { key: 'catalog' } } }),
    ).toBe(1);
  });
  it('scopes references and omits contact details for service-only users', async () => {
    const r = await call('get', 'services/references/customers', undefined, reader).expect(200);
    expect(r.body.items.map((x: any) => x.id)).toContain(partner.id);
    expect(r.body.items.map((x: any) => x.id)).not.toContain(foreignPartner.id);
    expect(r.body.items[0]).not.toHaveProperty('email');
    expect(r.body.items[0]).not.toHaveProperty('tenantId');
    await call('get', 'catalog/partners', undefined, reader).expect(403);
    await call(
      'post',
      'services/projects',
      { title: 'Forbidden', partnerId: partner.id },
      reader,
    ).expect(403);
  });
  it('validates partner roles, phone and immutable catalog fields', async () => {
    await call('post', 'catalog/partners', {
      code: 'BAD',
      name: 'Bad',
      isCustomer: false,
      isSupplier: false,
    }).expect(400);
    await call('post', 'catalog/partners', {
      code: 'PHONE',
      name: 'Bad',
      phone: 'bonjour',
      isCustomer: true,
      isSupplier: false,
    }).expect(400);
    await call('patch', `catalog/items/${item.id}`, {
      expectedUpdatedAt: item.updatedAt,
      unit: 'EA',
    }).expect(400);
    await call('patch', `catalog/items/${item.id}`, {
      expectedUpdatedAt: item.updatedAt,
      active: null,
    }).expect(400);
  });
  it('enforces tenant foreign keys on every new domain', async () => {
    await call('post', 'services/projects', {
      title: 'Foreign',
      partnerId: foreignPartner.id,
    }).expect(400);
    await call('post', 'purchasing/orders', {
      ...orderBody(),
      supplierId: foreignPartner.id,
    }).expect(400);
    await call('post', 'purchasing/orders', {
      ...orderBody(),
      lines: [{ catalogItemId: foreignItem.id, quantity: 1, unitPrice: 1 }],
    }).expect(400);
    const other = await db.serviceProject.create({
      data: {
        tenantId: foreign,
        number: 'PRJ-FOREIGN',
        title: 'Other',
        partnerId: foreignPartner.id,
        status: 'ACTIVE',
      },
    });
    await call('post', 'services/jobs', { projectId: other.id, title: 'Foreign' }).expect(400);
    await call('get', `services/projects/${other.id}`).expect(404);
  });
  it('rejects impossible dates and intervention times without an explicit timezone', async () => {
    await call('post', 'services/projects', {
      title: 'Impossible date',
      partnerId: partner.id,
      dueDate: '2026-02-30',
    }).expect(400);
    await call('post', 'purchasing/orders', {
      ...orderBody(),
      expectedDate: '2026-02-30',
    }).expect(400);
    const p = await activate(await project());
    await call('post', 'services/jobs', {
      projectId: p.id,
      title: 'Ambiguous time',
      scheduledAt: '2026-10-10T13:30:00',
    }).expect(400);
  });
  it('runs project → intervention → report → close without side effects', async () => {
    let p = await project();
    await call('post', 'services/jobs', { projectId: p.id, title: 'Too soon' }).expect(409);
    p = await activate(p);
    let j = (
      await call('post', 'services/jobs', {
        projectId: p.id,
        title: 'Inspection',
        catalogItemId: item.id,
        scheduledAt: '2026-10-10T13:30:00Z',
        assigneeLabel: 'Équipe A',
      }).expect(201)
    ).body;
    expect(j.number).toMatch(/^INT-/);
    await call('post', `services/projects/${p.id}/transition`, {
      status: 'COMPLETED',
      expectedUpdatedAt: p.updatedAt,
    }).expect(409);
    await call('post', `services/projects/${p.id}/transition`, {
      status: 'CANCELLED',
      expectedUpdatedAt: p.updatedAt,
    }).expect(409);
    await call('post', `services/jobs/${j.id}/transition`, {
      status: 'COMPLETED',
      report: 'Skipped',
      expectedUpdatedAt: j.updatedAt,
    }).expect(409);
    j = (
      await call('post', `services/jobs/${j.id}/transition`, {
        status: 'IN_PROGRESS',
        expectedUpdatedAt: j.updatedAt,
      }).expect(201)
    ).body;
    await call('post', `services/jobs/${j.id}/transition`, {
      status: 'COMPLETED',
      report: '  ',
      expectedUpdatedAt: j.updatedAt,
    }).expect(400);
    j = (
      await call('post', `services/jobs/${j.id}/transition`, {
        status: 'COMPLETED',
        report: 'Inspection terminée, aucun défaut.',
        expectedUpdatedAt: j.updatedAt,
      }).expect(201)
    ).body;
    expect(j.completedAt).toBeTruthy();
    expect(j.report).toContain('Inspection terminée');
    await call('patch', `services/jobs/${j.id}`, {
      title: 'Rewrite',
      expectedUpdatedAt: j.updatedAt,
    }).expect(409);
    p = (
      await call('post', `services/projects/${p.id}/transition`, {
        status: 'COMPLETED',
        expectedUpdatedAt: p.updatedAt,
      }).expect(201)
    ).body;
    await call('post', `services/projects/${p.id}/transition`, {
      status: 'ACTIVE',
      expectedUpdatedAt: p.updatedAt,
    }).expect(409);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(0);
    expect(
      await db.auditLog.count({
        where: { tenantId, entityType: 'service-job', entityId: j.id, action: 'STATUS_CHANGE' },
      }),
    ).toBe(2);
  });
  it('rejects lost updates for projects and catalogue', async () => {
    const p = await project();
    const results = await Promise.all(
      ['A', 'B'].map((title) =>
        call('patch', `services/projects/${p.id}`, { title, expectedUpdatedAt: p.updatedAt }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const results2 = await Promise.all(
      ['First', 'Second'].map((name) =>
        call('patch', `catalog/items/${item.id}`, { name, expectedUpdatedAt: item.updatedAt }),
      ),
    );
    expect(results2.map((r) => r.status).sort()).toEqual([200, 409]);
    item = results2.find((r) => r.status === 200)!.body;
  });
  it('serializes project closure against creation of an intervention', async () => {
    const p = await activate(await project());
    const [close, create] = await Promise.all([
      call('post', `services/projects/${p.id}/transition`, {
        status: 'COMPLETED',
        expectedUpdatedAt: p.updatedAt,
      }),
      call('post', 'services/jobs', { projectId: p.id, title: 'Racing intervention' }),
    ]);
    expect([close.status, create.status].sort()).toEqual([201, 409]);
  });
  it('records decimal totals, snapshots and immutable confirmed orders', async () => {
    let o = (await call('post', 'purchasing/orders', orderBody()).expect(201)).body;
    expect(o.number).toMatch(/^PO-/);
    expect(o.total).toBe('49.88');
    o = (
      await call('patch', `purchasing/orders/${o.id}`, {
        ...orderBody(),
        notes: 'À contrôler',
        expectedUpdatedAt: o.updatedAt,
      }).expect(200)
    ).body;
    o = (
      await call('post', `purchasing/orders/${o.id}/transition`, {
        status: 'CONFIRMED',
        expectedUpdatedAt: o.updatedAt,
      }).expect(201)
    ).body;
    await call('patch', `purchasing/orders/${o.id}`, {
      ...orderBody(),
      expectedUpdatedAt: o.updatedAt,
    }).expect(409);
    const name = o.lines[0].nameSnapshot;
    item = (
      await call('patch', `catalog/items/${item.id}`, {
        expectedUpdatedAt: item.updatedAt,
        name: 'Nouveau libellé',
      }).expect(200)
    ).body;
    expect(
      (await call('get', `purchasing/orders/${o.id}`).expect(200)).body.lines[0].nameSnapshot,
    ).toBe(name);
    await call('post', `purchasing/orders/${o.id}/transition`, {
      status: 'CLOSED',
      closeReason: 'Clôture administrative de test, sans réception physique.',
      expectedUpdatedAt: o.updatedAt,
    }).expect(201);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(0);
    expect(await db.invoice.count({ where: { tenantId } })).toBe(0);
  });
  it('rejects invalid line amounts and foreign edits', async () => {
    for (const lines of [
      [],
      [{ catalogItemId: item.id, quantity: 0, unitPrice: 2 }],
      [{ catalogItemId: item.id, quantity: 1, unitPrice: -1 }],
    ])
      await call('post', 'purchasing/orders', { ...orderBody(), lines }).expect(400);
    await call('patch', `catalog/partners/${foreignPartner.id}`, {
      name: 'Oops',
      expectedUpdatedAt: foreignPartner.updatedAt.toISOString(),
    }).expect(404);
  });
  it('rechecks active supplier/item when confirming', async () => {
    let o = (await call('post', 'purchasing/orders', orderBody()).expect(201)).body;
    item = (
      await call('patch', `catalog/items/${item.id}`, {
        active: false,
        expectedUpdatedAt: item.updatedAt,
      }).expect(200)
    ).body;
    await call('post', `purchasing/orders/${o.id}/transition`, {
      status: 'CONFIRMED',
      expectedUpdatedAt: o.updatedAt,
    }).expect(400);
    await call('post', 'purchasing/orders', orderBody()).expect(400);
    item = (
      await call('patch', `catalog/items/${item.id}`, {
        active: true,
        expectedUpdatedAt: item.updatedAt,
      }).expect(200)
    ).body;
  });
  it('stores new module tour progress separately per user', async () => {
    for (const moduleKey of ['documentation', 'catalog', 'purchasing', 'services'])
      await request(http)
        .put('/api/v1/me/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({ moduleTour: { moduleKey, version: 1, step: 4, status: 'COMPLETED' } })
        .expect(200);
    const r = await call('get', 'me/preferences', undefined, reader).expect(200);
    expect(r.body.moduleTours.services).toBeUndefined();
  });
  const startAssigned = async (assigneeUserId = workerId, p?: any) => {
    p ??= await activate(await project());
    let j = (
      await call('post', 'services/jobs', {
        projectId: p.id,
        title: 'Travail terrain',
        assigneeUserId,
      }).expect(201)
    ).body;
    j = (
      await call('post', `services/jobs/${j.id}/transition`, {
        expectedUpdatedAt: j.updatedAt,
        status: 'IN_PROGRESS',
      }).expect(201)
    ).body;
    return { j, p };
  };
  const timeBody = (j: any, userId = workerId) => ({
    jobId: j.id,
    userId,
    workDate: '2026-09-20',
    minutes: 90,
    billable: true,
    note: 'Inspection et tests',
    operationKey: randomUUID(),
  });
  it('assigns real active people without exposing authentication/contact data', async () => {
    const people = (await call('get', 'services/references/people', undefined, reader).expect(200))
      .body.items;
    expect(people.map((p: any) => p.id)).toContain(workerId);
    expect(people.map((p: any) => p.id)).not.toContain(disabledId);
    expect(people.map((p: any) => p.id)).not.toContain(foreignUserId);
    expect(people[0]).not.toHaveProperty('passwordHash');
    expect(people[0]).not.toHaveProperty('email');
    const p = await activate(await project());
    for (const assigneeUserId of [disabledId, foreignUserId])
      await call('post', 'services/jobs', {
        title: 'Invalid assignment',
        projectId: p.id,
        assigneeUserId,
      }).expect(400);
    const { j } = await startAssigned(workerId, p);
    expect(j.assignee.id).toBe(workerId);
    const mine = (
      await call(
        'get',
        'services/jobs?assignment=mine&status=IN_PROGRESS',
        undefined,
        worker,
      ).expect(200)
    ).body.items;
    expect(mine.map((row: any) => row.id)).toContain(j.id);
    await call('patch', `services/jobs/${j.id}`, {
      assigneeUserId: disabledId,
      expectedUpdatedAt: j.updatedAt,
    }).expect(400);
    await call('patch', `services/jobs/${j.id}`, {
      assigneeUserId: null,
      expectedUpdatedAt: j.updatedAt,
    }).expect(200);
    const notMine = (
      await call(
        'get',
        `services/jobs?assignment=mine&projectId=${p.id}`,
        undefined,
        worker,
      ).expect(200)
    ).body.items;
    expect(notMine).toHaveLength(0);
  });
  it('limits workers to their own assigned work while managers can record for others', async () => {
    const { j } = await startAssigned();
    await call('post', 'services/time-entries', timeBody(j), reader).expect(403);
    await call('post', 'services/time-entries', timeBody(j, operatorId), worker).expect(403);
    const other = await startAssigned(operatorId);
    await call('post', 'services/time-entries', timeBody(other.j), worker).expect(403);
    await call('post', 'services/time-entries', timeBody(j, disabledId)).expect(400);
    await call('post', 'services/time-entries', timeBody(j, foreignUserId)).expect(400);
    const own = (await call('post', 'services/time-entries', timeBody(j), worker).expect(201)).body;
    expect(own.createdBy.id).toBe(workerId);
    expect(own).not.toHaveProperty('requestFingerprint');
    const managed = (
      await call('post', 'services/time-entries', timeBody(other.j, operatorId)).expect(201)
    ).body;
    await call(
      'patch',
      `services/time-entries/${managed.id}`,
      {
        workDate: '2026-09-20',
        minutes: 20,
        billable: false,
        note: 'No access',
        expectedUpdatedAt: managed.updatedAt,
      },
      worker,
    ).expect(403);
    await call(
      'post',
      `services/time-entries/${managed.id}/void`,
      { reason: 'No access', expectedUpdatedAt: managed.updatedAt },
      worker,
    ).expect(403);
  });
  it('replays one time submission exactly once and protects updates, voids and totals', async () => {
    const { j, p } = await startAssigned();
    const body = timeBody(j);
    const results = await Promise.all([
      call('post', 'services/time-entries', body, worker),
      call('post', 'services/time-entries', body, worker),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    let entry = results[0].body;
    expect(results[1].body.id).toBe(entry.id);
    expect(
      await db.serviceTimeEntry.count({ where: { tenantId, operationKey: body.operationKey } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { tenantId, entityId: entry.id, action: 'CREATE' } }),
    ).toBe(1);
    await call('post', 'services/time-entries', { ...body, minutes: 91 }, worker).expect(409);
    const updates = await Promise.all(
      [60, 75].map((minutes) =>
        call(
          'patch',
          `services/time-entries/${entry.id}`,
          {
            workDate: body.workDate,
            minutes,
            billable: false,
            note: 'Durée corrigée',
            expectedUpdatedAt: entry.updatedAt,
          },
          worker,
        ),
      ),
    );
    expect(updates.map((r) => r.status).sort()).toEqual([200, 409]);
    entry = updates.find((r) => r.status === 200)!.body;
    await call('post', 'services/time-entries', { ...timeBody(j), minutes: 30 }, worker).expect(
      201,
    );
    let list = (await call('get', `services/time-entries?projectId=${p.id}&pageSize=1`).expect(200))
      .body;
    expect(list.items).toHaveLength(1);
    expect(list.summary).toMatchObject({ minutes: entry.minutes + 30, billableMinutes: 30 });
    await call(
      'post',
      `services/time-entries/${entry.id}/void`,
      { expectedUpdatedAt: entry.updatedAt, reason: ' ' },
      worker,
    ).expect(400);
    entry = (
      await call(
        'post',
        `services/time-entries/${entry.id}/void`,
        { expectedUpdatedAt: entry.updatedAt, reason: 'Saisie en double vérifiée' },
        worker,
      ).expect(201)
    ).body;
    expect(entry.status).toBe('VOIDED');
    await call(
      'patch',
      `services/time-entries/${entry.id}`,
      {
        workDate: body.workDate,
        minutes: 20,
        billable: false,
        note: 'Too late',
        expectedUpdatedAt: entry.updatedAt,
      },
      worker,
    ).expect(409);
    list = (await call('get', `services/time-entries?projectId=${p.id}`).expect(200)).body;
    expect(list.total).toBe(2);
    expect(list.summary).toMatchObject({ minutes: 30, billableMinutes: 30, approvedMinutes: 0 });
    await call('get', 'services/time-entries?from=2026-10-01&to=2026-09-01').expect(400);
  });
  it('serializes the daily limit across jobs and rejects invalid durations', async () => {
    const a = await startAssigned(),
      b = await startAssigned();
    for (const minutes of [0, -1, 1.5, 1441])
      await call('post', 'services/time-entries', { ...timeBody(a.j), minutes }, worker).expect(
        400,
      );
    const results = await Promise.all(
      [a.j, b.j].map((j) =>
        call(
          'post',
          'services/time-entries',
          { ...timeBody(j), workDate: '2026-09-19', minutes: 1000 },
          worker,
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it('freezes times on project closure but keeps disabled people in history', async () => {
    let { j, p } = await startAssigned();
    let entry = (await call('post', 'services/time-entries', timeBody(j), worker).expect(201)).body;
    entry = (
      await call(
        'post',
        `services/time-entries/${entry.id}/review`,
        { action: 'SUBMIT', expectedUpdatedAt: entry.updatedAt },
        worker,
      ).expect(201)
    ).body;
    entry = (
      await call(
        'post',
        `services/time-entries/${entry.id}/review`,
        { action: 'APPROVE', expectedUpdatedAt: entry.updatedAt },
        reviewer,
      ).expect(201)
    ).body;
    j = (
      await call('post', `services/jobs/${j.id}/transition`, {
        expectedUpdatedAt: j.updatedAt,
        status: 'COMPLETED',
        report: 'Terminé',
      }).expect(201)
    ).body;
    p = (
      await call('post', `services/projects/${p.id}/transition`, {
        expectedUpdatedAt: p.updatedAt,
        status: 'COMPLETED',
      }).expect(201)
    ).body;
    await call('post', 'services/time-entries', timeBody(j), worker).expect(409);
    await call('post', `services/time-entries/${entry.id}/void`, {
      expectedUpdatedAt: entry.updatedAt,
      reason: 'Fermé',
    }).expect(409);
    await db.user.updateMany({ where: { tenantId, id: workerId }, data: { status: 'DISABLED' } });
    const rows = (await call('get', `services/time-entries?projectId=${p.id}`).expect(200)).body
      .items;
    expect(rows[0].user.status).toBe('DISABLED');
    expect((await call('get', `services/jobs/${j.id}`).expect(200)).body.assignee.id).toBe(
      workerId,
    );
    await db.user.updateMany({ where: { tenantId, id: workerId }, data: { status: 'ACTIVE' } });
  });
  it('serializes project closure with a last time submission and preserves replay', async () => {
    let { j, p } = await startAssigned();
    j = (
      await call('post', `services/jobs/${j.id}/transition`, {
        expectedUpdatedAt: j.updatedAt,
        status: 'COMPLETED',
        report: 'Travail fini',
      }).expect(201)
    ).body;
    const body = { ...timeBody(j), workDate: '2026-09-18' };
    const [close, record] = await Promise.all([
      call('post', `services/projects/${p.id}/transition`, {
        expectedUpdatedAt: p.updatedAt,
        status: 'COMPLETED',
      }),
      call('post', 'services/time-entries', body, worker),
    ]);
    expect([close.status, record.status].sort()).toEqual([201, 409]);
    expect(await db.serviceTimeEntry.count({ where: { tenantId, jobId: j.id } })).toBe(
      record.status === 201 ? 1 : 0,
    );
    if (record.status === 201) {
      const replay = await call('post', 'services/time-entries', body, worker).expect(201);
      expect(replay.body.id).toBe(record.body.id);
    }
    expect(
      (await call('get', `services/time-entries?projectId=${foreignPartner.id}`).expect(200)).body
        .total,
    ).toBe(0);
  });
  const reviewTime = async (entry: any, action: string, auth = reviewer, reason?: string) =>
    (
      await call(
        'post',
        `services/time-entries/${entry.id}/review`,
        { action, expectedUpdatedAt: entry.updatedAt, ...(reason ? { reason } : {}) },
        auth,
      ).expect(201)
    ).body;
  const reviewBody = (entry: any, action: string, reason?: string) => ({
    action,
    expectedUpdatedAt: entry.updatedAt,
    ...(reason ? { reason } : {}),
  });
  const editableFields = {
    workDate: '2026-09-17',
    minutes: 35,
    billable: true,
    note: 'Durée vérifiée sur le rapport terrain',
  };
  it('requires dedicated independent approval, not management rights or self-validation', async () => {
    const { j } = await startAssigned();
    let entry = (
      await call(
        'post',
        'services/time-entries',
        { ...timeBody(j), minutes: 25, workDate: '2026-09-17' },
        worker,
      ).expect(201)
    ).body;
    await call(
      'post',
      `services/time-entries/${entry.id}/review`,
      reviewBody(entry, 'APPROVE'),
    ).expect(403);
    await call(
      'post',
      `services/time-entries/${entry.id}/review`,
      reviewBody(entry, 'APPROVE'),
      reviewer,
    ).expect(409);
    await call(
      'post',
      `services/time-entries/${entry.id}/review`,
      reviewBody(entry, 'SUBMIT'),
      reader,
    ).expect(403);
    entry = await reviewTime(entry, 'SUBMIT', worker);
    await call(
      'post',
      `services/time-entries/${entry.id}/review`,
      reviewBody(entry, 'APPROVE'),
      worker,
    ).expect(403);
    const managed = (
      await call(
        'post',
        'services/time-entries',
        { ...timeBody(j), minutes: 20, workDate: '2026-09-17' },
        reviewer,
      ).expect(201)
    ).body;
    const submitted = await reviewTime(managed, 'SUBMIT', worker);
    await call(
      'post',
      `services/time-entries/${submitted.id}/review`,
      reviewBody(submitted, 'APPROVE'),
      reviewer,
    ).expect(403);
    const ownJob = await startAssigned(reviewerId);
    let own = (
      await call('post', 'services/time-entries', {
        ...timeBody(ownJob.j, reviewerId),
        minutes: 20,
        workDate: '2026-09-17',
      }).expect(201)
    ).body;
    own = await reviewTime(own, 'SUBMIT', reviewer);
    await call(
      'post',
      `services/time-entries/${own.id}/review`,
      reviewBody(own, 'APPROVE'),
      reviewer,
    ).expect(403);
  });
  it('rejects with a reason, preserves corrected snapshots and reopens explicitly', async () => {
    const { j, p } = await startAssigned();
    let entry = (
      await call(
        'post',
        'services/time-entries',
        { ...timeBody(j), minutes: 25, workDate: '2026-09-17' },
        worker,
      ).expect(201)
    ).body;
    entry = await reviewTime(entry, 'SUBMIT', worker);
    await call(
      'patch',
      `services/time-entries/${entry.id}`,
      { ...editableFields, expectedUpdatedAt: entry.updatedAt },
      worker,
    ).expect(409);
    await call(
      'post',
      `services/time-entries/${entry.id}/review`,
      reviewBody(entry, 'REJECT'),
      reviewer,
    ).expect(400);
    await call(
      'post',
      `services/time-entries/${entry.id}/review`,
      reviewBody(entry, 'REJECT', ' '),
      reviewer,
    ).expect(400);
    entry = await reviewTime(entry, 'REJECT', reviewer, 'Vérifier les essais terrain');
    expect(entry.status).toBe('REJECTED');
    entry = (
      await call(
        'patch',
        `services/time-entries/${entry.id}`,
        { ...editableFields, expectedUpdatedAt: entry.updatedAt },
        worker,
      ).expect(200)
    ).body;
    entry = await reviewTime(entry, 'SUBMIT', worker);
    entry = await reviewTime(entry, 'APPROVE');
    const approvedVersion = entry.updatedAt;
    expect(entry.status).toBe('APPROVED');
    await call('patch', `services/time-entries/${entry.id}`, {
      ...editableFields,
      expectedUpdatedAt: entry.updatedAt,
    }).expect(409);
    await call('post', `services/time-entries/${entry.id}/void`, {
      expectedUpdatedAt: entry.updatedAt,
      reason: 'Pas directement',
    }).expect(409);
    let totals = (
      await call('get', `services/time-entries?projectId=${p.id}&pageSize=1`).expect(200)
    ).body;
    expect(totals.summary).toMatchObject({
      approvedMinutes: 35,
      approvedBillableMinutes: 35,
      submittedMinutes: 0,
    });
    await call(
      'post',
      `services/time-entries/${entry.id}/review`,
      reviewBody(entry, 'REOPEN'),
      reviewer,
    ).expect(400);
    entry = await reviewTime(entry, 'REOPEN', reviewer, 'Le rapport client demande un complément');
    expect(entry.status).toBe('RECORDED');
    totals = (await call('get', `services/time-entries?projectId=${p.id}`).expect(200)).body;
    expect(totals.summary.approvedMinutes).toBe(0);
    const history = (
      await call(
        'get',
        `services/time-entries/${entry.id}/reviews?pageSize=2`,
        undefined,
        reader,
      ).expect(200)
    ).body;
    expect(history.total).toBe(6);
    expect(history.items).toHaveLength(2);
    expect(history.items[0]).toMatchObject({
      action: 'REOPEN',
      reason: 'Le rapport client demande un complément',
      actor: { id: reviewerId },
    });
    expect(history.items[1]).toMatchObject({
      action: 'APPROVE',
      entryVersion: approvedVersion,
      snapshot: { after: { minutes: 35 } },
    });
    expect(JSON.stringify(history)).not.toMatch(/passwordHash|serviceUserId|secretHash|@business-/);
    const corrected = await db.serviceTimeReview.findFirstOrThrow({
      where: { tenantId, timeEntryId: entry.id, action: 'CORRECT' },
    });
    expect(corrected.snapshot).toMatchObject({ before: { minutes: 25 }, after: { minutes: 35 } });
    entry = await reviewTime(entry, 'SUBMIT', worker);
    entry = await reviewTime(entry, 'WITHDRAW', worker);
    expect(entry.status).toBe('RECORDED');
    await call(
      'post',
      `services/time-entries/${entry.id}/review`,
      reviewBody(entry, 'VOID'),
      reviewer,
    ).expect(400);
  });
  it('does not let a reviewer approve their own last correction', async () => {
    const { j } = await startAssigned();
    let entry = (
      await call(
        'post',
        'services/time-entries',
        { ...timeBody(j), minutes: 25, workDate: '2026-09-17' },
        worker,
      ).expect(201)
    ).body;
    entry = (
      await call(
        'patch',
        `services/time-entries/${entry.id}`,
        { ...editableFields, expectedUpdatedAt: entry.updatedAt },
        reviewer,
      ).expect(200)
    ).body;
    entry = await reviewTime(entry, 'SUBMIT', worker);
    await call(
      'post',
      `services/time-entries/${entry.id}/review`,
      reviewBody(entry, 'APPROVE'),
      reviewer,
    ).expect(403);
  });
  it('claims a concurrent decision only once and filters totals across all states', async () => {
    const { j, p } = await startAssigned();
    let entry = (
      await call(
        'post',
        'services/time-entries',
        { ...timeBody(j), minutes: 25, workDate: '2026-09-17' },
        worker,
      ).expect(201)
    ).body;
    entry = await reviewTime(entry, 'SUBMIT', worker);
    const results = await Promise.all(
      ['APPROVE', 'REJECT'].map((action) =>
        call(
          'post',
          `services/time-entries/${entry.id}/review`,
          reviewBody(entry, action, 'Revue concurrente'),
          reviewer,
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.serviceTimeReview.count({ where: { tenantId, timeEntryId: entry.id } })).toBe(
      2,
    );
    const winner = results.find((r) => r.status === 201)!.body;
    const filtered = (
      await call(
        'get',
        `services/time-entries?projectId=${p.id}&status=${winner.status}&pageSize=1`,
      ).expect(200)
    ).body;
    expect(filtered.total).toBe(1);
    expect(filtered.summary.minutes).toBe(25);
    const pending = (
      await call('get', `services/time-entries?projectId=${p.id}&status=SUBMITTED`).expect(200)
    ).body;
    expect(pending.total).toBe(0);
    expect(pending.summary.submittedMinutes).toBe(0);
    await call('get', 'services/time-entries?status=INVALID').expect(400);
  });
  it('blocks project closure until all times are approved or voided and isolates review history', async () => {
    let { j, p } = await startAssigned();
    let entry = (
      await call(
        'post',
        'services/time-entries',
        { ...timeBody(j), minutes: 25, workDate: '2026-09-17' },
        worker,
      ).expect(201)
    ).body;
    j = (
      await call('post', `services/jobs/${j.id}/transition`, {
        status: 'COMPLETED',
        report: 'Travail fini',
        expectedUpdatedAt: j.updatedAt,
      }).expect(201)
    ).body;
    for (const status of ['COMPLETED', 'CANCELLED'])
      await call('post', `services/projects/${p.id}/transition`, {
        status,
        expectedUpdatedAt: p.updatedAt,
      }).expect(409);
    entry = await reviewTime(entry, 'SUBMIT', worker);
    await call('post', `services/projects/${p.id}/transition`, {
      status: 'COMPLETED',
      expectedUpdatedAt: p.updatedAt,
    }).expect(409);
    entry = await reviewTime(entry, 'APPROVE');
    await call('post', `services/projects/${p.id}/transition`, {
      status: 'COMPLETED',
      expectedUpdatedAt: p.updatedAt,
    }).expect(201);
    await call(
      'post',
      `services/time-entries/${entry.id}/review`,
      reviewBody(entry, 'REOPEN', 'Projet fermé'),
      reviewer,
    ).expect(409);
    const foreignProject = await db.serviceProject.create({
      data: { tenantId: foreign, number: 'F-1', title: 'Foreign', partnerId: foreignPartner.id },
    });
    const foreignJob = await db.serviceJob.create({
      data: { tenantId: foreign, projectId: foreignProject.id, number: 'F-1', title: 'Foreign' },
    });
    const foreignEntry = await db.serviceTimeEntry.create({
      data: {
        tenantId: foreign,
        jobId: foreignJob.id,
        userId: foreignUserId,
        createdById: foreignUserId,
        workDate: new Date('2026-09-17'),
        minutes: 10,
        note: 'Foreign',
        operationKey: randomUUID(),
        requestFingerprint: 'foreign',
      },
    });
    await call('get', `services/time-entries/${foreignEntry.id}/reviews`).expect(404);
    await call(
      'post',
      `services/time-entries/${foreignEntry.id}/review`,
      reviewBody({ ...foreignEntry, updatedAt: foreignEntry.updatedAt.toISOString() }, 'SUBMIT'),
      reviewer,
    ).expect(404);
  });
  async function partsFixture() {
    const p = await activate(await project());
    let j = (
      await call('post', 'services/jobs', { projectId: p.id, title: 'Pièces terrain' }).expect(201)
    ).body;
    j = (
      await call('post', `services/jobs/${j.id}/transition`, {
        status: 'IN_PROGRESS',
        expectedUpdatedAt: j.updatedAt,
      }).expect(201)
    ).body;
    const product = (
      await call('post', 'catalog/items', {
        code: randomUUID(),
        name: 'Joint de pompe',
        kind: 'GOODS',
        unit: 'EA',
      }).expect(201)
    ).body;
    const wms = await db.wmsItem.create({
      data: { tenantId, sku: randomUUID(), name: 'Joint physique', unit: 'EA' },
    });
    const location = await db.location.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Entrepôt test',
        type: 'WAREHOUSE',
        addressLine1: '10 rue des essais',
        city: 'Québec',
      },
    });
    const bin = await db.bin.create({ data: { tenantId, locationId: location.id, code: 'A1' } });
    await call('post', 'wms/inventory/adjust', {
      itemId: wms.id,
      binId: bin.id,
      qtyDelta: 5,
      note: 'Fixture',
    }).expect(201);
    await call('patch', `catalog/items/${product.id}/stock-link`, {
      wmsItemId: wms.id,
      expectedUpdatedAt: product.updatedAt,
    }).expect(200);
    const body = {
      catalogItemId: product.id,
      binId: bin.id,
      quantity: 2,
      note: 'Pose des joints',
      operationKey: randomUUID(),
      expectedUpdatedAt: j.updatedAt,
    };
    return { p, j, product, wms, bin, body };
  }
  it('links compatible goods only, checks uniqueness, ownership, version and WMS access', async () => {
    const f = await partsFixture();
    const foreignWms = await db.wmsItem.create({
      data: { tenantId: foreign, sku: randomUUID(), name: 'Foreign', unit: 'EA' },
    });
    let link = (await call('get', `catalog/items/${f.product.id}/stock-link`).expect(200)).body;
    await call('patch', `catalog/items/${f.product.id}/stock-link`, {
      wmsItemId: foreignWms.id,
      expectedUpdatedAt: link.updatedAt,
    }).expect(400);
    await call('patch', `catalog/items/${f.product.id}/stock-link`, {
      wmsItemId: null,
      expectedUpdatedAt: f.product.updatedAt,
    }).expect(409);
    await call('patch', `catalog/items/${item.id}/stock-link`, {
      wmsItemId: f.wms.id,
      expectedUpdatedAt: item.updatedAt,
    }).expect(400);
    const second = (
      await call('post', 'catalog/items', {
        code: randomUUID(),
        name: 'Autre',
        kind: 'GOODS',
        unit: 'EA',
      }).expect(201)
    ).body;
    await call('patch', `catalog/items/${second.id}/stock-link`, {
      wmsItemId: f.wms.id,
      expectedUpdatedAt: second.updatedAt,
    }).expect(409);
    const kg = await db.wmsItem.create({
      data: { tenantId, sku: randomUUID(), name: 'KG', unit: 'KG' },
    });
    await call('patch', `catalog/items/${second.id}/stock-link`, {
      wmsItemId: kg.id,
      expectedUpdatedAt: second.updatedAt,
    }).expect(400);
    await call('patch', `wms/items/${f.wms.id}`, { unit: 'KG' }).expect(409);
    await call('get', `catalog/items/${f.product.id}/stock-link`, undefined, reader).expect(403);
    await call('get', 'services/references/parts', undefined, reader).expect(403);
    await call('get', `services/jobs/foreign/parts`).expect(404);
  });
  it('posts one issue under concurrent identical requests and preserves snapshots on return after unlink', async () => {
    const f = await partsFixture();
    const route = `services/jobs/${f.j.id}/parts`;
    const rs = await Promise.all([call('post', route, f.body), call('post', route, f.body)]);
    expect(rs.map((r) => r.status)).toEqual([201, 201]);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(rs.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    const usage = rs[0].body;
    const level = () =>
      db.inventoryLevel.findFirstOrThrow({
        where: { tenantId, itemId: f.wms.id, binId: f.bin.id },
      });
    expect(Number((await level()).qtyOnHand)).toBe(3);
    await call('post', route, { ...f.body, quantity: 3 }).expect(409);
    const link = (await call('get', `catalog/items/${f.product.id}/stock-link`)).body;
    await call('patch', `catalog/items/${f.product.id}/stock-link`, {
      wmsItemId: null,
      expectedUpdatedAt: link.updatedAt,
    }).expect(200);
    await call('patch', `wms/items/${f.wms.id}`, { unit: 'KG' }).expect(409);
    const j = (await call('get', `services/jobs/${f.j.id}`)).body;
    await call('post', `services/jobs/${j.id}/transition`, {
      status: 'CANCELLED',
      expectedUpdatedAt: j.updatedAt,
    }).expect(409);
    const rb = {
      operationKey: randomUUID(),
      expectedUpdatedAt: j.updatedAt,
      reason: 'Pièces non utilisées revenues au rangement',
    };
    const returns = await Promise.all([
      call('post', `${route}/${usage.id}/return`, rb),
      call('post', `${route}/${usage.id}/return`, rb),
    ]);
    expect(returns.map((r) => r.status)).toEqual([201, 201]);
    expect(Number((await level()).qtyOnHand)).toBe(5);
    expect(
      await db.stockMovement.count({ where: { tenantId, refType: 'service-job', refId: j.id } }),
    ).toBe(2);
    const history = (await call('get', route, undefined, reader).expect(200)).body.items[0];
    expect(history.nameSnapshot).toBe('Joint de pompe');
    expect(history.unitSnapshot).toBe('EA');
    expect(history.returnMovementId).toBeTruthy();
    expect(history).not.toHaveProperty('requestFingerprint');
    expect(history).not.toHaveProperty('tenantId');
    const journal = (
      await call('get', `wms/inventory/movements?refType=service-job&refId=${j.id}`).expect(200)
    ).body;
    expect(journal.items).toHaveLength(2);
    expect(
      journal.items.every((m: any) => m.source?.kind === 'service-job' && m.source.id === j.id),
    ).toBe(true);
  });
  it('rolls back short stock and rejects inactive bins, invalid quantities and cross-tenant references', async () => {
    const f = await partsFixture();
    const route = `services/jobs/${f.j.id}/parts`;
    for (const quantity of [0, -1, 0.0001])
      await call('post', route, { ...f.body, quantity }).expect(400);
    await call('post', route, { ...f.body, quantity: 6 }).expect(409);
    expect(await db.servicePartUsage.count({ where: { tenantId, jobId: f.j.id } })).toBe(0);
    expect(await db.stockMovement.count({ where: { tenantId, refId: f.j.id } })).toBe(0);
    await call('post', route, { ...f.body, catalogItemId: foreignItem.id }).expect(400);
    await db.bin.updateMany({ where: { tenantId, id: f.bin.id }, data: { isActive: false } });
    await call('post', route, f.body).expect(409);
    await db.bin.updateMany({ where: { tenantId, id: f.bin.id }, data: { isActive: true } });
    await call('post', route, f.body, reader).expect(403);
    await call('post', route, { ...f.body, tenantId: foreign }).expect(400);
  });
  it('serializes competing stock issues and refuses stale job versions', async () => {
    const f = await partsFixture();
    const p = await activate(await project());
    let j2 = (await call('post', 'services/jobs', { projectId: p.id, title: 'Autre intervention' }))
      .body;
    j2 = (
      await call('post', `services/jobs/${j2.id}/transition`, {
        status: 'IN_PROGRESS',
        expectedUpdatedAt: j2.updatedAt,
      })
    ).body;
    const rs = await Promise.all([
      call('post', `services/jobs/${f.j.id}/parts`, { ...f.body, quantity: 4 }),
      call('post', `services/jobs/${j2.id}/parts`, {
        ...f.body,
        quantity: 4,
        operationKey: randomUUID(),
        expectedUpdatedAt: j2.updatedAt,
      }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      Number(
        (
          await db.inventoryLevel.findFirstOrThrow({
            where: { tenantId, itemId: f.wms.id, binId: f.bin.id },
          })
        ).qtyOnHand,
      ),
    ).toBe(1);
    const winner = rs[0].status === 201 ? f.j : j2;
    await call('post', `services/jobs/${winner.id}/parts`, {
      ...f.body,
      quantity: 1,
      operationKey: randomUUID(),
      expectedUpdatedAt: winner.updatedAt,
    }).expect(409);
  });
  it('freezes parts on project closure, supports safe replay and gates disabled WMS without hiding service history', async () => {
    const f = await partsFixture();
    const route = `services/jobs/${f.j.id}/parts`;
    const part = (await call('post', route, f.body).expect(201)).body;
    const j = (await call('get', `services/jobs/${f.j.id}`)).body;
    const completed = (
      await call('post', `services/jobs/${j.id}/transition`, {
        status: 'COMPLETED',
        expectedUpdatedAt: j.updatedAt,
        report: 'Installation terminée',
      }).expect(201)
    ).body;
    await call('post', `services/projects/${f.p.id}/transition`, {
      status: 'COMPLETED',
      expectedUpdatedAt: f.p.updatedAt,
    }).expect(201);
    await call('post', route, f.body).expect(201);
    await call('post', `${route}/${part.id}/return`, {
      operationKey: randomUUID(),
      expectedUpdatedAt: completed.updatedAt,
      reason: 'Projet déjà clos',
    }).expect(409);
    await app.get(ModuleRegistryService).setEnabled(tenantId, 'wms', false);
    await call('get', 'services/references/parts').expect(403);
    await call('get', `catalog/items/${f.product.id}/stock-link`).expect(403);
    await call('post', route, f.body).expect(403);
    await call('get', route).expect(200);
    await app.get(ModuleRegistryService).setEnabled(tenantId, 'wms', true);
  });
  async function purchaseFixture() {
    const f = await partsFixture();
    let o = (
      await call('post', 'purchasing/orders', {
        supplierId: partner.id,
        currency: 'CAD',
        lines: [{ catalogItemId: f.product.id, quantity: 10, unitPrice: 2 }],
      }).expect(201)
    ).body;
    o = (
      await call('post', `purchasing/orders/${o.id}/transition`, {
        status: 'CONFIRMED',
        expectedUpdatedAt: o.updatedAt,
      }).expect(201)
    ).body;
    const body = {
      operationKey: randomUUID(),
      expectedUpdatedAt: o.updatedAt,
      locationId: f.bin.locationId,
      reference: 'BL physique',
      lines: [{ orderLineId: o.lines[0].id, binId: f.bin.id, quantity: 4 }],
    };
    return { ...f, o, body };
  }
  it('receives partial supplier arrivals atomically, replays once, then closes a fulfilled order', async () => {
    const f = await purchaseFixture(),
      path = `purchasing/orders/${f.o.id}/receipts`;
    const responses = await Promise.all([
      call('post', path, f.body).expect(201),
      call('post', path, f.body).expect(201),
    ]);
    expect(new Set(responses.map((r) => r.body.receiptId)).size).toBe(1);
    expect(responses.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    const receiptId = responses[0].body.receiptId;
    expect((await call('get', `wms/receipts/${receiptId}`).expect(200)).body.status).toBe('POSTED');
    expect(
      await db.stockMovement.count({ where: { tenantId, refType: 'receipt', refId: receiptId } }),
    ).toBe(1);
    let o = (await call('get', `purchasing/orders/${f.o.id}`).expect(200)).body;
    expect(o.lines[0]).toMatchObject({ received: '4', remaining: '6' });
    expect(
      (
        await db.inventoryLevel.findFirstOrThrow({
          where: { tenantId, itemId: f.wms.id, binId: f.bin.id },
        })
      ).qtyOnHand.toString(),
    ).toBe('9');
    await call('post', path, { ...f.body, reference: 'Autre' }).expect(409);
    await call('post', `purchasing/orders/${o.id}/transition`, {
      status: 'CANCELLED',
      expectedUpdatedAt: o.updatedAt,
    }).expect(409);
    await call('post', `purchasing/orders/${o.id}/transition`, {
      status: 'CLOSED',
      expectedUpdatedAt: o.updatedAt,
    }).expect(409);
    await call('post', path, {
      ...f.body,
      operationKey: randomUUID(),
      expectedUpdatedAt: o.updatedAt,
      lines: [{ ...f.body.lines[0], quantity: 6 }],
    }).expect(201);
    o = (await call('get', `purchasing/orders/${o.id}`).expect(200)).body;
    expect(o.lines[0]).toMatchObject({ received: '10', remaining: '0' });
    await call('post', `purchasing/orders/${o.id}/transition`, {
      status: 'CLOSED',
      expectedUpdatedAt: o.updatedAt,
    }).expect(201);
    expect((await call('post', path, f.body).expect(201)).body.replayed).toBe(true);
    expect((await call('get', path).expect(200)).body.total).toBe(2);
  });
  it('rejects overreceipts, foreign lines, wrong warehouses and unauthorized actors without side effects', async () => {
    const f = await purchaseFixture(),
      path = `purchasing/orders/${f.o.id}/receipts`;
    await call('post', path, { ...f.body, lines: [{ ...f.body.lines[0], quantity: 11 }] }).expect(
      409,
    );
    await call('post', path, {
      ...f.body,
      lines: [
        { ...f.body.lines[0], quantity: 6 },
        { ...f.body.lines[0], quantity: 6 },
      ],
    }).expect(409);
    await call('post', path, {
      ...f.body,
      lines: [{ ...f.body.lines[0], quantity: 0.0001 }],
    }).expect(400);
    await call('post', path, {
      ...f.body,
      lines: [{ ...f.body.lines[0], orderLineId: foreignItem.id }],
    }).expect(404);
    const other = await partsFixture();
    await call('post', path, { ...f.body, locationId: other.bin.locationId }).expect(400);
    await call('post', path, f.body, reader).expect(403);
    expect(await db.supplierReceipt.count({ where: { tenantId, orderId: f.o.id } })).toBe(0);
    await call('post', path, f.body).expect(201);
    await call('post', path, { ...f.body, operationKey: randomUUID() }).expect(409);
    const o = (await call('get', `purchasing/orders/${f.o.id}`).expect(200)).body;
    const closed = await call('post', `purchasing/orders/${o.id}/transition`, {
      status: 'CLOSED',
      expectedUpdatedAt: o.updatedAt,
      closeReason: 'Solde abandonné par le fournisseur',
    }).expect(201);
    expect(closed.body.closeReason).toContain('abandonné');
    await call('post', path, {
      ...f.body,
      operationKey: randomUUID(),
      expectedUpdatedAt: closed.body.updatedAt,
    }).expect(409);
  });
  it('validates and stores required WMS custom fields on supplier receipts without bypassing stock guards', async () => {
    const f = await purchaseFixture(),
      path = `purchasing/orders/${f.o.id}/receipts`;
    const definition = await db.customFieldDefinition.create({
      data: {
        tenantId,
        module: 'wms',
        entityType: 'RECEIPT',
        key: 'arrival_seal',
        label: 'Sceau reçu',
        type: 'TEXT',
        required: true,
      },
    });
    try {
      await call('post', path, f.body).expect(400);
      expect(await db.supplierReceipt.count({ where: { tenantId, orderId: f.o.id } })).toBe(0);
      const body = { ...f.body, customData: { arrival_seal: 'SC-123' } };
      const receipt = (await call('post', path, body).expect(201)).body;
      expect(
        (await call('get', `wms/receipts/${receipt.receiptId}`).expect(200)).body.customData,
      ).toEqual(body.customData);
      await call('post', path, { ...body, customData: { arrival_seal: 'SC-456' } }).expect(409);
      expect((await call('post', path, body).expect(201)).body.replayed).toBe(true);
    } finally {
      await db.customFieldDefinition.deleteMany({ where: { tenantId, id: definition.id } });
    }
  });
  it('serializes competing arrivals and freezes WMS unit after unlinking purchased stock', async () => {
    const f = await purchaseFixture(),
      path = `purchasing/orders/${f.o.id}/receipts`;
    const results = await Promise.all([
      call('post', path, {
        ...f.body,
        operationKey: randomUUID(),
        lines: [{ ...f.body.lines[0], quantity: 7 }],
      }),
      call('post', path, {
        ...f.body,
        operationKey: randomUUID(),
        lines: [{ ...f.body.lines[0], quantity: 7 }],
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const product = (await call('get', `catalog/items/${f.product.id}/stock-link`).expect(200))
      .body;
    await call('patch', `catalog/items/${f.product.id}/stock-link`, {
      wmsItemId: null,
      expectedUpdatedAt: product.updatedAt,
    }).expect(200);
    await call('patch', `wms/items/${f.wms.id}`, { unit: 'KG' }).expect(409);
    const module = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: module.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await call('post', path, f.body).expect(403);
    expect((await call('get', path).expect(200)).body.total).toBe(1);
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: module.id },
      data: { enabled: true },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
  });
  it('runs SAV qualification, resolution, reopening and final closure with a durable actor history', async () => {
    const body = {
      partnerId: partner.id,
      title: 'Pompe bruyante',
      description: 'Bruit constaté après installation',
      priority: 'HIGH',
      operationKey: randomUUID(),
    };
    const results = await Promise.all([
      call('post', 'support/cases', body).expect(201),
      call('post', 'support/cases', body).expect(201),
    ]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    let c = results[0].body;
    expect(c).not.toHaveProperty('requestFingerprint');
    expect(c).not.toHaveProperty('operationKey');
    await call('post', 'support/cases', { ...body, title: 'Autre' }).expect(409);
    await call('post', `support/cases/${c.id}/transition`, {
      status: 'RESOLVED',
      note: 'Trop tôt',
      expectedUpdatedAt: c.updatedAt,
    }).expect(409);
    for (const status of ['IN_PROGRESS', 'RESOLVED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
      c = (
        await call('post', `support/cases/${c.id}/transition`, {
          status,
          note: 'Décision vérifiée',
          expectedUpdatedAt: c.updatedAt,
        }).expect(201)
      ).body;
    await call('patch', `support/cases/${c.id}`, {
      title: 'Réécrire',
      description: 'Historique',
      priority: 'NORMAL',
      expectedUpdatedAt: c.updatedAt,
    }).expect(409);
    const h = (await call('get', `support/cases/${c.id}/history`).expect(200)).body;
    expect(h.total).toBe(6);
    expect(h.items[0].actor.firstName).toBe('Business');
    expect(
      (await call('get', 'support/cases?caseStatus=CLOSED').expect(200)).body.items.some(
        (x: any) => x.id === c.id,
      ),
    ).toBe(true);
  });
  it('isolates SAV writes and links only interventions of the same client without executing them', async () => {
    const { j } = await startAssigned();
    let c = (
      await call('post', 'support/cases', {
        partnerId: partner.id,
        title: 'Suivi client',
        description: 'Diagnostic demandé',
        priority: 'NORMAL',
        operationKey: randomUUID(),
      }).expect(201)
    ).body;
    const fields = { title: c.title, description: c.description, priority: c.priority };
    const linked = (
      await call('patch', `support/cases/${c.id}`, {
        ...fields,
        jobId: j.id,
        expectedUpdatedAt: c.updatedAt,
      }).expect(200)
    ).body;
    expect(linked.jobId).toBe(j.id);
    await call('patch', `support/cases/${c.id}`, {
      ...fields,
      expectedUpdatedAt: c.updatedAt,
    }).expect(409);
    await call('patch', `support/cases/${c.id}`, {
      ...fields,
      jobId: foreignItem.id,
      expectedUpdatedAt: linked.updatedAt,
    }).expect(400);
    const otherPartner = (
      await call('post', 'catalog/partners', {
        code: randomUUID(),
        name: 'Autre client',
        isCustomer: true,
        isSupplier: false,
      }).expect(201)
    ).body;
    const other = (
      await call('post', 'support/cases', {
        partnerId: otherPartner.id,
        title: 'Autre dossier',
        description: 'Description',
        priority: 'LOW',
        operationKey: randomUUID(),
      }).expect(201)
    ).body;
    const project = (await call('get', `services/projects/${j.projectId}`).expect(200)).body;
    await call('patch', `services/projects/${project.id}`, {
      partnerId: otherPartner.id,
      expectedUpdatedAt: project.updatedAt,
    }).expect(409);
    expect((await call('get', `services/projects/${project.id}`).expect(200)).body.partnerId).toBe(
      partner.id,
    );
    await call('patch', `support/cases/${other.id}`, {
      ...fields,
      jobId: j.id,
      expectedUpdatedAt: other.updatedAt,
    }).expect(409);
    await call('post', 'support/cases', {
      partnerId: foreignPartner.id,
      title: 'Autre tenant',
      description: 'Description',
      priority: 'NORMAL',
      operationKey: randomUUID(),
    }).expect(400);
    await call('get', `support/cases/${c.id}`, undefined, reader).expect(403);
    await call('get', 'support/cases/' + foreignItem.id).expect(404);
    expect((await call('get', `services/jobs/${j.id}`).expect(200)).body.status).toBe(j.status);
    await call('post', `support/cases/${c.id}/transition`, {
      status: 'IN_PROGRESS',
      note: ' ',
      expectedUpdatedAt: linked.updatedAt,
    }).expect(400);
    const module = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'support' } });
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: module.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await call('get', 'support/cases').expect(403);
  });
  it('blocks the business API when its module is disabled', async () => {
    const m = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'services' } });
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId: m.id } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await call('get', 'services/projects').expect(403);
    await call('get', 'services/references/customers').expect(403);
    await call('get', 'services/time-entries').expect(403);
    await call('get', 'services/references/people').expect(403);
    const journal = (await call('get', 'wms/inventory/movements?refType=service-job').expect(200))
      .body;
    expect(journal.items.every((m: any) => m.source === null)).toBe(true);
  });
});
