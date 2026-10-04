/** HTTP + real PostgreSQL. Run only on a disposable migrated/seeded database.
 * All fixtures use a dedicated tenant; file storage and road routing are memory doubles.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  type DeliveryManifestPreview,
  type DeliveryManifestRecord,
} from '@pulsar/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SequencesService } from '../src/prisma/sequences.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../src/core/audit-logs/audit-logs.service';
import { DocumentsService } from '../src/core/documents/documents.service';
import { FILE_STORAGE } from '../src/core/documents/storage/file-storage';
import { RoutingService } from '../src/core/routing/routing.service';
import { DeliveryManifestsService } from '../src/modules/transportation/delivery-manifests/delivery-manifests.service';

describe('Delivery manifests (HTTP + database)', () => {
  let app: INestApplication, http: any, db: PrismaService;
  let tenantId: string, moduleId: string, token: string, readToken: string, noReadToken: string;
  let secondActorToken: string, foreignToken: string, foreignLoadId: string;
  let loadId: string, shipmentId: string, destinationId: string, driverId: string;
  let packageId: string, first: DeliveryManifestRecord, second: DeliveryManifestRecord;
  let firstBody: Record<string, unknown>, frozenSnapshot: unknown;
  const suffix = `MF${Date.now().toString(36)}${randomUUID().slice(0, 5)}`;
  const transport = '/api/v1/transportation';
  const packages = `${transport}/delivery-packages`;
  const url = (id = loadId) => `${transport}/loads/${id}/manifests`;
  const fileUrl = (id: string, kind = 'manifest') => `${url()}/${id}/files/${kind}`;
  const headers = (auth = token) => ({ Authorization: `Bearer ${auth}` });
  const contents = [
    { reference: 'CMP-1', description: 'Supports atelier', quantity: '40', unit: 'piece' },
  ];
  const blobs = new Map<string, Buffer>();
  const storage = {
    put: jest.fn(async (key: string, body: Buffer) => {
      blobs.set(key, Buffer.from(body));
    }),
    get: jest.fn(async (key: string) => {
      const body = blobs.get(key);
      if (!body) throw new Error('Fixture file is unavailable');
      return Readable.from([Buffer.from(body)]);
    }),
    delete: jest.fn(async (key: string) => {
      blobs.delete(key);
    }),
    getDownloadUrl: jest.fn(async () => null),
    getUploadUrl: jest.fn(async () => null),
  };
  const routing = {
    geocode: jest.fn(async () => null),
    route: jest.fn(async (points: unknown[]) => ({
      distanceKm: (points.length - 1) * 20,
      durationMin: (points.length - 1) * 15,
      geometry: null,
      legs: points.slice(1).map(() => ({ distanceKm: 20, durationMin: 15 })),
    })),
    table: jest.fn(async () => null),
  };
  const preview = async (id = loadId): Promise<DeliveryManifestPreview> =>
    (
      await request(http)
        .get(`${url(id)}/preview`)
        .set(headers())
        .expect(200)
    ).body;
  const bodyFor = (view: DeliveryManifestPreview, reason = 'Préparation tournée de test') => ({
    operationKey: randomUUID(),
    sourceHash: view.sourceHash,
    expectedLoadUpdatedAt: view.snapshot.load.updatedAt,
    reason,
  });
  const publish = (body: Record<string, unknown>, auth = token, id = loadId) =>
    request(http).post(url(id)).set(headers(auth)).send(body);
  const record = async (id: string): Promise<DeliveryManifestRecord> =>
    (await request(http).get(`${url()}/${id}`).set(headers()).expect(200)).body;
  const binary = (id: string, kind = 'manifest', auth = token) =>
    request(http)
      .get(fileUrl(id, kind))
      .set(headers(auth))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RoutingService)
      .useValue(routing)
      .overrideProvider(FILE_STORAGE)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    db = app.get(PrismaService);
    moduleId = (await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'transportation' } }))
      .id;
    const tenant = await db.tenant.create({
      data: { slug: suffix.toLowerCase(), name: 'Distribution manifests fixture' },
    });
    tenantId = tenant.id;
    await db.tenantModule.create({
      data: {
        tenantId,
        moduleId,
        enabled: true,
        settings: {
          requireTendering: 'OPTIONAL',
          bolRequiredBeforeDispatch: false,
          podRequiredBeforeCompletion: false,
        },
      },
    });
    const createUser = (tenantId: string, label: string) =>
      db.user.create({
        data: {
          tenantId,
          email: `${label}-${suffix}@example.test`,
          passwordHash: 'fixture-not-a-login',
          firstName: label,
          lastName: 'Recette',
        },
      });
    const actor = await createUser(tenantId, 'Opérateur');
    const otherActor = await createUser(tenantId, 'Second');
    const jwt = new JwtService({ secret: app.get(ConfigService).getOrThrow('JWT_SECRET') });
    const sign = (user: { id: string; tenantId: string; email: string }, permissions: string[]) =>
      jwt.sign(
        { sub: user.id, tenantId: user.tenantId, email: user.email, permissions },
        { expiresIn: '30m' },
      );
    token = sign(actor, ALL_PERMISSION_KEYS);
    readToken = sign(actor, [PERMISSIONS.TRANSPORTATION.PLANNING_READ]);
    noReadToken = sign(actor, [PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE]);
    secondActorToken = sign(otherActor, ALL_PERMISSION_KEYS);
    const foreign = await db.tenant.create({
      data: { slug: `${suffix.toLowerCase()}-foreign`, name: 'Foreign fixture' },
    });
    await db.tenantModule.create({ data: { tenantId: foreign.id, moduleId, enabled: true } });
    foreignToken = sign(await createUser(foreign.id, 'Étranger'), ALL_PERMISSION_KEYS);
    foreignLoadId = (
      await db.load.create({ data: { tenantId: foreign.id, loadNumber: 'LD-FOREIGN' } })
    ).id;

    const customer = (
      await request(http)
        .post(`${transport}/customers`)
        .set(headers())
        .send({ code: `${suffix}-C`, name: 'Distributeur de test' })
        .expect(201)
    ).body;
    const locationIds: string[] = [];
    for (const [code, name, address, latitude] of [
      ['A', 'Atelier origine', '10 Rue Origine', 45],
      ['B', 'Dépôt destinataire', '20 Rue Historique', 46],
    ] as const) {
      locationIds.push(
        (
          await request(http)
            .post(`${transport}/locations`)
            .set(headers())
            .send({
              code: `${suffix}-${code}`,
              name,
              type: 'WAREHOUSE',
              addressLine1: address,
              city: 'Laval',
              state: 'QC',
              country: 'CA',
              postalCode: 'H7A 1A1',
              latitude,
              longitude: -73,
            })
            .expect(201)
        ).body.id,
      );
    }
    destinationId = locationIds[1];
    const order = (
      await request(http)
        .post(`${transport}/transport-orders`)
        .set(headers())
        .send({
          customerId: customer.id,
          originLocationId: locationIds[0],
          destinationLocationId: destinationId,
          totalWeightKg: 100,
          palletCount: 1,
        })
        .expect(201)
    ).body;
    await request(http)
      .post(`${transport}/transport-orders/${order.id}/confirm`)
      .set(headers())
      .expect(201);
    shipmentId = (
      await request(http)
        .post(`${transport}/transport-orders/${order.id}/plan`)
        .set(headers())
        .send({})
        .expect(201)
    ).body.shipments[0].id;
    loadId = (await request(http).post(`${transport}/loads`).set(headers()).send({}).expect(201))
      .body.id;
    await request(http)
      .post(`${transport}/shipments/${shipmentId}/assign-load`)
      .set(headers())
      .send({ loadId })
      .expect(201);
    driverId = (
      await db.driver.create({ data: { tenantId, firstName: 'Camille', lastName: 'Historique' } })
    ).id;
    const vehicle = await db.vehicle.create({ data: { tenantId, unitNumber: `${suffix}-TRUCK` } });
    await request(http)
      .post(`${transport}/loads/${loadId}/assign`)
      .set(headers())
      .send({ driverId, vehicleId: vehicle.id })
      .expect(201);
    const load = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    await request(http)
      .post(`${transport}/routes`)
      .set(headers())
      .send({
        loadId,
        expectedUpdatedAt: load.updatedAt.toISOString(),
        planning: { startAt: '2026-10-02T12:00:00Z', serviceMinutes: 15 },
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: locationIds[0], shipmentId },
          { sequence: 2, type: 'DELIVERY', locationId: destinationId, shipmentId },
        ],
      })
      .expect(201);
    for (let index = 0; index < 2; index++) {
      const shipment = await db.shipment.findFirstOrThrow({ where: { tenantId, id: shipmentId } });
      const p = (
        await request(http)
          .post(`${packages}/shipment/${shipmentId}`)
          .set(headers())
          .send({
            operationKey: randomUUID(),
            expectedUpdatedAt: shipment.updatedAt.toISOString(),
            label: `Carton historique ${index + 1}`,
            contents,
          })
          .expect(201)
      ).body;
      if (!index) packageId = p.packageId;
    }
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('requires source read permissions, separately gates publication, and scopes the parent load', async () => {
    await request(http).get(`${url()}/preview`).set(headers(readToken)).expect(200);
    await request(http).get(`${url()}/preview`).set(headers(noReadToken)).expect(403);
    await request(http).get(url()).set(headers(noReadToken)).expect(403);
    const body = bodyFor(await preview());
    await publish(body, readToken).expect(403);
    await publish(body, noReadToken).expect(403);
    await request(http)
      .get(`${url(foreignLoadId)}/preview`)
      .set(headers())
      .expect(404);
    await request(http).get(`${url()}/preview`).set(headers(foreignToken)).expect(404);
    await publish(body, token, foreignLoadId).expect(404);
    expect(await db.deliveryManifest.count({ where: { tenantId } })).toBe(0);
  });

  it('validates the closed publication contract without accepting a body tenant', async () => {
    const body = bodyFor(await preview());
    await publish({ ...body, operationKey: 'not-a-uuid' }).expect(400);
    await publish({ ...body, sourceHash: 'not-a-hash' }).expect(400);
    await publish({ ...body, expectedLoadUpdatedAt: 'yesterday' }).expect(400);
    await publish({ ...body, reason: '' }).expect(400);
    await publish({ ...body, reason: 'x'.repeat(301) }).expect(400);
    await publish({ ...body, tenantId }).expect(400);
    expect(await db.deliveryManifest.count({ where: { tenantId } })).toBe(0);
  });

  it('invalidates a preview when a location changes without advancing Load.updatedAt', async () => {
    const before = await preview();
    await request(http)
      .patch(`${transport}/locations/${destinationId}`)
      .set(headers())
      .send({ addressLine1: '30 Rue Capturée' })
      .expect(200);
    const after = await preview();
    expect(after.snapshot.load.updatedAt).toBe(before.snapshot.load.updatedAt);
    expect(after.sourceHash).not.toBe(before.sourceHash);
    await publish(bodyFor(before)).expect(409);
  });

  it('rejects a stale load version even when the caller has a current source hash', async () => {
    const before = await preview();
    await request(http)
      .patch(`${transport}/loads/${loadId}`)
      .set(headers())
      .send({
        notes: 'Instructions de la tournée',
        expectedUpdatedAt: before.snapshot.load.updatedAt,
      })
      .expect(200);
    const after = await preview();
    await publish({
      ...bodyFor(after),
      expectedLoadUpdatedAt: before.snapshot.load.updatedAt,
    }).expect(409);
  });

  it('issues one immutable snapshot and replays the same actor/body/key before current versions', async () => {
    const view = await preview();
    expect(view.canIssue).toBe(true);
    expect(view.blockers).toEqual([]);
    firstBody = bodyFor(view);
    first = (await publish(firstBody).expect(201)).body;
    expect(first).toMatchObject({
      revision: 1,
      reason: firstBody.reason,
      sourceHash: view.sourceHash,
    });
    expect(first.number).toEqual(expect.any(String));
    expect(first.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.snapshot.shipments[0].packages).toHaveLength(2);
    expect(first.snapshot.shipments[0].destination.addressLine1).toBe('30 Rue Capturée');
    frozenSnapshot = JSON.parse(JSON.stringify(first.snapshot));
    expect((await publish(firstBody).expect(201)).body.id).toBe(first.id);
    await publish({ ...firstBody, reason: 'Corps différent' }).expect(409);
    await publish(firstBody, secondActorToken).expect(409);
    expect(
      await db.deliveryManifest.count({
        where: { tenantId, operationKey: firstBody.operationKey as string },
      }),
    ).toBe(1);
    expect(storage.put).not.toHaveBeenCalled();
    expect(
      await db.auditLog.count({
        where: { tenantId, entityType: 'delivery-manifest', entityId: first.id, action: 'CREATE' },
      }),
    ).toBe(1);
  });

  it('does not create a duplicate edition with a new key when the captured source is unchanged', async () => {
    const view = await preview();
    expect(view.canIssue).toBe(false);
    expect(view.sourceHash).toBe(first.sourceHash);
    await publish(bodyFor(view, 'Demande redondante')).expect(409);
    expect(await db.deliveryManifest.count({ where: { tenantId, loadId } })).toBe(1);
  });

  it('keeps captured addresses/driver/package contents while remanifesting current data', async () => {
    await request(http)
      .patch(`${transport}/locations/${destinationId}`)
      .set(headers())
      .send({ addressLine1: '99 Rue Courante' })
      .expect(200);
    await request(http)
      .patch(`${transport}/drivers/${driverId}`)
      .set(headers())
      .send({ firstName: 'Nouveau', lastName: 'Chauffeur' })
      .expect(200);
    const p = await db.deliveryPackage.findFirstOrThrow({ where: { tenantId, id: packageId } });
    await request(http)
      .patch(`${packages}/${packageId}`)
      .set(headers())
      .send({
        operationKey: randomUUID(),
        expectedVersion: p.version,
        label: 'Carton corrigé',
        contents: [{ ...contents[0], quantity: '25' }],
      })
      .expect(200);
    expect((await record(first.id)).snapshot).toEqual(frozenSnapshot);
    expect((await publish(firstBody).expect(201)).body.id).toBe(first.id);
    const latest = await preview();
    expect(latest.sourceHash).not.toBe(first.sourceHash);
    second = (await publish(bodyFor(latest, 'Nouvelle version après modification')).expect(201))
      .body;
    expect(second.revision).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(second.snapshot.shipments[0].destination.addressLine1).toBe('99 Rue Courante');
    expect((await record(first.id)).snapshot).toEqual(frozenSnapshot);
  });

  it('returns paginated history and never resolves a manifest through another load or tenant', async () => {
    const page = (
      await request(http)
        .get(url())
        .query({ page: 1, pageSize: 1 })
        .set(headers(readToken))
        .expect(200)
    ).body;
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty('snapshot');
    await request(http).get(`${url()}/${first.id}`).set(headers(foreignToken)).expect(404);
    await request(http)
      .get(`${url(foreignLoadId)}/${first.id}`)
      .set(headers())
      .expect(404);
    const otherLoad = await db.load.create({ data: { tenantId, loadNumber: `${suffix}-OTHER` } });
    await request(http)
      .get(`${url(otherLoad.id)}/${first.id}`)
      .set(headers())
      .expect(404);
  });

  it('deduplicates simultaneous publication requests under the same UUID', async () => {
    await request(http)
      .patch(`${transport}/locations/${destinationId}`)
      .set(headers())
      .send({ addressLine1: '100 Rue Concurrence' })
      .expect(200);
    const body = bodyFor(await preview(), 'Recette concurrence publication');
    const results = await Promise.all([publish(body), publish(body)]);
    expect(results.some((r) => r.status === 201)).toBe(true);
    // Under RepeatableRead a waiter can receive a controlled conflict instead of a replay.
    expect(results.every((r) => [201, 409].includes(r.status))).toBe(true);
    const winner = results.find((r) => r.status === 201)!.body;
    expect(
      await db.deliveryManifest.count({ where: { tenantId, operationKey: body.operationKey } }),
    ).toBe(1);
    expect((await publish(body).expect(201)).body.id).toBe(winner.id);
  });

  it.each(['manifest', 'labels'])(
    'renders %s explicitly, then serves identical canonical bytes from cache',
    async (kind) => {
      await request(http).get(fileUrl(first.id, kind)).set(headers(readToken)).expect(409);
      await request(http)
        .post(fileUrl(first.id, kind))
        .set(headers(readToken))
        .send({})
        .expect(403);
      await request(http)
        .post(fileUrl(first.id, kind))
        .set(headers(noReadToken))
        .send({})
        .expect(403);
      const generated = await request(http)
        .post(fileUrl(first.id, kind))
        .set(headers())
        .send({})
        .expect(201);
      expect(generated.body).toEqual({ ready: true });
      const one = await binary(first.id, kind, readToken)
        .expect(200)
        .expect('Content-Type', /application\/pdf/);
      expect((one.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
      const writes = storage.put.mock.calls.length;
      await request(http).post(fileUrl(first.id, kind)).set(headers()).send({}).expect(201);
      const two = await binary(first.id, kind, readToken).expect(200);
      expect(two.body).toEqual(one.body);
      expect(storage.put).toHaveBeenCalledTimes(writes);
      expect((await record(first.id)).snapshot).toEqual(frozenSnapshot);
      await request(http).get(fileUrl(first.id, kind)).set(headers(foreignToken)).expect(404);
    },
  );

  it('keeps canonical manifest/label files out of generic document endpoints', async () => {
    const manifest = await db.deliveryManifest.findFirstOrThrow({
      where: { tenantId, id: first.id },
    });
    for (const id of [manifest.manifestDocumentId!, manifest.labelsDocumentId!]) {
      const doc = await db.document.findFirstOrThrow({ where: { tenantId, id } });
      await request(http)
        .get('/api/v1/documents')
        .query({ entityType: doc.entityType, entityId: doc.entityId })
        .set(headers())
        .expect(403);
      await request(http).get(`/api/v1/documents/${id}/download`).set(headers()).expect(403);
      await request(http).get(`/api/v1/documents/${id}/download-url`).set(headers()).expect(403);
      await request(http).delete(`/api/v1/documents/${id}`).set(headers()).expect(403);
      await request(http)
        .post('/api/v1/documents/presign-upload')
        .set(headers())
        .send({
          entityType: doc.entityType,
          entityId: doc.entityId,
          fileName: 'fake.pdf',
          mimeType: 'application/pdf',
        })
        .expect(403);
      await request(http)
        .post('/api/v1/documents/confirm-upload')
        .set(headers())
        .send({
          entityType: doc.entityType,
          entityId: doc.entityId,
          fileName: 'fake.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1,
          storageKey: doc.storageKey,
        })
        .expect(403);
      await request(http)
        .post('/api/v1/documents/upload')
        .set(headers())
        .field('entityType', doc.entityType)
        .field('entityId', doc.entityId)
        .attach('file', Buffer.from('%PDF-test'), {
          filename: 'fake.pdf',
          contentType: 'application/pdf',
        })
        .expect(403);
    }
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('serializes concurrent generation to a single canonical labels file', async () => {
    const writes = storage.put.mock.calls.length;
    const results = await Promise.all([
      request(http).post(fileUrl(second.id, 'labels')).set(headers()).send({}),
      request(http).post(fileUrl(second.id, 'labels')).set(headers()).send({}),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(storage.put).toHaveBeenCalledTimes(writes + 1);
    expect(
      await db.document.count({
        where: { tenantId, entityType: 'delivery-labels-pdf', entityId: second.id },
      }),
    ).toBe(1);
  });

  it('enforces issued snapshot and canonical file immutability at the SQL boundary', async () => {
    const original = await db.deliveryManifest.findFirstOrThrow({
      where: { tenantId, id: first.id },
    });
    await expect(
      db.deliveryManifest.update({
        where: { id: first.id, tenantId },
        data: { snapshot: { schemaVersion: 1, compromised: true } },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.deliveryManifest.update({
        where: { id: first.id, tenantId },
        data: { reason: 'Réécriture interdite' },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.deliveryManifest.update({
        where: { id: first.id, tenantId },
        data: { manifestDocumentId: null, manifestFileHash: null },
      }),
    ).rejects.toThrow(/only be bound once/);
    expect((await record(first.id)).snapshot).toEqual(frozenSnapshot);
    expect(
      (await db.deliveryManifest.findFirstOrThrow({ where: { tenantId, id: first.id } }))
        .manifestDocumentId,
    ).toBe(original.manifestDocumentId);
  });

  it('enforces snapshot schema and paired canonical document/hash checks in SQL', async () => {
    const source = await db.deliveryManifest.findFirstOrThrow({
      where: { tenantId, id: first.id },
    });
    const invalid = {
      tenantId,
      loadId,
      actorId: source.actorId,
      number: `${suffix}-INVALID`,
      revision: 999,
      operationKey: randomUUID(),
      fingerprint: source.fingerprint,
      sourceHash: source.sourceHash,
      snapshotHash: source.snapshotHash,
      reason: 'Recette contrainte SQL',
      snapshot: { missingSchemaVersion: true },
    };
    await expect(db.deliveryManifest.create({ data: invalid })).rejects.toThrow(
      /delivery_manifests_snapshot_check/,
    );
    // The second edition has a labels PDF but no manifest PDF at this point.
    await expect(
      db.deliveryManifest.update({
        where: { id: second.id, tenantId },
        data: { manifestFileHash: 'f'.repeat(64) },
      }),
    ).rejects.toThrow(/delivery_manifests_manifest_file_check/);
  });

  it('fails closed on corrupted canonical bytes and never replaces that file automatically', async () => {
    const manifest = await db.deliveryManifest.findFirstOrThrow({
      where: { tenantId, id: first.id },
    });
    const doc = await db.document.findFirstOrThrow({
      where: { tenantId, id: manifest.manifestDocumentId! },
    });
    const bytes = blobs.get(doc.storageKey)!;
    const writes = storage.put.mock.calls.length;
    blobs.set(doc.storageKey, Buffer.from('corrupted bytes'));
    try {
      await request(http).get(fileUrl(first.id)).set(headers()).expect(409);
      await request(http).post(fileUrl(first.id)).set(headers()).send({}).expect(409);
      expect(storage.put).toHaveBeenCalledTimes(writes);
    } finally {
      blobs.set(doc.storageKey, bytes);
    }
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.manifestFileHash);
  });

  it('checks canonical document ownership/type in addition to the byte hash', async () => {
    const manifest = await db.deliveryManifest.findFirstOrThrow({
      where: { tenantId, id: first.id },
    });
    const doc = await db.document.findFirstOrThrow({
      where: { tenantId, id: manifest.manifestDocumentId! },
    });
    await db.document.update({
      where: { id: doc.id, tenantId },
      data: { entityType: 'fixture-generic-document' },
    });
    try {
      await request(http).get(fileUrl(first.id)).set(headers()).expect(409);
    } finally {
      await db.document.update({
        where: { id: doc.id, tenantId },
        data: { entityType: doc.entityType },
      });
    }
  });

  it('keeps an issued snapshot retryable when storage fails before canonical attachment', async () => {
    storage.put.mockRejectedValueOnce(new Error('Injected storage outage'));
    const failed = await request(http).post(fileUrl(second.id)).set(headers()).send({});
    expect([500, 503]).toContain(failed.status);
    let current = await db.deliveryManifest.findFirstOrThrow({
      where: { tenantId, id: second.id },
    });
    expect(current.manifestDocumentId).toBeNull();
    expect(current.snapshot).toEqual(second.snapshot);
    await request(http).post(fileUrl(second.id)).set(headers()).send({}).expect(201);
    current = await db.deliveryManifest.findFirstOrThrow({ where: { tenantId, id: second.id } });
    expect(current.manifestDocumentId).not.toBeNull();
    expect(current.snapshot).toEqual(second.snapshot);
  });

  it('rejects unsupported artifact kinds without writing storage', async () => {
    const writes = storage.put.mock.calls.length;
    await request(http).post(fileUrl(first.id, 'unknown')).set(headers()).send({}).expect(400);
    await request(http).get(fileUrl(first.id, 'unknown')).set(headers()).expect(400);
    expect(storage.put).toHaveBeenCalledTimes(writes);
  });

  it('issues, renders concurrently and downloads using a single database connection', async () => {
    // Keep the same disposable database; only this client has a one-connection pool.
    // Legacy fixture preparation above does not participate in this pool regression.
    const sourceUrl = new URL(app.get(ConfigService).getOrThrow<string>('DATABASE_URL'));
    sourceUrl.searchParams.set('connection_limit', '1');
    sourceUrl.searchParams.set('pool_timeout', '5');
    const single = new PrismaService({ datasources: { db: { url: sourceUrl.toString() } } });
    try {
      await request(http)
        .patch(`${transport}/locations/${destinationId}`)
        .set(headers())
        .send({ addressLine1: '110 Rue Connexion Unique' })
        .expect(200);
      const load = await db.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
      const actor = await db.deliveryManifest.findFirstOrThrow({
        where: { tenantId, loadId: load.id, id: first.id },
        select: { actorId: true },
      });
      const service = new DeliveryManifestsService(
        single,
        new SequencesService(single, app.get(TenantModulesCacheService)),
        new AuditLogsService(single),
        new DocumentsService(single, storage),
      );
      const view = await service.preview(tenantId, load.id);
      expect(view.canIssue).toBe(true);
      const issued = await service.issue(
        tenantId,
        actor.actorId,
        load.id,
        bodyFor(view, 'Recette pool une connexion'),
      );
      const generated = await Promise.all([
        service.prepareFile(tenantId, actor.actorId, load.id, issued.id, 'manifest'),
        service.prepareFile(tenantId, actor.actorId, load.id, issued.id, 'labels'),
      ]);
      expect(generated).toEqual([{ ready: true }, { ready: true }]);
      for (const kind of ['manifest', 'labels']) {
        const file = await service.download(tenantId, load.id, issued.id, kind);
        expect(file.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      }
    } finally {
      await single.$disconnect();
    }
  });

  it.each(['COMPLETED', 'CANCELLED'] as const)(
    'does not issue a new manifest on a %s load',
    async (status) => {
      // Fixture only: historical terminal records must remain readable but not newly issuable.
      const closed = await db.load.create({
        data: { tenantId, loadNumber: `${suffix}-${status}`, status },
      });
      const view = await preview(closed.id);
      expect(view.canIssue).toBe(false);
      expect(view.blockers.length).toBeGreaterThan(0);
      await publish(bodyFor(view), token, closed.id).expect(409);
    },
  );

  it('rechecks module activation on historical reads, rendering and downloads', async () => {
    await db.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      data: { enabled: false },
    });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    try {
      await request(http).get(url()).set(headers()).expect(403);
      await request(http).get(`${url()}/${first.id}`).set(headers()).expect(403);
      await request(http).get(fileUrl(first.id)).set(headers()).expect(403);
      await request(http).post(fileUrl(first.id)).set(headers()).send({}).expect(403);
    } finally {
      await db.tenantModule.update({
        where: { tenantId_moduleId: { tenantId, moduleId } },
        data: { enabled: true },
      });
      app.get(TenantModulesCacheService).invalidate(tenantId);
    }
  });
});
