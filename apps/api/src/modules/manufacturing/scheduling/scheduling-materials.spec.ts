import { SchedulingService } from './scheduling.service';

describe('APS material snapshots', () => {
  const snapshot = {
    version: 'pulsar.manufacturing.materials.v1',
    locationId: 'site-a',
    components: [{ itemId: 'raw', sku: 'RAW', unit: 'KG', requiredQuantity: '1.125' }],
  };
  let db: any, service: any;
  beforeEach(() => {
    db = {
      wmsItem: {
        findMany: jest.fn(async () => [{ id: 'raw', sku: 'RAW', unit: 'KG', isActive: true }]),
      },
      inventoryLevel: { findMany: jest.fn(async () => [{ itemId: 'raw', qtyOnHand: '2' }]) },
      $transaction: (calls: Promise<unknown>[]) => Promise.all(calls),
    };
    service = new SchedulingService(
      db,
      {} as any,
      {} as any,
      { getEnabledKeys: async () => new Set(['wms']) } as any,
    );
  });
  const order = () => ({
    id: 'of',
    bomId: 'bom',
    locationId: 'site-a',
    materialSnapshot: snapshot,
  });
  it('uses captured requirements and scopes stock to the captured warehouse', async () => {
    const result = await service.loadMaterials('tenant', [order()]);
    expect(result.materials.byOrder.of).toEqual([{ materialRef: 'RAW', fixedQuantity: 1.125 }]);
    expect(db.inventoryLevel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant',
          bin: { tenantId: 'tenant', locationId: 'site-a', isActive: true },
        },
      }),
    );
  });
  it('rejects historical unversioned material orders', async () => {
    await expect(
      service.loadMaterials('tenant', [{ ...order(), materialSnapshot: null }]),
    ).rejects.toThrow('historique');
    expect(db.inventoryLevel.findMany).not.toHaveBeenCalled();
  });
  it('never pools inventory across manufacturing sites', async () => {
    await expect(
      service.loadMaterials('tenant', [order(), { ...order(), id: 'other', locationId: 'site-b' }]),
    ).rejects.toThrow('un seul site');
  });
  it('refuses drift of captured units or an invalid snapshot', async () => {
    db.wmsItem.findMany.mockResolvedValue([{ id: 'raw', sku: 'RAW', unit: 'LB', isActive: true }]);
    await expect(service.loadMaterials('tenant', [order()])).rejects.toThrow('instantané');
    await expect(
      service.loadMaterials('tenant', [
        { ...order(), materialSnapshot: { ...snapshot, locationId: 'site-b' } },
      ]),
    ).rejects.toThrow('incompatible');
  });
});
