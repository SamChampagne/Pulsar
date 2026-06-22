import { PickOrderStatus, StockMovementType } from '@pulsar/shared';
import { PickingService } from './picking.service';

function harness(throwOnPost = false) {
  const order: any = {
    id: 'p1',
    tenantId: 't1',
    status: PickOrderStatus.OPEN,
    locationId: 'loc1',
    lines: [{ id: 'l1', itemId: 'i1', fromBinId: 'b1', qty: 3 }],
  };
  const posted: any[] = [];
  const client = {
    pickOrder: {
      findFirst: async () => order,
      updateMany: async ({ where, data }: any) => {
        const allowed = where.status?.in ?? [where.status];
        if (allowed.includes(order.status)) {
          Object.assign(order, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    $transaction: async (fn: any) => fn(client),
  } as any;
  const inventory = {
    postMovement: async (_tx: any, a: any) => {
      if (throwOnPost) throw new Error('Insufficient stock in source bin');
      posted.push(a);
    },
  } as any;
  const sequences = { nextNumber: async () => 'PK-0001' } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  const domainEvents = { emit: async () => undefined } as any;
  const customFields = { validateValues: async () => undefined } as any;
  return { svc: new PickingService(client, inventory, sequences, ownership, audit, domainEvents, customFields), order, posted };
}

describe('PickingService.complete', () => {
  it('posts a PICK movement per line and flips OPEN→COMPLETED', async () => {
    const h = harness();
    await h.svc.complete('t1', 'u1', 'p1');
    expect(h.order.status).toBe(PickOrderStatus.COMPLETED);
    expect(h.posted[0].type).toBe(StockMovementType.PICK);
    expect(h.posted[0].fromBinId).toBe('b1');
  });
  it('propagates an insufficient-stock failure (transaction rolls back)', async () => {
    const h = harness(true);
    await expect(h.svc.complete('t1', 'u1', 'p1')).rejects.toThrow();
  });
});

function createHarness(opts: { shipment?: any; location?: any } = {}) {
  const created: any[] = [];
  const prisma = {
    location: { findFirst: async () => opts.location ?? { id: 'loc1', tenantId: 't1', type: 'WAREHOUSE' } },
    shipment: { findFirst: async () => opts.shipment ?? null },
    pickOrder: {
      create: async ({ data }: any) => {
        const row = { id: 'p1', ...data };
        created.push(row);
        return row;
      },
    },
  } as any;
  const inventory = {} as any;
  const sequences = { nextNumber: async () => 'PK-0001' } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  const domainEvents = { emit: async () => undefined } as any;
  const customFields = { validateValues: async () => undefined } as any;
  return { svc: new PickingService(prisma, inventory, sequences, ownership, audit, domainEvents, customFields), created };
}

describe('PickingService.create with shipmentId', () => {
  it('persists the link when locationId matches the shipment origin warehouse', async () => {
    const h = createHarness({
      location: { id: 'loc1', tenantId: 't1', type: 'WAREHOUSE' },
      shipment: { id: 'sh1', tenantId: 't1', originLocationId: 'loc1' },
    });
    await h.svc.create('t1', 'u1', { locationId: 'loc1', shipmentId: 'sh1' } as any);
    expect(h.created[0].shipmentId).toBe('sh1');
  });
  it('rejects when the pick location is not the shipment origin', async () => {
    const h = createHarness({
      location: { id: 'loc1', tenantId: 't1', type: 'WAREHOUSE' },
      shipment: { id: 'sh1', tenantId: 't1', originLocationId: 'OTHER' },
    });
    await expect(h.svc.create('t1', 'u1', { locationId: 'loc1', shipmentId: 'sh1' } as any)).rejects.toThrow();
  });
  it('rejects when the shipment does not exist for the tenant', async () => {
    const h = createHarness({ shipment: null });
    await expect(h.svc.create('t1', 'u1', { locationId: 'loc1', shipmentId: 'missing' } as any)).rejects.toThrow();
  });
});
