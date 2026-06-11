/**
 * E2E for phase 6 — carrier invoice reconciliation: tolerance on the GROSS
 * variance (compensating errors caught), corrected-invoice re-reconcile,
 * dispute resolution, payment, CSV export.
 * Prerequisites: reachable PostgreSQL with the seed applied (admin role must
 * hold billing.invoices.pay — reseed after the permission catalog change).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 6 — billing reconciliation (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P6B${Date.now().toString(36).toUpperCase()}`;
  const ids = { customer: '', origin: '', destination: '', carrier: '', rate: '' };
  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** Runs one order through to a COMPLETED load (FLAT 800 → estimatedCost 800). */
  async function completedLoad(): Promise<string> {
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
      })
      .expect(201);
    const orderId = order.body.id;
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${orderId}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${orderId}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    const shipmentId = planned.body.shipments[0].id;
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
      .set(auth())
      .send({ loadId: load.body.id })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier, rateId: ids.rate })
      .expect(201);
    for (const verb of ['dispatch', 'start-transit', 'complete']) {
      await request(http)
        .post(`/api/v1/transportation/loads/${load.body.id}/${verb}`)
        .set(auth())
        .expect(201);
    }
    return load.body.id;
  }

  async function draftInvoice(): Promise<{ id: string; lines: { id: string }[] }> {
    const invoice = await request(http)
      .post('/api/v1/billing/invoices/draft')
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);
    return invoice.body;
  }

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

    await request(http)
      .patch('/api/v1/modules/billing')
      .set(auth())
      .send({ enabled: true })
      .expect(200);

    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'Recon Customer' })
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
      .send({ code: `${suffix}-CARR`, name: 'Recon Carrier' })
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

  it('within tolerance → auto-approved → paid', async () => {
    await completedLoad();
    const invoice = await draftInvoice();
    const reconciled = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/reconcile`)
      .set(auth())
      .send({
        carrierInvoiceNumber: `${suffix}-CARRINV-1`,
        // 810 vs 800: gross 10 ≤ max(25, 2% × 810) → approved automatically
        lines: [{ lineId: invoice.lines[0].id, invoicedAmount: 810 }],
      })
      .expect(201);
    expect(reconciled.body.status).toBe('APPROVED');
    expect(Number(reconciled.body.varianceGross)).toBe(10);

    const paid = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/mark-paid`)
      .set(auth())
      .send({})
      .expect(201);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.paidAt).toBeTruthy();
    await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/mark-paid`)
      .set(auth())
      .send({})
      .expect(400);
  });

  it('compensating line errors (net 0) go to DISPUTED — the blind-spot test', async () => {
    await completedLoad();
    await completedLoad();
    const invoice = await draftInvoice();
    expect(invoice.lines).toHaveLength(2);
    const reconciled = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/reconcile`)
      .set(auth())
      .send({
        carrierInvoiceNumber: `${suffix}-CARRINV-2`,
        lines: [
          { lineId: invoice.lines[0].id, invoicedAmount: 900 }, // +100
          { lineId: invoice.lines[1].id, invoicedAmount: 700 }, // −100
        ],
      })
      .expect(201);
    expect(Number(reconciled.body.varianceTotal)).toBe(0);
    expect(Number(reconciled.body.varianceGross)).toBe(200);
    expect(reconciled.body.status).toBe('DISPUTED');
    expect(reconciled.body.disputeReasonCode).toBeNull();

    // The carrier sends a corrected invoice: re-reconcile from DISPUTED.
    const corrected = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/reconcile`)
      .set(auth())
      .send({
        carrierInvoiceNumber: `${suffix}-CARRINV-2b`,
        lines: [
          { lineId: invoice.lines[0].id, invoicedAmount: 800 },
          { lineId: invoice.lines[1].id, invoicedAmount: 800 },
        ],
      })
      .expect(201);
    expect(corrected.body.status).toBe('APPROVED');
  });

  it('over tolerance → DISPUTED → human resolution (pay invoiced) → paid', async () => {
    await completedLoad();
    const invoice = await draftInvoice();
    const disputed = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/reconcile`)
      .set(auth())
      .send({
        carrierInvoiceNumber: `${suffix}-CARRINV-3`,
        lines: [{ lineId: invoice.lines[0].id, invoicedAmount: 900 }],
      })
      .expect(201);
    expect(disputed.body.status).toBe('DISPUTED');

    const resolved = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/resolve-dispute`)
      .set(auth())
      .send({ resolution: 'ACCEPT_INVOICED', reasonCode: 'RATE_MISMATCH', note: 'Fuel revision' })
      .expect(201);
    expect(resolved.body.status).toBe('APPROVED');
    expect(Number(resolved.body.totalAmount)).toBe(900);
    expect(resolved.body.disputeReasonCode).toBe('RATE_MISMATCH');

    await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/mark-paid`)
      .set(auth())
      .send({})
      .expect(201);
  });

  it('exports the filtered list as CSV', async () => {
    const res = await request(http)
      .get('/api/v1/billing/invoices/export.csv?status=PAID')
      .set(auth())
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toContain('invoiceNumber');
    expect(res.text).toContain(`${suffix}-CARRINV-1`);
  });
});
