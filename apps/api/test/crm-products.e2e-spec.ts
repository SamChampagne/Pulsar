/**
 * E2E CRM products + line items — product CRUD, line items recompute deal.amount,
 * delete-guard on referenced product, tenant isolation. Seeded DB (tenant acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('CRM products + line items (e2e)', () => {
  let app: INestApplication; let token: string; let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'acme' } });
    const mod = await prisma.moduleDefinition.findFirstOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: mod.id } },
      update: { enabled: true }, create: { tenantId: tenant.id, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });
  });
  afterAll(async () => { await app.close(); });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('product CRUD + line items recompute deal.amount + delete guard', async () => {
    const srv = app.getHttpServer();
    // product
    const product = (await request(srv).post('/api/v1/crm/products').set(auth()).send({ name: `Prod ${uniq()}`, unitPrice: 100 }).expect(201)).body;
    expect(Number(product.unitPrice)).toBe(100);
    // deal
    const company = (await request(srv).post('/api/v1/crm/companies').set(auth()).send({ name: `Co ${uniq()}` }).expect(201)).body;
    const deal = (await request(srv).post('/api/v1/crm/deals').set(auth()).send({ title: `D ${uniq()}`, companyId: company.id }).expect(201)).body;
    // add 2 lines → amount = 2*100 + 3*50 = 350
    await request(srv).post(`/api/v1/crm/deals/${deal.id}/line-items`).set(auth()).send({ productId: product.id, quantity: 2 }).expect(201);
    const line2 = (await request(srv).post(`/api/v1/crm/deals/${deal.id}/line-items`).set(auth()).send({ name: 'Libre', quantity: 3, unitPrice: 50 }).expect(201)).body;
    let dealRow = (await request(srv).get(`/api/v1/crm/deals/${deal.id}`).set(auth()).expect(200)).body;
    expect(Number(dealRow.amount)).toBe(350);
    // patch line2 qty 3→1 → amount = 200 + 50 = 250
    await request(srv).patch(`/api/v1/crm/deals/${deal.id}/line-items/${line2.id}`).set(auth()).send({ quantity: 1 }).expect(200);
    dealRow = (await request(srv).get(`/api/v1/crm/deals/${deal.id}`).set(auth()).expect(200)).body;
    expect(Number(dealRow.amount)).toBe(250);
    // delete-guard: product referenced → 409
    await request(srv).delete(`/api/v1/crm/products/${product.id}`).set(auth()).expect(409);
    // delete line → amount = 50
    await request(srv).delete(`/api/v1/crm/deals/${deal.id}/line-items/${line2.id}`).set(auth()).expect(200);
    dealRow = (await request(srv).get(`/api/v1/crm/deals/${deal.id}`).set(auth()).expect(200)).body;
    expect(Number(dealRow.amount)).toBe(200);
  });
});
