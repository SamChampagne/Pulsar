/**
 * E2E CRM cross-module events — preuves de la chaîne complète :
 *   deal.won emis → DomainEvent row
 *   sales_order.invoiced emis → DomainEvent row
 *   processPending → ReactionExecution + CustomerInvoice DRAFT lié à la SO
 *   idempotence (2e processPending = toujours 1 seule facture)
 *   sans customerId → no-op (aucune facture, aucun crash)
 *   isolation tenant
 *
 * Bootstrap mirrors cross-module-automation.e2e-spec.ts:
 *   - FakeAgentRuntimeService (no Hermes)
 *   - Login as seeded admin, resolve acme tenantId
 *   - crm + billing modules enabled via tenantModule.upsert
 *   - DomainEventsService.processPending() to drive reactions
 *
 * Prerequisites: reachable PostgreSQL with seed applied (pnpm db:seed).
 * Run: pnpm --filter @pulsar/api test:e2e -- crm-cross-module
 */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { DomainEventsService } from '../src/core/operating/domain-events.service';
import { drainInheritedDomainEvents } from './utils/domain-events';
import { AgentsService } from '../src/core/agents/agents.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------------------
// Stub — no-op AgentRuntimeService so app boots without a real Hermes process.
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
// Suite
// ---------------------------------------------------------------------------
describe('CRM cross-module events (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let domainEvents: DomainEventsService;
  let token = '';
  let tenantId = '';

  const suffix = uniq();
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Cleanup IDs collected across scenarios
  const cleanupSalesOrderIds: string[] = [];
  const cleanupInvoiceIds: string[] = [];
  const cleanupDealIds: string[] = [];
  const cleanupCompanyIds: string[] = [];
  const cleanupCustomerIds: string[] = [];
  const cleanupEventIds: string[] = [];
  const cleanupReactionIds: string[] = [];

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
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
    domainEvents = app.get(DomainEventsService);
    await drainInheritedDomainEvents(domainEvents);

    // Login
    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Ensure crm + billing modules are enabled for acme
    for (const key of ['crm', 'billing']) {
      const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
        update: { enabled: true },
        create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
      });
    }

    // Ensure the built-in reaction rule exists (seeded by pnpm db:seed; be idempotent)
    const ruleCheck = await prisma.automationRule.findFirst({
      where: { tenantId, eventType: 'crm.sales_order.invoiced', enabled: true },
    });
    if (!ruleCheck) {
      await prisma.automationRule.create({
        data: {
          tenantId,
          name: `draft-invoice-from-so-${suffix}`,
          eventType: 'crm.sales_order.invoiced',
          enabled: true,
          match: 'ALL',
          conditions: [],
          action: { kind: 'RUN_ACTION', action: 'draft_invoice_from_sales_order', args: { salesOrderId: '{salesOrderId}' } },
        },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.customerInvoice.deleteMany({
        where: { id: { in: cleanupInvoiceIds } },
      }).catch(() => undefined);
      await prisma.reactionExecution.deleteMany({
        where: { id: { in: cleanupReactionIds } },
      }).catch(() => undefined);
      await prisma.domainEvent.deleteMany({
        where: { tenantId, id: { in: cleanupEventIds } },
      }).catch(() => undefined);
      await prisma.salesOrder.deleteMany({
        where: { id: { in: cleanupSalesOrderIds } },
      }).catch(() => undefined);
      await prisma.crmDeal.deleteMany({
        where: { id: { in: cleanupDealIds } },
      }).catch(() => undefined);
      await prisma.crmCompany.deleteMany({
        where: { id: { in: cleanupCompanyIds } },
      }).catch(() => undefined);
      await prisma.customer.deleteMany({
        where: { id: { in: cleanupCustomerIds } },
      }).catch(() => undefined);
    }
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Helper: advance a deal LEAD → QUALIFIED → PROPOSAL → WON
  // ---------------------------------------------------------------------------
  async function advanceDealToWon(dealId: string) {
    for (const stage of ['QUALIFIED', 'PROPOSAL', 'WON']) {
      await request(http)
        .post(`/api/v1/crm/deals/${dealId}/advance`)
        .set(auth())
        .send({ stage })
        .expect(200);
    }
  }

  // ---------------------------------------------------------------------------
  // Helper: drive a SO from DRAFT to INVOICED (confirm → fulfill → invoice)
  // ---------------------------------------------------------------------------
  async function advanceSoToInvoiced(soId: string) {
    await request(http).post(`/api/v1/crm/sales-orders/${soId}/confirm`).set(auth()).expect(200);
    await request(http).post(`/api/v1/crm/sales-orders/${soId}/fulfill`).set(auth()).expect(200);
    await request(http).post(`/api/v1/crm/sales-orders/${soId}/invoice`).set(auth()).expect(200);
  }

  // ---------------------------------------------------------------------------
  // Scenario 1 — deal.won emis
  // ---------------------------------------------------------------------------
  describe('Scenario 1 — deal.won DomainEvent', () => {
    let dealId1 = '';
    let companyId1 = '';

    it('advance deal to WON → crm.deal.won DomainEvent row exists in DB', async () => {
      const company = (
        await request(http)
          .post('/api/v1/crm/companies')
          .set(auth())
          .send({ name: `XMod-Co1-${suffix}` })
          .expect(201)
      ).body as { id: string };
      companyId1 = company.id;
      cleanupCompanyIds.push(companyId1);

      const deal = (
        await request(http)
          .post('/api/v1/crm/deals')
          .set(auth())
          .send({ title: `XMod-Deal1-${suffix}`, companyId: companyId1 })
          .expect(201)
      ).body as { id: string };
      dealId1 = deal.id;
      cleanupDealIds.push(dealId1);

      await advanceDealToWon(dealId1);

      const event = await prisma.domainEvent.findFirst({
        where: {
          tenantId,
          type: 'crm.deal.won',
          payload: { path: ['dealId'], equals: dealId1 },
        },
      });
      expect(event).not.toBeNull();
      expect(event!.tenantId).toBe(tenantId);
      cleanupEventIds.push(event!.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 2 — sales_order.invoiced emis via deal convert → create-sales-order
  // ---------------------------------------------------------------------------
  describe('Scenario 2 — crm.sales_order.invoiced DomainEvent', () => {
    let companyId2 = '';
    let dealId2 = '';
    let soId2 = '';
    let customerId2 = '';

    it('convert WON deal + create SO → invoice → crm.sales_order.invoiced DomainEvent', async () => {
      // Create company + deal, advance to WON
      const company = (
        await request(http)
          .post('/api/v1/crm/companies')
          .set(auth())
          .send({ name: `XMod-Co2-${suffix}` })
          .expect(201)
      ).body as { id: string };
      companyId2 = company.id;
      cleanupCompanyIds.push(companyId2);

      const deal = (
        await request(http)
          .post('/api/v1/crm/deals')
          .set(auth())
          .send({ title: `XMod-Deal2-${suffix}`, companyId: companyId2 })
          .expect(201)
      ).body as { id: string };
      dealId2 = deal.id;
      cleanupDealIds.push(dealId2);

      await advanceDealToWon(dealId2);

      // Add a line item on the deal so create-sales-order passes its guard
      await request(http)
        .post(`/api/v1/crm/deals/${dealId2}/line-items`)
        .set(auth())
        .send({ name: 'Service A', quantity: 2, unitPrice: 500 })
        .expect(201);

      // Convert → creates a Customer and sets convertedCustomerId
      const conv = (
        await request(http)
          .post(`/api/v1/crm/deals/${dealId2}/convert`)
          .set(auth())
          .expect(200)
      ).body as { customerId: string };
      customerId2 = conv.customerId;
      cleanupCustomerIds.push(customerId2);

      // Create SO from the deal (copies lines + links customerId)
      const so = (
        await request(http)
          .post(`/api/v1/crm/deals/${dealId2}/create-sales-order`)
          .set(auth())
          .expect(201)
      ).body as { id: string; customerId: string | null };
      soId2 = so.id;
      cleanupSalesOrderIds.push(soId2);

      // SO must have a customerId (linked from convertedCustomerId)
      expect(so.customerId).toBe(customerId2);

      // DRAFT → CONFIRMED → FULFILLED → INVOICED
      await advanceSoToInvoiced(soId2);

      // Assert crm.sales_order.invoiced DomainEvent row exists
      const event = await prisma.domainEvent.findFirst({
        where: {
          tenantId,
          type: 'crm.sales_order.invoiced',
          payload: { path: ['salesOrderId'], equals: soId2 },
        },
      });
      expect(event).not.toBeNull();
      expect(event!.tenantId).toBe(tenantId);
      cleanupEventIds.push(event!.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 3 — reaction: processPending → DRAFT CustomerInvoice + idempotence
  // ---------------------------------------------------------------------------
  describe('Scenario 3 — reaction produces DRAFT CustomerInvoice (idempotent)', () => {
    let companyId3 = '';
    let dealId3 = '';
    let soId3 = '';
    let customerId3 = '';

    it('processPending → DRAFT CustomerInvoice linked to the SO, ReactionExecution row exists', async () => {
      // Create company + deal → WON
      const company = (
        await request(http)
          .post('/api/v1/crm/companies')
          .set(auth())
          .send({ name: `XMod-Co3-${suffix}` })
          .expect(201)
      ).body as { id: string };
      companyId3 = company.id;
      cleanupCompanyIds.push(companyId3);

      const deal = (
        await request(http)
          .post('/api/v1/crm/deals')
          .set(auth())
          .send({ title: `XMod-Deal3-${suffix}`, companyId: companyId3 })
          .expect(201)
      ).body as { id: string };
      dealId3 = deal.id;
      cleanupDealIds.push(dealId3);

      await advanceDealToWon(dealId3);

      // Add line item
      await request(http)
        .post(`/api/v1/crm/deals/${dealId3}/line-items`)
        .set(auth())
        .send({ name: 'Widget', quantity: 1, unitPrice: 250 })
        .expect(201);

      // Convert deal → Customer
      const conv = (
        await request(http)
          .post(`/api/v1/crm/deals/${dealId3}/convert`)
          .set(auth())
          .expect(200)
      ).body as { customerId: string };
      customerId3 = conv.customerId;
      cleanupCustomerIds.push(customerId3);

      // Create SO from deal
      const so = (
        await request(http)
          .post(`/api/v1/crm/deals/${dealId3}/create-sales-order`)
          .set(auth())
          .expect(201)
      ).body as { id: string };
      soId3 = so.id;
      cleanupSalesOrderIds.push(soId3);

      // Drive SO to INVOICED
      await advanceSoToInvoiced(soId3);

      // Run domain-events worker
      await domainEvents.processPending(50);

      // Assert CustomerInvoice DRAFT exists with salesOrderId in customData
      const invoices = await prisma.customerInvoice.findMany({
        where: {
          tenantId,
          customerId: customerId3,
          customData: { path: ['salesOrderId'], equals: soId3 },
        },
      });
      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe('DRAFT');
      cleanupInvoiceIds.push(invoices[0].id);

      // Assert ReactionExecution row exists for the invoiced event + rule
      const invoicedEvent = await prisma.domainEvent.findFirst({
        where: {
          tenantId,
          type: 'crm.sales_order.invoiced',
          payload: { path: ['salesOrderId'], equals: soId3 },
        },
      });
      expect(invoicedEvent).not.toBeNull();

      const rule = await prisma.automationRule.findFirst({
        where: { tenantId, eventType: 'crm.sales_order.invoiced', enabled: true },
      });
      expect(rule).not.toBeNull();

      const ledger = await prisma.reactionExecution.findFirst({
        where: { tenantId, eventId: invoicedEvent!.id, ruleId: rule!.id },
      });
      expect(ledger).not.toBeNull();
      expect(['EXECUTED', 'FAILED']).toContain(ledger!.status);
      if (ledger) cleanupReactionIds.push(ledger.id);
    });

    it('running processPending a second time does NOT create a second CustomerInvoice (idempotent)', async () => {
      // Run again
      await domainEvents.processPending(50);

      // Still exactly one invoice linked to soId3
      const invoices = await prisma.customerInvoice.findMany({
        where: {
          tenantId,
          customerId: customerId3,
          customData: { path: ['salesOrderId'], equals: soId3 },
        },
      });
      expect(invoices).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 4 — no customerId → no invoice, no crash
  // ---------------------------------------------------------------------------
  describe('Scenario 4 — SO without customerId → no invoice created', () => {
    it('invoice a SO with no customerId → processPending → no CustomerInvoice, no error', async () => {
      // Create a company and SO directly (no deal conversion → no customerId)
      const company = (
        await request(http)
          .post('/api/v1/crm/companies')
          .set(auth())
          .send({ name: `XMod-Co4-${suffix}` })
          .expect(201)
      ).body as { id: string };
      cleanupCompanyIds.push(company.id);

      const so = (
        await request(http)
          .post('/api/v1/crm/sales-orders')
          .set(auth())
          .send({ companyId: company.id })
          .expect(201)
      ).body as { id: string };
      cleanupSalesOrderIds.push(so.id);

      // Add a line item (needed for fulfill to not error)
      await request(http)
        .post(`/api/v1/crm/sales-orders/${so.id}/line-items`)
        .set(auth())
        .send({ name: 'Misc', quantity: 1, unitPrice: 10 })
        .expect(201);

      // Drive to INVOICED
      await advanceSoToInvoiced(so.id);

      // Run the worker — must not throw
      await domainEvents.processPending(50);

      // No invoice should exist linked to this SO
      const invoices = await prisma.customerInvoice.findMany({
        where: {
          tenantId,
          customData: { path: ['salesOrderId'], equals: so.id },
        },
      });
      expect(invoices).toHaveLength(0);

      // The reaction ledger row for this event should be EXECUTED (no-op path) or absent.
      // Specifically, not FAILED in a way that caused a cascade (just log + return).
      const invoicedEvent = await prisma.domainEvent.findFirst({
        where: {
          tenantId,
          type: 'crm.sales_order.invoiced',
          payload: { path: ['salesOrderId'], equals: so.id },
        },
      });
      // Event must exist (emitted by the service)
      expect(invoicedEvent).not.toBeNull();
      if (invoicedEvent) cleanupEventIds.push(invoicedEvent.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 5 — tenant isolation
  // ---------------------------------------------------------------------------
  describe('Scenario 5 — tenant isolation', () => {
    let isolTenantId = '';

    beforeAll(async () => {
      const t = await prisma.tenant.create({
        data: { slug: `xmod-isol-${suffix}`, name: `XMod Isol ${suffix}`, status: 'ACTIVE' },
      });
      isolTenantId = t.id;
    });

    afterAll(async () => {
      if (isolTenantId) {
        await prisma.reactionExecution.deleteMany({ where: { tenantId: isolTenantId } }).catch(() => undefined);
        await prisma.domainEvent.deleteMany({ where: { tenantId: isolTenantId } }).catch(() => undefined);
        await prisma.customerInvoice.deleteMany({ where: { tenantId: isolTenantId } }).catch(() => undefined);
        await prisma.tenantModule.deleteMany({ where: { tenantId: isolTenantId } }).catch(() => undefined);
        await prisma.tenant.deleteMany({ where: { id: isolTenantId } }).catch(() => undefined);
      }
    });

    it('events/invoices are scoped to acme — isolated tenant emitting a fake SO event does not create acme invoices', async () => {
      // Count acme CustomerInvoice rows before
      const beforeCount = await prisma.customerInvoice.count({ where: { tenantId } });

      // Emit a fake crm.sales_order.invoiced for the isolated tenant
      await domainEvents.emit(
        isolTenantId,
        'crm.sales_order.invoiced',
        { type: 'sales-order', id: `fake-so-isol-${suffix}` },
        { salesOrderId: `fake-so-isol-${suffix}`, companyId: 'x', customerId: 'y' },
      );
      await domainEvents.processPending(50);

      // acme invoice count must not have increased
      const afterCount = await prisma.customerInvoice.count({ where: { tenantId } });
      expect(afterCount).toBe(beforeCount);

      // No invoice created for isolated tenant either (no rule, no customer)
      const isolInvoices = await prisma.customerInvoice.count({ where: { tenantId: isolTenantId } });
      expect(isolInvoices).toBe(0);
    });
  });
});
