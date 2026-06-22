/**
 * E2E: Billing configurable — process rules + custom fields (arc C, Task 7)
 *
 * Covers:
 *   1. autoSendOnApproval=true  — customer WITH email: approve → status SENT
 *                                 customer WITHOUT email: approve → stays APPROVED (no error)
 *   2. toleranceMode=MIN        — variance between min and max thresholds → FLAGGED under MIN
 *                                 (would be MATCHED under MAX = default)
 *   3. Prefix — invoiceNumberPrefix='FAC'         → next carrier invoice number starts FAC-
 *               customerInvoiceNumberPrefix='REL' → next customer invoice starts REL-
 *               counter NOT reset.
 *   4. defaultCurrency='USD'    — create carrier invoice with no currency → persisted USD.
 *   5. Custom fields            — required SELECT on INCOMING_CARRIER_INVOICE:
 *                                 intake without field → 400; bad value → 400; valid → 201 + customData.
 *   6. Tenant isolation         — foreign-tenant definition not visible to acme.
 *   7. Defaults                 — no settings configured → existing billing flow unchanged.
 *
 * Agent dispatcher (AgentWorkerService) and runtime (AgentRuntimeService) are
 * stubbed as no-ops — mirrors phase16-freight-audit.e2e-spec.ts.
 *
 * Prerequisites: running Postgres, db:migrate + db:seed applied.
 */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentsService } from '../src/core/agents/agents.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';

// ---------------------------------------------------------------------------
// Credentials + suffix
// ---------------------------------------------------------------------------

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const suffix = `${Date.now()}-bcfg`;

