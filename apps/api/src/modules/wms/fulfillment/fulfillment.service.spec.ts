import { FulfillmentService } from './fulfillment.service';

function harness(shipments: any[]) {
  const prisma = {
    shipment: {
      findMany: async () => shipments,
      findFirst: async ({ where }: any) =>
        shipments.find((s) => s.id === where.id && s.tenantId === where.tenantId) ?? null,
    },
  } as any;
  return new FulfillmentService(prisma);
}

describe('FulfillmentService.pendingShipments', () => {
  it('attaches a derived pickStatus to each shipment', async () => {
    const svc = harness([
      {
        id: 'a',
        tenantId: 't1',
        shipmentNumber: 'SH-1',
        status: 'PLANNED',
        originLocation: { code: 'WH' },
        destinationLocation: { code: 'C1' },
        pickOrders: [],
      },
      {
        id: 'b',
        tenantId: 't1',
        shipmentNumber: 'SH-2',
        status: 'PLANNED',
        originLocation: { code: 'WH' },
        destinationLocation: { code: 'C2' },
        pickOrders: [{ id: 'p1', number: 'PK-1', status: 'COMPLETED' }],
      },
    ]);
    const res = await svc.pendingShipments('t1');
    expect(res.find((s: any) => s.id === 'a')!.pickStatus).toBe('NOT_PICKED');
    expect(res.find((s: any) => s.id === 'b')!.pickStatus).toBe('PICKED');
  });
});

describe('FulfillmentService.shipmentFulfillment', () => {
  it('returns the shipment with its pick orders and derived status', async () => {
    const svc = harness([
      {
        id: 'a',
        tenantId: 't1',
        shipmentNumber: 'SH-1',
        status: 'PLANNED',
        originLocation: { code: 'WH' },
        destinationLocation: { code: 'C1' },
        pickOrders: [{ id: 'p1', number: 'PK-1', status: 'PICKED' }],
      },
    ]);
    const res = await svc.shipmentFulfillment('t1', 'a');
    expect(res.pickStatus).toBe('PICKING');
    expect(res.pickOrders).toHaveLength(1);
  });
  it('throws when the shipment is not found for the tenant', async () => {
    const svc = harness([]);
    await expect(svc.shipmentFulfillment('t1', 'missing')).rejects.toThrow();
  });
});
