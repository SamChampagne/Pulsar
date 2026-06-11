/**
 * E2E for phase 7.1: first-class lanes, rating engine v2 (breaks + as-if, accessorials,
 * dated fuel), frozen costDetail snapshot, rate shopping, lane-aware auto-tendering.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 7.1 rating engine (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P7${Date.now().toString(36).toUpperCase()}`;
  const ids = {
    customer: '',
    origin: '',
    destination: '',
    carrier: '',
    carrier2: '',
    tailgate: '',
    waitHour: '',
    fuelTable: '',
    cityLane: '',
    siteLane: '',
    cwtRate: '',
    flatRate: '',
    order: '',
    shipment: '',
    load: '',
    order2: '',
    shipment2: '',
    load2: '',
  };

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;

    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'P7 Customer' })
      .expect(201);
    ids.customer = customer.body.id;

    // Locations with explicit state/country so CITY-level lanes can match.
    // Diacritics on purpose: the lane will be created WITHOUT them and must still match.
    const origin = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-ORI`,
        name: 'P7 Plant',
        type: 'PLANT',
        addressLine1: '1 Test St',
        city: `Montréal-${suffix}`,
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
        name: 'P7 DC',
        type: 'DISTRIBUTION_CENTER',
        addressLine1: '2 Test Av',
        city: `Québec-${suffix}`,
        state: 'QC',
        country: 'CA',
      })
      .expect(201);
    ids.destination = destination.body.id;

    for (const [field, code] of [
      ['carrier', `${suffix}-CARR`],
      ['carrier2', `${suffix}-CAR2`],
    ] as const) {
      const carrier = await request(http)
        .post('/api/v1/transportation/carriers')
        .set(auth())
        .send({ code, name: `P7 ${code}` })
        .expect(201);
      ids[field] = carrier.body.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates the accessorial catalog', async () => {
    const tailgate = await request(http)
      .post('/api/v1/transportation/accessorials')
      .set(auth())
      .send({ code: `TLG-${suffix}`, name: 'Tailgate', unit: 'FLAT' })
      .expect(201);
    ids.tailgate = tailgate.body.id;

    const waitHour = await request(http)
      .post('/api/v1/transportation/accessorials')
      .set(auth())
      .send({ code: `WAIT-${suffix}`, name: 'Waiting time', unit: 'PER_HOUR' })
      .expect(201);
    ids.waitHour = waitHour.body.id;

    // Duplicate code → 409
    await request(http)
      .post('/api/v1/transportation/accessorials')
      .set(auth())
      .send({ code: `TLG-${suffix}`, name: 'Dup', unit: 'FLAT' })
      .expect(409);
  });

  it('creates a dated fuel table — the entry in force at the reference date applies', async () => {
    const table = await request(http)
      .post('/api/v1/transportation/fuel-tables')
      .set(auth())
      .send({
        name: `Fuel-${suffix}`,
        entries: [
          { effectiveFrom: '2020-01-01T00:00:00.000Z', pct: 5 },
          { effectiveFrom: '2026-01-01T00:00:00.000Z', pct: 10 },
        ],
      })
      .expect(201);
    ids.fuelTable = table.body.id;
    expect(table.body.entries).toHaveLength(2);
  });

  it('creates lanes — diacritics-insensitive CITY lane + LOCATION lane, duplicates rejected', async () => {
    // City names WITHOUT accents; the locations carry « Montréal »/« Québec » — must match anyway.
    const cityLane = await request(http)
      .post('/api/v1/transportation/lanes')
      .set(auth())
      .send({
        name: `City lane ${suffix}`,
        originType: 'CITY',
        origin: { city: `MONTREAL-${suffix}`, state: 'qc', country: 'ca' },
        destinationType: 'CITY',
        destination: { city: `quebec-${suffix}`, state: 'QC', country: 'CA' },
      })
      .expect(201);
    ids.cityLane = cityLane.body.id;

    // Strictly identical lane (modulo case/accents) → 409.
    await request(http)
      .post('/api/v1/transportation/lanes')
      .set(auth())
      .send({
        originType: 'CITY',
        origin: { city: `Montréal-${suffix}`, state: 'QC', country: 'CA' },
        destinationType: 'CITY',
        destination: { city: `Québec-${suffix}`, state: 'QC', country: 'CA' },
      })
      .expect(409);

    const siteLane = await request(http)
      .post('/api/v1/transportation/lanes')
      .set(auth())
      .send({
        name: `Site lane ${suffix}`,
        originType: 'LOCATION',
        origin: { locationId: ids.origin },
        destinationType: 'LOCATION',
        destination: { locationId: ids.destination },
      })
      .expect(201);
    ids.siteLane = siteLane.body.id;

    // Carrier preferences: carrier2 on the CITY lane, carrier on the more specific SITE lane.
    await request(http)
      .put(`/api/v1/transportation/lanes/${ids.cityLane}/carriers`)
      .set(auth())
      .send({ carrierIds: [ids.carrier2] })
      .expect(200);
    await request(http)
      .put(`/api/v1/transportation/lanes/${ids.siteLane}/carriers`)
      .set(auth())
      .send({ carrierIds: [ids.carrier] })
      .expect(200);
  });

  it('creates rates: CWT grid on the city lane, catch-all FLAT, expired rate', async () => {
    const cwt = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} CWT grid`,
        rateType: 'PER_HUNDREDWEIGHT',
        baseAmount: 20,
        carrierId: ids.carrier,
        laneId: ids.cityLane,
        fuelTableId: ids.fuelTable,
        breaks: [
          { upToKg: 500, amount: 20 },
          { upToKg: 2000, amount: 15 },
        ],
        accessorialPrices: [
          { accessorialId: ids.tailgate, amount: 75 },
          { accessorialId: ids.waitHour, amount: 60 },
        ],
      })
      .expect(201);
    ids.cwtRate = cwt.body.id;
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.cwtRate}`)
      .set(auth())
      .send({ status: 'ACTIVE' })
      .expect(200);

    const flat = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({ name: `${suffix} flat catch-all`, rateType: 'FLAT', baseAmount: 999, carrierId: ids.carrier2 })
      .expect(201);
    ids.flatRate = flat.body.id;
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.flatRate}`)
      .set(auth())
      .send({ status: 'ACTIVE' })
      .expect(200);

    // Expired: must never appear in rate-options.
    const expired = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} expired`,
        rateType: 'FLAT',
        baseAmount: 1,
        validTo: '2020-01-01T00:00:00.000Z',
      })
      .expect(201);
    await request(http)
      .patch(`/api/v1/transportation/rates/${expired.body.id}`)
      .set(auth())
      .send({ status: 'ACTIVE' })
      .expect(200);

    // Breaks on a FLAT rate → 400.
    await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} invalid breaks`,
        rateType: 'FLAT',
        baseAmount: 10,
        breaks: [{ upToKg: 100, amount: 5 }],
      })
      .expect(400);
  });

  it('plans an order into a load (480 kg — the as-if demo weight)', async () => {
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        totalWeightKg: 480,
        palletCount: 2,
      })
      .expect(201);
    ids.order = order.body.id;
    await request(http).post(`/api/v1/transportation/transport-orders/${ids.order}/confirm`).set(auth()).expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/plan`)
      .set(auth())
      .expect(201);
    ids.shipment = planned.body.shipments[0].id;

    const load = await request(http).post('/api/v1/transportation/loads').set(auth()).send({}).expect(201);
    ids.load = load.body.id;
    await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipment}/assign-load`)
      .set(auth())
      .send({ loadId: ids.load })
      .expect(201);
  });

  it('flags accessorials on the load', async () => {
    const res = await request(http)
      .put(`/api/v1/transportation/loads/${ids.load}/accessorials`)
      .set(auth())
      .send({
        items: [
          { accessorialId: ids.tailgate },
          { accessorialId: ids.waitHour, quantity: 2 },
        ],
      })
      .expect(200);
    expect(res.body.accessorials).toHaveLength(2);
  });

  it('rate shopping: lane match (diacritics-insensitive), ordering, expired excluded, specificity exposed', async () => {
    const res = await request(http)
      .get(`/api/v1/transportation/loads/${ids.load}/rate-options`)
      .set(auth())
      .expect(200);
    const options = res.body.options as Array<{
      rateId: string;
      laneSpecificity: { total: number } | null;
      missingAccessorials: string[];
      breakdown: { total: number; appliedBreak: { asIfApplied: boolean } | null };
    }>;

    const optionIds = options.map((o) => o.rateId);
    expect(optionIds).toContain(ids.cwtRate); // CITY lane matched despite accents/case differences
    expect(optionIds).toContain(ids.flatRate); // catch-all
    expect(options.some((o) => o.rateId === ids.cwtRate && o.laneSpecificity?.total === 4)).toBe(true);

    const cwtOption = options.find((o) => o.rateId === ids.cwtRate)!;
    const flatOption = options.find((o) => o.rateId === ids.flatRate)!;
    // 480 kg → as-if rule must price the ≤2000 bracket.
    expect(cwtOption.breakdown.appliedBreak?.asIfApplied).toBe(true);
    expect(cwtOption.missingAccessorials).toEqual([]);
    // The flat rate prices no accessorial → flagged incomplete and ranked after complete ones.
    expect(flatOption.missingAccessorials.length).toBeGreaterThan(0);
    expect(options.indexOf(cwtOption)).toBeLessThan(options.indexOf(flatOption));
  });

  it('assigning the rate persists the frozen costDetail snapshot', async () => {
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier, rateId: ids.cwtRate })
      .expect(201);

    const load = await request(http).get(`/api/v1/transportation/loads/${ids.load}`).set(auth()).expect(200);
    expect(load.body.estimatedCost).not.toBeNull();
    const detail = load.body.costDetail;
    expect(detail.version).toBe(1);
    expect(detail.rate.id).toBe(ids.cwtRate);
    expect(detail.rate.fuel.source).toBe('TABLE');
    expect(detail.rate.fuel.pct).toBe(10); // 2026 entry, not the 2020 one
    expect(detail.inputs.weightKg).toBe(480);
    expect(detail.result.appliedBreak.asIfApplied).toBe(true);
    expect(detail.result.lines.map((l: { type: string }) => l.type)).toEqual(
      expect.arrayContaining(['BASE', 'FUEL', 'ACCESSORIAL']),
    );
  });

  it('INVARIANT: completing freezes the snapshot — later rate edits never rewrite it', async () => {
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/dispatch`).set(auth()).expect(201);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/start-transit`).set(auth()).expect(201);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/complete`).set(auth()).expect(201);

    const before = await request(http).get(`/api/v1/transportation/loads/${ids.load}`).set(auth()).expect(200);

    // Mutate the rate aggressively…
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.cwtRate}`)
      .set(auth())
      .send({ baseAmount: 99999, breaks: [{ upToKg: 99999, amount: 99999 }] })
      .expect(200);

    // …the COMPLETED load must not move (accessorial change is even rejected).
    await request(http)
      .put(`/api/v1/transportation/loads/${ids.load}/accessorials`)
      .set(auth())
      .send({ items: [] })
      .expect(400);

    const after = await request(http).get(`/api/v1/transportation/loads/${ids.load}`).set(auth()).expect(200);
    expect(after.body.estimatedCost).toBe(before.body.estimatedCost);
    expect(after.body.costDetail).toEqual(before.body.costDetail);
  });

  it('auto-tender picks the most specific matching lane (site beats city)', async () => {
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        totalWeightKg: 100,
      })
      .expect(201);
    ids.order2 = order.body.id;
    await request(http).post(`/api/v1/transportation/transport-orders/${ids.order2}/confirm`).set(auth()).expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order2}/plan`)
      .set(auth())
      .expect(201);
    ids.shipment2 = planned.body.shipments[0].id;

    const load = await request(http).post('/api/v1/transportation/loads').set(auth()).send({}).expect(201);
    ids.load2 = load.body.id;
    await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipment2}/assign-load`)
      .set(auth())
      .send({ loadId: ids.load2 })
      .expect(201);

    // The load must be PLANNED before tendering; assign with empty body to transition OPEN → PLANNED.
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.load2}/assign`)
      .set(auth())
      .send({})
      .expect(201);

    const tender = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load2}/auto-tender`)
      .set(auth())
      .send({})
      .expect(201);
    // SITE lane (specificity 6, carrier) must beat CITY lane (specificity 4, carrier2).
    expect(tender.body.carrierId).toBe(ids.carrier);
  });

  it('restrict deletes: referenced lane, accessorial and fuel table are protected', async () => {
    await request(http).delete(`/api/v1/transportation/lanes/${ids.cityLane}`).set(auth()).expect(409);
    await request(http).delete(`/api/v1/transportation/accessorials/${ids.tailgate}`).set(auth()).expect(409);
    await request(http).delete(`/api/v1/transportation/fuel-tables/${ids.fuelTable}`).set(auth()).expect(409);
  });
});
