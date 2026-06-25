/**
 * E2E crm_get_deal context getter — proves DealsService.getWithContext over the API
 * by creating a deal + contact and asserting the coach's data shape, tenant-scoped.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DealsService } from '../src/modules/crm/deals.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('crm_get_deal context (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaService;
  let deals: DealsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);
    deals = app.get(DealsService);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: mod.id } },
      update: { enabled: true },
      create: { tenantId: tenant.id, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });
  });

  afterAll(async () => { await app.close(); });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('returns the deal with company, contacts and activities', async () => {
    const srv = app.getHttpServer();
    const company = (await request(srv).post('/api/v1/crm/companies').set(auth()).send({ name: `Coach Co ${uniq()}` }).expect(201)).body as { id: string; name: string };
    await request(srv).post('/api/v1/crm/contacts').set(auth()).send({ name: 'Bob', email: `bob.${uniq()}@x.test`, companyId: company.id }).expect(201);
    const deal = (await request(srv).post('/api/v1/crm/deals').set(auth()).send({ title: `Coach deal ${uniq()}`, companyId: company.id }).expect(201)).body as { id: string };
    await request(srv).post('/api/v1/crm/activities').set(auth()).send({ type: 'NOTE', body: 'first call', dealId: deal.id }).expect(201);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    const ctx = await deals.getWithContext(tenant.id, deal.id);
    expect(ctx.deal.id).toBe(deal.id);
    expect(ctx.company.name).toContain('Coach Co');
    expect(ctx.contacts.length).toBeGreaterThanOrEqual(1);
    expect(ctx.activities.length).toBeGreaterThanOrEqual(1);

    // Tenant isolation: a foreign tenant id must not resolve this deal.
    await expect(deals.getWithContext('tenant_nonexistent', deal.id)).rejects.toThrow();
  });
});
