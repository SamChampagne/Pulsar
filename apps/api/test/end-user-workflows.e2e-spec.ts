import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('End-user corrections (HTTP)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;
  let customerId: string;
  let carrierId: string;
  let load: { id: string; updatedAt: string };
  let tenantId: string;
  const suffix = `UX${Date.now().toString(36)}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = res.body.accessToken;
    tenantId = res.body.tenant.id;
  });
  afterAll(async () => {
    await app?.close();
  });
  it('creates and modifies a customer; optional fields can be cleared and the code stays fixed', async () => {
    const created = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({
        code: suffix,
        name: 'Client test',
        email: 'test@example.invalid',
        phone: '+1 514 555-0123',
      })
      .expect(201);
    customerId = created.body.id;
    const edited = await request(http)
      .patch(`/api/v1/transportation/customers/${customerId}`)
      .set(auth())
      .send({
        name: 'Client corrigé',
        code: 'SHOULD-NOT-CHANGE',
        email: null,
        phone: null,
        isActive: false,
      })
      .expect(200);
    expect(edited.body).toMatchObject({
      name: 'Client corrigé',
      code: suffix,
      email: null,
      phone: null,
      isActive: false,
    });
    await request(http)
      .patch(`/api/v1/transportation/customers/${customerId}`)
      .set(auth())
      .send({ isActive: true })
      .expect(200);
  });
  it('creates, edits and deactivates a carrier', async () => {
    const created = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: suffix, name: 'Transport Test', scacCode: 'abcd', phone: '5145550123' })
      .expect(201);
    carrierId = created.body.id;
    expect(created.body.scacCode).toBe('ABCD');
    const updated = await request(http)
      .patch(`/api/v1/transportation/carriers/${carrierId}`)
      .set(auth())
      .send({ phone: '+1 418 555-0134 poste 22', status: 'INACTIVE' })
      .expect(200);
    expect(updated.body.status).toBe('INACTIVE');
  });
  it('rejects invalid phone and oversized fields without modifying the record', async () => {
    await request(http)
      .patch(`/api/v1/transportation/carriers/${carrierId}`)
      .set(auth())
      .send({ phone: 'bonjour' })
      .expect(400);
    await request(http)
      .patch(`/api/v1/transportation/customers/${customerId}`)
      .set(auth())
      .send({ name: 'a'.repeat(201) })
      .expect(400);
    const current = await request(http)
      .get(`/api/v1/transportation/carriers/${carrierId}`)
      .set(auth())
      .expect(200);
    expect(current.body.phone).toBe('+1 418 555-0134 poste 22');
  });
  it('validates postal codes, province and coordinates on the server', async () => {
    const base = {
      code: suffix,
      name: 'Lieu',
      type: 'WAREHOUSE',
      addressLine1: '123 Rue',
      city: 'Laval',
      country: 'CA',
      state: 'QC',
    };
    await request(http)
      .post('/api/v1/locations')
      .set(auth())
      .send({ ...base, postalCode: '123456789012345678' })
      .expect(400);
    await request(http)
      .post('/api/v1/locations')
      .set(auth())
      .send({ ...base, postalCode: '90210' })
      .expect(400);
    await request(http)
      .post('/api/v1/locations')
      .set(auth())
      .send({ ...base, latitude: 120 })
      .expect(400);
    await request(http)
      .post('/api/v1/locations')
      .set(auth())
      .send({ ...base, state: 'INVALID' })
      .expect(400);
    const created = await request(http)
      .post('/api/v1/locations')
      .set(auth())
      .send({ ...base, postalCode: 'h7a 1a1' })
      .expect(201);
    expect(created.body.postalCode).toBe('H7A 1A1');
    // A country-only PATCH must check the merged address, not only the DTO.
    await request(http)
      .patch(`/api/v1/locations/${created.body.id}`)
      .set(auth())
      .send({ country: 'US' })
      .expect(400);
  });
  it('edits notes without changing state or cost, and rejects stale versions', async () => {
    const created = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({ notes: 'Avant' })
      .expect(201);
    load = created.body;
    const updated = await request(http)
      .patch(`/api/v1/transportation/loads/${load.id}`)
      .set(auth())
      .send({ notes: 'Après', expectedUpdatedAt: load.updatedAt })
      .expect(200);
    expect(updated.body).toMatchObject({ notes: 'Après', status: 'OPEN', estimatedCost: null });
    await request(http)
      .patch(`/api/v1/transportation/loads/${load.id}`)
      .set(auth())
      .send({ notes: 'Écraser', expectedUpdatedAt: load.updatedAt })
      .expect(409);
  });
  it('preserves tenant isolation on partner edits', async () => {
    const prisma = app.get(PrismaService);
    const other = await prisma.tenant.create({
      data: { slug: `${suffix}-foreign`, name: 'Other' },
    });
    const foreign = await prisma.customer.create({
      data: { tenantId: other.id, code: suffix, name: 'Foreign' },
    });
    await request(http)
      .patch(`/api/v1/transportation/customers/${foreign.id}`)
      .set(auth())
      .send({ name: 'No' })
      .expect(404);
    await request(http)
      .patch(`/api/v1/transportation/customers/${customerId}`)
      .send({ name: 'No' })
      .expect(401);
  });
  it('uploads and serves a logo through the public capability; replacement revokes the old URL', async () => {
    const before = await request(http)
      .get('/api/v1/customer-portal/branding')
      .set(auth())
      .expect(200);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=',
      'base64',
    );
    const uploaded = await request(http)
      .post('/api/v1/customer-portal/branding/logo')
      .set(auth())
      .attach('file', png, 'logo.png')
      .expect(201);
    const url = uploaded.body.logoUrl;
    expect(url).not.toContain(tenantId);
    await request(http)
      .get(url)
      .expect(200)
      .expect('Content-Type', /image\/png/)
      .expect('X-Content-Type-Options', 'nosniff');
    await request(http)
      .post('/api/v1/customer-portal/branding/logo')
      .set(auth())
      .attach('file', Buffer.from('<svg/>'), 'logo.png')
      .expect(400);
    await request(http)
      .put('/api/v1/customer-portal/branding')
      .set(auth())
      .send({ logoUrl: '', accentColor: '#123456' })
      .expect(200);
    await request(http).get(url).expect(404);
    await request(http)
      .put('/api/v1/customer-portal/branding')
      .set(auth())
      .send(before.body)
      .expect(200);
  });
});
