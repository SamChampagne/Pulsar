import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { DriverDocumentsService, driverDocumentScopeHash } from './driver-documents.service';
import { deliveryManifestDigest as hash } from '../delivery-manifests/delivery-manifests.service';
import { driverReference } from '../public/driver-reference';

jest.mock('./driver-document-render', () => ({
  renderDriverDocument: jest.fn(async () => Buffer.from('%PDF-safe')),
  validateDriverDocumentPrintable: jest.fn(),
}));
const time = '2026-10-03T12:00:00.000Z',
  key = 'c7adf859-0c91-4bcd-8c1c-79a0313afdd1';
const address = {
  name: 'Atelier',
  addressLine1: '10 Rue A',
  addressLine2: null,
  city: 'Québec',
  province: 'QC',
  postalCode: 'G1A 1A1',
  country: 'CA',
};
const capture = () => ({
  status: 'DISPATCHED',
  scope: { loadId: 'load', driverId: 'driver', shipments: [{ id: 'shipment' }] },
  snapshot: {
    schemaVersion: 1 as const,
    load: {
      loadNumber: 'LD-1',
      updatedAt: time,
      driverName: 'Renée Roy',
      carrierName: null,
      vehicleNumber: null,
      trailerNumber: null,
    },
    stops: [],
    shipments: [
      {
        shipmentNumber: 'SH-1',
        trackingEnabled: true,
        origin: { ...address },
        destination: { ...address },
        packageCodes: ['PKG-1'],
      },
    ],
  },
});
const dto = () => ({
  operationKey: key,
  sourceHash: hash({ snapshot: capture().snapshot, scope: capture().scope }),
  expectedLoadUpdatedAt: time,
  reason: 'Motif PRIVÉ',
  confirmDriverPublication: true as const,
});
const frozen = () => {
  const { snapshot, scope } = capture(),
    sourceHash = dto().sourceHash;
  const meta = {
    number: 'DL-1',
    revision: 1,
    issuedAt: time,
    reason: dto().reason,
    sourceHash,
    snapshot,
    scope,
  };
  return {
    id: 'edition',
    tenantId: 'tenant',
    loadId: 'load',
    actorId: 'actor',
    operationKey: key,
    fingerprint: hash({
      actorId: 'actor',
      loadId: 'load',
      sourceHash,
      expectedLoadUpdatedAt: time,
      reason: dto().reason,
      confirmDriverPublication: true,
    }),
    ...meta,
    issuedAt: new Date(time),
    scopeHash: driverDocumentScopeHash(snapshot, scope),
    snapshotHash: hash(meta),
    documentId: null,
    fileHash: null,
  };
};

