/**
 * E2E yard-module (Task 7) — proves the Yard Management module end-to-end over
 * real Postgres with the admin Bearer token (tenant acme): the full yard loop.
 *
 *   1. Check-in: a gate check-in creates a CHECKED_IN visit.
 *   2. Assign: assigning to a dock door flips ASSIGNED and the board shows it
 *      occupying DOOR-1.
 *   3. Occupancy (409): a second visit assigned to the same occupied door is
 *      refused (derived occupancy, rule 34).
 *   4. Move: moving visit1 to parking frees the door (DOOR-1 free, P-1 holds it),
 *      and the freed door now accepts visit2.
 *   5. Check-out: checking out flips DEPARTED, frees the spot, sets checkOutAt;
 *      the board no longer shows the visit.
 *   6. Appointment + link: a SCHEDULED appointment arrives → ARRIVED; a check-in
 *      that links a SCHEDULED appointment flips that appointment to ARRIVED.
 *   7. Overview: rollup is sane (trucksInYard >= 0, doorCount >= 1).
 *   8. Tenant isolation + module gating: list scoping asserted; module gating is
 *      structurally covered by @RequireModule (toggle skipped).
 *
 * Permissions yard.read / yard.manage, module YARD (seeded for acme). Spots/sites
 * reuse the transportation Location, so TRANSPORTATION is also enabled.
 *
 * Prerequisites: reachable PostgreSQL with the seed applied (YARD module enabled).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

interface Visit {
  id: string;
  status: string;
  spotId: string | null;
  checkOutAt: string | null;
  appointmentId: string | null;
}
interface BoardSpot {
  id: string;
  code: string;
  type: string;
  occupyingVisit: { id: string } | null;
}
interface Board {
  spots: BoardSpot[];
  unassigned: Array<{ id: string }>;
}

describe('Yard module (e2e)', () => {
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
  let visitId1 = '';
  let visitId2 = '';
  let appointmentId = '';
  let linkedAppointmentId = '';
  let linkedVisitId = '';

  // Helper: the DOOR-1 spot on the board (filtered to our created ids).
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
        code: `YARD-${suffix}`,
        name: `Yard Site ${suffix}`,
        type: 'DISTRIBUTION_CENTER',
        addressLine1: '1 Yard Way',
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
      // YardMove cascades on visit delete; delete child rows before the location.
      const visitIds = [visitId1, visitId2, linkedVisitId].filter(Boolean);
      await prisma.yardVisit.deleteMany({ where: { id: { in: visitIds } } }).catch(() => undefined);
      // Detach any other visits pointing at our spots, then drop appointments/spots.
      await prisma.yardVisit
        .deleteMany({ where: { tenantId, spotId: { in: [doorId, parkingId] } } })
        .catch(() => undefined);
      await prisma.dockAppointment
        .deleteMany({ where: { id: { in: [appointmentId, linkedAppointmentId].filter(Boolean) } } })
        .catch(() => undefined);
      await prisma.yardSpot
        .deleteMany({ where: { id: { in: [doorId, parkingId] } } })
        .catch(() => undefined);
      await prisma.location.deleteMany({ where: { id: locationId } }).catch(() => undefined);
    }
    await app.close();
  });

  // =========================================================================
  // 1 — Check-in: a gate check-in creates a CHECKED_IN visit.
  // =========================================================================
  it('a gate check-in creates a CHECKED_IN visit', async () => {
    const res = await request(http)
      .post('/api/v1/yard/visits')
      .set(auth())
      .send({ locationId, trailerRef: 'ABC-123', direction: 'INBOUND' })
      .expect(201);
    const visit = res.body as Visit;
    expect(visit.status).toBe('CHECKED_IN');
    expect(visit.spotId).toBeNull();
    visitId1 = visit.id;
  });

  // =========================================================================
  // 2 — Assign to a dock door: ASSIGNED + board shows it occupying DOOR-1.
  // =========================================================================
  it('assigning to a door flips ASSIGNED and the board shows the occupant', async () => {
    const res = await request(http)
      .post(`/api/v1/yard/visits/${visitId1}/assign`)
      .set(auth())
      .send({ spotId: doorId })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect((res.body as Visit).status).toBe('ASSIGNED');
    expect((res.body as Visit).spotId).toBe(doorId);

    const board = await request(http)
      .get(`/api/v1/yard/board?locationId=${locationId}`)
      .set(auth())
      .expect(200);
    const door = boardSpot(board.body as Board, doorId);
    expect(door?.occupyingVisit?.id).toBe(visitId1);
  });

  // =========================================================================
  // 3 — Occupancy: a 2nd visit on the same occupied door is refused (409).
  // =========================================================================
  it('assigning a 2nd visit to an occupied door is refused with 409', async () => {
    const res = await request(http)
      .post('/api/v1/yard/visits')
      .set(auth())
      .send({ locationId, trailerRef: 'XYZ-789', direction: 'INBOUND' })
      .expect(201);
    visitId2 = (res.body as Visit).id;

    await request(http)
      .post(`/api/v1/yard/visits/${visitId2}/assign`)
      .set(auth())
      .send({ spotId: doorId })
      .expect(409);
  });

  // =========================================================================
  // 4 — Move: visit1 → P-1 frees the door; the freed door then accepts visit2.
  // =========================================================================
  it('moving visit1 to parking frees the door, which then accepts visit2', async () => {
    await request(http)
      .post(`/api/v1/yard/visits/${visitId1}/move`)
      .set(auth())
      .send({ spotId: parkingId })
      .expect((r) => expect([200, 201]).toContain(r.status));

    const board = await request(http)
      .get(`/api/v1/yard/board?locationId=${locationId}`)
      .set(auth())
      .expect(200);
    const door = boardSpot(board.body as Board, doorId);
    const parking = boardSpot(board.body as Board, parkingId);
    expect(parking?.occupyingVisit?.id).toBe(visitId1);
    expect(door?.occupyingVisit).toBeNull();

    // The freed door now accepts visit2.
    await request(http)
      .post(`/api/v1/yard/visits/${visitId2}/assign`)
      .set(auth())
      .send({ spotId: doorId })
      .expect((r) => expect([200, 201]).toContain(r.status));
  });

  // =========================================================================
  // 5 — Check-out: DEPARTED, spot freed, checkOutAt set; off the board.
  // =========================================================================
  it('checking out flips DEPARTED, frees the spot and leaves the board', async () => {
    const out = await request(http)
      .post(`/api/v1/yard/visits/${visitId1}/check-out`)
      .set(auth())
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect((out.body as Visit).status).toBe('DEPARTED');

    const board = await request(http)
      .get(`/api/v1/yard/board?locationId=${locationId}`)
      .set(auth())
      .expect(200);
    const stillThere = (board.body as Board).spots.some(
      (s) => s.occupyingVisit?.id === visitId1,
    );
    expect(stillThere).toBe(false);

    const get = await request(http)
      .get(`/api/v1/yard/visits/${visitId1}`)
      .set(auth())
      .expect(200);
    const visit = get.body as Visit;
    expect(visit.spotId).toBeNull();
    expect(visit.checkOutAt).not.toBeNull();
  });

  // =========================================================================
  // 6 — Appointment + link: arrive a SCHEDULED appointment; a linked check-in
  //     flips its appointment to ARRIVED.
  // =========================================================================
  it('a scheduled appointment arrives, and a linked check-in flips it to ARRIVED', async () => {
    const now = Date.now();
    const windowStart = new Date(now + 3600_000).toISOString();
    const windowEnd = new Date(now + 7200_000).toISOString();

    // Stand-alone appointment: SCHEDULED → ARRIVED via /arrive.
    const created = await request(http)
      .post('/api/v1/yard/appointments')
      .set(auth())
      .send({ locationId, direction: 'INBOUND', windowStart, windowEnd })
      .expect(201);
    appointmentId = (created.body as { id: string; status: string }).id;
    expect((created.body as { status: string }).status).toBe('SCHEDULED');

    const arrived = await request(http)
      .post(`/api/v1/yard/appointments/${appointmentId}/arrive`)
      .set(auth())
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect((arrived.body as { status: string }).status).toBe('ARRIVED');

    // Linked check-in: a check-in carrying appointmentId flips it to ARRIVED.
    const linkCreated = await request(http)
      .post('/api/v1/yard/appointments')
      .set(auth())
      .send({ locationId, direction: 'INBOUND', windowStart, windowEnd })
      .expect(201);
    linkedAppointmentId = (linkCreated.body as { id: string }).id;

    const linkVisit = await request(http)
      .post('/api/v1/yard/visits')
      .set(auth())
      .send({ locationId, trailerRef: 'LINK-1', direction: 'INBOUND', appointmentId: linkedAppointmentId })
      .expect(201);
    linkedVisitId = (linkVisit.body as Visit).id;
    expect((linkVisit.body as Visit).appointmentId).toBe(linkedAppointmentId);

    const appt = await request(http)
      .get(`/api/v1/yard/appointments/${linkedAppointmentId}`)
      .set(auth())
      .expect(200);
    expect((appt.body as { status: string }).status).toBe('ARRIVED');
  });

  // =========================================================================
  // 7 — Overview rollup. Loose asserts (shared DB).
  // =========================================================================
  it('the overview rollup is sane', async () => {
    const res = await request(http).get('/api/v1/yard/overview').set(auth()).expect(200);
    const body = res.body as { trucksInYard: number; doorCount: number };
    expect(body.trucksInYard).toBeGreaterThanOrEqual(0);
    expect(body.doorCount).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // 8 — Tenant isolation: our visits are listed for acme and tenant-scoped.
  // Module gating covered structurally by @RequireModule; toggling skipped to
  // keep the shared DB stable.
  // =========================================================================
  it('the created visits are listed for acme and the list is tenant-scoped', async () => {
    const list = await request(http)
      .get(`/api/v1/yard/visits?locationId=${locationId}`)
      .set(auth())
      .expect(200);
    const visits = list.body as Array<{ id: string }>;
    expect(visits.some((v) => v.id === visitId1)).toBe(true);

    // No cross-tenant leakage among the returned ids.
    const ids = visits.map((v) => v.id);
    const leaked = await prisma.yardVisit.count({
      where: { id: { in: ids }, tenantId: { not: tenantId } },
    });
    expect(leaked).toBe(0);
  });
});
