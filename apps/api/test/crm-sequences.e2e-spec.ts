import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AgentAutonomy, CrmSequenceMode, CrmSequenceTrigger, PERMISSIONS } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SequencesService } from '../src/modules/crm/sequences.service';
import { AgentsService } from '../src/core/agents/agents.service';
import { ProposedActionsService } from '../src/core/agents/proposed-actions.service';
import { AGENT_TOOL_SERVICES, ToolServices } from '../src/core/agents/tool-registry';
import { EmailService } from '../src/core/email/email.service';
import { MailService } from '../src/core/email/mail.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('CRM governed communications (real DB, provider stubbed)', () => {
  let app: INestApplication, prisma: PrismaService, service: SequencesService;
  let token: string, tenantId: string, userId: string, agentId: string;
  const sender = { send: jest.fn(async () => true) };
  const suffix = `seq-${Date.now()}`;
  const sequences: string[] = [],
    contacts: string[] = [];
  const headers = () => ({ Authorization: `Bearer ${token}` });
  const http = () => app.getHttpServer();
  const draft = (mode = CrmSequenceMode.SIMULATION) => ({
    name: suffix,
    enabled: true,
    mode,
    trigger: CrmSequenceTrigger.MANUAL,
    ...(mode === CrmSequenceMode.GOVERNED ? { agentId } : {}),
    steps: [
      { delayMinutes: 0, subject: 'Bonjour {{name}}', body: 'Votre demande pour {{company}}' },
      { delayMinutes: 1440, subject: 'Relance', body: 'Toujours intéressé ?' },
    ],
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(sender)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    prisma = app.get(PrismaService);
    service = app.get(SequencesService);
    const login = await request(http())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;
    tenantId = login.body.tenant.id;
    userId = login.body.user.id;
    const crm = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: crm.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: crm.id, enabled: true },
    });
    const agent = await app.get(AgentsService).create(tenantId, userId, {
      name: suffix,
      permissions: [PERMISSIONS.CRM.MANAGE, PERMISSIONS.EMAIL.SEND],
      autonomyLevel: AgentAutonomy.PROPOSE,
    });
    agentId = agent.id;
  });
  afterAll(async () => {
    if (prisma && tenantId) {
      await prisma.crmSequence.updateMany({
        where: { tenantId, id: { in: sequences } },
        data: { enabled: false },
      });
      // Drain fire-and-forget delivery before Prisma disconnects (no reopened connection).
      for (let i = 0; i < 50; i++) {
        const active = await prisma.emailMessage.count({
          where: { tenantId, agentId, status: 'SENDING' },
        });
        if (!active) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (agentId)
        await prisma.agent.update({ where: { id: agentId }, data: { status: 'REVOKED' } });
    }
    await app?.close();
  });

  async function contact() {
    const i = contacts.length;
    const r = await request(http())
      .post('/api/v1/crm/contacts')
      .set(headers())
      .send({ name: `Contact ${suffix} ${i}`, email: `${suffix}-${i}@example.test` })
      .expect(201);
    contacts.push(r.body.id);
    return r.body;
  }
  async function create(body = draft()) {
    const r = await request(http())
      .post('/api/v1/crm/sequences')
      .set(headers())
      .send(body)
      .expect(201);
    sequences.push(r.body.id);
    return r.body;
  }
  async function enroll(sequenceId: string, contactId: string) {
    const r = await request(http())
      .post(`/api/v1/crm/sequences/${sequenceId}/enroll`)
      .set(headers())
      .send({ contactId })
      .expect(201);
    return r.body;
  }
  async function grant(contactId: string) {
    return request(http())
      .patch(`/api/v1/crm/contacts/${contactId}/email-preference`)
      .set(headers())
      .send({ consent: 'GRANTED', source: 'Test explicit opt-in' })
      .expect(200);
  }
  const row = (id: string) =>
    prisma.crmSequenceRun.findFirstOrThrow({
      where: { id, tenantId },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
  const tick = () => service.processDue();

  it('rejects unsafe templates, invalid delays, unknown fields and foreign contacts', async () => {
    for (const body of [
      { ...draft(), steps: [{ delayMinutes: -1, subject: 'x', body: 'x' }] },
      { ...draft(), steps: [{ delayMinutes: 0, subject: '{{secret}}', body: 'x' }] },
      { ...draft(), tenantId: 'foreign' },
    ]) {
      await request(http()).post('/api/v1/crm/sequences').set(headers()).send(body).expect(400);
    }
    const s = await create();
    await request(http())
      .post(`/api/v1/crm/sequences/${s.id}/enroll`)
      .set(headers())
      .send({ contactId: 'not-owned' })
      .expect(404);
  });

  it('simulates a frozen sequence without any email or proposal and deduplicates enrollment', async () => {
    const c = await contact(),
      s = await create();
    const run = await enroll(s.id, c.id);
    expect((await enroll(s.id, c.id)).id).toBe(run.id);
    await request(http())
      .put(`/api/v1/crm/sequences/${s.id}`)
      .set(headers())
      .send({ ...draft(), steps: [{ delayMinutes: 0, subject: 'Changed', body: 'Changed' }] })
      .expect(200);
    await Promise.all([tick(), tick()]);
    const current = await row(run.id);
    expect(current.steps[0].status).toBe('SIMULATED');
    expect(current.steps[0].subject).toContain(c.name);
    expect(current.steps[1].dueAt).not.toBeNull();
    expect(
      await prisma.emailMessage.count({ where: { tenantId, relatedId: current.steps[0].id } }),
    ).toBe(0);
    expect(
      await prisma.proposedAction.count({
        where: { tenantId, triggeredByRef: `crm-sequence:${run.id}` },
      }),
    ).toBe(0);
    await prisma.crmSequenceStepRun.update({
      where: { id: current.steps[1].id },
      data: { dueAt: new Date(0) },
    });
    await tick();
    expect((await row(run.id)).status).toBe('COMPLETED');
  });

  it('pauses and resumes, then permanently stops without reactivation', async () => {
    const c = await contact(),
      s = await create(),
      run = await enroll(s.id, c.id);
    await request(http())
      .post(`/api/v1/crm/sequences/runs/${run.id}/pause`)
      .set(headers())
      .expect(201);
    await tick();
    expect((await row(run.id)).steps[0].status).toBe('PENDING');
    await request(http())
      .post(`/api/v1/crm/sequences/runs/${run.id}/resume`)
      .set(headers())
      .expect(201);
    await tick();
    expect((await row(run.id)).steps[0].status).toBe('SIMULATED');
    await request(http())
      .post(`/api/v1/crm/sequences/runs/${run.id}/stop`)
      .set(headers())
      .expect(201);
    await request(http())
      .post(`/api/v1/crm/sequences/runs/${run.id}/resume`)
      .set(headers())
      .expect(400);
    expect((await row(run.id)).steps[1].status).toBe('CANCELLED');
  });

  it('stops on inbound reply or changed address', async () => {
    for (const cause of ['reply', 'address']) {
      const c = await contact(),
        s = await create(),
        run = await enroll(s.id, c.id);
      if (cause === 'reply')
        await prisma.emailMessage.create({
          data: {
            tenantId,
            fromAddress: c.email,
            toAddresses: ['business@example.test'],
            subject: 'Re: demande',
            html: 'Oui',
            direction: 'INBOUND',
            status: 'SENT',
          },
        });
      else
        await prisma.crmContact.update({
          where: { id: c.id },
          data: { email: 'changed@example.test' },
        });
      await tick();
      expect((await row(run.id)).status).toBe('STOPPED');
    }
  });

  it('requires consent, records a reviewable proposal, and checks content before sending', async () => {
    const c = await contact(),
      s = await create(draft(CrmSequenceMode.GOVERNED));
    await request(http())
      .post(`/api/v1/crm/sequences/${s.id}/enroll`)
      .set(headers())
      .send({ contactId: c.id })
      .expect(400);
    const pref = await grant(c.id);
    expect(pref.body.unsubscribeToken).toBeUndefined();
    const run = await enroll(s.id, c.id);
    await tick();
    const step = (await row(run.id)).steps[0];
    expect(step.status).toBe('PROPOSED');
    const proposal = await prisma.proposedAction.findFirstOrThrow({
      where: { id: step.proposalId!, tenantId },
    });
    expect(proposal.argsJson).toMatchObject({ to: c.email, subject: `Bonjour ${c.name}` });
    const before = sender.send.mock.calls.length;
    await expect(
      service.sendStep(tenantId, step.id, agentId, {
        to: 'other@example.test',
        subject: step.subject,
        body: step.body,
      }),
    ).rejects.toThrow('contenu proposé');
    expect(sender.send.mock.calls.length).toBe(before);
    await app
      .get(ProposedActionsService)
      .approve(tenantId, proposal.id, userId, app.get<ToolServices>(AGENT_TOOL_SERVICES));
    const msg = await prisma.emailMessage.findUniqueOrThrow({
      where: { tenantId_dedupKey: { tenantId, dedupKey: `crm-sequence:${step.id}` } },
    });
    // Await the outbox's fire-and-forget result without invoking any real provider.
    for (let i = 0; i < 30; i++) {
      if (
        (await prisma.emailMessage.findUniqueOrThrow({ where: { id: msg.id } })).status === 'SENT'
      )
        break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await tick();
    expect((await row(run.id)).steps[0].status).toBe('SENT');
    await service.sendStep(tenantId, step.id, agentId, {
      to: c.email,
      subject: step.subject,
      body: step.body,
    });
    expect(
      await prisma.emailMessage.count({ where: { tenantId, dedupKey: `crm-sequence:${step.id}` } }),
    ).toBe(1);
    expect(sender.send.mock.calls.length - before).toBe(1);
    expect(msg.html).toContain('/unsubscribe?token=');
  });

  it('unsubscribe stops pending approvals and stays available when CRM is disabled', async () => {
    const c = await contact(),
      s = await create(draft(CrmSequenceMode.GOVERNED));
    await grant(c.id);
    const run = await enroll(s.id, c.id);
    await tick();
    const pref = await prisma.crmEmailPreference.findUniqueOrThrow({
      where: { tenantId_email: { tenantId, email: c.email } },
    });
    const crm = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId: crm.id } },
      data: { enabled: false },
    });
    try {
      const result = await request(http())
        .post('/api/v1/public/crm/unsubscribe')
        .send({ token: pref.unsubscribeToken })
        .expect(200);
      expect(result.body).toEqual({ unsubscribed: true });
      expect((await row(run.id)).status).toBe('STOPPED');
      expect(await service.deliveryGuard(tenantId, run.steps[0].id)).toBe('CANCEL');
    } finally {
      await prisma.tenantModule.update({
        where: { tenantId_moduleId: { tenantId, moduleId: crm.id } },
        data: { enabled: true },
      });
    }
  });

  it('only auto-enrolls future contacts when the trigger is enabled', async () => {
    const s = await create({ ...draft(), trigger: CrmSequenceTrigger.CONTACT_CREATED });
    const c = await contact();
    expect(
      await prisma.crmSequenceRun.count({ where: { tenantId, sequenceId: s.id, contactId: c.id } }),
    ).toBe(1);
    await request(http())
      .put(`/api/v1/crm/sequences/${s.id}`)
      .set(headers())
      .send({ ...draft(), enabled: false, trigger: CrmSequenceTrigger.CONTACT_CREATED })
      .expect(200);
    const later = await contact();
    expect(
      await prisma.crmSequenceRun.count({
        where: { tenantId, sequenceId: s.id, contactId: later.id },
      }),
    ).toBe(0);
  });

  it('holds delivery when the agent loses permission, and cannot cross tenant boundaries', async () => {
    const c = await contact(),
      s = await create(draft(CrmSequenceMode.GOVERNED));
    await grant(c.id);
    const run = await enroll(s.id, c.id);
    await prisma.agent.update({ where: { id: agentId }, data: { permissions: [] } });
    try {
      expect(await service.deliveryGuard(tenantId, run.steps[0].id)).toBe('HOLD');
    } finally {
      await prisma.agent.update({
        where: { id: agentId },
        data: { permissions: [PERMISSIONS.CRM.MANAGE, PERMISSIONS.EMAIL.SEND] },
      });
    }
    await expect(service.get('foreign', s.id)).rejects.toThrow();
    expect((await service.runs('foreign', {})).items).toEqual([]);
    expect(await service.deliveryGuard('foreign', run.steps[0].id)).toBe('CANCEL');
  });

  it('an explicitly authorized AUTO policy executes without a model and remains auditable', async () => {
    await app.get(AgentsService).update(tenantId, agentId, {
      caps: {
        policies: [{ effect: 'AUTO', tool: 'send_crm_sequence_email' }],
        maxActionsPerMinute: 50,
      },
    });
    const c = await contact(),
      s = await create(draft(CrmSequenceMode.GOVERNED));
    await grant(c.id);
    const run = await enroll(s.id, c.id);
    await tick();
    const proposal = await prisma.proposedAction.findFirstOrThrow({
      where: { tenantId, triggeredByRef: `crm-sequence:${run.id}` },
    });
    expect(proposal.autoApproved).toBe(true);
    expect(proposal.status).toBe('EXECUTED');
    expect(
      await prisma.emailMessage.count({ where: { tenantId, relatedId: run.steps[0].id } }),
    ).toBe(1);
  });

  it('recovers advancement after a crash between success and next-step scheduling', async () => {
    const c = await contact(),
      s = await create(),
      run = await enroll(s.id, c.id);
    await prisma.crmSequenceStepRun.update({
      where: { id: run.steps[0].id },
      data: { status: 'SIMULATED' },
    });
    await tick();
    expect((await row(run.id)).steps[1].dueAt).not.toBeNull();
  });

  it('enforces HTTP permissions independently from CRM read access', async () => {
    const readToken = app
      .get(JwtService)
      .sign(
        { sub: userId, tenantId, email: 'admin@pulsar.dev', permissions: [PERMISSIONS.CRM.READ] },
        { secret: app.get(ConfigService).getOrThrow('JWT_SECRET') },
      );
    await request(http()).get('/api/v1/crm/sequences').expect(401);
    await request(http())
      .get('/api/v1/crm/sequences')
      .set({ Authorization: `Bearer ${readToken}` })
      .expect(200);
    await request(http())
      .post('/api/v1/crm/sequences')
      .set({ Authorization: `Bearer ${readToken}` })
      .send(draft())
      .expect(403);
  });

  it('a paused follow-up cannot be sent through a stale human approval', async () => {
    await app
      .get(AgentsService)
      .update(tenantId, agentId, {
        caps: { policies: [{ effect: 'PROPOSE', tool: 'send_crm_sequence_email' }] },
      });
    const c = await contact(),
      s = await create(draft(CrmSequenceMode.GOVERNED));
    await grant(c.id);
    const run = await enroll(s.id, c.id);
    await tick();
    const step = (await row(run.id)).steps[0];
    await request(http())
      .post(`/api/v1/crm/sequences/runs/${run.id}/pause`)
      .set(headers())
      .expect(201);
    const before = sender.send.mock.calls.length;
    const outcome = await app
      .get(ProposedActionsService)
      .approve(tenantId, step.proposalId!, userId, app.get<ToolServices>(AGENT_TOOL_SERVICES));
    expect(outcome.status).toBe('FAILED');
    expect(await prisma.emailMessage.count({ where: { tenantId, relatedId: step.id } })).toBe(0);
    expect(sender.send.mock.calls.length).toBe(before);
  });

  it('DENY policy fails closed without an outbound message', async () => {
    await app
      .get(AgentsService)
      .update(tenantId, agentId, {
        caps: { policies: [{ effect: 'DENY', tool: 'send_crm_sequence_email' }] },
      });
    const c = await contact(),
      s = await create(draft(CrmSequenceMode.GOVERNED));
    await grant(c.id);
    const run = await enroll(s.id, c.id);
    await tick();
    expect((await row(run.id)).status).toBe('FAILED');
    expect(
      await prisma.emailMessage.count({ where: { tenantId, relatedId: run.steps[0].id } }),
    ).toBe(0);
  });
});
