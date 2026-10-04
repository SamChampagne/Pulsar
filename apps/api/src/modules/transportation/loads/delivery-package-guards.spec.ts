import { LoadsService } from './loads.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { Prisma } from '@pulsar/database';

const version = new Date('2026-10-02T12:00:00.000Z');
const parcelShipment = (status = 'IN_TRANSIT', managed = true) => ({
  id: 'shipment',
  transportOrderId: 'order',
  status,
  packageTrackingEnabledAt: managed ? version : null,
});

function loadSetup(status = 'IN_TRANSIT', shipments = [parcelShipment()]) {
  const load = {
    id: 'load',
    tenantId: 'tenant',
    loadNumber: 'LD-1',
    status,
    updatedAt: version,
    shipments,
    route: null,
    carrierId: 'carrier',
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
    load: {
      findFirst: jest.fn().mockResolvedValue(load),
      update: jest.fn().mockResolvedValue(load),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue(load),
    },
    shipment: {
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ id: 'shipment', status: 'PENDING', loadId: null }]),
    },
    deliveryPackage: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([{ shipmentId: 'shipment' }]),
    },
    transportOrder: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    deliveryException: { count: jest.fn().mockResolvedValue(0) },
    trackingEvent: { create: jest.fn().mockResolvedValue({}) },
    tender: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    shipmentLoadLeg: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }), upsert: jest.fn() },
  };
  prisma.$transaction.mockImplementation(async (work) =>
    typeof work === 'function' ? work(prisma) : Promise.all(work),
  );
  const settings = { resolve: jest.fn().mockResolvedValue({}) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    onCompleted: jest.fn().mockResolvedValue(undefined),
    onDispatched: jest.fn().mockResolvedValue(undefined),
  };
  const orders = { completeFromDelivery: jest.fn().mockResolvedValue(true) };
  const cost = { recompute: jest.fn().mockResolvedValue(undefined) };
  const service = new LoadsService(
    prisma as never,
    { nextNumber: jest.fn().mockResolvedValue('LD-2') } as never,
    { assertOwnedIfSet: jest.fn().mockResolvedValue(undefined) } as never,
    audit as never,
    cost as never,
    {} as never,
    settings as never,
    {} as never,
    notifications as never,
    orders as never,
  );
  jest.spyOn(service, 'get').mockResolvedValue(load as never);
  return { service, prisma, load, settings, audit, notifications, orders, cost };
}

