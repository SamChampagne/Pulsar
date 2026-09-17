/**
 * E2E — partner API keys: expiry enforcement and the Swagger x-api-key scheme.
 *
 * Prerequisites: reachable PostgreSQL with seed applied (admin@pulsar.dev / admin123, tenant acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

describe('Partner API keys (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let adminToken = '';
  const createdKeyIds: string[] = [];

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    // Mirror main.ts's Swagger setup (mounted separately from bootstrap here since
    // this test builds its own Nest app) so /api/docs-json exists to assert against.
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Pulsar API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
    await app.listen(0);
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    adminToken = (login.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { id: { in: createdKeyIds } } });
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('GET /api/docs-json exposes the x-api-key security scheme', async () => {
    const res = await request(http).get('/api/docs-json').expect(200);
    const schemes = (res.body as { components?: { securitySchemes?: Record<string, unknown> } })
      .components?.securitySchemes;
    expect(schemes).toBeDefined();
    expect(schemes).toHaveProperty('api-key');
    expect(schemes!['api-key']).toMatchObject({ type: 'apiKey', name: 'x-api-key', in: 'header' });
  });

  it('rejects a key with an expiresAt in the past at creation time (400)', async () => {
    await request(http)
      .post('/api/v1/api-keys')
      .set(auth())
      .send({
        name: 'Expired at birth',
        scopes: ['transportation.tracking.read'],
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(400);
  });

  it('creates a key with a future expiresAt, then rejects it once expired (401, generic message)', async () => {
    const created = await request(http)
      .post('/api/v1/api-keys')
      .set(auth())
      .send({
        name: 'Soon-to-expire partner key',
        scopes: ['transportation.tracking.read'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .expect(201);
    const body = created.body as { id: string; key: string; expiresAt: string };
    createdKeyIds.push(body.id);
    expect(body.expiresAt).toBeTruthy();

    // Works while still valid — the key's only scope is transportation.tracking.read.
    await request(http)
      .get('/api/v1/transportation/tracking/events?loadId=nonexistent')
      .set('x-api-key', body.key)
      .expect(200);

    // Flip expiresAt into the past directly (avoids a real 60s sleep) and confirm 401.
    await prisma.apiKey.update({
      where: { id: body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(http)
      .get('/api/v1/transportation/tracking/events?loadId=nonexistent')
      .set('x-api-key', body.key)
      .expect(401);

    // Same generic message as an outright invalid/unknown key.
    const invalid = await request(http)
      .get('/api/v1/transportation/tracking/events?loadId=nonexistent')
      .set('x-api-key', 'pk_definitely-not-a-real-key')
      .expect(401);
    expect((expired.body as { message: string }).message).toBe(
      (invalid.body as { message: string }).message,
    );
  });

  it('creates a key with no expiresAt (never expires)', async () => {
    const created = await request(http)
      .post('/api/v1/api-keys')
      .set(auth())
      .send({ name: 'No expiry partner key', scopes: ['transportation.tracking.read'] })
      .expect(201);
    const body = created.body as { id: string; expiresAt: string | null };
    createdKeyIds.push(body.id);
    expect(body.expiresAt).toBeNull();
  });
});
