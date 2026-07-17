/**
 * E2E — a tender's offered amount is IMMUTABLE once sent.
 *
 * When a load is tendered, the offered rate/currency is snapshotted onto the Tender
 * (offeredAmount/offeredCurrency) from Load.estimatedCost/costCurrency. The carrier-facing
 * projection reads that snapshot, so a later recompute of the load cost must NOT change an
 * offer already sent. This proves rule 16's spirit for the carrier offer.
 *
 * Prerequisites: reachable PostgreSQL with seed applied (admin@pulsar.dev / admin123, tenant acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const uniq = () => Math.random().toString(36).slice(2, 10);
const tokenFromUrl = (url: string) => url.split('/tender/')[1];

describe('Tender offer snapshot immutability (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: string;
  let tenantId: string;
  let carrierId: string;
  let loadId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(200);
    jwt = login.body.accessToken;

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    const carrier = await prisma.carrier.create({
      data: { tenantId, code: `TSNAP-${uniq()}`, name: 'Snapshot Carrier', email: 'snap@example.com' },
    });
    carrierId = carrier.id;

    // A PLANNED load carrying a frozen buy-side cost, ready to tender.
    const load = await prisma.load.create({
      data: {
        tenantId,
        loadNumber: `LD-SNAP-${uniq()}`,
        status: 'PLANNED',
        carrierId,
        estimatedCost: 1000.0,
        costCurrency: 'CAD',
      },
    });
    loadId = load.id;
  });

  afterAll(async () => {
    // FK-safe cleanup — tenders cascade on load delete, but delete explicitly to be safe.
    await prisma.tender.deleteMany({ where: { loadId } });
    await prisma.load.deleteMany({ where: { id: loadId } });
    await prisma.carrier.deleteMany({ where: { id: carrierId } });
    await app.close();
  });

  const srv = () => app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${jwt}` });

  it('snapshots the offered amount at send time and never changes it on a later recompute', async () => {
    const tender = await request(srv())
      .post(`/api/v1/transportation/loads/${loadId}/tender`)
      .set(auth())
      .send({ carrierId, message: 'Snapshot test' })
      .expect(201);
    const token = tokenFromUrl(tender.body.responseUrl);
    expect(token).toBeTruthy();

    // The offer the carrier sees reflects the load cost at send time.
    const before = await request(srv()).get(`/api/v1/public/tenders/${token}`).expect(200);
    expect(before.body.offeredRate).toBe(1000);
    expect(before.body.offeredCurrency).toBe('CAD');

    // The Tender row itself carries the frozen snapshot.
    const row = await prisma.tender.findFirstOrThrow({ where: { loadId } });
    expect(Number(row.offeredAmount)).toBe(1000);
    expect(row.offeredCurrency).toBe('CAD');

    // Simulate a later recompute of the load cost (e.g. shipment mix / rate change).
    await prisma.load.update({
      where: { id: loadId },
      data: { estimatedCost: 9999.0, costCurrency: 'USD' },
    });

    // The already-sent offer is UNCHANGED — the projection reads the snapshot, not the live cost.
    const after = await request(srv()).get(`/api/v1/public/tenders/${token}`).expect(200);
    expect(after.body.offeredRate).toBe(1000);
    expect(after.body.offeredCurrency).toBe('CAD');
  });
});
