/**
 * E2E EDI X12 (task C4) — inbound 204/210, outbound 990/214.
 *
 *   S1  204 intake     a raw interchange posted as text/plain creates a DRAFT
 *                      transport order and comes back with an ACCEPTING 990.
 *   S2  204 decline    a broken tender (no B2-04 shipment id) answers a 990 "D"
 *                      and leaves the inbox row FAILED — nothing is created.
 *   S3  214 outbound   GET .../edi/214 returns raw X12 whose last AT7 matches
 *                      `at7ForShipmentStatus(shipment.status)`.
 *   S4  210 intake     a carrier invoice interchange creates an
 *                      IncomingCarrierInvoice with the right lines and total.
 *   S5  public door    the same 204 through POST /public/hooks/:token (receiver
 *                      with config.format = "x12") journals source = EDI.
 *   S6  guards         a non-`edi-` integrationKey is refused; a config pointing
 *                      at another tenant's customer is refused at save time.
 *   S7  privilege      a user holding only core.integrations.manage cannot stand
 *                      up an EDI door writing orders / carrier invoices (403 on
 *                      create, on PATCH adding carrierId, and on token issue).
 *   S8  HMAC           a signed x12 receiver refuses a bad signature (401) and
 *                      accepts the right one over the RAW text/plain bytes.
 *   S9  duplicate      the same carrier invoice number in a new envelope is
 *                      refused (business-key dedup on top of the byte hash).
 *
 * Fully offline: the fixtures are the ones C3 ships in @pulsar/shared.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { at7ForShipmentStatus, parseX12, read214, read990 } from '@pulsar/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const FIXTURES = join(__dirname, '../../../packages/shared/src/edi/__fixtures__');

/** Fixtures are read from disk HERE only — the shared package stays browser-safe. */
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf-8');

/** First transaction of an interchange, asserting it parses cleanly. */
function firstTransaction(x12: string) {
  const parsed = parseX12(x12);
  expect(parsed.ok).toBe(true);
  expect(parsed.document).not.toBeNull();
  return parsed.document!.transactions[0];
}

