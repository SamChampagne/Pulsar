import { ConfigService } from '@nestjs/config';
import { NominatimClient } from './nominatim.client';
import { normalizeAddressKey, RoutingService } from './routing.service';
import type { PrismaService } from '../../prisma/prisma.service';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, def?: string) => values[key] ?? def,
    getOrThrow: (key: string) => {
      if (!values[key]) throw new Error(`Missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

function prismaMock() {
  return {
    geocodeCache: { findUnique: jest.fn(), upsert: jest.fn() },
  } as unknown as PrismaService & {
    geocodeCache: { findUnique: jest.Mock; upsert: jest.Mock };
  };
}

describe('normalizeAddressKey', () => {
  it('lowers, strips accents and collapses whitespace', () => {
    expect(normalizeAddressKey('  123 Rue   Émile-Nelligan,  Montréal ')).toBe(
      '123 rue emile-nelligan, montreal',
    );
  });
});

describe('RoutingService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('drivers off (default none): route and geocode resolve null without touching anything', async () => {
    const prisma = prismaMock();
    const service = new RoutingService(configWith({}), prisma);
    expect(await service.route([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }])).toBeNull();
    expect(await service.geocode('1 Main St')).toBeNull();
    expect(prisma.geocodeCache.findUnique).not.toHaveBeenCalled();
  });

  it('geocode: cache hit short-circuits Nominatim', async () => {
    const prisma = prismaMock();
    prisma.geocodeCache.findUnique.mockResolvedValue({ latitude: 45.5, longitude: -73.5 });
    const spy = jest.spyOn(NominatimClient.prototype, 'geocode');
    const service = new RoutingService(configWith({ GEOCODING_DRIVER: 'nominatim' }), prisma);

    expect(await service.geocode('1 Main St, Montréal')).toEqual({ lat: 45.5, lng: -73.5 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('geocode: cache miss calls Nominatim and persists the hit', async () => {
    const prisma = prismaMock();
    prisma.geocodeCache.findUnique.mockResolvedValue(null);
    jest.spyOn(NominatimClient.prototype, 'geocode').mockResolvedValue({ lat: 1, lng: 2 });
    const service = new RoutingService(configWith({ GEOCODING_DRIVER: 'nominatim' }), prisma);

    expect(await service.geocode('1 Main St')).toEqual({ lat: 1, lng: 2 });
    expect(prisma.geocodeCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { addressKey: '1 main st' } }),
    );
  });

  it('geocode: failures are NOT cached', async () => {
    const prisma = prismaMock();
    prisma.geocodeCache.findUnique.mockResolvedValue(null);
    jest.spyOn(NominatimClient.prototype, 'geocode').mockResolvedValue(null);
    const service = new RoutingService(configWith({ GEOCODING_DRIVER: 'nominatim' }), prisma);

    expect(await service.geocode('1 Main St')).toBeNull();
    expect(prisma.geocodeCache.upsert).not.toHaveBeenCalled();
  });
});
