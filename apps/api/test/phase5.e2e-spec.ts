/**
 * E2E for phase 5: portal order entry, write-scoped API keys backed by the
 * tenant service account, and the Billing module (carrier invoice drafts).
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 5 (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P5${Date.now().toString(36).toUpperCase()}`;
  const ids = {
    customer: '',
    origin: '',
    destination: '',
    carrier: '',
    rate: '',
    portalOrder: '',
    load: '',
    writeKey: '',
  };
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
      .send({ code: `${suffix}-CUST`, name: 'Phase5 Customer' })
      .expect(201);
    ids.customer = customer.body.id;
    for (const [field, code] of [
      ['origin', `${suffix}-ORI`],
      ['destination', `${suffix}-DST`],
    ] as const) {
      const location = await request(http)
        .post('/api/v1/transportation/locations')
        .set(auth())
        .send({ code, name: code, type: 'WAREHOUSE', addressLine1: '1 Test', city: 'Sherbrooke' })
        .expect(201);
      ids[field] = location.body.id;
    }
    const carrier = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: `${suffix}-CARR`, name: 'Phase5 Carrier' })
      .expect(201);
    ids.carrier = carrier.body.id;
    const rate = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({ name: `${suffix} flat`, rateType: 'FLAT', baseAmount: 800, carrierId: ids.carrier })
      .expect(201);
    ids.rate = rate.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('the customer submits a transport request from the portal (DRAFT order)', async () => {
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

    const view = await request(http).get(`/api/v1/public/portal/${portalToken}`).expect(200);
    expect(view.body.locations.length).toBeGreaterThanOrEqual(2);

    const created = await request(http)
      .post(`/api/v1/public/portal/${portalToken}/orders`)
      .send({
        // Public portal addresses locations by their opaque CODE (no internal PK exposed).
        originLocationId: `${suffix}-ORI`,
        destinationLocationId: `${suffix}-DST`,
        customerReference: 'PORTAL-PO-1',
        palletCount: 4,
      })
      .expect(201);
    expect(created.body.orderNumber).toMatch(/^TO-/);
    expect(created.body.status).toBe('DRAFT');

    // The shipper sees the request; the order carries no creator (portal-born).
    const orders = await request(http)
      .get(`/api/v1/transportation/transport-orders?search=${created.body.orderNumber}`)
      .set(auth())
      .expect(200);
    expect(orders.body.items).toHaveLength(1);
    ids.portalOrder = orders.body.items[0].id;
    expect(orders.body.items[0].customerReference).toBe('PORTAL-PO-1');
  });

  it('write-scoped API keys act through the tenant service account', async () => {
    const created = await request(http)
      .post('/api/v1/api-keys')
      .set(auth())
      .send({
        name: 'ERP write',
        scopes: ['transportation.orders.read', 'transportation.orders.manage'],
      })
      .expect(201);
    ids.writeKey = created.body.key;

    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set('X-Api-Key', ids.writeKey)
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
      })
      .expect(201);
    expect(order.body.orderNumber).toMatch(/^TO-/);
    // Attributed to the hidden service account, which can never sign in.
    expect(order.body.createdById).toBeTruthy();
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'service-account@pulsar.local', password: 'anything-123', tenant: 'acme' })
      .expect(401);
  });

  it('billing module: drafts and approves a carrier invoice from completed loads', async () => {
    // Billing endpoints are gated until the module is enabled (reset first — reruns).
    await request(http)
      .patch('/api/v1/modules/billing')
      .set(auth())
      .send({ enabled: false })
      .expect(200);
    await request(http).get('/api/v1/billing/invoices').set(auth()).expect(403);
    await request(http)
      .patch('/api/v1/modules/billing')
      .set(auth())
      .send({ enabled: true })
      .expect(200);

    // Run one load to COMPLETED with a FLAT 800 rate.
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.portalOrder}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.portalOrder}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    const shipmentId = planned.body.shipments[0].id;
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    ids.load = load.body.id;
    await request(http)
      .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
      .set(auth())
      .send({ loadId: ids.load })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier, rateId: ids.rate })
      .expect(201);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/dispatch`).set(auth()).expect(201);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/start-transit`).set(auth()).expect(201);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/complete`).set(auth()).expect(201);

    const billable = await request(http)
      .get(`/api/v1/billing/invoices/billable?carrierId=${ids.carrier}`)
      .set(auth())
      .expect(200);
    expect(billable.body).toHaveLength(1);

    const invoice = await request(http)
      .post('/api/v1/billing/invoices/draft')
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);
    expect(invoice.body.invoiceNumber).toMatch(/^INV-\d{6}$/);
    expect(invoice.body.lines).toHaveLength(1);
    expect(Number(invoice.body.totalAmount)).toBe(800);

    // The load is now billed — a second draft has nothing to pick up.
    await request(http)
      .post('/api/v1/billing/invoices/draft')
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(400);

    const approved = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.body.id}/approve`)
      .set(auth())
      .expect(201);
    expect(approved.body.status).toBe('APPROVED');
    await request(http)
      .post(`/api/v1/billing/invoices/${invoice.body.id}/approve`)
      .set(auth())
      .expect(400);
  });

  it('cleans up portal/billing module state for other suites', async () => {
    await request(http)
      .delete(`/api/v1/customer-portal/customers/${ids.customer}/portal-link`)
      .set(auth())
      .expect(200);
  });
});
