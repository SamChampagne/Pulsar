import { StockMovementType } from '@pulsar/shared';
import { InventoryService } from './inventory.service';

function harness(levels: Record<string, number> = {}) {
  const store = new Map<string, number>(Object.entries(levels)); // key = `${itemId}:${binId}`
  const movements: any[] = [];
  const client = {
    inventoryLevel: {
      findFirst: async ({ where }: any) => {
        const k = `${where.itemId}:${where.binId}`;
        return store.has(k) ? { id: k, tenantId: where.tenantId, itemId: where.itemId, binId: where.binId, qtyOnHand: store.get(k) } : null;
      },
      upsert: async ({ where, create, update }: any) => {
        const k = `${where.tenantId_itemId_binId.itemId}:${where.tenantId_itemId_binId.binId}`;
        const next = store.has(k) ? Number(update.qtyOnHand) : Number(create.qtyOnHand);
        store.set(k, next);
        return { id: k, qtyOnHand: next };
      },
    },
    stockMovement: { create: async ({ data }: any) => { movements.push(data); return { id: 'm' + movements.length, ...data }; } },
    $transaction: async (fn: any) => fn(client),
  } as any;
  const audit = { log: async () => undefined } as any;
  return { svc: new InventoryService(client, audit), store, movements };
}

describe('InventoryService.move', () => {
  it('transfers qty from one bin to another (decrement + increment + MOVE movement)', async () => {
    const h = harness({ 'i1:b1': 10 });
    await h.svc.move('t1', 'u1', { itemId: 'i1', fromBinId: 'b1', toBinId: 'b2', qty: 4 } as any);
    expect(h.store.get('i1:b1')).toBe(6);
    expect(h.store.get('i1:b2')).toBe(4);
    expect(h.movements[0].type).toBe(StockMovementType.MOVE);
  });
  it('refuses a move that exceeds on-hand', async () => {
    const h = harness({ 'i1:b1': 3 });
    await expect(h.svc.move('t1', 'u1', { itemId: 'i1', fromBinId: 'b1', toBinId: 'b2', qty: 5 } as any)).rejects.toThrow();
  });
});

describe('InventoryService.adjust', () => {
  it('applies a positive delta', async () => {
    const h = harness({ 'i1:b1': 2 });
    await h.svc.adjust('t1', 'u1', { itemId: 'i1', binId: 'b1', qtyDelta: 5 } as any);
    expect(h.store.get('i1:b1')).toBe(7);
  });
  it('refuses a negative adjustment below zero', async () => {
    const h = harness({ 'i1:b1': 2 });
    await expect(h.svc.adjust('t1', 'u1', { itemId: 'i1', binId: 'b1', qtyDelta: -5 } as any)).rejects.toThrow();
  });
});
