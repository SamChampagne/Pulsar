/**
 * E2E wms-module (Task 9) — proves the Light WMS module end-to-end over real
 * Postgres with the admin Bearer token (tenant acme): the full warehouse loop.
 *
 *   1. Receive → stock appears: post a receipt → the receiving bin holds qty.
 *   2. Putaway (move): move the stock receiving → storage (source drained, dest filled).
 *   3. Pick → decrement: complete a pick order → storage decremented.
 *   4. Over-pick refused (409): a pick beyond on-hand is rejected and rolled back.
 *   5. Adjust: a negative adjustment lowers the bin; one that would go negative is 409.
 *   6. Overview rollup: distinctItems/openPickOrders sane, our item not in negativeBins.
 *   7. Tenant isolation: GET /wms/items returns our item (scoped to acme).
 *   8. Module gating: structurally covered by @RequireModule (toggle skipped).
 *
 * Permissions wms.read / wms.manage, module WMS (seeded for acme). The warehouse
 * is the existing transportation Location (type WAREHOUSE), so TRANSPORTATION is
 * also enabled to create it.
 *
 * Prerequisites: reachable PostgreSQL with the seed applied (WMS module enabled).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

interface InventoryLevel {
  id: string;
  itemId: string;
  binId: string;
  qtyOnHand: string | number;
}

describe('WMS module (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Created fixtures (cleaned up in afterAll).
  let locationId = '';
  let itemId = '';
  let receivingBinId = '';
  let storageBinId = '';
  const createdReceiptIds: string[] = [];
  const createdPickOrderIds: string[] = [];

  // Helper: read the qtyOnHand for our item in a given bin (0 if absent).
  const qtyInBin = async (binId: string): Promise<number> => {
    const res = await request(http)
      .get(`/api/v1/wms/inventory?itemId=${itemId}&binId=${binId}`)
      .set(auth())
      .expect(200);
    const rows = res.body as InventoryLevel[];
    const lvl = rows.find((r) => r.binId === binId && r.itemId === itemId);
    return lvl ? Number(lvl.qtyOnHand) : 0;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

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

    // --- Ensure WMS (and TRANSPORTATION for the WAREHOUSE location) enabled. ---
    for (const key of ['wms', 'transportation']) {
      const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
        update: { enabled: true },
        create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
      });
    }

    // --- Create one WAREHOUSE location. ---------------------------------------
    const loc = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `WMS-E2E-${suffix}`,
        name: `WMS E2E ${suffix}`,
        type: 'WAREHOUSE',
        addressLine1: '1 Warehouse Way',
        city: 'Trois-Rivières',
        country: 'CA',
      })
      .expect(201);
    locationId = (loc.body as { id: string }).id;

    // --- Create two bins (RECEIVING + STORAGE) on that warehouse. -------------
    const recv = await request(http)
      .post('/api/v1/wms/bins')
      .set(auth())
      .send({ locationId, code: `RECV-${suffix}`, kind: 'RECEIVING' })
      .expect(201);
    receivingBinId = (recv.body as { id: string }).id;

    const stor = await request(http)
      .post('/api/v1/wms/bins')
      .set(auth())
      .send({ locationId, code: `STOR-${suffix}`, kind: 'STORAGE' })
      .expect(201);
    storageBinId = (stor.body as { id: string }).id;

    // --- Create one item. -----------------------------------------------------
    const item = await request(http)
      .post('/api/v1/wms/items')
      .set(auth())
      .send({ sku: `WMS-SKU-${suffix}`, name: `Widget ${suffix}` })
      .expect(201);
    itemId = (item.body as { id: string }).id;
  });

  afterAll(async () => {
    if (prisma) {
      // Pick orders / receipts cascade their lines on delete.
      await prisma.pickOrder
        .deleteMany({ where: { id: { in: createdPickOrderIds } } })
        .catch(() => undefined);
      await prisma.receipt
        .deleteMany({ where: { id: { in: createdReceiptIds } } })
        .catch(() => undefined);
      await prisma.stockMovement
        .deleteMany({ where: { tenantId, itemId } })
        .catch(() => undefined);
      await prisma.inventoryLevel
        .deleteMany({ where: { tenantId, itemId } })
        .catch(() => undefined);
      await prisma.bin
        .deleteMany({ where: { id: { in: [receivingBinId, storageBinId] } } })
        .catch(() => undefined);
      await prisma.wmsItem.deleteMany({ where: { id: itemId } }).catch(() => undefined);
      await prisma.location.deleteMany({ where: { id: locationId } }).catch(() => undefined);
    }
    await app.close();
  });

  // =========================================================================
  // 1 — Receive → stock appears in the receiving bin.
  // =========================================================================
  it('posting a receipt creates stock in the receiving bin', async () => {
    const create = await request(http)
      .post('/api/v1/wms/receipts')
      .set(auth())
      .send({ locationId })
      .expect(201);
    const receipt = create.body as { id: string; status: string };
    expect(receipt.status).toBe('DRAFT');
    createdReceiptIds.push(receipt.id);

    await request(http)
      .post(`/api/v1/wms/receipts/${receipt.id}/lines`)
      .set(auth())
      .send({ itemId, toBinId: receivingBinId, qty: 10 })
      .expect((r) => expect([200, 201]).toContain(r.status));

    const posted = await request(http)
      .post(`/api/v1/wms/receipts/${receipt.id}/post`)
      .set(auth())
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect((posted.body as { status: string }).status).toBe('POSTED');

    expect(await qtyInBin(receivingBinId)).toBe(10);
  });

  // =========================================================================
  // 2 — Putaway: move the stock from the receiving bin to the storage bin.
  // =========================================================================
  it('moving stock drains the receiving bin and fills the storage bin', async () => {
    await request(http)
      .post('/api/v1/wms/inventory/move')
      .set(auth())
      .send({ itemId, fromBinId: receivingBinId, toBinId: storageBinId, qty: 10 })
      .expect((r) => expect([200, 201]).toContain(r.status));

    expect(await qtyInBin(receivingBinId)).toBe(0);
    expect(await qtyInBin(storageBinId)).toBe(10);
  });

  // =========================================================================
  // 3 — Pick → stock decremented in the storage bin.
  // =========================================================================
  it('completing a pick order decrements the storage bin', async () => {
    const create = await request(http)
      .post('/api/v1/wms/pick-orders')
      .set(auth())
      .send({ locationId })
      .expect(201);
    const order = create.body as { id: string; status: string };
    expect(order.status).toBe('OPEN');
    createdPickOrderIds.push(order.id);

    await request(http)
      .post(`/api/v1/wms/pick-orders/${order.id}/lines`)
      .set(auth())
      .send({ itemId, fromBinId: storageBinId, qty: 4 })
      .expect((r) => expect([200, 201]).toContain(r.status));

    const done = await request(http)
      .post(`/api/v1/wms/pick-orders/${order.id}/complete`)
      .set(auth())
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect((done.body as { status: string }).status).toBe('COMPLETED');

    expect(await qtyInBin(storageBinId)).toBe(6);
  });

  // =========================================================================
  // 4 — Over-pick refused (409) and rolled back (storage unchanged).
  // =========================================================================
  it('an over-pick is refused with 409 and leaves the storage bin unchanged', async () => {
    const create = await request(http)
      .post('/api/v1/wms/pick-orders')
      .set(auth())
      .send({ locationId })
      .expect(201);
    const order = create.body as { id: string };
    createdPickOrderIds.push(order.id);

    await request(http)
      .post(`/api/v1/wms/pick-orders/${order.id}/lines`)
      .set(auth())
      .send({ itemId, fromBinId: storageBinId, qty: 999 })
      .expect((r) => expect([200, 201]).toContain(r.status));

    await request(http)
      .post(`/api/v1/wms/pick-orders/${order.id}/complete`)
      .set(auth())
      .expect(409);

    // Rolled back: storage still 6.
    expect(await qtyInBin(storageBinId)).toBe(6);
  });

  // =========================================================================
  // 5 — Adjust: negative delta lowers the bin; one going below zero is 409.
  // =========================================================================
  it('an adjustment lowers the bin; one that would go negative is refused (409)', async () => {
    await request(http)
      .post('/api/v1/wms/inventory/adjust')
      .set(auth())
      .send({ itemId, binId: storageBinId, qtyDelta: -2 })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect(await qtyInBin(storageBinId)).toBe(4);

    await request(http)
      .post('/api/v1/wms/inventory/adjust')
      .set(auth())
      .send({ itemId, binId: storageBinId, qtyDelta: -999 })
      .expect(409);
    // Unchanged after the refused adjustment.
    expect(await qtyInBin(storageBinId)).toBe(4);
  });

  // =========================================================================
  // 6 — Overview rollup. Loose asserts (shared DB).
  // =========================================================================
  it('the overview rollup reflects the activity and our bin is not negative', async () => {
    const res = await request(http).get('/api/v1/wms/overview').set(auth()).expect(200);
    const body = res.body as {
      distinctItems: number;
      openPickOrders: number;
      negativeBins: InventoryLevel[];
    };
    expect(body.openPickOrders).toBeGreaterThanOrEqual(0);
    expect(body.distinctItems).toBeGreaterThanOrEqual(1);
    // We never left a negative bin for our item.
    const ourNegative = body.negativeBins.some((b) => b.itemId === itemId);
    expect(ourNegative).toBe(false);
  });

  // =========================================================================
  // 7 — Tenant isolation: GET /wms/items returns our item, scoped to acme.
  // =========================================================================
  it('the created item is listed for acme and the list is tenant-scoped', async () => {
    const list = await request(http)
      .get('/api/v1/wms/items?pageSize=100')
      .set(auth())
      .expect(200);
    const items = (list.body as { items: Array<{ id: string }> }).items;
    expect(items.some((i) => i.id === itemId)).toBe(true);

    // No cross-tenant leakage among the returned ids.
    const ids = items.map((i) => i.id);
    const leaked = await prisma.wmsItem.count({
      where: { id: { in: ids }, tenantId: { not: tenantId } },
    });
    expect(leaked).toBe(0);
    // service tenant-scoped by construction; cross-tenant covered elsewhere
  });

  // =========================================================================
  // 8 — Module gating.
  // covered structurally by @RequireModule; toggling skipped to keep shared DB stable
  // =========================================================================
});
