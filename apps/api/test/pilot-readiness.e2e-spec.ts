import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import { derivePilotReadiness } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ApsRuntimeService } from '../src/core/aps/aps-runtime.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { DeploymentObservationService } from '../src/core/platform/deployment-observation.service';

describe('Pilot readiness, platform read-only contract', () => {
  let app: INestApplication, db: PrismaService, token: string, jwt: JwtService, userId: string;
  const email = `pilot-${Date.now()}@example.test`;
  const apsStatus = jest
    .fn()
    .mockResolvedValue({ installed: false, healthy: false, dbReady: false });
  const get = (auth = token) =>
    request(app.getHttpServer()).get('/api/v1/platform/operations').auth(auth, { type: 'bearer' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ApsRuntimeService)
      .useValue({ status: apsStatus })
      .overrideProvider(AgentRuntimeService)
      .useValue({ isAvailable: () => false, killAgentSessions: () => {} })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    db = app.get(PrismaService);
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    const user = await db.platformUser.create({
      data: {
        email,
        passwordHash: hashSync('Test1234!', 10),
        firstName: 'Recette',
        lastName: 'Pilote',
        status: 'ACTIVE',
      },
    });
    userId = user.id;
    jwt = new JwtService({ secret: app.get(ConfigService).getOrThrow('JWT_SECRET') });
    token = jwt.sign({ sub: userId, email, platformAdmin: true }, { expiresIn: '15m' });
    console.log('PILOT_PLATFORM_EMAIL=' + email);
  }, 60000);
  afterAll(async () => {
    await app?.close();
  }); // isolated local fixture retained for UI recipe
  it('rejects anonymous, tenant and MFA-step credentials', async () => {
    await request(app.getHttpServer()).get('/api/v1/platform/operations').expect(401);
    await get(jwt.sign({ sub: userId, tenantId: 'irrelevant', permissions: ['*'] })).expect(401);
    await get(jwt.sign({ sub: userId, scope: 'mfa-pending', platformAdmin: true })).expect(401);
  });
  it('compares the installed migration bundle and returns no names, SQL or credentials', async () => {
    const { body } = await get().expect(200);
    expect(body.deploymentChecks.migrations).toMatchObject({
      state: 'MATCHED',
      pending: 0,
      failed: 0,
      changed: 0,
      unexpected: 0,
    });
    expect(body.deploymentChecks.migrations.expected).toBeGreaterThan(100);
    expect(JSON.stringify(body)).not.toMatch(
      /migration_name|checksum|DATABASE_URL|passwordHash|JWT_SECRET|secretEnc/,
    );
    expect(derivePilotReadiness(body, 'SERVICES').checks.some((c) => c.key === 'aps')).toBe(false);
    expect(
      derivePilotReadiness(body, 'MANUFACTURING').checks.find((c) => c.key === 'aps')?.state,
    ).toBe('BLOCKED');
  });
  it('keeps migration read failures unknown and isolates optional runtime errors', async () => {
    const spy = jest
      .spyOn(app.get(DeploymentObservationService), 'migrations')
      .mockRejectedValueOnce(new Error('database-secret'));
    apsStatus.mockRejectedValueOnce(new Error('runtime-secret'));
    try {
      const { body } = await get().expect(200);
      expect(body.deploymentChecks.migrations).toMatchObject({
        state: 'UNVERIFIED',
        expected: null,
        pending: null,
      });
      expect(body.services.find((s: any) => s.key === 'aps').state).toBe('UNAVAILABLE');
      expect(JSON.stringify(body)).not.toMatch(/database-secret|runtime-secret/);
    } finally {
      spy.mockRestore();
    }
  });
  it('does not create runs, emails or business mutations while observing', async () => {
    const counts = () =>
      Promise.all([
        db.agentRun.count(),
        db.emailMessage.count(),
        db.auditLog.count(),
        db.journalEntry.count(),
      ]);
    const before = await counts();
    await get().expect(200);
    expect(await counts()).toEqual(before);
  });
  it('immediately rejects a disabled platform operator', async () => {
    await db.platformUser.update({ where: { id: userId }, data: { status: 'DISABLED' } });
    try {
      await get().expect(401);
    } finally {
      await db.platformUser.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    }
  });
});
