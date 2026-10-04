/** Disposable tenant fixtures: source documents are seeded, not operational WMS proof.
 * Allocation must never post stock; all assertions run over real HTTP/PostgreSQL. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ALL_PERMISSION_KEYS, PERMISSIONS } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('Delivery allocation HTTP/SQL', () => {
  let app: INestApplication, http: any, db: PrismaService;
  let tenantId: string, actorId: string, foreignTenantId: string, foreignActorId: string;
  let token: string, otherToken: string, foreignToken: string, tmsToken: string, readToken: string;
  let customerId: string, companyId: string, originId: string, destinationId: string;
  let itemId: string, binId: string;
  const moduleIds: Record<string, string> = {};
  const prefix = `ALLOC-${Date.now().toString(36)}-${randomUUID().slice(0, 5)}`;
  const base = '/api/v1/transportation/delivery-allocation';
  const parcels = '/api/v1/transportation/delivery-packages';
  const headers = (jwt = token) => ({ Authorization: `Bearer ${jwt}` });
  let serial = 0;
  const contents = (quantity: string, unit = 'ea') => [
    { reference: 'COMPONENT', description: 'Fixture component', quantity, unit },
  ];
  const workspace = async (shipmentId: string, jwt = token) =>
    (await request(http).get(base).query({ shipmentId }).set(headers(jwt)).expect(200)).body;
  const post = (body: object, jwt = token) => request(http).post(base).set(headers(jwt)).send(body);
  const release = (id: string, body: object, jwt = token) =>
    request(http).post(`${base}/${id}/release`).set(headers(jwt)).send(body);
  const current = (id: string) => db.deliveryPackage.findFirstOrThrow({ where: { tenantId, id } });

  async function fixture(quantity = '2.125', sourceQuantity = '5', unit = 'ea') {
    const number = String(++serial);
    const sales = await db.salesOrder.create({
      data: {
        tenantId,
        number: `SO-${number}`,
        companyId,
        customerId,
        status: 'CONFIRMED',
      },
    });
    const salesLine = await db.salesOrderLineItem.create({
      data: {
        tenantId,
        salesOrderId: sales.id,
        name: `Commercial source ${number}`,
        quantity: sourceQuantity,
      },
    });
    const order = await db.transportOrder.create({
      data: {
        tenantId,
        orderNumber: `TO-${number}`,
        customerId,
        originLocationId: originId,
        destinationLocationId: destinationId,
        sourceSalesOrderId: sales.id,
      },
    });
    const load = await db.load.create({
      data: { tenantId, loadNumber: `LD-${number}`, status: 'PLANNED' },
    });
    const shipment = await db.shipment.create({
      data: {
        tenantId,
        shipmentNumber: `SH-${number}`,
        transportOrderId: order.id,
        originLocationId: originId,
        destinationLocationId: destinationId,
        loadId: load.id,
        status: 'PLANNED',
        packageTrackingEnabledAt: new Date(),
      },
    });
    // Deliberately seeded source: this suite verifies allocation only, not WMS completion.
    const pick = await db.pickOrder.create({
      data: {
        tenantId,
        number: `PK-${number}`,
        locationId: originId,
        shipmentId: shipment.id,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
    const pickLine = await db.pickLine.create({
      data: {
        tenantId,
        pickOrderId: pick.id,
        itemId,
        fromBinId: binId,
        qty: sourceQuantity,
      },
    });
    const pkg = await db.deliveryPackage.create({
      data: {
        tenantId,
        shipmentId: shipment.id,
        code: `PACKAGE-${number}`,
        label: 'Test parcel',
        contents: contents(quantity, unit),
      },
    });
    const body = {
      operationKey: randomUUID(),
      packageId: pkg.id,
      contentIndex: 0,
      expectedVersion: pkg.version,
      sourceSalesOrderLineId: salesLine.id,
      sourcePickLineId: pickLine.id,
      expectedSalesLineUpdatedAt: salesLine.updatedAt.toISOString(),
      expectedSalesOrderUpdatedAt: sales.updatedAt.toISOString(),
      expectedPickUpdatedAt: pick.updatedAt.toISOString(),
      salesUnitAcknowledged: true,
    };
    return { sales, salesLine, order, load, shipment, pick, pickLine, pkg, body };
  }
  async function extraPackage(f: Awaited<ReturnType<typeof fixture>>, quantity: string) {
    return db.deliveryPackage.create({
      data: {
        tenantId,
        shipmentId: f.shipment.id,
        code: `EXTRA-${++serial}`,
        label: 'Extra',
        contents: contents(quantity),
      },
    });
  }
  async function transition(id: string, loadId: string, target: string) {
    const [pkg, load] = await Promise.all([
      current(id),
      db.load.findFirstOrThrow({ where: { tenantId, id: loadId } }),
    ]);
    return request(http).post(`${parcels}/${id}/transition`).set(headers()).send({
      operationKey: randomUUID(),
      expectedVersion: pkg.version,
      expectedLoadId: loadId,
      expectedLoadUpdatedAt: load.updatedAt.toISOString(),
      target,
    });
  }

  beforeAll(async () => {
    const builder = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = builder.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    db = app.get(PrismaService);
    tenantId = (await db.tenant.create({ data: { slug: prefix.toLowerCase(), name: prefix } })).id;
    foreignTenantId = (
      await db.tenant.create({
        data: { slug: `${prefix.toLowerCase()}-foreign`, name: 'Foreign allocation fixture' },
      })
    ).id;
    for (const key of ['transportation', 'crm', 'wms']) {
      moduleIds[key] = (await db.moduleDefinition.findUniqueOrThrow({ where: { key } })).id;
      await db.tenantModule.create({ data: { tenantId, moduleId: moduleIds[key], enabled: true } });
      await db.tenantModule.create({
        data: { tenantId: foreignTenantId, moduleId: moduleIds[key], enabled: true },
      });
    }
    const user = (tenant: string, name: string) =>
      db.user.create({
        data: {
          tenantId: tenant,
          email: `${name}-${prefix}@example.test`,
          passwordHash: 'not-a-login',
          firstName: name,
          lastName: 'Fixture',
        },
      });
    const actor = await user(tenantId, 'operator'),
      other = await user(tenantId, 'other'),
      foreign = await user(foreignTenantId, 'foreign');
    actorId = actor.id;
    foreignActorId = foreign.id;
    const jwt = new JwtService({ secret: app.get(ConfigService).getOrThrow('JWT_SECRET') });
    const sign = (u: typeof actor, permissions: string[]) =>
      jwt.sign(
        { sub: u.id, tenantId: u.tenantId, email: u.email, permissions },
        { expiresIn: '30m' },
      );
    token = sign(actor, ALL_PERMISSION_KEYS);
    otherToken = sign(other, ALL_PERMISSION_KEYS);
    foreignToken = sign(foreign, ALL_PERMISSION_KEYS);
    tmsToken = sign(actor, [
      PERMISSIONS.TRANSPORTATION.PLANNING_READ,
      PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE,
    ]);
    readToken = sign(actor, [PERMISSIONS.TRANSPORTATION.PLANNING_READ]);
    customerId = (await db.customer.create({ data: { tenantId, code: 'C', name: 'Customer' } })).id;
    companyId = (await db.crmCompany.create({ data: { tenantId, name: 'Company' } })).id;
    originId = (
      await db.location.create({
        data: {
          tenantId,
          code: 'O',
          name: 'Origin',
          addressLine1: '10 Origin',
          city: 'Québec',
          type: 'WAREHOUSE',
        },
      })
    ).id;
    destinationId = (
      await db.location.create({
        data: {
          tenantId,
          code: 'D',
          name: 'Destination',
          addressLine1: '20 Destination',
          city: 'Lévis',
        },
      })
    ).id;
    itemId = (
      await db.wmsItem.create({ data: { tenantId, sku: 'COMP', name: 'Component', unit: 'ea' } })
    ).id;
    binId = (await db.bin.create({ data: { tenantId, locationId: originId, code: 'A' } })).id;
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('links both sources with exact quantities, versions, audit and no stock or business status side effects', async () => {
    const f = await fixture();
    const beforeStock = await db.stockMovement.count({ where: { tenantId } });
    const receipt = (await post(f.body).expect(201)).body;
    expect(receipt).toMatchObject({ packageId: f.pkg.id, version: 2, released: false });
    const view = await workspace(f.shipment.id);
    expect(view.allocations).toHaveLength(1);
    const totals = {
      allocated: '2.125',
      delivered: '0',
      returned: '0',
      remainingToAllocate: '2.875',
      remainingToDeliver: '5',
    };
    expect(view.salesLines[0].totals).toEqual(totals);
    expect(view.pickLines[0].totals).toEqual(totals);
    expect(view.packages[0]).toMatchObject({
      version: 2,
      lockedContentIndices: [0],
      status: 'PREPARED',
    });
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(beforeStock);
    expect(
      (await db.shipment.findFirstOrThrow({ where: { tenantId, id: f.shipment.id } })).status,
    ).toBe('PLANNED');
    expect(
      (await db.salesOrder.findFirstOrThrow({ where: { tenantId, id: f.sales.id } })).status,
    ).toBe('CONFIRMED');
    expect(
      await db.auditLog.count({
        where: {
          tenantId,
          entityType: 'delivery-content-allocation',
          entityId: receipt.allocationId,
        },
      }),
    ).toBe(1);
    const saved = await db.deliveryContentAllocation.findFirstOrThrow({
      where: { tenantId, id: receipt.allocationId },
    });
    expect(saved.sourceSnapshot).toMatchObject({
      sales: { unitBasis: 'HUMAN_ATTESTED_1_TO_1', acknowledgedById: actorId },
      pick: { id: f.pickLine.id },
    });
    expect(saved.contentSnapshot).toEqual(contents('2.125')[0]);
  });

  it('replays exactly for the same actor and rejects changed content, actor or stale package/source versions', async () => {
    const f = await fixture();
    await post({ ...f.body, expectedVersion: 9 }).expect(409);
    await post({ ...f.body, expectedSalesLineUpdatedAt: '2020-01-01T00:00:00.000Z' }).expect(409);
    await post({ ...f.body, expectedPickUpdatedAt: '2020-01-01T00:00:00.000Z' }).expect(409);
    const receipt = (await post(f.body).expect(201)).body;
    expect((await post(f.body).expect(201)).body).toEqual(receipt);
    await post({ ...f.body, expectedVersion: 2 }).expect(409);
    await post(f.body, otherToken).expect(409);
    expect(
      await db.deliveryContentAllocation.count({ where: { tenantId, packageId: f.pkg.id } }),
    ).toBe(1);
  });

  it('requires source rights and tenant isolation without exposing hidden source IDs or quantities', async () => {
    const f = await fixture();
    await post(f.body).expect(201);
    const view = await workspace(f.shipment.id, tmsToken);
    expect(view.access).toEqual({ sales: false, picking: false });
    expect(view.salesLines).toEqual([]);
    expect(view.pickLines).toEqual([]);
    expect(view.allocations).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(f.salesLine.id);
    expect(JSON.stringify(view)).not.toContain(f.pickLine.id);
    expect(view.packages[0].lockedContentIndices).toEqual([0]);
    await post(f.body, tmsToken).expect(403);
    await post(f.body, readToken).expect(403);
    await request(http)
      .get(base)
      .query({ shipmentId: f.shipment.id })
      .set(headers(foreignToken))
      .expect(404);
    await post({ ...f.body, operationKey: randomUUID() }, foreignToken).expect(404);
  });

  it('validates explicit commercial attestation, source shipment/site, exact unit and request schema', async () => {
    const f = await fixture();
    const other = await fixture();
    await post({ ...f.body, salesUnitAcknowledged: false }).expect(400);
    await post({ ...f.body, sourceSalesOrderLineId: other.salesLine.id }).expect(400);
    await post({
      ...f.body,
      sourcePickLineId: other.pickLine.id,
      expectedPickUpdatedAt: other.pick.updatedAt.toISOString(),
    }).expect(400);
    const mismatch = await fixture('1', '5', 'box');
    await post(mismatch.body).expect(400);
    await post({ ...f.body, tenantId: foreignTenantId }).expect(400);
    await post({ ...f.body, operationKey: 'not-a-uuid' }).expect(400);
    await post({
      operationKey: randomUUID(),
      packageId: f.pkg.id,
      contentIndex: 0,
      expectedVersion: 1,
    }).expect(400);
    expect(
      await db.deliveryContentAllocation.count({
        where: { tenantId, packageId: { in: [f.pkg.id, mismatch.pkg.id] } },
      }),
    ).toBe(0);
  });

  it('serializes competing allocations globally so the same source cannot be over-allocated', async () => {
    const f = await fixture('3');
    const second = await extraPackage(f, '3');
    const bodies = [f.body, { ...f.body, operationKey: randomUUID(), packageId: second.id }];
    const results = await Promise.all(bodies.map((body) => post(body)));
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const view = await workspace(f.shipment.id);
    expect(view.salesLines[0].totals.allocated).toBe('3');
    expect(view.pickLines[0].totals.remainingToAllocate).toBe('2');
    expect(
      await db.deliveryContentAllocation.count({
        where: { tenantId, sourceSalesOrderLineId: f.salesLine.id, releasedAt: null },
      }),
    ).toBe(1);
  });

  it('enforces source capacity across shipments, not only the current delivery', async () => {
    const f = await fixture('3');
    await post(f.body).expect(201);
    const second = await fixture('3');
    await db.transportOrder.update({
      where: { tenantId, id: second.order.id },
      data: { sourceSalesOrderId: f.sales.id },
    });
    await post({
      ...f.body,
      operationKey: randomUUID(),
      packageId: second.pkg.id,
      sourcePickLineId: undefined,
      expectedPickUpdatedAt: undefined,
    }).expect(409);
    expect((await workspace(second.shipment.id)).salesLines[0].totals.allocated).toBe('3');
  });

  it('releases once before engagement, retains immutable history, frees capacity and replays the original receipt', async () => {
    const f = await fixture();
    const first = (await post(f.body).expect(201)).body;
    const body = { operationKey: randomUUID(), expectedVersion: 2 };
    const receipt = (await release(first.allocationId, body).expect(201)).body;
    expect(receipt).toMatchObject({ version: 3, released: true });
    expect((await release(first.allocationId, body).expect(201)).body).toEqual(receipt);
    await release(first.allocationId, {
      ...body,
      operationKey: randomUUID(),
      expectedVersion: 3,
    }).expect(409);
    await release(first.allocationId, body, otherToken).expect(409);
    const view = await workspace(f.shipment.id);
    expect(view.allocations[0].releasedAt).toBeTruthy();
    expect(view.packages[0].lockedContentIndices).toEqual([]);
    expect(view.pickLines[0].totals.allocated).toBe('0');
    await post({ ...f.body, operationKey: randomUUID(), expectedVersion: 3 }).expect(201);
    expect(
      await db.deliveryContentAllocation.count({ where: { tenantId, packageId: f.pkg.id } }),
    ).toBe(2);
  });

  it('blocks contents edits and cancellation while allocated, and never releases after a real load/unload', async () => {
    const f = await fixture();
    const first = (await post(f.body).expect(201)).body;
    await request(http)
      .patch(`${parcels}/${f.pkg.id}`)
      .set(headers())
      .send({
        operationKey: randomUUID(),
        expectedVersion: 2,
        label: 'Edited',
        contents: contents('1'),
      })
      .expect(409);
    expect((await transition(f.pkg.id, f.load.id, 'CANCELLED')).status).toBe(409);
    expect((await transition(f.pkg.id, f.load.id, 'LOADED')).status).toBe(201);
    expect((await post(f.body).expect(201)).body).toEqual(first);
    expect((await transition(f.pkg.id, f.load.id, 'PREPARED')).status).toBe(201);
    const version = (await current(f.pkg.id)).version;
    await release(first.allocationId, {
      operationKey: randomUUID(),
      expectedVersion: version,
    }).expect(409);
    const view = await workspace(f.shipment.id);
    expect(view.packages[0].canAllocate).toBe(false);
    expect(view.allocations[0].canRelease).toBe(false);
  });

  it('allows label-only correction of allocated content across actual PostgreSQL JSONB ordering', async () => {
    const f = await fixture();
    const allocated = (await post(f.body).expect(201)).body;
    await request(http).patch(`${parcels}/${f.pkg.id}`).set(headers()).send({ operationKey: randomUUID(), expectedVersion: 2, label: 'Fragile - correction', contents: contents('2.125') }).expect(200);
    const p = await current(f.pkg.id);
    expect(p.label).toBe('Fragile - correction');
    expect(p.version).toBe(3);
    expect((await workspace(f.shipment.id)).allocations.some((a: any) => a.id === allocated.allocationId && !a.releasedAt)).toBe(true);
  });

  it('preserves returned allocation capacity without counting returned goods as delivered or posting stock', async () => {
    const f = await fixture();
    await post(f.body).expect(201);
    // Fixture only: exception lifecycle has its own HTTP suite. This tests read semantics.
    await db.deliveryPackage.update({
      where: { tenantId_id: { tenantId, id: f.pkg.id } },
      data: { status: 'RETURNED', loadedLoadId: f.load.id, loadedAt: new Date() },
    });
    const view = await workspace(f.shipment.id);
    expect(view.salesLines[0].totals).toEqual({
      allocated: '2.125',
      delivered: '0',
      returned: '2.125',
      remainingToAllocate: '2.875',
      remainingToDeliver: '5',
    });
    expect(await db.stockMovement.count({ where: { tenantId } })).toBe(0);
  });

  it('keeps TMS usable without optional modules and denies a replay when source access is disabled', async () => {
    const f = await fixture();
    await post(f.body).expect(201);
    const cache = app.get(TenantModulesCacheService);
    try {
      await db.tenantModule.updateMany({
        where: { tenantId, moduleId: { in: [moduleIds.crm, moduleIds.wms] } },
        data: { enabled: false },
      });
      cache.invalidate(tenantId);
      const view = await workspace(f.shipment.id);
      expect(view.packages).toHaveLength(1);
      expect(view.access).toEqual({ sales: false, picking: false });
      expect(view.allocations).toEqual([]);
      await post(f.body).expect(403);
      await request(http).get(parcels).query({ loadId: f.load.id }).set(headers()).expect(200);
    } finally {
      await db.tenantModule.updateMany({
        where: { tenantId, moduleId: { in: [moduleIds.crm, moduleIds.wms] } },
        data: { enabled: true },
      });
      cache.invalidate(tenantId);
    }
  });

  it('enforces immutable evidence and composite tenant foreign keys directly in PostgreSQL', async () => {
    const f = await fixture();
    const first = (await post(f.body).expect(201)).body;
    const where = { tenantId, id: first.allocationId };
    await expect(
      db.deliveryContentAllocation.updateMany({
        where,
        data: { sourceSnapshot: { changed: true } },
      }),
    ).rejects.toThrow();
    await expect(
      db.deliveryContentAllocation.updateMany({ where, data: { quantity: '99' } }),
    ).rejects.toThrow();
    await expect(db.deliveryContentAllocation.deleteMany({ where })).rejects.toThrow();
    await expect(
      db.deliveryContentAllocation.updateMany({ where, data: { releasedAt: new Date() } }),
    ).rejects.toThrow();
    await expect(
      db.deliveryAllocationOperation.updateMany({
        where: { tenantId, allocationId: first.allocationId },
        data: { result: { changed: true } },
      }),
    ).rejects.toThrow();
    await expect(
      db.deliveryContentAllocation.create({
        data: {
          tenantId: foreignTenantId,
          packageId: f.pkg.id,
          contentIndex: 0,
          sourceSalesOrderLineId: f.salesLine.id,
          quantity: '1',
          unit: 'ea',
          sourceSnapshot: {},
          contentSnapshot: {},
          actorId: foreignActorId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.deliveryContentAllocation.create({
        data: {
          tenantId,
          packageId: f.pkg.id,
          contentIndex: 0,
          sourceSalesOrderLineId: f.salesLine.id,
          quantity: '1',
          unit: 'ea',
          sourceSnapshot: {},
          contentSnapshot: {},
          actorId,
        },
      }),
    ).rejects.toThrow();
    expect((await current(f.pkg.id)).version).toBe(2);
  });
});
