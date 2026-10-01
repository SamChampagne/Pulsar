import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { PlatformServicesController } from './platform-services.controller';
import { PlatformServicesService } from './platform-services.service';
import { PlatformEmailConfigService } from '../email/platform-email-config.service';
import { PlatformGuard } from './platform.guard';
import { PlatformJwtStrategy } from './platform-jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

describe('Platform services HTTP boundary — isolated doubles, no DB/provider', () => {
  let app: INestApplication;
  const secret = 'isolated-platform-service-test-secret';
  const jwt = new JwtService({ secret });
  const services = {
    overview: jest.fn(async () => ({ emailChannel: 'log' })),
    saveRuntime: jest.fn(async () => ({ configured: true })),
  };
  const smtp = { save: jest.fn(async () => ({ hasPassword: true })) };
  const db = {
    platformUser: {
      findUnique: jest.fn(async () => ({
        id: 'operator',
        email: 'operator@example.test',
        status: 'ACTIVE',
      })),
    },
  };
  const token = (claims: object) => jwt.sign({ sub: 'operator', ...claims });
  const dto = {
    mode: 'SMTP',
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    fromEmail: 'sender@example.test',
    confirmed: true,
    expectedUpdatedAt: null,
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [PlatformServicesController],
      providers: [
        PlatformGuard,
        PlatformJwtStrategy,
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET: secret }) },
        { provide: PrismaService, useValue: db },
        { provide: PlatformServicesService, useValue: services },
        { provide: PlatformEmailConfigService, useValue: smtp },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => jest.clearAllMocks());
  it.each([
    {},
    { tenantId: 'tenant', permissions: ['*'] },
    { platformAdmin: true, scope: 'mfa-pending' },
    { platformAdmin: true, portal: true },
  ])('rejects non-platform or partial tokens %j', async (claims) => {
    await request(app.getHttpServer())
      .get('/platform/services')
      .set('Authorization', `Bearer ${token(claims)}`)
      .expect(401);
    expect(services.overview).not.toHaveBeenCalled();
  });
  it('rechecks disabled platform accounts', async () => {
    db.platformUser.findUnique.mockResolvedValueOnce({
      id: 'operator',
      email: 'op@test',
      status: 'DISABLED',
    });
    await request(app.getHttpServer())
      .put('/platform/services/email')
      .set('Authorization', `Bearer ${token({ platformAdmin: true })}`)
      .send(dto)
      .expect(401);
    expect(smtp.save).not.toHaveBeenCalled();
  });
  it('attributes writes to the actual operator, rejects secret/system fields, requires confirmation and version', async () => {
    const auth = `Bearer ${token({ platformAdmin: true })}`;
    for (const invalid of [
      { ...dto, tenantId: 'forged' },
      { ...dto, passwordEnc: 'forged' },
      { ...dto, confirmed: false },
      { ...dto, expectedUpdatedAt: undefined },
      { ...dto, port: 70000 },
    ]) {
      await request(app.getHttpServer())
        .put('/platform/services/email')
        .set('Authorization', auth)
        .send(invalid)
        .expect(400);
    }
    expect(smtp.save).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .put('/platform/services/email')
      .set('Authorization', auth)
      .send(dto)
      .expect(200);
    expect(smtp.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'operator' }),
      expect.objectContaining({ mode: 'SMTP' }),
    );
  });
  it('never accepts an arbitrary runner URL in an AI payload', async () => {
    await request(app.getHttpServer())
      .put('/platform/services/tenants/tenant/runtime')
      .set('Authorization', `Bearer ${token({ platformAdmin: true })}`)
      .send({
        provider: 'openrouter',
        confirmed: true,
        expectedUpdatedAt: null,
        runnerUrl: 'http://internal',
      })
      .expect(400);
    expect(services.saveRuntime).not.toHaveBeenCalled();
  });
});
