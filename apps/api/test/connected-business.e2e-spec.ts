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
import { EmailService } from '../src/core/email/email.service';
import { DocumentsService } from '../src/core/documents/documents.service';
describe('Connected business delivery (HTTP + PostgreSQL)', () => {
  const mailProvider = { channel: 'log', send: jest.fn(async () => true) };
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
      .overrideProvider(EmailService)
      .useValue(mailProvider)
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
      ['catalog', 'services', 'support', 'hr', 'billing', 'purchasing', 'quality', 'wms'].includes(
        m.key,
      ),
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
      billingReader: ['billing.customer-invoices.read', 'billing.customer-invoices.manage'],
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
      const email = `${key.toLowerCase()}@${slug}.test`;
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
  it('bills only net parts, refuses stale previews, and corrects a draft without rewriting history', async () => {
    const post = async (path: string, body: object) =>
      (await call('post', path, body).expect(201)).body;
    let p = await post('services/projects', { title: 'Partial returns', partnerId: partner.id });
    p = await post(`services/projects/${p.id}/transition`, {
      status: 'ACTIVE',
      expectedUpdatedAt: p.updatedAt,
    });
    let j = await post('services/jobs', { title: 'Stock usage', projectId: p.id });
    j = await post(`services/jobs/${j.id}/transition`, {
      status: 'IN_PROGRESS',
      expectedUpdatedAt: j.updatedAt,
    });
    const goods = await post('catalog/items', {
      code: randomUUID(),
      name: 'Joint test',
      kind: 'GOODS',
      unit: 'EA',
    });
    const stock = await db.wmsItem.create({
      data: { tenantId, sku: randomUUID(), name: 'Physical item', unit: 'EA', lotTracked: true },
    });
    const lot = await post(`wms/items/${stock.id}/lots`, { code: 'SERVICE-CREDIT-LOT' });
    const site = await db.location.create({
      data: {
        tenantId,
        code: randomUUID(),
        name: 'Atelier',
        type: 'WAREHOUSE',
        addressLine1: '1 Test',
        city: 'Québec',
      },
    });
    const bin = await db.bin.create({ data: { tenantId, locationId: site.id, code: 'A' } });
    await call('patch', `catalog/items/${goods.id}/stock-link`, {
      wmsItemId: stock.id,
      expectedUpdatedAt: goods.updatedAt,
    }).expect(200);
    await post('wms/inventory/adjust', {
      itemId: stock.id,
      binId: bin.id,
      qtyDelta: 10,
      note: 'Fixture',
      lotId: lot.id,
    });
    const route = `services/jobs/${j.id}/parts`;
    const part = await post(route, {
      catalogItemId: goods.id,
      binId: bin.id,
      quantity: 4,
      note: 'Installation',
      lotId: lot.id,
      operationKey: randomUUID(),
      expectedUpdatedAt: j.updatedAt,
    });
    const sources = async () =>
      (await call('get', `services/projects/${p.id}/billable`).expect(200)).body.sources;
    const freshVersion = async () =>
      (await call('get', `services/jobs/${j.id}`).expect(200)).body.updatedAt;
    const invoiceBody = (source: any) => ({
      operationKey: randomUUID(),
      currency: 'CAD',
      sources: [
        { kind: 'part', id: part.id, unitPrice: 10, expectedVersion: source.expectedVersion },
      ],
    });
    const old = (await sources())[0];
    const rb = {
      operationKey: randomUUID(),
      quantity: 1.25,
      reason: 'Non utilisé',
      expectedUpdatedAt: await freshVersion(),
    };
    await post(`${route}/${part.id}/return`, rb);
    await call('post', `services/projects/${p.id}/invoice`, invoiceBody(old)).expect(409);
    const net = (await sources())[0];
    expect(net).toMatchObject({ quantity: '2.75', issuedQuantity: '4', returnedQuantity: '1.25' });
    expect(net.expectedVersion).not.toBe(old.expectedVersion);
    const body = invoiceBody(net);
    const created = await post(`services/projects/${p.id}/invoice`, body);
    const invoice = await db.customerInvoice.findFirstOrThrow({
      where: { tenantId, id: created.invoiceId },
      include: { lines: true },
    });
    expect(invoice.totalAmount.toString()).toBe('27.5');
    expect(invoice.lines[0].quantity?.toString()).toBe('2.75');
    expect(await sources()).toHaveLength(0);
    const locked = (await call('get', route, undefined, 'reader').expect(200)).body.items[0];
    expect(locked.billingLocked).toBe(true);
    expect(JSON.stringify(locked)).not.toContain(invoice.id);
    // Replaying a known return after billing is safe; a new return is not.
    expect((await post(`${route}/${part.id}/return`, rb)).replayed).toBe(true);
    const correction = {
      operationKey: randomUUID(),
      quantity: 0.75,
      reason: 'Deuxième retour',
      expectedUpdatedAt: await freshVersion(),
    };
    await call('post', `${route}/${part.id}/return`, correction).expect(409);
    await call('delete', `billing/customer-invoices/${invoice.id}`).expect(200);
    await post(`${route}/${part.id}/return`, correction);
    await call('post', `services/projects/${p.id}/invoice`, body).expect(409);
    const corrected = await post(
      `services/projects/${p.id}/invoice`,
      invoiceBody((await sources())[0]),
    );
    expect(
      (
        await db.customerInvoice.findFirstOrThrow({ where: { tenantId, id: corrected.invoiceId } })
      ).totalAmount.toString(),
    ).toBe('20');
    expect(
      (
        await db.serviceInvoiceBatch.findFirstOrThrow({
          where: { tenantId, operationKey: body.operationKey },
        })
      ).invoiceId,
    ).toBeNull();
    await post(`billing/customer-invoices/${corrected.invoiceId}/approve`, {});
    await call('delete', `billing/customer-invoices/${corrected.invoiceId}`).expect(400);
    await call('post', `${route}/${part.id}/return`, {
      ...correction,
      operationKey: randomUUID(),
      quantity: 1,
      expectedUpdatedAt: await freshVersion(),
    }).expect(409);
    expect(await db.servicePartReturn.count({ where: { tenantId, usageId: part.id } })).toBe(2);
    expect(
      Number(
        (
          await db.inventoryLevel.findFirstOrThrow({
            where: { tenantId, itemId: stock.id, binId: bin.id },
          })
        ).qtyOnHand,
      ),
    ).toBe(8);
    const invoiceId = corrected.invoiceId;
    const context = (
      await call('get', `billing/customer-invoices/${invoiceId}/credits`).expect(200)
    ).body;
    const credit = await post(`billing/customer-invoices/${invoiceId}/credits`, {
      operationKey: randomUUID(),
      expectedVersion: 0,
      reason: 'Retour client',
      lines: [{ invoiceLineId: context.lines[0].id, quantity: 1 }],
    });
    await post(`billing/customer-invoices/${invoiceId}/credits/${credit.id}/issue`, {});
    // Issuing an accounting credit never moves goods.
    expect(
      Number(
        (
          await db.inventoryLevel.findFirstOrThrow({
            where: { tenantId, itemId: stock.id, binId: bin.id },
          })
        ).qtyOnHand,
      ),
    ).toBe(8);
    const available = (await call('get', route, undefined, 'reader').expect(200)).body.items[0];
    expect(available.creditReturnOptions).toHaveLength(1);
    expect(available.creditReturnOptions[0].available).toBe('1');
    expect(JSON.stringify(available)).not.toContain('totalAmount');
    const withCredit = {
      operationKey: randomUUID(),
      quantity: 0.625,
      reason: 'Retour physique après avoir',
      creditLineId: available.creditReturnOptions[0].id,
      expectedUpdatedAt: await freshVersion(),
    };
    await post(`${route}/${part.id}/return`, withCredit);
    expect((await post(`${route}/${part.id}/return`, withCredit)).replayed).toBe(true);
    await call('post', `${route}/${part.id}/return`, {
      ...withCredit,
      operationKey: randomUUID(),
      quantity: 0.5,
      expectedUpdatedAt: await freshVersion(),
    }).expect(409);
    await post(`${route}/${part.id}/return`, {
      ...withCredit,
      operationKey: randomUUID(),
      quantity: 0.375,
      expectedUpdatedAt: await freshVersion(),
    });
    expect(
      Number(
        (
          await db.inventoryLevel.findFirstOrThrow({
            where: { tenantId, itemId: stock.id, binId: bin.id },
          })
        ).qtyOnHand,
      ),
    ).toBe(9);
    expect(
      (
        await db.wmsLotBalance.findFirstOrThrow({
          where: { tenantId, itemId: stock.id, lotId: lot.id, binId: bin.id },
        })
      ).qtyOnHand.toString(),
    ).toBe('9');
    expect(
      (await db.stockMovement.findMany({ where: { tenantId, itemId: stock.id } })).every(
        (m) => m.lotId === lot.id,
      ),
    ).toBe(true);
    expect(
      (await call('get', `billing/customer-invoices/${invoiceId}/credits`).expect(200)).body,
    ).toMatchObject({ creditedAmount: '10', outstanding: 10 });
  });
  async function creditFixture(
    options: { tenant?: string; paid?: boolean; taxAccount?: string; draft?: boolean } = {},
  ) {
    const t = options.tenant ?? tenantId;
    const customer = await db.customer.create({
      data: { tenantId: t, code: randomUUID(), name: 'Credit customer' },
    });
    return db.customerInvoice.create({
      data: {
        tenantId: t,
        customerId: customer.id,
        invoiceNumber: randomUUID(),
        status: options.draft ? 'DRAFT' : options.paid ? 'PAID' : 'APPROVED',
        approvedAt: options.draft ? null : new Date(),
        totalAmount: 114.98,
        taxAmount: 14.98,
        amountPaid: options.paid ? 114.98 : 0,
        taxDetail: {
          lines: [
            { description: 'Tax A', rate: 5, accountCode: options.taxAccount ?? '2100', amount: 5 },
            {
              description: 'Tax B',
              rate: 9.975,
              accountCode: options.taxAccount ?? '2100',
              amount: 9.98,
            },
          ],
        },
        lines: {
          create: { description: 'Three units', quantity: 3, unitPrice: 33.333333, amount: 100 },
        },
      },
      include: { lines: true },
    });
  }
  const creditRoute = (id: string) => `billing/customer-invoices/${id}/credits`;
  const publication = {
    issuerName: 'Entreprise Démonstration',
    issuerAddress: '123 rue Exemple, Québec',
    issuerTaxIds: 'TPS EXEMPLE / TVQ EXEMPLE',
    recipientName: 'Client de test',
    recipientAddress: '456 rue Exemple',
    confirmed: true,
  };
  it('publishes a canonical invoice, resumes storage failure and explicitly deduplicates delivery', async () => {
    const inv = await creditFixture();
    const path = `billing/customer-invoices/${inv.id}/document`;
    await call('post', `billing/customer-invoices/${inv.id}/send`).expect(409);
    await call('get', path, undefined, 'reader').expect(403);
    await call('post', path, { ...publication, snapshot: {} }).expect(400);
    const storage = jest
      .spyOn(app.get(DocumentsService), 'upload')
      .mockRejectedValueOnce(new Error('Invoice storage outage'));
    try {
      await call('post', path, publication).expect(500);
    } finally {
      storage.mockRestore();
    }
    const frozen = (await call('get', path).expect(200)).body;
    expect(frozen.ready).toBe(false);
    expect(frozen.snapshot.totalAmount).toBe(inv.totalAmount.toFixed(2));
    await call('post', path, { ...publication, recipientName: 'Replacement' }).expect(409);
    const both = await Promise.all([
      call('post', path, publication),
      call('post', path, Object.fromEntries(Object.entries(publication).reverse())),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(both[0].body.hash).toBe(both[1].body.hash);
    const row = await db.customerInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.status).toBe('APPROVED');
    expect(row.totalAmount.equals(inv.totalAmount)).toBe(true);
    await call('get', `${path}/pdf`).expect(200).expect('Content-Type', /pdf/);
    await call('get', `documents/${row.documentId}/download`).expect(403);
    await call('delete', `documents/${row.documentId}`).expect(403);
    const input = {
      to: 'chosen@example.test',
      expectedHash: row.documentHash,
      expectedChannel: 'log',
      confirmed: true,
    };
    await call('post', `${path}/send`, input, 'billingReader').expect(403);
    await call('post', `${path}/send`, { ...input, expectedHash: 'a'.repeat(64) }).expect(409);
    await call('post', `${path}/send`, { ...input, expectedChannel: 'smtp' }).expect(409);
    const sends = await Promise.all([
      call('post', `${path}/send`, input),
      call('post', `${path}/send`, input),
    ]);
    expect(sends.map((r) => r.status)).toEqual([201, 201]);
    await call('post', `${path}/send`, { ...input, to: 'other@example.test' }).expect(409);
    expect(
      await db.emailMessage.count({
        where: { tenantId, relatedType: 'customer-invoice', relatedId: inv.id },
      }),
    ).toBe(1);
    expect((await db.customerInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe(
      'APPROVED',
    );
    await db.customerInvoice.update({
      where: { id: inv.id },
      data: { documentHash: 'a'.repeat(64) },
    });
    await call('get', `${path}/pdf`).expect(409);
  });
  it('blocks unapproved, inconsistent and previously sent invoices without inferring historical evidence', async () => {
    const draft = await creditFixture({ draft: true });
    await call('post', `billing/customer-invoices/${draft.id}/document`, publication).expect(409);
    const inv = await creditFixture();
    await db.customerInvoice.update({ where: { id: inv.id }, data: { taxDetail: { lines: [] } } });
    await call('post', `billing/customer-invoices/${inv.id}/document`, publication).expect(409);
    await db.customerInvoice.update({
      where: { id: inv.id },
      data: { taxDetail: { lines: [{ description: 'Taxe', rate: 'invalid', amount: 14.98 }] } },
    });
    await call('post', `billing/customer-invoices/${inv.id}/document`, publication).expect(409);
    const legacy = await creditFixture();
    await db.customerInvoice.update({ where: { id: legacy.id }, data: { sentAt: new Date() } });
    const path = `billing/customer-invoices/${legacy.id}/document`;
    const published = (await call('post', path, publication).expect(201)).body;
    expect(published.legacySendBlocked).toBe(true);
    await call('post', `${path}/send`, {
      to: 'chosen@example.test',
      expectedHash: published.hash,
      expectedChannel: 'log',
      confirmed: true,
    }).expect(409);
    await call('get', `billing/customer-invoices/${randomUUID()}/document`).expect(404);
    const foreignCustomer = await db.customer.create({
      data: { tenantId: foreign, code: `PDF-${randomUUID()}`, name: 'Autre entreprise' },
    });
    const foreignInvoice = await db.customerInvoice.create({
      data: {
        tenantId: foreign,
        customerId: foreignCustomer.id,
        invoiceNumber: `PDF-${randomUUID()}`,
        totalAmount: 10,
        status: 'APPROVED',
      },
    });
    await call('get', `billing/customer-invoices/${foreignInvoice.id}/document`).expect(404);
    await call(
      'post',
      `billing/customer-invoices/${foreignInvoice.id}/document`,
      publication,
    ).expect(404);
    await call('get', `billing/customer-invoices/${foreignInvoice.id}/document/pdf`).expect(404);
  });
  it('publishes invoice coordinates explicitly, protects provenance and keeps the email choice separate', async () => {
    const inv = await creditFixture({ draft: true });
    const directory = `billing/data/customers/${inv.customerId}/directory`;
    const entry = {
      kind: 'ADDRESS',
      label: 'Adresse historique',
      role: 'Facturation',
      active: true,
      validFrom: null,
      validUntil: null,
      email: '',
      phone: '',
      notes: 'PRIVATE-NOTE',
      address: {
        line1: '42 rue du Parc',
        line2: '',
        city: 'Québec',
        region: 'QC',
        postalCode: 'G1K 3X2',
        countryCode: 'CA',
      },
    };
    const address = (
      await call('post', directory, {
        operationKey: randomUUID(),
        reason: 'Coordonnées initiales',
        entry,
      }).expect(201)
    ).body;
    const contactData = {
      ...entry,
      kind: 'CONTACT',
      address: null,
      email: 'historique@example.test',
      notes: 'PRIVATE-CONTACT',
    };
    const contact = (
      await call('post', directory, {
        operationKey: randomUUID(),
        reason: 'Contact initial',
        entry: contactData,
      }).expect(201)
    ).body;
    const selected = (
      await call('patch', `billing/customer-invoices/${inv.id}/coordinates`, {
        expectedUpdatedAt: inv.updatedAt.toISOString(),
        reason: 'Accord client revu',
        selections: {
          billingAddress: { id: address.id, version: 1 },
          deliveryAddress: null,
          contact: { id: contact.id, version: 1 },
        },
      }).expect(200)
    ).body;
    await call('post', `billing/customer-invoices/${inv.id}/approve`, {
      expectedUpdatedAt: selected.updatedAt,
    }).expect(201);
    await db.customer.update({
      where: { id: inv.customerId },
      data: { name: 'Client renommé depuis', email: 'actuel@example.test' },
    });
    await call('patch', `${directory}/${address.id}`, {
      operationKey: randomUUID(),
      expectedVersion: 1,
      reason: 'Bureau fermé depuis',
      entry: { ...entry, active: false },
    }).expect(200);
    await call('patch', `${directory}/${contact.id}`, {
      operationKey: randomUUID(),
      expectedVersion: 1,
      reason: 'Contact remplacé depuis',
      entry: { ...contactData, email: 'nouveau@example.test' },
    }).expect(200);
    const note = (await call('post', creditRoute(inv.id), creditBody(inv)).expect(201)).body;
    await call('post', `${creditRoute(inv.id)}/${note.id}/issue`).expect(201);
    const path = `${creditRoute(inv.id)}/${note.id}/document`;
    const context = (await call('get', path).expect(200)).body;
    expect(context.invoiceCoordinates.recipientName).toBe('Credit customer');
    expect(context.invoiceCoordinates.recipientAddress).toContain('42 rue du Parc');
    expect(context.suggestedEmail).toBe('actuel@example.test');
    const { recipientName: _n, recipientAddress: _a, ...issuer } = publication;
    const input = {
      ...issuer,
      recipientSource: 'INVOICE',
      expectedCoordinatesHash: context.invoiceCoordinates.coordinatesHash,
    };
    const invoicePath = `billing/customer-invoices/${inv.id}/document`;
    await call('post', invoicePath, publication).expect(409);
    await call('post', invoicePath, { ...input, expectedCoordinatesHash: 'a'.repeat(64) }).expect(
      409,
    );
    const invoicePublished = (await call('post', invoicePath, input).expect(201)).body;
    expect(invoicePublished.snapshot.identities.recipientName).toBe('Credit customer');
    expect(invoicePublished.capturedContactEmail).toBe('historique@example.test');
    expect(JSON.stringify(invoicePublished.snapshot)).not.toContain('PRIVATE-');
    await call('post', path, { ...input, expectedCoordinatesHash: null }).expect(400);
    await call('post', path, { ...input, expectedCoordinatesHash: 'a'.repeat(64) }).expect(409);
    await call('post', path, { ...input, recipientName: 'Spoof' }).expect(400);
    await call('post', path, { ...input, snapshot: {} }).expect(400);
    await call('post', path, publication).expect(409); // manual override needs its own reason
    await call('post', path, input, 'billingReader').expect(403);
    const storage = jest
      .spyOn(app.get(DocumentsService), 'upload')
      .mockRejectedValueOnce(new Error('Simulated source publication outage'));
    try {
      await call('post', path, input).expect(500);
    } finally {
      storage.mockRestore();
    }
    const frozen = (await call('get', path).expect(200)).body;
    expect(frozen.snapshot.recipientProvenance).toMatchObject({
      kind: 'INVOICE',
      addressEntryId: address.id,
      addressVersion: 1,
      contactEmail: 'historique@example.test',
    });
    expect(frozen.ready).toBe(false);
    const publications = await Promise.all([call('post', path, input), call('post', path, input)]);
    expect(publications.map((r) => r.status)).toEqual([201, 201]);
    expect(publications[0].body.hash).toBe(publications[1].body.hash);
    const published = publications[0].body;
    expect(published.snapshot.identities.recipientName).toBe('Credit customer');
    expect(published.capturedContactEmail).toBe('historique@example.test');
    expect(JSON.stringify(published.snapshot)).not.toContain('PRIVATE-');
    expect(
      await db.emailMessage.count({
        where: { tenantId, relatedType: 'customer-credit', relatedId: note.id },
      }),
    ).toBe(0);
    await call('post', `${path}/send`, {
      to: 'choisi@example.test',
      expectedHash: published.hash,
      expectedChannel: 'log',
      confirmed: true,
    }).expect(201);
    const messages = await db.emailMessage.findMany({
      where: { tenantId, relatedType: 'customer-credit', relatedId: note.id },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].toAddresses).toEqual(['choisi@example.test']);
    // An explicit manual alternative is frozen with its explanation, never mislabeled as invoice copy.
    const manual = (
      await call('post', creditRoute(inv.id), {
        ...creditBody(inv, 1, 1),
        operationKey: randomUUID(),
      }).expect(201)
    ).body;
    await call('post', `${creditRoute(inv.id)}/${manual.id}/issue`).expect(201);
    const manualPublished = (
      await call('post', `${creditRoute(inv.id)}/${manual.id}/document`, {
        ...publication,
        recipientSource: 'MANUAL',
        recipientReason: 'Adresse légale vérifiée séparément',
      }).expect(201)
    ).body;
    expect(manualPublished.snapshot.recipientProvenance).toEqual({
      kind: 'MANUAL',
      reason: 'Adresse légale vérifiée séparément',
    });
    expect(manualPublished.capturedContactEmail).toBe('');
    const withoutCopy = await creditFixture();
    const legacyNote = (
      await call('post', creditRoute(withoutCopy.id), creditBody(withoutCopy)).expect(201)
    ).body;
    await call('post', `${creditRoute(withoutCopy.id)}/${legacyNote.id}/issue`).expect(201);
    await call('post', `${creditRoute(withoutCopy.id)}/${legacyNote.id}/document`, input).expect(
      409,
    );
  });
  it('resumes storage failure from the same frozen identities, and concurrent publication keeps one canonical PDF', async () => {
    const inv = await creditFixture();
    const note = (await call('post', creditRoute(inv.id), creditBody(inv)).expect(201)).body;
    await call('post', `${creditRoute(inv.id)}/${note.id}/issue`).expect(201);
    const path = `${creditRoute(inv.id)}/${note.id}/document`;
    const storage = jest
      .spyOn(app.get(DocumentsService), 'upload')
      .mockRejectedValueOnce(new Error('Simulated storage outage'));
    try {
      await call('post', path, publication).expect(500);
    } finally {
      storage.mockRestore();
    }
    const frozen = (await call('get', path).expect(200)).body;
    expect(frozen.ready).toBe(false);
    expect(frozen.snapshot.identities.issuerName).toBe(publication.issuerName);
    await call('post', path, { ...publication, issuerAddress: 'Changed after outage' }).expect(409);
    const responses = await Promise.all([
      call('post', path, publication),
      call('post', path, publication),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body.hash).toBe(responses[1].body.hash);
    expect(responses[0].body.snapshot).toEqual(frozen.snapshot);
    expect((await call('get', path).expect(200)).body.ready).toBe(true);
  });
  it('publishes one immutable, protected PDF and queues one simulated delivery without any financial or stock mutation', async () => {
    const inv = await creditFixture();
    const note = (await call('post', creditRoute(inv.id), creditBody(inv)).expect(201)).body;
    const path = `${creditRoute(inv.id)}/${note.id}/document`;
    await call('post', path, publication).expect(409);
    await call('post', `${creditRoute(inv.id)}/${note.id}/issue`).expect(201);
    await call('post', path, publication, 'billingReader').expect(403);
    await call('post', path, { ...publication, confirmed: false }).expect(400);
    await call('post', path, { ...publication, issuerTaxIds: '' }).expect(400);
    const before = await db.customerInvoice.findFirstOrThrow({ where: { tenantId, id: inv.id } });
    const published = (await call('post', path, publication).expect(201)).body;
    expect(published).toMatchObject({
      ready: true,
      channel: 'log',
      snapshot: {
        version: 1,
        identities: { issuerName: publication.issuerName },
        totalAmount: '38.33',
      },
    });
    const stored = await db.customerCreditNote.findFirstOrThrow({
      where: { tenantId, id: note.id },
    });
    expect(stored.documentId).toBeTruthy();
    await db.customer.update({ where: { id: inv.customerId }, data: { name: 'Changed customer' } });
    const replay = (await call('post', path, publication).expect(201)).body;
    expect(replay.snapshot).toEqual(published.snapshot);
    expect(replay.hash).toBe(published.hash);
    await call('post', path, { ...publication, issuerName: 'Another issuer' }).expect(409);
    const pdf = await call('get', `${path}/pdf`)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    await call('get', `documents/${stored.documentId}/download`).expect(403);
    await call('get', `documents/${stored.documentId}/download-url`).expect(403);
    await call('delete', `documents/${stored.documentId}`).expect(403);
    await call('post', 'emails', {
      to: ['client@example.test'],
      subject: 'Bypass',
      html: 'No',
      attachments: [{ documentId: stored.documentId, filename: 'credit.pdf' }],
    }).expect(403);
    await call('post', 'emails', {
      to: ['client@example.test'],
      subject: 'Bypass',
      html: 'No',
      relatedType: 'customer-credit',
      relatedId: note.id,
    }).expect(403);
    const input = {
      to: 'client@example.test',
      expectedHash: published.hash,
      expectedChannel: 'log',
      confirmed: true,
    };
    await call('post', `${path}/send`, input, 'billingReader').expect(403);
    await call('post', `${path}/send`, { ...input, expectedHash: 'a'.repeat(64) }).expect(409);
    await call('post', `${path}/send`, { ...input, expectedChannel: 'smtp' }).expect(409);
    const results = await Promise.all([
      call('post', `${path}/send`, input),
      call('post', `${path}/send`, input),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    await call('post', `${path}/send`, { ...input, to: 'another@example.test' }).expect(409);
    const messages = await db.emailMessage.findMany({
      where: { tenantId, relatedType: 'customer-credit', relatedId: note.id },
      include: { attachments: true },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].attachments[0].documentId).toBe(stored.documentId);
    expect(messages[0].deliveryChannel).toBe('log');
    expect(await db.customerInvoice.findFirstOrThrow({ where: { tenantId, id: inv.id } })).toEqual(
      before,
    );
    const foreignInvoice = await creditFixture({ tenant: foreign });
    await call('get', `${creditRoute(foreignInvoice.id)}/${note.id}/document`).expect(404);
    const mod = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'billing' } });
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await call('get', `${path}/pdf`).expect(403);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      data: { enabled: true },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
  });
  const creditBody = (invoice: any, quantity = 1, expectedVersion = 0) => ({
    operationKey: randomUUID(),
    expectedVersion,
    reason: 'Customer correction',
    lines: [{ invoiceLineId: invoice.lines[0].id, quantity }],
  });
  it('credits frozen taxes cumulatively, atomically and idempotently without modifying the original invoice', async () => {
    const inv = await creditFixture();
    for (let i = 0; i < 3; i++) {
      const body = creditBody(inv, 1, i);
      const note = (await call('post', creditRoute(inv.id), body).expect(201)).body;
      expect((await call('post', creditRoute(inv.id), body).expect(201)).body).toMatchObject({
        id: note.id,
        replayed: true,
      });
      await call('post', creditRoute(inv.id), { ...body, reason: 'Changed' }).expect(409);
      const [a, b] = await Promise.all([
        call('post', `${creditRoute(inv.id)}/${note.id}/issue`),
        call('post', `${creditRoute(inv.id)}/${note.id}/issue`),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
      expect(
        await db.journalEntry.count({
          where: { tenantId, sourceType: 'customer-credit', sourceId: note.id },
        }),
      ).toBe(1);
      await call('post', `${creditRoute(inv.id)}/${note.id}/cancel`).expect(409);
    }
    const context = (await call('get', creditRoute(inv.id)).expect(200)).body;
    expect(context).toMatchObject({
      creditedAmount: '114.98',
      outstanding: 0,
      customerCredit: 0,
      invoiceVersion: 3,
    });
    expect(context.lines[0].remainingQuantity).toBe('0');
    const frozen = await db.customerInvoice.findFirstOrThrow({
      where: { tenantId, id: inv.id },
      include: { lines: true },
    });
    expect(frozen.totalAmount.toString()).toBe('114.98');
    expect(frozen.amountPaid.toString()).toBe('0');
    expect(frozen.status).toBe('APPROVED');
    expect(frozen.taxDetail).toEqual(inv.taxDetail);
    expect(frozen.lines).toEqual(inv.lines);
    const entries = await db.journalEntry.findMany({
      where: {
        tenantId,
        OR: [
          { sourceType: 'customer-invoice', sourceId: inv.id },
          { sourceType: 'customer-credit', sourceId: { in: context.notes.map((n: any) => n.id) } },
        ],
      },
      include: { lines: true },
    });
    const balances = new Map<string, number>();
    for (const e of entries)
      for (const l of e.lines)
        balances.set(
          l.accountId,
          (balances.get(l.accountId) ?? 0) + Number(l.debit) - Number(l.credit),
        );
    for (const value of balances.values()) expect(value).toBeCloseTo(0, 6);
    const open = (
      await call(
        'get',
        `billing/payments/open-invoices?partyType=CUSTOMER&partyId=${inv.customerId}`,
      ).expect(200)
    ).body;
    expect(open).toEqual([]);
    await call('post', creditRoute(inv.id), creditBody(inv, 1, 3)).expect(400);
  });
  it('rejects stale competing drafts; cancellation frees no issued quantity', async () => {
    const inv = await creditFixture();
    const a = (await call('post', creditRoute(inv.id), creditBody(inv, 2)).expect(201)).body;
    const b = (await call('post', creditRoute(inv.id), creditBody(inv, 2)).expect(201)).body;
    await call('post', `${creditRoute(inv.id)}/${a.id}/issue`).expect(201);
    await call('post', `${creditRoute(inv.id)}/${b.id}/issue`).expect(409);
    await call('post', `${creditRoute(inv.id)}/${b.id}/cancel`).expect(201);
    expect(
      (await call('post', `${creditRoute(inv.id)}/${b.id}/cancel`).expect(201)).body.replayed,
    ).toBe(true);
    await call('post', `${creditRoute(inv.id)}/${b.id}/issue`).expect(409);
    expect(
      (await call('get', creditRoute(inv.id)).expect(200)).body.lines[0].remainingQuantity,
    ).toBe('1');
  });
  it('enforces tenant ownership, module activation, approval permission and DTO boundaries', async () => {
    const inv = await creditFixture(),
      other = await creditFixture({ tenant: foreign });
    await call('get', creditRoute(other.id)).expect(404);
    await call('post', creditRoute(other.id), creditBody(other)).expect(400);
    await call('post', creditRoute(inv.id), creditBody(other)).expect(400);
    await call('post', creditRoute(inv.id), creditBody(inv), 'reader').expect(403);
    await call('post', creditRoute(inv.id), { ...creditBody(inv), tenantId: foreign }).expect(400);
    await call('post', creditRoute(inv.id), { ...creditBody(inv), reason: '  ' }).expect(400);
    const draft = (
      await call('post', creditRoute(inv.id), creditBody(inv), 'billingReader').expect(201)
    ).body;
    await call(
      'post',
      `${creditRoute(inv.id)}/${draft.id}/issue`,
      undefined,
      'billingReader',
    ).expect(403);
    await call('post', `${creditRoute(other.id)}/${draft.id}/issue`).expect(404);
    const mod = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'billing' } });
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await call('get', creditRoute(inv.id)).expect(403);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      data: { enabled: true },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
  });
  it('rolls back an unpostable credit and keeps paid cash distinct from customer credit', async () => {
    const invalid = await creditFixture({ taxAccount: 'NONEXISTENT' });
    const draft = (await call('post', creditRoute(invalid.id), creditBody(invalid)).expect(201))
      .body;
    await call('post', `${creditRoute(invalid.id)}/${draft.id}/issue`).expect(400);
    expect((await call('get', creditRoute(invalid.id)).expect(200)).body).toMatchObject({
      creditedAmount: '0',
      invoiceVersion: 0,
      notes: [{ status: 'DRAFT' }],
    });
    expect(
      await db.journalEntry.count({
        where: { tenantId, sourceId: { in: [invalid.id, draft.id] } },
      }),
    ).toBe(0);
    const paid = await creditFixture({ paid: true });
    const credit = (await call('post', creditRoute(paid.id), creditBody(paid, 3)).expect(201)).body;
    const before = await db.payment.count({ where: { tenantId } });
    await call('post', `${creditRoute(paid.id)}/${credit.id}/issue`).expect(201);
    expect((await call('get', creditRoute(paid.id)).expect(200)).body).toMatchObject({
      status: 'PAID',
      amountPaid: '114.98',
      creditedAmount: '114.98',
      outstanding: 0,
      customerCredit: 114.98,
    });
    expect(await db.payment.count({ where: { tenantId } })).toBe(before);
  });
  it('caps a payment against the credited balance and restores only cash on cancellation', async () => {
    const inv = await creditFixture();
    const note = (await call('post', creditRoute(inv.id), creditBody(inv)).expect(201)).body;
    await call('post', `${creditRoute(inv.id)}/${note.id}/issue`).expect(201);
    const mode = (
      await call('post', 'billing/modes-of-payment', {
        name: randomUUID(),
        accountCode: '1000',
      }).expect(201)
    ).body;
    const payment = async (amount: number) =>
      (
        await call('post', 'billing/payments', {
          type: 'RECEIVE',
          partyType: 'CUSTOMER',
          partyId: inv.customerId,
          modeOfPaymentId: mode.id,
          date: '2026-09-22',
          currency: 'CAD',
          totalAmount: amount,
          allocations: [{ targetType: 'CUSTOMER_INVOICE', targetId: inv.id, amount }],
        }).expect(201)
      ).body;
    const tooMuch = await payment(114.98);
    await call('post', `billing/payments/${tooMuch.id}/submit`).expect(400);
    const due = (await call('get', creditRoute(inv.id)).expect(200)).body.outstanding;
    expect(due).toBe(76.65);
    const exact = await payment(due);
    await call('post', `billing/payments/${exact.id}/submit`).expect(201);
    expect((await call('get', creditRoute(inv.id)).expect(200)).body).toMatchObject({
      status: 'APPROVED',
      amountPaid: '76.65',
      creditedAmount: '38.33',
      outstanding: 0,
    });
    await call('post', `billing/payments/${exact.id}/cancel`).expect(201);
    expect((await call('get', creditRoute(inv.id)).expect(200)).body).toMatchObject({
      amountPaid: '0',
      creditedAmount: '38.33',
      outstanding: 76.65,
    });
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
