import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DeliveryFuelService } from './delivery-fuel.service';

const stamp = new Date('2026-10-01T12:00:00.000Z');
const profile = {
  loadedLitersPer100Km: 35,
  emptyLitersPer100Km: 25,
  idleLitersPerHour: 3,
  tankCapacityLitres: 600,
  reserveLitres: 60,
};
const price = {
  effectiveOn: '2026-09-30',
  pricePerLitre: '1.6',
  currency: 'CAD',
  reference: 'Relevé manuel',
};
const source = {
  vehicleId: 'v',
  profileRevision: 1,
  priceRevision: 2,
  currency: 'CAD',
  asOf: '2026-10-01',
};
const actual = {
  distanceKm: '100',
  consumedLitres: '35',
  costAmount: '56',
  currency: 'CAD',
  measuredAt: stamp.toISOString(),
  note: 'Compteur déclaré, total tournée',
};
const operationKey = 'a11ac885-ae38-4ba1-832f-f0adf6733e75';
const row = (snapshot: unknown, revision = 1) => ({
  id: 'r',
  tenantId: 't',
  revision,
  actorId: 'u',
  fingerprint: 'x',
  operationKey,
  snapshot,
  createdAt: stamp,
});
function fixture() {
  const delegate = () => ({
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ id: 'new', createdAt: stamp, ...data })),
  });
  const calls: string[] = [];
  const tx = {
    $executeRaw: jest.fn().mockImplementation(() => {
      calls.push('fuel-lock');
      return Promise.resolve(1);
    }),
    $queryRaw: jest.fn().mockImplementation(() => {
      calls.push('load-lock');
      return Promise.resolve([]);
    }),
    vehicle: { findFirst: jest.fn().mockResolvedValue({ id: 'v', unitNumber: 'TR-1' }) },
    load: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'l',
        loadNumber: 'LD-1',
        vehicleId: 'v',
        status: 'IN_TRANSIT',
        updatedAt: stamp,
        vehicle: { id: 'v', unitNumber: 'TR-1' },
      }),
    },
    route: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'route',
        updatedAt: stamp,
        deliveryPlan: {
          version: 1,
          totals: { distanceKm: 90, liters: 30, fuelCost: 48, currency: 'CAD' },
        },
      }),
    },
    deliveryFuelProfileRevision: delegate(),
    deliveryFuelPriceRevision: delegate(),
    deliveryFuelActualRevision: delegate(),
  };
  const prisma = { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new DeliveryFuelService(prisma as never, audit as never);
  const actualDto = {
    operationKey,
    expectedRevision: 0,
    expectedLoadUpdatedAt: stamp.toISOString(),
    expectedRouteUpdatedAt: stamp.toISOString(),
    actual,
  };
  return { service, tx, audit, calls, actualDto };
}
describe('DeliveryFuelService', () => {
  it('captures trusted source revisions, taking fuel lock and keeping explicitly chosen historic prices', async () => {
    const { service, tx } = fixture();
    tx.deliveryFuelProfileRevision.findFirst.mockResolvedValue(row(profile));
    tx.deliveryFuelPriceRevision.findFirst.mockResolvedValue(row(price, 2));
    const result = await service.resolvePlanningInputsTx(
      tx as never,
      't',
      'v',
      source,
      '2026-10-01T08:00:00Z',
    );
    expect(result.source).toMatchObject({ ...source, profile, price, version: 1 });
    expect(result.options.pricePerLiter).toBe(1.6);
    expect(tx.deliveryFuelPriceRevision.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 't', revision: 2 },
    });
    expect(tx.vehicle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't', id: 'v' } }),
    );
  });
  it.each([
    { vehicle: 'other', profileRevision: 1 },
    { vehicle: 'v', profileRevision: 2 },
  ])('rejects stale vehicle/profile %j', async (item) => {
    const { service, tx } = fixture();
    tx.deliveryFuelProfileRevision.findFirst.mockResolvedValue(row(profile, item.profileRevision));
    await expect(
      service.resolvePlanningInputsTx(tx as never, 't', item.vehicle, source),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects missing tenant price and never crosses tenant boundaries', async () => {
    const { service, tx } = fixture();
    tx.deliveryFuelProfileRevision.findFirst.mockResolvedValue(row(profile));
    await expect(
      service.resolvePlanningInputsTx(tx as never, 't', 'v', source),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each([{ effectiveOn: '2026-10-02' }, { currency: 'USD' }])(
    'rejects future date or different currency %j',
    async (change) => {
      const { service, tx } = fixture();
      tx.deliveryFuelProfileRevision.findFirst.mockResolvedValue(row(profile));
      tx.deliveryFuelPriceRevision.findFirst.mockResolvedValue(row({ ...price, ...change }, 2));
      await expect(
        service.resolvePlanningInputsTx(tx as never, 't', 'v', source),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it('ties source date to UTC planned departure; future dates require explicit departure', async () => {
    const { service, tx } = fixture();
    await expect(
      service.resolvePlanningInputsTx(tx as never, 't', 'v', source, '2026-10-01T23:00:00-04:00'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.resolvePlanningInputsTx(tx as never, 't', 'v', { ...source, asOf: '2099-01-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('writes one append-only profile plus atomic audit, then exact replay returns it', async () => {
    const { service, tx, audit } = fixture();
    const dto = { operationKey, expectedRevision: 0, profile };
    const saved = await service.saveProfile('t', 'u', 'v', dto);
    expect(saved.revision).toBe(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'delivery_fuel_profile', userId: 'u' }),
      tx,
    );
    tx.deliveryFuelProfileRevision.findFirst.mockResolvedValue({
      ...row(profile),
      ...tx.deliveryFuelProfileRevision.create.mock.calls[0][0].data,
    });
    const replay = await service.saveProfile('t', 'u', 'v', dto);
    expect(replay.revision).toBe(1);
    expect(tx.deliveryFuelProfileRevision.create).toHaveBeenCalledTimes(1);
    await expect(service.saveProfile('t', 'other-actor', 'v', dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      service.saveProfile('t', 'u', 'v', { ...dto, profile: { ...profile, reserveLitres: 50 } }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('guards price revision and audits without touching routes or financial snapshots', async () => {
    const { service, tx, audit } = fixture();
    tx.deliveryFuelPriceRevision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row(price, 3));
    await expect(
      service.savePrice('t', 'u', { operationKey, expectedRevision: 2, price }),
    ).rejects.toBeInstanceOf(ConflictException);
    tx.deliveryFuelPriceRevision.findFirst.mockResolvedValue(null);
    expect(
      (await service.savePrice('t', 'u', { operationKey, expectedRevision: 0, price })).revision,
    ).toBe(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'delivery_fuel_price' }),
      tx,
    );
    expect(tx.route.findFirst).not.toHaveBeenCalled();
  });
  it('locks load then fuel, captures baseline and writes actual+audit only', async () => {
    const { service, tx, calls, actualDto, audit } = fixture();
    const result = await service.saveActual('t', 'u', 'l', actualDto);
    expect(calls).toEqual(['load-lock', 'fuel-lock']);
    expect(result.snapshot).toMatchObject({
      baseline: { routeId: 'route', routeUpdatedAt: stamp.toISOString() },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'delivery_fuel_actual' }),
      tx,
    );
  });
  it('preserves original baseline when later route changes and works on completed loads', async () => {
    const { service, tx, actualDto } = fixture();
    const baseline = {
      routeId: 'old-route',
      routeUpdatedAt: '2026-09-30T00:00:00Z',
      deliveryPlan: { totals: { distanceKm: 80, liters: 20, fuelCost: 32, currency: 'CAD' } },
    };
    tx.load.findFirst.mockResolvedValue({ id: 'l', status: 'COMPLETED', updatedAt: stamp });
    tx.deliveryFuelActualRevision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({ ...actual, baseline }));
    const result = await service.saveActual('t', 'u', 'l', { ...actualDto, expectedRevision: 1 });
    expect(result.snapshot).toMatchObject({ baseline });
    expect(result).toMatchObject({ comparison: { deltaDistanceKm: 20 } });
  });
  it.each(['OPEN', 'PLANNED', 'CANCELLED'])('rejects new actual on %s', async (status) => {
    const { service, tx, actualDto } = fixture();
    tx.load.findFirst.mockResolvedValue({ status, updatedAt: stamp });
    await expect(service.saveActual('t', 'u', 'l', actualDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.deliveryFuelActualRevision.create).not.toHaveBeenCalled();
  });
  it('replays exact actual before current status/version validation but rejects changed actor/body', async () => {
    const { service, tx, actualDto } = fixture();
    await service.saveActual('t', 'u', 'l', actualDto);
    tx.deliveryFuelActualRevision.findFirst.mockResolvedValue({
      ...row(actual),
      ...tx.deliveryFuelActualRevision.create.mock.calls[0][0].data,
    });
    tx.load.findFirst.mockResolvedValue({ status: 'CANCELLED', updatedAt: new Date() });
    expect((await service.saveActual('t', 'u', 'l', actualDto)).revision).toBe(1);
    await expect(
      service.saveActual('t', 'u', 'l', { ...actualDto, actual: { ...actual, distanceKm: '101' } }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.deliveryFuelActualRevision.create).toHaveBeenCalledTimes(1);
  });
  it('guards load/route versions, future measurements, missing plan and baseline size', async () => {
    const { service, tx, actualDto } = fixture();
    await expect(
      service.saveActual('t', 'u', 'l', { ...actualDto, expectedLoadUpdatedAt: 'old' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.saveActual('t', 'u', 'l', { ...actualDto, expectedRouteUpdatedAt: 'old' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.saveActual('t', 'u', 'l', {
        ...actualDto,
        actual: { ...actual, measuredAt: '2099-01-01T00:00:00Z' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    tx.route.findFirst.mockResolvedValue({ id: 'route', updatedAt: stamp, deliveryPlan: null });
    await expect(service.saveActual('t', 'u', 'l', actualDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    tx.route.findFirst.mockResolvedValue({
      id: 'route',
      updatedAt: stamp,
      deliveryPlan: { huge: 'x'.repeat(1024 * 1024) },
    });
    await expect(service.saveActual('t', 'u', 'l', actualDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.deliveryFuelActualRevision.create).not.toHaveBeenCalled();
  });
  it('fails when atomic audit fails and never reports success', async () => {
    const { service, audit } = fixture();
    audit.log.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      service.savePrice('t', 'u', { operationKey, expectedRevision: 0, price }),
    ).rejects.toThrow('audit unavailable');
  });
  it('paginates tenant-scoped histories and does not return actor/key/fingerprint', async () => {
    const { service, tx } = fixture();
    tx.deliveryFuelPriceRevision.findMany.mockResolvedValue([row(price)]);
    const result = await service.prices('t', 2);
    expect(tx.deliveryFuelPriceRevision.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't' },
      orderBy: { revision: 'desc' },
      skip: 20,
      take: 20,
    });
    expect(result.items[0]).not.toHaveProperty('fingerprint');
    expect(result.items[0]).not.toHaveProperty('actorId');
    expect(result.items[0]).not.toHaveProperty('operationKey');
  });
});
