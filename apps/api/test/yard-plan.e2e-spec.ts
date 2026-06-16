/**
 * E2E yard-plan (Yard Plan v2, Task 4) — proves the two server-side additions the
 * 2D yard plan leans on, over real Postgres with the admin Bearer token (acme):
 *
 *   1. Layout persists: PUT /yard/spots/layout writes display-only posX/posY for
 *      each spot, and the board surfaces them back (DOOR-1 at 0,0; P-1 at 1,0).
 *   2. Tenant-scoped, race-tolerant: PUT /yard/spots/layout with an unknown id is
 *      a no-op 200 (updateMany is scoped by tenantId — nothing changes, no throw),
 *      and our DOOR-1 keeps its coordinates.
 *   3. Visit move log: check-in → assign(DOOR-1) → move(P-1); GET /yard/visits/:id
 *      returns a `moves` array (len >= 2), ordered by movedAt asc, with the first
 *      hop to DOOR-1 and a later hop to P-1.
 *   4. Module gating: covered structurally by @RequireModule(YARD) (toggle skipped
 *      to keep the shared DB stable — same convention as the yard-module suite).
 *
 * posX/posY are display-only (rule 34): they never touch occupancy/assignment.
 *
 * Permissions yard.read / yard.manage, module YARD (+ TRANSPORTATION for the site
 * Location). Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

interface BoardSpot {
  id: string;
  code: string;
  type: string;
  posX: number | null;
  posY: number | null;
  occupyingVisit: { id: string } | null;
}
interface Board {
  spots: BoardSpot[];
  unassigned: Array<{ id: string }>;
}
interface VisitMove {
  movedAt: string;
  fromSpot: { code: string } | null;
  toSpot: { code: string } | null;
}
interface VisitDetail {
  id: string;
  status: string;
  moves: VisitMove[];
}

describe('Yard plan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Created fixtures (cleaned up in afterAll).
  let locationId = '';
  let doorId = '';
  let parkingId = '';
  let visitId = '';

  // The spot on the board, located by our created id (filters out shared-DB noise).
  const boardSpot = (board: Board, id: string) => board.spots.find((s) => s.id === id);

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

    // --- Ensure YARD (and TRANSPORTATION for the Location) enabled. -----------
    for (const key of ['yard', 'transportation']) {
      const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
        update: { enabled: true },
        create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
      });
    }

    // --- Create one site (Location) for the yard. -----------------------------
    const loc = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `YPLAN-${suffix}`,
        name: `Yard Plan Site ${suffix}`,
        type: 'DISTRIBUTION_CENTER',
        addressLine1: '1 Plan Way',
        city: 'Trois-Rivières',
        country: 'CA',
      })
      .expect(201);
    locationId = (loc.body as { id: string }).id;

    // --- Create two spots: a DOCK_DOOR (DOOR-1) and a PARKING (P-1). ----------
    const door = await request(http)
      .post('/api/v1/yard/spots')
      .set(auth())
      .send({ locationId, code: `DOOR-1`, type: 'DOCK_DOOR' })
      .expect(201);
    doorId = (door.body as { id: string }).id;

    const parking = await request(http)
      .post('/api/v1/yard/spots')
      .set(auth())
      .send({ locationId, code: `P-1`, type: 'PARKING' })
      .expect(201);
    parkingId = (parking.body as { id: string }).id;
  });

  afterAll(async () => {
    if (prisma) {
      // YardMove cascades on visit delete; drop children before the location.
      await prisma.yardVisit
        .deleteMany({ where: { tenantId, spotId: { in: [doorId, parkingId] } } })
        .catch(() => undefined);
      if (visitId) {
        await prisma.yardVisit.deleteMany({ where: { id: visitId } }).catch(() => undefined);
      }
      await prisma.yardSpot
        .deleteMany({ where: { id: { in: [doorId, parkingId] } } })
        .catch(() => undefined);
      await prisma.location.deleteMany({ where: { id: locationId } }).catch(() => undefined);
    }
    await app.close();
  });

  // =========================================================================
  // 1 — Layout persists: PUT /yard/spots/layout writes posX/posY, board reflects.
  // =========================================================================
  it('PUT /yard/spots/layout persists posX/posY and the board reflects them', async () => {
    await request(http)
      .put('/api/v1/yard/spots/layout')
      .set(auth())
      .send({
        positions: [
          { id: doorId, posX: 0, posY: 0 },
          { id: parkingId, posX: 1, posY: 0 },
        ],
      })
      .expect(200);

    const board = await request(http)
      .get(`/api/v1/yard/board?locationId=${locationId}`)
      .set(auth())
      .expect(200);

    const door = boardSpot(board.body as Board, doorId);
    const parking = boardSpot(board.body as Board, parkingId);
    expect(door?.posX).toBe(0);
    expect(door?.posY).toBe(0);
    expect(parking?.posX).toBe(1);
    expect(parking?.posY).toBe(0);
  });

  // =========================================================================
  // 2 — Tenant-scoped + race-tolerant: unknown id is a no-op 200, DOOR-1 stays.
  // =========================================================================
  it('PUT /yard/spots/layout with an unknown id is a scoped no-op (200, nothing changes)', async () => {
    await request(http)
      .put('/api/v1/yard/spots/layout')
      .set(auth())
      .send({ positions: [{ id: 'nonexistent-id-xyz', posX: 5, posY: 5 }] })
      .expect(200);

    const board = await request(http)
      .get(`/api/v1/yard/board?locationId=${locationId}`)
      .set(auth())
      .expect(200);
    const door = boardSpot(board.body as Board, doorId);
    // Our DOOR-1 is untouched (the bogus row could not match any of our spots).
    expect(door?.posX).toBe(0);
    expect(door?.posY).toBe(0);
  });

  // =========================================================================
  // 3 — Visit move log: check-in → assign(DOOR-1) → move(P-1); detail has moves.
  // =========================================================================
  it('the visit detail includes an ordered move log (assign then move)', async () => {
    const created = await request(http)
      .post('/api/v1/yard/visits')
      .set(auth())
      .send({ locationId, trailerRef: 'PLAN-T1', direction: 'INBOUND' })
      .expect(201);
    visitId = (created.body as { id: string }).id;

    await request(http)
      .post(`/api/v1/yard/visits/${visitId}/assign`)
      .set(auth())
      .send({ spotId: doorId })
      .expect((r) => expect([200, 201]).toContain(r.status));

    await request(http)
      .post(`/api/v1/yard/visits/${visitId}/move`)
      .set(auth())
      .send({ spotId: parkingId })
      .expect((r) => expect([200, 201]).toContain(r.status));

    const get = await request(http)
      .get(`/api/v1/yard/visits/${visitId}`)
      .set(auth())
      .expect(200);
    const visit = get.body as VisitDetail;

    expect(Array.isArray(visit.moves)).toBe(true);
    expect(visit.moves.length).toBeGreaterThanOrEqual(2);

    // Ordered movedAt asc: the assign hop (→ DOOR-1) precedes the move hop (→ P-1).
    const targets = visit.moves.map((m) => m.toSpot?.code ?? null);
    expect(targets).toContain('P-1');
    const firstDoor = targets.indexOf('DOOR-1');
    const lastParking = targets.lastIndexOf('P-1');
    expect(firstDoor).toBeGreaterThanOrEqual(0);
    expect(firstDoor).toBeLessThan(lastParking);

    // movedAt is non-decreasing (asc order honoured by the include).
    const times = visit.moves.map((m) => new Date(m.movedAt).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  // =========================================================================
  // 4 — Module gating: structurally covered by @RequireModule(YARD) on the
  //     spots/visits controllers; toggling YARD off is skipped to keep the
  //     shared DB stable (same convention as the yard-module suite).
  // =========================================================================
});
