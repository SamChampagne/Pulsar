/**
 * E2E: Payments — partial/full/cancel/isolation/over-allocation/currency-mismatch
 *
 * Covers:
 *   1. Customer statement (APPROVED): partial RECEIVE payment (40/100) → submit →
 *      amountPaid=40, status stays APPROVED; open-invoices shows outstanding 60.
 *   2. Second payment (60/100) → submit → statement PAID, amountPaid=100.
 *   3. Ledger: two balanced sourceType='payment' entries; AR credited 100, cash debited 100.
 *   4. Cancel the second payment → reversing entry posted; statement reverts to APPROVED,
 *      amountPaid back to 40.
 *   5. Carrier invoice happy path (PAY): AP debited, cash credited; invoice → PAID.
 *   6. Tenant isolation: second tenant token gets 404 on GET /billing/payments/:id of
 *      the first tenant's payment.
 *   7. Over-allocation: allocating 150 against a 100 statement → 400.
 *   8. Currency mismatch: payment in USD allocating a CAD invoice → 400 at submit.
 *      (Finding 2 guard — submit-time coherence check.)
 *
 * Note (Finding 1 — concurrent over-pay): the `submit` and `cancel` paths use a
 * conditional-claim updateMany({ where: { amountPaid: <prior> } }) to guard against
 * concurrent writes racing through READ COMMITTED. A deterministic parallel e2e test
 * would be flaky; correctness is enforced in payments.service.ts and covered by case 7
 * (over-allocation still rejected via the newPaid > totalAmount guard on the freshly-read value).
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
// Stub — keeps the app bootable without a real Hermes process
// ---------------------------------------------------------------------------
@Injectable()
class FakeAgentRuntimeService {
  constructor(private readonly _agents: AgentsService) {}
  async openSession(): Promise<string> {
    return 'fake-session';
  }
  async *sendTurn(): AsyncGenerator<never> {
    /* no turns */
  }
  async closeSession(): Promise<void> {
    /* no-op */
  }
  async killAgentSessions(): Promise<void> {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const suffix = `${Date.now()}-pay`;

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let token = '';
let tenantId = '';

// Master data
let customerId = '';
let carrierId = '';
let modeOfPaymentId = '';

// Cleanup tracking
const customerInvoiceIds: string[] = [];
const carrierInvoiceIds: string[] = [];
const paymentIds: string[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const auth = () => ({ Authorization: `Bearer ${token}` });

async function enableModule(key: string) {
  const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
  await prisma.tenantModule.upsert({
    where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
    update: { enabled: true },
    create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
  });
}

async function ensurePermission(adminRoleId: string, key: string, module: string) {
  const perm = await prisma.permission.upsert({
    where: { key },
    update: {},
    create: { key, module, description: `Permission: ${key}` },
  });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: adminRoleId, permissionId: perm.id } },
    update: {},
    create: { roleId: adminRoleId, permissionId: perm.id },
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

describe('Payments (e2e)', () => {
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

    await enableModule('billing');

    // Ensure payment permissions are assigned to the admin role.
    const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'admin' } });
    for (const [key, module] of [
      ['billing.payments.read', 'billing'],
      ['billing.payments.manage', 'billing'],
      ['billing.ledger.read', 'billing'],
      ['billing.ledger.manage', 'billing'],
    ]) {
      await ensurePermission(adminRole.id, key, module);
    }

    // Re-login to get a fresh JWT with the newly assigned permissions.
    const loginRefresh = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (loginRefresh.body as { accessToken: string }).accessToken;

    // Seed a customer with email.
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        code: `PAY-CUST-${suffix}`,
        name: `Pay Customer ${suffix}`,
        email: `pay-cust-${suffix}@example.com`,
      },
    });
    customerId = customer.id;

    // Seed a carrier.
    const carrier = await prisma.carrier.create({
      data: {
        tenantId,
        code: `PAY-CARR-${suffix}`,
        name: `Pay Carrier ${suffix}`,
      },
    });
    carrierId = carrier.id;

    // Seed a mode of payment (or use the first seeded one).
    const existingMode = await prisma.modeOfPayment.findFirst({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    if (existingMode) {
      modeOfPaymentId = existingMode.id;
    } else {
      const mode = await prisma.modeOfPayment.create({
        data: {
          tenantId,
          name: `PAY-MODE-${suffix}`,
          accountCode: '1000',
          isDefault: true,
        },
      });
      modeOfPaymentId = mode.id;
    }

    // Ensure ledger auto-post is on.
    await request(http)
      .put('/api/v1/modules/billing/settings')
      .set(auth())
      .send({ settings: { ledgerAutoPost: true } })
      .expect(200);
  });

  afterAll(async () => {
    // Cleanup in dependency order: payments → invoices → master data.
    if (paymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } }).catch(() => undefined);
    }
    if (customerInvoiceIds.length > 0) {
      await prisma.customerInvoice
        .deleteMany({ where: { id: { in: customerInvoiceIds } } })
        .catch(() => undefined);
    }
    if (carrierInvoiceIds.length > 0) {
      await prisma.invoice
        .deleteMany({ where: { id: { in: carrierInvoiceIds } } })
        .catch(() => undefined);
    }
    await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    await prisma.carrier.deleteMany({ where: { id: carrierId } }).catch(() => undefined);
    await app?.close();
  });

  describe('Payment party and draft integrity', () => {
    let ownInvoice = '';
    let foreignInvoice = '';
    let secondCustomer = '';
    let secondCarrier = '';
    let foreignCarrierInvoice = '';
    let foreignTenant = '';
    let crossTenantInvoice = '';
    const payload = (targetId = ownInvoice) => ({
      type: 'RECEIVE',
      partyType: 'CUSTOMER',
      partyId: customerId,
      modeOfPaymentId,
      date: new Date().toISOString(),
      currency: 'CAD',
      totalAmount: 20,
      allocations: [{ targetType: 'CUSTOMER_INVOICE', targetId, amount: 20 }],
    });
    const draft = async () => {
      const res = await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send(payload())
        .expect(201);
      paymentIds.push(res.body.id);
      return res.body.id as string;
    };
    const assertUnposted = async (id: string) => {
      const p = await prisma.payment.findFirstOrThrow({ where: { id, tenantId } });
      expect(p.status).toBe('DRAFT');
      expect(
        await prisma.journalEntry.count({
          where: { tenantId, sourceType: 'payment', sourceId: id },
        }),
      ).toBe(0);
    };

    beforeAll(async () => {
      secondCustomer = (
        await prisma.customer.create({
          data: { tenantId, code: `PAY-SECOND-${suffix}`, name: 'Second customer' },
        })
      ).id;
      secondCarrier = (
        await prisma.carrier.create({
          data: { tenantId, code: `PAY-SECOND-${suffix}`, name: 'Second carrier' },
        })
      ).id;
      for (const [party, label] of [
        [customerId, 'OWN'],
        [secondCustomer, 'FOREIGN'],
      ]) {
        const inv = await prisma.customerInvoice.create({
          data: {
            tenantId,
            customerId: party,
            invoiceNumber: `PAY-${label}-${suffix}`,
            totalAmount: 100,
            currency: 'CAD',
            status: 'APPROVED',
          },
        });
        customerInvoiceIds.push(inv.id);
        if (label === 'OWN') ownInvoice = inv.id;
        else foreignInvoice = inv.id;
      }
      foreignCarrierInvoice = (
        await prisma.invoice.create({
          data: {
            tenantId,
            carrierId: secondCarrier,
            invoiceNumber: `PAY-FOREIGN-CARRIER-${suffix}`,
            totalAmount: 100,
            currency: 'CAD',
            status: 'APPROVED',
          },
        })
      ).id;
      carrierInvoiceIds.push(foreignCarrierInvoice);
      foreignTenant = (
        await prisma.tenant.create({
          data: { slug: `pay-write-${suffix}`, name: 'Other payment tenant' },
        })
      ).id;
      const c = await prisma.customer.create({
        data: { tenantId: foreignTenant, code: 'OTHER', name: 'Other tenant customer' },
      });
      crossTenantInvoice = (
        await prisma.customerInvoice.create({
          data: {
            tenantId: foreignTenant,
            customerId: c.id,
            invoiceNumber: 'OTHER-1',
            totalAmount: 100,
            status: 'APPROVED',
          },
        })
      ).id;
    });
    afterAll(async () => {
      await prisma.customerInvoice.deleteMany({ where: { tenantId, customerId: secondCustomer } });
      await prisma.invoice.deleteMany({ where: { tenantId, carrierId: secondCarrier } });
      await prisma.customer.deleteMany({ where: { id: secondCustomer, tenantId } });
      await prisma.carrier.deleteMany({ where: { id: secondCarrier, tenantId } });
      await prisma.customerInvoice.deleteMany({ where: { tenantId: foreignTenant } });
      await prisma.customer.deleteMany({ where: { tenantId: foreignTenant } });
      await prisma.tenant.deleteMany({ where: { id: foreignTenant } });
    });

    it('rejects another customer invoice before creating a payment', async () => {
      const before = await prisma.payment.count({ where: { tenantId } });
      await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send(payload(foreignInvoice))
        .expect(400);
      expect(await prisma.payment.count({ where: { tenantId } })).toBe(before);
    });
    it('rejects another carrier invoice', async () => {
      await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({
          ...payload(),
          type: 'PAY',
          partyType: 'CARRIER',
          partyId: carrierId,
          allocations: [
            { targetType: 'CARRIER_INVOICE', targetId: foreignCarrierInvoice, amount: 20 },
          ],
        })
        .expect(400);
    });
    it('rejects foreign-tenant and missing targets', async () => {
      for (const targetId of [crossTenantInvoice, 'missing-invoice'])
        await request(http)
          .post('/api/v1/billing/payments')
          .set(auth())
          .send(payload(targetId))
          .expect(400);
    });
    it('rejects the wrong direction and duplicate targets', async () => {
      await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({ ...payload(), type: 'PAY' })
        .expect(400);
      const p = payload();
      await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({ ...p, totalAmount: 40, allocations: [...p.allocations, ...p.allocations] })
        .expect(400);
    });
    it('rejects allocation replacement atomically, preserving the original draft', async () => {
      const id = await draft();
      await request(http)
        .patch(`/api/v1/billing/payments/${id}`)
        .set(auth())
        .send({ allocations: payload(foreignInvoice).allocations, reference: 'must not persist' })
        .expect(400);
      const p = await prisma.payment.findFirstOrThrow({
        where: { id, tenantId },
        include: { allocations: true },
      });
      expect(p.reference).toBeNull();
      expect(p.allocations).toHaveLength(1);
      expect(p.allocations[0].targetId).toBe(ownInvoice);
      await assertUnposted(id);
    });
    it('explicitly rejects changes to immutable payment identity', async () => {
      const id = await draft();
      for (const change of [
        { partyId: secondCustomer },
        { type: 'PAY' },
        { currency: 'USD' },
        { modeOfPaymentId: 'missing' },
      ])
        await request(http)
          .patch(`/api/v1/billing/payments/${id}`)
          .set(auth())
          .send(change)
          .expect(400);
      await request(http)
        .patch(`/api/v1/billing/payments/${id}`)
        .set(auth())
        .send({ currency: 'CAD', note: 'Same identity allowed' })
        .expect(200);
    });
    it('rechecks legacy allocations at submit and rolls back every invoice and GL change', async () => {
      const id = await draft();
      // Deliberately corrupt a persisted draft to model data created before this guard.
      await prisma.paymentAllocation.create({
        data: {
          tenantId,
          paymentId: id,
          targetType: 'CUSTOMER_INVOICE',
          targetId: foreignInvoice,
          amount: 20,
        },
      });
      await prisma.payment.update({ where: { id }, data: { totalAmount: 40 } });
      await request(http).post(`/api/v1/billing/payments/${id}/submit`).set(auth()).expect(400);
      await assertUnposted(id);
      for (const invoiceId of [ownInvoice, foreignInvoice]) {
        const inv = await prisma.customerInvoice.findFirstOrThrow({
          where: { id: invoiceId, tenantId },
        });
        expect(Number(inv.amountPaid)).toBe(0);
        expect(inv.status).toBe('APPROVED');
      }
    });
    it('rejects partial payment on an unapproved invoice', async () => {
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          customerId,
          invoiceNumber: `PAY-DRAFT-${suffix}`,
          totalAmount: 100,
          status: 'DRAFT',
        },
      });
      customerInvoiceIds.push(inv.id);
      const res = await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send(payload(inv.id))
        .expect(201);
      paymentIds.push(res.body.id);
      await request(http)
        .post(`/api/v1/billing/payments/${res.body.id}/submit`)
        .set(auth())
        .expect(400);
      await assertUnposted(res.body.id);
    });
    it('serializes concurrent edit and submit without stale journal amounts', async () => {
      const id = await draft();
      const [edit, submit] = await Promise.all([
        request(http)
          .patch(`/api/v1/billing/payments/${id}`)
          .set(auth())
          .send({
            totalAmount: 30,
            allocations: [{ targetType: 'CUSTOMER_INVOICE', targetId: ownInvoice, amount: 30 }],
          }),
        request(http).post(`/api/v1/billing/payments/${id}/submit`).set(auth()),
      ]);
      expect([200, 400]).toContain(edit.status);
      expect([200, 201]).toContain(submit.status);
      const payment = await prisma.payment.findFirstOrThrow({
        where: { id, tenantId },
        include: { allocations: true },
      });
      const entry = await prisma.journalEntry.findFirstOrThrow({
        where: { tenantId, sourceType: 'payment', sourceId: id },
        include: { lines: true },
      });
      const allocated = payment.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
      expect(allocated).toBe(edit.status === 200 ? 30 : 20);
      expect(entry.lines.reduce((sum, line) => sum + Number(line.debit), 0)).toBe(allocated);
      expect(
        Number(
          (await prisma.customerInvoice.findFirstOrThrow({ where: { id: ownInvoice, tenantId } }))
            .amountPaid,
        ),
      ).toBe(allocated);
      await request(http)
        .patch(`/api/v1/billing/payments/${id}`)
        .set(auth())
        .send({ note: 'after submission' })
        .expect(400);
    });
  });

  // ===========================================================================
  // Suite 1 — Partial payment (RECEIVE 40/100), then full payment (60), then cancel
  // ===========================================================================
  describe('Customer invoice: partial → full → cancel', () => {
    let invoiceId = '';
    let payment1Id = '';
    let payment2Id = '';
    const TOTAL = 100;

    beforeAll(async () => {
      // Insert a DRAFT customer invoice directly via Prisma, then approve it.
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `PAY-CINV-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: TOTAL,
          status: 'DRAFT',
        },
      });
      invoiceId = inv.id;
      customerInvoiceIds.push(invoiceId);

      // Approve via API (DRAFT → APPROVED).
      await request(http)
        .post(`/api/v1/billing/customer-invoices/${invoiceId}/approve`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
    });

    // -----------------------------------------------------------------------
    // Case 1: RECEIVE 40 → submit → amountPaid=40, status stays APPROVED
    // -----------------------------------------------------------------------
    it('1a. POST /billing/payments creates RECEIVE DRAFT with alloc=40 → 201', async () => {
      const res = await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({
          type: 'RECEIVE',
          partyType: 'CUSTOMER',
          partyId: customerId,
          modeOfPaymentId,
          date: new Date().toISOString(),
          totalAmount: 40,
          allocations: [{ targetType: 'CUSTOMER_INVOICE', targetId: invoiceId, amount: 40 }],
        })
        .expect(201);

      payment1Id = (res.body as { id: string }).id;
      paymentIds.push(payment1Id);
      expect(payment1Id).toBeTruthy();
      expect((res.body as { status: string }).status).toBe('DRAFT');
    });

    it('1b. submit payment1 → 200/201; invoice amountPaid=40, status=APPROVED', async () => {
      await request(http)
        .post(`/api/v1/billing/payments/${payment1Id}/submit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      const inv = await prisma.customerInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(Number(inv.amountPaid)).toBe(40);
      expect(inv.status).toBe('APPROVED');
    });

    it('1c. GET open-invoices shows outstanding=60 for this invoice', async () => {
      const res = await request(http)
        .get(`/api/v1/billing/payments/open-invoices?partyType=CUSTOMER&partyId=${customerId}`)
        .set(auth())
        .expect(200);

      const items = res.body as Array<{ id: string; outstanding: number }>;
      const entry = items.find((i) => i.id === invoiceId);
      expect(entry).toBeDefined();
      expect(entry!.outstanding).toBe(60);
    });

    // -----------------------------------------------------------------------
    // Case 2: RECEIVE 60 → submit → invoice PAID, amountPaid=100
    // -----------------------------------------------------------------------
    it('2a. POST /billing/payments creates second RECEIVE DRAFT with alloc=60 → 201', async () => {
      const res = await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({
          type: 'RECEIVE',
          partyType: 'CUSTOMER',
          partyId: customerId,
          modeOfPaymentId,
          date: new Date().toISOString(),
          totalAmount: 60,
          allocations: [{ targetType: 'CUSTOMER_INVOICE', targetId: invoiceId, amount: 60 }],
        })
        .expect(201);

      payment2Id = (res.body as { id: string }).id;
      paymentIds.push(payment2Id);
      expect(payment2Id).toBeTruthy();
    });

    it('2b. submit payment2 → invoice status=PAID, amountPaid=100', async () => {
      await request(http)
        .post(`/api/v1/billing/payments/${payment2Id}/submit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      const inv = await prisma.customerInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(Number(inv.amountPaid)).toBe(100);
      expect(inv.status).toBe('PAID');
    });

    // -----------------------------------------------------------------------
    // Case 3: Ledger — two balanced payment entries; AR credited 100, cash debited 100
    // -----------------------------------------------------------------------
    it('3. Two balanced sourceType=payment JournalEntries exist; AR credited 100, cash debited 100', async () => {
      const entries = await prisma.journalEntry.findMany({
        where: { tenantId, sourceType: 'payment', sourceId: { in: [payment1Id, payment2Id] } },
        include: { lines: { include: { account: true } } },
      });
      // One entry per payment submission (sourceKind is null/undefined for submit).
      expect(entries.length).toBe(2);

      for (const entry of entries) {
        const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
        const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
        expect(totalDebit).toBeCloseTo(totalCredit, 5);
      }

      // Aggregate across both: AR credited 100 total, cash/bank debited 100 total.
      const allLines = entries.flatMap((e) => e.lines);
      const arCode = '1100';
      const cashCode = '1000';
      const arCredited = allLines
        .filter((l) => l.account.code === arCode)
        .reduce((s, l) => s + Number(l.credit), 0);
      const cashDebited = allLines
        .filter((l) => l.account.code === cashCode)
        .reduce((s, l) => s + Number(l.debit), 0);
      expect(arCredited).toBe(100);
      expect(cashDebited).toBe(100);
      const journal = await request(http)
        .get('/api/v1/billing/ledger/journal')
        .query({ sourceType: 'payment', sourceId: payment1Id })
        .set(auth())
        .expect(200);
      expect(journal.body.total).toBe(1);
      expect(journal.body.items[0].sourceId).toBe(payment1Id);
      const missing = await request(http)
        .get('/api/v1/billing/ledger/journal')
        .query({ sourceType: 'invoice', sourceId: payment1Id })
        .set(auth())
        .expect(200);
      expect(missing.body.total).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Case 4: Cancel second payment → reversing entry; statement reverts to APPROVED, amountPaid=40
    // -----------------------------------------------------------------------
    it('4a. cancel payment2 → 200/201; status=CANCELLED', async () => {
      const res = await request(http)
        .post(`/api/v1/billing/payments/${payment2Id}/cancel`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      expect((res.body as { status: string }).status).toBe('CANCELLED');
    });

    it('4b. invoice reverts to APPROVED, amountPaid=40', async () => {
      const inv = await prisma.customerInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(Number(inv.amountPaid)).toBe(40);
      expect(inv.status).toBe('APPROVED');
    });

    it('4c. reversing GL entry posted for payment2 (sourceKind=reversal)', async () => {
      const reversal = await prisma.journalEntry.findFirst({
        where: { tenantId, sourceType: 'payment', sourceId: payment2Id, sourceKind: 'reversal' },
        include: { lines: { include: { account: true } } },
      });
      expect(reversal).not.toBeNull();
      const totalDebit = reversal!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = reversal!.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(totalDebit).toBeCloseTo(totalCredit, 5);
      // Reversal credits the mode account and debits AR (swap of submit).
      const arCode = '1100';
      const cashCode = '1000';
      const arLine = reversal!.lines.find((l) => l.account.code === arCode);
      const cashLine = reversal!.lines.find((l) => l.account.code === cashCode);
      expect(arLine).toBeDefined();
      expect(Number(arLine!.debit)).toBe(60);
      expect(cashLine).toBeDefined();
      expect(Number(cashLine!.credit)).toBe(60);
    });
  });

  // ===========================================================================
  // Suite 2 — Carrier invoice happy path (PAY): AP debited, cash credited; invoice PAID
  // ===========================================================================
  describe('Carrier invoice: PAY happy path', () => {
    let invoiceId = '';
    let paymentId = '';
    const TOTAL = 200;

    beforeAll(async () => {
      // Insert an approved carrier Invoice directly via Prisma
      // (avoids the TMS pipeline: no loads needed for this payment test).
      const inv = await prisma.invoice.create({
        data: {
          tenantId,
          invoiceNumber: `PAY-INV-${suffix}`,
          carrierId,
          currency: 'CAD',
          totalAmount: TOTAL,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });
      invoiceId = inv.id;
      carrierInvoiceIds.push(invoiceId);
    });

    it('5a. POST /billing/payments creates PAY DRAFT with alloc=200 → 201', async () => {
      const res = await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({
          type: 'PAY',
          partyType: 'CARRIER',
          partyId: carrierId,
          modeOfPaymentId,
          date: new Date().toISOString(),
          totalAmount: TOTAL,
          allocations: [{ targetType: 'CARRIER_INVOICE', targetId: invoiceId, amount: TOTAL }],
        })
        .expect(201);

      paymentId = (res.body as { id: string }).id;
      paymentIds.push(paymentId);
      expect(paymentId).toBeTruthy();
      expect((res.body as { status: string }).status).toBe('DRAFT');
    });

    it('5b. submit PAY payment → carrier invoice status=PAID', async () => {
      await request(http)
        .post(`/api/v1/billing/payments/${paymentId}/submit`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(Number(inv.amountPaid)).toBe(TOTAL);
      expect(inv.status).toBe('PAID');
    });

    it('5c. GL entry: AP (2000) debited 200, cash (1000) credited 200', async () => {
      const entry = await prisma.journalEntry.findFirst({
        where: { tenantId, sourceType: 'payment', sourceId: paymentId },
        include: { lines: { include: { account: true } } },
      });
      expect(entry).not.toBeNull();

      const totalDebit = entry!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = entry!.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(totalDebit).toBeCloseTo(totalCredit, 5);

      const apLine = entry!.lines.find((l) => l.account.code === '2000');
      const cashLine = entry!.lines.find((l) => l.account.code === '1000');
      expect(apLine).toBeDefined();
      expect(Number(apLine!.debit)).toBe(TOTAL);
      expect(cashLine).toBeDefined();
      expect(Number(cashLine!.credit)).toBe(TOTAL);
    });
  });

  // ===========================================================================
  // Suite 3 — Tenant isolation: second tenant cannot read first tenant's payment
  // ===========================================================================
  describe('Tenant isolation', () => {
    let otherTenantId = '';
    let otherToken = '';
    let targetPaymentId = '';

    beforeAll(async () => {
      // Create the first-tenant payment to attempt to read cross-tenant.
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `PAY-ISO-CINV-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: 50,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });
      customerInvoiceIds.push(inv.id);

      const payRes = await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({
          type: 'RECEIVE',
          partyType: 'CUSTOMER',
          partyId: customerId,
          modeOfPaymentId,
          date: new Date().toISOString(),
          totalAmount: 50,
          allocations: [{ targetType: 'CUSTOMER_INVOICE', targetId: inv.id, amount: 50 }],
        })
        .expect(201);

      targetPaymentId = (payRes.body as { id: string }).id;
      paymentIds.push(targetPaymentId);

      // Create a second tenant + admin user via Prisma (mirrors flow-control-tower.e2e-spec.ts).
      const otherSlug = `pay-iso-${suffix}`;
      const otherEmail = `pay-iso-${suffix}@example.test`;
      const other = await prisma.tenant.create({
        data: { slug: otherSlug, name: `Pay Iso ${suffix}` },
      });
      otherTenantId = other.id;

      // Enable billing for the other tenant so the module guard doesn't block it;
      // the service-layer tenantId scope is what we're testing.
      const billingMod = await prisma.moduleDefinition.findUniqueOrThrow({
        where: { key: 'billing' },
      });
      await prisma.tenantModule.create({
        data: {
          tenantId: otherTenantId,
          moduleId: billingMod.id,
          enabled: true,
          enabledAt: new Date(),
        },
      });

      // Create billing permissions in the other role.
      const paymentsReadPerm = await prisma.permission.findUniqueOrThrow({
        where: { key: 'billing.payments.read' },
      });
      const otherRole = await prisma.role.create({
        data: {
          tenantId: otherTenantId,
          key: 'admin',
          name: 'Admin',
          isSystem: true,
          permissions: { create: [{ permissionId: paymentsReadPerm.id }] },
        },
      });

      const { hashSync } = await import('bcryptjs');
      await prisma.user.create({
        data: {
          tenantId: otherTenantId,
          email: otherEmail,
          passwordHash: hashSync('Test1234!', 10),
          firstName: 'Other',
          lastName: 'Admin',
          status: 'ACTIVE',
          roles: { create: [{ roleId: otherRole.id }] },
        },
      });

      // Login as the other tenant user.
      const otherLogin = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: otherEmail, password: 'Test1234!', tenant: otherSlug })
        .expect(200);
      otherToken = (otherLogin.body as { accessToken: string }).accessToken;
    });

    afterAll(async () => {
      await prisma.tenant.deleteMany({ where: { id: otherTenantId } }).catch(() => undefined);
    });

    it('6. Other-tenant token gets 404 on GET /billing/payments/:id of first tenant payment', async () => {
      await request(http)
        .get(`/api/v1/billing/payments/${targetPaymentId}`)
        .set({ Authorization: `Bearer ${otherToken}` })
        .expect(404);
    });
  });

  // ===========================================================================
  // Suite 4 — Over-allocation: 150 against a 100 invoice → 400
  // ===========================================================================
  describe('Over-allocation rejected', () => {
    let invoiceId = '';

    beforeAll(async () => {
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `PAY-OVER-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: 100,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });
      invoiceId = inv.id;
      customerInvoiceIds.push(invoiceId);
    });

    it('7. Allocating 150 against a 100-total invoice → 400 at submit', async () => {
      // The create endpoint validates allocSum <= totalAmount (payment level).
      // The 400 for over-allocating *an invoice* is enforced at submit time:
      // the service checks newPaid > inv.totalAmount inside the transaction.
      const createRes = await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({
          type: 'RECEIVE',
          partyType: 'CUSTOMER',
          partyId: customerId,
          modeOfPaymentId,
          date: new Date().toISOString(),
          totalAmount: 150,
          allocations: [{ targetType: 'CUSTOMER_INVOICE', targetId: invoiceId, amount: 150 }],
        })
        .expect(201);

      const overPaymentId = (createRes.body as { id: string }).id;
      paymentIds.push(overPaymentId);

      // Submit must reject because the invoice totalAmount is only 100.
      await request(http)
        .post(`/api/v1/billing/payments/${overPaymentId}/submit`)
        .set(auth())
        .expect(400);
    });
  });

  // ===========================================================================
  // Suite 5 — Currency mismatch: payment in USD allocating a CAD invoice → 400
  // (Finding 2: allocation-currency coherence guard added to submit)
  // ===========================================================================
  describe('Currency mismatch rejected', () => {
    let cadInvoiceId = '';

    beforeAll(async () => {
      // Create a CAD customer invoice.
      const inv = await prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: `PAY-CUR-${suffix}`,
          customerId,
          currency: 'CAD',
          totalAmount: 80,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });
      cadInvoiceId = inv.id;
      customerInvoiceIds.push(cadInvoiceId);
    });

    it('8. Submit a USD payment allocated to a CAD invoice → 400 (currency mismatch)', async () => {
      // Create a payment explicitly in USD.
      const createRes = await request(http)
        .post('/api/v1/billing/payments')
        .set(auth())
        .send({
          type: 'RECEIVE',
          partyType: 'CUSTOMER',
          partyId: customerId,
          modeOfPaymentId,
          date: new Date().toISOString(),
          currency: 'USD',
          totalAmount: 80,
          allocations: [{ targetType: 'CUSTOMER_INVOICE', targetId: cadInvoiceId, amount: 80 }],
        })
        .expect(201);

      const mismatchPaymentId = (createRes.body as { id: string }).id;
      paymentIds.push(mismatchPaymentId);

      // Submit must reject: payment is USD but invoice is CAD.
      await request(http)
        .post(`/api/v1/billing/payments/${mismatchPaymentId}/submit`)
        .set(auth())
        .expect(400);
    });
  });
});