describe('package-managed load lifecycle', () => {
  it('blocks dispatch when all declared packages were cancelled', async () => {
    const { service, prisma } = loadSetup('PLANNED', [parcelShipment('PLANNED')]);
    prisma.deliveryPackage.groupBy.mockResolvedValue([]);
    await expect(service.dispatch('tenant', 'actor', 'load')).rejects.toThrow(
      'au moins un colis actif',
    );
    expect(prisma.load.update).not.toHaveBeenCalled();
  });

  it('allows active prepared packages to dispatch for a later pickup', async () => {
    const { service, prisma } = loadSetup('PLANNED', [parcelShipment('PLANNED')]);
    await service.dispatch('tenant', 'actor', 'load');
    expect(prisma.deliveryPackage.groupBy).toHaveBeenCalledWith({
      by: ['shipmentId'],
      where: { tenantId: 'tenant', shipmentId: { in: ['shipment'] }, status: { not: 'CANCELLED' } },
    });
    expect(prisma.load.update).toHaveBeenCalled();
  });

  it('keeps the legacy dispatch path without package activation', async () => {
    const { service, prisma } = loadSetup('PLANNED', [parcelShipment('PLANNED', false)]);
    await service.dispatch('tenant', 'actor', 'load');
    expect(prisma.deliveryPackage.groupBy).not.toHaveBeenCalled();
  });

  it('rejects dispatch if a package changed after the active-package precheck', async () => {
    const { service, prisma } = loadSetup('PLANNED', [parcelShipment('PLANNED')]);
    prisma.load.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('changed', { code: 'P2025', clientVersion: 'test' }),
    );
    await expect(service.dispatch('tenant', 'actor', 'load')).rejects.toThrow(
      'Le chargement a changé',
    );
    expect(prisma.load.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'load', tenantId: 'tenant', status: 'PLANNED', updatedAt: version },
      }),
    );
  });

  it('rejects consolidating more than the supported shipment count', async () => {
    const { service, prisma } = loadSetup('OPEN');
    await expect(
      service.consolidate(
        'tenant',
        'actor',
        Array.from({ length: 201 }, (_, i) => `s-${i}`),
      ),
    ).rejects.toThrow('200 expéditions');
    expect(prisma.load.create).not.toHaveBeenCalled();
  });

  it('rejects a consolidation exceeding the manifest package bound under the shipment locks', async () => {
    const { service, prisma } = loadSetup('OPEN');
    prisma.deliveryPackage.count.mockImplementation(async ({ where }) => (where.status ? 0 : 2001));
    await expect(service.consolidate('tenant', 'actor', ['shipment'])).rejects.toThrow(
      '2 000 colis',
    );
    expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
  });
  it.each(['IN_TRANSIT', 'DISPATCHED', 'CANCELLED'])(
    'blocks completion of a tracked shipment in %s, even with no active parcel rows',
    async (status) => {
      const { service, prisma, notifications } = loadSetup('IN_TRANSIT', [parcelShipment(status)]);
      await expect(service.complete('tenant', 'actor', 'load')).rejects.toThrow(
        'tous les colis suivis',
      );
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.load.update).not.toHaveBeenCalled();
      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
      expect(notifications.onCompleted).not.toHaveBeenCalled();
    },
  );

  it('preserves individual delivery times and legacy delivered/closed states', async () => {
    const { service, prisma, orders } = loadSetup('IN_TRANSIT', [
      parcelShipment('DELIVERED'),
      parcelShipment('CLOSED'),
      parcelShipment('IN_TRANSIT', false),
      parcelShipment('DELIVERED', false),
    ]);
    await service.complete('tenant', 'actor', 'load');
    expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant',
        loadId: 'load',
        packageTrackingEnabledAt: null,
        status: 'IN_TRANSIT',
      },
      data: { status: 'DELIVERED', actualDeliveryAt: expect.any(Date) },
    });
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.load.findFirst.mock.invocationCallOrder[0],
    );
    expect(orders.completeFromDelivery).toHaveBeenCalledTimes(1);
  });

  it('rechecks current route execution under the shared load lock', async () => {
    const { service, prisma, load } = loadSetup('IN_TRANSIT', [parcelShipment('DELIVERED')]);
    prisma.load.findFirst.mockResolvedValue({
      ...load,
      route: { deliveryPlan: {}, stops: [{ status: 'PENDING' }] },
    } as never);
    await expect(service.complete('tenant', 'actor', 'load')).rejects.toThrow(
      'Terminez tous les arrêts',
    );
    expect(prisma.load.update).not.toHaveBeenCalled();
  });

  it('rejects a concurrent package mutation that changed the load version', async () => {
    const { service, prisma, load } = loadSetup('IN_TRANSIT', [parcelShipment('DELIVERED')]);
    prisma.load.findFirst.mockResolvedValue({
      ...load,
      updatedAt: new Date(version.getTime() + 1),
    });
    await expect(service.complete('tenant', 'actor', 'load')).rejects.toThrow(
      'Le chargement a changé',
    );
    expect(prisma.load.update).not.toHaveBeenCalled();
  });

  it('keeps the POD policy mandatory for individually delivered packages', async () => {
    const { service, prisma, settings } = loadSetup('IN_TRANSIT', [parcelShipment('DELIVERED')]);
    settings.resolve.mockResolvedValue({ podRequiredBeforeCompletion: true });
    prisma.shipment.count.mockResolvedValue(1);
    await expect(service.complete('tenant', 'actor', 'load')).rejects.toThrow('requires a POD');
    expect(prisma.load.update).not.toHaveBeenCalled();
  });

  it('does not regress already delivered shipments when starting transit', async () => {
    const { service, prisma } = loadSetup('DISPATCHED', [parcelShipment('DELIVERED')]);
    await service.startTransit('tenant', 'actor', 'load');
    expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant',
        loadId: 'load',
        status: 'DISPATCHED',
        packageTrackingEnabledAt: null,
      },
      data: { status: 'IN_TRANSIT', actualPickupAt: expect.any(Date) },
    });
    expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant',
        loadId: 'load',
        status: 'DISPATCHED',
        packageTrackingEnabledAt: { not: null },
      },
      data: { status: 'IN_TRANSIT' },
    });
  });

  it('blocks cancelling a load with loaded/delivered parcels before detachment', async () => {
    const { service, prisma } = loadSetup('DISPATCHED');
    prisma.deliveryPackage.count.mockResolvedValue(1);
    await expect(service.cancel('tenant', 'actor', 'load')).rejects.toThrow(
      'colis chargés ou livrés',
    );
    expect(prisma.deliveryPackage.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant',
          status: { in: ['LOADED', 'DELIVERED', 'RETURNED'] },
          OR: [{ loadedLoadId: 'load' }, { shipmentId: { in: ['shipment'] } }],
        },
      }),
    );
    expect(prisma.load.update).not.toHaveBeenCalled();
    expect(prisma.shipmentLoadLeg.deleteMany).not.toHaveBeenCalled();
  });

  it('retains cancellation and leg synchronization for unengaged packages', async () => {
    const { service, prisma } = loadSetup('PLANNED');
    await service.cancel('tenant', 'actor', 'load');
    expect(prisma.shipmentLoadLeg.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant', loadId: 'load' },
    });
  });

  it('never steals a shipment through consolidation after a concurrent assignment', async () => {
    const { service, prisma, cost } = loadSetup('OPEN');
    prisma.shipment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.consolidate('tenant', 'actor', ['shipment'])).rejects.toThrow(
      'déjà affectée',
    );
    expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
      where: { id: 'shipment', tenantId: 'tenant', status: 'PENDING', loadId: null },
      data: { loadId: 'load', status: 'PLANNED' },
    });
    expect(prisma.shipmentLoadLeg.upsert).not.toHaveBeenCalled();
    expect(cost.recompute).not.toHaveBeenCalled();
  });

  it.each(['vehicleId', 'trailerId'])(
    'blocks changing %s while packages are physically engaged',
    async (field) => {
      const { service, prisma } = loadSetup('PLANNED');
      prisma.deliveryPackage.count.mockResolvedValue(1);
      await expect(
        service.assignResources('tenant', 'actor', 'load', { [field]: 'new-asset' }),
      ).rejects.toThrow('Déchargez les colis');
      expect(prisma.load.updateMany).not.toHaveBeenCalled();
    },
  );

  it('keeps driver/carrier changes independent from vehicle custody', async () => {
    const { service, prisma } = loadSetup('PLANNED');
    prisma.deliveryPackage.count.mockResolvedValue(1);
    await service.assignResources('tenant', 'actor', 'load', { driverId: 'new-driver' });
    expect(prisma.deliveryPackage.count).not.toHaveBeenCalled();
    expect(prisma.load.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driverId: 'new-driver', driverToken: null }),
      }),
    );
  });

  it('rejects resource changes after a concurrent loading scan advances the version', async () => {
    const { service, prisma } = loadSetup('PLANNED');
    prisma.load.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.assignResources('tenant', 'actor', 'load', { vehicleId: 'new-vehicle' }),
    ).rejects.toThrow('Le chargement a changé');
    expect(prisma.load.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'load', tenantId: 'tenant', status: 'PLANNED', updatedAt: version },
      }),
    );
  });

  it('rejects consolidation of a shipment carrying loaded parcels', async () => {
    const { service, prisma } = loadSetup('OPEN');
    prisma.deliveryPackage.count.mockResolvedValue(1);
    await expect(service.consolidate('tenant', 'actor', ['shipment'])).rejects.toThrow(
      'colis chargés ou livrés',
    );
    expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
  });
});