// ---------------------------------------------------------------------------
// FakeAgentRuntimeService — keeps the app bootable without a real Hermes process
// (mirrors phase16-freight-audit.e2e-spec.ts).
// ---------------------------------------------------------------------------
@Injectable()
class FakeAgentRuntimeService {
  constructor(private readonly _agents: AgentsService) {}
  async openSession(): Promise<string> { return 'fake-session'; }
  async *sendTurn(): AsyncGenerator<never> { /* no turns */ }
  async closeSession(): Promise<void> { /* no-op */ }
  async killAgentSessions(): Promise<void> { /* no-op */ }
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let token = '';
let tenantId = '';

// Master data shared across suites
let carrierId = '';
let customerWithEmailId = '';
let customerNoEmailId = '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const auth = () => ({ Authorization: `Bearer ${token}` });

async function putBillingSettings(settings: Record<string, unknown>) {
  await request(http)
    .put('/api/v1/modules/billing/settings')
    .set(auth())
    .send({ settings })
    .expect(200);
}

/** Reset billing settings to catalog defaults. */
async function resetBillingSettings() {
  await putBillingSettings({
    autoSendOnApproval: false,
    toleranceMode: 'MAX',
    invoiceNumberPrefix: 'INV',
    customerInvoiceNumberPrefix: 'CINV',
    defaultCurrency: 'CAD',
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

describe('Billing configurable (e2e)', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentRuntimeService)
      .useClass(FakeAgentRuntimeService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Ensure BILLING is enabled for acme.
    const billingModule = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'billing' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: billingModule.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: billingModule.id, enabled: true, enabledAt: new Date() },
    });

    // Seed a carrier for freight-audit intake tests.
    const carrier = await prisma.carrier.create({
      data: { tenantId, code: `BCFG-CARR-${suffix}`, name: `Billing Cfg Carrier ${suffix}` },
    });
    carrierId = carrier.id;

    // Seed a customer WITH an email address (for autoSendOnApproval test).
    const custWithEmail = await prisma.customer.create({
      data: {
        tenantId,
        code: `BCFG-CUST-EMAIL-${suffix}`,
        name: `Billing Cfg Customer Email ${suffix}`,
        email: `billing-cfg-${suffix}@example.com`,
      },
    });
    customerWithEmailId = custWithEmail.id;

    // Seed a customer WITHOUT email (for the "stays APPROVED" branch).
    const custNoEmail = await prisma.customer.create({
      data: {
        tenantId,
        code: `BCFG-CUST-NOEMAIL-${suffix}`,
        name: `Billing Cfg Customer NoEmail ${suffix}`,
      },
    });
    customerNoEmailId = custNoEmail.id;

    // Ensure settings start at defaults.
    await resetBillingSettings();
  });

  afterAll(async () => {
    // Best-effort cleanup.
    if (prisma) {
      await prisma.incomingCarrierInvoice
        .deleteMany({ where: { carrierId } })
        .catch(() => undefined);
      await prisma.carrier.deleteMany({ where: { id: carrierId } }).catch(() => undefined);
      await prisma.customer
        .deleteMany({ where: { id: { in: [customerWithEmailId, customerNoEmailId] } } })
        .catch(() => undefined);
    }
    await app?.close();
  });

  // ===========================================================================
  // Suite 1 — autoSendOnApproval=true
  // ===========================================================================
  describe('autoSendOnApproval=true', () => {
    // We need COMPLETED orders rated by a customer rate to be able to create a
    // CustomerInvoice draft. The path is: customer rate → order → complete → createDrafts.
    // Rather than running the full TMS pipeline (heavy), we bypass by inserting
    // a CustomerInvoice row directly via Prisma and then exercise the approve endpoint.
    // This mirrors the service test approach: the unit of interest is the approve()
    // transition + the autoSend branch, not the draft-creation pipeline.

    let invoiceIdWithEmail = '';
    let invoiceIdNoEmail = '';

    beforeAll(async () => {
      await putBillingSettings({ autoSendOnApproval: true });

      // Insert two DRAFT customer invoices (one per customer) directly via Prisma.
      // seq numbers are arbitrarily unique for this test.
      const invEmail = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `BCFG-CINV-E-${suffix}`,
          customerId: customerWithEmailId,
          currency: 'CAD',
          totalAmount: 100,
          status: 'DRAFT',
        },
      });
      invoiceIdWithEmail = invEmail.id;

      const invNoEmail = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `BCFG-CINV-N-${suffix}`,
          customerId: customerNoEmailId,
          currency: 'CAD',
          totalAmount: 50,
          status: 'DRAFT',
        },
      });
      invoiceIdNoEmail = invNoEmail.id;
    });

    afterAll(async () => {
      await resetBillingSettings();
      // Clean up created invoices.
      await prisma.customerInvoice
        .deleteMany({ where: { id: { in: [invoiceIdWithEmail, invoiceIdNoEmail] } } })
        .catch(() => undefined);
    });

    it('customer WITH email: approve → status SENT (email driver=log in CI)', async () => {
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceIdWithEmail}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      // approve() returns the APPROVED snapshot (before the best-effort send), so we
      // re-fetch to see the final status after autoSendOnApproval's send() transition.
      // EMAIL_DRIVER=log always returns true → transition APPROVED → SENT succeeds.
      const getRes = await request(http)
        .get(`/api/v1/billing/customer-invoices/${invoiceIdWithEmail}`)
        .set(auth())
        .expect(200);
      expect((getRes.body as { status: string }).status).toBe('SENT');
    });

    it('customer WITHOUT email: approve → stays APPROVED (no error thrown)', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceIdNoEmail}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      // autoSendOnApproval is true but customer has no email → send() throws
      // BadRequestException which is caught by approve() (best-effort) → stays APPROVED.
      expect((res.body as { status: string }).status).toBe('APPROVED');
    });
  });

  // ===========================================================================
  // Suite 2 — toleranceMode=MIN
  // ===========================================================================
  /**
   * Tolerance defaults: 2% / 25 absolute / MAX.
   * Under MAX: threshold = max(25, invoicedTotal * 0.02).
   * Under MIN: threshold = min(25, invoicedTotal * 0.02).
   *
   * Pick an invoicedTotal where the two thresholds differ and place the variance
   * between them:
   *   invoicedTotal = 1000  → pct = 20; absolute = 25
   *   MAX threshold = max(25, 20) = 25
   *   MIN threshold = min(25, 20) = 20
   *   variance = 22: within MAX (22 ≤ 25) but outside MIN (22 > 20) → MATCHED under MAX, FLAGGED under MIN.
   */
  describe('toleranceMode=MIN', () => {
    const LOAD_COST = 1000;
    const CHARGED_AMOUNT = 1022; // variance = 22, between min(20) and max(25) threshold
    let loadId = '';
    // Hoisted to suite scope so afterAll cleans up even on mid-test failure.
    let load2Id = '';
    let invoiceId2 = '';

    beforeAll(async () => {
      await putBillingSettings({ toleranceMode: 'MIN' });

      // Seed a COMPLETED load directly via Prisma (estimatedCost = LOAD_COST).
      const load = await prisma.load.create({
        data: {
          tenantId,
          loadNumber: `BCFG-LD-TOL-${suffix}`,
          status: 'COMPLETED',
          carrierId,
          estimatedCost: LOAD_COST,
          costCurrency: 'CAD',
        },
      });
      loadId = load.id;

      // Pre-create load2 here so afterAll can always clean it up regardless of test outcome.
      const load2 = await prisma.load.create({
        data: {
          tenantId,
          loadNumber: `BCFG-LD-TOL2-${suffix}`,
          status: 'COMPLETED',
          carrierId,
          estimatedCost: LOAD_COST,
          costCurrency: 'CAD',
        },
      });
      load2Id = load2.id;
    });

    afterAll(async () => {
      await prisma.incomingCarrierInvoice
        .deleteMany({ where: { carrierId, carrierInvoiceNumber: { startsWith: `BCFG-TOL-${suffix}` } } })
        .catch(() => undefined);
      // Also clean up the invoice from the sanity test if it was created.
      if (invoiceId2) {
        await prisma.incomingCarrierInvoice.deleteMany({ where: { id: invoiceId2 } }).catch(() => undefined);
      }
      await prisma.load.deleteMany({ where: { id: { in: [loadId, load2Id].filter(Boolean) } } }).catch(() => undefined);
      await resetBillingSettings();
    });

    it('variance between MIN and MAX thresholds: FLAGGED under MIN (would be MATCHED under MAX)', async () => {
      // Intake via the freight-audit endpoint.
      const intakeRes = await request(http)
        .post('/api/v1/freight-audit/incoming-invoices')
        .set(auth())
        .send({
          carrierId,
          carrierInvoiceNumber: `BCFG-TOL-${suffix}`,
          lines: [{ lineRef: `BCFG-LD-TOL-${suffix}`, chargedAmount: CHARGED_AMOUNT }],
        })
        .expect(201);
      const invoiceId = (intakeRes.body as { id: string }).id;

      // Audit — under MIN the varianceGross(22) > threshold(20) → FLAGGED.
      const auditRes = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId}/audit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      expect((auditRes.body as { status: string }).status).toBe('FLAGGED');

      // Cross-check with the GET.
      const getRes = await request(http)
        .get(`/api/v1/freight-audit/incoming-invoices/${invoiceId}`)
        .set(auth())
        .expect(200);
      expect((getRes.body as { status: string }).status).toBe('FLAGGED');
    });

    it('sanity: same variance is MATCHED under MAX (default)', async () => {
      // Temporarily switch to MAX, intake a fresh invoice with the same amounts,
      // audit it, confirm MATCHED. load2 is pre-created in beforeAll and cleaned
      // up in afterAll so a mid-test failure cannot leave a leaked COMPLETED load.
      await putBillingSettings({ toleranceMode: 'MAX' });

      const intakeRes = await request(http)
        .post('/api/v1/freight-audit/incoming-invoices')
        .set(auth())
        .send({
          carrierId,
          carrierInvoiceNumber: `BCFG-TOL2-${suffix}`,
          lines: [{ lineRef: `BCFG-LD-TOL2-${suffix}`, chargedAmount: CHARGED_AMOUNT }],
        })
        .expect(201);
      invoiceId2 = (intakeRes.body as { id: string }).id;

      const auditRes = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${invoiceId2}/audit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      expect((auditRes.body as { status: string }).status).toBe('MATCHED');

      // Restore MIN for consistency with the suite's intended state.
      await putBillingSettings({ toleranceMode: 'MIN' });
    });
  });

  // ===========================================================================
  // Suite 3 — Prefix: invoiceNumberPrefix + customerInvoiceNumberPrefix
  // ===========================================================================
  describe('Prefix — invoiceNumberPrefix', () => {
    let counterBefore = 0;

    afterAll(async () => {
      await putBillingSettings({ invoiceNumberPrefix: 'INV' });
    });

    it('captures current carrier-invoice counter (warm-up via intake)', async () => {
      // We use a load to create a draftable invoice for a baseline reading.
      // Instead of drafting (requires COMPLETED loads), we check existing invoices
      // via the freight-audit endpoint which uses the sequences service.
      // Intake one invoice to warm up the counter and read its number.
      const warmLoad = await prisma.load.create({
        data: {
          tenantId,
          loadNumber: `BCFG-LD-PFX-W-${suffix}`,
          status: 'COMPLETED',
          carrierId,
          estimatedCost: 100,
          costCurrency: 'CAD',
        },
      });

      // We need to use the /billing/invoices/draft endpoint for the prefix test.
      // That endpoint reads carrier invoice number from SequencesService('invoice').
      const draftRes = await request(http)
        .post('/api/v1/billing/invoices/draft')
        .set(auth())
        .send({ carrierId })
        .expect(201);
      const num: string = (draftRes.body as { invoiceNumber: string }).invoiceNumber;
      counterBefore = parseInt(num.split('-').pop()!, 10);
      expect(counterBefore).toBeGreaterThan(0);
      expect(num).toMatch(/^INV-/);

      await prisma.invoice.deleteMany({ where: { carrierId, invoiceNumber: num } }).catch(() => undefined);
      await prisma.load.deleteMany({ where: { id: warmLoad.id } }).catch(() => undefined);
    });

    it('after setting invoiceNumberPrefix=FAC, next draft starts with FAC- and counter is higher', async () => {
      await putBillingSettings({ invoiceNumberPrefix: 'FAC' });

      const warmLoad2 = await prisma.load.create({
        data: {
          tenantId,
          loadNumber: `BCFG-LD-PFX-A-${suffix}`,
          status: 'COMPLETED',
          carrierId,
          estimatedCost: 100,
          costCurrency: 'CAD',
        },
      });

      const draftRes = await request(http)
        .post('/api/v1/billing/invoices/draft')
        .set(auth())
        .send({ carrierId })
        .expect(201);
      const num: string = (draftRes.body as { invoiceNumber: string }).invoiceNumber;

      expect(num).toMatch(/^FAC-/);
      const counterAfter = parseInt(num.split('-').pop()!, 10);
      expect(counterAfter).toBeGreaterThan(counterBefore);

      await prisma.invoice.deleteMany({ where: { carrierId, invoiceNumber: num } }).catch(() => undefined);
      await prisma.load.deleteMany({ where: { id: warmLoad2.id } }).catch(() => undefined);
    });
  });

  describe('Prefix — customerInvoiceNumberPrefix', () => {
    // Infrastructure for the real round-trip: we need a ratable, delivered order.
    let relCarrierId = '';
    let relCustomerId = '';
    let relOriginId = '';
    let relDestId = '';
    let relRateId = '';
    let relInvoiceId = '';

    beforeAll(async () => {
      // Carrier for load assignment.
      const carr = await request(http)
        .post('/api/v1/transportation/carriers')
        .set(auth())
        .send({ code: `BCFG-REL-CARR-${suffix}`, name: `REL Carrier ${suffix}` })
        .expect(201);
      relCarrierId = (carr.body as { id: string }).id;

      // Customer with email (needed for later approve path if any).
      const cust = await request(http)
        .post('/api/v1/transportation/customers')
        .set(auth())
        .send({
          code: `BCFG-REL-CUST-${suffix}`,
          name: `REL Customer ${suffix}`,
          email: `bcfg-rel-${suffix}@example.com`,
        })
        .expect(201);
      relCustomerId = (cust.body as { id: string }).id;

      // Two locations for a city lane.
      const ori = await request(http)
        .post('/api/v1/transportation/locations')
        .set(auth())
        .send({
          code: `BCFG-REL-ORI-${suffix}`,
          name: `REL Origin ${suffix}`,
          type: 'WAREHOUSE',
          addressLine1: '1 REL St',
          city: `RelCityA-${suffix}`,
          state: 'QC',
          country: 'CA',
        })
        .expect(201);
      relOriginId = (ori.body as { id: string }).id;

      const dst = await request(http)
        .post('/api/v1/transportation/locations')
        .set(auth())
        .send({
          code: `BCFG-REL-DST-${suffix}`,
          name: `REL Destination ${suffix}`,
          type: 'WAREHOUSE',
          addressLine1: '2 REL St',
          city: `RelCityB-${suffix}`,
          state: 'QC',
          country: 'CA',
        })
        .expect(201);
      relDestId = (dst.body as { id: string }).id;

      // Lane for the rate.
      const lane = await request(http)
        .post('/api/v1/transportation/lanes')
        .set(auth())
        .send({
          name: `BCFG REL lane ${suffix}`,
          originType: 'CITY',
          origin: { city: `RelCityA-${suffix}`, state: 'QC', country: 'CA' },
          destinationType: 'CITY',
          destination: { city: `RelCityB-${suffix}`, state: 'QC', country: 'CA' },
        })
        .expect(201);
      const laneId = (lane.body as { id: string }).id;

      // Active customer rate (FLAT 300 CAD) — makes the order ratable.
      const rate = await request(http)
        .post('/api/v1/transportation/rates')
        .set(auth())
        .send({
          name: `BCFG REL rate ${suffix}`,
          rateType: 'FLAT',
          baseAmount: 300,
          currency: 'CAD',
          customerId: relCustomerId,
          laneId,
        })
        .expect(201);
      relRateId = (rate.body as { id: string }).id;
      await request(http)
        .patch(`/api/v1/transportation/rates/${relRateId}`)
        .set(auth())
        .send({ status: 'ACTIVE' })
        .expect(200);
    });

    afterAll(async () => {
      // Clean up the customer invoice draft (if created).
      if (relInvoiceId) {
        await prisma.customerInvoice.deleteMany({ where: { id: relInvoiceId } }).catch(() => undefined);
      }
      // Clean up any remaining customer invoice lines for this customer.
      await prisma.customerInvoice.deleteMany({ where: { customerId: relCustomerId } }).catch(() => undefined);
      await prisma.rate.deleteMany({ where: { id: relRateId } }).catch(() => undefined);
      await prisma.customer.deleteMany({ where: { id: relCustomerId } }).catch(() => undefined);
      await prisma.carrier.deleteMany({ where: { id: relCarrierId } }).catch(() => undefined);
      await prisma.location.deleteMany({ where: { id: { in: [relOriginId, relDestId] } } }).catch(() => undefined);
      await putBillingSettings({ customerInvoiceNumberPrefix: 'CINV' });
    });

    /**
     * Helper: runs a transport order all the way to COMPLETED (DELIVERED) using
     * the relCarrierId/relOriginId/relDestId seeded in beforeAll, so it becomes
     * billable for createDrafts. Returns the orderId.
     */
    async function deliverOrderForRel(): Promise<string> {
      const order = await request(http)
        .post('/api/v1/transportation/transport-orders')
        .set(auth())
        .send({ customerId: relCustomerId, originLocationId: relOriginId, destinationLocationId: relDestId })
        .expect(201);
      const orderId = (order.body as { id: string }).id;

      await request(http)
        .post(`/api/v1/transportation/transport-orders/${orderId}/confirm`)
        .set(auth())
        .expect(201);

      const planned = await request(http)
        .post(`/api/v1/transportation/transport-orders/${orderId}/plan`)
        .set(auth())
        .send({})
        .expect(201);
      const shipmentId = (planned.body as { shipments: { id: string }[] }).shipments[0].id;

      const loadRes = await request(http)
        .post('/api/v1/transportation/loads')
        .set(auth())
        .send({})
        .expect(201);
      const loadId = (loadRes.body as { id: string }).id;

      await request(http)
        .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
        .set(auth())
        .send({ loadId })
        .expect(201);

      await request(http)
        .post(`/api/v1/transportation/loads/${loadId}/assign`)
        .set(auth())
        .send({ carrierId: relCarrierId })
        .expect(201);

      for (const verb of ['dispatch', 'start-transit', 'complete']) {
        await request(http)
          .post(`/api/v1/transportation/loads/${loadId}/${verb}`)
          .set(auth())
          .expect(201);
      }

      return orderId;
    }

    it('after setting customerInvoiceNumberPrefix=REL, real draft invoice number starts with REL-', async () => {
      // Set the prefix BEFORE generating any invoice for this customer.
      await putBillingSettings({ customerInvoiceNumberPrefix: 'REL' });

      // Deliver an order so the customer has at least one ratable, billable order.
      await deliverOrderForRel();

      // Create draft via the real HTTP endpoint — this is what exercises SequencesService
      // with the REL prefix read from ModuleSettingsService.
      const draftRes = await request(http)
        .post('/api/v1/billing/customer-invoices')
        .set(auth())
        .send({ customerId: relCustomerId })
        .expect(201);

      // createDrafts returns { invoices: [...], unratable: [...] }
      const body = draftRes.body as { invoices: { id: string; invoiceNumber: string }[]; unratable: unknown[] };
      expect(body.invoices).toBeDefined();
      expect(body.invoices.length).toBeGreaterThan(0);

      const inv = body.invoices[0];
      relInvoiceId = inv.id;

      // The core assertion: the real service-generated invoice number must use the REL prefix.
      expect(inv.invoiceNumber).toMatch(/^REL-/);

      // Cross-check by GET.
      const getRes = await request(http)
        .get(`/api/v1/billing/customer-invoices/${inv.id}`)
        .set(auth())
        .expect(200);
      expect((getRes.body as { invoiceNumber: string }).invoiceNumber).toMatch(/^REL-/);
    });
  });

  // ===========================================================================
  // Suite 4 — defaultCurrency='USD'
  // ===========================================================================
  describe("defaultCurrency='USD'", () => {
    let loadIdCur = '';

    afterAll(async () => {
      await putBillingSettings({ defaultCurrency: 'CAD' });
      if (loadIdCur) await prisma.load.deleteMany({ where: { id: loadIdCur } }).catch(() => undefined);
    });

    it('carrier invoice created with no currency field is persisted as USD', async () => {
      await putBillingSettings({ defaultCurrency: 'USD' });

      const load = await prisma.load.create({
        data: {
          tenantId,
          loadNumber: `BCFG-LD-CUR-${suffix}`,
          status: 'COMPLETED',
          carrierId,
          estimatedCost: 200,
          costCurrency: 'CAD',
        },
      });
      loadIdCur = load.id;

      // Intake without a currency field.
      const res = await request(http)
        .post('/api/v1/freight-audit/incoming-invoices')
        .set(auth())
        .send({
          carrierId,
          carrierInvoiceNumber: `BCFG-CUR-${suffix}`,
          lines: [{ lineRef: `BCFG-LD-CUR-${suffix}`, chargedAmount: 200 }],
          // No 'currency' field — service should default to USD.
        })
        .expect(201);

      expect((res.body as { currency: string }).currency).toBe('USD');

      await prisma.incomingCarrierInvoice
        .deleteMany({ where: { id: (res.body as { id: string }).id } })
        .catch(() => undefined);
    });
  });

  // ===========================================================================
  // Suite 5 — Custom fields: required SELECT on INCOMING_CARRIER_INVOICE
  // ===========================================================================
  describe('Custom fields — INCOMING_CARRIER_INVOICE', () => {
    const entityType = 'INCOMING_CARRIER_INVOICE';
    const fieldKey = 'invoice_type';
    let loadIdCf = '';

    beforeAll(async () => {
      // Seed a load for intake tests.
      const load = await prisma.load.create({
        data: {
          tenantId,
          loadNumber: `BCFG-LD-CF-${suffix}`,
          status: 'COMPLETED',
          carrierId,
          estimatedCost: 300,
          costCurrency: 'CAD',
        },
      });
      loadIdCf = load.id;
    });

    afterAll(async () => {
      // Clear the custom-field definition.
      await request(http)
        .put('/api/v1/billing/custom-fields')
        .set(auth())
        .send({ entityType, definitions: [] })
        .expect(200);
      await prisma.load.deleteMany({ where: { id: loadIdCf } }).catch(() => undefined);
    });

    it('PUT /billing/custom-fields: required SELECT for INCOMING_CARRIER_INVOICE → 200', async () => {
      await request(http)
        .put('/api/v1/billing/custom-fields')
        .set(auth())
        .send({
          entityType,
          definitions: [
            {
              key: fieldKey,
              label: 'Invoice Type',
              type: 'SELECT',
              required: true,
              showInList: true,
              sortOrder: 0,
              options: [
                { value: 'STANDARD', label: 'Standard' },
                { value: 'CREDIT', label: 'Credit note' },
              ],
            },
          ],
        })
        .expect(200);
    });

    it('GET /billing/custom-fields returns the new field', async () => {
      const res = await request(http)
        .get(`/api/v1/billing/custom-fields?entityType=${entityType}`)
        .set(auth())
        .expect(200);
      const defs = res.body as { key: string }[];
      expect(defs.some((d) => d.key === fieldKey)).toBe(true);
    });

    it('freight-audit intake without the required field → 400', async () => {
      await request(http)
        .post('/api/v1/freight-audit/incoming-invoices')
        .set(auth())
        .send({
          carrierId,
          carrierInvoiceNumber: `BCFG-CF-MISSING-${suffix}`,
          lines: [{ lineRef: `BCFG-LD-CF-${suffix}`, chargedAmount: 300 }],
          // no customData
        })
        .expect(400);
    });

    it('freight-audit intake with value outside allowed options → 400', async () => {
      await request(http)
        .post('/api/v1/freight-audit/incoming-invoices')
        .set(auth())
        .send({
          carrierId,
          carrierInvoiceNumber: `BCFG-CF-BADVAL-${suffix}`,
          lines: [{ lineRef: `BCFG-LD-CF-${suffix}`, chargedAmount: 300 }],
          customData: { [fieldKey]: 'NOT_A_VALID_OPTION' },
        })
        .expect(400);
    });

    it('freight-audit intake with valid option → 201 and GET returns customData', async () => {
      const res = await request(http)
        .post('/api/v1/freight-audit/incoming-invoices')
        .set(auth())
        .send({
          carrierId,
          carrierInvoiceNumber: `BCFG-CF-OK-${suffix}`,
          lines: [{ lineRef: `BCFG-LD-CF-${suffix}`, chargedAmount: 300 }],
          customData: { [fieldKey]: 'STANDARD' },
        })
        .expect(201);

      const invoiceId = (res.body as { id: string }).id;
      expect(invoiceId).toBeTruthy();

      const getRes = await request(http)
        .get(`/api/v1/freight-audit/incoming-invoices/${invoiceId}`)
        .set(auth())
        .expect(200);

      const customData = (getRes.body as { customData?: Record<string, unknown> }).customData;
      expect(customData).toBeTruthy();
      expect(customData![fieldKey]).toBe('STANDARD');

      await prisma.incomingCarrierInvoice
        .deleteMany({ where: { id: invoiceId } })
        .catch(() => undefined);
    });
  });

  // ===========================================================================
  // Suite 6 — Tenant isolation: second tenant's definitions NOT visible to acme
  // ===========================================================================
  describe('Tenant isolation — custom-field definitions', () => {
    let otherTenantId = '';
    let foreignFieldId = '';
    const otherSlug = `isolation-billing-${Date.now()}`;

    beforeAll(async () => {
      // Create a second tenant via Prisma.
      const otherTenant = await prisma.tenant.create({
        data: { slug: otherSlug, name: `Isolation Billing ${Date.now()}` },
      });
      otherTenantId = otherTenant.id;

      // Insert a CustomFieldDefinition belonging to the OTHER tenant.
      const foreignDef = await prisma.customFieldDefinition.create({
        data: {
          tenantId: otherTenantId,
          module: 'billing',
          entityType: 'INCOMING_CARRIER_INVOICE',
          key: 'foreign_billing_field',
          label: 'Foreign Billing Field',
          type: 'TEXT',
          required: false,
          showInList: false,
          sortOrder: 0,
        },
      });
      foreignFieldId = foreignDef.id;

      // Ensure acme has at least one billing custom-field definition visible.
      await prisma.customFieldDefinition.upsert({
        where: {
          tenantId_module_entityType_key: {
            tenantId,
            module: 'billing',
            entityType: 'INCOMING_CARRIER_INVOICE',
            key: 'acme_billing_isolation',
          },
        },
        update: {},
        create: {
          tenantId,
          module: 'billing',
          entityType: 'INCOMING_CARRIER_INVOICE',
          key: 'acme_billing_isolation',
          label: 'Acme Billing Isolation',
          type: 'TEXT',
          required: false,
          showInList: false,
          sortOrder: 0,
        },
      });
    });

    afterAll(async () => {
      if (foreignFieldId) {
        await prisma.customFieldDefinition
          .deleteMany({ where: { id: foreignFieldId } })
          .catch(() => undefined);
      }
      await prisma.customFieldDefinition
        .deleteMany({ where: { tenantId, key: 'acme_billing_isolation' } })
        .catch(() => undefined);
      if (otherTenantId) {
        await prisma.tenant.deleteMany({ where: { id: otherTenantId } }).catch(() => undefined);
      }
    });

    it('acme GET /billing/custom-fields does NOT see the foreign-tenant definition', async () => {
      const res = await request(http)
        .get('/api/v1/billing/custom-fields?entityType=INCOMING_CARRIER_INVOICE')
        .set(auth())
        .expect(200);

      const defs = res.body as { key: string }[];
      const keys = defs.map((d) => d.key);
      // acme must NOT see the foreign tenant's key.
      expect(keys).not.toContain('foreign_billing_field');
      // acme must see its own definition (assertion is meaningful in both directions).
      expect(keys).toContain('acme_billing_isolation');
    });
  });

  // ===========================================================================
  // Suite 7 — Defaults: with no settings, billing flows are unchanged
  // ===========================================================================
  describe('Defaults — no custom settings → existing billing flows unchanged', () => {
    let loadIdDef = '';

    beforeAll(async () => {
      await resetBillingSettings();

      const load = await prisma.load.create({
        data: {
          tenantId,
          loadNumber: `BCFG-LD-DEF-${suffix}`,
          status: 'COMPLETED',
          carrierId,
          estimatedCost: 150,
          costCurrency: 'CAD',
        },
      });
      loadIdDef = load.id;
    });

    afterAll(async () => {
      await prisma.incomingCarrierInvoice
        .deleteMany({ where: { carrierId, carrierInvoiceNumber: `BCFG-DEF-${suffix}` } })
        .catch(() => undefined);
      await prisma.load.deleteMany({ where: { id: loadIdDef } }).catch(() => undefined);
    });

    it('carrier invoice defaults to CAD when no currency and defaultCurrency not set', async () => {
      const res = await request(http)
        .post('/api/v1/freight-audit/incoming-invoices')
        .set(auth())
        .send({
          carrierId,
          carrierInvoiceNumber: `BCFG-DEF-${suffix}`,
          lines: [{ lineRef: `BCFG-LD-DEF-${suffix}`, chargedAmount: 150 }],
        })
        .expect(201);
      // Default currency is 'CAD' when no setting is stored.
      expect((res.body as { currency: string }).currency).toBe('CAD');
    });

    it('within-tolerance audit → MATCHED (toleranceMode defaults to MAX, large absolute floor)', async () => {
      // invoiceId from the previous test — same load, exactly charged.
      const listRes = await request(http)
        .get('/api/v1/freight-audit/incoming-invoices')
        .set(auth())
        .expect(200);
      const invoices = listRes.body as { id: string; carrierInvoiceNumber: string }[];
      const inv = invoices.find((i) => i.carrierInvoiceNumber === `BCFG-DEF-${suffix}`);
      expect(inv).toBeDefined();

      const auditRes = await request(http)
        .post(`/api/v1/freight-audit/incoming-invoices/${inv!.id}/audit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      // Charged = expected (150) → variance 0 → MATCHED regardless of mode.
      expect((auditRes.body as { status: string }).status).toBe('MATCHED');
    });
  });
});
