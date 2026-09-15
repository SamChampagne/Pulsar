import { SchedulingService } from './scheduling.service';
import { Prisma } from '@pulsar/database';
import { artifactHash } from './aps-artifact';

describe('APS material snapshots', () => {
  const snapshot = {
    version: 'pulsar.manufacturing.materials.v1',
    locationId: 'site-a',
    components: [{ itemId: 'raw', sku: 'RAW', unit: 'KG', requiredQuantity: '1.125' }],
  };
  let db: any, service: any;
  beforeEach(() => {
    db = {
      materialPurchaseOrder: { findMany: jest.fn(async () => []) },
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
  it('passes only unreceived future supplies and invalidates stock/promise changes', async () => {
    const future = new Date(Date.now() + 86400000 * 5);
    db.materialPurchaseOrder.findMany.mockResolvedValue([
      {
        id: 'po',
        preparationId: 'prep',
        number: 'MP-1',
        expectedDate: future,
        closedQuantity: new Prisma.Decimal(0),
        preparation: {
          itemId: 'raw',
          unitSnapshot: 'KG',
          quantity: new Prisma.Decimal(10),
          item: { isActive: true, sku: 'RAW', unit: 'KG' },
        },
        receipts: [
          { receipt: { status: 'POSTED', lines: [{ itemId: 'raw', qty: new Prisma.Decimal(3) }] } },
        ],
      },
    ]);
    const result = await service.loadMaterials('tenant', [order()]);
    expect(result.materials.supplies[0]).toMatchObject({
      id: 'purchase:po',
      quantity: 7,
      availableAt: `${future.toISOString().slice(0, 10)}T00:00:00`,
    });
    const request = {
      snapshot: {
        inventory_items: [{ material_id: 'RAW', quantity_on_hand: 2 }],
        metadata: { material_revision: artifactHash(result.materials) },
      },
    };
    expect(await service.materialFresh(db, 'tenant', [order()], request)).toBe(true);
    db.inventoryLevel.findMany.mockResolvedValue([{ itemId: 'raw', qtyOnHand: '3' }]);
    expect(await service.materialFresh(db, 'tenant', [order()], request)).toBe(false);
    db.inventoryLevel.findMany.mockResolvedValue([{ itemId: 'raw', qtyOnHand: '2' }]);
    db.materialPurchaseOrder.findMany.mockResolvedValue([]);
    expect(await service.materialFresh(db, 'tenant', [order()], request)).toBe(false);
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
