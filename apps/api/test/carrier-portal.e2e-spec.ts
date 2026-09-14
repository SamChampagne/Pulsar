/**
 * E2E Carrier Portal — public capability-link view (projection contract).
 *
 * Focus: the public view must carry an `id` for every load and invoice (the web UI keys its
 * lists by them and targets POD/attachment uploads at /loads/:id/pod and
 * /invoices/:id/attachment). With multiple loads and invoices, the ids must be distinct
 * (regression for the `each_key_duplicate` crash) and tenantId/carrierId must never leak (rule 10).
 *
 * Prerequisites: reachable PostgreSQL with seed applied (admin@pulsar.dev / admin123, tenant acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const uniq = () => Math.random().toString(36).slice(2, 10);

describe('Carrier Portal public view (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let carrierId: string;
  let token: string;
  const loadIds: string[] = [];
  const invoiceIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Enable the carrier-portal module for acme.
    const mod = await prisma.moduleDefinition.findFirstOrThrow({ where: { key: 'carrier-portal' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });

    // A carrier with a portal token.
    token = randomBytes(24).toString('base64url');
    const carrier = await prisma.carrier.create({
      data: {
        tenantId,
        code: `CP-${uniq()}`,
        name: 'Portal Test Carrier',
        email: 'ops@portaltest.example',
        portalToken: token,
      },
    });
    carrierId = carrier.id;

    // Two loads and two incoming invoices assigned to this carrier.
    for (let i = 0; i < 2; i++) {
      const load = await prisma.load.create({
        data: { tenantId, carrierId, loadNumber: `LD-CP-${uniq()}`, status: 'DISPATCHED' },
      });
      loadIds.push(load.id);
      const inv = await prisma.incomingCarrierInvoice.create({
        data: {
          tenantId,
          carrierId,
          carrierInvoiceNumber: `INV-CP-${uniq()}`,
          currency: 'CAD',
          chargedTotal: 1000 + i,
        },
      });
      invoiceIds.push(inv.id);
    }
  });

  afterAll(async () => {
    // Clean up in FK-safe order.
    await prisma.incomingCarrierInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.load.deleteMany({ where: { id: { in: loadIds } } });
    if (carrierId) await prisma.carrier.delete({ where: { id: carrierId } }).catch(() => undefined);
    await app.close();
  });

  const srv = () => app.getHttpServer();

  it('exposes a distinct id for each load and each invoice', async () => {
    const res = await request(srv()).get(`/api/v1/public/carrier-portal/${token}`).expect(200);

    expect(res.body.loads.length).toBeGreaterThanOrEqual(2);
    expect(res.body.invoices.length).toBeGreaterThanOrEqual(2);

    // Every row carries an id (UI keys + upload targets).
    for (const l of res.body.loads) expect(typeof l.id).toBe('string');
    for (const inv of res.body.invoices) expect(typeof inv.id).toBe('string');

    // ids are distinct — this is the `each_key_duplicate` regression.
    const loadKeys = res.body.loads.map((l: { id: string }) => l.id);
    const invoiceKeys = res.body.invoices.map((i: { id: string }) => i.id);
    expect(new Set(loadKeys).size).toBe(loadKeys.length);
    expect(new Set(invoiceKeys).size).toBe(invoiceKeys.length);

    // The seeded ids are present.
    for (const id of loadIds) expect(loadKeys).toContain(id);
    for (const id of invoiceIds) expect(invoiceKeys).toContain(id);
  });

  it('never leaks tenantId or carrierId (rule 10)', async () => {
    const res = await request(srv()).get(`/api/v1/public/carrier-portal/${token}`).expect(200);
    const jsonStr = JSON.stringify(res.body);
    expect(jsonStr).not.toContain(tenantId);
    expect(jsonStr).not.toContain(carrierId);
    for (const l of res.body.loads) {
      expect(l).not.toHaveProperty('tenantId');
      expect(l).not.toHaveProperty('carrierId');
    }
    for (const inv of res.body.invoices) {
      expect(inv).not.toHaveProperty('tenantId');
      expect(inv).not.toHaveProperty('carrierId');
    }
  });
});
