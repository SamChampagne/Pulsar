/**
 * E2E: Configurable WMS / Yard / Fleet (Task 9)
 *
 * Covers:
 *   A. WMS Prefixes
 *      A.1 documentPrefixReceipt — next receipt number starts with custom prefix;
 *          counter does NOT reset on second receipt.
 *      A.2 documentPrefixPickOrder — same for pick orders.
 *   B. Yard Prefixes
 *      B.1 documentPrefixYardVisit — next visit number starts with custom prefix;
 *          counter incremented on second visit.
 *      B.2 documentPrefixDockAppointment — same for dock appointments.
 *   C. Yard spotConflictPolicy
 *      C.1 BLOCK (default) — assigning two active visits to the same spot → 409.
 *      C.2 WARN — same assignment succeeds with non-empty spotWarnings and a
 *          YardMove row is written.
 *   D. Custom fields round-trip (one per module)
 *      D.1 WMS/RECEIPT — required SELECT field: missing → 400; bad value → 400;
 *          valid → 201 + customData in GET.
 *      D.2 Yard/YARD_VISIT — same pattern.
 *      D.3 Fleet/VEHICLE — same pattern (vehicle created via transportation endpoint;
 *          custom-field definitions via fleet/custom-fields).
 *   E. Tenant isolation — definitions created for tenant A are absent from tenant B.
 *   F. Defaults — with no setting configured, default prefixes (RC-, PK-, YV-, DA-)
 *      and BLOCK behaviour are unchanged.
 *
 * Each suite resets the relevant module settings to defaults in afterAll so that
 * suites do not pollute each other.
 *
 * Prerequisites: running Postgres, db:migrate + db:seed applied.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Credentials + unique suffix
// ---------------------------------------------------------------------------

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const suffix = `${Date.now()}-cwf`;

// ---------------------------------------------------------------------------
// Shared app-level state
// ---------------------------------------------------------------------------

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let token = '';
let tenantId = '';

const auth = () => ({ Authorization: `Bearer ${token}` });

// Shared master data for WMS tests
let wmsLocationId = '';
let wmsReceivingBinId = '';
let wmsStorageBinId = '';
let wmsItemId = '';

// Shared master data for Yard tests
let yardLocationId = '';
let yardDoorId = '';
let yardParkingId = '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function putModuleSettings(module: string, settings: Record<string, unknown>) {
  await request(http)
    .put(`/api/v1/modules/${module}/settings`)
    .set(auth())
    .send({ settings })
    .expect(200);
}

async function enableModules(keys: string[]) {
  for (const key of keys) {
    const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });
  }
}

// ---------------------------------------------------------------------------
// Top-level describe — one shared app for the whole file
// ---------------------------------------------------------------------------

describe('Configurable WMS / Yard / Fleet (e2e)', () => {
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

    // Login
    const loginRes = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (loginRes.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Enable all modules needed
    await enableModules(['wms', 'yard', 'fleet', 'transportation', 'billing']);

    // --- WMS master data: warehouse location + 2 bins + 1 item ---------------
    const wmsLoc = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `CWF-WMS-${suffix}`,
        name: `CWF WMS ${suffix}`,
        type: 'WAREHOUSE',
        addressLine1: '1 WMS Way',
        city: 'Montreal',
        country: 'CA',
      })
      .expect(201);
    wmsLocationId = (wmsLoc.body as { id: string }).id;

    const recvBin = await request(http)
      .post('/api/v1/wms/bins')
      .set(auth())
      .send({ locationId: wmsLocationId, code: `RECV-CWF-${suffix}`, kind: 'RECEIVING' })
      .expect(201);
    wmsReceivingBinId = (recvBin.body as { id: string }).id;

    const storBin = await request(http)
      .post('/api/v1/wms/bins')
      .set(auth())
      .send({ locationId: wmsLocationId, code: `STOR-CWF-${suffix}`, kind: 'STORAGE' })
      .expect(201);
    wmsStorageBinId = (storBin.body as { id: string }).id;

    const item = await request(http)
      .post('/api/v1/wms/items')
      .set(auth())
      .send({ sku: `CWF-SKU-${suffix}`, name: `CWF Widget ${suffix}` })
      .expect(201);
    wmsItemId = (item.body as { id: string }).id;

    // --- Yard master data: one site + 2 spots --------------------------------
    const yardLoc = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `CWF-YARD-${suffix}`,
        name: `CWF Yard ${suffix}`,
        type: 'DISTRIBUTION_CENTER',
        addressLine1: '2 Yard Way',
        city: 'Toronto',
        country: 'CA',
      })
      .expect(201);
    yardLocationId = (yardLoc.body as { id: string }).id;

    const door = await request(http)
      .post('/api/v1/yard/spots')
      .set(auth())
      .send({ locationId: yardLocationId, code: `CWF-DOOR-${suffix}`, type: 'DOCK_DOOR' })
      .expect(201);
    yardDoorId = (door.body as { id: string }).id;

    const parking = await request(http)
      .post('/api/v1/yard/spots')
      .set(auth())
      .send({ locationId: yardLocationId, code: `CWF-PARK-${suffix}`, type: 'PARKING' })
      .expect(201);
    yardParkingId = (parking.body as { id: string }).id;
  });

  afterAll(async () => {
    if (prisma) {
      // Cleanup yard
      await prisma.yardVisit
        .deleteMany({ where: { tenantId, spotId: { in: [yardDoorId, yardParkingId] } } })
        .catch(() => undefined);
      await prisma.yardVisit
        .deleteMany({ where: { tenantId, locationId: yardLocationId } })
        .catch(() => undefined);
      await prisma.dockAppointment
        .deleteMany({ where: { tenantId, locationId: yardLocationId } })
        .catch(() => undefined);
      await prisma.yardSpot
        .deleteMany({ where: { id: { in: [yardDoorId, yardParkingId] } } })
        .catch(() => undefined);
      await prisma.location
        .deleteMany({ where: { id: yardLocationId } })
        .catch(() => undefined);

      // Cleanup WMS
      await prisma.stockMovement
        .deleteMany({ where: { tenantId, itemId: wmsItemId } })
        .catch(() => undefined);
      await prisma.inventoryLevel
        .deleteMany({ where: { tenantId, itemId: wmsItemId } })
        .catch(() => undefined);
      await prisma.receipt
        .deleteMany({ where: { tenantId, locationId: wmsLocationId } })
        .catch(() => undefined);
      await prisma.pickOrder
        .deleteMany({ where: { tenantId, locationId: wmsLocationId } })
        .catch(() => undefined);
      await prisma.bin
        .deleteMany({ where: { id: { in: [wmsReceivingBinId, wmsStorageBinId] } } })
        .catch(() => undefined);
      await prisma.wmsItem.deleteMany({ where: { id: wmsItemId } }).catch(() => undefined);
      await prisma.location
        .deleteMany({ where: { id: wmsLocationId } })
        .catch(() => undefined);

      // Cleanup custom-field definitions created by suites
      await prisma.customFieldDefinition
        .deleteMany({ where: { tenantId, module: { in: ['wms', 'yard', 'fleet'] } } })
        .catch(() => undefined);
    }

    await app.close();
  });

  // ==========================================================================
  // Suite F — Defaults (no settings / custom fields configured)
  // Run first so we confirm baseline before any suite changes settings.
  // ==========================================================================
  describe('F. Defaults — unchanged behaviour with no setting configured', () => {
    it('F.1 receipt created without settings uses default RC- prefix', async () => {
      const res = await request(http)
        .post('/api/v1/wms/receipts')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(201);
      const number: string = (res.body as { number: string }).number;
      expect(number).toMatch(/^RC-/);
    });

    it('F.2 pick order created without settings uses default PK- prefix', async () => {
      const res = await request(http)
        .post('/api/v1/wms/pick-orders')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(201);
      const number: string = (res.body as { number: string }).number;
      expect(number).toMatch(/^PK-/);
    });

    it('F.3 yard visit created without settings uses default YV- prefix', async () => {
      const res = await request(http)
        .post('/api/v1/yard/visits')
        .set(auth())
        .send({ locationId: yardLocationId, trailerRef: `DEF-TR-${suffix}`, direction: 'INBOUND' })
        .expect(201);
      const number: string = (res.body as { visitNumber: string }).visitNumber;
      expect(number).toMatch(/^YV-/);
    });

    it('F.4 dock appointment created without settings uses default DA- prefix', async () => {
      const now = Date.now();
      const res = await request(http)
        .post('/api/v1/yard/appointments')
        .set(auth())
        .send({
          locationId: yardLocationId,
          direction: 'INBOUND',
          windowStart: new Date(now + 3_600_000).toISOString(),
          windowEnd: new Date(now + 7_200_000).toISOString(),
        })
        .expect(201);
      const number: string = (res.body as { appointmentNumber: string }).appointmentNumber;
      expect(number).toMatch(/^DA-/);
    });
  });

  // ==========================================================================
  // Suite A.1 — WMS documentPrefixReceipt
  // ==========================================================================
  describe('A.1 WMS documentPrefixReceipt', () => {
    let counterBefore = 0;

    afterAll(async () => {
      await putModuleSettings('wms', { documentPrefixReceipt: 'RC' });
    });

    it('captures the counter before changing the prefix', async () => {
      // Warm the counter with a default-prefix receipt.
      const res = await request(http)
        .post('/api/v1/wms/receipts')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(201);
      const num: string = (res.body as { number: string }).number;
      expect(num).toMatch(/^RC-/);
      counterBefore = parseInt(num.split('-')[1], 10);
      expect(counterBefore).toBeGreaterThan(0);
    });

    it('after setting prefix to RCV, first receipt starts RCV- and counter is strictly higher', async () => {
      await putModuleSettings('wms', { documentPrefixReceipt: 'RCV' });

      const res = await request(http)
        .post('/api/v1/wms/receipts')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(201);
      const num: string = (res.body as { number: string }).number;
      expect(num).toMatch(/^RCV-/);
      const counterAfter = parseInt(num.split('-')[1], 10);
      expect(counterAfter).toBeGreaterThan(counterBefore);
    });

    it('second receipt under RCV- prefix increments the counter (not reset)', async () => {
      const res1 = await request(http)
        .post('/api/v1/wms/receipts')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(201);
      const num1: string = (res1.body as { number: string }).number;

      const res2 = await request(http)
        .post('/api/v1/wms/receipts')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(201);
      const num2: string = (res2.body as { number: string }).number;

      expect(num1).toMatch(/^RCV-/);
      expect(num2).toMatch(/^RCV-/);

      const c1 = parseInt(num1.split('-')[1], 10);
      const c2 = parseInt(num2.split('-')[1], 10);
      expect(c2).toBeGreaterThan(c1);
    });
  });

  // ==========================================================================
  // Suite A.2 — WMS documentPrefixPickOrder
  // ==========================================================================
  describe('A.2 WMS documentPrefixPickOrder', () => {
    let counterBefore = 0;

    afterAll(async () => {
      await putModuleSettings('wms', { documentPrefixPickOrder: 'PK' });
    });

    it('captures the counter before changing the prefix', async () => {
      const res = await request(http)
        .post('/api/v1/wms/pick-orders')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(201);
      const num: string = (res.body as { number: string }).number;
      expect(num).toMatch(/^PK-/);
      counterBefore = parseInt(num.split('-')[1], 10);
      expect(counterBefore).toBeGreaterThan(0);
    });

    it('after setting prefix to PKX, first pick-order starts PKX- and counter is strictly higher', async () => {
      await putModuleSettings('wms', { documentPrefixPickOrder: 'PKX' });

      const res = await request(http)
        .post('/api/v1/wms/pick-orders')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(201);
      const num: string = (res.body as { number: string }).number;
      expect(num).toMatch(/^PKX-/);
      const counterAfter = parseInt(num.split('-')[1], 10);
      expect(counterAfter).toBeGreaterThan(counterBefore);
    });

    it('second pick-order under PKX- increments the counter (not reset)', async () => {
      const res1 = await request(http)
        .post('/api/v1/wms/pick-orders')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(201);
      const res2 = await request(http)
        .post('/api/v1/wms/pick-orders')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(201);

      const num1: string = (res1.body as { number: string }).number;
      const num2: string = (res2.body as { number: string }).number;
      const c1 = parseInt(num1.split('-')[1], 10);
      const c2 = parseInt(num2.split('-')[1], 10);
      expect(c2).toBeGreaterThan(c1);
    });
  });

  // ==========================================================================
  // Suite B.1 — Yard documentPrefixYardVisit
  // ==========================================================================
  describe('B.1 Yard documentPrefixYardVisit', () => {
    let counterBefore = 0;

    afterAll(async () => {
      await putModuleSettings('yard', { documentPrefixYardVisit: 'YV' });
    });

    it('captures the counter before changing the prefix', async () => {
      const res = await request(http)
        .post('/api/v1/yard/visits')
        .set(auth())
        .send({ locationId: yardLocationId, trailerRef: `YVB-${suffix}`, direction: 'INBOUND' })
        .expect(201);
      const num: string = (res.body as { visitNumber: string }).visitNumber;
      expect(num).toMatch(/^YV-/);
      counterBefore = parseInt(num.split('-')[1], 10);
      expect(counterBefore).toBeGreaterThan(0);
    });

    it('after setting prefix to YVX, first visit starts YVX- and counter is strictly higher', async () => {
      await putModuleSettings('yard', { documentPrefixYardVisit: 'YVX' });

      const res = await request(http)
        .post('/api/v1/yard/visits')
        .set(auth())
        .send({ locationId: yardLocationId, trailerRef: `YVX1-${suffix}`, direction: 'INBOUND' })
        .expect(201);
      const num: string = (res.body as { visitNumber: string }).visitNumber;
      expect(num).toMatch(/^YVX-/);
      const counterAfter = parseInt(num.split('-')[1], 10);
      expect(counterAfter).toBeGreaterThan(counterBefore);
    });

    it('second visit under YVX- prefix increments the counter (not reset)', async () => {
      const res1 = await request(http)
        .post('/api/v1/yard/visits')
        .set(auth())
        .send({ locationId: yardLocationId, trailerRef: `YVX2a-${suffix}`, direction: 'INBOUND' })
        .expect(201);
      const res2 = await request(http)
        .post('/api/v1/yard/visits')
        .set(auth())
        .send({ locationId: yardLocationId, trailerRef: `YVX2b-${suffix}`, direction: 'OUTBOUND' })
        .expect(201);

      const num1: string = (res1.body as { visitNumber: string }).visitNumber;
      const num2: string = (res2.body as { visitNumber: string }).visitNumber;
      const c1 = parseInt(num1.split('-')[1], 10);
      const c2 = parseInt(num2.split('-')[1], 10);
      expect(c2).toBeGreaterThan(c1);
    });
  });

  // ==========================================================================
  // Suite B.2 — Yard documentPrefixDockAppointment
  // ==========================================================================
  describe('B.2 Yard documentPrefixDockAppointment', () => {
    let counterBefore = 0;

    const futureWindow = () => {
      const now = Date.now();
      return {
        windowStart: new Date(now + 3_600_000).toISOString(),
        windowEnd: new Date(now + 7_200_000).toISOString(),
      };
    };

    afterAll(async () => {
      await putModuleSettings('yard', { documentPrefixDockAppointment: 'DA' });
    });

    it('captures the counter before changing the prefix', async () => {
      const res = await request(http)
        .post('/api/v1/yard/appointments')
        .set(auth())
        .send({ locationId: yardLocationId, direction: 'INBOUND', ...futureWindow() })
        .expect(201);
      const num: string = (res.body as { appointmentNumber: string }).appointmentNumber;
      expect(num).toMatch(/^DA-/);
      counterBefore = parseInt(num.split('-')[1], 10);
      expect(counterBefore).toBeGreaterThan(0);
    });

    it('after setting prefix to DAX, first appointment starts DAX- and counter is strictly higher', async () => {
      await putModuleSettings('yard', { documentPrefixDockAppointment: 'DAX' });

      const res = await request(http)
        .post('/api/v1/yard/appointments')
        .set(auth())
        .send({ locationId: yardLocationId, direction: 'INBOUND', ...futureWindow() })
        .expect(201);
      const num: string = (res.body as { appointmentNumber: string }).appointmentNumber;
      expect(num).toMatch(/^DAX-/);
      const counterAfter = parseInt(num.split('-')[1], 10);
      expect(counterAfter).toBeGreaterThan(counterBefore);
    });

    it('second appointment under DAX- prefix increments the counter (not reset)', async () => {
      const res1 = await request(http)
        .post('/api/v1/yard/appointments')
        .set(auth())
        .send({ locationId: yardLocationId, direction: 'INBOUND', ...futureWindow() })
        .expect(201);
      const res2 = await request(http)
        .post('/api/v1/yard/appointments')
        .set(auth())
        .send({ locationId: yardLocationId, direction: 'OUTBOUND', ...futureWindow() })
        .expect(201);

      const num1: string = (res1.body as { appointmentNumber: string }).appointmentNumber;
      const num2: string = (res2.body as { appointmentNumber: string }).appointmentNumber;
      const c1 = parseInt(num1.split('-')[1], 10);
      const c2 = parseInt(num2.split('-')[1], 10);
      expect(c2).toBeGreaterThan(c1);
    });
  });

  // ==========================================================================
  // Suite C — Yard spotConflictPolicy
  // ==========================================================================
  describe('C. Yard spotConflictPolicy', () => {
    afterAll(async () => {
      // Reset to default BLOCK policy
      await putModuleSettings('yard', { spotConflictPolicy: 'BLOCK' });
    });

    describe('C.1 BLOCK (default) — second active visit on same spot returns 409', () => {
      let visitA = '';
      let visitB = '';

      beforeAll(async () => {
        // Ensure BLOCK is active (it's the default, but be explicit)
        await putModuleSettings('yard', { spotConflictPolicy: 'BLOCK' });

        const resA = await request(http)
          .post('/api/v1/yard/visits')
          .set(auth())
          .send({ locationId: yardLocationId, trailerRef: `BLK-A-${suffix}`, direction: 'INBOUND' })
          .expect(201);
        visitA = (resA.body as { id: string }).id;

        const resB = await request(http)
          .post('/api/v1/yard/visits')
          .set(auth())
          .send({ locationId: yardLocationId, trailerRef: `BLK-B-${suffix}`, direction: 'INBOUND' })
          .expect(201);
        visitB = (resB.body as { id: string }).id;

        // Assign visitA to the door spot
        await request(http)
          .post(`/api/v1/yard/visits/${visitA}/assign`)
          .set(auth())
          .send({ spotId: yardDoorId })
          .expect((r) => expect([200, 201]).toContain(r.status));
      });

      afterAll(async () => {
        // Check out visitA to free the door for subsequent suites
        await request(http)
          .post(`/api/v1/yard/visits/${visitA}/check-out`)
          .set(auth())
          .expect((r) => expect([200, 201]).toContain(r.status))
          .catch(() => undefined);
        // Checkout visitB if it is still active
        await request(http)
          .post(`/api/v1/yard/visits/${visitB}/check-out`)
          .set(auth())
          .expect((r) => expect([200, 201]).toContain(r.status))
          .catch(() => undefined);
      });

      it('assigning a second active visit to an occupied spot with BLOCK → 409', async () => {
        await request(http)
          .post(`/api/v1/yard/visits/${visitB}/assign`)
          .set(auth())
          .send({ spotId: yardDoorId })
          .expect(409);
      });
    });

    describe('C.2 WARN — second assignment succeeds with non-empty spotWarnings and YardMove written', () => {
      let visitC = '';
      let visitD = '';

      beforeAll(async () => {
        await putModuleSettings('yard', { spotConflictPolicy: 'WARN' });

        const resC = await request(http)
          .post('/api/v1/yard/visits')
          .set(auth())
          .send({ locationId: yardLocationId, trailerRef: `WARN-C-${suffix}`, direction: 'INBOUND' })
          .expect(201);
        visitC = (resC.body as { id: string }).id;

        const resD = await request(http)
          .post('/api/v1/yard/visits')
          .set(auth())
          .send({ locationId: yardLocationId, trailerRef: `WARN-D-${suffix}`, direction: 'INBOUND' })
          .expect(201);
        visitD = (resD.body as { id: string }).id;

        // Assign visitC to the door spot to occupy it
        await request(http)
          .post(`/api/v1/yard/visits/${visitC}/assign`)
          .set(auth())
          .send({ spotId: yardDoorId })
          .expect((r) => expect([200, 201]).toContain(r.status));
      });

      afterAll(async () => {
        await request(http)
          .post(`/api/v1/yard/visits/${visitC}/check-out`)
          .set(auth())
          .catch(() => undefined);
        await request(http)
          .post(`/api/v1/yard/visits/${visitD}/check-out`)
          .set(auth())
          .catch(() => undefined);
      });

      it('assigning second visit with WARN succeeds (2xx) with non-empty spotWarnings', async () => {
        const res = await request(http)
          .post(`/api/v1/yard/visits/${visitD}/assign`)
          .set(auth())
          .send({ spotId: yardDoorId })
          .expect((r) => expect([200, 201]).toContain(r.status));

        const body = res.body as { spotWarnings?: string[] };
        expect(body.spotWarnings).toBeDefined();
        expect(Array.isArray(body.spotWarnings)).toBe(true);
        expect((body.spotWarnings as string[]).length).toBeGreaterThan(0);
      });

      it('a YardMove row exists for the WARN assignment', async () => {
        const moves = await prisma.yardMove.count({
          where: { tenantId, visitId: visitD, toSpotId: yardDoorId },
        });
        expect(moves).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // Suite D.1 — Custom fields: WMS / RECEIPT
  // ==========================================================================
  describe('D.1 Custom fields — WMS/RECEIPT', () => {
    const entityType = 'RECEIPT';
    const fieldKey = 'rcvSvc';

    afterAll(async () => {
      // Clear definitions so other suites are unaffected
      await request(http)
        .put('/api/v1/wms/custom-fields')
        .set(auth())
        .send({ entityType, definitions: [] })
        .expect(200);
    });

    it('PUT wms/custom-fields: required SELECT field for RECEIPT → 200', async () => {
      await request(http)
        .put('/api/v1/wms/custom-fields')
        .set(auth())
        .send({
          entityType,
          definitions: [
            {
              key: fieldKey,
              label: 'Receiving Service',
              type: 'SELECT',
              required: true,
              showInList: false,
              sortOrder: 0,
              options: [
                { value: 'STD', label: 'Standard' },
                { value: 'EXP', label: 'Express' },
              ],
            },
          ],
        })
        .expect(200);
    });

    it('GET wms/custom-fields returns the new field', async () => {
      const res = await request(http)
        .get(`/api/v1/wms/custom-fields?entityType=${entityType}`)
        .set(auth())
        .expect(200);
      const defs = res.body as { key: string }[];
      expect(defs.some((d) => d.key === fieldKey)).toBe(true);
    });

    it('create receipt without required field → 400', async () => {
      await request(http)
        .post('/api/v1/wms/receipts')
        .set(auth())
        .send({ locationId: wmsLocationId })
        .expect(400);
    });

    it('create receipt with value outside allowed options → 400', async () => {
      await request(http)
        .post('/api/v1/wms/receipts')
        .set(auth())
        .send({ locationId: wmsLocationId, customData: { [fieldKey]: 'INVALID' } })
        .expect(400);
    });

    it('create receipt with valid option → 201 + GET reflects customData', async () => {
      const res = await request(http)
        .post('/api/v1/wms/receipts')
        .set(auth())
        .send({ locationId: wmsLocationId, customData: { [fieldKey]: 'STD' } })
        .expect(201);

      const receiptId = (res.body as { id: string }).id;

      const detail = await request(http)
        .get(`/api/v1/wms/receipts/${receiptId}`)
        .set(auth())
        .expect(200);

      const customData = (detail.body as { customData: Record<string, unknown> }).customData;
      expect(customData).toBeTruthy();
      expect(customData[fieldKey]).toBe('STD');
    });
  });

  // ==========================================================================
  // Suite D.2 — Custom fields: Yard / YARD_VISIT
  // ==========================================================================
  describe('D.2 Custom fields — Yard/YARD_VISIT', () => {
    const entityType = 'YARD_VISIT';
    const fieldKey = 'visitType';

    afterAll(async () => {
      await request(http)
        .put('/api/v1/yard/custom-fields')
        .set(auth())
        .send({ entityType, definitions: [] })
        .expect(200);
    });

    it('PUT yard/custom-fields: required SELECT field for YARD_VISIT → 200', async () => {
      await request(http)
        .put('/api/v1/yard/custom-fields')
        .set(auth())
        .send({
          entityType,
          definitions: [
            {
              key: fieldKey,
              label: 'Visit Type',
              type: 'SELECT',
              required: true,
              showInList: false,
              sortOrder: 0,
              options: [
                { value: 'DELIVERY', label: 'Delivery' },
                { value: 'PICKUP', label: 'Pickup' },
              ],
            },
          ],
        })
        .expect(200);
    });

    it('GET yard/custom-fields returns the new field', async () => {
      const res = await request(http)
        .get(`/api/v1/yard/custom-fields?entityType=${entityType}`)
        .set(auth())
        .expect(200);
      const defs = res.body as { key: string }[];
      expect(defs.some((d) => d.key === fieldKey)).toBe(true);
    });

    it('create yard visit without required field → 400', async () => {
      await request(http)
        .post('/api/v1/yard/visits')
        .set(auth())
        .send({ locationId: yardLocationId, trailerRef: `CF-MISS-${suffix}`, direction: 'INBOUND' })
        .expect(400);
    });

    it('create yard visit with value outside allowed options → 400', async () => {
      await request(http)
        .post('/api/v1/yard/visits')
        .set(auth())
        .send({
          locationId: yardLocationId,
          trailerRef: `CF-BAD-${suffix}`,
          direction: 'INBOUND',
          customData: { [fieldKey]: 'WRONG' },
        })
        .expect(400);
    });

    it('create yard visit with valid option → 201 + GET reflects customData', async () => {
      const res = await request(http)
        .post('/api/v1/yard/visits')
        .set(auth())
        .send({
          locationId: yardLocationId,
          trailerRef: `CF-OK-${suffix}`,
          direction: 'INBOUND',
          customData: { [fieldKey]: 'DELIVERY' },
        })
        .expect(201);

      const visitId = (res.body as { id: string }).id;

      const detail = await request(http)
        .get(`/api/v1/yard/visits/${visitId}`)
        .set(auth())
        .expect(200);

      const customData = (detail.body as { customData: Record<string, unknown> }).customData;
      expect(customData).toBeTruthy();
      expect(customData[fieldKey]).toBe('DELIVERY');
    });
  });

  // ==========================================================================
  // Suite D.3 — Custom fields: Fleet / VEHICLE
  // ==========================================================================
  describe('D.3 Custom fields — Fleet/VEHICLE', () => {
    const entityType = 'VEHICLE';
    const fieldKey = 'fuelType';
    let vehicleId = '';

    afterAll(async () => {
      // Clear definitions
      await request(http)
        .put('/api/v1/fleet/custom-fields')
        .set(auth())
        .send({ entityType, definitions: [] })
        .expect(200);

      // Clean up created vehicles
      if (vehicleId) {
        await prisma.vehicle.deleteMany({ where: { id: vehicleId } }).catch(() => undefined);
      }
    });

    it('PUT fleet/custom-fields: required SELECT field for VEHICLE → 200', async () => {
      await request(http)
        .put('/api/v1/fleet/custom-fields')
        .set(auth())
        .send({
          entityType,
          definitions: [
            {
              key: fieldKey,
              label: 'Fuel Type',
              type: 'SELECT',
              required: true,
              showInList: false,
              sortOrder: 0,
              options: [
                { value: 'DIESEL', label: 'Diesel' },
                { value: 'ELECTRIC', label: 'Electric' },
              ],
            },
          ],
        })
        .expect(200);
    });

    it('GET fleet/custom-fields returns the new field', async () => {
      const res = await request(http)
        .get(`/api/v1/fleet/custom-fields?entityType=${entityType}`)
        .set(auth())
        .expect(200);
      const defs = res.body as { key: string }[];
      expect(defs.some((d) => d.key === fieldKey)).toBe(true);
    });

    it('create vehicle without required field → 400', async () => {
      await request(http)
        .post('/api/v1/transportation/vehicles')
        .set(auth())
        .send({ unitNumber: `CF-VMISS-${suffix}`, type: 'TRACTOR' })
        .expect(400);
    });

    it('create vehicle with value outside allowed options → 400', async () => {
      await request(http)
        .post('/api/v1/transportation/vehicles')
        .set(auth())
        .send({
          unitNumber: `CF-VBAD-${suffix}`,
          type: 'TRACTOR',
          customData: { [fieldKey]: 'GAS' },
        })
        .expect(400);
    });

    it('create vehicle with valid option → 201 + GET reflects customData', async () => {
      const res = await request(http)
        .post('/api/v1/transportation/vehicles')
        .set(auth())
        .send({
          unitNumber: `CF-VOK-${suffix}`,
          type: 'TRACTOR',
          customData: { [fieldKey]: 'DIESEL' },
        })
        .expect(201);

      vehicleId = (res.body as { id: string }).id;

      const detail = await request(http)
        .get(`/api/v1/transportation/vehicles/${vehicleId}`)
        .set(auth())
        .expect(200);

      const customData = (detail.body as { customData: Record<string, unknown> }).customData;
      expect(customData).toBeTruthy();
      expect(customData[fieldKey]).toBe('DIESEL');
    });
  });

  // ==========================================================================
  // Suite E — Tenant isolation: definitions created for tenant A absent from tenant B
  // ==========================================================================
  describe('E. Tenant isolation — custom-field definitions', () => {
    let otherTenantId = '';
    const otherSlug = `cwf-isolation-${suffix}`;
    const createdFieldIds: string[] = [];

    beforeAll(async () => {
      // Create a fabricated second tenant directly via Prisma
      const otherTenant = await prisma.tenant.create({
        data: { slug: otherSlug, name: `CWF Isolation ${suffix}` },
      });
      otherTenantId = otherTenant.id;

      // Insert CustomFieldDefinitions belonging to the OTHER tenant for each module
      for (const module of ['wms', 'yard', 'fleet']) {
        const def = await prisma.customFieldDefinition.create({
          data: {
            tenantId: otherTenantId,
            module,
            entityType: module === 'wms' ? 'RECEIPT' : module === 'yard' ? 'YARD_VISIT' : 'VEHICLE',
            key: `foreign-${module}`,
            label: 'Foreign',
            type: 'TEXT',
            required: false,
            showInList: false,
            sortOrder: 0,
          },
        });
        createdFieldIds.push(def.id);
      }

      // Ensure acme has at least one definition per module for a meaningful assertion
      for (const [module, entityType, key] of [
        ['wms', 'RECEIPT', 'iso-wms'],
        ['yard', 'YARD_VISIT', 'iso-yard'],
        ['fleet', 'VEHICLE', 'iso-fleet'],
      ] as const) {
        await prisma.customFieldDefinition.upsert({
          where: {
            tenantId_module_entityType_key: {
              tenantId,
              module,
              entityType,
              key,
            },
          },
          update: {},
          create: {
            tenantId,
            module,
            entityType,
            key,
            label: `Isolation ${module}`,
            type: 'TEXT',
            required: false,
            showInList: false,
            sortOrder: 0,
          },
        });
      }
    });

    afterAll(async () => {
      if (createdFieldIds.length) {
        await prisma.customFieldDefinition
          .deleteMany({ where: { id: { in: createdFieldIds } } })
          .catch(() => undefined);
      }
      await prisma.customFieldDefinition
        .deleteMany({ where: { tenantId, key: { in: ['iso-wms', 'iso-yard', 'iso-fleet'] } } })
        .catch(() => undefined);
      if (otherTenantId) {
        await prisma.tenant.deleteMany({ where: { id: otherTenantId } }).catch(() => undefined);
      }
    });

    it('acme GET /wms/custom-fields does NOT see other-tenant definition (foreign-wms)', async () => {
      const res = await request(http)
        .get('/api/v1/wms/custom-fields?entityType=RECEIPT')
        .set(auth())
        .expect(200);
      const keys = (res.body as { key: string }[]).map((d) => d.key);
      expect(keys).not.toContain('foreign-wms');
      expect(keys).toContain('iso-wms');
    });

    it('acme GET /yard/custom-fields does NOT see other-tenant definition (foreign-yard)', async () => {
      const res = await request(http)
        .get('/api/v1/yard/custom-fields?entityType=YARD_VISIT')
        .set(auth())
        .expect(200);
      const keys = (res.body as { key: string }[]).map((d) => d.key);
      expect(keys).not.toContain('foreign-yard');
      expect(keys).toContain('iso-yard');
    });

    it('acme GET /fleet/custom-fields does NOT see other-tenant definition (foreign-fleet)', async () => {
      const res = await request(http)
        .get('/api/v1/fleet/custom-fields?entityType=VEHICLE')
        .set(auth())
        .expect(200);
      const keys = (res.body as { key: string }[]).map((d) => d.key);
      expect(keys).not.toContain('foreign-fleet');
      expect(keys).toContain('iso-fleet');
    });
  });
});
