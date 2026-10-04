import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import { DocumentsService } from '../../../core/documents/documents.service';
import { assertGenericDocumentType } from '../../../core/documents/protected-documents';
import {
  DeliveryManifestsService,
  deliveryManifestDigest as hash,
} from './delivery-manifests.service';
import { renderDeliveryManifest, validateDeliveryManifestPrintable } from './manifest-render';

jest.mock('./manifest-render', () => ({
  renderDeliveryManifest: jest.fn(async () => Buffer.from('%PDF-test')),
  validateDeliveryManifestPrintable: jest.fn(),
}));

const key = 'c7adf859-0c91-4bcd-8c1c-79a0313afdd1';
const time = '2026-10-02T13:00:00.000Z';
const snapshot = () => ({
  schemaVersion: 1,
  load: {
    id: 'load',
    loadNumber: 'LD-1',
    status: 'PLANNED',
    updatedAt: time,
    carrierName: null,
    driverName: null,
    vehicleNumber: null,
    trailerNumber: null,
  },
  stops: [],
  shipments: [
    {
      id: 'shipment',
      shipmentNumber: 'SH-1',
      status: 'PLANNED',
      trackingEnabled: false,
      origin: {
        name: 'Usine',
        addressLine1: '12 rue A',
        addressLine2: null,
        city: 'Québec',
        province: 'QC',
        postalCode: 'G1A 1A1',
        country: 'CA',
      },
      destination: {
        name: 'Atelier',
        addressLine1: '13 rue B',
        addressLine2: null,
        city: 'Lévis',
        province: 'QC',
        postalCode: 'G6A 1A1',
        country: 'CA',
      },
      packages: [],
    },
  ],
});
function frozen() {
  const data = snapshot(),
    meta = { number: 'MF-1', revision: 1, issuedAt: time, reason: 'Préparation', snapshot: data };
  return {
    id: 'manifest',
    tenantId: 'tenant',
    loadId: 'load',
    actorId: 'actor',
    operationKey: key,
    fingerprint: hash({
      actorId: 'actor',
      loadId: 'load',
      sourceHash: hash(data),
      expectedLoadUpdatedAt: time,
      reason: 'Préparation',
    }),
    ...meta,
    issuedAt: new Date(time),
    sourceHash: hash(data),
    snapshotHash: hash(meta),
    manifestDocumentId: null,
    manifestFileHash: null,
    labelsDocumentId: null,
    labelsFileHash: null,
  };
}

