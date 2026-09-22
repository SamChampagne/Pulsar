import { PortalService } from './portal.service';
function setup() {
  const prisma = {
    tenant: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ settings: { branding: { accentColor: '#123456' } } }),
      update: jest.fn(),
    },
    document: { findFirst: jest.fn() },
  };
  const documents = {
    upload: jest.fn().mockResolvedValue({ id: 'document' }),
    download: jest.fn().mockResolvedValue({ mimeType: 'image/png' }),
    remove: jest.fn(),
  };
  const modules = { getEnabledKeys: jest.fn().mockResolvedValue(new Set(['customer-portal'])) };
  const audit = { log: jest.fn() };
  const service = new PortalService(
    prisma as never,
    modules as never,
    {} as never,
    {} as never,
    audit as never,
    {} as never,
    documents as never,
  );
  return { service, prisma, documents, modules, audit };
}
describe('portal branding', () => {
  it('reads a safe branding projection, never other settings', async () => {
    const { service, prisma } = setup();
    prisma.tenant.findUnique.mockResolvedValue({
      settings: {
        private: 'secret',
        branding: {
          accentColor: '#123456',
          logoUrl: 'https://example.com/a.png',
          internal: 'hidden',
        },
      },
    });
    expect(await service.getBranding('tenant')).toEqual({
      accentColor: '#123456',
      logoUrl: 'https://example.com/a.png',
    });
  });
  it('uploads via DocumentsService with a random public capability and actor audit', async () => {
    const { service, documents, audit } = setup();
    const result = await service.uploadLogo('tenant', 'actor', {
      originalname: 'logo.png',
      mimetype: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    expect(result.logoUrl).toMatch(/^\/api\/v1\/public\/portal\/branding\/logo\/[\w-]{32}$/);
    expect(documents.upload).toHaveBeenCalledWith(
      'tenant',
      expect.objectContaining({
        entityType: 'portal-logo',
        uploadedById: 'actor',
        mimeType: 'image/png',
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'actor', tenantId: 'tenant' }),
    );
  });
  it('rejects SVG, forged MIME and oversized files before storage', async () => {
    const { service, documents } = setup();
    for (const buffer of [Buffer.from('<svg></svg>'), Buffer.alloc(2 * 1024 * 1024 + 1)]) {
      await expect(
        service.uploadLogo('tenant', 'actor', {
          originalname: 'logo.png',
          mimetype: 'image/png',
          buffer,
        }),
      ).rejects.toThrow();
    }
    expect(documents.upload).not.toHaveBeenCalled();
  });
  it('refuses script URLs', async () => {
    await expect(
      setup().service.setBranding('tenant', { logoUrl: 'javascript:alert(1)' }),
    ).rejects.toThrow();
  });
  it('gates the public asset on module activation and the current logo', async () => {
    const { service, prisma, modules, documents } = setup();
    const token = 'A'.repeat(32);
    prisma.document.findFirst.mockResolvedValue({
      id: 'd1',
      tenantId: 'tenant',
      mimeType: 'image/png',
    });
    prisma.tenant.findUnique.mockResolvedValue({
      settings: { branding: { logoUrl: `/api/v1/public/portal/branding/logo/${token}` } },
    });
    await service.getLogo(token);
    expect(documents.download).toHaveBeenCalledWith('tenant', 'd1');
    modules.getEnabledKeys.mockResolvedValue(new Set());
    await expect(service.getLogo(token)).rejects.toThrow();
    modules.getEnabledKeys.mockResolvedValue(new Set(['customer-portal']));
    prisma.tenant.findUnique.mockResolvedValue({ settings: {} });
    await expect(service.getLogo(token)).rejects.toThrow();
  });
});
