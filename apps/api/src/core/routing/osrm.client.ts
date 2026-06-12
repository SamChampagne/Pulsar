import { Logger } from '@nestjs/common';
import type { LatLng } from './haversine';

export interface OsrmRouteResult {
  distanceKm: number;
  durationMin: number;
  /** GeoJSON LineString, [lng, lat] order — display only (render with L.geoJSON). */
  geometry: unknown;
}

const TIMEOUT_MS = 3000;

/** Thin OSRM client. Any failure returns null — callers never block on routing. */
export class OsrmClient {
  private readonly logger = new Logger(OsrmClient.name);
  private readonly host: string;

  constructor(host: string) {
    this.host = host.replace(/\/$/, '');
  }

  async route(points: LatLng[]): Promise<OsrmRouteResult | null> {
    if (points.length < 2) {
      this.logger.warn('OsrmClient.route called with < 2 points');
      return null;
    }
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${this.host}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        code?: string;
        routes?: { distance: number; duration: number; geometry: unknown }[];
      };
      const route = data.code === 'Ok' ? data.routes?.[0] : undefined;
      if (!route) {
        throw new Error(
          data.code === 'Ok' ? 'OSRM Ok but no routes returned' : `OSRM code=${data.code ?? 'unknown'}`,
        );
      }
      return {
        distanceKm: Math.round((route.distance / 1000) * 10) / 10,
        durationMin: Math.round(route.duration / 60),
        geometry: route.geometry,
      };
    } catch (err) {
      this.logger.warn(`OSRM route failed: ${String(err)}`);
      return null;
    }
  }
}
