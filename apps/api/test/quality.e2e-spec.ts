import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { MODULE_CATALOG } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { FILE_STORAGE } from '../src/core/documents/storage/file-storage';
import { Readable } from 'node:stream';

describe('Quality (real HTTP + Postgres)', () => {
  let app: INestApplication,
    db: PrismaService,
    http: any,
    tenantId: string,
    foreign: string,
    token: string,
    reader: string,
    isolatedReader: string,
    documentsReader: string;
  const files = new Map<string, Buffer>();
  let receipt: any, draftReceipt: any, manufacturing: any, support: any, foreignPlan: any;
  const slug = 'quality-' + Date.now(),
    criteria = [
      { key: 'aspect', label: 'Aspect', kind: 'CHECK' },
      { key: 'diameter', label: 'Diamètre', kind: 'NUMBER', unit: 'mm', min: 9.8, max: 10.2 },
    ];
  const call = (method: 'get' | 'post' | 'patch', path: string, body?: object, auth = token) =>
    request(http)
      [method]('/api/v1/quality/' + path)
      .set('Authorization', `Bearer ${auth}`)
      .send(body);
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentRuntimeService)
      .useValue({ killAgentSessions: async () => {}, closeSession: async () => {} })
      .overrideProvider(FILE_STORAGE)
      .useValue({
        put: async (key: string, body: Buffer) => {
          files.set(key, body);
        },
        get: async (key: string) => Readable.from(files.get(key)!),
        delete: async (key: string) => {
          files.delete(key);
        },
        getDownloadUrl: async () => null,
        getUploadUrl: async () => null,
      })
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
    for (const key of ['quality', 'wms', 'manufacturing', 'support']) {
      const entry = MODULE_CATALOG.find((m) => m.key === key)!;
      const m = await db.moduleDefinition.upsert({ where: { key }, create: entry, update: entry });
      await db.tenantModule.create({ data: { tenantId, moduleId: m.id, enabled: true } });
    }
    for (const mode of ['operator', 'reader', 'isolated', 'documents']) {
      const keys =
        mode === 'operator'
          ? ['quality.read', 'quality.manage', 'wms.read', 'manufacturing.read', 'support.read']
          : mode === 'isolated'
            ? ['quality.read', 'quality.manage']
            : mode === 'documents'
              ? ['core.documents.read', 'core.documents.manage']
              : ['quality.read'];
      const ps = await db.permission.findMany({ where: { key: { in: keys } } });
      expect(ps).toHaveLength(keys.length);
      const role = await db.role.create({
        data: {
          tenantId,
          key: mode,
          name: mode,
          permissions: { create: ps.map((p) => ({ permissionId: p.id })) },
        },
      });
      const email = `${mode}@${slug}.test`;
      await db.user.create({
        data: {
          tenantId,
          email,
          firstName: 'Quality',
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
      if (mode === 'operator') token = r.body.accessToken;
      else if (mode === 'reader') reader = r.body.accessToken;
      else if (mode === 'isolated') isolatedReader = r.body.accessToken;
      else documentsReader = r.body.accessToken;
    }
    const loc = await db.location.create({
      data: {
        tenantId,
        code: 'QC-SITE',
        name: 'Quality site',
        type: 'WAREHOUSE',
        addressLine1: '1 Test',
        city: 'Québec',
      },
    });
    receipt = await db.receipt.create({
      data: {
        tenantId,
        number: 'QC-RC',
        locationId: loc.id,
        status: 'POSTED',
        postedAt: new Date(),
      },
    });
    draftReceipt = await db.receipt.create({
      data: { tenantId, number: 'QC-RC-DRAFT', locationId: loc.id },
    });
    manufacturing = await db.manufacturingOrder.create({
      data: {
        tenantId,
        number: 'QC-MO',
        name: 'Order',
        productRef: 'Part',
        dueDate: new Date(),
        releaseDate: new Date(),
      },
    });
    const partner = await db.businessPartner.create({
      data: { tenantId, code: 'QC-CLIENT', name: 'Client', isCustomer: true },
    });
    support = await db.supportCase.create({
      data: {
        tenantId,
        partnerId: partner.id,
        number: 'QC-SAV',
        title: 'Problem',
        description: 'Problem',
        operationKey: randomUUID(),
        requestFingerprint: 'fixture',
      },
    });
    foreignPlan = await db.qualityPlan.create({
      data: { tenantId: foreign, code: 'FOREIGN', name: 'Foreign plan', criteria },
    });
  }, 60000);
  afterAll(async () => {
    try {
      if (db) {
        const tids = [tenantId, foreign].filter(Boolean);
        await db.qualityEvidence.deleteMany({ where: { tenantId: { in: tids } } });
        await db.document.deleteMany({
          where: { tenantId: { in: tids }, entityType: 'quality-evidence' },
        });
        await db.qualityEvent.deleteMany({ where: { tenantId: { in: tids } } });
        await db.qualityNonconformity.deleteMany({ where: { tenantId: { in: tids } } });
        await db.qualityInspection.deleteMany({ where: { tenantId: { in: tids } } });
        await db.qualityPlan.deleteMany({ where: { tenantId: { in: tids } } });
      }
    } finally {
      await app?.close();
    }
  });
  const plan = async () =>
    (
      await call('post', 'plans', {
        code: 'QC-' + randomUUID().slice(0, 8).toUpperCase(),
        name: 'Contrôle pièce',
        instructions: 'Mesurer au pied à coulisse.',
        active: true,
        criteria,
      }).expect(201)
    ).body;
  const inspection = async (p: any, sourceKind = 'MANUAL', sourceId?: string) =>
    (
      await call('post', 'inspections', {
        planId: p.id,
        title: 'Pièce A',
        sourceKind,
        ...(sourceId ? { sourceId } : {}),
        operationKey: randomUUID(),
      }).expect(201)
    ).body;
  const transition = async (r: any, status: string) =>
    (
      await call('post', `inspections/${r.id}/transition`, {
        expectedUpdatedAt: r.updatedAt,
        status,
        note: 'Décision vérifiée',
      }).expect(201)
    ).body;
  const results = async (r: any, value = 10) =>
    (
      await call('patch', `inspections/${r.id}/results`, {
        expectedUpdatedAt: r.updatedAt,
        results: [
          { key: 'aspect', value: 'PASS' },
          { key: 'diameter', value, note: 'Mesure relevée' },
        ],
      }).expect(200)
    ).body;
  it('protects permissions, tenant ownership and complete plan validation', async () => {
    const p = await plan();
    await call('get', `plans/${p.id}`, undefined, reader).expect(200);
    await call(
      'post',
      'plans',
      { code: 'READONLY', name: 'x', instructions: '', active: true, criteria },
      reader,
    ).expect(403);
    await call('get', `plans/${foreignPlan.id}`).expect(404);
    await call('post', 'inspections', {
      planId: foreignPlan.id,
      title: 'Wrong',
      sourceKind: 'MANUAL',
      operationKey: randomUUID(),
    }).expect(400);
    for (const invalid of [
      [],
      [criteria[0], criteria[0]],
      [{ ...criteria[1], min: 11 }],
      [{ ...criteria[0], unit: 'EA' }],
      [{ ...criteria[0], unexpected: 1 }],
    ])
      await call('post', 'plans', {
        code: 'BAD',
        name: 'bad',
        instructions: '',
        active: true,
        criteria: invalid,
      }).expect(400);
    await call('post', 'plans', {
      code: p.code,
      name: 'duplicate',
      instructions: '',
      active: true,
      criteria,
    }).expect(409);
    await call('post', 'inspections', {
      planId: p.id,
      title: 'wrong tenant',
      sourceKind: 'MANUAL',
      operationKey: randomUUID(),
      tenantId: foreign,
    }).expect(400);
  });
  it('freezes the plan at creation and replays the exact operation after deactivation', async () => {
    const p = await plan(),
      body = { planId: p.id, title: 'Snapshot', sourceKind: 'MANUAL', operationKey: randomUUID() };
    const r = (await call('post', 'inspections', body).expect(201)).body;
    const changed = (
      await call('patch', `plans/${p.id}`, {
        expectedUpdatedAt: p.updatedAt,
        name: 'V2',
        instructions: 'changed',
        active: false,
        criteria: [criteria[0]],
      }).expect(200)
    ).body;
    expect(changed.revision).toBe(2);
    await call('patch', `plans/${p.id}`, {
      expectedUpdatedAt: p.updatedAt,
      name: 'stale',
      instructions: '',
      active: true,
      criteria,
    }).expect(409);
    const replay = (await call('post', 'inspections', body).expect(201)).body;
    expect(replay).toMatchObject({
      id: r.id,
      replayed: true,
      planRevision: 1,
      planName: p.name,
      criteria,
    });
    expect(replay).not.toHaveProperty('operationKey');
    expect(replay).not.toHaveProperty('requestFingerprint');
    expect(replay).not.toHaveProperty('tenantId');
    await call('post', 'inspections', { ...body, title: 'Different' }).expect(409);
    await call('post', 'inspections', body, isolatedReader).expect(409);
    await call('post', 'inspections', { ...body, operationKey: randomUUID() }).expect(409);
    expect(
      await db.qualityInspection.count({ where: { tenantId, operationKey: body.operationKey } }),
    ).toBe(1);
  });
  it('requires complete typed results, preserves bounds and never creates NC for PASS', async () => {
    let r = await inspection(await plan());
    await call('post', `inspections/${r.id}/transition`, {
      expectedUpdatedAt: r.updatedAt,
      status: 'COMPLETED',
      note: 'skip',
    }).expect(409);
    r = await transition(r, 'IN_PROGRESS');
    await call('post', `inspections/${r.id}/transition`, {
      expectedUpdatedAt: r.updatedAt,
      status: 'COMPLETED',
      note: 'empty',
    }).expect(400);
    for (const invalid of [
      [{ key: 'aspect', value: ['PASS'] }],
      [{ key: 'diameter', value: '10' }],
      [
        { key: 'aspect', value: 'PASS' },
        { key: 'aspect', value: 'PASS' },
      ],
    ])
      await call('patch', `inspections/${r.id}/results`, {
        expectedUpdatedAt: r.updatedAt,
        results: invalid,
      }).expect(400);
    r = await results(r, 9.8);
    r = await transition(r, 'COMPLETED');
    expect(r.outcome).toBe('PASS');
    expect(r.nonconformity).toBeNull();
    await call('patch', `inspections/${r.id}/results`, {
      expectedUpdatedAt: r.updatedAt,
      results: [],
    }).expect(409);
    await call('post', `inspections/${r.id}/transition`, {
      expectedUpdatedAt: r.updatedAt,
      status: 'IN_PROGRESS',
      note: 'rewrite',
    }).expect(409);
  });
  it('atomically opens only one NC when two completions race, with durable history', async () => {
    let r = await inspection(await plan());
    r = await transition(r, 'IN_PROGRESS');
    r = await results(r, 10.4);
    const writes = await Promise.all(
      [1, 2].map(() =>
        call('post', `inspections/${r.id}/transition`, {
          expectedUpdatedAt: r.updatedAt,
          status: 'COMPLETED',
          note: 'Hors tolérance',
        }),
      ),
    );
    expect(writes.map((x) => x.status).sort()).toEqual([201, 409]);
    const done = (await call('get', `inspections/${r.id}`).expect(200)).body;
    expect(done.outcome).toBe('FAIL');
    expect(done.nonconformity.number).toMatch(/^NC-/);
    expect(await db.qualityNonconformity.count({ where: { tenantId, inspectionId: r.id } })).toBe(
      1,
    );
    const h = (await call('get', `inspections/${r.id}/history?pageSize=2`).expect(200)).body;
    expect(h.total).toBe(5);
    expect(h.items).toHaveLength(2);
    expect(h.items.every((e: any) => e.actor.firstName === 'Quality')).toBe(true);
    expect(
      await db.qualityEvent.count({ where: { tenantId, inspectionId: r.id, action: 'NC_OPEN' } }),
    ).toBe(1);
  });
  it('requires cause, correction and explicit verification, supports reopening before final close', async () => {
    let r = await inspection(await plan());
    r = await transition(r, 'IN_PROGRESS');
    r = await results(r, 11);
    r = await transition(r, 'COMPLETED');
    let nc = (await call('get', `nonconformities/${r.nonconformity.id}`).expect(200)).body;
    const step = (status: string, note = 'Action vérifiée') =>
      call('post', `nonconformities/${nc.id}/transition`, {
        expectedUpdatedAt: nc.updatedAt,
        status,
        note,
      });
    await step('CLOSED').expect(409);
    nc = (await step('IN_PROGRESS').expect(201)).body;
    await step('RESOLVED').expect(409);
    nc = (
      await call('patch', `nonconformities/${nc.id}`, {
        expectedUpdatedAt: nc.updatedAt,
        rootCause: 'Outil usé',
        correctiveAction: 'Remplacer et régler',
      }).expect(200)
    ).body;
    nc = (await step('RESOLVED').expect(201)).body;
    nc = (await step('IN_PROGRESS', 'Vérification à reprendre').expect(201)).body;
    nc = (await step('RESOLVED').expect(201)).body;
    await step('CLOSED', '   ').expect(400);
    nc = (await step('CLOSED', 'Nouvelle pièce conforme après réglage').expect(201)).body;
    await step('IN_PROGRESS').expect(409);
    await call('patch', `nonconformities/${nc.id}`, {
      expectedUpdatedAt: nc.updatedAt,
      rootCause: 'rewrite',
      correctiveAction: 'rewrite',
    }).expect(409);
    expect((await call('get', `inspections/${r.id}`).expect(200)).body.outcome).toBe('FAIL');
  });
  it('links all three domains without modifying their state or stock; hides unauthorized references', async () => {
    const p = await plan(),
      stock = await db.stockMovement.count({ where: { tenantId } });
    for (const [kind, source] of [
      ['RECEIPT', receipt],
      ['MANUFACTURING', manufacturing],
      ['SUPPORT', support],
    ] as const) {
      const refs = (await call('get', `references?kind=${kind}`).expect(200)).body;
      expect(refs.items.map((x: any) => x.id)).toContain(source.id);
      expect(refs.items[0]).not.toHaveProperty('tenantId');
      await call('get', `references?kind=${kind}`, undefined, isolatedReader).expect(403);
      let r = await inspection(p, kind, source.id);
      expect(r.source.id).toBe(source.id);
      const hidden = (
        await call('get', `inspections/${r.id}`, undefined, isolatedReader).expect(200)
      ).body;
      expect(hidden.source).toEqual({ kind, available: false });
      expect(hidden).not.toHaveProperty('receiptId');
      expect(hidden).not.toHaveProperty('manufacturingOrderId');
      expect(hidden).not.toHaveProperty('supportCaseId');
      r = await transition(r, 'IN_PROGRESS');
      r = await results(r, 11);
      await transition(r, 'COMPLETED');
    }
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(stock);
    expect(
      (await db.receipt.findFirstOrThrow({ where: { tenantId, id: receipt.id } })).status,
    ).toBe('POSTED');
    expect(
      (await db.manufacturingOrder.findFirstOrThrow({ where: { tenantId, id: manufacturing.id } }))
        .status,
    ).toBe('DRAFT');
    expect(
      (await db.supportCase.findFirstOrThrow({ where: { tenantId, id: support.id } })).status,
    ).toBe('OPEN');
    await call('post', 'inspections', {
      planId: p.id,
      title: 'wrong',
      sourceKind: 'RECEIPT',
      sourceId: draftReceipt.id,
      operationKey: randomUUID(),
    }).expect(409);
    await call('post', 'inspections', {
      planId: p.id,
      title: 'wrong',
      sourceKind: 'SUPPORT',
      sourceId: 'unknown',
      operationKey: randomUUID(),
    }).expect(400);
    await call('post', 'inspections', {
      planId: p.id,
      title: 'wrong',
      sourceKind: 'MANUAL',
      sourceId: support.id,
      operationKey: randomUUID(),
    }).expect(400);
  });
  it('rejects foreign inspection and nonconformity reads and version replays', async () => {
    const r = await inspection(await plan());
    const foreignInspection = await db.qualityInspection.create({
      data: {
        tenantId: foreign,
        number: 'QC-OTHER',
        title: 'Other',
        planId: foreignPlan.id,
        planName: foreignPlan.name,
        planRevision: 1,
        instructions: '',
        criteria,
        operationKey: randomUUID(),
        requestFingerprint: 'fixture',
      },
    });
    await call('get', `inspections/${foreignInspection.id}`).expect(404);
    await call('get', `inspections/${foreignInspection.id}/history`).expect(404);
    expect(
      (await call('get', 'inspections').expect(200)).body.items.map((i: any) => i.id),
    ).not.toContain(foreignInspection.id);
    const done = await transition(r, 'CANCELLED');
    await call('post', `inspections/${r.id}/transition`, {
      expectedUpdatedAt: r.updatedAt,
      status: 'IN_PROGRESS',
      note: 'stale',
    }).expect(409);
    expect(done.status).toBe('CANCELLED');
    await call('get', 'nonconformities/unknown').expect(404);
  });
  it('assigns an owned active person and real civil due date with optimistic locking', async () => {
    const done = await transition(
      await results(await transition(await inspection(await plan()), 'IN_PROGRESS'), 12),
      'COMPLETED',
    );
    let nc = (await call('get', `nonconformities/${done.nonconformity.id}`).expect(200)).body;
    const operator = await db.user.findFirstOrThrow({
      where: { tenantId, email: `operator@${slug}.test` },
    });
    const body = {
      expectedUpdatedAt: nc.updatedAt,
      assigneeUserId: operator.id,
      dueDate: '2020-01-01',
    };
    await call('patch', `nonconformities/${nc.id}/assignment`, {
      ...body,
      dueDate: '2026-02-30',
    }).expect(400);
    await call('patch', `nonconformities/${nc.id}/assignment`, {
      ...body,
      assigneeUserId: 'foreign',
    }).expect(400);
    await call('patch', `nonconformities/${nc.id}/assignment`, body, reader).expect(403);
    nc = (await call('patch', `nonconformities/${nc.id}/assignment`, body).expect(200)).body;
    expect(nc.assignee.id).toBe(operator.id);
    expect(nc.assignee).not.toHaveProperty('email');
    await call('patch', `nonconformities/${nc.id}/assignment`, body).expect(409);
    expect(
      (
        await call('get', 'nonconformities?assignment=mine&overdue=true').expect(200)
      ).body.items.map((r: any) => r.id),
    ).toContain(nc.id);
    expect(
      (await call('get', 'nonconformities?assignment=unassigned').expect(200)).body.items.map(
        (r: any) => r.id,
      ),
    ).not.toContain(nc.id);
    await db.user.updateMany({
      where: { tenantId, id: operator.id },
      data: { status: 'DISABLED' },
    });
    await call(
      'patch',
      `nonconformities/${nc.id}/assignment`,
      { ...body, expectedUpdatedAt: nc.updatedAt },
      isolatedReader,
    ).expect(400);
    await db.user.updateMany({ where: { tenantId, id: operator.id }, data: { status: 'ACTIVE' } });
  });
  it('stores proofs idempotently, downloads through quality and blocks every generic bypass', async () => {
    const done = await transition(
      await results(await transition(await inspection(await plan()), 'IN_PROGRESS'), 12),
      'COMPLETED',
    );
    let nc = (await call('get', `nonconformities/${done.nonconformity.id}`).expect(200)).body;
    const operationKey = randomUUID(),
      originalVersion = nc.updatedAt,
      bytes = Buffer.from('%PDF-1.7\nA verified quality proof\n%%EOF');
    const upload = (
      auth = token,
      content = bytes,
      name = 'proof.pdf',
      key = operationKey,
      version = originalVersion,
    ) =>
      request(http)
        .post(`/api/v1/quality/nonconformities/${nc.id}/evidence`)
        .set('Authorization', `Bearer ${auth}`)
        .field('caption', 'Contre-mesure de la pièce')
        .field('expectedUpdatedAt', version)
        .field('operationKey', key)
        .attach('file', content, { filename: name, contentType: 'application/pdf' });
    await upload(reader).expect(403);
    await upload(token, Buffer.from('not a pdf')).expect(400);
    const first = (await upload().expect(201)).body;
    nc = first.nonconformity;
    expect((await upload().expect(201)).body).toMatchObject({ id: first.id, replayed: true });
    await upload(token, Buffer.from('%PDF-Other')).expect(409);
    await upload(isolatedReader).expect(409);
    const list = (
      await call('get', `nonconformities/${nc.id}/evidence`, undefined, reader).expect(200)
    ).body;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/storageKey|documentId|fingerprint|operationKey/);
    const download = await request(http)
      .get(`/api/v1/quality/nonconformities/${nc.id}/evidence/${first.id}/download`)
      .set('Authorization', `Bearer ${reader}`)
      .expect(200);
    expect(download.body).toEqual(bytes);
    const proof = await db.qualityEvidence.findFirstOrThrow({ where: { tenantId, id: first.id } }),
      doc = await db.document.findFirstOrThrow({ where: { tenantId, id: proof.documentId } });
    const generic = (method: 'get' | 'post' | 'delete', path: string, body?: object) =>
      request(http)
        [method]('/api/v1/documents' + path)
        .set('Authorization', `Bearer ${documentsReader}`)
        .send(body);
    await generic('get', `/${doc.id}/download`).expect(403);
    await generic('get', `/${doc.id}/download-url`).expect(403);
    await generic('delete', `/${doc.id}`).expect(403);
    await generic('get', `?entityType=quality-evidence&entityId=${nc.id}`).expect(403);
    expect(JSON.stringify((await generic('get', '').expect(200)).body)).not.toContain(doc.id);
    expect(JSON.stringify((await generic('get', '/center').expect(200)).body)).not.toContain(
      'proof.pdf',
    );
    await generic('post', '/presign-upload', {
      entityType: 'quality-evidence',
      entityId: nc.id,
      fileName: 'alias.pdf',
      mimeType: 'application/pdf',
    }).expect(403);
    await generic('post', '/confirm-upload', {
      entityType: 'load',
      entityId: nc.id,
      fileName: 'alias.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      storageKey: doc.storageKey,
    }).expect(400);
    await request(http)
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${documentsReader}`)
      .field('entityType', 'quality-evidence')
      .field('entityId', nc.id)
      .attach('file', bytes, 'proof.pdf')
      .expect(403);
    await call('get', `nonconformities/${nc.id}/evidence`, undefined, documentsReader).expect(403);
    nc = (
      await call('patch', `nonconformities/${nc.id}`, {
        rootCause: 'Usure',
        correctiveAction: 'Remplacement',
        expectedUpdatedAt: nc.updatedAt,
      }).expect(200)
    ).body;
    for (const status of ['IN_PROGRESS', 'RESOLVED', 'CLOSED'])
      nc = (
        await call('post', `nonconformities/${nc.id}/transition`, {
          status,
          note: 'Vérifié',
          expectedUpdatedAt: nc.updatedAt,
        }).expect(201)
      ).body;
    expect((await upload().expect(201)).body.replayed).toBe(true);
    await upload(token, bytes, 'proof.pdf', randomUUID(), nc.updatedAt).expect(409);
    await call('patch', `nonconformities/${nc.id}/assignment`, {
      assigneeUserId: null,
      dueDate: null,
      expectedUpdatedAt: nc.updatedAt,
    }).expect(409);
    await call('get', `nonconformities/unknown/evidence/${first.id}/download`).expect(404);
    expect(await db.qualityEvidence.count({ where: { tenantId, nonconformityId: nc.id } })).toBe(1);
    expect(files.has(doc.storageKey)).toBe(true);
  });
  it('gates source references and Quality when modules are disabled', async () => {
    const p = await plan(),
      r = await inspection(p, 'SUPPORT', support.id),
      cache = app.get(TenantModulesCacheService);
    await db.tenantModule.updateMany({
      where: { tenantId, module: { key: 'support' } },
      data: { enabled: false },
    });
    cache.invalidate(tenantId);
    await call('get', 'references?kind=SUPPORT').expect(403);
    expect((await call('get', `inspections/${r.id}`).expect(200)).body.source).toEqual({
      kind: 'SUPPORT',
      available: false,
    });
    await db.tenantModule.updateMany({
      where: { tenantId, module: { key: 'quality' } },
      data: { enabled: false },
    });
    cache.invalidate(tenantId);
    await call('get', 'summary').expect(403);
    await call('get', 'plans').expect(403);
    await call('get', `inspections/${r.id}`).expect(403);
  });
});
