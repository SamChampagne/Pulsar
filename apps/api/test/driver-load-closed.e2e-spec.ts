/**
 * E2E — the public driver link must not mutate a CLOSED load.
 *
 * A COMPLETED (or CANCELLED) load is terminal in the load state machine (rule 2). Stop status
 * updates and POD creation from the driver link must be refused server-side (400), the state
 * machine being the source of truth. Regression for "load COMPLETED but a stop stayed editable".
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

describe('Driver link on a closed load (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let completedToken: string;
  let activeToken: string;
  const loadIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    completedToken = randomBytes(24).toString('base64url');
    activeToken = randomBytes(24).toString('base64url');

    const completed = await prisma.load.create({
      data: { tenantId, loadNumber: `LD-CLOSED-${uniq()}`, status: 'COMPLETED', driverToken: completedToken },
    });
    const active = await prisma.load.create({
      data: { tenantId, loadNumber: `LD-ACTIVE-${uniq()}`, status: 'DISPATCHED', driverToken: activeToken },
    });
    loadIds.push(completed.id, active.id);
  });

  afterAll(async () => {
    await prisma.load.deleteMany({ where: { id: { in: loadIds } } });
    await app.close();
  });

  const srv = () => app.getHttpServer();

  it('rejects a driver stop update on a COMPLETED load (400)', async () => {
    // The guard runs before the stop lookup, so any stop id exercises it.
    const res = await request(srv())
      .post(`/api/v1/public/driver/${completedToken}/stops/any-stop-id/status`)
      .send({ status: 'ARRIVED' })
      .expect(400);
    expect(String(res.body.message)).toContain('closed');
  });

  it('rejects driver POD creation on a COMPLETED load (400)', async () => {
    await request(srv())
      .post(`/api/v1/public/driver/${completedToken}/pod`)
      .send({ shipmentId: 'any-shipment-id' })
      .expect(400);
  });

  it('still reaches the stop lookup on an active load (404 for a bogus stop, not the closed-load 400)', async () => {
    // On a DISPATCHED load the guard passes; the unknown stop id yields a 404 instead.
    await request(srv())
      .post(`/api/v1/public/driver/${activeToken}/stops/bogus-stop/status`)
      .send({ status: 'ARRIVED' })
      .expect(404);
  });
});
