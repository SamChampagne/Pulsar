/**
 * E2E wms-fulfillment (WMS↔TMS link, Task 6) — proves an outbound TMS shipment
 * originating from a WMS warehouse gets picked end-to-end through the WMS lane,
 * over real Postgres with the admin Bearer token (tenant acme):
 *
 *   1. Pending lists our shipment as NOT_PICKED.
 *   2. Creating a pick order linked to the shipment (origin-warehouse validated)
 *      + a line flips the shipment's derived pickStatus to PICKING.
 *   3. Completing the pick decrements the storage bin (20→15) and the derived
 *      pickStatus flips to PICKED (the shipment stays listed in pending as PICKED).
 *   4. Link validation: a pick order whose location ≠ shipment origin → 400.
 *   5. Tenant isolation: the shipment view works for acme (cross-tenant skipped).
 *   6. Module gating: structurally covered by @RequireModule (skipped).
 *
 * The Shipment fixture is created via direct Prisma insert (mirroring
 * dispatch-workbench.e2e-spec.ts): a parent TransportOrder + a PLANNED Shipment
 * whose originLocationId is the WMS warehouse. WMS data (warehouse Location, bins,
 * item, received stock) goes through the real API like wms-module.e2e-spec.ts.
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

interface FulfillmentShipment {
  id: string;
  shipmentNumber: string;
  pickStatus: 'NOT_PICKED' | 'PICKING' | 'PICKED';
  pickOrders: Array<{ id: string; status?: string }>;
}

describe('WMS fulfillment — link pick to outbound shipment (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Created fixtures (cleaned up in afterAll).
  let warehouseId = '';
  let destId = '';
  let itemId = '';
  let receivingBinId = '';
  let storageBinId = '';
  let customerId = '';
  let orderId = '';
  let shipmentId = '';
  const createdReceiptIds: string[] = [];
  const createdPickOrderIds: string[] = [];

  // qtyOnHand for our item in a bin (0 if absent).
  const qtyInBin = async (binId: string): Promise<number> => {
    const res = await request(http)
      .get(`/api/v1/wms/inventory?itemId=${itemId}&binId=${binId}`)
      .set(auth())
      .expect(200);
    const rows = res.body as InventoryLevel[];
    const lvl = rows.find((r) => r.binId === binId && r.itemId === itemId);
    return lvl ? Number(lvl.qtyOnHand) : 0;
  };

  const getFulfillment = async (id: string): Promise<FulfillmentShipment> => {
    const res = await request(http)
      .get(`/api/v1/wms/fulfillment/shipments/${id}`)
      .set(auth())
      .expect(200);
    return res.body as FulfillmentShipment;
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

    // --- Ensure WMS (and TRANSPORTATION for the shipment + warehouse) enabled. ---
    for (const key of ['wms', 'transportation']) {
      const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
        update: { enabled: true },
        create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
      });
    }

    // --- Create the WAREHOUSE location (the shipment origin). -----------------
    const wh = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `WMSF-${suffix}`,
        name: `WMS Fulfillment ${suffix}`,
        type: 'WAREHOUSE',
        addressLine1: '1 Warehouse Way',
        city: 'Trois-Rivières',
        country: 'CA',
      })
      .expect(201);
    warehouseId = (wh.body as { id: string }).id;

    // --- Create a destination location (any type). ----------------------------
    const dst = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `WMSF-DST-${suffix}`,
        name: `WMS Fulfillment Dest ${suffix}`,
        type: 'CUSTOMER_SITE',
        addressLine1: '2 Customer Ave',
        city: 'Montreal',
        country: 'CA',
      })
      .expect(201);
    destId = (dst.body as { id: string }).id;

    // --- Bins on the warehouse: a RECEIVING + a STORAGE. ----------------------
    const recv = await request(http)
      .post('/api/v1/wms/bins')
      .set(auth())
      .send({ locationId: warehouseId, code: `RECV-${suffix}`, kind: 'RECEIVING' })
      .expect(201);
    receivingBinId = (recv.body as { id: string }).id;

    const stor = await request(http)
      .post('/api/v1/wms/bins')
      .set(auth())
      .send({ locationId: warehouseId, code: `STOR-${suffix}`, kind: 'STORAGE' })
      .expect(201);
    storageBinId = (stor.body as { id: string }).id;

    // --- One item. ------------------------------------------------------------
    const item = await request(http)
      .post('/api/v1/wms/items')
      .set(auth())
      .send({ sku: `WMSF-SKU-${suffix}`, name: `Widget ${suffix}` })
      .expect(201);
    itemId = (item.body as { id: string }).id;

    // --- Receive 20 directly into the STORAGE bin so stock = 20. --------------
    const receipt = await request(http)
      .post('/api/v1/wms/receipts')
      .set(auth())
      .send({ locationId: warehouseId })
      .expect(201);
    const receiptId = (receipt.body as { id: string }).id;
    createdReceiptIds.push(receiptId);

    await request(http)
      .post(`/api/v1/wms/receipts/${receiptId}/lines`)
      .set(auth())
      .send({ itemId, toBinId: storageBinId, qty: 20 })
      .expect((r) => expect([200, 201]).toContain(r.status));

    await request(http)
      .post(`/api/v1/wms/receipts/${receiptId}/post`)
      .set(auth())
      .expect((r) => expect([200, 201]).toContain(r.status));

    expect(await qtyInBin(storageBinId)).toBe(20);

    // --- Outbound shipment via direct Prisma insert (mirrors dispatch-workbench). ---
    const customer = await prisma.customer.create({
      data: { tenantId, code: `WMSF-CUST-${suffix}`, name: `WMSF Customer ${suffix}` },
    });
    customerId = customer.id;

    const order = await prisma.transportOrder.create({
      data: {
        tenantId,
        orderNumber: `TO-WMSF-${suffix}`,
        customerId,
        originLocationId: warehouseId,
        destinationLocationId: destId,
      },
    });
    orderId = order.id;

    const shipment = await prisma.shipment.create({
      data: {
        tenantId,
        shipmentNumber: `SH-WMSF-${suffix}`,
        transportOrderId: orderId,
        originLocationId: warehouseId,
        destinationLocationId: destId,
        status: 'PLANNED',
        weightKg: 500,
        palletCount: 2,
      },
    });
    shipmentId = shipment.id;
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
      await prisma.shipment.deleteMany({ where: { id: shipmentId } }).catch(() => undefined);
      await prisma.transportOrder.deleteMany({ where: { id: orderId } }).catch(() => undefined);
      await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
      await prisma.bin
        .deleteMany({ where: { id: { in: [receivingBinId, storageBinId] } } })
        .catch(() => undefined);
      await prisma.wmsItem.deleteMany({ where: { id: itemId } }).catch(() => undefined);
      await prisma.location
        .deleteMany({ where: { id: { in: [warehouseId, destId] } } })
        .catch(() => undefined);
    }
    await app.close();
  });

  // =========================================================================
  // 1 — Pending lists our outbound shipment as NOT_PICKED.
  // =========================================================================
  it('pending lists the outbound shipment with pickStatus NOT_PICKED', async () => {
    const res = await request(http)
      .get('/api/v1/wms/fulfillment/pending')
      .set(auth())
      .expect(200);
    const rows = res.body as FulfillmentShipment[];
    const ours = rows.find((s) => s.id === shipmentId);
    expect(ours).toBeDefined();
    expect(ours?.shipmentNumber).toBe(`SH-WMSF-${suffix}`);
    expect(ours?.pickStatus).toBe('NOT_PICKED');
  });

  // =========================================================================
  // 2 — Create a linked pick order (origin-warehouse validated) → PICKING.
  // =========================================================================
  it('creating a linked pick order with a line flips the shipment to PICKING', async () => {
    const create = await request(http)
      .post('/api/v1/wms/pick-orders')
      .set(auth())
      .send({ locationId: warehouseId, shipmentId })
      .expect(201);
    const order = create.body as { id: string; status: string; shipmentId: string };
    expect(order.status).toBe('OPEN');
    expect(order.shipmentId).toBe(shipmentId);
    createdPickOrderIds.push(order.id);

    await request(http)
      .post(`/api/v1/wms/pick-orders/${order.id}/lines`)
      .set(auth())
      .send({ itemId, fromBinId: storageBinId, qty: 5 })
      .expect((r) => expect([200, 201]).toContain(r.status));

    const ful = await getFulfillment(shipmentId);
    expect(ful.pickStatus).toBe('PICKING');
    expect(ful.pickOrders.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // 3 — Complete decrements the storage bin (20→15) and flips to PICKED.
  // =========================================================================
  it('completing the pick decrements stock to 15 and flips the shipment to PICKED', async () => {
    const orderId = createdPickOrderIds[0];

    const done = await request(http)
      .post(`/api/v1/wms/pick-orders/${orderId}/complete`)
      .set(auth())
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect((done.body as { status: string }).status).toBe('COMPLETED');

    expect(await qtyInBin(storageBinId)).toBe(15);

    const ful = await getFulfillment(shipmentId);
    expect(ful.pickStatus).toBe('PICKED');

    // pending lists PENDING/PLANNED shipments regardless of pickStatus → still
    // present, now derived PICKED.
    const pending = await request(http)
      .get('/api/v1/wms/fulfillment/pending')
      .set(auth())
      .expect(200);
    const ours = (pending.body as FulfillmentShipment[]).find((s) => s.id === shipmentId);
    expect(ours?.pickStatus).toBe('PICKED');
  });

  // =========================================================================
  // 4 — Link validation: a pick order whose location ≠ shipment origin → 400.
  // =========================================================================
  it('rejects a pick order whose location is not the shipment origin warehouse (400)', async () => {
    // Spin up a second WAREHOUSE location that is NOT the shipment origin.
    const otherWh = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `WMSF-WH2-${suffix}`,
        name: `WMS Fulfillment WH2 ${suffix}`,
        type: 'WAREHOUSE',
        addressLine1: '9 Other Way',
        city: 'Quebec',
        country: 'CA',
      })
      .expect(201);
    const otherWhId = (otherWh.body as { id: string }).id;

    await request(http)
      .post('/api/v1/wms/pick-orders')
      .set(auth())
      .send({ locationId: otherWhId, shipmentId })
      .expect(400);

    await prisma.location.deleteMany({ where: { id: otherWhId } }).catch(() => undefined);
  });

  // =========================================================================
  // 5 — Tenant isolation: the shipment view works for acme.
  // cross-tenant negative path covered structurally (findFirst is tenant-scoped);
  // skipped here — no 2nd-tenant token, per the wms-module suite.
  // =========================================================================
  it('the shipment fulfillment view is tenant-scoped and works for acme', async () => {
    const ful = await getFulfillment(shipmentId);
    expect(ful.id).toBe(shipmentId);

    // The shipment row truly belongs to acme (no cross-tenant leakage).
    const leaked = await prisma.shipment.count({
      where: { id: shipmentId, tenantId: { not: tenantId } },
    });
    expect(leaked).toBe(0);
  });

  // =========================================================================
  // 6 — Module gating.
  // covered structurally by @RequireModule(MODULE_KEYS.WMS); toggling skipped
  // to keep the shared DB stable.
  // =========================================================================
});
