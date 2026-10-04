import { DocumentsService } from './documents.service';

describe('Document registration with a business transaction', () => {
  const input = {
    entityType: 'delivery-manifest-pdf',
    entityId: 'manifest',
    fileName: 'MF-1.pdf',
    mimeType: 'application/pdf',
    body: Buffer.from('%PDF'),
    uploadedById: 'actor',
  };
  function fixture() {
    const global = { document: { create: jest.fn() } },
      tx = { document: { create: jest.fn(async () => ({ id: 'file' })) } },
      storage = { put: jest.fn() };
    return { global, tx, storage, service: new DocumentsService(global as any, storage as any) };
  }
  it('uses the existing connection for atomic document/manifest registration', async () => {
    const { service, global, tx, storage } = fixture();
    await service.upload('tenant', input, 'delivery-manifest-pdf', tx as any);
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^tenant\/delivery-manifest-pdf\/manifest\//),
      input.body,
      input.mimeType,
    );
    expect(tx.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 'tenant', entityId: 'manifest', sizeBytes: 4 }),
    });
    expect(global.document.create).not.toHaveBeenCalled();
  });
  it('preserves the legacy registration path when no transaction is provided', async () => {
    const { service, global, tx } = fixture();
    await service.upload('tenant', { ...input, entityType: 'load' });
    expect(global.document.create).toHaveBeenCalledTimes(1);
    expect(tx.document.create).not.toHaveBeenCalled();
  });
  it('never bypasses protected types by passing a transaction', async () => {
    const { service, tx, storage } = fixture();
    await expect(service.upload('tenant', input, undefined, tx as any)).rejects.toMatchObject({
      status: 403,
    });
    expect(storage.put).not.toHaveBeenCalled();
    expect(tx.document.create).not.toHaveBeenCalled();
  });
  it('does not register a document after a storage failure', async () => {
    const { service, tx, storage } = fixture();
    storage.put.mockRejectedValue(new Error('unavailable'));
    await expect(
      service.upload('tenant', input, 'delivery-manifest-pdf', tx as any),
    ).rejects.toThrow('unavailable');
    expect(tx.document.create).not.toHaveBeenCalled();
  });
});
