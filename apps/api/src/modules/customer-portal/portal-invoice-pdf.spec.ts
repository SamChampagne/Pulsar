import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { PortalService } from './portal.service';
describe('Portal canonical invoice PDF', () => {
  function setup() {
    const bytes = Buffer.from('%PDF canonical invoice');
    const invoice = {
      id: 'invoice',
      publishedAt: new Date(),
      documentId: 'doc',
      documentHash: createHash('sha256').update(bytes).digest('hex'),
    };
    const prisma = {
      customerInvoice: { findFirst: jest.fn(async () => invoice) },
      document: { findFirst: jest.fn() },
    };
    const documents = {
      download: jest.fn(async () => ({
        stream: Readable.from([bytes]),
        mimeType: 'application/pdf',
      })),
    };
    const modulesCache = { getEnabledKeys: jest.fn(async () => new Set(['billing'])) };
    const service: PortalService = Object.assign(Object.create(PortalService.prototype), {
      prisma,
      documents,
      modulesCache,
    });
    return { service, prisma, documents, modulesCache, invoice, bytes };
  }
  const ctx = { tenantId: 'tenant', customerId: 'customer' } as never;
  it('checks tenant/customer/visible status and streams exactly the published PDF', async () => {
    const { service, prisma, documents, bytes } = setup();
    const file = await service.downloadInvoicePdfFor(ctx, 'invoice');
    const chunks: Buffer[] = [];
    for await (const c of file.stream) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(prisma.customerInvoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant',
          customerId: 'customer',
          id: 'invoice',
        }),
      }),
    );
    expect(documents.download).toHaveBeenCalledWith('tenant', 'doc', 'customer-invoice-pdf');
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
  });
  it('never substitutes a legacy upload for an unavailable or corrupt canonical document', async () => {
    for (const issue of ['missing', 'hash', 'file', 'owner', 'module']) {
      const { service, invoice, documents, prisma, modulesCache } = setup();
      if (issue === 'missing') invoice.documentId = null as never;
      if (issue === 'hash') invoice.documentHash = 'wrong';
      if (issue === 'file') documents.download.mockRejectedValueOnce(new Error('unavailable'));
      if (issue === 'owner') prisma.customerInvoice.findFirst.mockResolvedValueOnce(null as never);
      if (issue === 'module') modulesCache.getEnabledKeys.mockResolvedValueOnce(new Set());
      await expect(service.downloadInvoicePdfFor(ctx, 'invoice')).rejects.toThrow(
        'Invoice not found',
      );
      expect(prisma.document.findFirst).not.toHaveBeenCalled();
    }
  });
});
