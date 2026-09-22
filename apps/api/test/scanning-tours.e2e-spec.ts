import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('Scanners and first-entry tours (HTTP)', () => {
  let app: INestApplication, db: PrismaService, http: any, tid: string, foreign: string;
  let operator: string, reader: string, none: string, site: string, bin: string, item: string;
  const slug = `scan-${Date.now()}`;
  const post = (path: string, body: object, token = operator) =>
    request(http)
      .post('/api/v1/' + path)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const prefs = (body?: object, token = operator) =>
    body
      ? request(http)
          .put('/api/v1/me/preferences')
          .set('Authorization', `Bearer ${token}`)
          .send(body)
      : request(http).get('/api/v1/me/preferences').set('Authorization', `Bearer ${token}`);
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
    tid = (await db.tenant.create({ data: { slug, name: slug } })).id;
    foreign = (await db.tenant.create({ data: { slug: slug + '-foreign', name: 'Foreign' } })).id;
    const wm = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    await db.tenantModule.create({ data: { tenantId: tid, moduleId: wm.id, enabled: true } });
    for (const mode of ['operator', 'reader', 'none']) {
      const permissions = await db.permission.findMany({
        where: {
          key: {
            in:
              mode === 'operator'
                ? ['wms.read', 'wms.manage']
                : mode === 'reader'
                  ? ['wms.read']
                  : [],
          },
        },
      });
      const role = await db.role.create({
        data: {
          tenantId: tid,
          key: mode,
          name: mode,
          permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
        },
      });
      const email = `${mode}@${slug}.test`;
      await db.user.create({
        data: {
          tenantId: tid,
          email,
          firstName: 'Test',
          lastName: mode,
          status: 'ACTIVE',
          passwordHash: hashSync('Test1234!', 4),
          roles: { create: { roleId: role.id } },
        },
      });
      const login = await request(http)
        .post('/api/v1/auth/login')
        .send({ tenant: slug, email, password: 'Test1234!' })
        .expect(200);
      if (mode === 'operator') operator = login.body.accessToken;
      else if (mode === 'reader') reader = login.body.accessToken;
      else none = login.body.accessToken;
    }
    item = (
      await db.wmsItem.create({
        data: { tenantId: tid, sku: 'PART-1', name: 'Pièce', barcode: '001234' },
      })
    ).id;
    await db.wmsItem.createMany({
      data: [
        { tenantId: foreign, sku: 'FOREIGN', name: 'Secret', barcode: '001234' },
        { tenantId: foreign, sku: 'ONLY-FOREIGN', name: 'Secret', barcode: 'FOREIGN-CODE' },
        { tenantId: tid, sku: 'OFF', name: 'Inactif', barcode: 'INACTIVE', isActive: false },
        { tenantId: tid, sku: 'DUP-A', name: 'A', barcode: 'DUP' },
        { tenantId: tid, sku: 'DUP-B', name: 'B', barcode: 'DUP' },
      ],
    });
    for (const code of ['WH-A', 'WH-B']) {
      const loc = await db.location.create({
        data: {
          tenantId: tid,
          code,
          name: code,
          type: 'WAREHOUSE',
          addressLine1: '1 Test',
          city: 'Québec',
        },
      });
      const b = await db.bin.create({ data: { tenantId: tid, locationId: loc.id, code: 'A-01' } });
      if (code === 'WH-A') {
        site = loc.id;
        bin = b.id;
      }
    }
  });
  afterAll(async () => {
    await app?.close();
  });
  it('resolves the caller’s active article and exposes no other tenant data', async () => {
    const result = await post('scan/wms', { kind: 'item', code: '001234\r\n' }).expect(201);
    expect(result.body).toMatchObject({ id: item, code: 'PART-1', unit: 'EA' });
    expect(result.body).not.toHaveProperty('tenantId');
    await post('scan/wms', { kind: 'item', code: 'FOREIGN-CODE' }).expect(404);
    await post('scan/wms', { kind: 'item', code: 'INACTIVE' }).expect(404);
  });
  it('rejects duplicate codes and requires site context for duplicate bin codes', async () => {
    await post('scan/wms', { kind: 'item', code: 'DUP' }).expect(409);
    await post('scan/wms', { kind: 'bin', code: 'A-01' }).expect(409);
    const result = await post('scan/wms', { kind: 'bin', code: 'A-01', locationId: site }).expect(
      201,
    );
    expect(result.body.id).toBe(bin);
    await post('scan/wms', { kind: 'bin', code: 'A-01', locationId: 'foreign-site' }).expect(404);
  });
  it('enforces authentication, read permission, module activation and kind boundary', async () => {
    await request(http).post('/api/v1/scan/wms').send({ kind: 'item', code: '001234' }).expect(401);
    await post('scan/wms', { kind: 'item', code: '001234' }, none).expect(403);
    await post('scan/wms', { kind: 'item', code: '001234' }, reader).expect(201);
    await post('scan/wms', { kind: 'load', code: 'LD-1' }).expect(400);
    await post('scan/wms', { kind: 'item', code: '001234', tenantId: foreign }).expect(400);
    await db.tenantModule.updateMany({ where: { tenantId: tid }, data: { enabled: false } });
    app.get(TenantModulesCacheService).invalidate(tid);
    try {
      await post('scan/wms', { kind: 'item', code: '001234' }).expect(403);
    } finally {
      await db.tenantModule.updateMany({ where: { tenantId: tid }, data: { enabled: true } });
      app.get(TenantModulesCacheService).invalidate(tid);
    }
  });
  it('validates input before lookup and leaves the stock ledger untouched', async () => {
    await post('scan/wms', { kind: 'item', code: 'a'.repeat(129) }).expect(400);
    await post('scan/wms', { kind: 'item', code: '01\x1d23' }).expect(400);
    expect(await db.stockMovement.count({ where: { tenantId: tid } })).toBe(0);
  });
  it('stores independent module progress atomically and only for the authenticated user', async () => {
    const results = await Promise.all([
      ...['wms', 'manufacturing', 'catalog', 'support'].map((moduleKey) =>
        prefs({ moduleTour: { moduleKey, version: 1, step: 2, status: 'IN_PROGRESS' } }),
      ),
      prefs({ appearance: { theme: 'dark' } }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const result = await prefs().expect(200);
    expect(result.body.moduleTours).toMatchObject({
      wms: { step: 2 },
      manufacturing: { step: 2 },
      catalog: { step: 2 },
      support: { step: 2 },
    });
    expect(result.body.appearance.theme).toBe('dark');
    expect((await prefs(undefined, reader).expect(200)).body.moduleTours).toEqual({});
    await prefs({
      moduleTour: { moduleKey: 'wms', version: 1, step: 4, status: 'COMPLETED' },
    }).expect(200);
    await prefs({ appearance: { theme: 'dark' } }).expect(200);
    expect((await prefs().expect(200)).body.moduleTours.wms.status).toBe('COMPLETED');
    await prefs({
      moduleTour: { moduleKey: 'unknown', version: 1, step: 0, status: 'SKIPPED' },
    }).expect(400);
    await prefs({
      userId: 'other',
      moduleTour: { moduleKey: 'wms', version: 1, step: 0, status: 'SKIPPED' },
    }).expect(400);
  });
  it('records explicit counts with version checks, rejects wrong lines, and never posts stock until reconciliation', async () => {
    const cc = await db.cycleCount.create({
      data: {
        tenantId: tid,
        binId: bin,
        number: 'CC-SCAN',
        lines: { create: { tenantId: tid, itemId: item, systemQty: 3 } },
      },
      include: { lines: true },
    });
    const path = `wms/cycle-counts/${cc.id}/counts`;
    const line = { lineId: cc.lines[0].id, countedQty: 2 };
    await post(path, { counts: [{ ...line, lineId: 'foreign' }] }).expect(400);
    await post(path, { counts: [line, line] }).expect(400);
    await post(path, { counts: [{ ...line, countedQty: 0.0001 }] }).expect(400);
    await post(path, { counts: [line], expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }).expect(409);
    expect(
      (await db.cycleCountLine.findUniqueOrThrow({ where: { id: line.lineId } })).countedQty,
    ).toBeNull();
    await post(path, { counts: [line] }, reader).expect(403);
    const results = await Promise.all(
      [1, 2].map(() =>
        post(path, { counts: [line], expectedUpdatedAt: cc.updatedAt.toISOString() }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => [400, 409].includes(r.status))).toHaveLength(1);
    expect(await db.stockMovement.count({ where: { tenantId: tid } })).toBe(0);
  });
});
