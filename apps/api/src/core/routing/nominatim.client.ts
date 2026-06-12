import { Logger } from '@nestjs/common';
import type { LatLng } from './haversine';

const TIMEOUT_MS = 3000;
// Nominatim usage policy: max 1 req/s. In-process queue — valid while the API is
// single-instance (documented in the spec; revisit alongside the Redis move).
const MIN_INTERVAL_MS = 1100;
const USER_AGENT = 'Pulsar-TMS/0.1 (multi-tenant logistics SaaS; geocoding)';

/** Sequential, paced Nominatim client. Any failure returns null. */
export class NominatimClient {
  private readonly logger = new Logger(NominatimClient.name);
  private readonly host: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(host: string) {
    this.host = host.replace(/\/$/, '');
  }

  geocode(address: string): Promise<LatLng | null> {
    const run = this.queue.then(() => this.fetchGeocode(address));
    // Keep the chain alive on failure, and pace the NEXT call.
    this.queue = run
      .catch(() => null)
      .then(() => new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS)));
    return run;
  }

  private async fetchGeocode(address: string): Promise<LatLng | null> {
    try {
      const url = `${this.host}/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const results = (await response.json()) as { lat: string; lon: string }[];
      if (!results[0]) return null;
      const lat = Number(results[0].lat);
      const lng = Number(results[0].lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    } catch (err) {
      this.logger.warn(`Nominatim geocode failed: ${String(err)}`);
      return null;
    }
  }
}
