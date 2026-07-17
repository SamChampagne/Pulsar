/**
 * E2E — consolidated "lead-to-cash" narrative proving the CRM→Billing pipeline
 * that ACTUALLY connects in code, end to end: a single deal is walked from
 * creation through a WON sale, converted into a billing Customer, turned into
 * a SalesOrder, driven to INVOICED (emitting crm.sales_order.invoiced), which
 * (via the seeded reaction rule + DomainEventsService.processPending()) drafts
 * a CustomerInvoice — which is then approved, sent and paid, posting a
 * balanced double-entry GL journal at each step (rule 41/42).
 *
 * There is NO code path from a CRM SalesOrder to a transportation
 * TransportOrder — this suite does not attempt one. The connected pipeline is
 * strictly: Deal → SalesOrder → (reaction) draft CustomerInvoice → approve →
 * send → pay (+ GL).
 *
 * Bootstrap mirrors crm-cross-module.e2e-spec.ts / billing-ledger.e2e-spec.ts:
 *   - FakeAgentRuntimeService (no Hermes)
 *   - Login as seeded admin, resolve acme tenantId
 *   - crm + billing modules enabled via tenantModule.upsert
 *   - DomainEventsService.processPending() to drive the reaction
 *
 * Prerequisites: reachable PostgreSQL with seed applied (pnpm db:seed).
 * Run: pnpm --filter @pulsar/api test:e2e -- lead-to-cash
 */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { DomainEventsService } from '../src/core/operating/domain-events.service';
import { AgentsService } from '../src/core/agents/agents.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const suffix = `L2C-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Stub — no-op AgentRuntimeService so the app boots without a real Hermes process.
// ---------------------------------------------------------------------------
@Injectable()
class FakeAgentRuntimeService {
  constructor(private readonly _agents: AgentsService) {}
  async openSession(): Promise<string> { return 'fake-session'; }
  async *sendTurn(): AsyncGenerator<never> { /* no turns */ }
  async closeSession(): Promise<void> { /* no-op */ }
  async killAgentSessions(): Promise<void> { /* no-op */ }
}