describe('Delivery manifest service', () => {
  let service: DeliveryManifestsService,
    tx: any,
    prisma: any,
    sequences: any,
    audit: any,
    documents: any;
  const dto = () => ({
    operationKey: key,
    sourceHash: hash(snapshot()),
    expectedLoadUpdatedAt: time,
    reason: 'Préparation',
  });
  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      deliveryManifest: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }) => ({ ...data, id: 'manifest' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    prisma = {
      $transaction: jest.fn(async (fn) => fn(tx)),
      deliveryManifest: { findFirst: jest.fn(async () => frozen()) },
      document: { findFirst: jest.fn() },
    };
    sequences = { nextNumber: jest.fn(async () => 'MF-1') };
    audit = { log: jest.fn() };
    documents = { upload: jest.fn(async () => ({ id: 'file' })), download: jest.fn() };
    service = new DeliveryManifestsService(prisma, sequences, audit, documents);
    jest.spyOn(service as any, 'capture').mockResolvedValue(snapshot());
  });
  it('hashes JSONB objects independent of key order but preserves array order', () => {
    expect(hash({ x: 1, y: { a: 'a', b: 'b' } })).toBe(hash({ y: { b: 'b', a: 'a' }, x: 1 }));
    expect(hash([1, 2])).not.toBe(hash([2, 1]));
  });
  it('hashes every captured address and exact quantity without floating point conversion', () => {
    const changed = snapshot();
    changed.shipments[0].destination.city = 'Montréal';
    expect(hash(changed)).not.toBe(hash(snapshot()));
    expect(hash({ q: '999999999999.999' })).not.toBe(hash({ q: '999999999999.998' }));
  });
  it('issues canonical number and snapshot with atomic audit, without operational mutations', async () => {
    const record = await service.issue('tenant', 'actor', 'load', dto());
    expect(record.number).toBe('MF-1');
    expect(record.snapshot).toEqual(snapshot());
    expect(sequences.nextNumber).toHaveBeenCalledWith('tenant', 'delivery-manifest', tx);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant',
        userId: 'actor',
        entityType: 'delivery-manifest',
      }),
      tx,
    );
    expect(documents.upload).not.toHaveBeenCalled();
    expect(tx.deliveryManifest.create.mock.calls[0][0].data.operationKey).toBe(key);
  });
  it('canonicalizes UUID case and trimmed reason for exact replay', async () => {
    tx.deliveryManifest.findFirst.mockResolvedValue(frozen());
    const record = await service.issue('tenant', 'actor', 'load', {
      ...dto(),
      operationKey: key.toUpperCase(),
      reason: ' Préparation ',
    });
    expect(record.id).toBe('manifest');
    expect((service as any).capture).not.toHaveBeenCalled();
    expect(sequences.nextNumber).not.toHaveBeenCalled();
  });
  it.each([
    ['other actor', 'other', 'load', {}],
    ['other load', 'actor', 'foreign', {}],
    ['other body', 'actor', 'load', { reason: 'Autre motif' }],
  ])('rejects reused operation key with %s', async (_label, actor, load, extra) => {
    tx.deliveryManifest.findFirst.mockResolvedValue(frozen());
    await expect(
      service.issue('tenant', actor as string, load as string, { ...dto(), ...(extra as object) }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.deliveryManifest.create).not.toHaveBeenCalled();
  });
  it.each(['sourceHash', 'expectedLoadUpdatedAt'])(
    'rejects stale %s before numbering',
    async (field) => {
      await expect(
        service.issue('tenant', 'actor', 'load', {
          ...dto(),
          [field]: field === 'sourceHash' ? 'f'.repeat(64) : '2026-10-01T13:00:00.000Z',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(sequences.nextNumber).not.toHaveBeenCalled();
    },
  );
  it.each(['COMPLETED', 'CANCELLED'])(
    'never invents a historical issuance for %s load',
    async (status) => {
      const value = snapshot();
      value.load.status = status;
      (service as any).capture.mockResolvedValue(value);
      await expect(
        service.issue('tenant', 'actor', 'load', { ...dto(), sourceHash: hash(value) }),
      ).rejects.toMatchObject({ status: 409 });
      expect(sequences.nextNumber).not.toHaveBeenCalled();
    },
  );
  it('rejects another edition of the same source and directs reprint', async () => {
    tx.deliveryManifest.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ sourceHash: hash(snapshot()) });
    await expect(service.issue('tenant', 'actor', 'load', dto())).rejects.toMatchObject({
      status: 409,
    });
    expect(sequences.nextNumber).not.toHaveBeenCalled();
  });
  it('rejects tracked shipment with no active physical packages', async () => {
    const value = snapshot();
    value.shipments[0].trackingEnabled = true;
    (service as any).capture.mockResolvedValue(value);
    await expect(
      service.issue('tenant', 'actor', 'load', { ...dto(), sourceHash: hash(value) }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each([' ', 'Essai\nInjecté', 'Emoji 🚚'])('rejects unprintable reason %s', async (reason) => {
    await expect(
      service.issue('tenant', 'actor', 'load', { ...dto(), reason }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('never writes a record rejected by the printable gate', async () => {
    (validateDeliveryManifestPrintable as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Police non compatible');
    });
    await expect(service.issue('tenant', 'actor', 'load', dto())).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.deliveryManifest.create).not.toHaveBeenCalled();
  });
  it.each(['P2034', 'P2002'])('reports %s as inspectable conflict without retry', async (code) => {
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('concurrency', { code, clientVersion: 'test' }),
    );
    await expect(service.issue('tenant', 'actor', 'load', dto())).rejects.toMatchObject({
      status: 409,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it.each(['40001', '40P01'])('maps raw PostgreSQL %s to conflict without retry', async (code) => {
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('raw conflict', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code },
      }),
    );
    await expect(service.issue('tenant', 'actor', 'load', dto())).rejects.toMatchObject({
      status: 409,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('detects snapshot corruption instead of rebuilding from current data', async () => {
    const record = frozen();
    record.snapshot.shipments[0].destination.city = 'Tampered';
    prisma.deliveryManifest.findFirst.mockResolvedValue(record);
    await expect(service.detail('tenant', 'load', 'manifest')).rejects.toMatchObject({
      status: 409,
    });
    expect((service as any).capture).not.toHaveBeenCalled();
  });
  it('prepares a protected artifact only from immutable record and caches its digest', async () => {
    jest
      .spyOn(service, 'download')
      .mockResolvedValue({ body: Buffer.from('%PDF'), fileName: 'test.pdf' });
    tx.deliveryManifest.findFirst.mockResolvedValue(frozen());
    await expect(
      service.prepareFile('tenant', 'actor', 'load', 'manifest', 'manifest'),
    ).resolves.toEqual({ ready: true });
    expect(renderDeliveryManifest).toHaveBeenCalledWith(
      expect.objectContaining({ number: 'MF-1', issuedAt: time }),
      'manifest',
    );
    expect(documents.upload).toHaveBeenCalledWith(
      'tenant',
      expect.objectContaining({ entityType: 'delivery-manifest-pdf', entityId: 'manifest' }),
      'delivery-manifest-pdf',
      tx,
    );
    expect(tx.deliveryManifest.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant', loadId: 'load', id: 'manifest' },
      data: {
        manifestDocumentId: 'file',
        manifestFileHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
  });
  it('does not regenerate an existing canonical artifact', async () => {
    const verify = jest
      .spyOn(service, 'download')
      .mockResolvedValue({ body: Buffer.from('%PDF'), fileName: 'test.pdf' });
    tx.deliveryManifest.findFirst.mockResolvedValue({
      ...frozen(),
      manifestDocumentId: 'file',
      manifestFileHash: 'a'.repeat(64),
    });
    await service.prepareFile('tenant', 'actor', 'load', 'manifest', 'manifest');
    expect(verify).toHaveBeenCalledWith('tenant', 'load', 'manifest', 'manifest');
    expect(renderDeliveryManifest).not.toHaveBeenCalled();
    expect(documents.upload).not.toHaveBeenCalled();
  });
  it('download is read-only and reports a missing artifact', async () => {
    await expect(service.download('tenant', 'load', 'manifest', 'manifest')).rejects.toMatchObject({
      status: 409,
    });
    expect(documents.upload).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['manifest', 'labels'])(
    'checks %s context and file bytes before serving',
    async (kind) => {
      const body = Buffer.from('%PDF-proof'),
        digest = createHash('sha256').update(body).digest('hex');
      prisma.deliveryManifest.findFirst.mockResolvedValue({
        ...frozen(),
        manifestDocumentId: 'file',
        labelsDocumentId: 'file',
        manifestFileHash: digest,
        labelsFileHash: digest,
      });
      prisma.document.findFirst.mockResolvedValue({ sizeBytes: body.length });
      documents.download.mockResolvedValue({
        stream: Readable.from(body),
        fileName: 'not-trusted.pdf',
      });
      const file = await service.download('tenant', 'load', 'manifest', kind);
      expect(file.body).toEqual(body);
      expect(file.fileName).toBe(`MF-1-r1-${kind}.pdf`);
      expect(prisma.document.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant',
            id: 'file',
            entityId: 'manifest',
            entityType: kind === 'labels' ? 'delivery-labels-pdf' : 'delivery-manifest-pdf',
            mimeType: 'application/pdf',
          },
        }),
      );
    },
  );
  it('rejects tampered file content even at the same length', async () => {
    prisma.deliveryManifest.findFirst.mockResolvedValue({
      ...frozen(),
      manifestDocumentId: 'file',
      manifestFileHash: 'a'.repeat(64),
    });
    prisma.document.findFirst.mockResolvedValue({ sizeBytes: 4 });
    documents.download.mockResolvedValue({ stream: Readable.from(Buffer.from('xxxx')) });
    await expect(service.download('tenant', 'load', 'manifest', 'manifest')).rejects.toMatchObject({
      status: 409,
    });
  });
  it('rejects a generic or foreign canonical document', async () => {
    prisma.deliveryManifest.findFirst.mockResolvedValue({
      ...frozen(),
      manifestDocumentId: 'file',
      manifestFileHash: 'a'.repeat(64),
    });
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(service.download('tenant', 'load', 'manifest', 'manifest')).rejects.toMatchObject({
      status: 409,
    });
    expect(documents.download).not.toHaveBeenCalled();
  });
  it.each(['manifest-pdf', '../manifest', 'pdf'])(
    'rejects unsupported file kind %s',
    async (kind) => {
      await expect(
        service.prepareFile('tenant', 'actor', 'load', 'manifest', kind),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it.each(['delivery-manifest-pdf', 'delivery-labels-pdf'])(
    'protects %s from generic APIs and explicit deletion',
    async (entityType) => {
      expect(() => assertGenericDocumentType(entityType)).toThrow();
      const db: any = { document: { findFirst: jest.fn(async () => ({ entityType })) } },
        storage: any = { delete: jest.fn() };
      await expect(
        new DocumentsService(db, storage).remove('tenant', 'file', entityType as any),
      ).rejects.toMatchObject({ status: 400 });
      expect(storage.delete).not.toHaveBeenCalled();
    },
  );
});
