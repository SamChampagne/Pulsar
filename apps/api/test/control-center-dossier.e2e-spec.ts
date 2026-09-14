/** Read-only ops + dossier contracts. Run against a disposable, migrated test DB. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PERMISSION_CATALOG, PERMISSIONS } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { ApsRuntimeService } from '../src/core/aps/aps-runtime.service';

describe('Control Center and connected dossiers', () => {
  let app: INestApplication;
  let db: PrismaService;
  let jwt: JwtService;
  let tenantId: string, otherTenant: string, token: string, platform: string;
  let order: string, sale: string, shipment: string, load: string, invoice: string;
  let billingModule: string;
  let platformUserId: string;
  const suffix = `ops-${Date.now().toString(36)}`;
  const http = () => app.getHttpServer();
  const dossier = (auth = token, type = 'SALES_ORDER', id = sale) =>
    request(http())
      .get('/api/v1/analytics/flow/dossier')
      .query({ entityType: type, entityId: id })
      .auth(auth, { type: 'bearer' });
  const limited = (permissions: string[], tenant = tenantId) =>
    jwt.sign(
      { sub: 'read-only-fixture', tenantId: tenant, email: 'fixture@example.test', permissions },
      { expiresIn: '5m' },
    );

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ApsRuntimeService)
      .useValue({
        status: async () => ({
          installed: true,
          managed: true,
          healthy: true,
          dbReady: false,
          port: '8099',
        }),
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    db = app.get(PrismaService);
    jwt = new JwtService({ secret: app.get(ConfigService).getOrThrow('JWT_SECRET') });
    tenantId = (
      await db.tenant.create({
        data: { slug: suffix, name: 'Control Center fixture', status: 'ACTIVE' },
      })
    ).id;
    otherTenant = (
      await db.tenant.create({
        data: { slug: `${suffix}-other`, name: 'Foreign fixture', status: 'ACTIVE' },
      })
    ).id;
    const modules = await db.moduleDefinition.findMany({
      where: { key: { in: ['core', 'analytics', 'crm', 'transportation', 'wms', 'billing'] } },
    });
    billingModule = modules.find((m) => m.key === 'billing')!.id;
    for (const tenant of [tenantId, otherTenant])
      await db.tenantModule.createMany({
        data: modules.map((m) => ({ tenantId: tenant, moduleId: m.id, enabled: true })),
      });
    token = limited(PERMISSION_CATALOG.map((p) => p.key));
    platformUserId = (
      await db.platformUser.create({
        data: {
          email: `${suffix}@example.test`,
          passwordHash: 'not-loginable-fixture',
          firstName: 'Test',
          lastName: 'Operator',
          status: 'ACTIVE',
        },
      })
    ).id;
    platform = jwt.sign(
      { sub: platformUserId, email: `${suffix}@example.test`, platformAdmin: true },
      { expiresIn: '5m' },
    );
    const customer = await db.customer.create({
      data: { tenantId, code: suffix, name: 'Test customer' },
    });
    const company = await db.crmCompany.create({ data: { tenantId, name: 'Test company' } });
    const location = await db.location.create({
      data: {
        tenantId,
        code: suffix,
        name: 'Warehouse',
        type: 'WAREHOUSE',
        addressLine1: '1 Test',
        city: 'Montreal',
        country: 'CA',
      },
    });
    const so = await db.salesOrder.create({
      data: {
        tenantId,
        number: 'SO-TEST',
        status: 'FULFILLED',
        companyId: company.id,
        customerId: customer.id,
      },
    });
    sale = so.id;
    const to = await db.transportOrder.create({
      data: {
        tenantId,
        orderNumber: 'TO-TEST',
        status: 'COMPLETED',
        sourceSalesOrderId: sale,
        customerId: customer.id,
        originLocationId: location.id,
        destinationLocationId: location.id,
      },
    });
    order = to.id;
    load = (
      await db.load.create({ data: { tenantId, loadNumber: 'LD-TEST', status: 'COMPLETED' } })
    ).id;
    shipment = (
      await db.shipment.create({
        data: {
          tenantId,
          shipmentNumber: 'SH-TEST',
          transportOrderId: order,
          status: 'DELIVERED',
          originLocationId: location.id,
          destinationLocationId: location.id,
          loadId: load,
        },
      })
    ).id;
    await db.pickOrder.create({
      data: {
        tenantId,
        number: 'PK-TEST',
        locationId: location.id,
        shipmentId: shipment,
        status: 'COMPLETED',
      },
    });
    invoice = (
      await db.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: 'CI-TEST',
          customerId: customer.id,
          totalAmount: 100,
          status: 'PAID',
          lines: { create: { transportOrderId: order, description: 'Fixture', amount: 100 } },
        },
      })
    ).id;
    await db.domainEvent.create({
      data: {
        tenantId,
        type: 'transport-order.completed',
        subjectType: 'transport-order',
        subjectId: order,
        status: 'FAILED',
        payload: { secret: 'DO_NOT_PROJECT_PAYLOAD' },
        lastError: 'DO_NOT_PROJECT_ERROR',
      },
    });
    await db.domainEvent.create({
      data: {
        tenantId: otherTenant,
        type: 'foreign-secret-event',
        subjectType: 'transport-order',
        subjectId: order,
        status: 'FAILED',
        payload: {},
      },
    });
    await db.operationalTask.create({
      data: {
        tenantId,
        type: 'EXCEPTION',
        category: 'DELAY',
        title: 'Fixture task',
        subjectType: 'transport-order',
        subjectId: order,
        dedupKey: suffix,
        assigneeType: 'UNASSIGNED',
      },
    });
  }, 60000);

  afterAll(async () => {
    if (db && tenantId) {
      await db.operationalTask.deleteMany({ where: { tenantId } });
      await db.domainEvent.deleteMany({ where: { tenantId: { in: [tenantId, otherTenant] } } });
      await db.customerInvoice.deleteMany({ where: { tenantId } });
      await db.pickOrder.deleteMany({ where: { tenantId } });
      await db.shipment.deleteMany({ where: { tenantId } });
      await db.load.deleteMany({ where: { tenantId } });
      await db.transportOrder.deleteMany({ where: { tenantId } });
      await db.salesOrder.deleteMany({ where: { tenantId } });
      await db.crmCompany.deleteMany({ where: { tenantId } });
      await db.customer.deleteMany({ where: { tenantId } });
      await db.location.deleteMany({ where: { tenantId } });
      await db.tenantModule.deleteMany({ where: { tenantId: { in: [tenantId, otherTenant] } } });
      await db.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenant] } } });
    }
    if (platformUserId) await db.platformUser.delete({ where: { id: platformUserId } });
    await app?.close();
  });

  it('protects platform diagnostics from anonymous and tenant credentials', async () => {
    for (const path of ['/platform/operations', `/platform/operations/tenants/${tenantId}`]) {
      await request(http()).get(`/api/v1${path}`).expect(401);
      await request(http()).get(`/api/v1${path}`).auth(token, { type: 'bearer' }).expect(401);
    }
  });
  it('rejects MFA step tokens and platform tokens on tenant endpoints', async () => {
    const step = jwt.sign({ sub: 'test', platformAdmin: true, scope: 'mfa-pending' });
    await request(http())
      .get('/api/v1/platform/operations')
      .auth(step, { type: 'bearer' })
      .expect(401);
    await dossier(platform).expect(401);
  });
  it('reports APS degradation without leaking configuration or raw errors', async () => {
    const { body } = await request(http())
      .get('/api/v1/platform/operations')
      .auth(platform, { type: 'bearer' })
      .expect(200);
    expect(body.services.find((s: any) => s.key === 'aps').state).toBe('DEGRADED');
    expect(body.services.find((s: any) => s.key === 'backup').state).toBe('UNVERIFIED');
    expect(body.queuesAvailable).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(
      /DO_NOT_PROJECT|DATABASE_URL|apiKeyEnc|secretHash|serviceUserId/,
    );
  });
  it('immediately rejects a disabled platform operator', async () => {
    await db.platformUser.update({ where: { id: platformUserId }, data: { status: 'DISABLED' } });
    try {
      await request(http())
        .get('/api/v1/platform/operations')
        .auth(platform, { type: 'bearer' })
        .expect(401);
    } finally {
      await db.platformUser.update({ where: { id: platformUserId }, data: { status: 'ACTIVE' } });
    }
  });
  it('scopes company diagnostics and keeps no runtime distinct from verified', async () => {
    const { body } = await request(http())
      .get(`/api/v1/platform/operations/tenants/${tenantId}`)
      .auth(platform, { type: 'bearer' })
      .expect(200);
    expect(body.runtime).toEqual({ configured: false, lastTestAt: null, lastTestOk: null });
    expect(body.queues.find((q: any) => q.key === 'events').failed).toBe(1);
  });
  it('connects sale, transport, shipment, warehouse, load and paid invoice', async () => {
    const { body } = await dossier().expect(200);
    expect(body.root.id).toBe(sale);
    expect(body.entities.map((e: any) => e.type)).toEqual(
      expect.arrayContaining([
        'SALES_ORDER',
        'TRANSPORT_ORDER',
        'SHIPMENT',
        'LOAD',
        'PICK_ORDER',
        'CUSTOMER_INVOICE',
      ]),
    );
    expect(body.entities.find((e: any) => e.id === invoice).status).toBe('PAID');
    expect(body.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: `SALES_ORDER:${sale}`, to: `TRANSPORT_ORDER:${order}` }),
      ]),
    );
    expect(body.activity.some((a: any) => a.kind === 'task')).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/DO_NOT_PROJECT|foreign-secret-event/);
  });
  it.each(['TRANSPORT_ORDER', 'SHIPMENT', 'LOAD'])(
    'resolves %s without choosing a fake root',
    async (type) => {
      const id = type === 'TRANSPORT_ORDER' ? order : type === 'SHIPMENT' ? shipment : load;
      const { body } = await dossier(token, type, id).expect(200);
      expect(body.root.id).toBe(id);
      expect(body.entities.some((e: any) => e.id === sale)).toBe(true);
    },
  );
  it('rejects cross-tenant root IDs', async () => {
    await dossier(
      limited(
        PERMISSION_CATALOG.map((p) => p.key),
        otherTenant,
      ),
    ).expect(404);
  });
  it('requires analytics and root-module permissions', async () => {
    await dossier(limited([PERMISSIONS.CRM.READ])).expect(403);
    await dossier(limited([PERMISSIONS.ANALYTICS.READ])).expect(403);
  });
  it('does not leak linked modules to a CRM-only reader', async () => {
    const { body } = await dossier(
      limited([PERMISSIONS.ANALYTICS.READ, PERMISSIONS.CRM.READ]),
    ).expect(200);
    expect(body.entities.map((e: any) => e.type)).toEqual(['SALES_ORDER']);
    expect(body.links).toEqual([]);
    expect(body.activity).toEqual([]);
  });
  it('hides billing data when the module is disabled', async () => {
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId: billingModule } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    try {
      const { body } = await dossier().expect(200);
      expect(body.entities.some((e: any) => e.type === 'CUSTOMER_INVOICE')).toBe(false);
    } finally {
      await db.tenantModule.update({
        where: { tenantId_moduleId: { tenantId, moduleId: billingModule } },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(tenantId);
    }
  });
  it('validates root inputs rather than silently falling back to a load', async () => {
    await dossier(token, 'UNKNOWN', sale).expect(400);
    await request(http())
      .get('/api/v1/analytics/flow/dossier')
      .auth(token, { type: 'bearer' })
      .expect(400);
  });
});
