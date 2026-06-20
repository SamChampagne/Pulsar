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
});
