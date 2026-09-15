/** Real HTTP + isolated, unique tenant in the test database. No external money movement. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';

describe('Connected finance flow (e2e)', () => {
  let app: INestApplication, prisma: PrismaService, http: any;
  let tenantId: string, otherTenantId: string, carrierId: string, modeId: string, accountId: string;
  let token: string, readToken: string;
  const suffix = `finance-flow-${Date.now()}`;
  let n = 0;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (path: string, body = {}) =>
    request(http).post(`/api/v1/${path}`).set(auth()).send(body);
  const get = (path: string) => request(http).get(`/api/v1/${path}`).set(auth());
  const flowPath = (id: string) => `freight-audit/incoming-invoices/${id}`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentRuntimeService)
      .useValue({ killAgentSessions: async () => {}, closeSession: async () => {} })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    tenantId = (await prisma.tenant.create({ data: { slug: suffix, name: suffix } })).id;
    otherTenantId = (
      await prisma.tenant.create({
        data: { slug: `${suffix}-other`, name: 'Other finance fixture' },
      })
    ).id;
    const billing = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'billing' } });
    await prisma.tenantModule.create({
      data: { tenantId, moduleId: billing.id, enabled: true, settings: { ledgerAutoPost: true } },
    });
    const permissions = await prisma.permission.findMany({ where: { module: 'billing' } });
    for (const limited of [false, true]) {
      const role = await prisma.role.create({
        data: {
          tenantId,
          key: limited ? 'audit-reader' : 'admin',
          name: 'Finance test',
          permissions: {
            create: permissions
              .filter((p) => !limited || p.key === 'billing.freight-audit.read')
              .map((p) => ({ permissionId: p.id })),
          },
        },
      });
      const email = `${limited ? 'reader' : 'admin'}@${suffix}.test`;
      await prisma.user.create({
        data: {
          tenantId,
          email,
          passwordHash: hashSync('Test1234!', 4),
          firstName: 'Finance',
          lastName: 'Test',
          status: 'ACTIVE',
          roles: { create: [{ roleId: role.id }] },
        },
      });
      const login = await request(http)
        .post('/api/v1/auth/login')
        .send({ tenant: suffix, email, password: 'Test1234!' })
        .expect(200);
      if (limited) readToken = login.body.accessToken;
      else token = login.body.accessToken;
    }
    carrierId = (
      await prisma.carrier.create({
        data: { tenantId, code: 'FINANCE', name: 'Transport du Fjord' },
      })
    ).id;
    modeId = (
      await prisma.modeOfPayment.create({
        data: { tenantId, name: 'Banque test', accountCode: '1010' },
      })
    ).id;
    accountId = (
      await post('billing/bank-accounts', {
        name: 'Banque CAD',
        currency: 'CAD',
        glAccountCode: '1010',
      }).expect(201)
    ).body.id;
  });
  afterAll(async () => {
    await app?.close();
  });

  async function documents(
    options: {
      status?: 'MATCHED' | 'FLAGGED' | 'RESOLVED';
      net?: number;
      charged?: number;
      resolution?: string;
      currency?: string;
      invoiceStatus?: 'APPROVED' | 'DRAFT';
      unmatched?: boolean;
    } = {},
  ) {
    const serial = ++n;
    const load = await prisma.load.create({
      data: {
        tenantId,
        carrierId,
        loadNumber: `LD-${serial}`,
        status: 'COMPLETED',
        estimatedCost: 128.65,
        costCurrency: 'CAD',
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        carrierId,
        invoiceNumber: `INV-${serial}`,
        status: options.invoiceStatus ?? 'APPROVED',
        currency: options.currency ?? 'CAD',
        totalAmount: (options.net ?? 128.65) + 6.43,
        taxAmount: 6.43,
        lines: {
          create: [{ loadId: load.id, description: 'Transport', amount: options.net ?? 128.65 }],
        },
      },
    });
    const audit = await prisma.incomingCarrierInvoice.create({
      data: {
        tenantId,
        carrierId,
        carrierInvoiceNumber: `AUD-${serial}`,
        status: options.status ?? 'MATCHED',
        currency: 'CAD',
        matchedTotal: 128.65,
        chargedTotal: options.charged ?? 128.65,
        resolution: options.resolution,
        lines: {
          create: [
            {
              lineRef: load.loadNumber,
              matchedLoadId: options.unmatched ? null : load.id,
              expectedAmount: 128.65,
              chargedAmount: options.charged ?? 128.65,
            },
          ],
        },
      },
    });
    return { invoice, audit, load };
  }
  async function payment(invoiceId: string, amount = 135.08, total = amount) {
    const p = (
      await post('billing/payments', {
        type: 'PAY',
        partyType: 'CARRIER',
        partyId: carrierId,
        modeOfPaymentId: modeId,
        currency: 'CAD',
        date: new Date().toISOString(),
        totalAmount: total,
        allocations: [{ targetType: 'CARRIER_INVOICE', targetId: invoiceId, amount }],
      }).expect(201)
    ).body;
    await post(`billing/payments/${p.id}/submit`).expect(201);
    return p;
  }
  async function transaction(amount: number, bankAccountId = accountId) {
    return (
      await post('billing/bank-transactions', {
        bankAccountId,
        date: '2026-09-14',
        description: `Virement test ${++n}`,
        amount,
      }).expect(201)
    ).body;
  }
  const match = (txnId: string, paymentId: string) =>
    post(`billing/bank-transactions/${txnId}/match`, { paymentId });

  it('connects audit → invoice → payment → bank, without auto-posting or changing audit status', async () => {
    const { invoice, audit, load } = await documents();
    const before = await prisma.journalEntry.count({ where: { tenantId } });
    const candidates = await get(`${flowPath(audit.id)}/accounting`).expect(200);
    expect(
      candidates.body.candidates.items.find((i: any) => i.id === invoice.id).reason,
    ).toBeNull();
    await post(`${flowPath(audit.id)}/link-invoice`, { invoiceId: invoice.id }).expect(201);
    await post(`${flowPath(audit.id)}/link-invoice`, { invoiceId: invoice.id }).expect(201);
    expect(await prisma.journalEntry.count({ where: { tenantId } })).toBe(before);
    expect(await prisma.payment.count({ where: { tenantId } })).toBe(0);
    expect(
      (await prisma.load.findUniqueOrThrow({ where: { id: load.id } })).estimatedCost?.toString(),
    ).toBe('128.65');
    expect((await get(`billing/invoices/${invoice.id}`).expect(200)).body.incomingAudit.id).toBe(
      audit.id,
    );
    const p = await payment(invoice.id),
      t = await transaction(-135.08);
    await match(t.id, p.id).expect(201);
    const journals = await prisma.journalEntry.count({ where: { tenantId } });
    await match(t.id, p.id).expect(201); // safe retry: no duplicate audit or journal
    expect(await prisma.journalEntry.count({ where: { tenantId } })).toBe(journals);
    const linked = (await get(`${flowPath(audit.id)}/accounting`).expect(200)).body;
    expect(linked.invoice.id).toBe(invoice.id);
    expect(linked.payments[0]).toMatchObject({
      id: p.id,
      status: 'SUBMITTED',
      bankTransaction: { id: t.id },
    });
    expect(
      (await get(`billing/bank-transactions?paymentId=${p.id}`).expect(200)).body.map(
        (r: any) => r.id,
      ),
    ).toEqual([t.id]);
    await post(`billing/payments/${p.id}/cancel`).expect(400);
    await post(`billing/bank-transactions/${t.id}/unmatch`).expect(201);
    expect(
      (await get(`${flowPath(audit.id)}/accounting`).expect(200)).body.payments[0].bankTransaction,
    ).toBeNull();
    await post(`billing/payments/${p.id}/cancel`).expect(201);
    expect(
      (await prisma.incomingCarrierInvoice.findUniqueOrThrow({ where: { id: audit.id } })).status,
    ).toBe('MATCHED');
  });
  it.each([
    { status: 'FLAGGED' as const },
    { net: 130 },
    { currency: 'USD' },
    { invoiceStatus: 'DRAFT' as const },
    { unmatched: true },
    { status: 'RESOLVED' as const, charged: 140, resolution: 'ACCEPT_CHARGED' },
  ])('rejects incompatible audit/invoice %j', async (options) => {
    const { invoice, audit } = await documents(options);
    await post(`${flowPath(audit.id)}/link-invoice`, { invoiceId: invoice.id }).expect(400);
    expect(
      (await prisma.incomingCarrierInvoice.findUniqueOrThrow({ where: { id: audit.id } }))
        .accountingInvoiceId,
    ).toBeNull();
  });
  it('uses accepted charged net when resolved, but never copies it to accounting', async () => {
    const { invoice, audit } = await documents({
      status: 'RESOLVED',
      charged: 140,
      net: 140,
      resolution: 'ACCEPT_CHARGED',
    });
    await post(`${flowPath(audit.id)}/link-invoice`, { invoiceId: invoice.id }).expect(201);
    expect(
      (
        await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
      ).totalAmount.toString(),
    ).toBe('146.43');
  });
  it('serializes competing audits for one invoice and forbids reassignment', async () => {
    const a = await documents(),
      b = await documents();
    await prisma.incomingInvoiceLine.updateMany({
      where: { invoiceId: b.audit.id },
      data: { matchedLoadId: a.load.id },
    });
    const results = await Promise.all(
      [a.audit, b.audit].map((r) =>
        post(`${flowPath(r.id)}/link-invoice`, { invoiceId: a.invoice.id }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = results[0].status === 201 ? a.audit : b.audit;
    await post(`${flowPath(winner.id)}/link-invoice`, { invoiceId: b.invoice.id }).expect(409);
  });
  it('enforces finance permissions and tenant isolation including the database FK', async () => {
    const { invoice, audit } = await documents();
    await request(http)
      .get(`/api/v1/${flowPath(audit.id)}/accounting`)
      .set({ Authorization: `Bearer ${readToken}` })
      .expect(403);
    await request(http)
      .post(`/api/v1/${flowPath(audit.id)}/link-invoice`)
      .set({ Authorization: `Bearer ${readToken}` })
      .send({ invoiceId: invoice.id })
      .expect(403);
    const carrier = await prisma.carrier.create({
      data: { tenantId: otherTenantId, code: 'OTHER', name: 'Other' },
    });
    const foreign = await prisma.invoice.create({
      data: {
        tenantId: otherTenantId,
        carrierId: carrier.id,
        invoiceNumber: 'OTHER',
        totalAmount: 128.65,
      },
    });
    await post(`${flowPath(audit.id)}/link-invoice`, { invoiceId: foreign.id }).expect(400);
    await expect(
      prisma.incomingCarrierInvoice.update({
        where: { id: audit.id },
        data: { accountingInvoiceId: foreign.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const foreignAudit = await prisma.incomingCarrierInvoice.create({
      data: {
        tenantId: otherTenantId,
        carrierId: carrier.id,
        carrierInvoiceNumber: 'OTHER',
        chargedTotal: 128.65,
      },
    });
    await get(`${flowPath(foreignAudit.id)}/accounting`).expect(404);
    await post(`${flowPath(foreignAudit.id)}/link-invoice`, { invoiceId: invoice.id }).expect(404);
  });
  it.each([-135.07, 135.08])(
    'rejects amount/direction mismatch %s without changing either record',
    async (amount) => {
      const { invoice } = await documents(),
        p = await payment(invoice.id),
        t = await transaction(amount);
      await match(t.id, p.id).expect(400);
      expect((await get(`billing/payments/${p.id}`).expect(200)).body.reconciledAt).toBeNull();
      expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: t.id } })).status).toBe(
        'UNRECONCILED',
      );
    },
  );
  it.each([
    { currency: 'USD', glAccountCode: '1010' },
    { currency: 'CAD', glAccountCode: '1000' },
  ])('rejects incompatible bank account %j', async (config) => {
    const bank = (
      await post('billing/bank-accounts', { name: `Wrong account ${++n}`, ...config }).expect(201)
    ).body;
    const { invoice } = await documents(),
      p = await payment(invoice.id),
      t = await transaction(-135.08, bank.id);
    await match(t.id, p.id).expect(400);
  });
  it('rejects a partially allocated payment and a missing actual bank leg', async () => {
    const a = await documents(),
      p = await payment(a.invoice.id, 135.08, 140),
      t = await transaction(-140);
    await match(t.id, p.id).expect(400);
    const b = await documents(),
      q = await payment(b.invoice.id),
      u = await transaction(-135.08);
    await prisma.journalEntry.deleteMany({
      where: { tenantId, sourceType: 'payment', sourceId: q.id },
    }); // legacy broken fixture only
    const result = await match(u.id, q.id).expect(400);
    expect(result.body.message).toContain('écriture bancaire');
  });
  it('only allows one of two concurrent movements to claim a payment', async () => {
    const { invoice } = await documents(),
      p = await payment(invoice.id);
    const a = await transaction(-135.08),
      b = await transaction(-135.08);
    const results = await Promise.all([match(a.id, p.id), match(b.id, p.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.bankTransaction.count({ where: { tenantId, matchedPaymentId: p.id } }),
    ).toBe(1);
  });
  it('refuses account deletion, currency and GL changes once movements exist', async () => {
    await request(http)
      .delete(`/api/v1/billing/bank-accounts/${accountId}`)
      .set(auth())
      .expect(400);
    for (const body of [{ currency: 'USD' }, { glAccountCode: '1000' }])
      await request(http)
        .patch(`/api/v1/billing/bank-accounts/${accountId}`)
        .set(auth())
        .send(body)
        .expect(400);
    await request(http)
      .patch(`/api/v1/billing/bank-accounts/${accountId}`)
      .set(auth())
      .send({ name: 'Banque renommée' })
      .expect(200);
  });

  describe('CSV preview and atomic import', () => {
    const csv = (description: string, amount = -71.23, reference = 'REF') =>
      `date,description,amount,reference\n2026-09-20,${description},${amount},${reference}`;
    const inspectCsv = (text: string, bankAccountId = accountId) =>
      post('billing/bank-transactions/import/preview', { bankAccountId, csv: text });
    const importCsv = (text: string, previewHash?: string, bankAccountId = accountId) =>
      post('billing/bank-transactions/import', {
        bankAccountId,
        csv: text,
        ...(previewHash ? { previewHash } : {}),
      });
    const count = () =>
      prisma.bankTransaction.count({ where: { tenantId, bankAccountId: accountId } });

    it('previews new, repeated and invalid rows without mutating anything', async () => {
      const text = csv('PREVIEW') + '\n2026-09-20,PREVIEW,-71.23,REF\n2026-02-30,INVALIDE,10,ERR';
      const before = await count(),
        audits = await prisma.auditLog.count({ where: { tenantId } });
      const response = await inspectCsv(text).expect(201);
      expect(response.body).toMatchObject({
        canImport: false,
        currency: 'CAD',
        totals: { newCount: 1, duplicateCount: 1, invalidCount: 1, credits: 0, debits: 71.23 },
      });
      expect(response.body.rows.map((r: any) => r.status)).toEqual(['NEW', 'DUPLICATE_FILE']);
      expect(response.body.issues[0].line).toBe(4);
      expect(await count()).toBe(before);
      expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(audits);
      await importCsv(text).expect(400);
      expect(await count()).toBe(before);
    });
    it('imports once, ignores a retry and audits only a safe summary', async () => {
      const text = csv('CSV-CONFIDENTIAL-DESCRIPTION'),
        before = await count();
      const preview = (await inspectCsv(text).expect(201)).body;
      const paymentsBefore = await prisma.payment.count({ where: { tenantId } });
      const journalsBefore = await prisma.journalEntry.count({ where: { tenantId } });
      expect((await importCsv(text, preview.previewHash).expect(201)).body).toEqual({
        imported: 1,
        skipped: 0,
        errors: [],
      });
      expect((await importCsv(text, preview.previewHash).expect(201)).body).toEqual({
        imported: 0,
        skipped: 1,
        errors: [],
      });
      expect(await count()).toBe(before + 1);
      expect(await prisma.payment.count({ where: { tenantId } })).toBe(paymentsBefore);
      expect(await prisma.journalEntry.count({ where: { tenantId } })).toBe(journalsBefore);
      const logs = await prisma.auditLog.findMany({
        where: { tenantId, entityType: 'bank-import', entityId: accountId },
      });
      expect(logs).toHaveLength(1);
      expect(JSON.stringify(logs)).not.toContain('CSV-CONFIDENTIAL-DESCRIPTION');
      expect(logs[0].after).toMatchObject({ imported: 1, skipped: 0, bankAccountId: accountId });
    });
    it('detects overlapping files, changed separators/whitespace and duplicates within a file', async () => {
      await importCsv(csv('CSV-OVERLAP')).expect(201);
      const text =
        '\uFEFFdate;description;amount;reference\r\n2026-09-20; CSV-OVERLAP ;-71,23;REF\r\n2026-09-21;Nouveau;14,37;N\r\n2026-09-21;Nouveau;14,37;N';
      const preview = (await inspectCsv(text).expect(201)).body;
      expect(preview.rows.map((r: any) => r.status)).toEqual([
        'DUPLICATE_EXISTING',
        'NEW',
        'DUPLICATE_FILE',
      ]);
      expect((await importCsv(text, preview.previewHash).expect(201)).body).toMatchObject({
        imported: 1,
        skipped: 2,
      });
    });
    it('detects pre-existing legacy/manual rows, even after reconciliation', async () => {
      const legacy = await prisma.bankTransaction.create({
        data: {
          tenantId,
          bankAccountId: accountId,
          date: new Date('2026-09-20T12:00:00Z'),
          description: 'CSV-LEGACY',
          amount: -71.23,
          reference: 'REF',
          status: 'RECONCILED',
        },
      });
      expect(legacy.importFingerprint).toBeNull();
      const response = (await inspectCsv(csv('CSV-LEGACY')).expect(201)).body;
      expect(response.rows[0].status).toBe('DUPLICATE_EXISTING');
      expect(response.canImport).toBe(false);
      expect((await importCsv(csv('CSV-LEGACY')).expect(201)).body.imported).toBe(0);
    });
    it('keeps different dates, signs and references as distinct movements', async () => {
      const text =
        csv('DISTINCT') +
        '\n2026-09-20,DISTINCT,-71.23,REF2\n2026-09-20,DISTINCT,71.23,REF\n2026-09-21,DISTINCT,-71.23,REF';
      expect((await importCsv(text).expect(201)).body).toMatchObject({ imported: 4, skipped: 0 });
    });
    it('serializes concurrent imports and revalidates duplicates after preview', async () => {
      const text = csv('CSV-RACE'),
        before = await count();
      const preview = (await inspectCsv(text).expect(201)).body;
      const results = await Promise.all([
        importCsv(text, preview.previewHash),
        importCsv(text, preview.previewHash),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results.map((r) => r.body.imported).sort()).toEqual([0, 1]);
      expect(await count()).toBe(before + 1);
    });
    it('rejects content, account and account-configuration changes after preview', async () => {
      const bank = (
        await post('billing/bank-accounts', {
          name: 'CSV-preview-account',
          currency: 'CAD',
        }).expect(201)
      ).body;
      const text = csv('CSV-HASH');
      const preview = (await inspectCsv(text, bank.id).expect(201)).body;
      await importCsv(csv('DIFFERENT'), preview.previewHash, bank.id).expect(409);
      await importCsv(text, preview.previewHash, accountId).expect(409);
      await request(http)
        .patch(`/api/v1/billing/bank-accounts/${bank.id}`)
        .set(auth())
        .send({ currency: 'USD' })
        .expect(200);
      await importCsv(text, preview.previewHash, bank.id).expect(409);
      expect(
        await prisma.bankTransaction.count({ where: { tenantId, bankAccountId: bank.id } }),
      ).toBe(0);
    });
    it('gates preview/import by permission and tenant, rejects caller-provided tenantId', async () => {
      const foreign = await prisma.bankAccount.create({
        data: {
          tenantId: otherTenantId,
          name: 'CSV-FOREIGN',
          currency: 'CAD',
          glAccountCode: '1010',
        },
      });
      for (const path of ['import', 'import/preview']) {
        await request(http)
          .post(`/api/v1/billing/bank-transactions/${path}`)
          .set({ Authorization: `Bearer ${readToken}` })
          .send({ bankAccountId: accountId, csv: csv('ACCESS') })
          .expect(403);
        await post(`billing/bank-transactions/${path}`, {
          bankAccountId: foreign.id,
          csv: csv('ACCESS'),
        }).expect(400);
        await post(`billing/bank-transactions/${path}`, {
          bankAccountId: accountId,
          csv: csv('ACCESS'),
          tenantId: otherTenantId,
        }).expect(400);
      }
    });
    it('isolates fingerprints per bank account and never hides same text in another account', async () => {
      const bank = (
        await post('billing/bank-accounts', { name: 'CSV-SECOND', currency: 'CAD' }).expect(201)
      ).body;
      const text = csv('CSV-ACCOUNT-SCOPED');
      expect((await importCsv(text).expect(201)).body.imported).toBe(1);
      expect((await importCsv(text, undefined, bank.id).expect(201)).body.imported).toBe(1);
    });
    it('rejects empty, huge, malformed and over-precise batches without a partial import', async () => {
      const before = await count();
      for (const text of [
        '',
        'x'.repeat(30_001),
        'date,description,amount\n2026-09-20,"oops,1',
        csv('PRECISION') + '\n2026-09-20,Erreur,0.001,R',
      ])
        await importCsv(text).expect(400);
      expect(await count()).toBe(before);
    });
    it('imports quoted fields and decimal comma without changing the signed amount', async () => {
      const text =
        'date;description;montant;référence\n2026-09-22;"Transport; du ""Fjord""";-135,08;FJ';
      await importCsv(text).expect(201);
      const row = await prisma.bankTransaction.findFirstOrThrow({
        where: {
          tenantId,
          bankAccountId: accountId,
          reference: 'FJ',
          description: 'Transport; du "Fjord"',
        },
      });
      expect(row.amount.toString()).toBe('-135.08');
      expect(row.status).toBe('UNRECONCILED');
      expect(row.date.toISOString()).toBe('2026-09-22T00:00:00.000Z');
      expect(row.importFingerprint).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
