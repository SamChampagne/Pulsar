import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import type { LatLng } from './haversine';
import { NominatimClient } from './nominatim.client';
import { OsrmClient, type OsrmRouteResult } from './osrm.client';

/** Accent-insensitive, whitespace-collapsed geocode cache key. */
export function normalizeAddressKey(address: string): string {
  return address
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mapping engine behind env-selected drivers (same philosophy as EMAIL_DRIVER):
 *  - ROUTING_DRIVER:   osrm | none (default) → road distance/duration/geometry
 *  - GEOCODING_DRIVER: nominatim | none (default) → address → lat/lng (DB-cached)
 * Every call is best-effort: failures return null and never block business flows.
 */
@Injectable()
export class RoutingService {
  private readonly osrm: OsrmClient | null;
  private readonly nominatim: NominatimClient | null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.osrm =
      config.get<string>('ROUTING_DRIVER', 'none') === 'osrm'
        ? new OsrmClient(config.getOrThrow<string>('OSRM_HOST'))
        : null;
    this.nominatim =
      config.get<string>('GEOCODING_DRIVER', 'none') === 'nominatim'
        ? new NominatimClient(
            config.get<string>('NOMINATIM_HOST', 'https://nominatim.openstreetmap.org'),
          )
        : null;
  }

  /** Road route along the ordered points, or null (driver off / OSRM unreachable). */
  route(points: LatLng[]): Promise<OsrmRouteResult | null> {
    if (!this.osrm || points.length < 2) return Promise.resolve(null);
    return this.osrm.route(points);
  }

  /** Address → coordinates through the persistent cache; null on miss/failure. */
  async geocode(address: string): Promise<LatLng | null> {
    if (!this.nominatim) return null;
    const addressKey = normalizeAddressKey(address);
    const cached = await this.prisma.geocodeCache.findUnique({ where: { addressKey } });
    if (cached) return { lat: cached.latitude, lng: cached.longitude };
    const result = await this.nominatim.geocode(address);
    if (!result) return null; // failures are not cached — retried on the next edit
    await this.prisma.geocodeCache.upsert({
      where: { addressKey },
      update: { latitude: result.lat, longitude: result.lng, provider: 'nominatim' },
      create: { addressKey, latitude: result.lat, longitude: result.lng, provider: 'nominatim' },
    });
    return result;
  }
}
