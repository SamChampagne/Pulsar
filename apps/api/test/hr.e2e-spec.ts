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

describe('RH guarded workflows (HTTP + PostgreSQL)', () => {
  let app: INestApplication, db: PrismaService, http: any, tenantId: string, foreign: string;
  const actors: Record<string, { token: string; id: string }> = {},
    slug = `hr-${Date.now()}`;
  let team: any, employee: any, managerEmployee: any, foreignEmployee: any;
  const call = (method: 'get' | 'post' | 'patch', path: string, body?: object, who = 'manager') =>
    request(http)
      [method](`/api/v1/hr/${path}`)
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
    foreign = (await db.tenant.create({ data: { slug: `${slug}-other`, name: 'Other' } })).id;
    const entry = MODULE_CATALOG.find((m) => m.key === 'hr')!;
    const module = await db.moduleDefinition.upsert({
      where: { key: 'hr' },
      create: entry,
      update: entry,
    });
    await db.tenantModule.create({ data: { tenantId, moduleId: module.id, enabled: true } });
    for (const p of PERMISSION_CATALOG.filter((p) => p.module === 'hr'))
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    const roles = {
      manager: ['hr.read', 'hr.manage', 'hr.approve', 'hr.self'],
      approver: ['hr.read', 'hr.approve'],
      self: ['hr.self'],
      reader: ['hr.read'],
      none: [],
    };
    for (const [key, keys] of Object.entries(roles)) {
      const ps = await db.permission.findMany({ where: { key: { in: keys } } });
      const role = await db.role.create({
        data: {
          tenantId,
          key,
          name: key,
          permissions: { create: ps.map((p) => ({ permissionId: p.id })) },
        },
      });
      const email = `${key}@${slug}.test`,
        user = await db.user.create({
          data: {
            tenantId,
            email,
            firstName: 'HR',
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
      actors[key] = { token: login.body.accessToken, id: user.id };
    }
    team = (
      await call('post', 'teams', { code: 'OPS', name: 'Opérations', active: true }).expect(201)
    ).body;
    employee = (
      await call('post', 'employees', {
        code: 'EMP-1',
        firstName: 'Camille',
        lastName: 'Test',
        jobTitle: 'Technicien',
        teamId: team.id,
        userId: actors.self.id,
        active: true,
      }).expect(201)
    ).body;
    managerEmployee = (
      await call('post', 'employees', {
        code: 'MGR',
        firstName: 'Manager',
        lastName: 'Test',
        jobTitle: '',
        teamId: null,
        userId: actors.manager.id,
        active: true,
      }).expect(201)
    ).body;
    foreignEmployee = await db.hrEmployee.create({
      data: { tenantId: foreign, code: 'OTHER', firstName: 'Other', lastName: 'Tenant' },
    });
  }, 60000);
  afterAll(async () => {
    try {
      if (db) {
        const where = { tenantId: { in: [tenantId, foreign].filter(Boolean) } };
        await db.hrLeaveEvent.deleteMany({ where });
        await db.hrLeaveRequest.deleteMany({ where });
        await db.hrEmployee.deleteMany({ where });
        await db.hrTeam.deleteMany({ where });
      }
    } finally {
      await app?.close();
    }
  });
  const create = async (start = '2030-01-01', end = start, who = 'self', emp = employee) =>
    (
      await call(
        'post',
        who === 'self' ? 'self/leaves' : 'leaves',
        {
          employeeId: emp.id,
          kind: 'TIME_OFF',
          startDate: start,
          endDate: end,
          note: 'Absence planifiée',
          operationKey: randomUUID(),
        },
        who,
      ).expect(201)
    ).body;
  const move = async (r: any, status: string, who = 'self') =>
    (
      await call(
        'post',
        `${who === 'self' ? 'self/' : ''}leaves/${r.id}/transition`,
        { status, expectedUpdatedAt: r.updatedAt, note: 'Décision humaine documentée' },
        who,
      ).expect(201)
    ).body;
  it('separates accounts and employee records and limits the self surface', async () => {
    expect((await call('get', 'self', undefined, 'self').expect(200)).body.id).toBe(employee.id);
    for (const path of ['employees', 'teams', 'people', 'leaves'])
      await call('get', path, undefined, 'self').expect(403);
    await call('get', 'self', undefined, 'reader').expect(403);
    await call('get', 'employees', undefined, 'none').expect(403);
    expect(JSON.stringify((await call('get', 'employees').expect(200)).body)).not.toMatch(
      /passwordHash|tenantId|secretHash/,
    );
    await call('patch', `employees/${employee.id}`, {
      firstName: 'X',
      lastName: 'Y',
      jobTitle: '',
      teamId: team.id,
      active: true,
      expectedUpdatedAt: employee.updatedAt,
      userId: actors.manager.id,
    }).expect(400);
  });
  it('validates unique codes, active owned references and versions', async () => {
    await call('post', 'teams', { code: 'OPS', name: 'Again', active: true }).expect(409);
    await call('post', 'employees', {
      code: 'DUP',
      firstName: 'A',
      lastName: 'B',
      jobTitle: '',
      teamId: null,
      userId: actors.self.id,
      active: true,
    }).expect(409);
    const otherTeam = await db.hrTeam.create({
      data: { tenantId: foreign, code: 'FOREIGN', name: 'Foreign' },
    });
    await call('post', 'employees', {
      code: 'BAD',
      firstName: 'A',
      lastName: 'B',
      jobTitle: '',
      teamId: otherTeam.id,
      userId: null,
      active: true,
    }).expect(400);
    const body = {
      firstName: 'Camille',
      lastName: 'Test',
      jobTitle: 'Technicien senior',
      teamId: team.id,
      active: true,
      expectedUpdatedAt: employee.updatedAt,
    };
    employee = (await call('patch', `employees/${employee.id}`, body).expect(200)).body;
    await call('patch', `employees/${employee.id}`, body).expect(409);
    await call('patch', `teams/${team.id}`, {
      name: team.name,
      active: false,
      expectedUpdatedAt: team.updatedAt,
    }).expect(409);
    await call(
      'post',
      'employees',
      {
        code: 'READ',
        firstName: 'A',
        lastName: 'B',
        jobTitle: '',
        teamId: null,
        userId: null,
        active: true,
      },
      'reader',
    ).expect(403);
  });
  it('rejects invalid periods, tenant spoofing and personal impersonation', async () => {
    const body = {
      employeeId: employee.id,
      kind: 'TIME_OFF',
      startDate: '2030-02-30',
      endDate: '2030-03-02',
      note: '',
      operationKey: randomUUID(),
    };
    await call('post', 'self/leaves', body, 'self').expect(400);
    await call('post', 'self/leaves', { ...body, startDate: '2030-03-03' }, 'self').expect(400);
    await call(
      'post',
      'self/leaves',
      { ...body, startDate: '2030-03-01', employeeId: managerEmployee.id },
      'self',
    ).expect(404);
    await call('post', 'leaves', {
      ...body,
      startDate: '2030-03-01',
      employeeId: foreignEmployee.id,
    }).expect(400);
    await call('post', 'leaves', { ...body, startDate: '2030-03-01', tenantId: foreign }).expect(
      400,
    );
  });
  it('replays a creation with exactly the same actor and content even after submission', async () => {
    const body = {
      employeeId: employee.id,
      kind: 'TIME_OFF',
      startDate: '2030-04-01',
      endDate: '2030-04-02',
      note: 'Replay',
      operationKey: randomUUID(),
    };
    const first = (await call('post', 'self/leaves', body, 'self').expect(201)).body;
    await move(first, 'SUBMITTED');
    expect((await call('post', 'self/leaves', body, 'self').expect(201)).body.id).toBe(first.id);
    await call('post', 'self/leaves', { ...body, note: 'Other' }, 'self').expect(409);
    await call('post', 'leaves', body).expect(409);
    expect(await db.hrLeaveEvent.count({ where: { tenantId, leaveId: first.id } })).toBe(2);
    expect(first).not.toHaveProperty('fingerprint');
    expect(first).not.toHaveProperty('operationKey');
  });
  it('requires an independent human decision and retains history without leaking notes into generic audit', async () => {
    let r = await create('2030-05-01', '2030-05-02', 'manager', managerEmployee);
    await call('post', `leaves/${r.id}/transition`, {
      status: 'APPROVED',
      expectedUpdatedAt: r.updatedAt,
      note: 'Direct approval',
    }).expect(409);
    r = await move(r, 'SUBMITTED', 'manager');
    await call('post', `leaves/${r.id}/transition`, {
      status: 'APPROVED',
      expectedUpdatedAt: r.updatedAt,
      note: 'Self approval',
    }).expect(403);
    r = await move(r, 'APPROVED', 'approver');
    await call('patch', `leaves/${r.id}`, {
      expectedUpdatedAt: r.updatedAt,
      kind: r.kind,
      startDate: '2030-05-01',
      endDate: '2030-05-03',
      note: 'Attempt',
    }).expect(409);
    r = await move(r, 'CANCELLED', 'approver');
    await call('post', `leaves/${r.id}/transition`, {
      status: 'DRAFT',
      expectedUpdatedAt: r.updatedAt,
      note: 'Reopen',
    }).expect(409);
    const history = (await call('get', `leaves/${r.id}/history`).expect(200)).body;
    expect(history.total).toBe(4);
    expect(history.items[0].actor.lastName).toBe('approver');
    const logs = await db.auditLog.findMany({
      where: { tenantId, entityType: 'hr-leave', entityId: r.id },
    });
    expect(JSON.stringify(logs)).not.toContain('Absence planifiée');
  });
  it('cannot approve a request one created for another employee', async () => {
    let r = await create('2030-06-01', '2030-06-01', 'manager');
    r = await move(r, 'SUBMITTED', 'manager');
    await call('post', `leaves/${r.id}/transition`, {
      status: 'APPROVED',
      expectedUpdatedAt: r.updatedAt,
      note: 'Own creation',
    }).expect(403);
    r = await move(r, 'REJECTED', 'approver');
    r = await move(r, 'DRAFT', 'manager');
    expect(r.status).toBe('DRAFT');
  });
  it('protects reads, history and writes of another employee on the personal surface', async () => {
    const r = await create('2030-07-01', '2030-07-01', 'manager', managerEmployee);
    await call('get', `self/leaves/${r.id}`, undefined, 'self').expect(404);
    await call('get', `self/leaves/${r.id}/history`, undefined, 'self').expect(404);
    await call(
      'post',
      `self/leaves/${r.id}/transition`,
      { expectedUpdatedAt: r.updatedAt, status: 'CANCELLED', note: 'Attack' },
      'self',
    ).expect(404);
    expect(
      (
        await call('get', `self/leaves?employeeId=${managerEmployee.id}`, undefined, 'self').expect(
          200,
        )
      ).body.total,
    ).toBe(0);
    expect(
      (await call('get', `leaves?employeeId=${foreignEmployee.id}`).expect(200)).body.total,
    ).toBe(0);
  });
  it('serializes overlapping submissions and rejects stale decisions', async () => {
    const [a, b] = await Promise.all([
      create('2030-08-01', '2030-08-05'),
      create('2030-08-05', '2030-08-06'),
    ]);
    const response = await Promise.all(
      [a, b].map((r) =>
        call(
          'post',
          `self/leaves/${r.id}/transition`,
          { expectedUpdatedAt: r.updatedAt, status: 'SUBMITTED', note: 'Concurrent submission' },
          'self',
        ),
      ),
    );
    expect(response.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = response.find((r) => r.status === 201)!.body;
    const decisions = await Promise.all(
      [1, 2].map(() =>
        call(
          'post',
          `leaves/${winner.id}/transition`,
          { expectedUpdatedAt: winner.updatedAt, status: 'APPROVED', note: 'Concurrent approval' },
          'approver',
        ),
      ),
    );
    expect(decisions.map((r) => r.status).sort()).toEqual([201, 409]);
    await call('patch', `employees/${employee.id}`, {
      firstName: employee.firstName,
      lastName: employee.lastName,
      jobTitle: employee.jobTitle,
      teamId: team.id,
      active: false,
      expectedUpdatedAt: employee.updatedAt,
    }).expect(409);
  });
  it('denies decisions to readers and self users even when the status is valid', async () => {
    let r = await create('2030-09-01');
    r = await move(r, 'SUBMITTED');
    await call(
      'post',
      `leaves/${r.id}/transition`,
      { expectedUpdatedAt: r.updatedAt, status: 'APPROVED', note: 'No permission' },
      'reader',
    ).expect(403);
    await call(
      'post',
      `self/leaves/${r.id}/transition`,
      { expectedUpdatedAt: r.updatedAt, status: 'APPROVED', note: 'No permission' },
      'self',
    ).expect(403);
    r = await move(r, 'APPROVED', 'approver');
    await call(
      'post',
      `self/leaves/${r.id}/transition`,
      {
        expectedUpdatedAt: r.updatedAt,
        status: 'CANCELLED',
        note: 'Cannot silently cancel approval',
      },
      'self',
    ).expect(403);
  });
  it('keeps inactive employees historical without disabling their login', async () => {
    const e = (
      await call('post', 'employees', {
        code: 'NO-LEAVE',
        firstName: 'No',
        lastName: 'Leave',
        jobTitle: '',
        teamId: null,
        userId: actors.none.id,
        active: true,
      }).expect(201)
    ).body;
    await call('patch', `employees/${e.id}`, {
      firstName: e.firstName,
      lastName: e.lastName,
      jobTitle: '',
      teamId: null,
      active: false,
      expectedUpdatedAt: e.updatedAt,
    }).expect(200);
    expect(
      (await db.user.findFirstOrThrow({ where: { tenantId, id: actors.none.id } })).status,
    ).toBe('ACTIVE');
    await call('post', 'leaves', {
      employeeId: e.id,
      kind: 'OTHER',
      startDate: '2031-01-01',
      endDate: '2031-01-01',
      note: '',
      operationKey: randomUUID(),
    }).expect(409);
  });
  it('gates all HR surfaces when disabled', async () => {
    await db.tenantModule.updateMany({
      where: { tenantId, module: { key: 'hr' } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await call('get', 'employees').expect(403);
    await call('get', 'self', undefined, 'self').expect(403);
  });
});
