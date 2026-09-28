import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { MODULE_CATALOG, PERMISSION_CATALOG, SmsStatus } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { EmailService } from '../src/core/email/email.service';
import { TelnyxTransport } from '../src/core/sms/telnyx.transport';
import { AuditLogsService } from '../src/core/audit-logs/audit-logs.service';

describe('Dossier communications — tenant isolated, transports mocked', () => {
  let app: INestApplication,
    db: PrismaService,
    tenantId: string,
    foreignId: string,
    jobId: string,
    partnerId: string;
  const slug = `dossier-comms-${Date.now()}`;
  const actors: Record<string, { token: string; id: string }> = {};
  const emailSend = jest.fn(async (..._args: unknown[]) => true);
  const smsSend = jest.fn(async () => ({
    status: SmsStatus.ACCEPTED,
    providerMessageId: randomUUID(),
  }));
  const call = (method: 'get' | 'put' | 'post', path: string, body?: object, role = 'manager') =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .auth(actors[role].token, { type: 'bearer' })
      .send(body);
  const q = (channel = 'SMS', extra: Record<string, string> = {}) =>
    new URLSearchParams({ access: 'services/jobs', entityId: jobId, channel, ...extra }).toString();
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ channel: 'smtp', send: emailSend })
      .overrideProvider(TelnyxTransport)
      .useValue({ send: smsSend })
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
    tenantId = (await db.tenant.create({ data: { slug, name: 'Recette communications dossiers' } }))
      .id;
    foreignId = (await db.tenant.create({ data: { slug: `${slug}-other`, name: 'Other' } })).id;
    for (const p of PERMISSION_CATALOG)
      await db.permission.upsert({ where: { key: p.key }, create: p, update: p });
    for (const entry of MODULE_CATALOG.filter((m) => m.key === 'services')) {
      const module = await db.moduleDefinition.upsert({
        where: { key: entry.key },
        create: entry,
        update: entry,
      });
      for (const tid of [tenantId, foreignId])
        await db.tenantModule.create({
          data: { tenantId: tid, moduleId: module.id, enabled: true },
        });
    }
    for (const [roleName, keys] of Object.entries({
      manager: PERMISSION_CATALOG.map((p) => p.key),
      other: PERMISSION_CATALOG.map((p) => p.key),
      channelOnly: ['core.communications.read', 'core.sms.read', 'core.sms.send'],
      sourceOnly: ['core.communications.read', 'services.read'],
      reader: ['core.communications.read', 'core.sms.read', 'services.read'],
    })) {
      const tid = roleName === 'other' ? foreignId : tenantId;
      const ps = await db.permission.findMany({ where: { key: { in: keys } } });
      const role = await db.role.create({
        data: {
          tenantId: tid,
          key: roleName,
          name: roleName,
          permissions: { create: ps.map((p) => ({ permissionId: p.id })) },
        },
      });
      const user = await db.user.create({
        data: {
          tenantId: tid,
          email: `${roleName}@${slug}.test`.toLowerCase(),
          firstName: roleName,
          lastName: 'Recette',
          passwordHash: hashSync('Test1234!', 4),
          roles: { create: { roleId: role.id } },
        },
      });
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          tenant: roleName === 'other' ? `${slug}-other` : slug,
          email: user.email,
          password: 'Test1234!',
        })
        .expect(200);
      actors[roleName] = { id: user.id, token: login.body.accessToken };
    }
    partnerId = (
      await db.businessPartner.create({
        data: {
          tenantId,
          code: 'CLIENT',
          name: 'Atelier des Rives',
          email: 'atelier@example.test',
          phone: '+15145550222',
        },
      })
    ).id;
    const project = await db.serviceProject.create({
      data: { tenantId, number: 'PR-COMM', title: 'Installation', partnerId },
    });
    jobId = (
      await db.serviceJob.create({
        data: {
          tenantId,
          number: 'INT-COMM',
          title: 'Rendez-vous installation',
          projectId: project.id,
        },
      })
    ).id;
    await call('put', 'sms/config', {
      expectedUpdatedAt: null,
      fromNumber: '+15145550999',
      messagingProfileId: randomUUID(),
      live: false,
      active: true,
      dailyLimit: 100,
    }).expect(200);
    console.log(`DOSSIER_COMMUNICATIONS_TENANT=${slug}`);
    console.log(`DOSSIER_COMMUNICATIONS_JOB=${jobId}`);
  }, 120000);
  afterAll(async () => {
    if (db && tenantId)
      await db.tenantEmailConfig.updateMany({
        where: { tenantId },
        data: { active: false, inboundActive: false },
      });
    await app?.close();
  });
  beforeEach(() => {
    emailSend.mockClear();
    smsSend.mockClear();
  });
  async function authorize(channel = 'SMS', recipient = '+15145550222', allowed = true) {
    const pref = (
      await call('get', `communications/preference?${q(channel, { recipient })}`).expect(200)
    ).body;
    return (
      await call('put', 'communications/preference', {
        access: 'services/jobs',
        entityId: jobId,
        channel,
        recipient,
        expectedVersion: pref.version,
        allowed,
        evidence: 'Accord du contact recueilli pendant la recette',
        observedAt: '2026-09-01T12:00:00.000Z',
        confirmed: true,
      }).expect(200)
    ).body;
  }
  async function intent(channel = 'SMS', recipient = '+15145550222') {
    const context = (await call('get', `communications/context?${q(channel)}`).expect(200)).body;
    const preference = (
      await call('get', `communications/preference?${q(channel, { recipient })}`).expect(200)
    ).body;
    return {
      access: 'services/jobs',
      entityId: jobId,
      channel,
      recipient,
      operationKey: randomUUID(),
      reviewToken: context.reviewToken,
      configVersion: context.connection.version,
      preferenceVersion: preference.version || 1,
      text: 'Votre intervention est confirmée.',
      ...(channel === 'EMAIL' ? { subject: 'Confirmation intervention' } : {}),
      confirmed: true,
    };
  }
  it('resolves explicit service contacts without Clients, Catalog or Transportation activated', async () => {
    const c = (await call('get', `communications/context?${q()}`).expect(200)).body;
    expect(c.recipients).toEqual([
      { label: 'Atelier des Rives', channel: 'SMS', value: '+15145550222' },
    ]);
    expect(c.history.total).toBe(0);
    expect(JSON.stringify(c)).not.toContain('atelier@example.test');
    const party = (
      await call(
        'get',
        `communications/context?${q('SMS', { access: 'services/data/customers', entityId: partnerId })}`,
      ).expect(200)
    ).body;
    expect(party.kind).toBe('partner');
  });
  it('requires BOTH source and channel rights and blocks cross-tenant and unknown contexts', async () => {
    for (const role of ['channelOnly', 'sourceOnly'])
      await call('get', `communications/context?${q()}`, undefined, role).expect(403);
    await call('get', `communications/context?${q()}`, undefined, 'other').expect(404);
    await call(
      'get',
      `communications/context?${q('SMS', { access: 'billing/customer-invoices' })}`,
    ).expect(403);
    await call('post', 'communications/messages', await intent(), 'reader').expect(403);
    await call('put', 'communications/preference', {}, 'reader').expect(403);
  });
  it('does not send without proof, rejects invalid recipients/headers/attachments, then audits authorization', async () => {
    const body = await intent();
    await call('post', 'communications/messages', body).expect(400);
    for (const bad of [
      { recipient: 'abc' },
      { recipient: '+15145550222,+15145550223' },
      { confirmed: false },
      { attachments: [] },
      { tenantId: foreignId },
      { text: '{{secret}}' },
    ])
      await call('post', 'communications/messages', { ...body, ...bad }).expect(400);
    const pref = await authorize();
    expect(pref.allowed).toBe(true);
    const audit = await db.auditLog.findFirst({
      where: { tenantId, entityType: 'communication-preference' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.after).toMatchObject({
      recipient: '+15145550222',
      evidence: 'Accord du contact recueilli pendant la recette',
    });
    expect(smsSend).not.toHaveBeenCalled();
  });
  it('simulates once under concurrent retries, scopes history and hides dossier SMS from global journal', async () => {
    const body = await intent();
    const before = (await call('get', 'sms/messages').expect(200)).body.total;
    const responses = await Promise.all([
      call('post', 'communications/messages', body),
      call('post', 'communications/messages', body),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(responses[0].body.smsMessage.status).toBe('SIMULATED');
    expect(responses[0].body.fingerprint).toBeUndefined();
    expect((await call('get', 'sms/messages').expect(200)).body.total).toBe(before);
    expect(
      (await call('get', `communications/context?${q()}`).expect(200)).body.history.total,
    ).toBe(1);
    expect(
      (
        await call(
          'get',
          `communications/context?${q('SMS', { access: 'services/data/customers', entityId: partnerId })}`,
        ).expect(200)
      ).body.history.total,
    ).toBe(0);
    await call('post', 'communications/messages', { ...body, text: 'Changed' }).expect(409);
    await call('post', 'sms/messages', {
      operationKey: body.operationKey,
      expectedUpdatedAt: body.configVersion,
      toNumber: body.recipient,
      text: body.text,
      confirmed: true,
    }).expect(409);
    expect(smsSend).not.toHaveBeenCalled();
  });
  it('rechecks source, connection and preference revisions before preparation', async () => {
    const source = await intent();
    await db.serviceJob.update({
      where: { id: jobId, tenantId },
      data: { title: 'Installation vérifiée' },
    });
    await call('post', 'communications/messages', source).expect(409);
    const pref = await intent();
    await authorize();
    await call('post', 'communications/messages', pref).expect(409);
    const connection = await intent();
    await db.tenantSmsConfig.update({ where: { tenantId }, data: { dailyLimit: 101 } });
    await call('post', 'communications/messages', connection).expect(409);
  });
  it('blocks new and standalone SMS on refusal but returns the historical result on exact replay', async () => {
    const body = await intent();
    const sent = await call('post', 'communications/messages', body).expect(200);
    await authorize('SMS', '+15145550222', false);
    await call('post', 'communications/messages', await intent()).expect(400);
    await call('post', 'sms/messages', {
      operationKey: randomUUID(),
      expectedUpdatedAt: (await intent()).configVersion,
      toNumber: body.recipient,
      text: body.text,
      confirmed: true,
    }).expect(400);
    expect((await call('post', 'communications/messages', body).expect(200)).body.id).toBe(
      sent.body.id,
    );
    await authorize();
  });
  it('never clears STOP from a new human authorization', async () => {
    const recipient = '+15145550223';
    await authorize('SMS', recipient);
    await db.smsSuppression.create({
      data: { tenantId, phoneNumber: recipient, sourceEventId: 'fixture-stop' },
    });
    const pref = (
      await call('get', `communications/preference?${q('SMS', { recipient })}`).expect(200)
    ).body;
    expect(pref.stopped).toBe(true);
    await call('post', 'communications/messages', await intent('SMS', recipient)).expect(400);
    await call('put', 'communications/preference', {
      access: 'services/jobs',
      entityId: jobId,
      channel: 'SMS',
      recipient,
      expectedVersion: pref.version,
      allowed: true,
      evidence: 'START',
      observedAt: '2026-09-01',
      confirmed: true,
    }).expect(400);
  });
  it('rechecks source access even on a previously successful replay', async () => {
    const body = await intent();
    await call('post', 'communications/messages', body).expect(200);
    await db.tenantModule.updateMany({ where: { tenantId }, data: { enabled: false } });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    try {
      await call('post', 'communications/messages', body).expect(403);
      await call('get', `communications/context?${q()}`).expect(403);
    } finally {
      await db.tenantModule.updateMany({ where: { tenantId }, data: { enabled: true } });
      app.get(TenantModulesCacheService).invalidate(tenantId);
    }
  });
  it('rolls back SMS journal, dossier and contact decision when their atomic audit fails', async () => {
    const body = await intent();
    const before = await db.smsMessage.count({ where: { tenantId } });
    const audit = jest
      .spyOn(app.get(AuditLogsService), 'log')
      .mockRejectedValueOnce(new Error('injected audit failure'));
    await call('post', 'communications/messages', body).expect(500);
    audit.mockRestore();
    expect(await db.smsMessage.count({ where: { tenantId } })).toBe(before);
    expect(
      await db.dossierCommunication.count({ where: { tenantId, operationKey: body.operationKey } }),
    ).toBe(0);
    const pref = (
      await call('get', `communications/preference?${q('SMS', { recipient: '+15145550222' })}`)
    ).body;
    const fail = jest
      .spyOn(app.get(AuditLogsService), 'log')
      .mockRejectedValueOnce(new Error('injected audit failure'));
    await call('put', 'communications/preference', {
      access: 'services/jobs',
      entityId: jobId,
      channel: 'SMS',
      recipient: '+15145550222',
      expectedVersion: pref.version,
      allowed: false,
      evidence: 'Refusal',
      observedAt: '2026-09-01',
      confirmed: true,
    }).expect(500);
    fail.mockRestore();
    expect(
      (await call('get', `communications/preference?${q('SMS', { recipient: '+15145550222' })}`))
        .body.version,
    ).toBe(pref.version);
  });
  it('simulates dossier email without falling back to platform SMTP and without touching financial outbox', async () => {
    await authorize('EMAIL', 'atelier@example.test');
    const before = await db.emailMessage.count({ where: { tenantId } }),
      body = await intent('EMAIL', 'atelier@example.test');
    expect((await call('post', 'communications/messages', body).expect(200)).body.emailStatus).toBe(
      'SIMULATED',
    );
    expect(emailSend).not.toHaveBeenCalled();
    expect(await db.emailMessage.count({ where: { tenantId } })).toBe(before);
    await call('post', 'communications/messages', {
      ...body,
      operationKey: randomUUID(),
      subject: 'x\r\nBcc:test@example.test',
    }).expect(400);
  });
  it('sends one email with captured tenant configuration and safe HTML; UNKNOWN is never retried', async () => {
    await call('put', 'email-config', {
      host: 'smtp.example.test',
      port: 587,
      active: true,
      fromEmail: 'sender@example.test',
      fromName: 'Pulsar test',
    }).expect(200);
    const body = {
      ...(await intent('EMAIL', 'atelier@example.test')),
      text: '<script>alert(1)</script>',
    };
    const results = await Promise.all([
      call('post', 'communications/messages', body),
      call('post', 'communications/messages', body),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(emailSend.mock.calls[0][0]).toMatchObject({
      html: expect.stringContaining('&lt;script&gt;'),
    });
    emailSend.mockResolvedValueOnce(false);
    const uncertain = await intent('EMAIL', 'atelier@example.test');
    expect(
      (await call('post', 'communications/messages', uncertain).expect(200)).body.emailStatus,
    ).toBe('UNKNOWN');
    expect(
      (await call('post', 'communications/messages', uncertain).expect(200)).body.emailStatus,
    ).toBe('UNKNOWN');
    expect(emailSend).toHaveBeenCalledTimes(2);
    await call('put', 'email-config', { active: false, inboundActive: false }).expect(200);
  });
  it('creates and versions operational templates, rejects unknown variables and foreign IDs', async () => {
    const body = {
      channel: 'SMS',
      name: 'Rappel intervention',
      text: 'Bonjour {{client}}, suivi de {{dossier}}.',
      active: true,
      expectedUpdatedAt: null,
    };
    const created = (await call('post', 'communications/templates', body).expect(201)).body;
    await call('put', `communications/templates/${created.id}`, {
      ...body,
      name: 'Updated',
    }).expect(409);
    await call(
      'put',
      `communications/templates/${created.id}`,
      { ...body, expectedUpdatedAt: created.updatedAt, active: false },
      'other',
    ).expect(404);
    await call('post', 'communications/templates', { ...body, text: '{{secret}}' }).expect(400);
    await call('put', `communications/templates/${created.id}`, {
      ...body,
      expectedUpdatedAt: created.updatedAt,
      name: 'Rappel personnalisé',
    }).expect(200);
    expect(
      (await call('get', 'communications/templates?channel=SMS').expect(200)).body,
    ).toHaveLength(1);
    expect(
      (await call('get', 'communications/templates?channel=SMS', undefined, 'other').expect(200))
        .body,
    ).toHaveLength(0);
  });
  it('resolves CRM and shipment contacts by explicit tenant-owned links only', async () => {
    for (const entry of MODULE_CATALOG.filter((m) =>
      ['crm', 'transportation', 'clients'].includes(m.key),
    )) {
      const m = await db.moduleDefinition.upsert({
        where: { key: entry.key },
        create: entry,
        update: entry,
      });
      await db.tenantModule.create({ data: { tenantId, moduleId: m.id, enabled: true } });
    }
    app.get(TenantModulesCacheService).invalidate(tenantId);
    const company = await db.crmCompany.create({ data: { tenantId, name: 'Société CRM' } });
    await db.crmContact.create({
      data: {
        tenantId,
        companyId: company.id,
        name: 'Alice',
        email: 'alice@example.test',
        phone: '+15145550555',
      },
    });
    const deal = await db.crmDeal.create({
      data: { tenantId, companyId: company.id, title: 'Mandat atelier' },
    });
    const c = (
      await call(
        'get',
        `communications/context?${q('EMAIL', { access: 'crm/deals', entityId: deal.id })}`,
      ).expect(200)
    ).body;
    expect(c.recipients).toEqual([
      { label: 'Alice', value: 'alice@example.test', channel: 'EMAIL' },
    ]);
    const foreign = await db.crmCompany.create({
      data: { tenantId: foreignId, name: 'Foreign company' },
    });
    const poisoned = await db.crmDeal.create({
      data: { tenantId, companyId: foreign.id, title: 'Invalid legacy FK' },
    });
    await call(
      'get',
      `communications/context?${q('EMAIL', { access: 'crm/deals', entityId: poisoned.id })}`,
    ).expect(404);
    const customer = await db.customer.create({
      data: { tenantId, code: 'C-TMS', name: 'Transport client', phone: '+15145550666' },
    });
    const location = await db.location.create({
      data: {
        tenantId,
        code: 'L-TMS',
        name: 'Site',
        type: 'WAREHOUSE',
        addressLine1: '123 Test',
        city: 'Québec',
        state: 'QC',
        country: 'CA',
        postalCode: 'G1A1A1',
      },
    });
    const order = await db.transportOrder.create({
      data: {
        tenantId,
        customerId: customer.id,
        orderNumber: 'TO-COMM',
        originLocationId: location.id,
        destinationLocationId: location.id,
      },
    });
    const shipment = await db.shipment.create({
      data: {
        tenantId,
        transportOrderId: order.id,
        shipmentNumber: 'SH-COMM',
        originLocationId: location.id,
        destinationLocationId: location.id,
      },
    });
    expect(
      (
        await call(
          'get',
          `communications/context?${q('SMS', { access: 'transportation/shipments', entityId: shipment.id })}`,
        ).expect(200)
      ).body.recipients,
    ).toEqual([{ label: 'Transport client', value: '+15145550666', channel: 'SMS' }]);
    expect(
      (
        await call(
          'get',
          `communications/context?${q('SMS', { access: 'clients/data/customers', entityId: customer.id })}`,
        ).expect(200)
      ).body.kind,
    ).toBe('customer');
  });
});
