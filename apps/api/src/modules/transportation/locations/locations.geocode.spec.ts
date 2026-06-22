import { LocationsService } from './locations.service';
import type { OwnershipService } from '../../../prisma/ownership.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { RoutingService } from '../../../core/routing/routing.service';
import type { CreateLocationDto } from './dto/location.dto';
import { LocationType } from '@pulsar/shared';

function build(geocodeResult: { lat: number; lng: number } | null) {
  // The tenant-scoped update path is updateMany({id,tenantId}) + findFirstOrThrow;
  // capture the written data so findFirstOrThrow can echo it back as the "updated" row.
  let written: Record<string, unknown> = {};
  const prisma = {
    location: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      updateMany: jest.fn().mockImplementation(({ data }) => {
        written = data;
        return Promise.resolve({ count: 1 });
      }),
      findFirstOrThrow: jest.fn().mockImplementation(() => Promise.resolve({ id: 'l1', tenantId: 't1', ...written })),
    },
  } as unknown as PrismaService;
  const ownership = { assertOwnedIfSet: jest.fn() } as unknown as OwnershipService;
  const routing = { geocode: jest.fn().mockResolvedValue(geocodeResult) } as unknown as RoutingService;
  return { service: new LocationsService(prisma, ownership, routing), prisma, routing };
}

const dto: CreateLocationDto = {
  code: 'X1',
  name: 'X',
  type: LocationType.WAREHOUSE,
  addressLine1: '1 Main St',
  city: 'Montréal',
  state: 'QC',
  country: 'CA',
};

describe('LocationsService geocoding', () => {
  it('create without coords: geocodes best-effort and stores the result', async () => {
    const { service, routing } = build({ lat: 45.5, lng: -73.5 });
    const created = await service.create('t1', { ...dto });
    expect(routing.geocode).toHaveBeenCalledWith('1 Main St, Montréal, QC, CA');
    expect(created).toMatchObject({ latitude: 45.5, longitude: -73.5 });
  });

  it('create with manual coords: geocoder is not called (manual wins)', async () => {
    const { service, routing } = build({ lat: 0, lng: 0 });
    const created = await service.create('t1', { ...dto, latitude: 1, longitude: 2 });
    expect(routing.geocode).not.toHaveBeenCalled();
    expect(created).toMatchObject({ latitude: 1, longitude: 2 });
  });

  it('create when geocoding fails: location saved without coords (never blocking)', async () => {
    const { service, prisma } = build(null);
    await service.create('t1', { ...dto });
    const data = (prisma.location.create as jest.Mock).mock.calls[0][0].data;
    expect(data.latitude).toBeUndefined();
    expect(data.longitude).toBeUndefined();
  });

  it('update keeps existing manual coords (no re-geocode when coords already set)', async () => {
    const { service, prisma, routing } = build({ lat: 9, lng: 9 });
    (prisma.location.findFirst as jest.Mock).mockResolvedValue({
      id: 'l1', tenantId: 't1', latitude: 1, longitude: 2,
      addressLine1: '1 Main St', city: 'Montréal', state: 'QC', postalCode: null, country: 'CA',
    });
    await service.update('t1', 'l1', { name: 'Renamed' });
    expect(routing.geocode).not.toHaveBeenCalled();
  });

  it('update fills missing coords from the merged address', async () => {
    const { service, prisma, routing } = build({ lat: 46.8, lng: -71.2 });
    (prisma.location.findFirst as jest.Mock).mockResolvedValue({
      id: 'l1', tenantId: 't1', latitude: null, longitude: null,
      addressLine1: '1 Main St', city: 'Montréal', state: 'QC', postalCode: null, country: 'CA',
    });
    const updated = await service.update('t1', 'l1', { city: 'Québec' });
    expect(routing.geocode).toHaveBeenCalledWith('1 Main St, Québec, QC, CA');
    expect(updated).toMatchObject({ latitude: 46.8, longitude: -71.2 });
  });

  it('create with only latitude: geocode fills ONLY the missing longitude', async () => {
    const { service, prisma } = build({ lat: 9, lng: -9 });
    await service.create('t1', { ...dto, latitude: 48.5 });
    const data = (prisma.location.create as jest.Mock).mock.calls[0][0].data;
    expect(data.latitude).toBe(48.5); // manual half untouched
    expect(data.longitude).toBe(-9); // geocoded half filled
  });

  it('update with a half-null row: only the null field is filled', async () => {
    const { service, prisma } = build({ lat: 9, lng: -9 });
    (prisma.location.findFirst as jest.Mock).mockResolvedValue({
      id: 'l1', tenantId: 't1', latitude: null, longitude: -73.1,
      addressLine1: '1 Main St', city: 'Montréal', state: 'QC', postalCode: null, country: 'CA',
    });
    await service.update('t1', 'l1', { name: 'Renamed' });
    const data = (prisma.location.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(data.latitude).toBe(9); // filled
    expect(data.longitude).toBeUndefined(); // existing -73.1 left untouched (not in update payload)
  });
});
