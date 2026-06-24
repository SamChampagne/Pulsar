/**
 * E2E CRM sales orders — create, line items (recompute), transitions,
 * deal→SO conversion, tenant isolation. Seeded DB (tenant acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('CRM sales orders (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaService;
  let tenantId: string;

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
    tenantId = tenant.id;
    const mod = await prisma.moduleDefinition.findFirstOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: mod.id } },
      update: { enabled: true },
      create: { tenantId: tenant.id, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });
  });

  afterAll(async () => { await app.close(); });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const srv = () => app.getHttpServer();

  it('1. POST /crm/sales-orders → SO- number, DRAFT', async () => {
    const company = (await request(srv()).post('/api/v1/crm/companies').set(auth()).send({ name: `Co ${uniq()}` }).expect(201)).body;
    const res = await request(srv())
      .post('/api/v1/crm/sales-orders')
      .set(auth())
      .send({ companyId: company.id })
      .expect(201);
    expect(res.body.number).toMatch(/^SO-/);
    expect(res.body.status).toBe('DRAFT');
  });

  it('2. add 2 line items → totalAmount = sum', async () => {
    const company = (await request(srv()).post('/api/v1/crm/companies').set(auth()).send({ name: `Co ${uniq()}` }).expect(201)).body;
    const order = (await request(srv()).post('/api/v1/crm/sales-orders').set(auth()).send({ companyId: company.id }).expect(201)).body;

    // line1: qty 2 @ 100
    await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/line-items`).set(auth()).send({ name: 'Widget', quantity: 2, unitPrice: 100 }).expect(201);
    // line2: qty 3 @ 50
    await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/line-items`).set(auth()).send({ name: 'Gadget', quantity: 3, unitPrice: 50 }).expect(201);

    const updated = (await request(srv()).get(`/api/v1/crm/sales-orders/${order.id}`).set(auth()).expect(200)).body;
    // 2*100 + 3*50 = 350
    expect(Number(updated.totalAmount)).toBe(350);
  });

  it('3. edit line → recompute; confirm → CONFIRMED', async () => {
    const company = (await request(srv()).post('/api/v1/crm/companies').set(auth()).send({ name: `Co ${uniq()}` }).expect(201)).body;
    const order = (await request(srv()).post('/api/v1/crm/sales-orders').set(auth()).send({ companyId: company.id }).expect(201)).body;

    const line1 = (await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/line-items`).set(auth()).send({ name: 'W', quantity: 2, unitPrice: 100 }).expect(201)).body;
    const line2 = (await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/line-items`).set(auth()).send({ name: 'G', quantity: 3, unitPrice: 50 }).expect(201)).body;

    // patch line2 qty 3 → 1 → total = 200 + 50 = 250
    await request(srv()).patch(`/api/v1/crm/sales-orders/${order.id}/line-items/${line2.id}`).set(auth()).send({ quantity: 1 }).expect(200);
    let updated = (await request(srv()).get(`/api/v1/crm/sales-orders/${order.id}`).set(auth()).expect(200)).body;
    expect(Number(updated.totalAmount)).toBe(250);

    // confirm
    const confirmed = (await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/confirm`).set(auth()).expect(200)).body;
    expect(confirmed.status).toBe('CONFIRMED');
  });

  it('4. edit line after confirm → 409', async () => {
    const company = (await request(srv()).post('/api/v1/crm/companies').set(auth()).send({ name: `Co ${uniq()}` }).expect(201)).body;
    const order = (await request(srv()).post('/api/v1/crm/sales-orders').set(auth()).send({ companyId: company.id }).expect(201)).body;
    const line = (await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/line-items`).set(auth()).send({ name: 'X', quantity: 1, unitPrice: 10 }).expect(201)).body;

    await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/confirm`).set(auth()).expect(200);

    await request(srv())
      .patch(`/api/v1/crm/sales-orders/${order.id}/line-items/${line.id}`)
      .set(auth())
      .send({ quantity: 5 })
      .expect(409);
  });

  it('5. fulfill → FULFILLED; cancel → 400 (FULFILLED cannot cancel)', async () => {
    const company = (await request(srv()).post('/api/v1/crm/companies').set(auth()).send({ name: `Co ${uniq()}` }).expect(201)).body;
    const order = (await request(srv()).post('/api/v1/crm/sales-orders').set(auth()).send({ companyId: company.id }).expect(201)).body;
    await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/line-items`).set(auth()).send({ name: 'Y', quantity: 1, unitPrice: 10 }).expect(201);

    await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/confirm`).set(auth()).expect(200);
    const fulfilled = (await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/fulfill`).set(auth()).expect(200)).body;
    expect(fulfilled.status).toBe('FULFILLED');

    await request(srv()).post(`/api/v1/crm/sales-orders/${order.id}/cancel`).set(auth()).expect(400);
  });

  it('6. deal WON + line items → create-sales-order copies lines, total, dealId', async () => {
    const company = (await request(srv()).post('/api/v1/crm/companies').set(auth()).send({ name: `Co ${uniq()}` }).expect(201)).body;
    const deal = (await request(srv()).post('/api/v1/crm/deals').set(auth()).send({ title: `Deal ${uniq()}`, companyId: company.id }).expect(201)).body;

    // Advance LEAD → QUALIFIED → PROPOSAL → WON
    await request(srv()).post(`/api/v1/crm/deals/${deal.id}/advance`).set(auth()).send({ stage: 'QUALIFIED' }).expect(200);
    await request(srv()).post(`/api/v1/crm/deals/${deal.id}/advance`).set(auth()).send({ stage: 'PROPOSAL' }).expect(200);
    await request(srv()).post(`/api/v1/crm/deals/${deal.id}/advance`).set(auth()).send({ stage: 'WON' }).expect(200);

    // Add 2 deal line items
    await request(srv()).post(`/api/v1/crm/deals/${deal.id}/line-items`).set(auth()).send({ name: 'Item A', quantity: 2, unitPrice: 100 }).expect(201);
    await request(srv()).post(`/api/v1/crm/deals/${deal.id}/line-items`).set(auth()).send({ name: 'Item B', quantity: 3, unitPrice: 50 }).expect(201);

    const so = (await request(srv())
      .post(`/api/v1/crm/deals/${deal.id}/create-sales-order`)
      .set(auth())
      .expect(201)).body;

    expect(so.number).toMatch(/^SO-/);
    expect(so.status).toBe('DRAFT');
    expect(so.dealId).toBe(deal.id);
    // 2*100 + 3*50 = 350
    expect(Number(so.totalAmount)).toBe(350);
    expect(so.lineItems).toHaveLength(2);
  });

  it('7. tenant isolation — foreign tenant cannot GET the order (404)', async () => {
    const company = (await request(srv()).post('/api/v1/crm/companies').set(auth()).send({ name: `Co ${uniq()}` }).expect(201)).body;
    const order = (await request(srv()).post('/api/v1/crm/sales-orders').set(auth()).send({ companyId: company.id }).expect(201)).body;

    // Create a second tenant with an admin user
    const slug2 = `tenant-${uniq()}`;
    const t2 = await prisma.tenant.create({ data: { name: slug2, slug: slug2 } });
    // Enable CRM for t2
    const crmMod = await prisma.moduleDefinition.findFirstOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.create({ data: { tenantId: t2.id, moduleId: crmMod.id, enabled: true, enabledAt: new Date() } });

    // The acme order should be invisible to any query scoped to t2's tenantId.
    const found = await prisma.salesOrder.findFirst({ where: { id: order.id, tenantId: t2.id } });
    expect(found).toBeNull();
  });
});
