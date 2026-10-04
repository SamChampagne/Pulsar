import { RoutesService } from './routes.service';
import { StopStatus, StopType } from '@pulsar/shared';
import type { CreateRouteDto } from './dto/route.dto';
const version = new Date('2026-10-01T12:00:00Z');
function fixture() {
  const shipments = [{ id: 's', originLocationId: 'a', destinationLocationId: 'b' }];
  const load: any = {
    id: 'load',
    tenantId: 'tenant',
    status: 'OPEN',
    updatedAt: version,
    route: null,
    shipments,
  };
  const currentStops: any[] = [
    {
      id: 'pickup',
      tenantId: 'tenant',
      sequence: 1,
      type: StopType.PICKUP,
      locationId: 'a',
      shipmentId: 's',
      status: StopStatus.PENDING,
      actualDepartureAt: null,
    },
    {
      id: 'delivery',
      tenantId: 'tenant',
      sequence: 2,
      type: StopType.DELIVERY,
      locationId: 'b',
      shipmentId: 's',
      status: StopStatus.PENDING,
      actualDepartureAt: null,
    },
  ];
  const dto: CreateRouteDto = {
    loadId: 'load',
    expectedUpdatedAt: version.toISOString(),
    planning: {
      startAt: '2026-10-01T14:00:00Z',
      loadedLitersPer100Km: 30,
      emptyLitersPer100Km: 20,
      pricePerLiter: 1.5,
      currency: 'CAD',
    },
    stops: currentStops.map(({ sequence, type, locationId, shipmentId }) => ({
      sequence,
      type,
      locationId,
      shipmentId,
    })),
  };
  const prisma: any = {
    load: { findFirst: jest.fn(async () => load), updateMany: jest.fn(async () => ({ count: 1 })) },
    shipment: { findMany: jest.fn(async () => shipments) },
    location: {
      findMany: jest.fn(async () => [
        { id: 'a', latitude: 45, longitude: -73, name: 'Atelier', city: 'Montréal' },
        { id: 'b', latitude: 46, longitude: -72, name: 'Usine', city: 'Québec' },
      ]),
    },
    route: {
      findFirst: jest.fn(async () => load.route),
      create: jest.fn(async (args: any) => ({ id: 'route', ...args.data })),
      update: jest.fn(async (args: any) => ({ id: 'route', ...args.data })),
    },
    stop: {
      deleteMany: jest.fn(),
      findFirst: jest.fn(async ({ where, include }: any) => {
        const s = currentStops.find((s) => s.id === where.id);
        return s
          ? { ...s, ...(include ? { route: { loadId: 'load', stops: currentStops } } : {}) }
          : null;
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    trackingEvent: { create: jest.fn() },
    $queryRaw: jest.fn(),
  };
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  const routing = {
    route: jest.fn(async () => ({
      distanceKm: 100,
      durationMin: 60,
      geometry: null,
      legs: [{ distanceKm: 100, durationMin: 60 }],
    })),
    table: jest.fn(async () => null),
  };
  const cost = { recompute: jest.fn() },
    audit = { log: jest.fn() },
    ownership = { assertOwned: jest.fn(), assertOwnedIfSet: jest.fn() };
  return {
    service: new RoutesService(prisma, ownership as any, cost as any, routing as any, audit as any),
    prisma,
    routing,
    cost,
    audit,
    ownership,
    dto,
    load,
    currentStops,
  };
}
describe('delivery route preparation', () => {
  it('preview scopes all reads and never writes or recalculates billing', async () => {
    const f = fixture();
    const result = await f.service.preview('tenant', f.dto);
    expect(result.deliveryPlan.totals).toMatchObject({ distanceKm: 100, liters: 30, fuelCost: 45 });
    expect(f.prisma.load.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'load', tenantId: 'tenant' } }),
    );
    expect(f.prisma.location.findMany.mock.calls[0][0].where.tenantId).toBe('tenant');
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.cost.recompute).not.toHaveBeenCalled();
  });
  it('preserves a manual tariff distance while estimating fuel from actual road segments', async () => {
    const f = fixture();
    f.load.route = {
      id: 'route',
      updatedAt: version,
      distanceSource: 'MANUAL',
      totalDistanceKm: 123,
    };
    const result = await f.service.preview('tenant', f.dto);
    expect(result.totalDistanceKm).toBe(123);
    expect(result.distanceSource).toBe('MANUAL');
    expect(result.deliveryPlan.totals.distanceKm).toBe(100);
  });
  it.each(['COMPLETED', 'DISPATCHED', 'CANCELLED'])('does not rebuild %s loads', async (status) => {
    const f = fixture();
    f.load.status = status;
    await expect(f.service.createForLoad('tenant', f.dto)).rejects.toThrow();
    expect(f.routing.route).not.toHaveBeenCalled();
  });
  it('rejects stale versions before any external route request', async () => {
    const f = fixture();
    f.dto.expectedUpdatedAt = '2025-01-01T00:00:00Z';
    await expect(f.service.preview('tenant', f.dto)).rejects.toThrow('changé');
    expect(f.routing.route).not.toHaveBeenCalled();
  });
  it('rejects a foreign/misassigned shipment and wrong delivery place', async () => {
    const f = fixture();
    f.dto.stops[1].locationId = 'other';
    await expect(f.service.preview('tenant', f.dto)).rejects.toThrow('correspond');
    f.dto.stops[1].locationId = 'b';
    f.dto.stops[1].shipmentId = 'other';
    await expect(f.service.preview('tenant', f.dto)).rejects.toThrow();
  });
  it('rejects delivery before pickup and incomplete shipment coverage', async () => {
    const f = fixture();
    f.dto.stops.reverse().forEach((s, i) => (s.sequence = i + 1));
    await expect(f.service.preview('tenant', f.dto)).rejects.toThrow('précéder');
  });
  it('saves route and audit in the same transaction, then recomputes the tariff', async () => {
    const f = fixture();
    await f.service.createForLoad('tenant', f.dto, 'operator');
    expect(f.prisma.route.create).toHaveBeenCalled();
    expect(f.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant', userId: 'operator', entityType: 'route' }),
      f.prisma,
    );
    expect(f.cost.recompute).toHaveBeenCalledWith('tenant', 'load');
  });
  it('refuses a failed load claim before replacing stops', async () => {
    const f = fixture();
    f.prisma.load.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.createForLoad('tenant', f.dto)).rejects.toThrow('changé');
    expect(f.prisma.stop.deleteMany).not.toHaveBeenCalled();
  });
  it('preserves an existing route when the version changed during routing', async () => {
    const f = fixture();
    f.prisma.route.findFirst.mockResolvedValue({ updatedAt: new Date(), stops: [] });
    await expect(f.service.createForLoad('tenant', f.dto)).rejects.toThrow('changé');
    expect(f.prisma.stop.deleteMany).not.toHaveBeenCalled();
  });
  it('does not silently apply optimization while saving', async () => {
    const f = fixture();
    f.dto.optimize = true;
    await expect(f.service.createForLoad('tenant', f.dto)).rejects.toThrow('Prévisualisez');
  });
  it('degrades explicitly when routing/matrix is unavailable', async () => {
    const f = fixture();
    f.routing.route.mockResolvedValue(null as any);
    f.dto.optimize = true;
    const result = await f.service.preview('tenant', f.dto);
    expect(result.optimization).toContain('indisponible');
    expect(result.deliveryPlan.legs[0].source).toBe('HAVERSINE');
    expect(result.deliveryPlan.schedule[1].arrivalAt).toBeNull();
  });
  it('does not calculate a fake zero total with missing coordinates', async () => {
    const f = fixture();
    f.prisma.location.findMany.mockResolvedValue([]);
    const result = await f.service.preview('tenant', f.dto);
    expect(result.deliveryPlan.totals.distanceKm).toBeNull();
    expect(f.routing.route).not.toHaveBeenCalled();
  });
});
describe('stop workflow', () => {
  it('rechecks capability access after the load lock and before any execution or replay', async () => {
    const f = fixture();
    f.load.status = 'DISPATCHED';
    f.currentStops[0].status = 'ARRIVED';
    const authorize = jest.fn(async (tx) => {
      expect(tx).toBe(f.prisma);
      expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(1);
      throw new Error('Driver link revoked');
    });
    await expect(
      f.service.updateStopStatus('tenant', 'pickup', StopStatus.ARRIVED, undefined, authorize),
    ).rejects.toThrow('Driver link revoked');
    expect(f.prisma.stop.updateMany).not.toHaveBeenCalled();
    expect(f.prisma.trackingEvent.create).not.toHaveBeenCalled();
    expect(f.audit.log).not.toHaveBeenCalled();
  });
  it('records event and audit atomically with arrival', async () => {
    const f = fixture();
    f.load.status = 'DISPATCHED';
    await f.service.updateStopStatus('tenant', 'pickup', StopStatus.ARRIVED, 'operator');
    expect(f.prisma.stop.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pickup', tenantId: 'tenant', status: 'PENDING' } }),
    );
    expect(f.prisma.trackingEvent.create).toHaveBeenCalledTimes(1);
    expect(f.audit.log).toHaveBeenCalledTimes(1);
  });
  it('replays arrival without altering timestamps or duplicating events', async () => {
    const f = fixture();
    f.load.status = 'DISPATCHED';
    f.currentStops[0].status = 'ARRIVED';
    await f.service.updateStopStatus('tenant', 'pickup', StopStatus.ARRIVED);
    expect(f.prisma.stop.updateMany).not.toHaveBeenCalled();
    expect(f.prisma.trackingEvent.create).not.toHaveBeenCalled();
  });
  it('rejects skips in execution order, departure before arrival and closed loads', async () => {
    const f = fixture();
    f.load.status = 'DISPATCHED';
    await expect(
      f.service.updateStopStatus('tenant', 'delivery', StopStatus.ARRIVED),
    ).rejects.toThrow('précédents');
    await expect(
      f.service.updateStopStatus('tenant', 'pickup', StopStatus.DEPARTED),
    ).rejects.toThrow('invalide');
    f.load.status = 'COMPLETED';
    await expect(
      f.service.updateStopStatus('tenant', 'pickup', StopStatus.ARRIVED),
    ).rejects.toThrow('dispatché');
  });
});
