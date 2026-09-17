/**
 * E2E for portal v2 (Task B6, closing Part B end-to-end): builds on top of
 * portal-accounts.e2e-spec.ts's activation flow to exercise what B1-B5 added
 * to the customer-portal session surface:
 *   - GET /portal/orders: pagination + status filter.
 *   - GET /portal/shipments/:id: tracking projection, 404 for another
 *     customer's shipment.
 *   - GET /portal/invoices + /portal/invoices/:id/pdf: 404 with no attached
 *     document, 200 once staff attaches one via the generic documents API.
 *   - Change requests: portal create -> staff queue -> acknowledge -> resolve
 *     with a response -> the portal sees the resolution -> an invalid
 *     transition on a terminal request is rejected (400).
 * Prerequisites: reachable PostgreSQL with the seed applied. Creates its own
 * master data with unique codes so reruns are safe; no cleanup needed since
 * every row is scoped under a unique suffix (same convention as
 * portal-accounts.e2e-spec.ts).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface PortalUserAdminDto {
  id: string;
  inviteUrl?: string;
}

interface PortalLoginResponseDto {
  accessToken: string;
  user: { id: string; role: 'ADMIN' | 'MEMBER' };
  customer: { id: string; name: string };
}

interface PortalOrderRow {
  id: string;
  status: string;
}

interface PortalChangeRequestRow {
  id: string;
  status: string;
  staffResponse: string | null;
}

interface StaffChangeRequestRow extends PortalChangeRequestRow {
  customerName: string;
}

function extractActivationToken(inviteUrl: string): string {
  return inviteUrl.split('/portal/activate/')[1];
}

const PASSWORD = 'PortalPassw0rd!1';

describe('Portal v2 (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let adminToken = '';
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const suffix = `PV${Date.now().toString(36).toUpperCase()}`;
  const emailA = `portal-v2-a-${suffix}@example.com`.toLowerCase();
  const emailB = `portal-v2-b-${suffix}@example.com`.toLowerCase();

  const ids = {
    tenantId: '',
    customerA: '',
    customerB: '',
    origin: '',
    destination: '',
    orderConfirmed: '',
    orderPlanned: '',
    shipmentA: '',
    invoiceId: '',
    changeRequestId: '',
  };

  let portalAAccessToken = '';
  let portalBAccessToken = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    adminToken = (login.body as { accessToken: string }).accessToken;

    await request(http)
      .patch('/api/v1/modules/customer-portal')
      .set(auth(adminToken))
      .send({ enabled: true })
      .expect(200);
    await request(http)
      .patch('/api/v1/modules/billing')
      .set(auth(adminToken))
      .send({ enabled: true })
      .expect(200);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    ids.tenantId = tenant.id;

    const customerA = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth(adminToken))
      .send({ code: `${suffix}-CUSTA`, name: 'Portal V2 Customer A' })
      .expect(201);
    ids.customerA = (customerA.body as { id: string }).id;

    const customerB = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth(adminToken))
      .send({ code: `${suffix}-CUSTB`, name: 'Portal V2 Customer B' })
      .expect(201);
    ids.customerB = (customerB.body as { id: string }).id;

    const origin = await request(http)
      .post('/api/v1/locations')
      .set(auth(adminToken))
      .send({
        code: `${suffix}-WH`,
        name: 'Portal V2 Warehouse',
        type: 'WAREHOUSE',
        addressLine1: '1 Depot St',
        city: 'Gatineau',
      })
      .expect(201);
    ids.origin = (origin.body as { id: string }).id;

    const destination = await request(http)
      .post('/api/v1/locations')
      .set(auth(adminToken))
      .send({
        code: `${suffix}-CS`,
        name: 'Portal V2 Customer Site',
        type: 'CUSTOMER_SITE',
        customerId: ids.customerA,
        addressLine1: '2 Dock Ave',
        city: 'Ottawa',
      })
      .expect(201);
    ids.destination = (destination.body as { id: string }).id;

    // Order 1 for customer A: confirmed only (stays CONFIRMED).
    const order1 = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth(adminToken))
      .send({
        customerId: ids.customerA,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        palletCount: 2,
        totalWeightKg: 500,
      })
      .expect(201);
    ids.orderConfirmed = (order1.body as { id: string }).id;
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.orderConfirmed}/confirm`)
      .set(auth(adminToken))
      .expect(201);

    // Order 2 for customer A: confirmed + planned -> yields a shipment.
    const order2 = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth(adminToken))
      .send({
        customerId: ids.customerA,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        palletCount: 3,
        totalWeightKg: 900,
      })
      .expect(201);
    ids.orderPlanned = (order2.body as { id: string }).id;
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.orderPlanned}/confirm`)
      .set(auth(adminToken))
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.orderPlanned}/plan`)
      .set(auth(adminToken))
      .expect(201);
    ids.shipmentA = (planned.body as { shipments: Array<{ id: string }> }).shipments[0].id;

    // Portal ADMIN for customer A.
    const inviteA = await request(http)
      .post(`/api/v1/customer-portal/customers/${ids.customerA}/users`)
      .set(auth(adminToken))
      .send({ email: emailA, firstName: 'Ana', lastName: 'A', role: 'ADMIN' })
      .expect(201);
    const tokenA = extractActivationToken((inviteA.body as PortalUserAdminDto).inviteUrl!);
    await request(http)
      .post('/api/v1/portal/auth/reset-password')
      .send({ token: tokenA, password: PASSWORD })
      .expect(200);
    const loginA = await request(http)
      .post('/api/v1/portal/auth/login')
      .send({ email: emailA, password: PASSWORD, tenant: 'acme' })
      .expect(200);
    portalAAccessToken = (loginA.body as PortalLoginResponseDto).accessToken;

    // Portal ADMIN for customer B: used only to prove cross-customer isolation.
    const inviteB = await request(http)
      .post(`/api/v1/customer-portal/customers/${ids.customerB}/users`)
      .set(auth(adminToken))
      .send({ email: emailB, firstName: 'Bea', lastName: 'B', role: 'ADMIN' })
      .expect(201);
    const tokenB = extractActivationToken((inviteB.body as PortalUserAdminDto).inviteUrl!);
    await request(http)
      .post('/api/v1/portal/auth/reset-password')
      .send({ token: tokenB, password: PASSWORD })
      .expect(200);
    const loginB = await request(http)
      .post('/api/v1/portal/auth/login')
      .send({ email: emailB, password: PASSWORD, tenant: 'acme' })
      .expect(200);
    portalBAccessToken = (loginB.body as PortalLoginResponseDto).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. GET /portal/orders paginates and filters by status', async () => {
    const page1 = await request(http)
      .get('/api/v1/portal/orders?pageSize=1&page=1')
      .set(auth(portalAAccessToken))
      .expect(200);
    const page1Body = page1.body as {
      items: PortalOrderRow[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(page1Body.total).toBeGreaterThanOrEqual(2);
    expect(page1Body.items).toHaveLength(1);
    expect(page1Body.page).toBe(1);
    expect(page1Body.pageSize).toBe(1);

    const planned = await request(http)
      .get('/api/v1/portal/orders?status=PLANNED')
      .set(auth(portalAAccessToken))
      .expect(200);
    const plannedBody = planned.body as { items: PortalOrderRow[] };
    expect(plannedBody.items.length).toBeGreaterThanOrEqual(1);
    expect(plannedBody.items.every((o) => o.status === 'PLANNED')).toBe(true);
    expect(plannedBody.items.some((o) => o.id === ids.orderPlanned)).toBe(true);

    const confirmed = await request(http)
      .get('/api/v1/portal/orders?status=CONFIRMED')
      .set(auth(portalAAccessToken))
      .expect(200);
    const confirmedBody = confirmed.body as { items: PortalOrderRow[] };
    expect(confirmedBody.items.some((o) => o.id === ids.orderConfirmed)).toBe(true);
    expect(confirmedBody.items.some((o) => o.id === ids.orderPlanned)).toBe(false);

    // Customer B never sees customer A's orders.
    const asB = await request(http)
      .get('/api/v1/portal/orders')
      .set(auth(portalBAccessToken))
      .expect(200);
    const asBBody = asB.body as { items: PortalOrderRow[] };
    expect(
      asBBody.items.some((o) => o.id === ids.orderPlanned || o.id === ids.orderConfirmed),
    ).toBe(false);
  });

  it('2. GET /portal/shipments/:id is 200 for the owning customer, 404 for another', async () => {
    const ok = await request(http)
      .get(`/api/v1/portal/shipments/${ids.shipmentA}`)
      .set(auth(portalAAccessToken))
      .expect(200);
    const body = ok.body as { shipmentNumber: string };
    expect(body.shipmentNumber).toMatch(/^SH-/);
    expect(JSON.stringify(ok.body)).not.toContain('tenantId');

    await request(http)
      .get(`/api/v1/portal/shipments/${ids.shipmentA}`)
      .set(auth(portalBAccessToken))
      .expect(404);
  });

  it('3. invoice pdf: 404 with no attached document, 200 once staff attaches one', async () => {
    const invoice = await prisma.customerInvoice.create({
      data: {
        tenantId: ids.tenantId,
        customerId: ids.customerA,
        invoiceNumber: `PV2-${suffix}`,
        totalAmount: 250,
        currency: 'CAD',
        status: 'APPROVED',
      },
    });
    ids.invoiceId = invoice.id;

    const listed = await request(http)
      .get('/api/v1/portal/invoices')
      .set(auth(portalAAccessToken))
      .expect(200);
    const listedBody = listed.body as Array<{ id: string }>;
    expect(listedBody.some((i) => i.id === ids.invoiceId)).toBe(true);

    await request(http)
      .get(`/api/v1/portal/invoices/${ids.invoiceId}/pdf`)
      .set(auth(portalAAccessToken))
      .expect(404);

    // Staff attaches a PDF through the generic documents API (rule 12).
    await request(http)
      .post('/api/v1/documents/upload')
      .set(auth(adminToken))
      .field('entityType', 'customer-invoice')
      .field('entityId', ids.invoiceId)
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const pdf = await request(http)
      .get(`/api/v1/portal/invoices/${ids.invoiceId}/pdf`)
      .set(auth(portalAAccessToken))
      .expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    const buf: Buffer = Buffer.isBuffer(pdf.body)
      ? pdf.body
      : Buffer.from(pdf.body as string, 'binary');
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');

    // Customer B never reaches customer A's invoice (same 404 as the "no document" case).
    await request(http)
      .get(`/api/v1/portal/invoices/${ids.invoiceId}/pdf`)
      .set(auth(portalBAccessToken))
      .expect(404);
  });

  it(
    '4. change request: portal creates -> staff acknowledge -> resolve with a response -> ' +
      'portal sees RESOLVED -> a further transition on the terminal request is rejected (400)',
    async () => {
      const created = await request(http)
        .post('/api/v1/portal/change-requests')
        .set(auth(portalAAccessToken))
        .send({
          shipmentId: ids.shipmentA,
          kind: 'DATE',
          note: 'Please reschedule pickup to Friday.',
        })
        .expect(201);
      const createdBody = created.body as PortalChangeRequestRow;
      ids.changeRequestId = createdBody.id;
      expect(createdBody.status).toBe('OPEN');

      const portalList = await request(http)
        .get('/api/v1/portal/change-requests')
        .set(auth(portalAAccessToken))
        .expect(200);
      expect(
        (portalList.body as PortalChangeRequestRow[]).some((r) => r.id === ids.changeRequestId),
      ).toBe(true);

      // Customer B's own list never surfaces A's change request.
      const portalListB = await request(http)
        .get('/api/v1/portal/change-requests')
        .set(auth(portalBAccessToken))
        .expect(200);
      expect(
        (portalListB.body as PortalChangeRequestRow[]).some((r) => r.id === ids.changeRequestId),
      ).toBe(false);

      const staffList = await request(http)
        .get('/api/v1/customer-portal/change-requests')
        .set(auth(adminToken))
        .expect(200);
      const staffRow = (staffList.body as StaffChangeRequestRow[]).find(
        (r) => r.id === ids.changeRequestId,
      );
      expect(staffRow).toBeTruthy();
      expect(staffRow!.customerName).toBe('Portal V2 Customer A');
      expect(staffRow!.status).toBe('OPEN');

      await request(http)
        .post(`/api/v1/customer-portal/change-requests/${ids.changeRequestId}/acknowledge`)
        .set(auth(adminToken))
        .expect(200);

      const resolved = await request(http)
        .post(`/api/v1/customer-portal/change-requests/${ids.changeRequestId}/resolve`)
        .set(auth(adminToken))
        .send({ response: 'Reprogrammé au vendredi.' })
        .expect(200);
      const resolvedBody = resolved.body as PortalChangeRequestRow;
      expect(resolvedBody.status).toBe('RESOLVED');
      expect(resolvedBody.staffResponse).toBe('Reprogrammé au vendredi.');

      const portalAfter = await request(http)
        .get('/api/v1/portal/change-requests')
        .set(auth(portalAAccessToken))
        .expect(200);
      const row = (portalAfter.body as PortalChangeRequestRow[]).find(
        (r) => r.id === ids.changeRequestId,
      );
      expect(row).toBeTruthy();
      expect(row!.status).toBe('RESOLVED');
      expect(row!.staffResponse).toBe('Reprogrammé au vendredi.');

      // RESOLVED is a terminal status (canTransitionPortalChangeRequest[RESOLVED] = []):
      // any further transition is rejected, never silently accepted.
      await request(http)
        .post(`/api/v1/customer-portal/change-requests/${ids.changeRequestId}/acknowledge`)
        .set(auth(adminToken))
        .expect(400);
    },
  );
});
