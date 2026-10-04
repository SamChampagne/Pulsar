import { DeliveryOperationsService, deliveryOperationsWhere } from './delivery-operations.service';

describe('DeliveryOperationsService read-only cockpit', () => {
  it('applies tenant/search and each explicit filter in SQL', () => {
    expect(deliveryOperationsWhere('tenant', { filter: 'blocked', search: ' LD-' })).toMatchObject({
      tenantId: 'tenant',
      loadNumber: { contains: 'LD-', mode: 'insensitive' },
      deliveryExceptions: { some: { tenantId: 'tenant', status: { in: ['OPEN'] } } },
    });
    expect(deliveryOperationsWhere('tenant', { filter: 'to_prepare' })).toMatchObject({
      status: { in: ['OPEN', 'PLANNED'] },
      shipments: {
        some: { tenantId: 'tenant', deliveryPackages: { none: { tenantId: 'tenant' } } },
      },
    });
    expect(deliveryOperationsWhere('tenant', { filter: 'to_load' })).toMatchObject({
      shipments: {
        some: {
          tenantId: 'tenant',
          deliveryPackages: { some: { tenantId: 'tenant', status: 'PREPARED' } },
        },
      },
    });
    expect(deliveryOperationsWhere('tenant', { filter: 'in_delivery' })).toMatchObject({
      status: 'IN_TRANSIT',
    });
    expect(deliveryOperationsWhere('tenant', { filter: 'retry' })).toMatchObject({
      deliveryExceptions: { some: { status: { in: ['RETRY_PLANNED'] } } },
    });
    expect(deliveryOperationsWhere('tenant', { filter: 'returns' })).toMatchObject({
      deliveryExceptions: { some: { status: { in: ['RETURN_AUTHORIZED', 'RETURN_RECEIVED'] } } },
    });
    expect(deliveryOperationsWhere('tenant', {})).toEqual({ tenantId: 'tenant' });
  });
  it('returns exact filtered total independent from the page and aggregates only selected loads', async () => {
    const tx: any = {
      load: {
        count: jest.fn(async () => 147),
        findMany: jest.fn(async () => [
          {
            id: 'l',
            loadNumber: 'LD-8',
            status: 'COMPLETED',
            updatedAt: new Date('2026-10-03T12:00:00Z'),
            _count: { shipments: 3 },
          },
        ]),
      },
      $queryRaw: jest.fn(async () => [
        { loadId: 'l', status: 'DELIVERED', count: 4 },
        { loadId: 'l', status: 'RETURNED', count: 2 },
      ]),
      shipment: { groupBy: jest.fn(async () => []) },
      deliveryException: {
        groupBy: jest.fn(async () => [
          { loadId: 'l', status: 'RETURN_AUTHORIZED', _count: { _all: 1 } },
          { loadId: 'l', status: 'RETURN_RECEIVED', _count: { _all: 2 } },
        ]),
      },
    };
    const service = new DeliveryOperationsService({ $transaction: (f: any) => f(tx) } as any);
    const result = await service.list('tenant', { page: 3, pageSize: 20, filter: 'returns' });
    expect(result).toMatchObject({ total: 147, page: 3, pageSize: 20 });
    expect(result.items[0]).toMatchObject({
      shipmentCount: 3,
      packages: { total: 6, delivered: 4, returned: 2 },
      exceptions: { returnAuthorized: 1, returnReceived: 2 },
      nextAction: { label: 'Vérifier la réception du retour' },
    });
    expect(tx.load.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
        where: expect.objectContaining({ tenantId: 'tenant' }),
      }),
    );
    expect(tx.deliveryException.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant', loadId: { in: ['l'] } }),
      }),
    );
    const sql = tx.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual(['tenant', 'tenant', 'l']);
  });
  it('keeps the true total on an empty out-of-range page without broad follow-up reads', async () => {
    const tx = {
      load: { count: jest.fn(async () => 3), findMany: jest.fn(async () => []) },
      $queryRaw: jest.fn(),
      deliveryException: { groupBy: jest.fn() },
    };
    const service = new DeliveryOperationsService({ $transaction: (f: any) => f(tx) } as any);
    expect(await service.list('tenant', { page: 8 })).toMatchObject({
      total: 3,
      items: [],
      page: 8,
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.deliveryException.groupBy).not.toHaveBeenCalled();
  });
});