describe('Lead-to-cash (e2e) — CRM Deal → SalesOrder → CustomerInvoice → GL', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let domainEvents: DomainEventsService;
  let token = '';
  let tenantId = '';

  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Cleanup IDs (FK-safe order in afterAll)
  let companyId = '';
  let dealId = '';
  let customerId = '';
  let soId = '';
  let invoiceId = '';
  const eventIds: string[] = [];
  const reactionIds: string[] = [];

  async function enableModule(key: string) {
    const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });
  }

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
    // Test isolation: drain the PENDING domain-event backlog inherited from
    // earlier e2e suites (global + oldest-first + batch-limited queue, so a
    // large cross-suite backlog would otherwise starve this suite's freshly-
    // emitted events out of its processPending(N) window). Harmless — those
    // events belong to already-completed suites.
    for (let _i = 0; _i < 100; _i++) {
      if ((await domainEvents.processPending(500)) === 0) break;
    }

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    await enableModule('crm');
    await enableModule('billing');

    // Direct invoicing defaults to true, but be explicit (mirrors billing-ledger e2e).
    await request(http)
      .put('/api/v1/modules/crm/settings')
      .set(auth())
      .send({ settings: { salesOrderDirectInvoicing: true } })
      .expect(200);

    // Ensure the built-in reaction rule exists (seeded by pnpm db:seed; be idempotent —
    // mirrors crm-cross-module.e2e-spec.ts).
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
          action: {
            kind: 'RUN_ACTION',
            action: 'draft_invoice_from_sales_order',
            args: { salesOrderId: '{salesOrderId}' },
          },
        },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      const alloc = await prisma.paymentAllocation
        .findFirst({ where: { tenantId, targetType: 'CUSTOMER_INVOICE', targetId: invoiceId || 'none' } })
        .catch(() => null);
      await prisma.paymentAllocation
        .deleteMany({ where: { tenantId, targetType: 'CUSTOMER_INVOICE', targetId: invoiceId || 'none' } })
        .catch(() => undefined);
      if (alloc) {
        await prisma.journalLine
          .deleteMany({ where: { entry: { tenantId, sourceType: 'payment', sourceId: alloc.paymentId } } })
          .catch(() => undefined);
        await prisma.journalEntry
          .deleteMany({ where: { tenantId, sourceType: 'payment', sourceId: alloc.paymentId } })
          .catch(() => undefined);
        await prisma.payment
          .deleteMany({ where: { tenantId, id: alloc.paymentId } })
          .catch(() => undefined);
      }
      await prisma.journalLine
        .deleteMany({ where: { entry: { tenantId, OR: [
          { sourceType: 'customer-invoice', sourceId: invoiceId || 'none' },
        ] } } })
        .catch(() => undefined);
      await prisma.journalEntry
        .deleteMany({ where: { tenantId, sourceType: 'customer-invoice', sourceId: invoiceId || 'none' } })
        .catch(() => undefined);
      await prisma.customerInvoice
        .deleteMany({ where: { id: invoiceId || 'none' } })
        .catch(() => undefined);
      await prisma.reactionExecution
        .deleteMany({ where: { id: { in: reactionIds } } })
        .catch(() => undefined);
      await prisma.domainEvent
        .deleteMany({ where: { tenantId, id: { in: eventIds } } })
        .catch(() => undefined);
      await prisma.salesOrder
        .deleteMany({ where: { id: soId || 'none' } })
        .catch(() => undefined);
      await prisma.crmDeal
        .deleteMany({ where: { id: dealId || 'none' } })
        .catch(() => undefined);
      await prisma.crmCompany
        .deleteMany({ where: { id: companyId || 'none' } })
        .catch(() => undefined);
      await prisma.customer
        .deleteMany({ where: { id: customerId || 'none' } })
        .catch(() => undefined);
    }
    await app.close();
  });

  it('walks a deal from creation to a paid, ledgered customer invoice', async () => {
    // -------------------------------------------------------------------
    // 1. Create a CRM company
    // -------------------------------------------------------------------
    const company = (
      await request(http)
        .post('/api/v1/crm/companies')
        .set(auth())
        .send({ name: `L2C Co ${suffix}` })
        .expect(201)
    ).body as { id: string };
    companyId = company.id;

    // -------------------------------------------------------------------
    // 2. Create a deal + add a positive-total line item
    // -------------------------------------------------------------------
    const deal = (
      await request(http)
        .post('/api/v1/crm/deals')
        .set(auth())
        .send({ title: `L2C Deal ${suffix}`, companyId })
        .expect(201)
    ).body as { id: string };
    dealId = deal.id;

    await request(http)
      .post(`/api/v1/crm/deals/${dealId}/line-items`)
      .set(auth())
      .send({ name: 'Consulting hours', quantity: 4, unitPrice: 375 })
      .expect(201);

    // Advance LEAD → QUALIFIED → PROPOSAL → WON
    for (const stage of ['QUALIFIED', 'PROPOSAL', 'WON']) {
      await request(http)
        .post(`/api/v1/crm/deals/${dealId}/advance`)
        .set(auth())
        .send({ stage })
        .expect(200);
    }

    // -------------------------------------------------------------------
    // 3. Convert the WON deal → creates/links a billing Customer
    // -------------------------------------------------------------------
    const conv = (
      await request(http)
        .post(`/api/v1/crm/deals/${dealId}/convert`)
        .set(auth())
        .expect(200)
    ).body as { dealId: string; customerId: string };
    customerId = conv.customerId;
    expect(customerId).toBeTruthy();

    // -------------------------------------------------------------------
    // 4. Deal already WON (step done above) — 5. Create the sales order
    // -------------------------------------------------------------------
    const so = (
      await request(http)
        .post(`/api/v1/crm/deals/${dealId}/create-sales-order`)
        .set(auth())
        .expect(201)
    ).body as {
      id: string;
      dealId: string;
      customerId: string | null;
      totalAmount: string | number;
      lineItems: { name: string; quantity: number; unitPrice: number }[];
    };
    soId = so.id;

    expect(so.dealId).toBe(dealId);
    expect(so.customerId).toBe(customerId);
    expect(Number(so.totalAmount)).toBe(4 * 375); // 1500
    expect(so.lineItems).toHaveLength(1);

    // -------------------------------------------------------------------
    // 6. Drive the SO lifecycle: confirm → fulfill → invoice
    // -------------------------------------------------------------------
    await request(http).post(`/api/v1/crm/sales-orders/${soId}/confirm`).set(auth()).expect(200);
    await request(http).post(`/api/v1/crm/sales-orders/${soId}/fulfill`).set(auth()).expect(200);
    const invoicedSo = (
      await request(http).post(`/api/v1/crm/sales-orders/${soId}/invoice`).set(auth()).expect(200)
    ).body as { status: string };
    expect(invoicedSo.status).toBe('INVOICED');

    // crm.sales_order.invoiced DomainEvent row must exist
    const invoicedEvent = await prisma.domainEvent.findFirst({
      where: {
        tenantId,
        type: 'crm.sales_order.invoiced',
        payload: { path: ['salesOrderId'], equals: soId },
      },
    });
    expect(invoicedEvent).not.toBeNull();
    if (invoicedEvent) eventIds.push(invoicedEvent.id);

    // -------------------------------------------------------------------
    // 7. Trigger the reaction → DRAFT CustomerInvoice linked to the SO
    // -------------------------------------------------------------------
    await domainEvents.processPending(50);

    const rule = await prisma.automationRule.findFirst({
      where: { tenantId, eventType: 'crm.sales_order.invoiced', enabled: true },
    });
    expect(rule).not.toBeNull();
    if (invoicedEvent && rule) {
      const ledger = await prisma.reactionExecution.findFirst({
        where: { tenantId, eventId: invoicedEvent.id, ruleId: rule.id },
      });
      expect(ledger).not.toBeNull();
      expect(['EXECUTED', 'FAILED']).toContain(ledger!.status);
      if (ledger) reactionIds.push(ledger.id);
    }

    const draftInvoices = await prisma.customerInvoice.findMany({
      where: {
        tenantId,
        customerId,
        customData: { path: ['salesOrderId'], equals: soId },
      },
    });
    expect(draftInvoices).toHaveLength(1);
    expect(draftInvoices[0].status).toBe('DRAFT');
    invoiceId = draftInvoices[0].id;
    expect(Number(draftInvoices[0].totalAmount)).toBe(1500);

    // Need the customer to have an email for the send() step.
    await prisma.customer.update({
      where: { id: customerId },
      data: { email: `l2c-${suffix}@example.test` },
    });

    // -------------------------------------------------------------------
    // 8. Approve → send → pay
    // -------------------------------------------------------------------
    const approved = (
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceId}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status))
    ).body as { status: string };
    expect(approved.status).toBe('APPROVED');

    await request(http)
      .post(`/api/v1/billing/customer-invoices/${invoiceId}/send`)
      .set(auth())
      .expect((r) => expect([200, 201]).toContain(r.status));

    const paid = (
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceId}/pay`)
        .set(auth())
        .send({})
        .expect((r) => expect([200, 201]).toContain(r.status))
    ).body as { status: string };
    expect(paid.status).toBe('PAID');

    // -------------------------------------------------------------------
    // 9. Assert balanced GL journal entries were posted (approve + pay)
    // -------------------------------------------------------------------
    const approveEntry = await prisma.journalEntry.findFirst({
      where: { tenantId, sourceType: 'customer-invoice', sourceId: invoiceId, sourceKind: 'approved' },
      include: { lines: { include: { account: true } } },
    });
    expect(approveEntry).not.toBeNull();
    const approveDebit = approveEntry!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const approveCredit = approveEntry!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(approveDebit).toBe(approveCredit);
    expect(approveDebit).toBe(1500);
    // AR (1100) debited, Revenue (4000) credited (rule 41/16 — DR AR / CR Revenue on approve)
    const arLine = approveEntry!.lines.find((l) => l.account.code === '1100');
    const revLine = approveEntry!.lines.find((l) => l.account.code === '4000');
    expect(arLine).toBeDefined();
    expect(Number(arLine!.debit)).toBe(1500);
    expect(revLine).toBeDefined();
    expect(Number(revLine!.credit)).toBe(1500);

    // Payment GL entry (DR Cash / CR AR) — routed through PaymentsService (rule 42)
    const alloc = await prisma.paymentAllocation.findFirst({
      where: { tenantId, targetType: 'CUSTOMER_INVOICE', targetId: invoiceId },
      select: { paymentId: true },
    });
    expect(alloc).not.toBeNull();

    const payEntry = await prisma.journalEntry.findFirst({
      where: { tenantId, sourceType: 'payment', sourceId: alloc!.paymentId },
      include: { lines: { include: { account: true } } },
    });
    expect(payEntry).not.toBeNull();
    const payDebit = payEntry!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const payCredit = payEntry!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(payDebit).toBe(payCredit);
    expect(payDebit).toBe(1500);
    const cashLine = payEntry!.lines.find((l) => l.account.code === '1000');
    const arCreditLine = payEntry!.lines.find((l) => l.account.code === '1100');
    expect(cashLine).toBeDefined();
    expect(Number(cashLine!.debit)).toBe(1500);
    expect(arCreditLine).toBeDefined();
    expect(Number(arCreditLine!.credit)).toBe(1500);
  }, 60_000);
});
