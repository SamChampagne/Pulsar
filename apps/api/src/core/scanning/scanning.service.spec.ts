import { ScanningService } from './scanning.service';
import { SCAN_KINDS } from '@pulsar/shared';

describe('ScanningService', () => {
  const models = [
    'wmsItem',
    'bin',
    'load',
    'shipment',
    'manufacturingOrder',
    'yardVisit',
    'dockAppointment',
    'vehicle',
    'trailer',
  ];
  let prisma: any, service: ScanningService;
  beforeEach(() => {
    prisma = Object.fromEntries(
      models.map((m) => [m, { findMany: jest.fn().mockResolvedValue([]) }]),
    );
    service = new ScanningService(prisma);
  });
  it.each(SCAN_KINDS)(
    'scopes %s reads to the caller tenant, limits results and uses explicit projection',
    async (kind) => {
      await expect(service.resolve('tenant-a', kind, '00123')).rejects.toThrow('Code inconnu');
      const query = prisma[models[SCAN_KINDS.indexOf(kind)]].findMany.mock.calls[0][0];
      expect(query).toMatchObject({ where: { tenantId: 'tenant-a' }, take: 2 });
      expect(query.select).toBeDefined();
      expect(query.select.tenantId).toBeUndefined();
    },
  );
  it('matches an exact active article barcode or SKU without converting numbers', async () => {
    prisma.wmsItem.findMany.mockResolvedValue([
      { id: 'i1', sku: 'PART-1', name: 'Pièce', unit: 'EA' },
    ]);
    expect(await service.resolve('t', 'item', '001234\r')).toMatchObject({
      id: 'i1',
      code: 'PART-1',
      unit: 'EA',
    });
    expect(prisma.wmsItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't', isActive: true, OR: [{ barcode: '001234' }, { sku: '001234' }] },
      }),
    );
  });
  it('refuses ambiguous codes instead of choosing the first', async () => {
    prisma.wmsItem.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(service.resolve('t', 'item', 'DUP')).rejects.toThrow('Code ambigu');
  });
  it('keeps bin selection scoped to the requested warehouse', async () => {
    await expect(service.resolve('t', 'bin', 'A-01', 'site')).rejects.toThrow('Code inconnu');
    expect(prisma.bin.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't',
      isActive: true,
      code: 'A-01',
      locationId: 'site',
    });
  });
  it('rejects control payloads before querying', async () => {
    await expect(service.resolve('t', 'item', 'A\x1dB')).rejects.toThrow('Scannez');
    expect(prisma.wmsItem.findMany).not.toHaveBeenCalled();
  });
});
