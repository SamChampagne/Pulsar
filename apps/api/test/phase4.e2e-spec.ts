/**
 * E2E for phase 4: inbound API keys (read-only scopes), the Customer Portal
 * module (per-tenant activation), post-planning shipment management,
 * declarative audit, and pre-signed URL fallbacks on the local driver.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 4 (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P4${Date.now().toString(36).toUpperCase()}`;
  const ids = { customer: '', origin: '', destination: '', order: '', apiKey: '', rawKey: '' };
  let portalToken = '';

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;

    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'Phase4 Customer' })
      .expect(201);
    ids.customer = customer.body.id;
    for (const [field, code] of [
      ['origin', `${suffix}-ORI`],
      ['destination', `${suffix}-DST`],
    ] as const) {
      const location = await request(http)
        .post('/api/v1/transportation/locations')
        .set(auth())
        .send({ code, name: code, type: 'WAREHOUSE', addressLine1: '1 Test', city: 'Gatineau' })
        .expect(201);
      ids[field] = location.body.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('declarative audit logs master-data creations', async () => {
    const logs = await request(http)
      .get(`/api/v1/audit-logs?entityType=customer&entityId=${ids.customer}`)
      .set(auth())
      .expect(200);
    expect(logs.body.items.length).toBeGreaterThanOrEqual(1);
    expect(logs.body.items[0].action).toBe('CREATE');
  });

  it('creates a read-only API key and uses it via X-Api-Key', async () => {
    // Unknown scopes are refused.
    await request(http)
      .post('/api/v1/api-keys')
      .set(auth())
      .send({ name: 'bad', scopes: ['not.a.permission'] })
      .expect(400);

    const created = await request(http)
      .post('/api/v1/api-keys')
      .set(auth())
      .send({ name: 'ERP read', scopes: ['transportation.orders.read'] })
      .expect(201);
    ids.apiKey = created.body.id;
    ids.rawKey = created.body.key;
    expect(ids.rawKey).toMatch(/^pk_/);

    // The key reads orders without a JWT…
    const orders = await request(http)
      .get('/api/v1/transportation/transport-orders')
      .set('X-Api-Key', ids.rawKey)
      .expect(200);
    expect(orders.body.total).toBeGreaterThanOrEqual(0);

    // …but cannot reach endpoints outside its scopes.
    await request(http)
      .get('/api/v1/transportation/customers')
      .set('X-Api-Key', ids.rawKey)
      .expect(403);
    await request(http)
      .post('/api/v1/transportation/customers')
      .set('X-Api-Key', ids.rawKey)
      .send({ code: 'X', name: 'X' })
      .expect(403);
  });

  it('revoked API keys stop working', async () => {
    await request(http).delete(`/api/v1/api-keys/${ids.apiKey}`).set(auth()).expect(200);
    await request(http)
      .get('/api/v1/transportation/transport-orders')
      .set('X-Api-Key', ids.rawKey)
      .expect(401);
    await request(http)
      .get('/api/v1/transportation/transport-orders')
      .set('X-Api-Key', 'pk_forged')
      .expect(401);
  });

  it('manages shipments after planning (add + cancel)', async () => {
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        palletCount: 10,
      })
      .expect(201);
    ids.order = order.body.id;
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/confirm`)
      .set(auth())
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/plan`)
      .set(auth())
      .send({})
      .expect(201);

    const added = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/shipments`)
      .set(auth())
      .send({ weightKg: 500, palletCount: 2 })
      .expect(201);
    expect(added.body.shipmentNumber).toMatch(/^SH-/);

    const cancelled = await request(http)
      .post(`/api/v1/transportation/shipments/${added.body.id}/cancel`)
      .set(auth())
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');

    const detail = await request(http)
      .get(`/api/v1/transportation/transport-orders/${ids.order}`)
      .set(auth())
      .expect(200);
    expect(detail.body.shipments).toHaveLength(2);
  });

  it('gates the customer portal on module activation', async () => {
    // Reset first (other suites/runs may have left the module enabled).
    await request(http)
      .patch('/api/v1/modules/customer-portal')
      .set(auth())
      .send({ enabled: false })
      .expect(200);
    // Module disabled → management endpoint refused by ModulesGuard.
    await request(http)
      .post(`/api/v1/customer-portal/customers/${ids.customer}/portal-link`)
      .set(auth())
      .expect(403);

    await request(http)
      .patch('/api/v1/modules/customer-portal')
      .set(auth())
      .send({ enabled: true })
      .expect(200);

    const link = await request(http)
      .post(`/api/v1/customer-portal/customers/${ids.customer}/portal-link`)
      .set(auth())
      .expect(201);
    portalToken = link.body.url.split('/portal/')[1];
  });

  it('serves the public portal view without tenant leaks', async () => {
    const view = await request(http).get(`/api/v1/public/portal/${portalToken}`).expect(200);
    expect(view.body.customer).toBe('Phase4 Customer');
    expect(view.body.orders.length).toBeGreaterThanOrEqual(1);
    expect(view.body.orders[0].shipments.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(view.body)).not.toContain('tenantId');

    // Disabling the module kills the public page too (checked in the service).
    await request(http)
      .patch('/api/v1/modules/customer-portal')
      .set(auth())
      .send({ enabled: false })
      .expect(200);
    await request(http).get(`/api/v1/public/portal/${portalToken}`).expect(403);

    // Re-enable and revoke the link.
    await request(http)
      .patch('/api/v1/modules/customer-portal')
      .set(auth())
      .send({ enabled: true })
      .expect(200);
    await request(http)
      .delete(`/api/v1/customer-portal/customers/${ids.customer}/portal-link`)
      .set(auth())
      .expect(200);
    await request(http).get(`/api/v1/public/portal/${portalToken}`).expect(404);
  });

  it('pre-signed URLs degrade gracefully on the local storage driver', async () => {
    await request(http)
      .post('/api/v1/documents/presign-upload')
      .set(auth())
      .send({ entityType: 'load', entityId: 'x', fileName: 'a.pdf', mimeType: 'application/pdf' })
      .expect(400);

    const uploaded = await request(http)
      .post('/api/v1/documents/upload')
      .set(auth())
      .field('entityType', 'transport-order')
      .field('entityId', ids.order)
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'bol.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const url = await request(http)
      .get(`/api/v1/documents/${uploaded.body.id}/download-url`)
      .set(auth())
      .expect(200);
    expect(url.body.presigned).toBe(false);
    expect(url.body.url).toContain(`/documents/${uploaded.body.id}/download`);
  });
});
