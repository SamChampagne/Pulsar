/** Dedicated disposable tenant; real SQL constraints, memory-only PDF storage. No providers. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import { ALL_PERMISSION_KEYS, PERMISSIONS, type DriverDocumentRecord } from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FILE_STORAGE } from '../src/core/documents/storage/file-storage';
import { DocumentsService } from '../src/core/documents/documents.service';
import { AuditLogsService } from '../src/core/audit-logs/audit-logs.service';
import { SequencesService } from '../src/prisma/sequences.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { DriverDocumentsService } from '../src/modules/transportation/driver-documents/driver-documents.service';
import { DriverAccessService } from '../src/modules/transportation/public/driver-access.service';

describe('Driver documents HTTP/SQL', () => {
  let app: INestApplication, http: any, db: PrismaService;
  let tenantId: string,
    actorId: string,
    moduleId: string,
    token: string,
    readToken: string,
    otherActorToken: string,
    foreignToken: string;
  let loadId: string,
    destinationId: string,
    shipmentId: string,
    packageId: string,
    driverToken = randomBytes(24).toString('base64url');
  let first: DriverDocumentRecord, latest: DriverDocumentRecord, firstBody: any, firstRef: string;
  const suffix = `DRDOC-${Date.now().toString(36)}-${randomUUID().slice(0, 5)}`;
  const blobs = new Map<string, Buffer>();
  const storage = {
    put: jest.fn(async (key: string, body: Buffer) => {
      blobs.set(key, Buffer.from(body));
    }),
    get: jest.fn(async (key: string) => {
      const bytes = blobs.get(key);
      if (!bytes) throw new Error('Unavailable fixture');
      return Readable.from([Buffer.from(bytes)]);
    }),
    delete: jest.fn(async () => {}),
    getDownloadUrl: jest.fn(async () => null),
    getUploadUrl: jest.fn(async () => null),
  };
  const base = () => `/api/v1/transportation/loads/${loadId}/driver-documents`;
  const publicBase = () => `/api/v1/public/driver/${driverToken}/documents`;
  const headers = (jwt = token) => ({ Authorization: `Bearer ${jwt}` });
  const preview = async () =>
    (await request(http).get(`${base()}/preview`).set(headers()).expect(200)).body;
  const bodyFor = (view: any) => ({
    operationKey: randomUUID(),
    sourceHash: view.sourceHash,
    expectedLoadUpdatedAt: view.snapshot.load.updatedAt,
    reason: 'PRIVATE_ISSUANCE_REASON',
    confirmDriverPublication: true as const,
  });
  const issue = async () =>
    (
      await request(http)
        .post(base())
        .set(headers())
        .send(bodyFor(await preview()))
        .expect(201)
    ).body as DriverDocumentRecord;
  const prepare = (id: string) =>
    request(http).post(`${base()}/${id}/file`).set(headers()).send({});
  const parseBinary = (res: any, done: any) => {
    const buffers: Buffer[] = [];
    res.on('data', (b: Buffer) => buffers.push(Buffer.from(b)));
    res.on('end', () => done(null, Buffer.concat(buffers)));
  };

  beforeAll(async () => {
    const builder = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FILE_STORAGE)
      .useValue(storage)
      .compile();
    app = builder.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    db = app.get(PrismaService);
    moduleId = (await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'transportation' } }))
      .id;
    tenantId = (await db.tenant.create({ data: { slug: suffix.toLowerCase(), name: suffix } })).id;
    await db.tenantModule.create({ data: { tenantId, moduleId, enabled: true } });
    const user = (tenant: string, name: string) =>
      db.user.create({
        data: {
          tenantId: tenant,
          email: `${name}-${suffix}@example.test`,
          passwordHash: 'not-a-login',
          firstName: name,
          lastName: 'Fixture',
        },
      });
    const actor = await user(tenantId, 'operator');
    actorId = actor.id;
    const jwt = new JwtService({ secret: app.get(ConfigService).getOrThrow('JWT_SECRET') });
    const sign = (actor: { id: string; tenantId: string; email: string }, permissions: string[]) =>
      jwt.sign(
        { sub: actor.id, tenantId: actor.tenantId, email: actor.email, permissions },
        { expiresIn: '30m' },
      );
    token = sign(actor, ALL_PERMISSION_KEYS);
    readToken = sign(actor, [PERMISSIONS.TRANSPORTATION.PLANNING_READ]);
    otherActorToken = sign(await user(tenantId, 'other'), ALL_PERMISSION_KEYS);
    const foreignTenant = await db.tenant.create({
      data: { slug: `${suffix.toLowerCase()}-foreign`, name: 'Foreign document fixture' },
    });
    await db.tenantModule.create({ data: { tenantId: foreignTenant.id, moduleId, enabled: true } });
    foreignToken = sign(await user(foreignTenant.id, 'foreign'), ALL_PERMISSION_KEYS);
    const customer = await db.customer.create({
      data: { tenantId, code: 'C-1', name: 'Fixture customer' },
    });
    const origin = await db.location.create({
      data: {
        tenantId,
        code: 'ORIGIN',
        name: 'Atelier',
        addressLine1: '10 Rue Atelier',
        city: 'Québec',
      },
    });
    const destination = await db.location.create({
      data: {
        tenantId,
        code: 'DESTINATION',
        name: 'Dépôt',
        addressLine1: '20 Rue Destination',
        city: 'Lévis',
      },
    });
    destinationId = destination.id;
    const driver = await db.driver.create({
      data: {
        tenantId,
        firstName: 'Renée',
        lastName: 'Roy',
        email: 'PRIVATE_DRIVER_EMAIL@example.test',
        phone: 'PRIVATE_PHONE',
      },
    });
    const load = await db.load.create({
      data: {
        tenantId,
        loadNumber: 'LD-1',
        driverId: driver.id,
        driverToken,
        status: 'DISPATCHED',
        notes: 'PRIVATE_LOAD_NOTES',
        estimatedCost: '934.22',
      },
    });
    loadId = load.id;
    const order = await db.transportOrder.create({
      data: {
        tenantId,
        customerId: customer.id,
        orderNumber: 'TO-1',
        originLocationId: origin.id,
        destinationLocationId: destination.id,
        notes: 'PRIVATE_ORDER_NOTES',
      },
    });
    const shipment = await db.shipment.create({
      data: {
        tenantId,
        shipmentNumber: 'SH-1',
        transportOrderId: order.id,
        originLocationId: origin.id,
        destinationLocationId: destination.id,
        loadId,
        status: 'DISPATCHED',
        packageTrackingEnabledAt: new Date(),
      },
    });
    shipmentId = shipment.id;
    packageId = (
      await db.deliveryPackage.create({
        data: {
          tenantId,
          shipmentId,
          code: 'PKG-000001',
          label: 'PRIVATE_PACKAGE_LABEL',
          contents: [
            {
              reference: 'PRIVATE_REFERENCE',
              description: 'PRIVATE_CONTENT',
              quantity: '1',
              unit: 'piece',
            },
          ],
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('previews a closed safe allowlist, with no private data or internal identities', async () => {
    const view = await preview(),
      serialized = JSON.stringify(view.snapshot);
    expect(view.canIssue).toBe(true);
    expect(view.snapshot.shipments[0].packageCodes).toEqual(['PKG-000001']);
    for (const secret of [
      'PRIVATE_',
      tenantId,
      actorId,
      loadId,
      shipmentId,
      packageId,
      driverToken,
      '934.22',
    ])
      expect(serialized).not.toContain(secret);
    await request(http).get(base()).set(headers(foreignToken)).expect(404);
  });
  it('requires explicit confirmation/read+manage and catches stale address previews', async () => {
    const view = await preview(),
      body = bodyFor(view);
    await request(http).post(base()).set(headers(readToken)).send(body).expect(403);
    await request(http)
      .post(base())
      .set(headers())
      .send({ ...body, confirmDriverPublication: false })
      .expect(400);
    await db.location.update({
      where: { tenantId, id: destinationId },
      data: { addressLine1: '21 Rue Destination' },
    });
    await request(http).post(base()).set(headers()).send(body).expect(409);
  });
  it('issues once, replays exactly and rejects another actor/body for that key', async () => {
    firstBody = bodyFor(await preview());
    first = (await request(http).post(base()).set(headers()).send(firstBody).expect(201)).body;
    latest = first;
    expect(
      (await request(http).post(base()).set(headers()).send(firstBody).expect(201)).body.id,
    ).toBe(first.id);
    await request(http).post(base()).set(headers(otherActorToken)).send(firstBody).expect(409);
    await request(http)
      .post(base())
      .set(headers())
      .send({ ...firstBody, reason: 'changed' })
      .expect(409);
    expect(await db.driverDeliveryDocument.count({ where: { tenantId, loadId } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { tenantId, entityType: 'driver-delivery-document', entityId: first.id },
      }),
    ).toBe(1);
  });
  it('publishes only opaque latest metadata; driver cannot generate PDF or use raw identity', async () => {
    const view = (await request(http).get(publicBase()).expect(200)).body;
    firstRef = view.documents[0].ref;
    expect(firstRef).not.toBe(first.id);
    expect(view.documents[0].ready).toBe(false);
    for (const secret of ['PRIVATE_', tenantId, actorId, loadId, first.id, driverToken])
      expect(JSON.stringify(view)).not.toContain(secret);
    await request(http).get(`${publicBase()}/${first.id}/file`).expect(404);
    await request(http).get(`${publicBase()}/${firstRef}/file`).expect(409);
    await request(http).post(`${publicBase()}/${firstRef}/file`).send({}).expect(404);
  });
  it('serializes PDF generation, serves identical canonical bytes internally/publicly and keeps BOL blocked', async () => {
    const before = storage.put.mock.calls.length;
    const responses = await Promise.all([prepare(first.id), prepare(first.id)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(storage.put).toHaveBeenCalledTimes(before + 1);
    const internal = await request(http)
      .get(`${base()}/${first.id}/file`)
      .set(headers(readToken))
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    const external = await request(http)
      .get(`${publicBase()}/${firstRef}/file`)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    expect(external.body).toEqual(internal.body);
    expect(external.headers['cache-control']).toContain('no-store');
    await request(http).get(`/api/v1/public/driver/${driverToken}/bol`).expect(409);
  });
  it('preserves publication across normal progress but invalidates changed addresses and never rewrites old PDF', async () => {
    await db.load.update({ where: { tenantId, id: loadId }, data: { status: 'IN_TRANSIT' } });
    expect((await request(http).get(publicBase()).expect(200)).body.documents[0].ref).toBe(
      firstRef,
    );
    await db.location.update({
      where: { tenantId, id: destinationId },
      data: { addressLine1: '22 Nouvelle destination' },
    });
    expect((await request(http).get(publicBase()).expect(200)).body.documents).toEqual([]);
    await request(http).get(`${publicBase()}/${firstRef}/file`).expect(409);
    expect(
      (await request(http).post(base()).set(headers()).send(firstBody).expect(201)).body.id,
    ).toBe(first.id);
    latest = await issue();
    await prepare(latest.id).expect(201);
    await request(http).get(`${publicBase()}/${firstRef}/file`).expect(404);
    expect(
      (await request(http).get(`${base()}/${first.id}`).set(headers()).expect(200)).body.snapshot,
    ).toEqual(first.snapshot);
  });
  it('rechecks module and tenant activation without trusting module cache', async () => {
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      data: { enabled: false },
    });
    await request(http).get(publicBase()).expect(403);
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      data: { enabled: true },
    });
    await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    await request(http).get(publicBase()).expect(403);
    await db.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
  });
  it('refuses revoked tokens even if revocation happens during PDF storage read', async () => {
    const ref = (await request(http).get(publicBase()).expect(200)).body.documents[0].ref,
      oldToken = driverToken;
    storage.get.mockImplementationOnce(async (key) => {
      driverToken = randomBytes(24).toString('base64url');
      await db.load.update({ where: { tenantId, id: loadId }, data: { driverToken } });
      return Readable.from([Buffer.from(blobs.get(key)!)]);
    });
    await request(http).get(`/api/v1/public/driver/${oldToken}/documents/${ref}/file`).expect(404);
    await request(http).get(`/api/v1/public/driver/${oldToken}/documents`).expect(404);
    expect((await request(http).get(publicBase()).expect(200)).body.documents[0].ref).not.toBe(ref);
  });
  it('protects canonical PDF against generic upload/read/delete and rejects corrupted bytes', async () => {
    const row = await db.driverDeliveryDocument.findFirstOrThrow({
      where: { tenantId, id: latest.id },
    });
    const doc = await db.document.findFirstOrThrow({ where: { tenantId, id: row.documentId! } });
    for (const path of [
      `/api/v1/documents/${doc.id}/download`,
      `/api/v1/documents/${doc.id}/download-url`,
      `/api/v1/documents?entityType=${doc.entityType}&entityId=${latest.id}`,
    ])
      await request(http).get(path).set(headers()).expect(403);
    await request(http).delete(`/api/v1/documents/${doc.id}`).set(headers()).expect(403);
    await request(http)
      .post('/api/v1/documents/presign-upload')
      .set(headers())
      .send({
        entityType: doc.entityType,
        entityId: latest.id,
        fileName: 'fake.pdf',
        mimeType: 'application/pdf',
      })
      .expect(403);
    const bytes = blobs.get(doc.storageKey)!;
    blobs.set(doc.storageKey, Buffer.from('corrupt'));
    try {
      await request(http).get(`${base()}/${latest.id}/file`).set(headers()).expect(409);
      await prepare(latest.id).expect(409);
    } finally {
      blobs.set(doc.storageKey, bytes);
    }
    await expect(
      db.driverDeliveryDocument.update({
        where: { tenantId, id: latest.id },
        data: { reason: 'rewrite' },
      }),
    ).rejects.toThrow();
    await expect(
      db.driverDeliveryDocument.update({
        where: { tenantId, id: latest.id },
        data: { documentId: null, fileHash: null },
      }),
    ).rejects.toThrow();
  });
  it('supports a one-connection database pool without holding the connection across file verification', async () => {
    await db.location.update({
      where: { tenantId, id: destinationId },
      data: { addressLine1: '23 Pool unique' },
    });
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('connection_limit', '1');
    url.searchParams.set('pool_timeout', '5');
    const single = new PrismaService({ datasources: { db: { url: url.toString() } } });
    try {
      const service = new DriverDocumentsService(
        single,
        new SequencesService(single, app.get(TenantModulesCacheService)),
        new AuditLogsService(single),
        new DocumentsService(single, storage),
        new DriverAccessService(single),
      );
      const view = await service.preview(tenantId, loadId);
      latest = await service.issue(tenantId, actorId, loadId, bodyFor(view));
      await service.prepareFile(tenantId, actorId, loadId, latest.id);
      const list = await service.publicList(driverToken),
        file = await service.publicDownload(driverToken, list.documents[0].ref);
      expect(file.body.subarray(0, 5).toString()).toBe('%PDF-');
    } finally {
      await single.$disconnect();
    }
  });
  it('keeps internal archives but blocks new/public documents on closed loads', async () => {
    const view = await preview();
    await db.load.update({ where: { tenantId, id: loadId }, data: { status: 'COMPLETED' } });
    await request(http).post(base()).set(headers()).send(bodyFor(view)).expect(409);
    await request(http).get(publicBase()).expect(409);
    await request(http).get(`${base()}/${first.id}/file`).set(headers()).expect(200);
  });
});
