import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { MODULE_CATALOG, PERMISSION_CATALOG, RiskTier, AgentAutonomy } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { TOOL_BY_NAME } from '../src/core/agents/tool-registry';
describe('Connected business delivery (HTTP + PostgreSQL)', () => {
  let app: INestApplication, db: PrismaService, http: any, tenantId: string, foreign: string;
  let partner: any, item: any, project: any, job: any, employee: any, quote: any, time: any;
  const slug = `connected-${Date.now()}`,
    actors: Record<string, { id: string; token: string }> = {};
  const call = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: object,
    who = 'manager',
  ) =>
    request(http)
      [method]('/api/v1/' + path)
      .set('Authorization', `Bearer ${actors[who].token}`)
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
    foreign = (await db.tenant.create({ data: { slug: slug + '-foreign', name: 'Foreign' } })).id;
    for (const entry of MODULE_CATALOG.filter((m) =>
      ['catalog', 'services', 'support', 'hr', 'billing', 'purchasing', 'quality'].includes(m.key),
    )) {
      const module = await db.moduleDefinition.upsert({
        where: { key: entry.key },
        create: entry,
        update: entry,
      });
      await db.tenantModule.create({ data: { tenantId, moduleId: module.id, enabled: true } });
    }
    for (const p of PERMISSION_CATALOG)
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    const all = PERMISSION_CATALOG.map((p) => p.key);
    for (const [key, keys] of Object.entries({
      manager: all,
      worker: ['services.read', 'services.time.write', 'core.operating.tasks.read'],
      reader: ['services.read', 'core.operating.tasks.read'],
    })) {
      const ps = await db.permission.findMany({ where: { key: { in: keys } } });
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
          lastName: 'Connected',
          status: 'ACTIVE',
          passwordHash: hashSync('Test1234!', 4),
          roles: { create: { roleId: role.id } },
        },
      });
      const r = await request(http)
        .post('/api/v1/auth/login')
        .send({ tenant: slug, email, password: 'Test1234!' })
        .expect(200);
      actors[key] = { id: user.id, token: r.body.accessToken };
    }
    partner = (
      await call('post', 'catalog/partners', {
        code: 'CLIENT',
        name: 'Connected client',
        isCustomer: true,
        isSupplier: true,
      }).expect(201)
    ).body;
    item = (
      await call('post', 'catalog/items', {
        code: 'LABOUR',
        name: 'Labour',
        kind: 'SERVICE',
        unit: 'H',
      }).expect(201)
    ).body;
    employee = await db.hrEmployee.create({
      data: {
        tenantId,
        code: 'WORKER',
        firstName: 'Worker',
        lastName: 'Connected',
        userId: actors.worker.id,
      },
    });
  }, 90000);
  afterAll(async () => {
    await app?.close();
  });
  it('creates a quote idempotently, rejects changed payload and foreign references', async () => {
    const body = {
      operationKey: randomUUID(),
      partnerId: partner.id,
      title: 'Installation',
      currency: 'CAD',
      lines: [{ catalogItemId: item.id, quantity: 1.5, unitPrice: 80 }],
    };
    quote = (await call('post', 'services/quotes', body).expect(201)).body;
    expect(quote.totalAmount).toBe('120');
    expect((await call('post', 'services/quotes', body).expect(201)).body.id).toBe(quote.id);
    await call('post', 'services/quotes', { ...body, title: 'Changed' }).expect(409);
    const other = await db.businessPartner.create({
      data: { tenantId: foreign, code: 'FOREIGN', name: 'Foreign', isCustomer: true },
    });
    await call('post', 'services/quotes', {
      ...body,
      operationKey: randomUUID(),
      partnerId: other.id,
    }).expect(400);
    await call('post', 'services/quotes', body, 'reader').expect(403);
  });
  it('accepts once, freezes quote and customer, and creates one draft project', async () => {
    const body = { status: 'ACCEPTED', expectedUpdatedAt: quote.updatedAt };
    const [a, b] = await Promise.all([
      call('post', `services/quotes/${quote.id}/transition`, body),
      call('post', `services/quotes/${quote.id}/transition`, body),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.project.id).toBe(b.body.project.id);
    project = (await call('get', `services/projects/${a.body.project.id}`).expect(200)).body;
    expect(project.status).toBe('DRAFT');
    await call('patch', `services/quotes/${quote.id}`, {
      title: 'Changed',
      partnerId: partner.id,
      currency: 'CAD',
      lines: [{ catalogItemId: item.id, quantity: 1, unitPrice: 5 }],
      expectedUpdatedAt: a.body.updatedAt,
    }).expect(409);
    project = (
      await call('post', `services/projects/${project.id}/transition`, {
        status: 'ACTIVE',
        expectedUpdatedAt: project.updatedAt,
      }).expect(201)
    ).body;
    job = (
      await call('post', 'services/jobs', {
        projectId: project.id,
        title: 'Visit',
        assigneeUserId: actors.worker.id,
      }).expect(201)
    ).body;
  });
  it('checks timezone and durational overlap, including the ordinary edit path', async () => {
    const body = {
      localStart: '2030-01-07T09:00',
      assigneeUserId: actors.worker.id,
      plannedMinutes: 90,
      expectedUpdatedAt: job.updatedAt,
    };
    expect(
      (await call('post', `services/planning/${job.id}/check`, body).expect(200)).body.issues,
    ).toEqual([]);
    job = (await call('post', `services/planning/${job.id}/schedule`, body).expect(201)).body;
    expect(job.scheduledAt).toBe('2030-01-07T14:00:00.000Z');
    await call('post', `services/planning/${job.id}/schedule`, body).expect(409);
    await call('post', 'services/jobs', {
      projectId: project.id,
      title: 'Overlap',
      assigneeUserId: actors.worker.id,
      scheduledAt: '2030-01-07T14:30:00Z',
      plannedMinutes: 60,
    }).expect(409);
    await call('post', 'services/jobs', {
      projectId: project.id,
      title: 'Adjacent',
      assigneeUserId: actors.worker.id,
      scheduledAt: '2030-01-07T15:30:00Z',
      plannedMinutes: 60,
    }).expect(201);
    const board = (await call('get', 'services/planning?date=2030-01-07&days=7').expect(200)).body;
    expect(board.timeZone).toBe('America/Toronto');
    expect(board.jobs.some((j: any) => j.id === job.id)).toBe(true);
    await call(
      'post',
      `services/planning/${job.id}/check`,
      { ...body, expectedUpdatedAt: job.updatedAt },
      'reader',
    ).expect(403);
  });
  it('blocks approved absences and unmet skills without exposing private reasons', async () => {
    await db.hrLeaveRequest.create({
      data: {
        tenantId,
        number: 'ABS-TEST',
        employeeId: employee.id,
        createdById: actors.manager.id,
        kind: 'TIME_OFF',
        startDate: new Date('2030-01-08'),
        endDate: new Date('2030-01-08'),
        status: 'APPROVED',
        note: 'PRIVATE HR',
        operationKey: randomUUID(),
        fingerprint: 'test',
      },
    });
    const body = {
      localStart: '2030-01-08T09:00',
      assigneeUserId: actors.worker.id,
      plannedMinutes: 60,
      expectedUpdatedAt: job.updatedAt,
    };
    const result = await call('post', `services/planning/${job.id}/check`, body).expect(200);
    expect(result.body.issues.length).toBe(1);
    expect(JSON.stringify(result.body)).not.toContain('PRIVATE');
    await call('post', `services/planning/${job.id}/schedule`, body).expect(409);
    const skill = await db.hrSkill.create({
      data: { tenantId, code: 'QUAL', name: 'Qualified', kind: 'COMPETENCE' },
    });
    await call('put', `services/planning/${job.id}/requirements`, {
      skillIds: [skill.id],
      expectedUpdatedAt: job.updatedAt,
    }).expect(409);
    expect(await db.serviceJobSkillRequirement.count({ where: { tenantId, jobId: job.id } })).toBe(
      0,
    );
  });
  it('creates explicit billing mapping, hides it in generic catalogue, and enforces permissions', async () => {
    const r = await call('post', `catalog/partners/${partner.id}/billing-customer`, {
      expectedUpdatedAt: partner.updatedAt,
    }).expect(201);
    expect(r.body.customerId).toBeTruthy();
    expect((await call('get', 'catalog/partners').expect(200)).body.items[0]).not.toHaveProperty(
      'billingCustomerId',
    );
    await call('get', `services/projects/${project.id}/billable`, undefined, 'reader').expect(403);
  });
  it('follows submitted time → independent approval → single invoice with frozen source', async () => {
    job = (
      await call('post', `services/jobs/${job.id}/transition`, {
        status: 'IN_PROGRESS',
        expectedUpdatedAt: job.updatedAt,
      }).expect(201)
    ).body;
    time = (
      await call(
        'post',
        'services/time-entries',
        {
          jobId: job.id,
          userId: actors.worker.id,
          workDate: '2030-01-07',
          minutes: 90,
          note: 'Installation done',
          billable: true,
          operationKey: randomUUID(),
        },
        'worker',
      ).expect(201)
    ).body;
    time = (
      await call(
        'post',
        `services/time-entries/${time.id}/review`,
        { action: 'SUBMIT', expectedUpdatedAt: time.updatedAt },
        'worker',
      ).expect(201)
    ).body;
    const attention = (await call('get', 'operational-attention?kind=time').expect(200)).body;
    expect(attention.items.map((i: any) => i.id)).toContain(time.id);
    time = (
      await call('post', `services/time-entries/${time.id}/review`, {
        action: 'APPROVE',
        expectedUpdatedAt: time.updatedAt,
      }).expect(201)
    ).body;
    expect((await call('get', 'operational-attention?kind=time').expect(200)).body.total).toBe(0);
    const billable = (await call('get', `services/projects/${project.id}/billable`).expect(200))
      .body;
    expect(billable.sources[0].quantity).toBe('1.5');
    const body = {
      operationKey: randomUUID(),
      currency: 'CAD',
      sources: [{ kind: 'time', id: time.id, unitPrice: 80, expectedVersion: time.updatedAt }],
    };
    const [a, b] = await Promise.all([
      call('post', `services/projects/${project.id}/invoice`, body),
      call('post', `services/projects/${project.id}/invoice`, body),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.invoiceId).toBe(b.body.invoiceId);
    const invoice = await db.customerInvoice.findFirstOrThrow({
      where: { tenantId, id: a.body.invoiceId },
      include: { lines: true },
    });
    expect(invoice.totalAmount.toString()).toBe('120');
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.lines[0].serviceTimeEntryId).toBe(time.id);
    await call('post', `services/projects/${project.id}/invoice`, {
      ...body,
      operationKey: randomUUID(),
    }).expect(409);
    await call('post', `services/time-entries/${time.id}/review`, {
      action: 'REOPEN',
      expectedUpdatedAt: time.updatedAt,
      reason: 'Correction',
    }).expect(409);
    await call('delete', `billing/customer-invoices/${invoice.id}`).expect(200);
    expect(
      (await call('get', `services/projects/${project.id}/billable`).expect(200)).body.sources,
    ).toHaveLength(1);
    await call('post', `services/projects/${project.id}/invoice`, body).expect(409);
  });
  it('filters attention by module/permissions and suppresses superseded renewals', async () => {
    const minimal = (await call('get', 'operational-attention', undefined, 'reader').expect(200))
      .body;
    expect(minimal.available).toEqual([]);
    const skill = await db.hrSkill.create({
      data: { tenantId, code: 'EXP', name: 'Expiring', kind: 'COMPETENCE' },
    });
    const base = {
      tenantId,
      employeeId: employee.id,
      skillId: skill.id,
      reference: 'INTERNAL',
      createdById: actors.manager.id,
      validFrom: new Date('2020-01-01'),
      fingerprint: 'test',
    };
    await db.hrQualification.create({
      data: { ...base, operationKey: randomUUID(), expiresOn: new Date('2021-01-01') },
    });
    expect(
      (await call('get', 'operational-attention?kind=qualifications').expect(200)).body.total,
    ).toBe(1);
    await db.hrQualification.create({
      data: {
        ...base,
        operationKey: randomUUID(),
        validFrom: new Date('2021-01-02'),
        expiresOn: null,
      },
    });
    expect(
      (await call('get', 'operational-attention?kind=qualifications').expect(200)).body.total,
    ).toBe(0);
    const module = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'services' } });
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await call('get', 'services/quotes').expect(403);
    expect(
      (await call('get', 'operational-attention').expect(200)).body.available.map(
        (s: any) => s.kind,
      ),
    ).not.toContain('time');
  });
});
