/**
 * E2E for phase 7.3 — sell-side billing: rating-priced drafts, geographic currency
 * split, draft escape, frozen snapshot invariant, full lifecycle (approve→send→pay).
 * Prerequisites: reachable PostgreSQL with the seed applied
 * (admin@pulsar.dev / admin123, tenant: acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 7.3 — sell-side statements (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P73${Date.now().toString(36).toUpperCase()}`;

  const ids = {
    customer1: '',
    customer2: '',
    // Locations for the CAD lane (orders A and B)
    origin: '',
    destination: '',
    // Extra locations for the USD lane (order C — geographic split)
    originC: '',
    destinationC: '',
    carrier: '',
    cadLane: '',
    usdLane: '',
    cadRate: '',
    usdRate: '',
    // Invoices created during the suite
    cadInvoice: '',
    usdInvoice: '',
  };

  const auth = () => ({ Authorization: `Bearer ${token}` });

  // ---------------------------------------------------------------------------
  // Helper: run a transport order through to COMPLETED (delivers it so it becomes
  // billable on the sell-side).  Returns the orderId.
  // ---------------------------------------------------------------------------
  async function deliverOrder(customerId: string, originId: string, destinationId: string): Promise<string> {
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({ customerId, originLocationId: originId, destinationLocationId: destinationId })
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
    const loadId = load.body.id;

    await request(http)
      .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
      .set(auth())
      .send({ loadId })
      .expect(201);

    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);

    for (const verb of ['dispatch', 'start-transit', 'complete']) {
      await request(http)
        .post(`/api/v1/transportation/loads/${loadId}/${verb}`)
        .set(auth())
        .expect(201);
    }

    return orderId;
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    // Authenticate
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;

    // Enable billing module
    await request(http)
      .patch('/api/v1/modules/billing')
      .set(auth())
      .send({ enabled: true })
      .expect(200);

    // Customer 1 — has a rate, has email for the send() step
    const c1 = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-C1`, name: 'P73 Customer 1', email: `p73-${suffix}@example.test` })
      .expect(201);
    ids.customer1 = c1.body.id;

    // Customer 2 — no rate at all (unratable)
    const c2 = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-C2`, name: 'P73 Customer 2' })
      .expect(201);
    ids.customer2 = c2.body.id;

    // Locations for the CAD lane (city: CityA → CityB)
    const origin = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-ORI`,
        name: 'P73 Origin',
        type: 'WAREHOUSE',
        addressLine1: '1 Test St',
        city: `CityA-${suffix}`,
        state: 'QC',
        country: 'CA',
      })
      .expect(201);
    ids.origin = origin.body.id;

    const destination = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-DST`,
        name: 'P73 Destination',
        type: 'WAREHOUSE',
        addressLine1: '2 Test St',
        city: `CityB-${suffix}`,
        state: 'QC',
        country: 'CA',
      })
      .expect(201);
    ids.destination = destination.body.id;

    // Locations for the USD lane (city: CityC → CityD) — used only for order C
    const originC = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-ORC`,
        name: 'P73 Origin C',
        type: 'WAREHOUSE',
        addressLine1: '3 Test St',
        city: `CityC-${suffix}`,
        state: 'ON',
        country: 'CA',
      })
      .expect(201);
    ids.originC = originC.body.id;

    const destinationC = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-DSC`,
        name: 'P73 Destination C',
        type: 'WAREHOUSE',
        addressLine1: '4 Test St',
        city: `CityD-${suffix}`,
        state: 'ON',
        country: 'CA',
      })
      .expect(201);
    ids.destinationC = destinationC.body.id;

    // A carrier (needed for load assignment — carrier-side assign does not cost here)
    const carrier = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: `${suffix}-CARR`, name: 'P73 Carrier' })
      .expect(201);
    ids.carrier = carrier.body.id;

    // CAD CITY lane: CityA → CityB
    const cadLane = await request(http)
      .post('/api/v1/transportation/lanes')
      .set(auth())
      .send({
        name: `P73 CAD lane ${suffix}`,
        originType: 'CITY',
        origin: { city: `CityA-${suffix}`, state: 'QC', country: 'CA' },
        destinationType: 'CITY',
        destination: { city: `CityB-${suffix}`, state: 'QC', country: 'CA' },
      })
      .expect(201);
    ids.cadLane = cadLane.body.id;

    // USD CITY lane: CityC → CityD (geographic split)
    const usdLane = await request(http)
      .post('/api/v1/transportation/lanes')
      .set(auth())
      .send({
        name: `P73 USD lane ${suffix}`,
        originType: 'CITY',
        origin: { city: `CityC-${suffix}`, state: 'ON', country: 'CA' },
        destinationType: 'CITY',
        destination: { city: `CityD-${suffix}`, state: 'ON', country: 'CA' },
      })
      .expect(201);
    ids.usdLane = usdLane.body.id;

    // Customer rate #1: FLAT 500 CAD on the CAD lane, scoped to customer1
    const cadRate = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} CAD flat`,
        rateType: 'FLAT',
        baseAmount: 500,
        currency: 'CAD',
        customerId: ids.customer1,
        laneId: ids.cadLane,
      })
      .expect(201);
    ids.cadRate = cadRate.body.id;
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.cadRate}`)
      .set(auth())
      .send({ status: 'ACTIVE' })
      .expect(200);

    // Customer rate #2: FLAT 400 USD on the USD lane, scoped to customer1
    const usdRate = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} USD flat`,
        rateType: 'FLAT',
        baseAmount: 400,
        currency: 'USD',
        customerId: ids.customer1,
        laneId: ids.usdLane,
      })
      .expect(201);
    ids.usdRate = usdRate.body.id;
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.usdRate}`)
      .set(auth())
      .send({ status: 'ACTIVE' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Test 1 — billable preview: ratable vs unratable
  // ---------------------------------------------------------------------------
  it('billable preview: ratable order shows amount; unratable order shows NO_APPLICABLE_RATE', async () => {
    // Deliver one order for customer1 (CAD lane) and one for customer2 (no rate)
    await deliverOrder(ids.customer1, ids.origin, ids.destination); // order A
    await deliverOrder(ids.customer2, ids.origin, ids.destination); // order U (no customer rate)

    const c1Preview = await request(http)
      .get(`/api/v1/billing/customer-invoices/billable?customerId=${ids.customer1}`)
      .set(auth())
      .expect(200);
    expect(c1Preview.body.ratable.length).toBeGreaterThanOrEqual(1);
    expect(c1Preview.body.unratable).toHaveLength(0);
    const ratableA = c1Preview.body.ratable.find((r: { amount: number; currency: string }) => r.amount === 500);
    expect(ratableA).toBeDefined();
    expect(ratableA.currency).toBe('CAD');

    const c2Preview = await request(http)
      .get(`/api/v1/billing/customer-invoices/billable?customerId=${ids.customer2}`)
      .set(auth())
      .expect(200);
    expect(c2Preview.body.ratable).toHaveLength(0);
    expect(c2Preview.body.unratable.length).toBeGreaterThanOrEqual(1);
    expect(c2Preview.body.unratable[0].reason).toBe('NO_APPLICABLE_RATE');
  });

  // ---------------------------------------------------------------------------
  // Test 2 — generation: POST creates one DRAFT invoice for customer1 (CAD only so far)
  // ---------------------------------------------------------------------------
  it('generation: POST creates a DRAFT invoice with frozen priceDetail snapshot', async () => {
    const res = await request(http)
      .post('/api/v1/billing/customer-invoices')
      .set(auth())
      .send({ customerId: ids.customer1 })
      .expect(201);

    // Only order A is in the pool so far (no USD orders yet)
    const cadInvoices = res.body.invoices.filter((i: { currency: string }) => i.currency === 'CAD');
    expect(cadInvoices).toHaveLength(1);
    const inv = cadInvoices[0];
    ids.cadInvoice = inv.id;

    expect(inv.invoiceNumber).toMatch(/^CINV-\d{6}$/);
    expect(inv.status).toBe('DRAFT');
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0].priceDetail.version).toBe(1);
    expect(inv.lines[0].priceDetail.result.total).toBe(500);
    // totalAmount is stored as Decimal — serialized as string or number; either 500
    expect(Number(inv.totalAmount)).toBe(500);
  });

  // ---------------------------------------------------------------------------
  // Test 3 — anti-double-billing: second POST for same customer returns 400
  // ---------------------------------------------------------------------------
  it('anti-double-billing: second POST with no new orders → 400', async () => {
    await request(http)
      .post('/api/v1/billing/customer-invoices')
      .set(auth())
      .send({ customerId: ids.customer1 })
      .expect(400);
  });

  // ---------------------------------------------------------------------------
  // Test 4 — multi-currency: deliver orders B (CAD) and C (USD) for customer1,
  // then POST → two invoices, one per currency
  // ---------------------------------------------------------------------------
  it('multi-currency: geographic split → one CAD invoice + one USD invoice', async () => {
    // Order B: CAD lane (CityA → CityB) — rates at 500 CAD
    await deliverOrder(ids.customer1, ids.origin, ids.destination);
    // Order C: USD lane (CityC → CityD) — rates at 400 USD
    await deliverOrder(ids.customer1, ids.originC, ids.destinationC);

    const res = await request(http)
      .post('/api/v1/billing/customer-invoices')
      .set(auth())
      .send({ customerId: ids.customer1 })
      .expect(201);

    expect(res.body.invoices).toHaveLength(2);
    const currencies = res.body.invoices.map((i: { currency: string }) => i.currency).sort();
    expect(currencies).toEqual(['CAD', 'USD']);

    const cadInv = res.body.invoices.find((i: { currency: string }) => i.currency === 'CAD');
    const usdInv = res.body.invoices.find((i: { currency: string }) => i.currency === 'USD');

    expect(cadInv.lines).toHaveLength(1);
    expect(Number(cadInv.totalAmount)).toBe(500);

    expect(usdInv.lines).toHaveLength(1);
    expect(Number(usdInv.totalAmount)).toBe(400);

    // Keep IDs for later tests
    ids.cadInvoice = cadInv.id; // overwrite — will use this one for lifecycle
    ids.usdInvoice = usdInv.id;
  });

  // ---------------------------------------------------------------------------
  // Test 5 — frozen snapshot invariant: mutate the CAD rate → invoice unchanged
  // ---------------------------------------------------------------------------
  it('frozen snapshot: mutating the rate does NOT change the DRAFT invoice amounts', async () => {
    // Capture existing invoice
    const before = await request(http)
      .get(`/api/v1/billing/customer-invoices/${ids.cadInvoice}`)
      .set(auth())
      .expect(200);
    const totalBefore = Number(before.body.totalAmount);
    const snapshotTotalBefore = before.body.lines[0].priceDetail.result.total;

    // Aggressively mutate the CAD rate
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.cadRate}`)
      .set(auth())
      .send({ baseAmount: 99999 })
      .expect(200);

    // Invoice must be unchanged
    const after = await request(http)
      .get(`/api/v1/billing/customer-invoices/${ids.cadInvoice}`)
      .set(auth())
      .expect(200);
    expect(Number(after.body.totalAmount)).toBe(totalBefore);
    expect(after.body.lines[0].priceDetail.result.total).toBe(snapshotTotalBefore);
  });

  // ---------------------------------------------------------------------------
  // Test 6 — draft escape: DELETE DRAFT → order reappears in billable → regenerate
  //           DELETE on APPROVED → 400
  // ---------------------------------------------------------------------------
  it('draft escape: delete DRAFT frees orders; DELETE on APPROVED invoice → 400', async () => {
    // Delete the CAD DRAFT invoice
    await request(http)
      .delete(`/api/v1/billing/customer-invoices/${ids.cadInvoice}`)
      .set(auth())
      .expect(200);

    // Order B must reappear in the billable list
    const preview = await request(http)
      .get(`/api/v1/billing/customer-invoices/billable?customerId=${ids.customer1}`)
      .set(auth())
      .expect(200);
    expect(preview.body.ratable.length).toBeGreaterThanOrEqual(1);

    // Regenerate the CAD draft
    const regen = await request(http)
      .post('/api/v1/billing/customer-invoices')
      .set(auth())
      .send({ customerId: ids.customer1 })
      .expect(201);
    const newCadInv = regen.body.invoices.find((i: { currency: string }) => i.currency === 'CAD');
    expect(newCadInv).toBeDefined();
    ids.cadInvoice = newCadInv.id;

    // Approve the USD invoice so we can attempt a bad DELETE on it
    await request(http)
      .post(`/api/v1/billing/customer-invoices/${ids.usdInvoice}/approve`)
      .set(auth())
      .expect(201);

    // DELETE on an APPROVED invoice → 400
    await request(http)
      .delete(`/api/v1/billing/customer-invoices/${ids.usdInvoice}`)
      .set(auth())
      .expect(400);
  });

  // ---------------------------------------------------------------------------
  // Test 7 — lifecycle: DRAFT → APPROVED → SENT → PAID, and invalid transitions rejected
  // ---------------------------------------------------------------------------
  it('lifecycle: approve → send → pay; invalid transitions return 400', async () => {
    // send on DRAFT → 400
    await request(http)
      .post(`/api/v1/billing/customer-invoices/${ids.cadInvoice}/send`)
      .set(auth())
      .expect(400);

    // pay on DRAFT → 400
    await request(http)
      .post(`/api/v1/billing/customer-invoices/${ids.cadInvoice}/pay`)
      .set(auth())
      .expect(400);

    // DRAFT → APPROVED
    const approved = await request(http)
      .post(`/api/v1/billing/customer-invoices/${ids.cadInvoice}/approve`)
      .set(auth())
      .expect(201);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvedAt).toBeTruthy();

    // pay on APPROVED (not SENT yet) → 400
    await request(http)
      .post(`/api/v1/billing/customer-invoices/${ids.cadInvoice}/pay`)
      .set(auth())
      .expect(400);

    // approve again on APPROVED → 400
    await request(http)
      .post(`/api/v1/billing/customer-invoices/${ids.cadInvoice}/approve`)
      .set(auth())
      .expect(400);

    // APPROVED → SENT (EMAIL_DRIVER=log in dev — email succeeds silently)
    const sent = await request(http)
      .post(`/api/v1/billing/customer-invoices/${ids.cadInvoice}/send`)
      .set(auth())
      .expect(201);
    expect(sent.body.status).toBe('SENT');
    expect(sent.body.sentAt).toBeTruthy();

    // approve on SENT → 400
    await request(http)
      .post(`/api/v1/billing/customer-invoices/${ids.cadInvoice}/approve`)
      .set(auth())
      .expect(400);

    // SENT → PAID
    const paid = await request(http)
      .post(`/api/v1/billing/customer-invoices/${ids.cadInvoice}/pay`)
      .set(auth())
      .expect(201);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.paidAt).toBeTruthy();

    // approve on PAID → 400
    await request(http)
      .post(`/api/v1/billing/customer-invoices/${ids.cadInvoice}/approve`)
      .set(auth())
      .expect(400);
  });
});
