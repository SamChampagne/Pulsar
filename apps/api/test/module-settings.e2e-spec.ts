// apps/api/test/module-settings.e2e-spec.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

describe('Module settings (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.listen(0);
    http = app.getHttpServer();
    app.get(PrismaService);
    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('GET returns descriptors + resolved default values', async () => {
    const res = await request(http).get('/api/v1/modules/procurement/settings').set(auth()).expect(200);
    const body = res.body as { descriptors: Array<{ key: string }>; values: Record<string, unknown> };
    expect(body.descriptors.some((d) => d.key === 'bidUniqueness')).toBe(true);
    expect(body.values.bidUniqueness).toBe('MULTIPLE');
  });

  it('PUT persists a valid value and GET reflects it', async () => {
    await request(http).put('/api/v1/modules/procurement/settings').set(auth())
      .send({ settings: { bidUniqueness: 'SINGLE' } }).expect(200);
    const res = await request(http).get('/api/v1/modules/procurement/settings').set(auth()).expect(200);
    expect((res.body as { values: Record<string, unknown> }).values.bidUniqueness).toBe('SINGLE');
    // reset to default for other suites
    await request(http).put('/api/v1/modules/procurement/settings').set(auth())
      .send({ settings: { bidUniqueness: 'MULTIPLE' } }).expect(200);
  });

  it('PUT rejects an unknown key (400)', async () => {
    await request(http).put('/api/v1/modules/procurement/settings').set(auth())
      .send({ settings: { evil: 1 } }).expect(400);
  });

  // ---------------------------------------------------------------------------
  // connect is a core sub-feature with NO moduleDefinition row of its own.
  // Settings must be stored under the 'core' TenantModule row and survive a
  // round-trip (PUT → GET). This was broken before: update() threw 404 because
  // moduleIdOrThrow('connect') found no definition row.
  // ---------------------------------------------------------------------------
  it('PUT /modules/connect/settings persists csvNumberLocale and GET reflects it', async () => {
    await request(http)
      .put('/api/v1/modules/connect/settings')
      .set(auth())
      .send({ settings: { csvNumberLocale: 'FR' } })
      .expect(200);

    const res = await request(http)
      .get('/api/v1/modules/connect/settings')
      .set(auth())
      .expect(200);

    expect((res.body as { values: Record<string, unknown> }).values.csvNumberLocale).toBe('FR');

    // Reset to default so other suites are unaffected
    await request(http)
      .put('/api/v1/modules/connect/settings')
      .set(auth())
      .send({ settings: { csvNumberLocale: 'EN' } })
      .expect(200);
  });

  // ---------------------------------------------------------------------------
  // Behavior test: bidUniqueness=SINGLE replaces the previous non-terminal bid
  // for the same (rfpLane, carrier) instead of stacking them.
  // ---------------------------------------------------------------------------
  describe('bidUniqueness=SINGLE behavior', () => {
    let prisma: PrismaService;
    let tenantId = '';
    let carrierId = '';
    let rfpId = '';
    let rfpLaneId = '';
    let inviteToken = '';
    const suffix = `${Date.now()}-settings`;

    beforeAll(async () => {
      prisma = app.get(PrismaService);

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
      tenantId = tenant.id;

      // Ensure PROCUREMENT module is enabled.
      const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'procurement' } });
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
        update: { enabled: true },
        create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
      });

      // Set bidUniqueness=SINGLE
      await request(http)
        .put('/api/v1/modules/procurement/settings')
        .set(auth())
        .send({ settings: { bidUniqueness: 'SINGLE' } })
        .expect(200);

      // Create a carrier for this test
      const carrier = await prisma.carrier.create({
        data: { tenantId, code: `SINGLE-CARR-${suffix}`, name: `Single Bid Carrier ${suffix}` },
      });
      carrierId = carrier.id;

      // Pick one seeded lane
      const lane = await prisma.lane.findFirst({ where: { tenantId }, select: { id: true } });
      expect(lane).toBeTruthy();
      const laneId = lane!.id;

      // Create an RFP
      const rfpRes = await request(http)
        .post('/api/v1/procurement/rfps')
        .set(auth())
        .send({ title: `SINGLE Bid E2E ${suffix}` })
        .expect(201);
      rfpId = (rfpRes.body as { id: string }).id;

      // Add the lane
      const laneRes = await request(http)
        .post(`/api/v1/procurement/rfps/${rfpId}/lanes`)
        .set(auth())
        .send({ laneId })
        .expect(201);
      rfpLaneId = (laneRes.body as { id: string }).id;

      // Invite the carrier
      const invRes = await request(http)
        .post(`/api/v1/procurement/rfps/${rfpId}/invites`)
        .set(auth())
        .send({ carrierId })
        .expect(201);
      inviteToken = (invRes.body as { token: string }).token;

      // Open the RFP
      await request(http)
        .post(`/api/v1/procurement/rfps/${rfpId}/open`)
        .set(auth())
        .expect(200);
    });

    afterAll(async () => {
      // Reset bidUniqueness to default MULTIPLE so other suites are unaffected
      await request(http)
        .put('/api/v1/modules/procurement/settings')
        .set(auth())
        .send({ settings: { bidUniqueness: 'MULTIPLE' } })
        .expect(200);

      // Cleanup
      if (rfpId) await prisma.rfp.deleteMany({ where: { id: rfpId } }).catch(() => undefined);
      if (carrierId) await prisma.carrier.deleteMany({ where: { id: carrierId } }).catch(() => undefined);
    });

    it('submitting two bids for the same (lane, carrier) leaves exactly ONE non-terminal bid when SINGLE', async () => {
      // First bid
      await request(http)
        .post(`/api/v1/public/rfp-invites/${inviteToken}/bids`)
        .send({ rfpLaneId, rateType: 'FLAT', amount: 1000 })
        .expect((r) => expect([200, 201]).toContain(r.status));

      // Second bid — should replace the first under SINGLE mode
      await request(http)
        .post(`/api/v1/public/rfp-invites/${inviteToken}/bids`)
        .send({ rfpLaneId, rateType: 'FLAT', amount: 900 })
        .expect((r) => expect([200, 201]).toContain(r.status));

      // Assert exactly ONE non-terminal bid remains
      const count = await prisma.bid.count({
        where: {
          rfpLaneId,
          status: { in: ['SUBMITTED', 'SHORTLISTED'] },
        },
      });
      expect(count).toBe(1);
    });
  });
});
