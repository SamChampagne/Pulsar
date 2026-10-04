import { Logger } from '@nestjs/common';
import type { LatLng } from './haversine';
import type { DeliveryMatrix } from '@pulsar/shared';

export interface OsrmRouteResult {
  distanceKm: number;
  durationMin: number;
  /** GeoJSON LineString, [lng, lat] order — display only (render with L.geoJSON). */
  geometry: unknown;
  legs?: { distanceKm: number; durationMin: number }[];
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
    if (points.length < 2 || points.length > 101 || !points.every(validPoint)) {
      this.logger.warn('OsrmClient.route called with invalid coordinates or point count');
      return null;
    }
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${this.host}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        code?: string;
        routes?: {
          distance: number;
          duration: number;
          geometry: unknown;
          legs?: { distance: number; duration: number }[];
        }[];
      };
      const route = data.code === 'Ok' ? data.routes?.[0] : undefined;
      if (!route) {
        throw new Error(
          data.code === 'Ok'
            ? 'OSRM Ok but no routes returned'
            : `OSRM code=${data.code ?? 'unknown'}`,
        );
      }
      if (!validMetric(route.distance) || !validMetric(route.duration)) return null;
      if (
        route.legs &&
        (route.legs.length !== points.length - 1 ||
          !route.legs.every((l) => validMetric(l.distance) && validMetric(l.duration)))
      )
        return null;
      return {
        distanceKm: Math.round((route.distance / 1000) * 10) / 10,
        durationMin: Math.round(route.duration / 60),
        geometry: route.geometry,
        ...(route.legs
          ? {
              legs: route.legs.map((l) => ({
                distanceKm: l.distance / 1000,
                durationMin: l.duration / 60,
              })),
            }
          : {}),
      };
    } catch (err) {
      this.logger.warn(`OSRM route failed: ${String(err)}`);
      return null;
    }
  }

  async table(points: LatLng[]): Promise<DeliveryMatrix | null> {
    if (points.length < 2 || points.length > 50 || !points.every(validPoint)) return null;
    try {
      const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
      const response = await fetch(
        `${this.host}/table/v1/driving/${coords}?annotations=distance,duration`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as {
        code?: string;
        distances?: (number | null)[][];
        durations?: (number | null)[][];
      };
      const valid = (rows: unknown): rows is (number | null)[][] =>
        Array.isArray(rows) &&
        rows.length === points.length &&
        rows.every(
          (row) =>
            Array.isArray(row) &&
            row.length === points.length &&
            row.every((n) => n === null || validMetric(n)),
        );
      if (data.code !== 'Ok' || !valid(data.distances) || !valid(data.durations)) return null;
      return {
        distancesKm: data.distances.map((row) => row.map((n) => (n == null ? null : n / 1000))),
        durationsMin: data.durations.map((row) => row.map((n) => (n == null ? null : n / 60))),
      };
    } catch {
      return null;
    }
  }
}

function validMetric(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}
function validPoint(p: LatLng) {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}