describe('EDI X12 (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';

  const suffix = `${Date.now()}`.slice(-9);
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const integrationKey = `edi-e2e-${suffix}`;
  const tenderRef = `SHP-E2E-${suffix}`;
  const invoiceRef = `INV-E2E-${suffix}`;

  let customerId = '';
  let carrierId = '';
  let integrationId = '';
  let orderId = '';
  let shipmentId = '';

  const limitedRoleKey = `edi-limited-${suffix}`.slice(0, 40);
  const limitedEmail = `edi-limited-${suffix}@acme.test`;
  const LIMITED_PASSWORD = 'EdiLimited123!';
  const HMAC_SECRET = 'edi-e2e-hmac-secret';
  let limitedRoleId = '';
  let limitedUserId = '';

  /** The C3 fixture with tenant-unique references (so reruns stay idempotent-safe). */
  const tender204 = () => fixture('204-multistop.edi').replace('SHP-2026-0042', tenderRef);
  const invoice210 = () => fixture('210-invoice.edi').replace('INV-77410', invoiceRef);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // rawBody mirrors main.ts (the public receiver verifies the HMAC over raw bytes).
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `EDI-CUST-${suffix}`, name: 'EDI Shipper' })
      .expect(201);
    customerId = customer.body.id;

    const carrier = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: `EDI-CARR-${suffix}`, name: 'EDI Carrier', scacCode: 'CRXY' })
      .expect(201);
    carrierId = carrier.body.id;

    const integration = await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: integrationKey,
        name: 'Partenaire EDI e2e',
        status: 'ENABLED',
        config: {
          isaSenderId: 'PULSARTMS',
          isaReceiverId: 'ACMESHIPPER',
          customerId,
          carrierId,
          format: 'x12',
        },
      })
      .expect(201);
    integrationId = integration.body.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (limitedUserId) {
        await prisma.userRole
          .deleteMany({ where: { userId: limitedUserId } })
          .catch(() => undefined);
        await prisma.user.delete({ where: { id: limitedUserId } }).catch(() => undefined);
      }
      if (limitedRoleId) {
        await prisma.rolePermission
          .deleteMany({ where: { roleId: limitedRoleId } })
          .catch(() => undefined);
        await prisma.role.delete({ where: { id: limitedRoleId } }).catch(() => undefined);
      }
    }
    if (app) await app.close();
  }, 60_000);

  // S1 ------------------------------------------------------------------------
  it('204: a raw interchange creates a DRAFT transport order and returns an accepting 990', async () => {
    const response = await request(http)
      .post('/api/v1/connect/edi/inbound')
      .set(auth())
      .set('X-Integration-Key', integrationKey)
      .set('Content-Type', 'text/plain')
      .send(tender204())
      .expect(202);

    expect(response.body.status).toBe('IMPORTED');
    expect(response.body.transactionSetId).toBe('204');
    expect(response.body.entityType).toBe('transport-order');
    orderId = response.body.entityId;

    const ack = read990(firstTransaction(response.body.ack as string));
    expect(ack.accepted).toBe(true);
    expect(ack.shipmentId).toBe(tenderRef);

    // The order really exists in the TMS, as a DRAFT of the configured customer.
    const order = await request(http)
      .get(`/api/v1/transportation/transport-orders/${orderId}`)
      .set(auth())
      .expect(200);
    expect(order.body.status).toBe('DRAFT');
    expect(order.body.customer.id).toBe(customerId);
    expect(order.body.customerReference).toBe(tenderRef);
    // 24 000 lb of pickups converted to kilograms.
    expect(order.body.totalWeightKg).toBeCloseTo(10886.22, 2);
    // The 990 references the order we created.
    expect(ack.references.map((r) => r.value)).toContain(order.body.orderNumber);

    // Addresses became EDI- locations (rule 50: created through core/locations).
    expect(order.body.originLocation.code).toMatch(/^EDI-[0-9a-f]{12}$/);
    expect(order.body.destinationLocation.code).toMatch(/^EDI-[0-9a-f]{12}$/);

    const inbox = await prisma.inboundMessage.findUnique({
      where: { id: response.body.inboxId },
    });
    expect(inbox?.source).toBe('EDI');
    expect(inbox?.status).toBe('IMPORTED');
    expect(inbox?.refId).toBe(orderId);
  });

  it('204: the same interchange twice is idempotent', async () => {
    const before = await prisma.transportOrder.count({
      where: { customerReference: tenderRef },
    });
    const replay = await request(http)
      .post('/api/v1/connect/edi/inbound')
      .set(auth())
      .set('X-Integration-Key', integrationKey)
      .set('Content-Type', 'text/plain')
      .send(tender204())
      .expect(202);
    expect(replay.body.replayed).toBe(true);
    const after = await prisma.transportOrder.count({
      where: { customerReference: tenderRef },
    });
    expect(after).toBe(before);
  });

  // S2 ------------------------------------------------------------------------
  it('204: a tender without a shipment id is declined with a 990 "D" and FAILED', async () => {
    // Same segment count (so the interchange itself stays structurally valid),
    // but B2-04 is now empty — there is nothing to tender. The interchange
    // control number carries the per-run uniqueness the tender ref no longer can
    // (the dedup key is the hash of these very bytes).
    const broken = tender204()
      .replace(/000000101/g, suffix)
      .replace(`B2**CRXY**${tenderRef}**PP`, 'B2**CRXY****PP');
    expect(broken).toContain('B2**CRXY****PP');

    const response = await request(http)
      .post('/api/v1/connect/edi/inbound')
      .set(auth())
      .send({ integrationKey, content: broken })
      .expect(202);

    expect(response.body.status).toBe('FAILED');
    expect(response.body.entityId).toBeUndefined();
    expect(String(response.body.error)).toContain('B2-04');

    const ack = read990(firstTransaction(response.body.ack as string));
    expect(ack.declined).toBe(true);
    expect(ack.action).toBe('D');
    expect(ack.reason).toContain('B2-04');

    const inbox = await prisma.inboundMessage.findUnique({
      where: { id: response.body.inboxId },
    });
    expect(inbox?.source).toBe('EDI');
    expect(inbox?.status).toBe('FAILED');
  });

  // S3 ------------------------------------------------------------------------
  it('214: the outbound status message matches the shipment status', async () => {
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${orderId}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${orderId}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    shipmentId = planned.body.shipments[0].id;

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
      .send({ carrierId })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/dispatch`)
      .set(auth())
      .expect(201);

    const shipment = await request(http)
      .get(`/api/v1/transportation/shipments/${shipmentId}`)
      .set(auth())
      .expect(200);
    const expectedCode = at7ForShipmentStatus(shipment.body.status);
    expect(expectedCode).toBeDefined();

    const response = await request(http)
      .get(`/api/v1/transportation/shipments/${shipmentId}/edi/214`)
      .query({ integrationKey })
      .set(auth())
      .expect(200);
    expect(response.headers['content-type']).toContain('text/plain');

    const status = read214(firstTransaction(response.text));
    expect(status.shipmentId).toBe(shipment.body.shipmentNumber);
    expect(status.scac).toBe('CRXY');
    expect(status.events.length).toBeGreaterThan(0);
    expect(status.events.at(-1)!.code).toBe(expectedCode);
  });

  // S4 ------------------------------------------------------------------------
  it('210: a carrier invoice interchange creates an incoming carrier invoice', async () => {
    const response = await request(http)
      .post('/api/v1/connect/edi/inbound')
      .set(auth())
      .send({ integrationKey, content: invoice210() })
      .expect(202);

    expect(response.body.status).toBe('IMPORTED');
    expect(response.body.transactionSetId).toBe('210');
    expect(response.body.entityType).toBe('incoming-carrier-invoice');
    // A 210 is not answered with a 990.
    expect(response.body.ack).toBeUndefined();

    const invoice = await request(http)
      .get(`/api/v1/freight-audit/incoming-invoices/${response.body.entityId}`)
      .set(auth())
      .expect(200);
    expect(invoice.body.carrierInvoiceNumber).toBe(invoiceRef);
    expect(invoice.body.carrier.id).toBe(carrierId);
    expect(invoice.body.currency).toBe('CAD');
    expect(Number(invoice.body.chargedTotal)).toBeCloseTo(2685.5, 2);
    expect(invoice.body.lines).toHaveLength(3);
    expect(
      invoice.body.lines.map((l: { chargedAmount: unknown }) => Number(l.chargedAmount)),
    ).toEqual([2250, 337.5, 98]);
  });

  // S5 ------------------------------------------------------------------------
  it('public receiver: an x12 receiver routes the interchange to the EDI plane', async () => {
    const created = await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: `edi-public-${suffix}`,
        name: 'Partenaire EDI public',
        status: 'ENABLED',
        config: {
          isaSenderId: 'PULSARTMS',
          isaReceiverId: 'ACMESHIPPER',
          customerId,
          format: 'x12',
        },
      })
      .expect(201);
    const issued = await request(http)
      .post(`/api/v1/integrations/${created.body.id}/inbound-token`)
      .set(auth())
      .expect(201);

    const publicRef = `SHP-PUB-${suffix}`;
    const response = await request(http)
      .post(`/api/v1/public/hooks/${issued.body.token}`)
      .set('Content-Type', 'text/plain')
      .send(fixture('204-minimal.edi').replace('SHP-2026-0043', publicRef))
      .expect(202);

    expect(response.body.status).toBe('IMPORTED');
    expect(read990(firstTransaction(response.body.ack as string)).accepted).toBe(true);

    const inbox = await prisma.inboundMessage.findUnique({
      where: { id: response.body.inboxId },
    });
    expect(inbox?.source).toBe('EDI');
    expect(inbox?.kind).toBe('edi');
    // Rule 13: the write is attributed to the tenant's hidden service account.
    const writer = await prisma.user.findUnique({ where: { id: inbox!.createdById! } });
    expect(writer?.email).toBe('service-account@pulsar.local');
    expect(writer?.status).toBe('DISABLED');
  });

  // S6 ------------------------------------------------------------------------
  it('guards: only edi- integrations, and configured FKs must belong to the tenant', async () => {
    await request(http)
      .post('/api/v1/connect/edi/inbound')
      .set(auth())
      .send({ integrationKey: 'webhook-main', content: tender204() })
      .expect(400);

    await request(http)
      .post('/api/v1/connect/edi/inbound')
      .set(auth())
      .send({ integrationKey: `edi-unknown-${suffix}`, content: tender204() })
      .expect(404);

    // Rule 9: an unknown/foreign customerId is refused at configuration time.
    await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: `edi-bad-${suffix}`,
        name: 'Mauvaise config',
        config: { customerId: 'cus_from_another_tenant' },
      })
      .expect(400);

    // ISA ids are bounded to the 15 characters X12 accepts.
    await request(http)
      .patch(`/api/v1/integrations/${integrationId}`)
      .set(auth())
      .send({ config: { isaSenderId: 'A'.repeat(16) } })
      .expect(400);
  });
  // S7 ------------------------------------------------------------------------
  it('privilege gate: core.integrations.manage alone cannot stand up an EDI door', async () => {
    const role = await request(http)
      .post('/api/v1/roles')
      .set(auth())
      .send({
        key: limitedRoleKey,
        name: `EDI limited ${suffix}`,
        permissionKeys: ['core.integrations.read', 'core.integrations.manage'],
      })
      .expect(201);
    limitedRoleId = role.body.id;

    const created = await request(http)
      .post('/api/v1/users')
      .set(auth())
      .send({
        email: limitedEmail,
        firstName: 'EDI',
        lastName: 'Limited',
        roleIds: [limitedRoleId],
      })
      .expect(201);
    limitedUserId = created.body.id;
    const inviteToken = (created.body.inviteUrl as string).split('/reset-password/')[1];
    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteToken, password: LIMITED_PASSWORD })
      .expect(200);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: limitedEmail, password: LIMITED_PASSWORD, tenant: 'acme' })
      .expect(200);
    const limitedAuth = () => ({ Authorization: `Bearer ${login.body.accessToken}` });

    // Cannot CREATE an EDI receiver that would write transport orders...
    await request(http)
      .post('/api/v1/integrations')
      .set(limitedAuth())
      .send({
        key: `edi-denied-${suffix}`,
        name: 'Porte refusee',
        status: 'ENABLED',
        config: { customerId, format: 'x12' },
      })
      .expect(403);

    // A receiver with NO business FK is fine — nothing is granted yet...
    const inert = await request(http)
      .post('/api/v1/integrations')
      .set(limitedAuth())
      .send({ key: `edi-inert-${suffix}`, name: 'Porte inerte', config: { format: 'x12' } })
      .expect(201);

    // ...but arming it with a carrierId later is the same privilege grant.
    await request(http)
      .patch(`/api/v1/integrations/${inert.body.id}`)
      .set(limitedAuth())
      .send({ config: { carrierId } })
      .expect(403);

    // ...and they cannot hand out a token for an already-armed door either.
    await request(http)
      .post(`/api/v1/integrations/${integrationId}/inbound-token`)
      .set(limitedAuth())
      .expect(403);

    // The admin, who holds both permissions, can do the same PATCH.
    await request(http)
      .patch(`/api/v1/integrations/${inert.body.id}`)
      .set(auth())
      .send({ config: { carrierId } })
      .expect(200);
  });

  // S8 ------------------------------------------------------------------------
  it('HMAC: a signed x12 receiver checks the signature over the raw text bytes', async () => {
    const created = await request(http)
      .post('/api/v1/integrations')
      .set(auth())
      .send({
        key: `edi-signed-${suffix}`,
        name: 'Partenaire EDI signe',
        status: 'ENABLED',
        config: {
          isaSenderId: 'PULSARTMS',
          customerId,
          format: 'x12',
          inboundSecret: HMAC_SECRET,
        },
      })
      .expect(201);
    const issued = await request(http)
      .post(`/api/v1/integrations/${created.body.id}/inbound-token`)
      .set(auth())
      .expect(201);

    const body = fixture('204-minimal.edi').replace('SHP-2026-0043', `SHP-SIG-${suffix}`);

    await request(http)
      .post(`/api/v1/public/hooks/${issued.body.token}`)
      .set('Content-Type', 'text/plain')
      .set('X-Signature', 'sha256=deadbeef')
      .send(body)
      .expect(401);

    const signature = createHmac('sha256', HMAC_SECRET)
      .update(Buffer.from(body, 'utf-8'))
      .digest('hex');
    const ok = await request(http)
      .post(`/api/v1/public/hooks/${issued.body.token}`)
      .set('Content-Type', 'text/plain')
      .set('X-Signature', `sha256=${signature}`)
      .send(body)
      .expect(202);
    expect(ok.body.status).toBe('IMPORTED');
    expect(read990(firstTransaction(ok.body.ack as string)).accepted).toBe(true);

    // A replay answers with the STORED 990 (and never an internal detail).
    const replay = await request(http)
      .post(`/api/v1/public/hooks/${issued.body.token}`)
      .set('Content-Type', 'text/plain')
      .set('X-Signature', `sha256=${signature}`)
      .send(body)
      .expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.ack).toBe(ok.body.ack);
  });

  // S9 ------------------------------------------------------------------------
  it('210: the same carrier invoice number in a new envelope is a duplicate', async () => {
    // New ISA control number → new dedup key, but the business key already exists.
    const resent = invoice210().replace(/000000205/g, '000000206');
    const response = await request(http)
      .post('/api/v1/connect/edi/inbound')
      .set(auth())
      .send({ integrationKey, content: resent })
      .expect(202);
    expect(response.body.status).toBe('FAILED');
    expect(response.body.error).toBe(`Duplicate carrier invoice ${invoiceRef}`);
  });
});
