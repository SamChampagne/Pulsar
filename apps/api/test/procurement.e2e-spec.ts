/**
 * E2E procurement (RFP → bids → award) over real Postgres with the admin Bearer token.
 *
 * Regression coverage for the stabilization fixes:
 *   S1  pagination       GET /procurement/rfps?page&pageSize&q returns 200 (the inline
 *                        query DTO used to reject these → 400).
 *   S2  CUID ids         add-lane / invite / submit-bid / award accept CUID ids (they were
 *                        validated with @IsUUID() → the whole flow 400'd on real ids).
 *   S3  detail shape     GET /procurement/rfps/:id returns the flat contract the web reads:
 *                        rfpLanes[].lane, bids[].carrier, awards[].carrier (used to crash
 *                        the page on undefined.length / missing nested objects).
 *   S4  award flow       award accepts the bid; re-awarding a lane demotes the previous
 *                        winner to REJECTED (never two ACCEPTED bids on one lane); award is
 *                        only allowed while the RFP is in EVALUATION.
 *
 * Permission procurement.read|manage, module PROCUREMENT (enabled for acme in beforeAll).
 * Prerequisites: reachable PostgreSQL with the seed applied (provides lanes).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

describe('Procurement RFP → bids → award (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  let carrierId = '';
  let lane1Id = '';
  let lane2Id = '';

  // Created by the flow (cleaned up in afterAll — RFP delete cascades lanes/invites/bids/awards).
  let rfpId = '';
  let rfpLane1Id = '';
  let rfpLane2Id = '';
  let inviteToken = '';
  let bidAId = '';
  let bidBId = '';
  let bidCId = '';

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

    // Ensure PROCUREMENT is enabled for acme.
    const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'procurement' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      update: { enabled: true },
      create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });

    // Own carrier (cleaned up).
    const carrier = await prisma.carrier.create({
      data: { tenantId, code: `PRC-CARR-${suffix}`, name: `Procurement Test Carrier ${suffix}` },
    });
    carrierId = carrier.id;

    // Two seeded lanes (read-only references).
    const lanes = await prisma.lane.findMany({ where: { tenantId }, take: 2, select: { id: true } });
    expect(lanes.length).toBe(2);
    lane1Id = lanes[0].id;
    lane2Id = lanes[1].id;
  });

  afterAll(async () => {
    if (prisma) {
      if (rfpId) await prisma.rfp.deleteMany({ where: { id: rfpId } }).catch(() => undefined);
      if (carrierId)
        await prisma.carrier.deleteMany({ where: { id: carrierId } }).catch(() => undefined);
    }
    await app.close();
  });

  // ===========================================================================
  // S1 — pagination params accepted (regression: inline DTO rejected them → 400).
  // ===========================================================================
  it('S1: GET /procurement/rfps?page&pageSize&q returns 200', async () => {
    const res = await request(http)
      .get('/api/v1/procurement/rfps?page=1&pageSize=5&q=zzz-no-match')
      .set(auth())
      .expect(200);
    const body = res.body as { items: unknown[]; total: number; page: number; pageSize: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(5);
  });

  // ===========================================================================
  // S2 — full setup with CUID ids (regression: @IsUUID() 400'd on real CUID ids).
  // ===========================================================================
  it('S2: create RFP, add two lanes, invite carrier (all accept CUID ids)', async () => {
    const rfp = await request(http)
      .post('/api/v1/procurement/rfps')
      .set(auth())
      .send({ title: `E2E RFP ${suffix}` })
      .expect(201);
    rfpId = (rfp.body as { id: string }).id;
    expect(rfpId).toBeTruthy();

    const l1 = await request(http)
      .post(`/api/v1/procurement/rfps/${rfpId}/lanes`)
      .set(auth())
      .send({ laneId: lane1Id })
      .expect(201);
    rfpLane1Id = (l1.body as { id: string }).id;

    const l2 = await request(http)
      .post(`/api/v1/procurement/rfps/${rfpId}/lanes`)
      .set(auth())
      .send({ laneId: lane2Id })
      .expect(201);
    rfpLane2Id = (l2.body as { id: string }).id;

    const inv = await request(http)
      .post(`/api/v1/procurement/rfps/${rfpId}/invites`)
      .set(auth())
      .send({ carrierId })
      .expect(201);
    inviteToken = (inv.body as { token: string }).token;
    expect(inviteToken).toBeTruthy();
  });

  // ===========================================================================
  // S3 — open, submit bids (public token), move to evaluation.
  // ===========================================================================
  it('S3: open RFP, submit three bids via the public token, move to evaluation', async () => {
    await request(http).post(`/api/v1/procurement/rfps/${rfpId}/open`).set(auth()).expect(200);

    // Bids require the RFP to be OPEN. Two bids on lane1 (for the re-award demotion),
    // one on lane2.
    for (const body of [
      { rfpLaneId: rfpLane1Id, rateType: 'FLAT', amount: 1000 },
      { rfpLaneId: rfpLane1Id, rateType: 'FLAT', amount: 900 },
      { rfpLaneId: rfpLane2Id, rateType: 'FLAT', amount: 1200 },
    ]) {
      await request(http)
        .post(`/api/v1/public/rfp-invites/${inviteToken}/bids`)
        .send(body)
        .expect((r) => expect([200, 201]).toContain(r.status));
    }

    // A bad rateType is rejected up-front (regression: was @IsString → accepted).
    await request(http)
      .post(`/api/v1/public/rfp-invites/${inviteToken}/bids`)
      .send({ rfpLaneId: rfpLane1Id, rateType: 'NOT_A_RATE', amount: 1 })
      .expect(400);

    await request(http)
      .post(`/api/v1/procurement/rfps/${rfpId}/evaluation`)
      .set(auth())
      .expect(200);
  });

  // ===========================================================================
  // S4 — detail shape (regression: page crashed on undefined.length / nested objects).
  // ===========================================================================
  it('S4: GET /procurement/rfps/:id returns the flat web contract with nested lane/carrier', async () => {
    const res = await request(http)
      .get(`/api/v1/procurement/rfps/${rfpId}`)
      .set(auth())
      .expect(200);
    const rfp = res.body as {
      rfpLanes: Array<{ id: string; lane: { id: string } | null }>;
      invites: Array<{ carrier: { id: string } | null }>;
      bids: Array<{ id: string; rfpLaneId: string; status: string; carrier: { id: string } | null }>;
      awards: unknown[];
    };
    expect(rfp.rfpLanes).toHaveLength(2);
    expect(rfp.rfpLanes.every((l) => l.lane && l.lane.id)).toBe(true);
    expect(rfp.bids).toHaveLength(3);
    expect(rfp.bids.every((b) => b.carrier && b.carrier.id === carrierId)).toBe(true);
    expect(rfp.invites.every((i) => i.carrier && i.carrier.id === carrierId)).toBe(true);
    expect(Array.isArray(rfp.awards)).toBe(true);

    const lane1Bids = rfp.bids.filter((b) => b.rfpLaneId === rfpLane1Id);
    bidAId = lane1Bids[0].id;
    bidBId = lane1Bids[1].id;
    bidCId = rfp.bids.find((b) => b.rfpLaneId === rfpLane2Id)!.id;
  });

  // ===========================================================================
  // S5 — award + re-award demotion (never two ACCEPTED bids on one lane).
  // ===========================================================================
  it('S5: award lane1, then re-award demotes the previous winner to REJECTED', async () => {
    await request(http)
      .post(`/api/v1/procurement/rfps/${rfpId}/award`)
      .set(auth())
      .send({ rfpLaneId: rfpLane1Id, bidId: bidAId })
      .expect((r) => expect([200, 201]).toContain(r.status));

    // Re-award the same lane to the other bid — RFP stays EVALUATION (lane2 unawarded).
    await request(http)
      .post(`/api/v1/procurement/rfps/${rfpId}/award`)
      .set(auth())
      .send({ rfpLaneId: rfpLane1Id, bidId: bidBId })
      .expect((r) => expect([200, 201]).toContain(r.status));

    const bids = await prisma.bid.findMany({
      where: { rfpLaneId: rfpLane1Id },
      select: { id: true, status: true },
    });
    const accepted = bids.filter((b) => b.status === 'ACCEPTED');
    expect(accepted).toHaveLength(1);
    expect(accepted[0].id).toBe(bidBId);
    expect(bids.find((b) => b.id === bidAId)!.status).toBe('REJECTED');
  });

  // ===========================================================================
  // S6 — awarding the final lane closes the RFP; further awards are blocked.
  // ===========================================================================
  it('S6: awarding the last lane transitions RFP to AWARDED; further award is rejected', async () => {
    await request(http)
      .post(`/api/v1/procurement/rfps/${rfpId}/award`)
      .set(auth())
      .send({ rfpLaneId: rfpLane2Id, bidId: bidCId })
      .expect((r) => expect([200, 201]).toContain(r.status));

    const rfp = await prisma.rfp.findUniqueOrThrow({ where: { id: rfpId }, select: { status: true } });
    expect(rfp.status).toBe('AWARDED');

    // RFP is no longer in EVALUATION → award is rejected (400).
    await request(http)
      .post(`/api/v1/procurement/rfps/${rfpId}/award`)
      .set(auth())
      .send({ rfpLaneId: rfpLane1Id, bidId: bidAId })
      .expect(400);
  });
});