describe('Driver document publication', () => {
  let service: DriverDocumentsService,
    tx: any,
    prisma: any,
    audit: any,
    documents: any,
    access: any,
    sequences: any;
  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      user: { findFirst: jest.fn(async () => ({ id: 'actor' })) },
      driverDeliveryDocument: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }) => ({ ...data, id: 'edition' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    prisma = {
      $transaction: jest.fn(async (fn) => fn(tx)),
      driverDeliveryDocument: { findFirst: jest.fn(async () => frozen()) },
      document: { findFirst: jest.fn() },
    };
    sequences = { nextNumber: jest.fn(async () => 'DL-1') };
    audit = { log: jest.fn() };
    documents = { upload: jest.fn(async () => ({ id: 'pdf' })), download: jest.fn() };
    access = {
      lock: jest.fn(async () => ({ id: 'load', tenantId: 'tenant', status: 'DISPATCHED' })),
    };
    service = new DriverDocumentsService(prisma, sequences, audit, documents, access);
    jest.spyOn(service as any, 'capture').mockImplementation(async () => capture());
  });
  it('publishes a closed snapshot with an atomic audit but no PDF or operational effect', async () => {
    const record = await service.issue('tenant', 'actor', 'load', dto());
    expect(record.snapshot).toEqual(capture().snapshot);
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant',
        id: 'actor',
        status: 'ACTIVE',
        agentServiceFor: { none: {} },
        NOT: { email: 'service-account@pulsar.local' },
      },
      select: { id: true },
    });
    expect(record).not.toHaveProperty('scope');
    expect(sequences.nextNumber).toHaveBeenCalledWith('tenant', 'driver-delivery-document', tx);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor',
        after: expect.objectContaining({ publishedForDriver: true }),
      }),
      tx,
    );
    expect(documents.upload).not.toHaveBeenCalled();
  });
  it('captures only declared public fields even when database rows contain private values', async () => {
    (service as any).capture.mockRestore();
    tx.load = {
      findFirst: jest.fn(async () => ({
        id: 'load',
        loadNumber: 'LD-1',
        updatedAt: new Date(time),
        status: 'DISPATCHED',
        driverId: 'driver',
        carrierId: null,
        vehicleId: null,
        trailerId: null,
        notes: 'PRIVATE_LOAD',
        driverToken: 'PRIVATE_TOKEN',
        estimatedCost: '842.99',
      })),
    };
    tx.shipment = {
      findMany: jest.fn(async () => [
        {
          id: 'shipment',
          shipmentNumber: 'SH-1',
          originLocationId: 'location',
          destinationLocationId: 'location',
          packageTrackingEnabledAt: new Date(time),
          private: 'PRIVATE_SHIPMENT',
        },
      ]),
    };
    tx.deliveryPackage = {
      findMany: jest.fn(async () => [
        {
          id: 'package',
          shipmentId: 'shipment',
          code: 'PKG-1',
          status: 'PREPARED',
          loadedLoadId: null,
          label: 'PRIVATE_LABEL',
          contents: [{ description: 'PRIVATE_CONTENT' }],
        },
      ]),
    };
    tx.route = { findFirst: jest.fn(async () => null) };
    tx.location = {
      findMany: jest.fn(async () => [
        { id: 'location', ...address, state: 'QC', private: 'PRIVATE_LOCATION' },
      ]),
    };
    tx.driver = {
      findFirst: jest.fn(async () => ({
        firstName: 'Renée',
        lastName: 'Roy',
        email: 'PRIVATE_EMAIL',
        phone: 'PRIVATE_PHONE',
      })),
    };
    const result = await service.preview('tenant', 'load');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(result.snapshot.shipments[0].packageCodes).toEqual(['PKG-1']);
    expect(result.snapshot.load).not.toHaveProperty('id');
    expect(result.snapshot.shipments[0]).not.toHaveProperty('id');
    expect(tx.deliveryPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant',
          status: { notIn: ['CANCELLED', 'RETURNED'] },
        }),
      }),
    );
  });
  it('requires explicit publication and an active actor even for a replay', async () => {
    await expect(
      service.issue('tenant', 'actor', 'load', {
        ...dto(),
        confirmDriverPublication: false as any,
      }),
    ).rejects.toMatchObject({ status: 400 });
    tx.user.findFirst.mockResolvedValue(null);
    tx.driverDeliveryDocument.findFirst.mockResolvedValue(frozen());
    await expect(service.issue('tenant', 'actor', 'load', dto())).rejects.toMatchObject({
      status: 403,
    });
  });
  it('replays before looking at changed sources, but never for another actor or body', async () => {
    tx.driverDeliveryDocument.findFirst.mockResolvedValue(frozen());
    expect(
      (
        await service.issue('tenant', 'actor', 'load', {
          ...dto(),
          operationKey: key.toUpperCase(),
        })
      ).id,
    ).toBe('edition');
    expect((service as any).capture).not.toHaveBeenCalled();
    await expect(service.issue('tenant', 'other', 'load', dto())).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      service.issue('tenant', 'actor', 'load', { ...dto(), reason: 'autre' }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each(['COMPLETED', 'CANCELLED'])('rejects new publication on %s', async (status) => {
    (service as any).capture.mockResolvedValue({ ...capture(), status });
    await expect(service.issue('tenant', 'actor', 'load', dto())).rejects.toMatchObject({
      status: 409,
    });
    expect(sequences.nextNumber).not.toHaveBeenCalled();
  });
  it('rejects changed addresses even with an unchanged Load version', async () => {
    const changed = capture();
    changed.snapshot.shipments[0].destination.city = 'Lévis';
    (service as any).capture.mockResolvedValue(changed);
    await expect(service.issue('tenant', 'actor', 'load', dto())).rejects.toMatchObject({
      status: 409,
    });
  });
  it('rejects stale load version and does not renumber identical published scope', async () => {
    await expect(
      service.issue('tenant', 'actor', 'load', {
        ...dto(),
        expectedLoadUpdatedAt: '2026-10-02T12:00:00.000Z',
      }),
    ).rejects.toMatchObject({ status: 409 });
    tx.driverDeliveryDocument.findFirst.mockResolvedValueOnce(null).mockResolvedValue(frozen());
    await expect(service.issue('tenant', 'actor', 'load', dto())).rejects.toMatchObject({
      status: 409,
    });
  });
  it('requires assigned driver and active packages for managed shipments', async () => {
    const changed = capture();
    changed.scope.driverId = '';
    changed.snapshot.shipments[0].packageCodes = [];
    (service as any).capture.mockResolvedValue(changed);
    const preview = await service.preview('tenant', 'load');
    expect(preview.canIssue).toBe(false);
    expect(preview.blockers).toHaveLength(2);
  });
  it('keeps scope stable for progress versions but changes it for resource/identity/address changes', () => {
    const first = capture(),
      second = capture();
    second.snapshot.load.updatedAt = '2026-10-04T00:00:00.000Z';
    expect(driverDocumentScopeHash(first.snapshot, first.scope)).toBe(
      driverDocumentScopeHash(second.snapshot, second.scope),
    );
    second.scope.driverId = 'replacement';
    expect(driverDocumentScopeHash(first.snapshot, first.scope)).not.toBe(
      driverDocumentScopeHash(second.snapshot, second.scope),
    );
  });
  it('rejects corrupted immutable JSON or hashes instead of reconstructing current state', async () => {
    prisma.driverDeliveryDocument.findFirst.mockResolvedValue({
      ...frozen(),
      sourceHash: '0'.repeat(64),
    });
    await expect(service.detail('tenant', 'load', 'edition')).rejects.toMatchObject({
      status: 409,
    });
  });
  it('public list contains only capability-scoped metadata, never the private reason or IDs', async () => {
    tx.driverDeliveryDocument.findFirst.mockResolvedValue(frozen());
    const result = await service.publicList('token-secret');
    expect(result).toEqual({
      documents: [
        {
          ref: driverReference('token-secret', 'document', 'edition'),
          number: 'DL-1',
          revision: 1,
          issuedAt: time,
          ready: false,
        },
      ],
      message: null,
    });
    for (const secret of ['tenant', 'edition', 'PRIVÉ', 'token-secret', 'shipment'])
      expect(JSON.stringify(result)).not.toContain(secret);
    expect(access.lock).toHaveBeenCalledWith('token-secret', tx);
  });
  it('public ignores old editions and rejects raw IDs, closed missions and stale assignments', async () => {
    tx.driverDeliveryDocument.findFirst.mockResolvedValue(frozen());
    await expect(service.publicDownload('token', 'edition')).rejects.toMatchObject({ status: 404 });
    const changed = capture();
    changed.scope.driverId = 'new';
    (service as any).capture.mockResolvedValue(changed);
    expect((await service.publicList('token')).documents).toEqual([]);
    access.lock.mockResolvedValue({ id: 'load', tenantId: 'tenant', status: 'COMPLETED' });
    await expect(service.publicList('token')).rejects.toMatchObject({ status: 409 });
  });
  it('rechecks capability after storage I/O, including revocation while reading bytes', async () => {
    tx.driverDeliveryDocument.findFirst.mockResolvedValue(frozen());
    jest
      .spyOn(service, 'download')
      .mockResolvedValue({ body: Buffer.from('%PDF-safe'), fileName: 'safe.pdf' });
    access.lock
      .mockResolvedValueOnce({ id: 'load', tenantId: 'tenant', status: 'DISPATCHED' })
      .mockRejectedValueOnce(new Error('revoked'));
    await expect(
      service.publicDownload('token', driverReference('token', 'document', 'edition')),
    ).rejects.toThrow('revoked');
  });
  it('checks canonically stored PDF metadata and bytes', async () => {
    const bytes = Buffer.from('%PDF-safe');
    prisma.driverDeliveryDocument.findFirst.mockResolvedValue({
      ...frozen(),
      documentId: 'pdf',
      fileHash: createHash('sha256').update(bytes).digest('hex'),
    });
    prisma.document.findFirst.mockResolvedValue({ sizeBytes: bytes.length });
    documents.download.mockImplementation(async () => ({ stream: Readable.from([bytes]) }));
    expect((await service.download('tenant', 'load', 'edition')).body).toEqual(bytes);
    documents.download.mockImplementation(async () => ({
      stream: Readable.from([Buffer.from('%PDF-evil')]),
    }));
    await expect(service.download('tenant', 'load', 'edition')).rejects.toMatchObject({
      status: 409,
    });
    expect(prisma.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant',
          id: 'pdf',
          entityId: 'edition',
          entityType: 'driver-delivery-document-pdf',
          mimeType: 'application/pdf',
        },
      }),
    );
  });
  it('prepares under separate artifact lock with transaction-aware upload then verifies outside', async () => {
    tx.driverDeliveryDocument.findFirst.mockResolvedValue(frozen());
    const download = jest
      .spyOn(service, 'download')
      .mockResolvedValue({ body: Buffer.from('%PDF-safe'), fileName: 'safe.pdf' });
    await expect(service.prepareFile('tenant', 'actor', 'load', 'edition')).resolves.toEqual({
      ready: true,
    });
    expect(documents.upload).toHaveBeenCalledWith(
      'tenant',
      expect.objectContaining({ entityType: 'driver-delivery-document-pdf', entityId: 'edition' }),
      'driver-delivery-document-pdf',
      tx,
    );
    expect(download).toHaveBeenCalledTimes(1);
  });
});
