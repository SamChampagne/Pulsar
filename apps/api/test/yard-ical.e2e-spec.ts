/**
 * E2E — yard dock-appointment iCal feed: token generation (POST /yard/ical-token)
 * and the public feed (GET /public/ical/yard/:token).
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

describe('Yard iCal feed (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let adminToken = '';
  let tenantId = '';
  let locationId = '';
  let appointmentId = '';
  let appointmentNumber = '';

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    adminToken = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    const loc = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `YICAL-${uniq()}`,
        name: `Yard iCal Site ${uniq()}`,
        type: 'DISTRIBUTION_CENTER',
        addressLine1: '1 Ical Way',
        city: 'Trois-Rivières',
        country: 'CA',
      })
      .expect(201);
    locationId = (loc.body as { id: string }).id;

    const windowStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    const appt = await request(http)
      .post('/api/v1/yard/appointments')
      .set(auth())
      .send({ locationId, direction: 'INBOUND', windowStart, windowEnd, reference: 'PO-ICAL-1' })
      .expect(201);
    appointmentId = (appt.body as { id: string; appointmentNumber: string }).id;
    appointmentNumber = (appt.body as { id: string; appointmentNumber: string }).appointmentNumber;
  });

  afterAll(async () => {
    await prisma.dockAppointment
      .deleteMany({ where: { id: appointmentId } })
      .catch(() => undefined);
    await prisma.location.deleteMany({ where: { id: locationId } }).catch(() => undefined);
    await app.close();
  });

  it('POST /yard/ical-token returns a token and a public URL', async () => {
    const res = await request(http).post('/api/v1/yard/ical-token').set(auth()).expect(201);
    const body = res.body as { token: string; url: string };
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(10);
    expect(body.url).toContain(`/public/ical/yard/${body.token}`);
  });

  it('builds the public URL from API_URL config, not the request host', async () => {
    const res = await request(http).post('/api/v1/yard/ical-token').set(auth()).expect(201);
    const body = res.body as { token: string; url: string };
    const expectedBase = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
    expect(body.url).toBe(`${expectedBase}/api/v1/public/ical/yard/${body.token}`);
  });

  it('GET /yard/ical-token reports reload-safe status without ever exposing the token or URL', async () => {
    const gen = await request(http).post('/api/v1/yard/ical-token').set(auth()).expect(201);
    const token = (gen.body as { token: string }).token;

    const status = await request(http).get('/api/v1/yard/ical-token').set(auth()).expect(200);
    const body = status.body as { hasToken: boolean; rotatedAt?: string };
    expect(body.hasToken).toBe(true);
    expect(typeof body.rotatedAt).toBe('string');
    expect(Object.keys(body).sort()).toEqual(['hasToken', 'rotatedAt']);
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('GET /public/ical/yard/:token returns 200 text/calendar with a VEVENT for the appointment', async () => {
    const gen = await request(http).post('/api/v1/yard/ical-token').set(auth()).expect(201);
    const token = (gen.body as { token: string }).token;

    const res = await request(http).get(`/api/v1/public/ical/yard/${token}`).expect(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('BEGIN:VEVENT');
    expect(res.text).toContain(`UID:dock-appointment-${appointmentNumber}@pulsar`);
    // Rule 10: never leak the tenant id or the internal appointment id in the public payload.
    expect(res.text).not.toContain(tenantId);
    expect(res.text).not.toContain(appointmentId);
  });

  it('rotating the token invalidates the previous one', async () => {
    const first = await request(http).post('/api/v1/yard/ical-token').set(auth()).expect(201);
    const firstToken = (first.body as { token: string }).token;
    await request(http).get(`/api/v1/public/ical/yard/${firstToken}`).expect(200);

    const second = await request(http).post('/api/v1/yard/ical-token').set(auth()).expect(201);
    const secondToken = (second.body as { token: string }).token;
    expect(secondToken).not.toBe(firstToken);

    await request(http).get(`/api/v1/public/ical/yard/${firstToken}`).expect(404);
    await request(http).get(`/api/v1/public/ical/yard/${secondToken}`).expect(200);
  });

  it('GET /public/ical/yard/:token returns 404 for an unknown token', async () => {
    await request(http).get('/api/v1/public/ical/yard/not-a-real-token').expect(404);
  });

  it('audits token generation (rule 6) without ever logging the token value', async () => {
    const res = await request(http).post('/api/v1/yard/ical-token').set(auth()).expect(201);
    const token = (res.body as { token: string }).token;

    const logs = await prisma.auditLog.findMany({
      where: { tenantId, entityType: 'yard-ical-token' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toMatch(/CREATE|UPDATE/);
    expect(JSON.stringify(logs[0])).not.toContain(token);
  });
});
