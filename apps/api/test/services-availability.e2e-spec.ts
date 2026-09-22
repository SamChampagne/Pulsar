import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { MODULE_CATALOG, PERMISSION_CATALOG } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('RH → Services minimal availability (HTTP + PostgreSQL)', () => {
  let app: INestApplication, db: PrismaService, http: any, tenantId: string, foreignId: string;
  let employee: any, leave: any;
  const actors: Record<string, { id: string; token: string }> = {},
    slug = `availability-${Date.now()}`;
  const call = (method: 'get' | 'post' | 'patch', path: string, body?: object, who = 'planner') =>
    request(http)
      [method](`/api/v1/${path}`)
      .set('Authorization', `Bearer ${actors[who].token}`)
      .send(body);
  const item = (date = '2030-01-02T12:00:00Z', who = 'worker') => ({
    userId: actors[who].id,
    scheduledAt: date,
  });
  const check = (items = [item()], timeZone = 'America/Toronto', who = 'planner') =>
    call('post', 'services/availability/check', { items, timeZone }, who);
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
    foreignId = (await db.tenant.create({ data: { slug: `${slug}-other`, name: 'Foreign' } })).id;
    for (const entry of MODULE_CATALOG.filter((m) =>
      ['hr', 'services', 'catalog'].includes(m.key),
    )) {
      const module = await db.moduleDefinition.upsert({
        where: { key: entry.key },
        create: entry,
        update: entry,
      });
      await db.tenantModule.create({ data: { tenantId, moduleId: module.id, enabled: true } });
    }
    for (const p of PERMISSION_CATALOG.filter((p) =>
      ['hr', 'services', 'catalog'].includes(p.module),
    ))
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    const roles = {
      planner: ['services.read', 'services.manage', 'hr.availability.read'],
      reader: ['services.read', 'hr.read'],
      hrOnly: ['hr.availability.read'],
      manager: ['hr.read', 'hr.manage', 'hr.approve', 'catalog.manage'],
      worker: ['hr.self'],
      inactive: [],
      unlinked: [],
      disabled: [],
    };
    for (const [key, keys] of Object.entries(roles)) {
      const permissions = await db.permission.findMany({ where: { key: { in: keys } } });
      const role = await db.role.create({
        data: {
          tenantId,
          key,
          name: key,
          permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
        },
      });
      const email = `${key.toLowerCase()}@${slug}.test`;
      const u = await db.user.create({
        data: {
          tenantId,
          email,
          firstName: 'Availability',
          lastName: key,
          status: 'ACTIVE',
          passwordHash: hashSync('Test1234!', 4),
          roles: { create: { roleId: role.id } },
        },
      });
      const login = await request(http)
        .post('/api/v1/auth/login')
        .send({ tenant: slug, email, password: 'Test1234!' })
        .expect(200);
      actors[key] = { id: u.id, token: login.body.accessToken };
    }
    for (const who of ['worker', 'inactive', 'disabled']) {
      const e = await call(
        'post',
        'hr/employees',
        {
          code: who.toUpperCase(),
          firstName: who,
          lastName: 'Test',
          jobTitle: '',
          teamId: null,
          userId: actors[who].id,
          active: who !== 'inactive',
        },
        'manager',
      ).expect(201);
      if (who === 'worker') employee = e.body;
    }
    await db.user.update({ where: { id: actors.disabled.id }, data: { status: 'DISABLED' } });
    leave = (
      await call(
        'post',
        'hr/self/leaves',
        {
          employeeId: employee.id,
          kind: 'OTHER',
          startDate: '2030-01-02',
          endDate: '2030-01-03',
          note: 'PRIVATE RH REASON',
          operationKey: randomUUID(),
        },
        'worker',
      ).expect(201)
    ).body;
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  async function move(status: string, who: string) {
    leave = (
      await call(
        'post',
        `hr/${who === 'worker' ? 'self/' : ''}leaves/${leave.id}/transition`,
        { status, expectedUpdatedAt: leave.updatedAt, note: 'PRIVATE DECISION' },
        who,
      ).expect(201)
    ).body;
  }
  it('needs both explicit rights; availability never grants full HR access', async () => {
    await check(undefined, undefined, 'reader').expect(403);
    await check(undefined, undefined, 'hrOnly').expect(403);
    for (const path of [
      'hr/employees',
      'hr/leaves',
      `hr/leaves/${leave.id}`,
      `hr/leaves/${leave.id}/history`,
    ])
      await call('get', path).expect(403);
  });
  it('checks only approved periods and returns a minimal projection', async () => {
    expect((await check().expect(200)).body.items[0].state).toBe('NO_APPROVED_ABSENCE');
    await move('SUBMITTED', 'worker');
    expect((await check().expect(200)).body.items[0].state).toBe('NO_APPROVED_ABSENCE');
    await move('APPROVED', 'manager');
    const body = (await check().expect(200)).body;
    expect(body.items).toEqual([{ date: '2030-01-02', state: 'ABSENT' }]);
    expect(Object.keys(body).sort()).toEqual(['checkedAt', 'items', 'timeZone']);
    expect(JSON.stringify(body)).not.toMatch(
      /PRIVATE|employeeId|tenantId|startDate|endDate|kind|note|number|createdBy|userId/,
    );
  });
  it('uses inclusive civil boundaries and the requested timezone even around UTC midnight', async () => {
    const inputs = [
      item('2030-01-02T04:59:00Z'),
      item('2030-01-02T05:00:00Z'),
      item('2030-01-04T04:59:00Z'),
      item('2030-01-04T05:00:00Z'),
    ];
    expect((await check(inputs).expect(200)).body.items.map((r: any) => r.state)).toEqual([
      'NO_APPROVED_ABSENCE',
      'ABSENT',
      'ABSENT',
      'NO_APPROVED_ABSENCE',
    ]);
    expect((await check([inputs[0]], 'UTC').expect(200)).body.items[0]).toEqual({
      date: '2030-01-02',
      state: 'ABSENT',
    });
  });
  it('distinguishes missing/inactive records and disabled accounts', async () => {
    expect(
      (
        await check([
          item(undefined, 'unlinked'),
          item(undefined, 'inactive'),
          item(undefined, 'disabled'),
        ]).expect(200)
      ).body.items.map((r: any) => r.state),
    ).toEqual(['EMPLOYEE_NOT_LINKED', 'EMPLOYEE_INACTIVE', 'USER_UNAVAILABLE']);
  });
  it('rejects foreign identities, unknown payloads, invalid dates, zones and unbounded batches', async () => {
    const foreign = await db.user.create({
      data: {
        tenantId: foreignId,
        email: 'foreign@example.test',
        firstName: 'Foreign',
        lastName: 'User',
        passwordHash: 'not-loginable',
      },
    });
    await check([{ ...item(), userId: foreign.id }]).expect(404);
    await check([{ ...item(), userId: 'missing' }]).expect(404);
    await call('post', 'services/availability/check', {
      timeZone: 'UTC',
      items: [item()],
      tenantId: foreignId,
    }).expect(400);
    for (const date of ['2030-02-30T12:00:00Z', '2030-01-02T12:00:00', '2200-01-01T12:00:00Z'])
      await check([item(date)]).expect(400);
    for (const zone of ['', 'Mars/Test']) await check(undefined, zone).expect(400);
    await check([]).expect(400);
    await check(Array.from({ length: 51 }, () => item())).expect(400);
    await check(Array.from({ length: 50 }, () => item())).expect(200);
  });
  it('keeps job writes non-blocking and never persists RH data on the job', async () => {
    const partner = (
      await call(
        'post',
        'catalog/partners',
        { code: slug, name: slug, isCustomer: true, isSupplier: false },
        'manager',
      ).expect(201)
    ).body;
    let project = (
      await call('post', 'services/projects', { title: slug, partnerId: partner.id }).expect(201)
    ).body;
    project = (
      await call('post', `services/projects/${project.id}/transition`, {
        status: 'ACTIVE',
        expectedUpdatedAt: project.updatedAt,
      }).expect(201)
    ).body;
    const job = (
      await call('post', 'services/jobs', {
        title: slug,
        projectId: project.id,
        assigneeUserId: actors.worker.id,
        scheduledAt: item().scheduledAt,
      }).expect(201)
    ).body;
    await call('patch', `services/jobs/${job.id}`, {
      scheduledAt: '2030-01-03T12:00:00Z',
      expectedUpdatedAt: job.updatedAt,
    }).expect(200);
    expect(JSON.stringify(await db.serviceJob.findUnique({ where: { id: job.id } }))).not.toMatch(
      /PRIVATE|absence|leaveId|employeeId/,
    );
    expect(
      (await db.hrLeaveRequest.findFirstOrThrow({ where: { tenantId, id: leave.id } })).status,
    ).toBe('APPROVED');
  });
  it('refreshes after cancellation without changing any assignment', async () => {
    await move('CANCELLED', 'manager');
    expect((await check().expect(200)).body.items[0].state).toBe('NO_APPROVED_ABSENCE');
    expect(
      await db.serviceJob.count({ where: { tenantId, assigneeUserId: actors.worker.id } }),
    ).toBe(1);
  });
  it('gates both module activations and restores access after re-enabling', async () => {
    for (const key of ['hr', 'services']) {
      await db.tenantModule.updateMany({
        where: { tenantId, module: { key } },
        data: { enabled: false },
      });
      app.get(TenantModulesCacheService).invalidate(tenantId);
      await check().expect(403);
      await db.tenantModule.updateMany({
        where: { tenantId, module: { key } },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(tenantId);
      await check().expect(200);
    }
  });
});
