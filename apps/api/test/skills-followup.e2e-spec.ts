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

describe('Skills, manufacturing coverage and operational follow-up', () => {
  let app: INestApplication,
    db: PrismaService,
    http: any,
    tenantId: string,
    foreign: string,
    employee: any,
    selfEmployee: any,
    skill: any,
    wc: any,
    partner: any;
  const slug = `skills-${Date.now()}`,
    actors: Record<string, { id: string; token: string }> = {};
  const call = (
    method: 'get' | 'post' | 'patch' | 'put',
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
    foreign = (await db.tenant.create({ data: { slug: slug + '-other', name: 'Other' } })).id;
    for (const key of ['hr', 'manufacturing', 'support', 'purchasing']) {
      const entry = MODULE_CATALOG.find((m) => m.key === key)!;
      const m = await db.moduleDefinition.upsert({ where: { key }, create: entry, update: entry });
      await db.tenantModule.create({ data: { tenantId, moduleId: m.id, enabled: true } });
    }
    for (const p of PERMISSION_CATALOG.filter((p) =>
      ['hr', 'manufacturing', 'support', 'purchasing'].includes(p.module),
    ))
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    const roles = {
      manager: [
        'hr.read',
        'hr.manage',
        'hr.qualifications.manage',
        'hr.qualifications.read',
        'manufacturing.read',
        'manufacturing.manage',
        'support.read',
        'support.manage',
        'purchasing.read',
      ],
      planner: ['manufacturing.read', 'hr.qualifications.read'],
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
      const email = `${key}@${slug}.test`;
      const u = await db.user.create({
        data: {
          tenantId,
          email,
          firstName: key,
          lastName: 'Test',
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
    employee = await db.hrEmployee.create({
      data: { tenantId, code: 'EMP', firstName: 'Alex', lastName: 'Operator' },
    });
    selfEmployee = await db.hrEmployee.create({
      data: {
        tenantId,
        code: 'MGR',
        firstName: 'Manager',
        lastName: 'Self',
        userId: actors.manager.id,
      },
    });
    skill = (
      await call('post', 'hr/skills', {
        code: 'FORKLIFT',
        name: 'Conduite chariot',
        kind: 'AUTHORIZATION',
      }).expect(201)
    ).body;
    const calendar = await db.workingCalendar.create({
      data: { tenantId, code: 'CAL', name: 'Test' },
    });
    wc = await db.workCenter.create({
      data: { tenantId, code: 'WC', name: 'Poste test', calendarId: calendar.id },
    });
    partner = await db.businessPartner.create({
      data: { tenantId, code: 'CLIENT', name: 'Client', isCustomer: true, isSupplier: true },
    });
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  const body = (extra = {}) => ({
    employeeId: employee.id,
    skillId: skill.id,
    validFrom: '2030-01-01',
    expiresOn: '2030-12-31',
    reference: 'CERT-PRIVATE-TEST',
    operationKey: randomUUID(),
    ...extra,
  });
  it('requires permissions and rejects self-attestation and foreign keys', async () => {
    await call('post', 'hr/qualifications', body(), 'reader').expect(403);
    await call('post', 'hr/qualifications', body({ employeeId: selfEmployee.id })).expect(403);
    const f = await db.hrEmployee.create({
      data: { tenantId: foreign, code: 'OTHER', firstName: 'Other', lastName: 'Tenant' },
    });
    await call('post', 'hr/qualifications', body({ employeeId: f.id })).expect(400);
    await call('get', 'hr/skills', undefined, 'none').expect(403);
  });
  it('strictly validates dates and keys; replay is actor and content bound', async () => {
    await call('post', 'hr/qualifications', body({ validFrom: '2030-02-30' })).expect(400);
    await call('post', 'hr/qualifications', body({ expiresOn: '2029-01-01' })).expect(400);
    const b = body(),
      r = (await call('post', 'hr/qualifications', b).expect(201)).body;
    const replay = (await call('post', 'hr/qualifications', b).expect(201)).body;
    expect(replay.id).toBe(r.id);
    expect(replay.replayed).toBe(true);
    await call('post', 'hr/qualifications', { ...b, reference: 'CHANGED' }).expect(409);
    expect(
      await db.hrQualification.count({ where: { tenantId, operationKey: b.operationKey } }),
    ).toBe(1);
  });
  it('keeps no-requirements distinct from a qualified operator', async () => {
    const r = (
      await call(
        'post',
        'manufacturing/qualifications/check',
        { employeeId: employee.id, workCenterId: wc.id, date: '2030-01-01' },
        'planner',
      ).expect(201)
    ).body;
    expect(r.result).toBe('NO_REQUIREMENTS');
  });
  it('sets requirements with versions, then checks inclusive coverage without HR private data', async () => {
    const first = (
      await call('get', `manufacturing/qualifications/requirements/${wc.id}`).expect(200)
    ).body;
    wc = (
      await call('put', `manufacturing/qualifications/requirements/${wc.id}`, {
        expectedUpdatedAt: first.updatedAt,
        skillIds: [skill.id],
      }).expect(200)
    ).body;
    await call('put', `manufacturing/qualifications/requirements/${wc.id}`, {
      expectedUpdatedAt: first.updatedAt,
      skillIds: [],
    }).expect(409);
    await call(
      'put',
      `manufacturing/qualifications/requirements/${wc.id}`,
      { expectedUpdatedAt: wc.updatedAt, skillIds: [] },
      'planner',
    ).expect(403);
    for (const [date, result] of [
      ['2029-12-31', 'MISSING'],
      ['2030-01-01', 'MET'],
      ['2030-12-31', 'MET'],
      ['2031-01-01', 'MISSING'],
    ]) {
      const r = (
        await call(
          'post',
          'manufacturing/qualifications/check',
          { employeeId: employee.id, workCenterId: wc.id, date },
          'planner',
        ).expect(201)
      ).body;
      expect(r.result).toBe(result);
      expect(JSON.stringify(r)).not.toMatch(/CERT-PRIVATE|reference|createdBy|expiresOn|validFrom/);
    }
    await call('get', 'hr/qualifications', undefined, 'planner').expect(403);
  });
  it('revocation is final and concurrent/stale writes cannot revive qualification', async () => {
    const q = await db.hrQualification.findFirstOrThrow({
      where: { tenantId, employeeId: employee.id },
    });
    const d = { expectedUpdatedAt: q.updatedAt.toISOString(), reason: 'Permis retiré' };
    const responses = await Promise.all([
      call('post', `hr/qualifications/${q.id}/revoke`, d),
      call('post', `hr/qualifications/${q.id}/revoke`, d),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const r = (
      await call(
        'post',
        'manufacturing/qualifications/check',
        { employeeId: employee.id, workCenterId: wc.id, date: '2030-06-01' },
        'planner',
      ).expect(201)
    ).body;
    expect(r.result).toBe('MISSING');
    const audit = await db.auditLog.findMany({
      where: { tenantId, entityType: 'hr-qualification' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit)).not.toMatch(/CERT-PRIVATE|Permis retiré/);
  });
  it('inactive skills and employees cannot attest or count as covered', async () => {
    await db.hrSkill.update({ where: { id: skill.id }, data: { active: false } });
    await call('post', 'hr/qualifications', body()).expect(409);
    await db.hrSkill.update({ where: { id: skill.id }, data: { active: true } });
    await db.hrEmployee.update({ where: { id: employee.id }, data: { active: false } });
    await call('post', 'hr/qualifications', body()).expect(409);
    const r = (
      await call(
        'post',
        'manufacturing/qualifications/check',
        { employeeId: employee.id, workCenterId: wc.id, date: '2030-01-01' },
        'planner',
      ).expect(201)
    ).body;
    expect(r.result).toBe('EMPLOYEE_INACTIVE');
    await db.hrEmployee.update({ where: { id: employee.id }, data: { active: true } });
  });
  it('module deactivation also protects the cross-module service', async () => {
    const m = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'hr' } });
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId: m.id } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await call(
      'post',
      'manufacturing/qualifications/check',
      { employeeId: employee.id, workCenterId: wc.id, date: '2030-01-01' },
      'planner',
    ).expect(403);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId: m.id } },
      data: { enabled: true },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
  });
  it('support assigns a real internal user and filters open queues before pagination', async () => {
    let r = (
      await call('post', 'support/cases', {
        partnerId: partner.id,
        title: 'Suivi test',
        description: 'Diagnostic',
        priority: 'HIGH',
        operationKey: randomUUID(),
      }).expect(201)
    ).body;
    const fields = { title: r.title, description: r.description, priority: r.priority };
    await call('patch', `support/cases/${r.id}`, {
      ...fields,
      assigneeUserId: actors.manager.id,
      dueDate: '2030-02-30',
      expectedUpdatedAt: r.updatedAt,
    }).expect(400);
    r = (
      await call('patch', `support/cases/${r.id}`, {
        ...fields,
        assigneeUserId: actors.manager.id,
        dueDate: '2000-01-01',
        expectedUpdatedAt: r.updatedAt,
      }).expect(200)
    ).body;
    expect(r.assignee.id).toBe(actors.manager.id);
    for (const filter of ['mine', 'overdue'])
      expect(
        (await call('get', `support/cases?followup=${filter}&pageSize=1`).expect(200)).body.total,
      ).toBe(1);
    expect((await call('get', 'support/cases?followup=unassigned').expect(200)).body.total).toBe(0);
    const other = await db.user.create({
      data: {
        tenantId: foreign,
        email: `foreign@${slug}.test`,
        firstName: 'Other',
        lastName: 'Tenant',
        passwordHash: 'unused',
      },
    });
    await call('patch', `support/cases/${r.id}`, {
      ...fields,
      assigneeUserId: other.id,
      expectedUpdatedAt: r.updatedAt,
    }).expect(400);
    for (const status of ['IN_PROGRESS', 'RESOLVED'])
      r = (
        await call('post', `support/cases/${r.id}/transition`, {
          status,
          note: 'Traitement',
          expectedUpdatedAt: r.updatedAt,
        }).expect(201)
      ).body;
    expect((await call('get', 'support/cases?followup=overdue').expect(200)).body.total).toBe(0);
  });
  it('supplier arrival queues exclude drafts and closed orders', async () => {
    for (const status of ['DRAFT', 'CONFIRMED', 'CLOSED'] as const)
      await db.supplierOrder.create({
        data: {
          tenantId,
          number: 'PO-' + status,
          supplierId: partner.id,
          currency: 'CAD',
          status,
          expectedDate: new Date('2000-01-01'),
        },
      });
    const late = (await call('get', 'purchasing/orders?orderFollowup=late&pageSize=1').expect(200))
      .body;
    expect(late.total).toBe(1);
    expect(late.items[0].status).toBe('CONFIRMED');
    const draft = (await call('get', 'purchasing/orders?orderStatus=DRAFT').expect(200)).body;
    expect(draft.total).toBe(1);
    expect(draft.items[0].status).toBe('DRAFT');
  });
});