function shipmentSetup(status = 'PENDING') {
  const shipment = {
    id: 'shipment',
    tenantId: 'tenant',
    status,
    loadId: status === 'PLANNED' ? 'load' : null,
    transportOrderId: 'order',
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
    load: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'load', status: 'OPEN', updatedAt: version, mode: 'FTL' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    shipment: {
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: jest.fn().mockResolvedValue(shipment),
    },
    deliveryPackage: { count: jest.fn().mockResolvedValue(0) },
    transportOrder: { findFirst: jest.fn().mockResolvedValue({ mode: 'FTL' }) },
    shipmentLoadLeg: { upsert: jest.fn(), deleteMany: jest.fn() },
  };
  prisma.$transaction.mockImplementation(async (work) => work(prisma));
  const cost = { recompute: jest.fn() };
  const service = new ShipmentsService(
    prisma as never,
    {} as never,
    cost as never,
    {} as never,
    {} as never,
  );
  jest.spyOn(service, 'get').mockResolvedValue(shipment as never);
  return { service, prisma, cost };
}

describe('package-managed shipment attachment guards', () => {
  it('rejects assignment beyond 200 shipments under the target load lock', async () => {
    const { service, prisma } = shipmentSetup();
    prisma.shipment.count.mockResolvedValue(200);
    await expect(
      service.assignToLoad('tenant', 'actor', 'shipment', { loadId: 'load' }),
    ).rejects.toThrow('200 expéditions');
    expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
  });

  it('rejects assignment when current and incoming packages exceed 2,000', async () => {
    const { service, prisma } = shipmentSetup();
    prisma.deliveryPackage.count.mockImplementation(async ({ where }) => (where.status ? 0 : 2001));
    await expect(
      service.assignToLoad('tenant', 'actor', 'shipment', { loadId: 'load' }),
    ).rejects.toThrow('2 000 colis');
    expect(prisma.shipmentLoadLeg.upsert).not.toHaveBeenCalled();
  });

  it('accepts the exact package bound and includes all historical statuses in its count', async () => {
    const { service, prisma } = shipmentSetup();
    prisma.deliveryPackage.count.mockImplementation(async ({ where }) => (where.status ? 0 : 2000));
    await service.assignToLoad('tenant', 'actor', 'shipment', { loadId: 'load' });
    expect(prisma.deliveryPackage.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant',
        OR: [{ shipmentId: 'shipment' }, { shipment: { tenantId: 'tenant', loadId: 'load' } }],
      },
    });
    expect(prisma.shipmentLoadLeg.upsert).toHaveBeenCalled();
  });
  it('does not cancel a shipment with loaded or delivered packages', async () => {
    const { service, prisma } = shipmentSetup();
    prisma.deliveryPackage.count.mockResolvedValue(1);
    await expect(service.cancel('tenant', 'shipment')).rejects.toThrow('colis chargés ou livrés');
    expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
  });
  it('blocks attaching a shipment with physical custody evidence', async () => {
    const { service, prisma } = shipmentSetup();
    prisma.deliveryPackage.count.mockResolvedValue(1);
    await expect(
      service.assignToLoad('tenant', 'actor', 'shipment', { loadId: 'load' }),
    ).rejects.toThrow('colis chargés ou livrés');
    expect(prisma.load.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
  });

  it('blocks removing a shipment while a package is loaded or delivered', async () => {
    const { service, prisma } = shipmentSetup('PLANNED');
    prisma.deliveryPackage.count.mockResolvedValue(1);
    await expect(service.removeFromLoad('tenant', 'shipment')).rejects.toThrow(
      'colis chargés ou livrés',
    );
    expect(prisma.shipmentLoadLeg.deleteMany).not.toHaveBeenCalled();
  });

  it('allows prepared packages to be attached for a later pickup', async () => {
    const { service, prisma } = shipmentSetup();
    await service.assignToLoad('tenant', 'actor', 'shipment', { loadId: 'load' });
    expect(prisma.deliveryPackage.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant',
        shipmentId: 'shipment',
        status: { in: ['LOADED', 'DELIVERED', 'RETURNED'] },
      },
    });
    expect(prisma.shipmentLoadLeg.upsert).toHaveBeenCalled();
  });

  it('does not cancel a shipment that was assigned concurrently', async () => {
    const { service, prisma } = shipmentSetup();
    prisma.shipment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancel('tenant', 'shipment')).rejects.toThrow('a été affectée');
    expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
      where: { id: 'shipment', tenantId: 'tenant', status: 'PENDING', loadId: null },
      data: { status: 'CANCELLED' },
    });
  });
});
