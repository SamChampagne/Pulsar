process.env.APS_AUTOSTART = 'false';
import { randomUUID } from 'node:crypto';
import { INestApplication, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApsClient } from '../src/core/aps/aps.client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { InventoryService } from '../src/modules/wms/inventory/inventory.service';
import { ReceivingService } from '../src/modules/wms/receiving/receiving.service';
import { AgentsService } from '../src/core/agents/agents.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { AgentWorkerService } from '../src/core/operating/agent-worker.service';
import { DomainEventsService } from '../src/core/operating/domain-events.service';
import { AGENT_ROLE_PRESETS } from '@pulsar/shared';
import { ModuleSettingsService } from '../src/core/module-registry/module-settings.service';
import { StockMovementType, type MrpSnapshot } from '@pulsar/shared';

describe('MRP planning (HTTP + PostgreSQL, no stock side effects)', () => {
  let app: INestApplication, db: PrismaService, http: any;
  let tenantId: string, userId: string, token: string, other: string, reader: string, noWms: string;
  let siteId: string,
    otherSiteId: string,
    itemId: string,
    componentId: string,
    binId: string,
    bomId: string,
    runId: string;
  let demand: any;
  let revisionId: string;
  let forecast: any, salesDemand: any, salesOrder: any, salesLine: any, crmRun: any;
  let workerId: string, workerToken: string, workerProposal: any;
  let workerCalls = 0;
  let withExceptions = false;
  const runtime = {
    openSession: jest.fn(async (input: any) => {
      if (input.agent.id !== workerId)
        throw new ServiceUnavailableException('Test runtime restricted to fixture worker');
      workerToken = app
        .get(AgentsService)
        .mintSessionToken(input.agent.id, 300, input.triggeredByRef);
      return input.triggeredByRef;
    }),
    sendTurn: async function* (session: string) {
      const taskId = session.slice(5);
      const task = await db.operationalTask.findFirstOrThrow({ where: { tenantId, id: taskId } });
      const brief = await mcp('get_mrp_run', { runId: task.subjectId });
      expect(brief.id).toBe(task.subjectId);
      workerProposal = await mcp('submit_mrp_review', {
        runId: task.subjectId,
        taskId,
        summary: 'Revue de test : vérifier les besoins référencés avant toute décision.',
        itemIds: [itemId],
      });
      workerCalls++;
      yield {
        type: 'result' as const,
        result: { version: 1 as const, status: 'succeeded' as const },
      };
      yield { type: 'end' as const };
    },
    closeSession: jest.fn(async () => undefined),
    killAgentSessions: jest.fn(async () => 0),
  };
  async function mcp(name: string, args: unknown, key = workerToken) {
    const response = await request(http)
      .post('/api/v1/mcp')
      .set('X-Agent-Key', key)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/call',
        params: { name, arguments: args },
      })
      .expect(200);
    const envelope = response.body?.result
      ? response.body
      : response.text
          .split(/\r?\n/)
          .filter((line: string) => line.startsWith('data:'))
          .map((line: string) => JSON.parse(line.slice(5)))
          .find((value: any) => value.result || value.error);
    if (!envelope?.result?.content) throw new Error(JSON.stringify(envelope));
    return JSON.parse(envelope.result.content[0].text);
  }
  const approve = (id: string) =>
    request(http)
      .post(`/api/v1/agent-actions/${id}/approve`)
      .set('Authorization', `Bearer ${token}`);
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const real =
    process.env.PULSAR_TEST_REAL_APS === 'true'
      ? new ApsClient(new ConfigService(process.env))
      : null;
  const engine = {
    health: jest.fn(async () => ({ status: 'ok' })),
    calculateMrp: jest.fn(async (tenant: string, snapshot: MrpSnapshot) =>
      real
        ? real.calculateMrp(tenant, snapshot)
        : {
            tenant_id: tenant,
            version: 'pulsar.mrp.v1',
            engine_revision: 'planiadvance-d26a8cd.pulsar-mrp1',
            as_of: snapshot.as_of,
            horizon_end: snapshot.horizon_end,
            proposals: [],
            exceptions: withExceptions
              ? [
                  {
                    code: 'LATE_RELEASE',
                    item_id: itemId,
                    source: 'fixture',
                    date: snapshot.as_of,
                    quantity: '10',
                  },
                ]
              : [],
            assumptions: [],
            items: snapshot.items.map((i) => ({
              item_id: i.id,
              sku: i.sku,
              name: i.name,
              unit: i.unit,
              method: i.method,
              level: 0,
              on_hand: i.on_hand,
              gross_requirement: '0',
              planned_receipts: '0',
              projected_end: i.on_hand,
              timeline: [],
            })),
          },
    ),
  };
  const call = (method: 'get' | 'post' | 'put', path: string, body?: unknown, auth = token) => {
    const req = request(http)
      [method](`/api/v1/manufacturing/mrp/${path}`)
      .set('Authorization', `Bearer ${auth}`);
    return body ? req.send(body) : req;
  };
  const policy = (item = itemId) => ({
    locationId: siteId,
    itemId: item,
    method: 'BUY',
    leadDays: 2,
    safetyStock: '0',
    minimumOrder: '0',
    orderMultiple: '1',
    acknowledgeUnits: true,
  });
  const entry = (kind = 'DEMAND') => ({
    locationId: siteId,
    itemId,
    kind,
    quantity: '10',
    dueDate: future,
    reference: 'Customer order',
    isActive: true,
  });
  const calculate = () => call('post', 'runs', { locationId: siteId, horizonEnd: future });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ApsClient)
      .useValue(engine)
      .overrideProvider(AgentRuntimeService)
      .useValue(runtime)
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    http = app.getHttpServer();
    db = app.get(PrismaService);
    for (const name of ['main', 'other']) {
      const slug = `mrp-${name}-${randomUUID()}`;
      const tenant = await db.tenant.create({ data: { slug, name: slug } });
      const modules = await db.moduleDefinition.findMany({
        where: { key: { in: ['manufacturing', 'wms', 'crm'] } },
      });
      for (const module of modules)
        await db.tenantModule.create({
          data: { tenantId: tenant.id, moduleId: module.id, enabled: true },
        });
      for (const mode of name === 'main' ? ['manager', 'reader', 'no-wms'] : ['manager']) {
        const keys = [
          'manufacturing.read',
          ...(mode === 'reader' ? [] : ['manufacturing.manage']),
          ...(mode === 'no-wms' ? [] : ['wms.read']),
          ...(mode === 'manager' ? ['wms.manage'] : []),
          ...(mode === 'manager' ? ['crm.read', 'crm.manage'] : []),
          ...(mode === 'manager'
            ? [
                'core.operating.tasks.read',
                'core.operating.tasks.manage',
                'core.agents.read',
                'core.agents.manage',
                'core.agents.actions.read',
                'core.agents.actions.approve',
              ]
            : []),
        ];
        const perms = await db.permission.findMany({ where: { key: { in: keys } } });
        expect(perms).toHaveLength(keys.length);
        const role = await db.role.create({
          data: {
            tenantId: tenant.id,
            key: mode,
            name: mode,
            permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
          },
        });
        const email = `${mode}@${slug}.test`;
        const user = await db.user.create({
          data: {
            tenantId: tenant.id,
            email,
            firstName: 'MRP',
            lastName: mode,
            status: 'ACTIVE',
            passwordHash: hashSync('Test1234!', 4),
            roles: { create: { roleId: role.id } },
          },
        });
        const auth = await request(http)
          .post('/api/v1/auth/login')
          .send({ tenant: slug, email, password: 'Test1234!' })
          .expect(200);
        if (name === 'other') other = auth.body.accessToken;
        else if (mode === 'reader') reader = auth.body.accessToken;
        else if (mode === 'no-wms') noWms = auth.body.accessToken;
        else {
          token = auth.body.accessToken;
          tenantId = tenant.id;
          userId = user.id;
        }
      }
    }
    const site = (code: string) =>
      db.location.create({
        data: {
          tenantId,
          code,
          name: code,
          type: 'WAREHOUSE',
          addressLine1: '1 Test',
          city: 'Test',
        },
      });
    siteId = (await site('SITE-A')).id;
    otherSiteId = (await site('SITE-B')).id;
    itemId = (
      await db.wmsItem.create({ data: { tenantId, sku: 'FG', name: 'Finished good', unit: 'EA' } })
    ).id;
    componentId = (
      await db.wmsItem.create({ data: { tenantId, sku: 'RAW', name: 'Material', unit: 'KG' } })
    ).id;
    binId = (await db.bin.create({ data: { tenantId, locationId: siteId, code: 'A' } })).id;
    const otherBin = await db.bin.create({
      data: { tenantId, locationId: otherSiteId, code: 'B' },
    });
    for (const [bin, qty] of [
      [binId, 2],
      [otherBin.id, 100],
    ] as const) {
      await db.$transaction((tx) =>
        app.get(InventoryService).postMovement(tx, {
          tenantId,
          userId,
          itemId,
          toBinId: bin,
          qty,
          type: StockMovementType.RECEIPT,
        }),
      );
    }
    bomId = (
      await db.bom.create({
        data: {
          tenantId,
          code: 'BOM-FG',
          name: 'FG',
          productRef: 'FG',
          lines: { create: { tenantId, materialRef: 'RAW', quantityPerUnit: 0.5 } },
        },
      })
    ).id;
    const bom = await db.bom.findFirstOrThrow({ where: { tenantId, id: bomId } });
    revisionId = (
      await request(http)
        .post(`/api/v1/manufacturing/boms/${bomId}/revisions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ expectedUpdatedAt: bom.updatedAt.toISOString(), acknowledgeUnits: true })
        .expect(201)
    ).body.id;
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it('gates both module permissions and tenant ownership', async () => {
    await call('get', 'options', undefined, noWms).expect(403);
    await call('put', 'policies', policy(), reader).expect(403);
    await call('put', 'policies', policy(), other).expect(400);
    await call('get', `workspace?locationId=${siteId}`, undefined, other).expect(400);
    await call('post', 'entries', { ...entry(), tenantId }).expect(400);
  });
  it('validates units, quantities and method/BOM pairing', async () => {
    await call('put', 'policies', { ...policy(), acknowledgeUnits: false }).expect(400);
    await call('put', 'policies', { ...policy(), method: 'MAKE' }).expect(400);
    await call('put', 'policies', { ...policy(), bomId }).expect(400);
    await call('put', 'policies', { ...policy(), orderMultiple: '0' }).expect(400);
    await call('post', 'entries', { ...entry(), quantity: '0.0001' }).expect(400);
    await call('post', 'entries', { ...entry(), dueDate: '2026-02-30' }).expect(400);
  });
  it('creates a policy and prevents lost updates with a version', async () => {
    const p = (await call('put', 'policies', policy()).expect(200)).body;
    await call('put', 'policies', policy()).expect(409);
    const results = await Promise.all(
      [1, 2].map((leadDays) =>
        call('put', 'policies', { ...policy(), leadDays, expectedUpdatedAt: p.updatedAt }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    await call('put', 'policies', policy(componentId)).expect(200);
  });
  it('creates a demand; reads current stock at only the chosen site', async () => {
    demand = (await call('post', 'entries', entry()).expect(201)).body;
    const run = (await calculate().expect(201)).body;
    runId = run.id;
    expect(run.stale).toBe(false);
    expect(run.inputSnapshot.items.find((i: any) => i.id === itemId).on_hand).toBe('2');
    expect(run.inputSnapshot.demands[0].quantity).toBe('10');
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(2);
    if (real) expect(run.result.proposals[0].quantity).toBe('8');
  });
  it('persists immutable tenant-scoped runs and exposes stale calculations', async () => {
    await call('get', `runs/${runId}`, undefined, other).expect(404);
    await call('get', `runs/${runId}`, undefined, reader).expect(200);
    await call('put', `entries/${demand.id}`, { ...entry(), quantity: '11' }).expect(409);
    await call('put', `entries/${demand.id}`, {
      ...entry(),
      quantity: '11',
      expectedUpdatedAt: demand.updatedAt,
    }).expect(200);
    const historical = (await call('get', `runs/${runId}`).expect(200)).body;
    expect(historical.stale).toBe(true);
    expect(historical.inputSnapshot.demands[0].quantity).toBe('10');
  });
  it('rejects a MAKE BOM with an unconfigured component and handles multi-level mapping', async () => {
    const p = (await call('get', `workspace?locationId=${siteId}`).expect(200)).body.policies.find(
      (p: any) => p.itemId === itemId,
    );
    await call('put', 'policies', {
      ...policy(),
      method: 'MAKE',
      bomId,
      bomRevisionId: revisionId,
      expectedUpdatedAt: p.updatedAt,
    }).expect(200);
    await db.bomLine.updateMany({ where: { tenantId, bomId }, data: { materialRef: 'MISSING' } });
    // A working-draft edit must not alter a pinned published revision.
    await calculate().expect(201);
    await db.mrpItemPolicy.deleteMany({
      where: { tenantId, locationId: siteId, itemId: componentId },
    });
    await calculate().expect(400);
    await call('put', 'policies', policy(componentId)).expect(200);
    await db.bomLine.updateMany({ where: { tenantId, bomId }, data: { materialRef: 'RAW' } });
    const run = (await calculate().expect(201)).body;
    expect(run.inputSnapshot.items.find((i: any) => i.id === itemId).components).toEqual([
      { item_id: componentId, quantity: '0.5' },
    ]);
    if (real)
      expect(run.result.proposals.find((p: any) => p.item_id === componentId).quantity).toBe('5');
  });
  it('does not double count a posted linked WMS receipt', async () => {
    const receiving = app.get(ReceivingService);
    const receipt = await receiving.create(tenantId, userId, { locationId: siteId });
    await receiving.addLine(tenantId, receipt.id, { itemId, toBinId: binId, qty: 3 });
    await call('post', 'entries', {
      ...entry('SUPPLY'),
      quantity: '3',
      receiptId: receipt.id,
      dueDate: today,
    }).expect(201);
    await call('post', 'entries', { ...entry('SUPPLY'), receiptId: receipt.id }).expect(409);
    const before = (await calculate().expect(201)).body;
    expect(before.inputSnapshot.supplies[0].quantity).toBe('3');
    await receiving.post(tenantId, userId, receipt.id);
    const after = (await calculate().expect(201)).body;
    expect(after.inputSnapshot.supplies).toHaveLength(0);
    expect(after.inputSnapshot.items.find((i: any) => i.id === itemId).on_hand).toBe('5');
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(3);
  });
  it('detects changed item units instead of silently converting', async () => {
    await db.wmsItem.updateMany({ where: { id: componentId, tenantId }, data: { unit: 'LB' } });
    await calculate().expect(400);
    await db.wmsItem.updateMany({ where: { id: componentId, tenantId }, data: { unit: 'KG' } });
  });
  it('does not persist an engine failure or wrong-tenant result', async () => {
    const count = await db.mrpRun.count({ where: { tenantId } });
    engine.calculateMrp.mockRejectedValueOnce(new ServiceUnavailableException('Sidecar offline'));
    await calculate().expect(503);
    engine.calculateMrp.mockResolvedValueOnce({
      tenant_id: 'other',
      version: 'pulsar.mrp.v1',
    } as any);
    await calculate().expect(503);
    expect(await db.mrpRun.count({ where: { tenantId } })).toBe(count);
  });
  it('publishes immutable decimal revisions, idempotently, with scoped reads and versioned drafts', async () => {
    const path = `/api/v1/manufacturing/boms/${bomId}`;
    const auth = { Authorization: `Bearer ${token}` };
    const bom = (await request(http).get(path).set(auth).expect(200)).body;
    const payload = { expectedUpdatedAt: bom.updatedAt, acknowledgeUnits: true };
    const repeated = await Promise.all(
      [1, 2].map(() => request(http).post(`${path}/revisions`).set(auth).send(payload).expect(201)),
    );
    expect(repeated[0].body.id).toBe(revisionId);
    expect(repeated[1].body.id).toBe(revisionId);
    await request(http)
      .post(`${path}/revisions`)
      .set('Authorization', `Bearer ${noWms}`)
      .send(payload)
      .expect(403);
    await request(http)
      .get(`${path}/revisions/${revisionId}`)
      .set('Authorization', `Bearer ${other}`)
      .expect(404);
    await request(http)
      .patch(`${path}/lines/${bom.lines[0].id}`)
      .set(auth)
      .send({ quantityPerUnit: '0.123456789', expectedUpdatedAt: bom.updatedAt })
      .expect(200);
    await request(http)
      .patch(path)
      .set(auth)
      .send({ name: 'Lost update', expectedUpdatedAt: bom.updatedAt })
      .expect(409);
    const fresh = (await request(http).get(path).set(auth)).body;
    const published = (
      await request(http)
        .post(`${path}/revisions`)
        .set(auth)
        .send({ ...payload, expectedUpdatedAt: fresh.updatedAt })
        .expect(201)
    ).body;
    expect(published.revision).toBe(2);
    expect(published.lines[0].quantityPerUnit).toBe('0.123456789');
    const original = (
      await request(http).get(`${path}/revisions/${revisionId}`).set(auth).expect(200)
    ).body;
    expect(original.lines[0].quantityPerUnit).toBe('0.5');
    const run = (await calculate().expect(201)).body;
    expect(run.inputSnapshot.items.find((i: any) => i.id === itemId).components[0].quantity).toBe(
      '0.5',
    );
    expect(run.sourceMetadata.bomRevisions[0].revisionId).toBe(revisionId);
    await request(http)
      .delete(`${path}?expectedUpdatedAt=${encodeURIComponent(fresh.updatedAt)}`)
      .set(auth)
      .expect(409);
  });
  it('freezes used WMS SKU and unit without forbidding ordinary descriptive edits', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    await request(http)
      .patch(`/api/v1/wms/items/${componentId}`)
      .set(auth)
      .send({ unit: 'LB' })
      .expect(409);
    await request(http)
      .patch(`/api/v1/wms/items/${componentId}`)
      .set(auth)
      .send({ sku: 'NEW-RAW' })
      .expect(409);
    await request(http)
      .patch(`/api/v1/wms/items/${componentId}`)
      .set(auth)
      .send({ name: 'Renamed material' })
      .expect(200);
  });
  it('binds a draft OF to a site and revision, captures exact requirements at release, and prevents drift', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const root = '/api/v1/manufacturing/orders';
    const order = (
      await request(http)
        .post(root)
        .set(auth)
        .send({
          name: 'Versioned OF',
          productRef: 'FG',
          quantity: 3,
          dueDate: future,
          releaseDate: today,
          bomId,
        })
        .expect(201)
    ).body;
    const path = `${root}/${order.id}`;
    await request(http).post(`${path}/release`).set(auth).expect(400);
    const body = {
      locationId: siteId,
      bomRevisionId: revisionId,
      expectedUpdatedAt: order.updatedAt,
    };
    await request(http)
      .post(`${path}/material-context`)
      .set('Authorization', `Bearer ${noWms}`)
      .send(body)
      .expect(403);
    await request(http)
      .post(`${path}/material-context`)
      .set(auth)
      .send({ ...body, locationId: 'missing' })
      .expect(400);
    await request(http).post(`${path}/material-context`).set(auth).send(body).expect(201);
    await request(http).post(`${path}/material-context`).set(auth).send(body).expect(409);
    const released = (await request(http).post(`${path}/release`).set(auth).expect(201)).body;
    expect(released.materialSnapshot.product.quantity).toBe('3');
    expect(released.materialSnapshot.components[0].requiredQuantity).toBe('1.5');
    expect(released.materialSnapshot.locationId).toBe(siteId);
    expect(released.materialSnapshot.revision).toBe(1);
    await request(http).patch(path).set(auth).send({ quantity: 4 }).expect(409);
    await request(http).patch(path).set(auth).send({ productRef: 'RAW' }).expect(409);
    await request(http)
      .post(`${path}/material-context`)
      .set(auth)
      .send({ ...body, expectedUpdatedAt: released.updatedAt })
      .expect(409);
    await request(http).patch(path).set(auth).send({ name: 'Safe rename' }).expect(200);
    const current = (await request(http).get(path).set(auth).expect(200)).body;
    expect(current.materialSnapshot).toEqual(released.materialSnapshot);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(3);
    const legacy = await db.manufacturingOrder.create({
      data: {
        tenantId,
        number: `legacy-${randomUUID()}`,
        name: 'Historical',
        productRef: 'FG',
        quantity: 1,
        dueDate: new Date(future),
        releaseDate: new Date(today),
        status: 'RELEASED',
        bomId,
      },
    });
    expect(
      (await request(http).get(`${root}/${legacy.id}`).set(auth).expect(200)).body.materialSnapshot,
    ).toBeNull();
  });
  const createSalesOrder = async (quantity = 30, productId?: string) => {
    const company = await db.crmCompany.create({
      data: { tenantId, name: `MRP customer ${randomUUID()}` },
    });
    const auth = { Authorization: `Bearer ${token}` };
    const order = (
      await request(http)
        .post('/api/v1/crm/sales-orders')
        .set(auth)
        .send({ companyId: company.id })
        .expect(201)
    ).body;
    const line = (
      await request(http)
        .post(`/api/v1/crm/sales-orders/${order.id}/line-items`)
        .set(auth)
        .send({ name: 'Finished assemblies', quantity, ...(productId ? { productId } : {}) })
        .expect(201)
    ).body;
    const confirmed = (
      await request(http).post(`/api/v1/crm/sales-orders/${order.id}/confirm`).set(auth).expect(200)
    ).body;
    return { order: confirmed, line };
  };
  const salesBody = (line = salesLine, order = salesOrder) => ({
    locationId: siteId,
    itemId,
    sourceSalesOrderLineId: line.id,
    dueDate: future,
    forecastId: forecast.id,
    acknowledgeUnits: true,
    isActive: true,
    expectedSourceUpdatedAt: line.updatedAt,
    expectedOrderUpdatedAt: order.updatedAt,
  });

  it('validates forecast periods and explicit firm-demand consumption', async () => {
    await call('post', 'entries', {
      ...entry('FORECAST'),
      forecastStart: future,
      dueDate: today,
    }).expect(400);
    await call('post', 'entries', entry('FORECAST')).expect(400);
    forecast = (
      await call('post', 'entries', {
        ...entry('FORECAST'),
        quantity: '100',
        forecastStart: today,
        reference: 'Monthly forecast',
      }).expect(201)
    ).body;
    await call('post', 'entries', {
      ...entry(),
      itemId: componentId,
      forecastId: forecast.id,
    }).expect(400);
    await call('put', `entries/${forecast.id}`, {
      ...entry(),
      expectedUpdatedAt: forecast.updatedAt,
    }).expect(400);
    await call('post', 'entries', { ...entry(), forecastId: 'foreign' }).expect(400);
  });
  it('imports a confirmed sales line once with authoritative quantity and explicit units', async () => {
    ({ order: salesOrder, line: salesLine } = await createSalesOrder());
    await call('get', 'sales-sources', undefined, reader).expect(403);
    const sources = (
      await call('get', `sales-sources?salesOrderId=${salesOrder.id}&pageSize=10`).expect(200)
    ).body;
    expect(sources.items[0].quantity).toBe('30');
    expect(sources.items[0]).not.toHaveProperty('unitPrice');
    await call('post', 'sales-demands', { ...salesBody(), quantity: '1' }).expect(400);
    await call('post', 'sales-demands', { ...salesBody(), acknowledgeUnits: false }).expect(400);
    await call('post', 'sales-demands', salesBody(), other).expect(400);
    await call('post', 'sales-demands', {
      ...salesBody(),
      expectedOrderUpdatedAt: '2000-01-01T00:00:00Z',
    }).expect(409);
    const [a, b] = await Promise.all([
      call('post', 'sales-demands', salesBody()).expect(201),
      call('post', 'sales-demands', salesBody()).expect(201),
    ]);
    expect(a.body.id).toBe(b.body.id);
    salesDemand = a.body;
    expect(salesDemand.quantity).toBe('30');
    expect(salesDemand.unitSnapshot).toBe('EA');
    await call('post', 'sales-demands', { ...salesBody(), locationId: otherSiteId }).expect(409);
    await call('put', `entries/${salesDemand.id}`, {
      ...entry(),
      quantity: '1',
      expectedUpdatedAt: salesDemand.updatedAt,
    }).expect(409);
    expect(
      await db.mrpEntry.count({ where: { tenantId, sourceSalesOrderLineId: salesLine.id } }),
    ).toBe(1);
    crmRun = (await calculate().expect(201)).body;
    expect(crmRun.inputSnapshot.demands.find((d: any) => d.id === forecast.id).quantity).toBe('70');
    expect(crmRun.inputSnapshot.demands.find((d: any) => d.id === salesDemand.id).quantity).toBe(
      '30',
    );
    expect(crmRun.sourceMetadata.forecastCoverage[0].consumed).toBe('30');
    expect(crmRun.sourceMetadata.salesDemands[0].salesOrderId).toBe(salesOrder.id);
  });
  it('gates CRM-derived workspace and history, and freezes the confirmed source', async () => {
    await call('get', `workspace?locationId=${siteId}`, undefined, reader).expect(403);
    await call('get', `runs/${crmRun.id}`, undefined, reader).expect(403);
    await request(http)
      .patch(`/api/v1/crm/sales-orders/${salesOrder.id}/line-items/${salesLine.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 99 })
      .expect(409);
    await call('put', `entries/${forecast.id}`, {
      ...entry('FORECAST'),
      quantity: '100',
      forecastStart: today,
      dueDate: today,
      reference: 'Monthly forecast',
      expectedUpdatedAt: forecast.updatedAt,
    }).expect(409);
    const module = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'crm' } });
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: module.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await calculate().expect(403);
    await call('get', `runs/${crmRun.id}`).expect(403);
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: module.id },
      data: { enabled: true },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
  });
  it('versions demand edits and makes disabling consumption explicit', async () => {
    await call('put', `sales-demands/${salesDemand.id}`, {
      ...salesBody(),
      expectedUpdatedAt: '2000-01-01T00:00:00Z',
    }).expect(409);
    const disabled = (
      await call('put', `sales-demands/${salesDemand.id}`, {
        ...salesBody(),
        isActive: false,
        expectedUpdatedAt: salesDemand.updatedAt,
      }).expect(200)
    ).body;
    expect((await calculate().expect(201)).body.sourceMetadata.forecastCoverage[0].remaining).toBe(
      '100',
    );
    salesDemand = (
      await call('put', `sales-demands/${salesDemand.id}`, {
        ...salesBody(),
        expectedUpdatedAt: disabled.updatedAt,
      }).expect(200)
    ).body;
    expect((await calculate().expect(201)).body.sourceMetadata.forecastCoverage[0].remaining).toBe(
      '70',
    );
  });
  it('keeps fulfilled demand consumed, restores cancelled demand and marks old runs stale', async () => {
    await request(http)
      .post(`/api/v1/crm/sales-orders/${salesOrder.id}/fulfill`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const after = (await calculate().expect(201)).body;
    expect(after.inputSnapshot.demands.some((d: any) => d.id === salesDemand.id)).toBe(false);
    expect(after.inputSnapshot.demands.find((d: any) => d.id === forecast.id).quantity).toBe('70');
    const second = await createSalesOrder(20);
    await call('post', 'sales-demands', salesBody(second.line, second.order)).expect(201);
    expect((await calculate().expect(201)).body.sourceMetadata.forecastCoverage[0].remaining).toBe(
      '50',
    );
    await request(http)
      .post(`/api/v1/crm/sales-orders/${second.order.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((await calculate().expect(201)).body.sourceMetadata.forecastCoverage[0].remaining).toBe(
      '70',
    );
    const historical = (await call('get', `runs/${crmRun.id}`).expect(200)).body;
    expect(historical.stale).toBe(true);
    expect(historical.sourceMetadata.forecastCoverage[0].remaining).toBe('70');
    expect(
      historical.inputSnapshot.demands.find((d: any) => d.id === salesDemand.id).quantity,
    ).toBe('30');
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(3);
  });
  it('serializes CRM confirmation with line editing and refuses all confirmed line writers', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const company = await db.crmCompany.create({
      data: { tenantId, name: 'MRP concurrency fixture' },
    });
    const order = (
      await request(http)
        .post('/api/v1/crm/sales-orders')
        .set(auth)
        .send({ companyId: company.id })
        .expect(201)
    ).body;
    const linesUrl = `/api/v1/crm/sales-orders/${order.id}/line-items`;
    const line = (
      await request(http)
        .post(linesUrl)
        .set(auth)
        .send({ name: 'Immutable quantity', quantity: 1 })
        .expect(201)
    ).body;
    const [edited, confirmed] = await Promise.all([
      request(http).patch(`${linesUrl}/${line.id}`).set(auth).send({ quantity: 2 }),
      request(http).post(`/api/v1/crm/sales-orders/${order.id}/confirm`).set(auth),
    ]);
    expect([200, 409]).toContain(edited.status);
    expect(confirmed.status).toBe(200);
    const final = await db.salesOrderLineItem.findFirstOrThrow({
      where: { tenantId, id: line.id },
    });
    expect(final.quantity.toFixed()).toBe(confirmed.body.lineItems[0].quantity);
    await request(http)
      .post(linesUrl)
      .set(auth)
      .send({ name: 'Late line', quantity: 1 })
      .expect(409);
    await request(http).delete(`${linesUrl}/${line.id}`).set(auth).expect(409);
  });
  it('captures exact product ratios and never rewrites existing demand after a mapping edit', async () => {
    const product = await db.crmProduct.create({
      data: { tenantId, name: 'Box of finished assemblies', unitPrice: 12 },
    });
    const mappingBody = {
      productId: product.id,
      itemId,
      commercialUnit: 'boîte',
      numerator: '12',
      denominator: '1',
      isActive: true,
      acknowledgeUnits: true,
    };
    await call('put', 'product-mappings', mappingBody, reader).expect(403);
    await call('put', 'product-mappings', mappingBody, other).expect(400);
    await call('put', 'product-mappings', { ...mappingBody, denominator: '0' }).expect(400);
    const mapping = (await call('put', 'product-mappings', mappingBody).expect(200)).body;
    const source = await createSalesOrder(2.5, product.id);
    const body = {
      ...salesBody(source.line, source.order),
      mappingId: mapping.id,
      expectedMappingUpdatedAt: mapping.updatedAt,
    };
    await call('post', 'sales-demands', {
      ...body,
      expectedMappingUpdatedAt: '2000-01-01T00:00:00Z',
    }).expect(409);
    const linked = (await call('post', 'sales-demands', body).expect(201)).body;
    expect(linked.quantity).toBe('30');
    expect(linked.sourceSnapshot).toMatchObject({
      quantity: '2.5',
      convertedQuantity: '30',
      mapping: { numerator: '12', denominator: '1' },
    });
    await call('put', 'product-mappings', {
      ...mappingBody,
      numerator: '24',
      expectedUpdatedAt: mapping.updatedAt,
    }).expect(200);
    await call('put', 'product-mappings', {
      ...mappingBody,
      expectedUpdatedAt: mapping.updatedAt,
    }).expect(409);
    const replay = (await call('post', 'sales-demands', body).expect(201)).body;
    expect(replay.id).toBe(linked.id);
    expect(replay.quantity).toBe('30');
    const changedDate = (
      await call('put', `sales-demands/${linked.id}`, {
        ...body,
        expectedUpdatedAt: linked.updatedAt,
      }).expect(200)
    ).body;
    expect(changedDate.quantity).toBe('30');
    const run = (await calculate().expect(201)).body;
    expect(run.inputSnapshot.demands.find((d: any) => d.id === linked.id).quantity).toBe('30');
    expect(run.sourceMetadata.forecastCoverage[0].remaining).toBe('40');
    const current = (await call('get', `product-mappings?productId=${product.id}`).expect(200)).body
      .items[0];
    const third = await createSalesOrder(1, product.id);
    const fractional = (
      await call('put', 'product-mappings', {
        ...mappingBody,
        numerator: '1',
        denominator: '3',
        expectedUpdatedAt: current.updatedAt,
      }).expect(200)
    ).body;
    await call('post', 'sales-demands', {
      ...salesBody(third.line, third.order),
      mappingId: mapping.id,
      expectedMappingUpdatedAt: fractional.updatedAt,
    }).expect(400);
    const unrelated = await createSalesOrder(1);
    await call('post', 'sales-demands', {
      ...salesBody(unrelated.line, unrelated.order),
      mappingId: mapping.id,
      expectedMappingUpdatedAt: fractional.updatedAt,
    }).expect(400);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(3);
  });
  it('dispatches an MRP review through the real task worker and MCP, then waits for human approval', async () => {
    const preset = AGENT_ROLE_PRESETS.find((p) => p.id === 'mrp-analyst')!;
    const caps = {
      alwaysOn: true,
      handlesCategories: ['MRP_REVIEW'],
      toolAllowlist: preset.suggestedToolAllowlist,
      maxActionsPerHour: 50,
    };
    const agent = (
      await request(http)
        .post('/api/v1/agents')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'MRP worker fixture',
          permissions: preset.suggestedPermissions,
          persona: preset.persona,
          autonomyLevel: 'PROPOSE',
          caps,
        })
        .expect(201)
    ).body;
    workerId = agent.id;
    const run = (await calculate().expect(201)).body;
    expect(
      await db.domainEvent.count({
        where: { tenantId, subjectId: run.id, type: 'manufacturing.mrp.review-requested' },
      }),
    ).toBe(0);
    await call('post', `runs/${run.id}/request-review`, {}, reader).expect(403);
    await call('post', `runs/${run.id}/request-review`, {}, other).expect(404);
    await call('post', `runs/${run.id}/request-review`, {}).expect(201);
    await call('post', `runs/${run.id}/request-review`, {}).expect(201);
    expect(
      await db.domainEvent.count({
        where: { tenantId, subjectId: run.id, type: 'manufacturing.mrp.review-requested' },
      }),
    ).toBe(1);
    for (let i = 0; i < 30; i++) {
      await app.get(DomainEventsService).processPending(100);
      if (await db.operationalTask.count({ where: { tenantId, dedupKey: `MRP_REVIEW:${run.id}` } }))
        break;
    }
    for (let i = 0; i < 100 && !workerCalls; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(workerCalls).toBe(1);
    expect(workerProposal).toMatchObject({ queued: true, status: 'PENDING' });
    expect(await db.mrpReview.count({ where: { tenantId, runId: run.id } })).toBe(0);
    const state = (await call('get', `runs/${run.id}/assistance`).expect(200)).body;
    expect(state.task.assigneeAgentId).toBe(workerId);
    expect(state.task.status).toBe('IN_PROGRESS');
    expect(state.workers[0]).not.toHaveProperty('permissions');
    const task = await db.operationalTask.findFirstOrThrow({
      where: { tenantId, id: state.task.id },
    });
    expect(task.details).toEqual({ runId: run.id, requiresCrm: true });
    const proposal = await db.proposedAction.findFirstOrThrow({
      where: {
        tenantId,
        agentId: workerId,
        tool: 'submit_mrp_review',
        triggeredByRef: `task:${task.id}`,
      },
    });
    const [a, b] = await Promise.all([approve(proposal.id), approve(proposal.id)]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect([a, b].find((r) => r.status === 201)?.body.status).toBe('EXECUTED');
    const review = await db.mrpReview.findFirstOrThrow({ where: { tenantId, runId: run.id } });
    expect(review.taskId).toBe(task.id);
    expect(await db.mrpReview.count({ where: { tenantId, runId: run.id } })).toBe(1);
    expect((await call('get', `runs/${run.id}/assistance`).expect(200)).body.reviews).toHaveLength(
      1,
    );
    await call('get', `runs/${run.id}/assistance`, undefined, reader).expect(403);
    const next = await mcp('recalculate_mrp', { runId: run.id });
    expect(next.queued).toBe(true);
    const recalc = await db.proposedAction.findFirstOrThrow({
      where: { tenantId, agentId: workerId, tool: 'recalculate_mrp' },
    });
    await db.agent.updateMany({
      where: { id: workerId, tenantId },
      data: { caps: { ...caps, toolAllowlist: ['get_task', 'get_mrp_run', 'submit_mrp_review'] } },
    });
    await approve(recalc.id).expect(400);
    await db.agent.updateMany({
      where: { id: workerId, tenantId },
      data: { caps, permissions: preset.suggestedPermissions.filter((p) => p !== 'crm.read') },
    });
    expect((await approve(recalc.id).expect(201)).body.status).toBe('FAILED');
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(3);
  });
  it('opts into automatic review only for human calculations and suppresses recursive agent wakeups', async () => {
    withExceptions = true;
    await call('post', 'entries', {
      ...entry(),
      dueDate: today,
      quantity: '100',
      reference: 'Urgent requirement',
    }).expect(201);
    await app
      .get(ModuleSettingsService)
      .update(tenantId, 'manufacturing', { mrpAutomaticReview: true });
    const base = (await calculate().expect(201)).body;
    expect(base.exceptionCount).toBeGreaterThan(0);
    expect(
      await db.domainEvent.count({
        where: { tenantId, subjectId: base.id, type: 'manufacturing.mrp.review-requested' },
      }),
    ).toBe(1);
    const preset = AGENT_ROLE_PRESETS.find((p) => p.id === 'mrp-analyst')!;
    await db.agent.updateMany({
      where: { tenantId, id: workerId },
      data: { permissions: preset.suggestedPermissions },
    });
    const queued = await mcp('recalculate_mrp', { runId: base.id });
    expect(queued.queued).toBe(true);
    await db.agent.updateMany({ where: { tenantId, id: workerId }, data: { status: 'PAUSED' } });
    await approve(queued.proposalId).expect(400);
    await db.agent.updateMany({ where: { tenantId, id: workerId }, data: { status: 'ACTIVE' } });
    const approved = (await approve(queued.proposalId).expect(201)).body;
    expect(approved.status).toBe('EXECUTED');
    expect(approved.result.automaticReviewSuppressed).toBe(true);
    expect(approved.result.id).not.toBe(base.id);
    expect(
      await db.domainEvent.count({
        where: {
          tenantId,
          subjectId: approved.result.id,
          type: 'manufacturing.mrp.review-requested',
        },
      }),
    ).toBe(0);
    const unscoped = app.get(AgentsService).mintSessionToken(workerId);
    const existingTask = await db.operationalTask.findFirstOrThrow({
      where: { tenantId, assigneeAgentId: workerId, category: 'MRP_REVIEW' },
    });
    const invalid = await mcp(
      'submit_mrp_review',
      {
        runId: existingTask.subjectId,
        taskId: existingTask.id,
        itemIds: [itemId],
        summary: 'Missing worker session context must be refused.',
      },
      unscoped,
    );
    expect((await approve(invalid.proposalId).expect(201)).body.status).toBe('FAILED');
    expect(await db.mrpReview.count({ where: { tenantId } })).toBe(1);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(3);
  });
  // HTTP preparation tests use controlled proposal outputs, but real snapshot
  // capture/freshness, transactions, authorization and document writers.
  async function preparationRun(method: 'BUY' | 'MAKE', quantity = '5') {
    const original = engine.calculateMrp.getMockImplementation()!;
    engine.calculateMrp.mockImplementationOnce(async (tenant, snapshot) => {
      const result = await original(tenant, snapshot);
      const target = snapshot.items.find((i) => i.method === method)!;
      expect(target).toBeDefined();
      return {
        ...result,
        proposals: [
          {
            id: `prep-${randomUUID()}`,
            item_id: target.id,
            method,
            quantity,
            net_requirement: quantity,
            receipt_date: future,
            release_date: today,
            expedite: false,
            level: 0,
            safety_stock: '0',
            reasons: [],
          },
        ],
      } as any;
    });
    const run = (await calculate().expect(201)).body;
    const proposalId = run.result.proposals[0].id;
    const preview = (
      await call('get', `runs/${run.id}/preparation?proposalId=${proposalId}`).expect(200)
    ).body;
    return {
      run,
      preview,
      body: { proposalId, reviewToken: preview.reviewToken, operationKey: randomUUID() },
    };
  }

  it('prepares one internal request atomically, refuses duplicates and supports exact replay', async () => {
    const { run, preview, body } = await preparationRun('BUY', '5.25');
    expect(preview.canPrepare).toBe(true);
    const movements = await db.stockMovement.count({ where: { tenantId } });
    const path = `runs/${run.id}/prepare`;
    await call('post', path, body, reader).expect(403);
    await call('post', path, body, noWms).expect(403);
    await call('post', path, body, other).expect(404);
    await call('post', path, { ...body, reviewToken: '0'.repeat(64) }).expect(409);
    const [a, b] = await Promise.all([
      call('post', path, body).expect(201),
      call('post', path, body).expect(201),
    ]);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body.number).toMatch(/^MR-/);
    expect(a.body).toMatchObject({
      quantity: '5.25',
      method: 'BUY',
      status: 'DRAFT',
      manufacturingOrderId: null,
    });
    expect(await db.mrpPreparation.count({ where: { tenantId, runId: run.id } })).toBe(1);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(movements);
    await call('post', path, { ...body, operationKey: randomUUID() }).expect(409);
    await call('post', path, { ...body, reviewToken: '1'.repeat(64) }).expect(409);
    const next = await preparationRun('BUY');
    expect(next.preview.canPrepare).toBe(false);
    expect(next.preview.blockers.join(' ')).toMatch(/autre calcul/);
    await call('post', `runs/${next.run.id}/prepare`, next.body).expect(409);
    await call('post', `preparations/${a.body.id}/cancel`, {
      expectedUpdatedAt: '2000-01-01T00:00:00Z',
    }).expect(409);
    await call('post', `preparations/${a.body.id}/cancel`, {
      expectedUpdatedAt: a.body.updatedAt,
    }).expect(201);
    const replay = await call('post', path, body).expect(201);
    expect(replay.body.status).toBe('CANCELLED');
    expect(
      (
        await call(
          'get',
          `runs/${next.run.id}/preparation?proposalId=${next.body.proposalId}`,
        ).expect(200)
      ).body.canPrepare,
    ).toBe(true);
  });

  it('rejects changed inputs between preview and confirmation without creating documents', async () => {
    const { run, body } = await preparationRun('BUY');
    const current = await db.mrpItemPolicy.findFirstOrThrow({
      where: { tenantId, locationId: siteId, itemId: componentId },
    });
    await call('put', 'policies', {
      ...policy(componentId),
      leadDays: current.leadDays + 1,
      expectedUpdatedAt: current.updatedAt.toISOString(),
    }).expect(200);
    await call('post', `runs/${run.id}/prepare`, body).expect(409);
    expect(await db.mrpPreparation.count({ where: { tenantId, runId: run.id } })).toBe(0);
  });

  it('creates a linked DRAFT OF with exact context and leaves release to its guarded workflow', async () => {
    const fractional = await preparationRun('MAKE', '1.5');
    expect(fractional.preview.canPrepare).toBe(false);
    expect(fractional.preview.blockers.join(' ')).toMatch(/entière/);
    await call('post', `runs/${fractional.run.id}/prepare`, fractional.body).expect(409);
    const { run, preview, body } = await preparationRun('MAKE');
    expect(preview.canPrepare).toBe(true);
    const doc = (await call('post', `runs/${run.id}/prepare`, body).expect(201)).body;
    const order = await db.manufacturingOrder.findFirstOrThrow({
      where: { tenantId, id: doc.manufacturingOrderId },
    });
    expect(order).toMatchObject({
      status: 'DRAFT',
      quantity: 5,
      locationId: siteId,
      bomRevisionId: revisionId,
      materialSnapshot: null,
    });
    const path = `/api/v1/manufacturing/orders/${order.id}`;
    await request(http).post(`${path}/release`).set('Authorization', `Bearer ${token}`).expect(400);
    await request(http)
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 6 })
      .expect(409);
    await request(http).delete(path).set('Authorization', `Bearer ${token}`).expect(409);
    const op = (
      await request(http)
        .post(`${path}/operations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sequence: 1, name: 'Préparation', durationMinutes: 10 })
        .expect(201)
    ).body;
    const withOp = await db.manufacturingOrder.findFirstOrThrow({
      where: { id: order.id, tenantId },
    });
    expect(withOp.updatedAt.getTime()).toBeGreaterThan(order.updatedAt.getTime());
    await request(http).post(`${path}/release`).set('Authorization', `Bearer ${token}`).expect(201);
    expect(
      (await db.manufacturingOrder.findFirstOrThrow({ where: { id: order.id } })).materialSnapshot,
    ).not.toBeNull();
    const brief = await mcp('get_mrp_run', { runId: run.id });
    expect(brief.preparations[0].manufacturingOrder.id).toBe(order.id);
    expect(brief.totalPreparations).toBe(1);
    await request(http).post(`${path}/cancel`).set('Authorization', `Bearer ${token}`).expect(201);
    await request(http)
      .patch(`${path}/operations/${op.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Forbidden after cancellation' })
      .expect(409);
    await request(http)
      .delete(`${path}/operations/${op.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(
      (await call('get', `runs/${run.id}/preparations`).expect(200)).body.items[0]
        .manufacturingOrder.status,
    ).toBe('CANCELLED');
    // Historical CRM context remains protected on new preparation endpoints.
    await call('get', `runs/${run.id}/preparations`, undefined, reader).expect(403);
  });

  it('captures immutable validity and rejects an MRP horizon outside it', async () => {
    const bom = await db.bom.findFirstOrThrow({ where: { id: bomId, tenantId } });
    const publish = (dates: unknown) =>
      request(http)
        .post(`/api/v1/manufacturing/boms/${bomId}/revisions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          expectedUpdatedAt: bom.updatedAt.toISOString(),
          acknowledgeUnits: true,
          ...(dates as object),
        });
    await publish({ validFrom: future, validUntil: today }).expect(400);
    await publish({ validFrom: '2026-02-30' }).expect(400);
    const rev = (await publish({ validFrom: future, validUntil: future }).expect(201)).body;
    expect(rev.validFrom.slice(0, 10)).toBe(future);
    const old = await db.bomRevision.findFirstOrThrow({ where: { id: revisionId, tenantId } });
    expect(old.validFrom).toBeNull();
    const current = await db.mrpItemPolicy.findFirstOrThrow({
      where: { tenantId, locationId: siteId, itemId },
    });
    await call('put', 'policies', {
      ...policy(),
      method: 'MAKE',
      bomId,
      bomRevisionId: rev.id,
      expectedUpdatedAt: current.updatedAt.toISOString(),
    }).expect(200);
    await calculate().expect(400);
    const updated = await db.mrpItemPolicy.findFirstOrThrow({ where: { id: current.id } });
    await call('put', 'policies', {
      ...policy(),
      method: 'MAKE',
      bomId,
      bomRevisionId: revisionId,
      expectedUpdatedAt: updated.updatedAt.toISOString(),
    }).expect(200);
  });

  it('binds legacy calendars explicitly and prevents moving a bound work center to another site', async () => {
    const base = '/api/v1/manufacturing';
    const post = (path: string, body: object) =>
      request(http).post(`${base}/${path}`).set('Authorization', `Bearer ${token}`).send(body);
    const patch = (path: string, body: object) =>
      request(http).patch(`${base}/${path}`).set('Authorization', `Bearer ${token}`).send(body);
    const calendar = (
      await post('calendars', { code: 'SITE-CAL', name: 'Site calendar' }).expect(201)
    ).body;
    await patch(`calendars/${calendar.id}`, { locationId: siteId }).expect(409);
    const assigned = (
      await patch(`calendars/${calendar.id}`, {
        locationId: siteId,
        expectedUpdatedAt: calendar.updatedAt,
      }).expect(200)
    ).body;
    await patch(`calendars/${calendar.id}`, {
      locationId: otherSiteId,
      expectedUpdatedAt: assigned.updatedAt,
    }).expect(409);
    const second = (
      await post('calendars', {
        code: 'SITE-B-CAL',
        name: 'Site B',
        locationId: otherSiteId,
      }).expect(201)
    ).body;
    const wc = (
      await post('work-centers', { code: 'SITE-WC', name: 'WC', calendarId: calendar.id }).expect(
        201,
      )
    ).body;
    await patch(`work-centers/${wc.id}`, { calendarId: second.id }).expect(409);
    await patch(`calendars/${calendar.id}`, {
      name: 'Stale edit',
      expectedUpdatedAt: calendar.updatedAt,
    }).expect(409);
  });

  const purchasing = (method: 'get' | 'post' | 'put', path: string, body?: object, key = token) =>
    request(http)
      [method](`/api/v1/manufacturing/material-purchases${path}`)
      .set('Authorization', `Bearer ${key}`)
      .send(body);
  const wms = (method: 'get' | 'post' | 'patch', path: string, body?: object) =>
    request(http)
      [method](`/api/v1/wms/receipts/${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  let supplier: any,
    purchase: any,
    purchasePrep: any,
    purchaseCreate: any,
    firstReceipt: any,
    secondReceipt: any;
  let stockBeforePurchase: number;
  it('creates tenant-scoped suppliers and one purchase per request with exact replay and frozen supplier snapshot', async () => {
    const dto = {
      code: 'METAL',
      name: 'Métaux du Nord',
      email: 'achats@example.test',
      terms: 'Net 30',
    };
    await purchasing('post', '/suppliers', dto, reader).expect(403);
    supplier = (await purchasing('post', '/suppliers', dto).expect(201)).body;
    await purchasing('post', '/suppliers', dto).expect(409);
    await purchasing('put', `/suppliers/${supplier.id}`, dto, other).expect(404);
    await purchasing('put', `/suppliers/${supplier.id}`, dto).expect(409);
    supplier = (
      await purchasing('put', `/suppliers/${supplier.id}`, {
        ...dto,
        expectedUpdatedAt: supplier.updatedAt,
      }).expect(200)
    ).body;
    expect(
      (await purchasing('get', '/suppliers?search=MET&pageSize=1').expect(200)).body.total,
    ).toBe(1);
    const { run, body, preview } = await preparationRun('BUY', '5.25');
    expect(preview.canPrepare).toBe(true);
    purchasePrep = (await call('post', `runs/${run.id}/prepare`, body).expect(201)).body;
    purchaseCreate = {
      preparationId: purchasePrep.id,
      expectedUpdatedAt: purchasePrep.updatedAt,
      supplierId: supplier.id,
      unitPrice: '1.123456',
      currency: 'CAD',
      expectedDate: future,
      operationKey: randomUUID(),
    };
    await purchasing('post', '', purchaseCreate, reader).expect(403);
    await purchasing('post', '', purchaseCreate, other).expect(404);
    const [a, b] = await Promise.all([
      purchasing('post', '', purchaseCreate).expect(201),
      purchasing('post', '', purchaseCreate).expect(201),
    ]);
    expect(a.body.id).toBe(b.body.id);
    purchase = a.body;
    expect(purchase.subtotal).toBe('5.90');
    expect(purchase.number).toMatch(/^MP-/);
    expect(purchase).not.toHaveProperty('fingerprint');
    expect(purchase).not.toHaveProperty('operationKey');
    await purchasing('post', '', { ...purchaseCreate, unitPrice: '2' }).expect(409);
    await purchasing('post', '', { ...purchaseCreate, operationKey: randomUUID() }).expect(409);
    await purchasing('get', `/${purchase.id}`, undefined, reader).expect(403);
    await purchasing('get', `/${purchase.id}`, undefined, other).expect(404);
    await call('post', `preparations/${purchasePrep.id}/cancel`, {
      expectedUpdatedAt: purchasePrep.updatedAt,
    }).expect(409);
    supplier = (
      await purchasing('put', `/suppliers/${supplier.id}`, {
        ...dto,
        name: 'Nouveau nom',
        expectedUpdatedAt: supplier.updatedAt,
      }).expect(200)
    ).body;
    expect((await purchasing('get', `/${purchase.id}`).expect(200)).body.supplier.name).toBe(
      'Métaux du Nord',
    );
    stockBeforePurchase = await db.stockMovement.count({ where: { tenantId } });
    expect(
      (await calculate().expect(201)).body.inputSnapshot.supplies.some(
        (s: any) => s.id === `purchase:${purchase.id}`,
      ),
    ).toBe(false);
  });
  it('counts only a human-confirmed purchase as supply and reconciles the inter-run duplicate guard', async () => {
    await purchasing('post', `/${purchase.id}/receipts`, {
      expectedUpdatedAt: purchase.updatedAt,
      toBinId: binId,
      quantity: '2.25',
      operationKey: randomUUID(),
    }).expect(409);
    const confirmation = {
      expectedUpdatedAt: purchase.updatedAt,
      supplierReference: 'SUP-ORDER-101',
    };
    await purchasing('post', `/${purchase.id}/confirm`, {
      ...confirmation,
      supplierReference: '   ',
    }).expect(409);
    purchase = (await purchasing('post', `/${purchase.id}/confirm`, confirmation).expect(201)).body;
    await purchasing('post', `/${purchase.id}/confirm`, confirmation).expect(409);
    await purchasing('put', `/${purchase.id}`, {
      supplierId: supplier.id,
      unitPrice: '2',
      currency: 'CAD',
      expectedDate: future,
      expectedUpdatedAt: purchase.updatedAt,
    }).expect(409);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(stockBeforePurchase);
    const calculated = (await calculate().expect(201)).body;
    expect(
      calculated.inputSnapshot.supplies.find((s: any) => s.id === `purchase:${purchase.id}`)
        .quantity,
    ).toBe('5.25');
    expect((await preparationRun('BUY')).preview.canPrepare).toBe(true);
    const brief = await app
      .get(
        (await import('../src/modules/manufacturing/mrp/mrp-assistance.service'))
          .MrpAssistanceService,
      )
      .brief(tenantId, calculated.id, ['manufacturing.read', 'wms.read', 'crm.read']);
    expect(brief.materialPurchases).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: purchase.id, remaining: '5.25' })]),
    );
  });
  it('creates replayable receipt drafts, guards bin ownership and excludes manual double-counting', async () => {
    const wrongBin = await db.bin.findFirstOrThrow({
      where: { tenantId, locationId: otherSiteId },
    });
    const body = {
      expectedUpdatedAt: purchase.updatedAt,
      toBinId: binId,
      quantity: '2.25',
      operationKey: randomUUID(),
    };
    await purchasing('post', `/${purchase.id}/receipts`, { ...body, toBinId: wrongBin.id }).expect(
      400,
    );
    const [a, b] = await Promise.all([
      purchasing('post', `/${purchase.id}/receipts`, body).expect(201),
      purchasing('post', `/${purchase.id}/receipts`, body).expect(201),
    ]);
    expect(a.body.receiptId).toBe(b.body.receiptId);
    firstReceipt = (await wms('get', a.body.receiptId).expect(200)).body;
    expect(firstReceipt.materialPurchase.remaining).toBe('5.25');
    expect(firstReceipt.status).toBe('DRAFT');
    const changedItem = (
      await wms('patch', `${firstReceipt.id}/lines/${firstReceipt.lines[0].id}`, {
        expectedUpdatedAt: firstReceipt.updatedAt,
        itemId,
        toBinId: binId,
        qty: 2.25,
      }).expect(200)
    ).body;
    expect(changedItem.readiness.canExecute).toBe(false);
    // An invalid draft must not sum another item's quantity using the purchase unit.
    const incompatibleDraft = (await purchasing('get', `/${purchase.id}`).expect(200)).body;
    expect(incompatibleDraft.receipts.find((r: any) => r.id === firstReceipt.id).quantity).toBe(
      '0',
    );
    await wms('post', `${firstReceipt.id}/post`, {
      expectedUpdatedAt: changedItem.updatedAt,
    }).expect(409);
    firstReceipt = (
      await wms('patch', `${firstReceipt.id}/lines/${firstReceipt.lines[0].id}`, {
        expectedUpdatedAt: changedItem.updatedAt,
        itemId: purchase.preparation.itemId,
        toBinId: binId,
        qty: 2.25,
      }).expect(200)
    ).body;
    const manufacturingModule = await db.moduleDefinition.findUniqueOrThrow({
      where: { key: 'manufacturing' },
    });
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: manufacturingModule.id },
      data: { enabled: false },
    });
    await wms('post', `${firstReceipt.id}/post`, {
      expectedUpdatedAt: firstReceipt.updatedAt,
    }).expect(409);
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: manufacturingModule.id },
      data: { enabled: true },
    });
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(stockBeforePurchase);
    await purchasing('post', `/${purchase.id}/receipts`, { ...body, quantity: '3' }).expect(409);
    await call('post', 'entries', {
      ...entry(),
      itemId: purchase.preparation.itemId,
      kind: 'SUPPLY',
      quantity: '5.25',
      receiptId: firstReceipt.id,
    }).expect(400);
    expect(
      (await call('get', `workspace?locationId=${siteId}`).expect(200)).body.receipts.some(
        (r: any) => r.id === firstReceipt.id,
      ),
    ).toBe(false);
    purchase = (await purchasing('get', `/${purchase.id}`).expect(200)).body;
    await purchasing('post', `/${purchase.id}/cancel`, {
      expectedUpdatedAt: purchase.updatedAt,
    }).expect(409);
    const second = (
      await purchasing('post', `/${purchase.id}/receipts`, {
        ...body,
        expectedUpdatedAt: purchase.updatedAt,
        quantity: '4',
        operationKey: randomUUID(),
      }).expect(201)
    ).body;
    secondReceipt = (await wms('get', second.receiptId).expect(200)).body;
  });
  it('receives partially via WMS and refuses concurrent over-receipt with no partial stock commits', async () => {
    const results = await Promise.all([
      wms('post', `${firstReceipt.id}/post`, { expectedUpdatedAt: firstReceipt.updatedAt }),
      wms('post', `${secondReceipt.id}/post`, { expectedUpdatedAt: secondReceipt.updatedAt }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const posted = results.find((r) => r.status === 201)!.body;
    const rejectedId = posted.id === firstReceipt.id ? secondReceipt.id : firstReceipt.id;
    const current = (await purchasing('get', `/${purchase.id}`).expect(200)).body;
    expect(current.fulfillment).toBe('PARTIAL');
    expect(Number(current.received) + Number(current.remaining)).toBe(5.25);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(stockBeforePurchase + 1);
    expect(
      (await calculate().expect(201)).body.inputSnapshot.supplies.find(
        (s: any) => s.id === `purchase:${purchase.id}`,
      ).quantity,
    ).toBe(current.remaining);
    const rejected = (await wms('get', rejectedId).expect(200)).body;
    expect(rejected.readiness.canExecute).toBe(false);
    expect(rejected.readiness.lines[0].issues.join(' ')).toContain('Sur-réception');
    const corrected = (
      await wms('patch', `${rejectedId}/lines/${rejected.lines[0].id}`, {
        expectedUpdatedAt: rejected.updatedAt,
        itemId: current.preparation.itemId,
        toBinId: binId,
        qty: Number(current.remaining),
      }).expect(200)
    ).body;
    await wms('post', `${rejectedId}/post`, { expectedUpdatedAt: corrected.updatedAt }).expect(201);
    purchase = (await purchasing('get', `/${purchase.id}`).expect(200)).body;
    expect(purchase.fulfillment).toBe('FULL');
    expect(purchase.received).toBe('5.25');
    expect(purchase.remaining).toBe('0');
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(stockBeforePurchase + 2);
    expect(
      (await calculate().expect(201)).body.inputSnapshot.supplies.some(
        (s: any) => s.id === `purchase:${purchase.id}`,
      ),
    ).toBe(false);
    await purchasing('post', `/${purchase.id}/cancel`, {
      expectedUpdatedAt: purchase.updatedAt,
    }).expect(409);
    await purchasing('post', `/${purchase.id}/receipts`, {
      expectedUpdatedAt: purchase.updatedAt,
      toBinId: binId,
      quantity: '1',
      operationKey: randomUUID(),
    }).expect(409);
  });
  it('keeps cancellation explicit, versioned and terminal, without releasing an un-reconciled request', async () => {
    const { run, body } = await preparationRun('BUY', '1');
    const prep = (await call('post', `runs/${run.id}/prepare`, body).expect(201)).body;
    const dto = {
      supplierId: supplier.id,
      unitPrice: '10',
      currency: 'USD',
      expectedDate: future,
      preparationId: prep.id,
      expectedUpdatedAt: prep.updatedAt,
      operationKey: randomUUID(),
    };
    const order = (await purchasing('post', '', dto).expect(201)).body;
    await purchasing('post', `/${order.id}/cancel`, {
      expectedUpdatedAt: '2000-01-01T00:00:00Z',
    }).expect(409);
    const cancelled = (
      await purchasing('post', `/${order.id}/cancel`, {
        expectedUpdatedAt: order.updatedAt,
      }).expect(201)
    ).body;
    expect(cancelled.status).toBe('CANCELLED');
    await purchasing('post', `/${order.id}/confirm`, {
      expectedUpdatedAt: cancelled.updatedAt,
      supplierReference: 'VOID',
    }).expect(409);
    expect((await preparationRun('BUY')).preview.canPrepare).toBe(false);
    const current = (await purchasing('get', `/requests/${prep.id}`).expect(200)).body;
    await call('post', `preparations/${prep.id}/cancel`, {
      expectedUpdatedAt: current.updatedAt,
    }).expect(201);
    expect((await preparationRun('BUY')).preview.canPrepare).toBe(true);
  });
  it('reschedules with history, closes a partial remainder without stock and releases new needs', async () => {
    const { run, body } = await preparationRun('BUY', '10');
    const prep = (await call('post', `runs/${run.id}/prepare`, body).expect(201)).body;
    let po = (
      await purchasing('post', '', {
        preparationId: prep.id,
        expectedUpdatedAt: prep.updatedAt,
        operationKey: randomUUID(),
        supplierId: supplier.id,
        unitPrice: '3',
        currency: 'CAD',
        expectedDate: today,
      }).expect(201)
    ).body;
    po = (
      await purchasing('post', `/${po.id}/confirm`, {
        expectedUpdatedAt: po.updatedAt,
        supplierReference: 'RELIQUAT-TEST',
      }).expect(201)
    ).body;
    const before = await db.stockMovement.count({ where: { tenantId } });
    const change = {
      expectedUpdatedAt: po.updatedAt,
      kind: 'RESCHEDULE',
      expectedDate: future,
      reason: 'Retard annoncé par fournisseur',
    };
    await purchasing('post', `/${po.id}/amendments`, change, reader).expect(403);
    await purchasing('post', `/${po.id}/amendments`, change, other).expect(404);
    await purchasing('post', `/${po.id}/amendments`, { ...change, reason: '   ' }).expect(400);
    po = (await purchasing('post', `/${po.id}/amendments`, change).expect(201)).body;
    await purchasing('post', `/${po.id}/amendments`, change).expect(409);
    expect(po.amendments[0]).toMatchObject({ reason: change.reason, kind: 'RESCHEDULE' });
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(before);
    const received = (
      await purchasing('post', `/${po.id}/receipts`, {
        expectedUpdatedAt: po.updatedAt,
        operationKey: randomUUID(),
        toBinId: binId,
        quantity: '8',
      }).expect(201)
    ).body;
    po = (await purchasing('get', `/${po.id}`).expect(200)).body;
    await purchasing('post', `/${po.id}/amendments`, {
      expectedUpdatedAt: po.updatedAt,
      kind: 'CLOSE_REMAINDER',
      reason: 'Solde non livrable',
    }).expect(409);
    const rc = (await wms('get', received.receiptId).expect(200)).body;
    await wms('post', `${rc.id}/post`, { expectedUpdatedAt: rc.updatedAt }).expect(201);
    po = (await purchasing('get', `/${po.id}`).expect(200)).body;
    const oldRun = (await calculate().expect(201)).body;
    po = (
      await purchasing('post', `/${po.id}/amendments`, {
        expectedUpdatedAt: po.updatedAt,
        kind: 'CLOSE_REMAINDER',
        reason: 'Solde non livrable',
      }).expect(201)
    ).body;
    expect(po).toMatchObject({
      received: '8',
      remaining: '0',
      closedQuantity: '2',
      fulfillment: 'CLOSED',
    });
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(before + 1);
    await purchasing('post', `/${po.id}/receipts`, {
      expectedUpdatedAt: po.updatedAt,
      operationKey: randomUUID(),
      toBinId: binId,
      quantity: '1',
    }).expect(409);
    await purchasing('post', `/${po.id}/cancel`, { expectedUpdatedAt: po.updatedAt }).expect(409);
    const nextRun = (await calculate().expect(201)).body;
    expect(nextRun.inputSnapshot.supplies.some((s: any) => s.id === `purchase:${po.id}`)).toBe(
      false,
    );
    expect(
      nextRun.sourceMetadata.materialPurchases.find((p: any) => p.id === po.id).closedQuantity,
    ).toBe('2');
    expect((await call('get', `runs/${oldRun.id}`).expect(200)).body.stale).toBe(true);
    expect((await preparationRun('BUY')).preview.canPrepare).toBe(true);
    const arrivals = (await purchasing('get', '/workspace/arrivals').expect(200)).body;
    expect(arrivals.items.find((p: any) => p.id === po.id).arrivalState).toBe('CLOSED');
  });

  it('posts actual consumption, good output and scrap atomically with durable replay and site guards', async () => {
    const manu = (method: 'get' | 'post', path: string, body?: object, key = token) =>
      request(http)
        [method](`/api/v1/manufacturing/${path}`)
        .set('Authorization', `Bearer ${key}`)
        .send(body);
    const item = await db.wmsItem.findFirstOrThrow({ where: { tenantId, id: itemId } });
    let order = (
      await manu('post', 'orders', {
        name: 'Atelier réel',
        productRef: item.sku,
        quantity: 3,
        dueDate: future,
        releaseDate: today,
        bomId,
      }).expect(201)
    ).body;
    await manu('post', `orders/${order.id}/material-context`, {
      expectedUpdatedAt: order.updatedAt,
      locationId: siteId,
      bomRevisionId: revisionId,
    }).expect(201);
    order = (await manu('post', `orders/${order.id}/release`).expect(201)).body;
    order = (await manu('post', `orders/${order.id}/start`).expect(201)).body;
    const before = await db.stockMovement.count({ where: { tenantId } });
    const dto = {
      operationKey: randomUUID(),
      expectedUpdatedAt: order.updatedAt,
      goodQuantity: 1,
      scrapQuantity: 1,
      toBinId: binId,
      note: 'Un rebut constaté au contrôle',
      consumptions: [{ itemId: componentId, fromBinId: binId, quantity: '1' }],
    };
    const path = `shop-floor/orders/${order.id}`;
    await manu('post', `${path}/declarations`, dto, reader).expect(403);
    await manu('post', `${path}/declarations`, dto, other).expect(400);
    await manu('post', `orders/${order.id}/complete`).expect(409);
    const wrongBin = await db.bin.create({
      data: { tenantId, locationId: otherSiteId, code: `WRONG-${randomUUID()}` },
    });
    await manu('post', `${path}/declarations`, { ...dto, toBinId: wrongBin.id }).expect(409);
    await manu('post', `${path}/declarations`, {
      ...dto,
      consumptions: [{ ...dto.consumptions[0], quantity: '999999999' }],
    }).expect(409);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(before);
    expect(
      await db.manufacturingDeclaration.count({ where: { tenantId, orderId: order.id } }),
    ).toBe(0);
    const [a, b] = await Promise.all([
      manu('post', `${path}/declarations`, dto).expect(201),
      manu('post', `${path}/declarations`, dto).expect(201),
    ]);
    expect(a.body.id).toBe(b.body.id);
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(before + 2);
    const movements = await db.stockMovement.findMany({ where: { tenantId, refId: a.body.id } });
    expect(movements.map((m) => m.type).sort()).toEqual(['CONSUMPTION', 'PRODUCTION']);
    expect(movements.find((m) => m.type === 'PRODUCTION')!.qty.toFixed()).toBe('1');
    await manu('post', `${path}/declarations`, { ...dto, goodQuantity: 2 }).expect(409);
    let floor = (await manu('get', path).expect(200)).body;
    expect(floor).toMatchObject({ good: 1, scrap: 1, remaining: 1 });
    expect(floor.declarations[0]).not.toHaveProperty('fingerprint');
    await manu('post', `orders/${order.id}/cancel`).expect(409);
    const effects = (
      await manu('get', `scheduling/material-impact?locationId=${siteId}`).expect(200)
    ).body;
    expect(effects.orders.find((o: any) => o.id === order.id).hasActuals).toBe(true);
    await manu('get', `scheduling/material-impact?locationId=${siteId}`, undefined, noWms).expect(
      403,
    );
    await manu('get', `scheduling/material-impact?locationId=${siteId}`, undefined, other).expect(
      400,
    );
    await manu('post', `${path}/declarations`, {
      ...dto,
      operationKey: randomUUID(),
      expectedUpdatedAt: floor.updatedAt,
      goodQuantity: 1,
      scrapQuantity: 0,
      consumptions: [{ ...dto.consumptions[0], quantity: '0' }],
      note: 'Dernière pièce avec matières déjà consommées',
    }).expect(201);
    const finishedEffects = (
      await manu('get', `scheduling/material-impact?locationId=${siteId}`).expect(200)
    ).body;
    expect(finishedEffects.orders.find((o: any) => o.id === order.id).components[0].quantity).toBe(
      '0',
    );
    await manu('post', `orders/${order.id}/complete`).expect(201);
    floor = (await manu('get', path).expect(200)).body;
    expect(floor).toMatchObject({ status: 'COMPLETED', good: 2, scrap: 1, remaining: 0 });
    const calculated = (await calculate().expect(201)).body;
    expect(
      calculated.sourceMetadata.productionDeclarations.filter((d: any) => d.orderId === order.id),
    ).toHaveLength(2);
  });

  it('fails closed when WMS is disabled, including historical reads', async () => {
    const module = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'wms' } });
    await db.tenantModule.updateMany({
      where: { tenantId, moduleId: module.id },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await call('get', `runs/${runId}`).expect(403);
    await calculate().expect(403);
    await purchasing('get', `/${purchase.id}`).expect(403);
    await purchasing('get', '/suppliers').expect(403);
  });
});
