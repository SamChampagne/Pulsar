/**
 * E2E connect CSV import — happy path + cross-tenant write guard (security regression).
 *
 *   S1  legit import   POST /connect/imports (carriers) creates the row in the caller's
 *                      tenant.
 *   S2  tenant guard   a mapping that injects `tenantId` (mapped to a CSV column holding
 *                      another tenant's id) must NOT write into another tenant — the
 *                      authenticated tenant always wins (spread inversion + coerceTypes
 *                      column whitelist). The row is created under acme.
 *
 * Permission core.connect.manage, no module gate on /connect.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

describe('Connect CSV import (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';
  let otherTenantId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const code1 = `CONN-CARR-1-${suffix}`;
  const code2 = `CONN-CARR-2-${suffix}`;

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

    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } })).id;
    // Any other tenant id (the seed creates the platform/demo tenants); fall back to a literal.
    const other = await prisma.tenant.findFirst({ where: { slug: { not: 'acme' } }, select: { id: true } });
    otherTenantId = other?.id ?? 'some-foreign-tenant-id';
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.carrier
        .deleteMany({ where: { code: { in: [code1, code2] } } })
        .catch(() => undefined);
    }
    await app.close();
  });

  it('S1: a legit CSV import creates a carrier in the caller tenant', async () => {
    const csv = `Code,Name\n${code1},Connect Import One\n`;
    const res = await request(http)
      .post('/api/v1/connect/imports')
      .set(auth())
      .field('target', 'carriers')
      .field('mapping', JSON.stringify({ code: 'Code', name: 'Name' }))
      .attach('file', Buffer.from(csv), { filename: 'legit.csv', contentType: 'text/csv' })
      .expect(201);
    expect((res.body as { importedRows: number }).importedRows).toBe(1);

    const carrier = await prisma.carrier.findFirst({ where: { code: code1 } });
    expect(carrier).toBeTruthy();
    expect(carrier!.tenantId).toBe(tenantId);
  });

  it('S2: a mapping injecting tenantId cannot write into another tenant', async () => {
    // CSV carries another tenant id in a column the mapping aims at `tenantId`.
    const csv = `Code,Name,Evil\n${code2},Connect Import Two,${otherTenantId}\n`;
    await request(http)
      .post('/api/v1/connect/imports')
      .set(auth())
      .field('target', 'carriers')
      .field('mapping', JSON.stringify({ code: 'Code', name: 'Name', tenantId: 'Evil' }))
      .attach('file', Buffer.from(csv), { filename: 'attack.csv', contentType: 'text/csv' })
      .expect(201);

    const carrier = await prisma.carrier.findFirst({ where: { code: code2 } });
    expect(carrier).toBeTruthy();
    // The authenticated tenant wins — the injected tenantId is ignored.
    expect(carrier!.tenantId).toBe(tenantId);
    expect(carrier!.tenantId).not.toBe(otherTenantId);
  });
});
