/**
 * E2E: Manufacturing master-data (sub-project 2).
 *
 * Covers the scheduling-critical master data + the manufacturing-order lifecycle:
 *   A. Enable the manufacturing module for the tenant.
 *   B. WorkingCalendar + shifts, WorkCenter (FK to calendar validated).
 *   C. Routing + steps; ManufacturingOrder with auto number (MO-); materialize
 *      operations from a routing.
 *   D. Lifecycle DRAFT → RELEASED → IN_PROGRESS → COMPLETED via the shared state
 *      machine; an illegal transition is rejected (400).
 *   E. Tenant scoping / FK ownership: a work center referencing an unknown
 *      calendar id is rejected (400).
 *
 * Prerequisites: running Postgres, db:migrate + db:seed applied.
 */

// The APS sidecar is irrelevant here; don't spawn uvicorn during the test boot.
process.env.APS_AUTOSTART = 'false';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123' };
const sfx = `${Date.now()}-mfg`;

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let token = '';
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  http = app.getHttpServer();

  const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
  token = login.body.accessToken;
  await request(http)
    .patch('/api/v1/modules/manufacturing')
    .set(auth())
    .send({ enabled: true })
    .expect(200);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('Manufacturing master-data (e2e)', () => {
  let calendarId = '';
  let wc1 = '';
  let wc2 = '';
  let routingId = '';
  let orderId = '';

  it('creates a working calendar with Mon–Fri shifts', async () => {
    const cal = await request(http)
      .post('/api/v1/manufacturing/calendars')
      .set(auth())
      .send({ code: `CAL-${sfx}`, name: 'Standard' })
      .expect(201);
    calendarId = cal.body.id;
    for (const weekday of [0, 1, 2, 3, 4]) {
      await request(http)
        .post(`/api/v1/manufacturing/calendars/${calendarId}/shifts`)
        .set(auth())
        .send({ weekday, startTime: '08:00', endTime: '16:00' })
        .expect(201);
    }
    const withShifts = await request(http)
      .get(`/api/v1/manufacturing/calendars/${calendarId}`)
      .set(auth())
      .expect(200);
    expect(withShifts.body.shifts).toHaveLength(5);
  });

  it('rejects a work center referencing an unknown calendar (FK ownership)', async () => {
    await request(http)
      .post('/api/v1/manufacturing/work-centers')
      .set(auth())
      .send({ code: `WC-BAD-${sfx}`, name: 'Bad', calendarId: 'does-not-exist' })
      .expect(400);
  });

  it('creates two work centers on the calendar', async () => {
    const a = await request(http)
      .post('/api/v1/manufacturing/work-centers')
      .set(auth())
      .send({ code: `WC-CUT-${sfx}`, name: 'Cutting', calendarId })
      .expect(201);
    const b = await request(http)
      .post('/api/v1/manufacturing/work-centers')
      .set(auth())
      .send({ code: `WC-ASM-${sfx}`, name: 'Assembly', calendarId })
      .expect(201);
    wc1 = a.body.id;
    wc2 = b.body.id;
  });

  it('creates a routing with two steps', async () => {
    const rt = await request(http)
      .post('/api/v1/manufacturing/routings')
      .set(auth())
      .send({ code: `RT-${sfx}`, name: 'Widget routing', productRef: 'WIDGET-1' })
      .expect(201);
    routingId = rt.body.id;
    await request(http)
      .post(`/api/v1/manufacturing/routings/${routingId}/steps`)
      .set(auth())
      .send({ sequence: 1, name: 'Cut', durationMinutes: 60, eligibleWorkCenterIds: [wc1] })
      .expect(201);
    await request(http)
      .post(`/api/v1/manufacturing/routings/${routingId}/steps`)
      .set(auth())
      .send({ sequence: 2, name: 'Assemble', durationMinutes: 30, eligibleWorkCenterIds: [wc2] })
      .expect(201);
  });

  it('creates a manufacturing order with an auto-generated MO- number', async () => {
    const mo = await request(http)
      .post('/api/v1/manufacturing/orders')
      .set(auth())
      .send({
        name: 'Widget batch',
        productRef: 'WIDGET-1',
        quantity: 10,
        releaseDate: '2026-06-29T08:00:00.000Z',
        dueDate: '2026-07-03T16:00:00.000Z',
        priority: 'HIGH',
        routingId,
      })
      .expect(201);
    orderId = mo.body.id;
    expect(mo.body.number).toMatch(/^MO-\d{6}$/);
    expect(mo.body.status).toBe('DRAFT');
  });

  it('materializes operations from the routing', async () => {
    await request(http)
      .post(`/api/v1/manufacturing/orders/${orderId}/operations/from-routing`)
      .set(auth())
      .send({ routingId })
      .expect(201);
    const detail = await request(http)
      .get(`/api/v1/manufacturing/orders/${orderId}`)
      .set(auth())
      .expect(200);
    expect(detail.body.operations).toHaveLength(2);
    expect(detail.body.operations[0].sequence).toBe(1);
  });

  it('runs the lifecycle DRAFT → RELEASED → IN_PROGRESS → COMPLETED', async () => {
    for (const [verb, status] of [
      ['release', 'RELEASED'],
      ['start', 'IN_PROGRESS'],
      ['complete', 'COMPLETED'],
    ] as const) {
      const r = await request(http)
        .post(`/api/v1/manufacturing/orders/${orderId}/${verb}`)
        .set(auth())
        .expect(201);
      expect(r.body.status).toBe(status);
    }
  });

  it('rejects an illegal transition (complete an already-completed order)', async () => {
    await request(http)
      .post(`/api/v1/manufacturing/orders/${orderId}/complete`)
      .set(auth())
      .expect(400);
  });
});
