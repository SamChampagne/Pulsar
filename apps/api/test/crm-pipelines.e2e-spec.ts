import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SequencesService } from '../src/modules/crm/sequences.service';
import { PipelinesService } from '../src/modules/crm/pipelines.service';
import { EmailService } from '../src/core/email/email.service';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PERMISSIONS } from '@pulsar/shared';
import { TOOL_BY_NAME } from '../src/core/agents/tool-registry';
import { DealsService } from '../src/modules/crm/deals.service';

describe('Configurable CRM pipelines and stage-entry automations', () => {
  let app: INestApplication, prisma: PrismaService, worker: SequencesService;
  let token: string, tenantId: string, userId: string, companyId: string, contactId: string;
  let pipeline: any, stage: any, other: any, sequence: any, deal: any;
  const suffix = `pipeline-${Date.now()}`;
  const sender = { send: jest.fn(async () => true) };
  const http = () => app.getHttpServer();
  const headers = () => ({ Authorization: `Bearer ${token}` });
  const columns = () => pipeline.stages.map((s: any) => ({ id: s.id, name: s.name, kind: s.kind }));
  const createDeal = async (data: Record<string, unknown> = {}) =>
    (
      await request(http())
        .post('/api/v1/crm/deals')
        .set(headers())
        .send({
          title: suffix,
          companyId,
          primaryContactId: contactId,
          pipelineId: pipeline.id,
          pipelineStageId: pipeline.stages[0].id,
          ...data,
        })
        .expect(201)
    ).body;
  const move = (item: any, id: string, expected = 200) =>
    request(http())
      .post(`/api/v1/crm/deals/${item.id}/advance`)
      .set(headers())
      .send({ pipelineStageId: id, expectedRevision: item.stageRevision })
      .expect(expected);
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
    worker = app.get(SequencesService);
    const login = (
      await request(http())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
        .expect(200)
    ).body;
    token = login.accessToken;
    tenantId = login.tenant.id;
    userId = login.user.id;
    const crm = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: crm.id } },
      create: { tenantId, moduleId: crm.id, enabled: true },
      update: { enabled: true },
    });
    companyId = (
      await request(http())
        .post('/api/v1/crm/companies')
        .set(headers())
        .send({ name: suffix })
        .expect(201)
    ).body.id;
    contactId = (
      await request(http())
        .post('/api/v1/crm/contacts')
        .set(headers())
        .send({ name: 'Contact pipeline', companyId, email: `${suffix}@example.test` })
        .expect(201)
    ).body.id;
  });
  afterAll(async () => {
    if (sequence)
      await prisma.crmSequence.updateMany({
        where: { tenantId, id: sequence.id },
        data: { enabled: false },
      });
    await app?.close();
  });
  it('creates and lists multiple isolated pipelines', async () => {
    pipeline = (
      await request(http())
        .post('/api/v1/crm/pipelines')
        .set(headers())
        .send({ name: suffix })
        .expect(201)
    ).body;
    expect(pipeline.stages).toHaveLength(5);
    const list = (await request(http()).get('/api/v1/crm/pipelines').set(headers()).expect(200))
      .body;
    expect(list.some((p: any) => p.key === 'default')).toBe(true);
    await expect(app.get(PipelinesService).get('foreign-tenant', pipeline.id)).rejects.toThrow();
  });
  it('renames, reorders and adds a column with a shared business phase', async () => {
    const stages = columns();
    stages[2].name = 'Proposition envoyée';
    pipeline = (
      await request(http())
        .put(`/api/v1/crm/pipelines/${pipeline.id}`)
        .set(headers())
        .send({
          name: suffix,
          revision: pipeline.revision,
          stages: [...stages, { name: 'Relance', kind: 'PROPOSAL' }],
        })
        .expect(200)
    ).body;
    stage = pipeline.stages.find((s: any) => s.name === 'Proposition envoyée');
    other = pipeline.stages.find((s: any) => s.name === 'Relance');
    expect(pipeline.stages[5].id).toBeTruthy();
  });
  it('rejects stale configuration writes and duplicate ids', async () => {
    await request(http())
      .put(`/api/v1/crm/pipelines/${pipeline.id}`)
      .set(headers())
      .send({ name: 'stale', revision: 0, stages: columns() })
      .expect(409);
    const stages = columns();
    stages[1].id = stages[0].id;
    await request(http())
      .put(`/api/v1/crm/pipelines/${pipeline.id}`)
      .set(headers())
      .send({ name: suffix, revision: pipeline.revision, stages })
      .expect(400);
  });
  it('binds a simulation to the column; manual contact enrollment is rejected', async () => {
    sequence = (
      await request(http())
        .post('/api/v1/crm/sequences')
        .set(headers())
        .send({
          name: suffix,
          enabled: true,
          mode: 'SIMULATION',
          trigger: 'DEAL_STAGE_ENTERED',
          pipelineStageId: stage.id,
          steps: [
            { delayMinutes: 0, subject: 'Bonjour {{name}}', body: 'Message original' },
            { delayMinutes: 1440, subject: 'Relance', body: 'Suivi' },
          ],
        })
        .expect(201)
    ).body;
    await request(http())
      .post(`/api/v1/crm/sequences/${sequence.id}/enroll`)
      .set(headers())
      .send({ contactId })
      .expect(400);
  });
  it('requires an owned contact from the opportunity company', async () => {
    await request(http())
      .post('/api/v1/crm/deals')
      .set(headers())
      .send({ title: suffix, companyId, primaryContactId: 'foreign', pipelineStageId: stage.id })
      .expect(400);
    const unrelated = await prisma.crmContact.create({ data: { tenantId, name: suffix } });
    await request(http())
      .post('/api/v1/crm/deals')
      .set(headers())
      .send({ title: suffix, companyId, primaryContactId: unrelated.id, pipelineStageId: stage.id })
      .expect(400);
  });
  it('moves into the stage with a durable snapshot and idempotent enrollment', async () => {
    deal = await createDeal();
    deal = (await move(deal, stage.id)).body;
    const entry = await prisma.crmStageEntry.findFirstOrThrow({
      where: { tenantId, dealId: deal.id, revision: deal.stageRevision },
    });
    expect(entry.sequenceId).toBe(sequence.id);
    await prisma.crmSequence.updateMany({
      where: { tenantId, id: sequence.id },
      data: { steps: [{ delayMinutes: 0, subject: 'Changed', body: 'Changed' }] },
    });
    await Promise.all([worker.processStageEntries(), worker.processStageEntries()]);
    const runs = await prisma.crmSequenceRun.findMany({
      where: { tenantId, dealId: deal.id },
      include: { steps: true },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].steps).toHaveLength(2);
    expect(runs[0].steps.find((s) => s.position === 0)?.body).toBe('Message original');
    await worker.processDue();
    expect(
      await prisma.emailMessage.count({
        where: { tenantId, relatedId: { in: runs[0].steps.map((s) => s.id) } },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.crmSequenceStepRun.findFirstOrThrow({
          where: { tenantId, runId: runs[0].id, position: 0 },
        })
      ).status,
    ).toBe('SIMULATED');
  });
  it('rejects stale moves and allows another column of the same open phase', async () => {
    await move({ ...deal, stageRevision: 0 }, other.id, 400);
    deal = (await move(deal, other.id)).body;
    const run = await prisma.crmSequenceRun.findFirstOrThrow({
      where: { tenantId, dealId: deal.id },
      include: { steps: true },
    });
    expect(run.status).toBe('STOPPED');
    expect(await worker.deliveryGuard(tenantId, run.steps[1].id)).toBe('CANCEL');
  });
  it('a new visit to the same column creates a new enrollment, never reuses the old run', async () => {
    deal = (await move(deal, stage.id)).body;
    await worker.processStageEntries();
    expect(await prisma.crmSequenceRun.count({ where: { tenantId, dealId: deal.id } })).toBe(2);
  });
  it('blocks removal of occupied columns and cross-pipeline moves', async () => {
    await request(http())
      .put(`/api/v1/crm/pipelines/${pipeline.id}`)
      .set(headers())
      .send({
        name: suffix,
        revision: pipeline.revision,
        stages: columns().filter((s: any) => s.id !== stage.id),
      })
      .expect(409);
    const another = await app
      .get(PipelinesService)
      .create(tenantId, userId, { name: suffix + '-other' });
    await move(deal, another.stages[0].id, 400);
  });
  it('cancels queued stage entries when the stage was left before the worker ran', async () => {
    let item = await createDeal();
    item = (await move(item, stage.id)).body;
    item = (await move(item, other.id)).body;
    await worker.processStageEntries();
    expect(await prisma.crmSequenceRun.count({ where: { tenantId, dealId: item.id } })).toBe(0);
    expect(
      (
        await prisma.crmStageEntry.findFirstOrThrow({
          where: { tenantId, dealId: item.id, revision: 1 },
        })
      ).reason,
    ).toContain('quittée');
  });
  it('records missing recipient instead of silently selecting all company contacts', async () => {
    const item = await createDeal({ primaryContactId: null, pipelineStageId: stage.id });
    await worker.processStageEntries();
    expect(
      (await prisma.crmStageEntry.findFirstOrThrow({ where: { tenantId, dealId: item.id } }))
        .reason,
    ).toContain('Contact principal');
    expect(await prisma.crmSequenceRun.count({ where: { tenantId, dealId: item.id } })).toBe(0);
  });
  it('preserves won/lost terminal invariants', async () => {
    const won = pipeline.stages.find((s: any) => s.kind === 'WON');
    deal = (await move(deal, won.id)).body;
    await move(deal, stage.id, 400);
  });
  it('invalidates queued entries and active runs permanently when the recipient changes', async () => {
    const items = [await createDeal(), await createDeal()];
    for (const [index, item] of items.entries()) {
      const entered = (await move(item, stage.id)).body;
      if (index === 1) await worker.processStageEntries();
      const changed = (
        await request(http())
          .patch(`/api/v1/crm/deals/${item.id}`)
          .set(headers())
          .send({ primaryContactId: null })
          .expect(200)
      ).body;
      expect(changed.stageRevision).toBe(entered.stageRevision + 1);
      await request(http())
        .patch(`/api/v1/crm/deals/${item.id}`)
        .set(headers())
        .send({ primaryContactId: contactId })
        .expect(200);
      await worker.processStageEntries();
      const runs = await prisma.crmSequenceRun.findMany({ where: { tenantId, dealId: item.id } });
      expect(runs).toHaveLength(index);
      if (index === 1) expect(runs[0].status).toBe('STOPPED');
    }
  });
  it('returns current connector mode without secrets and never sends on GET', async () => {
    const count = sender.send.mock.calls.length;
    const res = (
      await request(http()).get('/api/v1/email-config/connection').set(headers()).expect(200)
    ).body;
    expect(['smtp-tenant', 'smtp-platform', 'log']).toContain(res.outbound);
    expect(JSON.stringify(res)).not.toMatch(/passwordEnc|imapPasswordEnc/);
    expect(sender.send.mock.calls.length).toBe(count);
  });

  it('keeps mutations and connector credentials behind the correct permissions', async () => {
    const readToken = app
      .get(JwtService)
      .sign(
        { sub: userId, tenantId, email: 'admin@pulsar.dev', permissions: [PERMISSIONS.CRM.READ] },
        { secret: app.get(ConfigService).getOrThrow('JWT_SECRET') },
      );
    const readHeaders = { Authorization: `Bearer ${readToken}` };
    await request(http()).get('/api/v1/crm/pipelines').set(readHeaders).expect(200);
    await request(http())
      .post('/api/v1/crm/pipelines')
      .set(readHeaders)
      .send({ name: 'Forbidden' })
      .expect(403);
    await request(http())
      .put(`/api/v1/crm/pipelines/${pipeline.id}`)
      .set(readHeaders)
      .send({ name: suffix, revision: pipeline.revision, stages: columns() })
      .expect(403);
    await request(http()).get('/api/v1/email-config/connection').set(readHeaders).expect(403);
    await request(http()).post('/api/v1/crm/sequences').set(readHeaders).send({}).expect(403);
  });

  it('exposes custom columns to agents and validates unambiguous governed move inputs', async () => {
    const context = await app.get(DealsService).getWithContext(tenantId, deal.id);
    expect(context.pipeline.stages.some((s) => s.id === other.id && s.name === 'Relance')).toBe(
      true,
    );
    const tool = TOOL_BY_NAME.get('crm_advance_deal')!;
    expect(tool.tier).toBe('MUTATING');
    expect(
      tool.inputSchema.safeParse({
        dealId: deal.id,
        pipelineStageId: other.id,
        expectedRevision: deal.stageRevision,
      }).success,
    ).toBe(true);
    expect(
      tool.inputSchema.safeParse({ dealId: deal.id, stage: 'LEAD', pipelineStageId: other.id })
        .success,
    ).toBe(false);
    expect(tool.inputSchema.safeParse({ dealId: deal.id }).success).toBe(false);
  });
});
