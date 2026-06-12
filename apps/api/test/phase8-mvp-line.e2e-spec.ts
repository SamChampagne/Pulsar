/**
 * E2E for phase 8 — mode-filtered rating, BOL lifecycle (incl. driver token),
 * delay detection dedup, and notification read.
 *
 * Prerequisites: reachable PostgreSQL with the seed applied
 * (admin@pulsar.dev / admin123, tenant: acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DelayDetectionService } from '../src/modules/transportation/exceptions/delay-detection.service';

describe('Phase 8 — mode-filtered rating, BOL lifecycle, delay detection (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P8${Date.now().toString(36).toUpperCase()}`;

  const ids = {
    customer: '',
    origin: '',
    destination: '',
    carrier: '',
    // Carrier rates
    ltlRate: '',
    noModeRate: '',
    // For BOL / delay tests
    bolLoadId: '',
    bolLoadNumber: '',
    // For delay detection tests
    delayLoad1Id: '',
    delayLoad1Number: '',
    delayStop1Id: '',
    delayLoad2Id: '',
    delayLoad2Number: '',
    delayStop2Id: '',
  };

  const auth = () => ({ Authorization: `Bearer ${token}` });

  // ---------------------------------------------------------------------------
  // Helper: create transport order → confirm → plan → return { orderId, shipmentId }
  // ---------------------------------------------------------------------------
  async function createAndPlan(
    mode?: string,
  ): Promise<{ orderId: string; shipmentId: string }> {
    const body: Record<string, unknown> = {
      customerId: ids.customer,
      originLocationId: ids.origin,
      destinationLocationId: ids.destination,
    };
    if (mode) body.mode = mode;

    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send(body)
      .expect(201);
    const orderId = order.body.id;

    await request(http)
      .post(`/api/v1/transportation/transport-orders/${orderId}/confirm`)
      .set(auth())
      .expect(201);

    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${orderId}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    const shipmentId = planned.body.shipments[0].id;

    return { orderId, shipmentId };
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    // Authenticate
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;

    // Customer (no email needed for these tests)
    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'P8 Customer' })
      .expect(201);
    ids.customer = customer.body.id;

    // Two locations (city / state / country)
    const origin = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-ORI`,
        name: 'P8 Origin',
        type: 'WAREHOUSE',
        addressLine1: '1 P8 St',
        city: `CityP8A-${suffix}`,
        state: 'QC',
        country: 'CA',
      })
      .expect(201);
    ids.origin = origin.body.id;

    const destination = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-DST`,
        name: 'P8 Destination',
        type: 'WAREHOUSE',
        addressLine1: '2 P8 St',
        city: `CityP8B-${suffix}`,
        state: 'QC',
        country: 'CA',
      })
      .expect(201);
    ids.destination = destination.body.id;

    // Carrier
    const carrier = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: `${suffix}-CARR`, name: 'P8 Carrier' })
      .expect(201);
    ids.carrier = carrier.body.id;

    // Carrier rate — mode: LTL, FLAT 300 ACTIVE (catch-all, no lane)
    const ltlRate = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} LTL flat`,
        rateType: 'FLAT',
        baseAmount: 300,
        currency: 'CAD',
        carrierId: ids.carrier,
        mode: 'LTL',
      })
      .expect(201);
    ids.ltlRate = ltlRate.body.id;
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.ltlRate}`)
      .set(auth())
      .send({ status: 'ACTIVE' })
      .expect(200);

    // Carrier rate — no mode, FLAT 500 ACTIVE (catch-all, no lane)
    const noModeRate = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} no-mode flat`,
        rateType: 'FLAT',
        baseAmount: 500,
        currency: 'CAD',
        carrierId: ids.carrier,
      })
      .expect(201);
    ids.noModeRate = noModeRate.body.id;
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.noModeRate}`)
      .set(auth())
      .send({ status: 'ACTIVE' })
      .expect(200);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Test 1 — Mode filters rating (buy-side)
  // ---------------------------------------------------------------------------
  it('mode filters rate-options: FTL load excludes LTL-only rate; LTL load shows both', async () => {
    // --- FTL path ---
    // Default mode is FTL; order created without explicit mode → load inherits FTL
    const { shipmentId: ftlShipId } = await createAndPlan(); // default = FTL

    const ftlLoad = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    const ftlLoadId = ftlLoad.body.id;

    // Assign the FTL shipment → first assign → load inherits FTL mode
    await request(http)
      .post(`/api/v1/transportation/shipments/${ftlShipId}/assign-load`)
      .set(auth())
      .send({ loadId: ftlLoadId })
      .expect(201);

    // Assign carrier so rate-options can evaluate
    await request(http)
      .post(`/api/v1/transportation/loads/${ftlLoadId}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);

    const ftlOptions = await request(http)
      .get(`/api/v1/transportation/loads/${ftlLoadId}/rate-options`)
      .set(auth())
      .expect(200);

    const ftlRateIds = ftlOptions.body.options.map((o: { rateId: string }) => o.rateId);
    // FTL load: mode=FTL → LTL-specific rate must NOT appear
    expect(ftlRateIds).not.toContain(ids.ltlRate);
    // no-mode rate matches any mode → must appear
    expect(ftlRateIds).toContain(ids.noModeRate);

    // --- LTL path ---
    const { shipmentId: ltlShipId } = await createAndPlan('LTL');

    const ltlLoad = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    const ltlLoadId = ltlLoad.body.id;

    // First assign → load inherits LTL from the order
    const ltlAssignRes = await request(http)
      .post(`/api/v1/transportation/shipments/${ltlShipId}/assign-load`)
      .set(auth())
      .send({ loadId: ltlLoadId })
      .expect(201);

    // No modeWarning on first assign (matching modes or first shipment)
    expect(ltlAssignRes.body.modeWarning).toBeUndefined();

    // Verify load.mode inherited as LTL
    const ltlLoadState = await request(http)
      .get(`/api/v1/transportation/loads/${ltlLoadId}`)
      .set(auth())
      .expect(200);
    expect(ltlLoadState.body.mode).toBe('LTL');

    await request(http)
      .post(`/api/v1/transportation/loads/${ltlLoadId}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);

    const ltlOptions = await request(http)
      .get(`/api/v1/transportation/loads/${ltlLoadId}/rate-options`)
      .set(auth())
      .expect(200);

    const ltlRateIds = ltlOptions.body.options.map((o: { rateId: string }) => o.rateId);
    // LTL load → both the LTL-specific rate AND the no-mode rate must appear
    expect(ltlRateIds).toContain(ids.ltlRate);
    expect(ltlRateIds).toContain(ids.noModeRate);

    // Save ltlLoadId for test 2
    (ids as Record<string, string>).ltlLoadId = ltlLoadId;
    (ids as Record<string, string>).ltlShipId2 = ltlShipId; // already assigned
  });

  // ---------------------------------------------------------------------------
  // Test 2 — mode-mismatch warning on second assign
  // ---------------------------------------------------------------------------
  it('modeWarning returned when adding an FTL shipment to an LTL load', async () => {
    const ltlLoadId = (ids as Record<string, string>).ltlLoadId;

    // Create an FTL order (default mode = FTL) and get its shipment
    const { shipmentId: ftlShipId2 } = await createAndPlan(); // FTL

    const assignRes = await request(http)
      .post(`/api/v1/transportation/shipments/${ftlShipId2}/assign-load`)
      .set(auth())
      .send({ loadId: ltlLoadId })
      .expect(201);

    // Non-blocking: shipment should be PLANNED
    expect(assignRes.body.status).toBe('PLANNED');
    // modeWarning must be present with the correct structure
    expect(assignRes.body.modeWarning).toBeDefined();
    expect(assignRes.body.modeWarning.loadMode).toBe('LTL');
    expect(assignRes.body.modeWarning.orderMode).toBe('FTL');
  });

  // ---------------------------------------------------------------------------
  // Test 3 — BOL lifecycle
  // ---------------------------------------------------------------------------
  it('BOL lifecycle: 400 on PLANNED, 201 after dispatch, download, driver token, revoke, regenerate', async () => {
    // Build a fresh load for this test
    const { shipmentId } = await createAndPlan();

    const loadRes = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    const loadId = loadRes.body.id;
    ids.bolLoadId = loadId;

    await request(http)
      .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
      .set(auth())
      .send({ loadId })
      .expect(201);

    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);

    // --- 3a: BOL on PLANNED load → 400 ---
    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/bol`)
      .set(auth())
      .expect(400);

    // --- Dispatch the load ---
    await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/dispatch`)
      .set(auth())
      .expect(201);

    // --- 3b: BOL on DISPATCHED load → 201 ---
    const bol1 = await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/bol`)
      .set(auth())
      .expect(201);

    const docId1 = bol1.body.id;
    const fileName1: string = bol1.body.fileName;
    expect(docId1).toBeTruthy();
    // fileName must match BOL-XXXXXX.pdf
    expect(fileName1).toMatch(/^BOL-\d{6}\.pdf$/);

    // Remember the load number for later notification assertions
    const loadMeta = await request(http)
      .get(`/api/v1/transportation/loads/${loadId}`)
      .set(auth())
      .expect(200);
    ids.bolLoadNumber = loadMeta.body.loadNumber;

    // --- 3c: GET :id/documents → 1 entry ---
    const docs1 = await request(http)
      .get(`/api/v1/transportation/loads/${loadId}/documents`)
      .set(auth())
      .expect(200);
    expect(Array.isArray(docs1.body)).toBe(true);
    expect(docs1.body).toHaveLength(1);
    expect(docs1.body[0].id).toBe(docId1);

    // --- 3d: internal download → 200 application/pdf, body starts %PDF ---
    const downloadRes = await request(http)
      .get(`/api/v1/documents/${docId1}/download`)
      .set(auth())
      .expect(200);
    expect(downloadRes.headers['content-type']).toMatch(/application\/pdf/);
    // Buffer comparison: first 4 bytes == '%PDF'
    const bodyBuf: Buffer = Buffer.isBuffer(downloadRes.body)
      ? downloadRes.body
      : Buffer.from(downloadRes.body as string, 'binary');
    expect(bodyBuf.slice(0, 4).toString()).toBe('%PDF');

    // --- 3e: POST :id/driver-link → {url} with token ---
    const linkRes = await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/driver-link`)
      .set(auth())
      .expect(201);
    const driverUrl: string = linkRes.body.url;
    expect(driverUrl).toBeTruthy();
    // Extract token from url (last path segment)
    const driverToken = driverUrl.split('/').pop()!;
    expect(driverToken.length).toBeGreaterThan(0);

    // --- 3f: GET /public/driver/:token/bol → 200 PDF ---
    const publicBolRes = await request(http)
      .get(`/api/v1/public/driver/${driverToken}/bol`)
      .expect(200);
    expect(publicBolRes.headers['content-type']).toMatch(/application\/pdf/);

    // --- 3g: DELETE driver-link → GET /public/driver/:token/bol → 404 ---
    await request(http)
      .delete(`/api/v1/transportation/loads/${loadId}/driver-link`)
      .set(auth())
      .expect(200);

    await request(http)
      .get(`/api/v1/public/driver/${driverToken}/bol`)
      .expect(404);

    // --- 3h: Regenerate BOL → second document, different BOL number ---
    const bol2 = await request(http)
      .post(`/api/v1/transportation/loads/${loadId}/bol`)
      .set(auth())
      .expect(201);

    const docId2 = bol2.body.id;
    const fileName2: string = bol2.body.fileName;
    expect(docId2).not.toBe(docId1);
    expect(fileName2).toMatch(/^BOL-\d{6}\.pdf$/);
    // Different BOL number
    expect(fileName2).not.toBe(fileName1);

    const docs2 = await request(http)
      .get(`/api/v1/transportation/loads/${loadId}/documents`)
      .set(auth())
      .expect(200);
    expect(docs2.body).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Test 4 — Delay detection
  // ---------------------------------------------------------------------------
  it('delay detection: tick creates DELAYED event + notification; second tick = 0 new (dedup)', async () => {
    // Build a load with a route whose stop deadline is in the past, then dispatch.
    // Route rebuild is only allowed on OPEN/PLANNED loads, so we build the route
    // with a past window BEFORE dispatching.

    const { shipmentId: dShipId } = await createAndPlan();

    const dLoadRes = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    const dLoadId = dLoadRes.body.id;
    ids.delayLoad1Id = dLoadId;

    await request(http)
      .post(`/api/v1/transportation/shipments/${dShipId}/assign-load`)
      .set(auth())
      .send({ loadId: dLoadId })
      .expect(201);

    await request(http)
      .post(`/api/v1/transportation/loads/${dLoadId}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);

    // Build route with plannedArrivalLate in the past (30 min ago)
    const pastDeadline = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const routeRes = await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: dLoadId,
        stops: [
          {
            sequence: 1,
            type: 'PICKUP',
            locationId: ids.origin,
            shipmentId: dShipId,
            plannedArrivalEarly: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            plannedArrivalLate: pastDeadline,
          },
          {
            sequence: 2,
            type: 'DELIVERY',
            locationId: ids.destination,
            shipmentId: dShipId,
          },
        ],
      })
      .expect(201);

    const stop1Id = routeRes.body.stops[0].id;
    ids.delayStop1Id = stop1Id;

    // Dispatch the load (now DISPATCHED — delay detection will pick it up)
    await request(http)
      .post(`/api/v1/transportation/loads/${dLoadId}/dispatch`)
      .set(auth())
      .expect(201);

    // Get the load number for notification assertion
    const dLoadMeta = await request(http)
      .get(`/api/v1/transportation/loads/${dLoadId}`)
      .set(auth())
      .expect(200);
    ids.delayLoad1Number = dLoadMeta.body.loadNumber;

    // --- Tick 1: should create 1 DELAYED event ---
    const detector = app.get(DelayDetectionService);
    const n1 = await detector.tick(new Date());
    expect(n1).toBeGreaterThanOrEqual(1);

    // --- Timeline contains DELAYED event for this load ---
    const events = await request(http)
      .get(`/api/v1/transportation/tracking/events?loadId=${dLoadId}`)
      .set(auth())
      .expect(200);
    const delayedEvents = events.body.filter((e: { type: string }) => e.type === 'DELAYED');
    expect(delayedEvents.length).toBeGreaterThanOrEqual(1);

    // --- Unread notifications contain this load's alert ---
    const notifs = await request(http)
      .get('/api/v1/notifications?unread=true')
      .set(auth())
      .expect(200);
    const loadAlert = notifs.body.find((n: { title: string }) =>
      n.title.includes(ids.delayLoad1Number),
    );
    expect(loadAlert).toBeDefined();

    // Save for test 5
    (ids as Record<string, string>).alertNotifId = loadAlert.id;

    // --- Tick 2: dedup → 0 new events for this load ---
    // Count DELAYED events before
    const countBefore = delayedEvents.length;

    await detector.tick(new Date());

    const events2 = await request(http)
      .get(`/api/v1/transportation/tracking/events?loadId=${dLoadId}`)
      .set(auth())
      .expect(200);
    const delayedEvents2 = events2.body.filter((e: { type: string }) => e.type === 'DELAYED');
    // Dedup: count must not have increased
    expect(delayedEvents2.length).toBe(countBefore);
  });

  // ---------------------------------------------------------------------------
  // Note on replan re-alert scenario
  // ---------------------------------------------------------------------------
  //
  // The delay-detection spec mentions "replan changes deadline → re-alert".
  // However, `RoutesService.createForLoad()` enforces that routes can only be
  // built on OPEN or PLANNED loads (throws 400 for DISPATCHED/IN_TRANSIT).
  // Once a load is dispatched for delay detection to pick it up, its route
  // cannot be rebuilt via the API. Therefore the replan-and-re-alert scenario
  // cannot be exercised end-to-end today through the HTTP layer.
  //
  // The dedup key in the service is (stopId, deadline.toISOString()), so a stop
  // with a DIFFERENT past deadline on a DIFFERENT load creates its own independent
  // alert — which is verified in the test below.
  //
  // The replan path is protected at the service level and will be testable once
  // an admin/patch-stop endpoint is exposed.
  //
  it('delay detection: a DIFFERENT stop with its own past deadline creates its own alert', async () => {
    // Second load with a different stop
    const { shipmentId: dShipId2 } = await createAndPlan();

    const dLoadRes2 = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    const dLoadId2 = dLoadRes2.body.id;
    ids.delayLoad2Id = dLoadId2;

    await request(http)
      .post(`/api/v1/transportation/shipments/${dShipId2}/assign-load`)
      .set(auth())
      .send({ loadId: dLoadId2 })
      .expect(201);

    await request(http)
      .post(`/api/v1/transportation/loads/${dLoadId2}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);

    // Different past deadline
    const pastDeadline2 = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const routeRes2 = await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: dLoadId2,
        stops: [
          {
            sequence: 1,
            type: 'PICKUP',
            locationId: ids.origin,
            shipmentId: dShipId2,
            plannedArrivalEarly: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
            plannedArrivalLate: pastDeadline2,
          },
          {
            sequence: 2,
            type: 'DELIVERY',
            locationId: ids.destination,
            shipmentId: dShipId2,
          },
        ],
      })
      .expect(201);

    ids.delayStop2Id = routeRes2.body.stops[0].id;

    await request(http)
      .post(`/api/v1/transportation/loads/${dLoadId2}/dispatch`)
      .set(auth())
      .expect(201);

    const dLoadMeta2 = await request(http)
      .get(`/api/v1/transportation/loads/${dLoadId2}`)
      .set(auth())
      .expect(200);
    ids.delayLoad2Number = dLoadMeta2.body.loadNumber;

    const detector = app.get(DelayDetectionService);
    const n2 = await detector.tick(new Date());
    // At least 1 new alert from this new load
    expect(n2).toBeGreaterThanOrEqual(1);

    // Notification for load 2 present
    const notifs2 = await request(http)
      .get('/api/v1/notifications?unread=true')
      .set(auth())
      .expect(200);
    const alert2 = notifs2.body.find((n: { title: string }) =>
      n.title.includes(ids.delayLoad2Number),
    );
    expect(alert2).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Test 5 — Mark notification as read
  // ---------------------------------------------------------------------------
  it('mark read: POST :id/read removes notification from unread list', async () => {
    const notifId = (ids as Record<string, string>).alertNotifId;
    expect(notifId).toBeTruthy();

    await request(http)
      .post(`/api/v1/notifications/${notifId}/read`)
      .set(auth())
      .expect(201);

    const unread = await request(http)
      .get('/api/v1/notifications?unread=true')
      .set(auth())
      .expect(200);
    const stillPresent = unread.body.find((n: { id: string }) => n.id === notifId);
    expect(stillPresent).toBeUndefined();
  });
});
