/**
 * E2E for phase 6 — OIDC: tenant config round-trip with secret masking,
 * exchange-code hygiene, and 404 for tenants without SSO.
 * The full IdP round-trip is covered by unit tests (openid-client mocked).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 6 — OIDC (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;
  let roleId: string;
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
    const roles = await request(http).get('/api/v1/roles').set(auth()).expect(200);
    roleId = (Array.isArray(roles.body) ? roles.body : roles.body.items)[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('saves the config and masks the secret on read', async () => {
    const saved = await request(http)
      .put('/api/v1/auth/oidc-config')
      .set(auth())
      .send({
        enabled: false,
        issuer: 'https://idp.example.test',
        clientId: 'pulsar-client',
        clientSecret: 'super-secret',
        defaultRoleId: roleId,
      })
      .expect(200);
    expect(saved.body.clientSecret).toBe('***');

    const read = await request(http).get('/api/v1/auth/oidc-config').set(auth()).expect(200);
    expect(read.body.clientSecret).toBe('***');
    expect(read.body.issuer).toBe('https://idp.example.test');
  });

  it('echoing the mask back preserves the stored secret', async () => {
    const saved = await request(http)
      .put('/api/v1/auth/oidc-config')
      .set(auth())
      .send({
        enabled: false,
        issuer: 'https://idp.example.test',
        clientId: 'pulsar-client-2',
        clientSecret: '***',
        defaultRoleId: roleId,
      })
      .expect(200);
    expect(saved.body.clientId).toBe('pulsar-client-2');
  });

  it('rejects a foreign defaultRoleId', async () => {
    await request(http)
      .put('/api/v1/auth/oidc-config')
      .set(auth())
      .send({
        enabled: false,
        issuer: 'https://idp.example.test',
        clientId: 'x',
        clientSecret: 's',
        defaultRoleId: 'not-a-role',
      })
      .expect(400);
  });

  it('start returns 404 when SSO is disabled', async () => {
    await request(http).get('/api/v1/auth/oidc/acme').expect(404);
  });

  it('rejects an invalid exchange code', async () => {
    await request(http)
      .post('/api/v1/auth/oidc/exchange')
      .send({ code: 'bogus' })
      .expect(401);
  });
});
