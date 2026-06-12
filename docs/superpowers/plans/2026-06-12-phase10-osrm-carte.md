# Phase 10 — OSRM + carte opérationnelle : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** distances/temps routiers automatiques (OSRM) + géocodage Nominatim, positions
chauffeur via la page publique, carte live sur le dashboard interne et mini-carte sur le
suivi public.

**Architecture:** un `RoutingService` core derrière le pattern driver env existant
(`ROUTING_DRIVER=osrm|none`, `GEOCODING_DRIVER=nominatim|none`), appelé en best-effort
synchrone (timeout 3 s, échec = null) depuis `RoutesService` et `LocationsService`.
Fallback haversine flaggé `HAVERSINE`. Les positions arrivent par un nouvel endpoint
public token-authentifié et alimentent `TrackingEvent POSITION_UPDATE` ; le dashboard
poll un endpoint agrégé `active-map`.

**Tech Stack:** NestJS 11, Prisma (PostgreSQL), `fetch` natif + `AbortSignal.timeout`,
Leaflet 1.9 (déjà en dépendance web), Svelte 5 runes, jest (unit dans `apps/api/src`,
e2e dans `apps/api/test`).

**Spec:** [2026-06-12-phase10-osrm-carte-design.md](../specs/2026-06-12-phase10-osrm-carte-design.md)

---

## Pré-requis exécutant

- Branche : `phase-10` (déjà créée depuis main).
- DB seedée démarrée : `pnpm db:up && pnpm db:migrate && pnpm db:seed` (sinon les e2e échouent).
- Après TOUTE modification de `packages/shared` ou `packages/database` :
  rebuild (`pnpm --filter @pulsar/shared build` / `pnpm --filter @pulsar/database build`)
  — l'API consomme leurs `dist/` (CLAUDE.md règle 7).
- Les e2e se lancent par fichier : `pnpm --filter @pulsar/api test:e2e -- phase10-map`
  (jest matche sur le nom). Unit : `pnpm --filter @pulsar/api test`.
- Invariants à ne PAS toucher : `costDetail` figé (règle 16), recompute via
  `LoadCostService` (règle 11), pas d'exposition de `tenantId` en public (règle 10).

## Carte des fichiers

| Action | Fichier | Responsabilité |
| ------ | ------- | -------------- |
| Modifie | `packages/shared/src/enums/transportation.ts` | enum `DistanceSource` |
| Modifie | `packages/database/prisma/schema.prisma` | enum miroir, `Route.geometry/distanceSource`, `GeocodeCache` |
| Crée | `apps/api/src/core/routing/haversine.ts` | `LatLng`, `haversineKm`, `pathDistanceKm` (pur) |
| Crée | `apps/api/src/core/routing/haversine.spec.ts` | tests unit |
| Crée | `apps/api/src/core/routing/osrm.client.ts` | client HTTP OSRM (timeout, null on failure) |
| Crée | `apps/api/src/core/routing/osrm.client.spec.ts` | tests unit (fetch mocké) |
| Crée | `apps/api/src/core/routing/nominatim.client.ts` | client Nominatim (1 req/s, UA custom) |
| Crée | `apps/api/src/core/routing/nominatim.client.spec.ts` | tests unit |
| Crée | `apps/api/src/core/routing/routing.service.ts` | drivers env + cache géocodage BD |
| Crée | `apps/api/src/core/routing/routing.service.spec.ts` | tests unit |
| Crée | `apps/api/src/core/routing/routing.module.ts` | module global (pattern EmailModule) |
| Modifie | `apps/api/src/app.module.ts` | import `RoutingModule` |
| Modifie | `.env.example` | `ROUTING_DRIVER`, `OSRM_HOST`, `GEOCODING_DRIVER`, `NOMINATIM_HOST` |
| Modifie | `apps/api/src/modules/transportation/locations/locations.service.ts` | géocodage best-effort create/update |
| Crée | `apps/api/src/modules/transportation/locations/locations.geocode.spec.ts` | tests unit (mocks) |
| Modifie | `apps/api/src/modules/transportation/routes/routes.service.ts` | distance auto OSRM/haversine + geometry |
| Modifie | `apps/api/src/modules/transportation/public/public-links.service.ts` | position chauffeur + lastPosition public |
| Modifie | `apps/api/src/modules/transportation/public/public-links.controller.ts` | `POST driver/:token/position` (DTO borné) |
| Modifie | `apps/api/src/modules/transportation/loads/loads.service.ts` | `activeMap()` |
| Modifie | `apps/api/src/modules/transportation/loads/loads.controller.ts` | `GET active-map` (AVANT `:id`) |
| Crée | `apps/api/test/phase10-map.e2e-spec.ts` | e2e driver `none` |
| Crée | `apps/api/test/phase10-osrm-real.e2e-spec.ts` | e2e OSRM réel (skippée sans env) |
| Modifie | `apps/web/src/routes/driver/[token]/+page.svelte` | pings géoloc + indicateur |
| Crée | `apps/web/src/lib/components/OpsMap.svelte` | carte dashboard (markers, rouge si retard) |
| Modifie | `apps/web/src/routes/(app)/dashboard/+page.svelte` | section carte + polling 45 s |
| Crée | `apps/web/src/lib/components/TrackMap.svelte` | mini-carte publique |
| Modifie | `apps/web/src/routes/track/[token]/+page.svelte` | carte + lastPosition |
| Modifie | `apps/web/src/lib/components/LoadMap.svelte` | géométrie `L.geoJSON` (fallback polyline) |
| Modifie | `apps/web/src/routes/(app)/loads/[id]/+page.svelte` | geometry/distanceSource + badge estimation |
| Modifie | `docker-compose.yml` | service `osrm` (profil opt-in) |
| Modifie | `.gitignore` | `osrm-data/` |
| Modifie | `docs/getting-started.md` | préparation extrait OSM |
| Modifie | `docs/etat-du-projet.md`, `CLAUDE.md` | ligne phase 10, règles dures |

---

### Task 1 : enum `DistanceSource` + migration 17 (`geometry`, `distanceSource`, `geocode_cache`)

**Files:**
- Modify: `packages/shared/src/enums/transportation.ts`
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1 : ajouter l'enum partagée**

À la fin de `packages/shared/src/enums/transportation.ts` (après `TransportMode`) :

```ts
/** Provenance of Route.totalDistanceKm — MANUAL is never overwritten. Mirrored in schema.prisma. */
export enum DistanceSource {
  MANUAL = 'MANUAL',
  OSRM = 'OSRM',
  HAVERSINE = 'HAVERSINE',
}
```

Vérifier que `packages/shared/src/index.ts` ré-exporte déjà `./enums/transportation`
(c'est le cas — ne rien toucher si oui).

- [ ] **Step 2 : rebuild shared**

Run : `pnpm --filter @pulsar/shared build`
Expected : succès, `dist/` mis à jour.

- [ ] **Step 3 : schema Prisma**

Dans `packages/database/prisma/schema.prisma` :

(a) Juste avant `model Route` (~ligne 891), ajouter l'enum miroir :

```prisma
enum DistanceSource {
  MANUAL
  OSRM
  HAVERSINE
}
```

(b) Dans `model Route`, après `estimatedDurationMin Int?` :

```prisma
  // Provenance of totalDistanceKm — MANUAL is never overwritten by recomputes.
  distanceSource       DistanceSource?
  // OSRM route geometry (GeoJSON LineString, [lng, lat] order). Display only.
  geometry             Json?
```

(c) À la fin de la section transportation (juste après `model TrackingEvent`, ~ligne 1140) :

```prisma
// Global geocode cache — NOT tenant-scoped: address → coords is not tenant data.
model GeocodeCache {
  id         String   @id @default(cuid())
  addressKey String   @unique
  latitude   Float
  longitude  Float
  provider   String
  createdAt  DateTime @default(now())

  @@map("geocode_cache")
}
```

- [ ] **Step 4 : migrer (aucun appel réseau, colonnes nullables — spec §A)**

Run (racine repo) : `pnpm db:migrate -- --name phase10_routing_geocode`
Expected : migration `2026…_phase10_routing_geocode` créée et appliquée ; `prisma generate` relancé.
Si le flag ne passe pas à travers le script racine : `pnpm --filter @pulsar/database exec prisma migrate dev --name phase10_routing_geocode`.

- [ ] **Step 5 : rebuild database + typecheck**

Run : `pnpm --filter @pulsar/database build; pnpm --filter @pulsar/api typecheck`
Expected : OK (rien ne consomme encore les nouveaux champs).

- [ ] **Step 6 : commit**

```bash
git add packages/shared/src/enums/transportation.ts packages/database/prisma
git commit -m "feat(db): DistanceSource enum, Route.geometry, geocode_cache (migration 17)"
```

---

### Task 2 : haversine pur

**Files:**
- Create: `apps/api/src/core/routing/haversine.ts`
- Test: `apps/api/src/core/routing/haversine.spec.ts`

- [ ] **Step 1 : test qui échoue**

```ts
// apps/api/src/core/routing/haversine.spec.ts
import { haversineKm, pathDistanceKm } from './haversine';

const MTL = { lat: 45.5019, lng: -73.5674 };
const QC = { lat: 46.8131, lng: -71.2075 };

describe('haversine', () => {
  it('returns 0 for the same point', () => {
    expect(haversineKm(MTL, MTL)).toBe(0);
  });

  it('Montréal → Québec is ~233 km as the crow flies', () => {
    const d = haversineKm(MTL, QC);
    expect(d).toBeGreaterThan(225);
    expect(d).toBeLessThan(242);
  });

  it('pathDistanceKm sums consecutive legs and rounds to 0.1', () => {
    const d = pathDistanceKm([MTL, QC, MTL]);
    expect(d).toBeCloseTo(2 * haversineKm(MTL, QC), 0);
    expect(d).toBe(Math.round(d * 10) / 10);
  });

  it('pathDistanceKm of fewer than 2 points is 0', () => {
    expect(pathDistanceKm([])).toBe(0);
    expect(pathDistanceKm([MTL])).toBe(0);
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run : `pnpm --filter @pulsar/api test -- haversine`
Expected : FAIL — `Cannot find module './haversine'`.

- [ ] **Step 3 : implémentation**

```ts
// apps/api/src/core/routing/haversine.ts
export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

/** Great-circle distance between two points (km). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Leg-by-leg great-circle distance along a stop sequence (km, rounded to 0.1). */
export function pathDistanceKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
  return Math.round(total * 10) / 10;
}
```

- [ ] **Step 4 : vérifier le vert**

Run : `pnpm --filter @pulsar/api test -- haversine`
Expected : PASS (4 tests).

- [ ] **Step 5 : commit**

```bash
git add apps/api/src/core/routing
git commit -m "feat(api): pure haversine distance helpers"
```

---

### Task 3 : `OsrmClient`

**Files:**
- Create: `apps/api/src/core/routing/osrm.client.ts`
- Test: `apps/api/src/core/routing/osrm.client.spec.ts`

- [ ] **Step 1 : test qui échoue**

```ts
// apps/api/src/core/routing/osrm.client.spec.ts
import { OsrmClient } from './osrm.client';

const MTL = { lat: 45.5019, lng: -73.5674 };
const QC = { lat: 46.8131, lng: -71.2075 };

describe('OsrmClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('parses distance (m→km), duration (s→min) and geometry; coords are lng,lat ordered', async () => {
    const geometry = { type: 'LineString', coordinates: [[-73.57, 45.5], [-71.21, 46.81]] };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'Ok', routes: [{ distance: 271_400, duration: 10_980, geometry }] }),
    }) as unknown as typeof fetch;

    const client = new OsrmClient('http://osrm.local');
    const result = await client.route([MTL, QC]);

    expect(result).toEqual({ distanceKm: 271.4, durationMin: 183, geometry });
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    // OSRM expects {lng},{lat};{lng},{lat} + simplified geojson overview (spec §A)
    expect(url).toBe(
      'http://osrm.local/route/v1/driving/-73.5674,45.5019;-71.2075,46.8131?overview=simplified&geometries=geojson',
    );
  });

  it('returns null on HTTP error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    expect(await new OsrmClient('http://osrm.local').route([MTL, QC])).toBeNull();
  });

  it('returns null on OSRM error code', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'NoRoute', routes: [] }),
    }) as unknown as typeof fetch;
    expect(await new OsrmClient('http://osrm.local').route([MTL, QC])).toBeNull();
  });

  it('returns null on network failure/timeout', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('aborted')) as unknown as typeof fetch;
    expect(await new OsrmClient('http://osrm.local').route([MTL, QC])).toBeNull();
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run : `pnpm --filter @pulsar/api test -- osrm.client`
Expected : FAIL — module inexistant.

- [ ] **Step 3 : implémentation**

```ts
// apps/api/src/core/routing/osrm.client.ts
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

  constructor(private readonly host: string) {}

  async route(points: LatLng[]): Promise<OsrmRouteResult | null> {
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
      if (!route) throw new Error(`OSRM code=${data.code ?? 'unknown'}`);
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
```

- [ ] **Step 4 : vérifier le vert**

Run : `pnpm --filter @pulsar/api test -- osrm.client`
Expected : PASS (4 tests).

- [ ] **Step 5 : commit**

```bash
git add apps/api/src/core/routing
git commit -m "feat(api): OSRM HTTP client (3s timeout, null on failure)"
```

---

### Task 4 : `NominatimClient` (1 req/s, User-Agent custom)

**Files:**
- Create: `apps/api/src/core/routing/nominatim.client.ts`
- Test: `apps/api/src/core/routing/nominatim.client.spec.ts`

- [ ] **Step 1 : test qui échoue**

```ts
// apps/api/src/core/routing/nominatim.client.spec.ts
import { NominatimClient } from './nominatim.client';

describe('NominatimClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('parses the first result and sends the custom User-Agent', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '45.5019', lon: '-73.5674' }],
    }) as unknown as typeof fetch;

    const client = new NominatimClient('https://nominatim.test');
    const result = await client.geocode('1 Main St, Montréal, QC, CA');

    expect(result).toEqual({ lat: 45.5019, lng: -73.5674 });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://nominatim.test/search?format=jsonv2&limit=1&q=');
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('Pulsar');
  });

  it('returns null on empty results, HTTP error and network failure', async () => {
    const client = new NominatimClient('https://nominatim.test');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
    expect(await client.geocode('nowhere')).toBeNull();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    expect(await client.geocode('nowhere')).toBeNull();
    global.fetch = jest.fn().mockRejectedValue(new Error('aborted')) as unknown as typeof fetch;
    expect(await client.geocode('nowhere')).toBeNull();
  });

  it('spaces consecutive calls by at least ~1s (in-process throttle)', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '1', lon: '2' }],
    }) as unknown as typeof fetch;

    const client = new NominatimClient('https://nominatim.test');
    const first = client.geocode('a');
    const second = client.geocode('b');

    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1); // second call queued
    await jest.advanceTimersByTimeAsync(1200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await expect(first).resolves.toEqual({ lat: 1, lng: 2 });
    await expect(second).resolves.toEqual({ lat: 1, lng: 2 });
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run : `pnpm --filter @pulsar/api test -- nominatim`
Expected : FAIL — module inexistant.

- [ ] **Step 3 : implémentation**

```ts
// apps/api/src/core/routing/nominatim.client.ts
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
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly host: string) {}

  geocode(address: string): Promise<LatLng | null> {
    const run = this.queue.then(() => this.fetchGeocode(address));
    // Keep the chain alive on failure, and pace the NEXT call.
    this.queue = run
      .catch(() => null)
      .then(() => new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS)));
    return run;
  }

  private async fetchGeocode(address: string): Promise<LatLng | null> {
    const url = `${this.host}/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`;
    try {
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
```

- [ ] **Step 4 : vérifier le vert**

Run : `pnpm --filter @pulsar/api test -- nominatim`
Expected : PASS (3 tests).

- [ ] **Step 5 : commit**

```bash
git add apps/api/src/core/routing
git commit -m "feat(api): Nominatim client (1 req/s queue, custom UA)"
```

---

### Task 5 : `RoutingService` + module global + env

**Files:**
- Create: `apps/api/src/core/routing/routing.service.ts`
- Create: `apps/api/src/core/routing/routing.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `.env.example`
- Test: `apps/api/src/core/routing/routing.service.spec.ts`

- [ ] **Step 1 : test qui échoue**

```ts
// apps/api/src/core/routing/routing.service.spec.ts
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
```

- [ ] **Step 2 : vérifier l'échec**

Run : `pnpm --filter @pulsar/api test -- routing.service`
Expected : FAIL — module inexistant.

- [ ] **Step 3 : implémentation service + module**

```ts
// apps/api/src/core/routing/routing.service.ts
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
```

```ts
// apps/api/src/core/routing/routing.module.ts
import { Global, Module } from '@nestjs/common';
import { RoutingService } from './routing.service';

@Global()
@Module({
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
```

- [ ] **Step 4 : enregistrer dans `app.module.ts`**

Ajouter l'import en tête (avec les autres core) :

```ts
import { RoutingModule } from './core/routing/routing.module';
```

et `RoutingModule,` dans `imports:` juste après `EmailModule,`.

- [ ] **Step 5 : `.env.example`**

Après le bloc `# --- File storage ---`, ajouter :

```bash
# --- Mapping engine (phase 10) ---
# none (default, also CI): no road distances/geocoding — manual values only.
# osrm: self-hosted OSRM (docker compose --profile osrm up -d). See docs/getting-started.md.
ROUTING_DRIVER=none
# OSRM_HOST=http://localhost:5000
# nominatim: best-effort address→lat/lng with persistent DB cache (1 req/s).
GEOCODING_DRIVER=none
# NOMINATIM_HOST=https://nominatim.openstreetmap.org
```

- [ ] **Step 6 : vérifier le vert**

Run : `pnpm --filter @pulsar/api test -- routing.service` puis `pnpm --filter @pulsar/api typecheck`
Expected : PASS (5 tests), typecheck OK.

- [ ] **Step 7 : commit**

```bash
git add apps/api/src/core/routing apps/api/src/app.module.ts .env.example
git commit -m "feat(api): RoutingService behind env drivers + persistent geocode cache"
```

---

### Task 6 : géocodage best-effort des locations

**Files:**
- Modify: `apps/api/src/modules/transportation/locations/locations.service.ts`
- Test: `apps/api/src/modules/transportation/locations/locations.geocode.spec.ts`

- [ ] **Step 1 : test qui échoue**

```ts
// apps/api/src/modules/transportation/locations/locations.geocode.spec.ts
import { LocationsService } from './locations.service';
import type { OwnershipService } from '../../../prisma/ownership.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { RoutingService } from '../../../core/routing/routing.service';
import type { CreateLocationDto } from './dto/location.dto';
import { LocationType } from '@pulsar/shared';

function build(geocodeResult: { lat: number; lng: number } | null) {
  const prisma = {
    location: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
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
    const { service } = build(null);
    const created = await service.create('t1', { ...dto });
    expect(created.latitude).toBeUndefined();
    expect(created.longitude).toBeUndefined();
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
});
```

- [ ] **Step 2 : vérifier l'échec**

Run : `pnpm --filter @pulsar/api test -- locations.geocode`
Expected : FAIL — le constructeur n'accepte pas `RoutingService` / pas de géocodage.

- [ ] **Step 3 : implémentation**

Dans `locations.service.ts`, remplacer le constructeur et `create`/`update` :

```ts
import { RoutingService } from '../../../core/routing/routing.service';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly routing: RoutingService,
  ) {}
```

```ts
  /** Single-line address fed to the geocoder. */
  private geocodeAddress(loc: {
    addressLine1: string;
    city: string;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  }) {
    return this.routing.geocode(
      [loc.addressLine1, loc.city, loc.state, loc.postalCode, loc.country ?? 'CA']
        .filter(Boolean)
        .join(', '),
    );
  }

  async create(tenantId: string, dto: CreateLocationDto) {
    const existing = await this.prisma.location.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Location code "${dto.code}" already exists`);
    await this.ownership.assertOwnedIfSet('customer', dto.customerId, tenantId);
    // Manual coordinates always win; geocoding only fills the gap, best-effort.
    let coords: { latitude: number; longitude: number } | undefined;
    if (dto.latitude == null || dto.longitude == null) {
      const geo = await this.geocodeAddress(dto);
      if (geo) coords = { latitude: geo.lat, longitude: geo.lng };
    }
    return this.prisma.location.create({ data: { tenantId, ...dto, ...coords } });
  }

  async update(tenantId: string, id: string, dto: UpdateLocationDto) {
    const current = await this.get(tenantId, id);
    await this.ownership.assertOwnedIfSet('customer', dto.customerId, tenantId);
    const { code: _code, ...data } = dto;
    const merged = { ...current, ...data };
    // Geocode only when the record would otherwise end up without coordinates —
    // existing (possibly manual) coordinates are never overwritten.
    if (merged.latitude == null || merged.longitude == null) {
      const geo = await this.geocodeAddress(merged);
      if (geo) Object.assign(data, { latitude: geo.lat, longitude: geo.lng });
    }
    return this.prisma.location.update({ where: { id }, data });
  }
```

- [ ] **Step 4 : vérifier le vert**

Run : `pnpm --filter @pulsar/api test -- locations.geocode` puis `pnpm --filter @pulsar/api typecheck`
Expected : PASS (5 tests), typecheck OK.

- [ ] **Step 5 : commit**

```bash
git add apps/api/src/modules/transportation/locations
git commit -m "feat(api): best-effort Nominatim geocoding on location create/update"
```

---

### Task 7 : distance auto au build de route (OSRM → haversine, MANUAL intouchable)

**Files:**
- Modify: `apps/api/src/modules/transportation/routes/routes.service.ts`
- Test: e2e dans Task 8+ (`phase10-map.e2e-spec.ts`) — ici typecheck + test ciblé du service via e2e plus bas.

- [ ] **Step 1 : implémentation**

Dans `routes.service.ts` :

(a) imports — remplacer la ligne `@pulsar/shared` et ajouter :

```ts
import { DistanceSource, LoadStatus, StopStatus, TrackingEventType, validateWindowPair } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { pathDistanceKm, type LatLng } from '../../../core/routing/haversine';
import { RoutingService } from '../../../core/routing/routing.service';
```

(b) constructeur :

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly cost: LoadCostService,
    private readonly routing: RoutingService,
  ) {}
```

(c) dans `createForLoad`, APRÈS la boucle de validation des fenêtres et AVANT le
`deleteMany`, insérer :

```ts
    // --- Distance/duration/geometry resolution (phase 10) ---------------------
    // Manual distance always wins (billing input) but geometry is still computed
    // when coordinates exist, so the detail map stays true.
    const ordered = dto.stops.slice().sort((a, b) => a.sequence - b.sequence);
    const locations = await this.prisma.location.findMany({
      where: { id: { in: [...new Set(ordered.map((s) => s.locationId))] }, tenantId },
      select: { id: true, latitude: true, longitude: true },
    });
    const coordsById = new Map(locations.map((l) => [l.id, l]));
    const points: LatLng[] = [];
    let allGeocoded = ordered.length >= 2;
    for (const s of ordered) {
      const loc = coordsById.get(s.locationId);
      if (loc?.latitude == null || loc?.longitude == null) {
        allGeocoded = false;
        break;
      }
      points.push({ lat: loc.latitude, lng: loc.longitude });
    }

    let totalDistanceKm = dto.totalDistanceKm ?? null;
    let estimatedDurationMin = dto.estimatedDurationMin ?? null;
    let distanceSource: DistanceSource | null =
      dto.totalDistanceKm != null ? DistanceSource.MANUAL : null;
    let geometry: unknown = null;

    if (allGeocoded) {
      const osrm = await this.routing.route(points);
      if (osrm) {
        geometry = osrm.geometry;
        if (distanceSource !== DistanceSource.MANUAL) {
          totalDistanceKm = osrm.distanceKm;
          estimatedDurationMin = estimatedDurationMin ?? osrm.durationMin;
          distanceSource = DistanceSource.OSRM;
        }
      } else if (distanceSource !== DistanceSource.MANUAL) {
        // As-the-crow-flies fallback, ~20-30% under the road figure: flagged so
        // the UI shows an "estimate" badge (spec §A). Recomputed when OSRM is back.
        totalDistanceKm = pathDistanceKm(points);
        distanceSource = DistanceSource.HAVERSINE;
      }
    }
```

(d) dans le `this.prisma.route.create`, remplacer les deux lignes distance/durée :

```ts
        totalDistanceKm: totalDistanceKm ?? undefined,
        estimatedDurationMin: estimatedDurationMin ?? undefined,
        distanceSource: distanceSource ?? undefined,
        geometry: (geometry ?? undefined) as Prisma.InputJsonValue | undefined,
```

- [ ] **Step 2 : typecheck + suites existantes**

Run : `pnpm --filter @pulsar/api typecheck; pnpm --filter @pulsar/api test`
Expected : OK — aucun test existant cassé.

- [ ] **Step 3 : non-régression e2e routes existantes (driver none, locations sans coords)**

Run : `pnpm --filter @pulsar/api test:e2e -- workflow`
Expected : PASS — comportement inchangé quand les locations n'ont pas de coordonnées.

- [ ] **Step 4 : commit**

```bash
git add apps/api/src/modules/transportation/routes
git commit -m "feat(api): auto distance/duration/geometry on route build (OSRM, haversine fallback)"
```

---

### Task 8 : endpoint public de position chauffeur

**Files:**
- Modify: `apps/api/src/modules/transportation/public/public-links.service.ts`
- Modify: `apps/api/src/modules/transportation/public/public-links.controller.ts`
- Test: `apps/api/test/phase10-map.e2e-spec.ts` (créé ici)

- [ ] **Step 1 : écrire le squelette e2e + tests position (qui échouent)**

Créer `apps/api/test/phase10-map.e2e-spec.ts`. Squelette identique aux suites
existantes (cf. `phase8-mvp-line.e2e-spec.ts`) :

```ts
/**
 * E2E for phase 10 — driver positions, public tracking coordinates, active-map,
 * haversine fallback distance. Runs with ROUTING_DRIVER/GEOCODING_DRIVER unset
 * (the "none" drivers) — zero network dependency.
 *
 * Prerequisites: reachable PostgreSQL with the seed applied
 * (admin@pulsar.dev / admin123, tenant: acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 10 — positions, public coords, active-map, haversine (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P10${Date.now().toString(36).toUpperCase()}`;
  const ids = {
    customer: '',
    origin: '', // Montréal, WITH coords
    destination: '', // Québec, WITH coords
    carrier: '',
    loadId: '',
    loadNumber: '',
    shipmentId: '',
    driverToken: '',
    trackingToken: '',
  };
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;

    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'P10 Customer' })
      .expect(201);
    ids.customer = customer.body.id;

    // Locations with MANUAL coordinates (geocoding driver is off).
    const origin = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-ORI`, name: 'P10 Montréal', type: 'WAREHOUSE',
        addressLine1: '1 P10 St', city: 'Montréal', state: 'QC', country: 'CA',
        latitude: 45.5019, longitude: -73.5674,
      })
      .expect(201);
    ids.origin = origin.body.id;

    const destination = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-DST`, name: 'P10 Québec', type: 'WAREHOUSE',
        addressLine1: '2 P10 St', city: 'Québec', state: 'QC', country: 'CA',
        latitude: 46.8131, longitude: -71.2075,
      })
      .expect(201);
    ids.destination = destination.body.id;

    const carrier = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: `${suffix}-CAR`, name: 'P10 Carrier' })
      .expect(201);
    ids.carrier = carrier.body.id;

    // Order → confirm → plan → load → route (NO manual distance) → assign → dispatch
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    ids.shipmentId = planned.body.shipments[0].id;
    ids.trackingToken = planned.body.shipments[0].trackingToken;

    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    ids.loadId = load.body.id;
    ids.loadNumber = load.body.loadNumber;

    await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipmentId}/assign-load`)
      .set(auth())
      .send({ loadId: ids.loadId })
      .expect(201);

    const route = await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: ids.loadId,
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: ids.origin, shipmentId: ids.shipmentId },
          { sequence: 2, type: 'DELIVERY', locationId: ids.destination, shipmentId: ids.shipmentId },
        ],
      })
      .expect(201);
    // Haversine fallback assertions live in the dedicated test below; keep the id.
    expect(route.body.id).toBeDefined();

    await request(http)
      .post(`/api/v1/transportation/loads/${ids.loadId}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.loadId}/dispatch`)
      .set(auth())
      .expect(201);

    const link = await request(http)
      .post(`/api/v1/transportation/loads/${ids.loadId}/driver-link`)
      .set(auth())
      .expect(201);
    ids.driverToken = (link.body.url as string).split('/').pop()!;
  });

  afterAll(async () => {
    await app.close();
  });

  // NOTE : si le tracking token n'est pas dans la réponse du plan, le récupérer via
  // GET /api/v1/transportation/shipments/:id (champ trackingToken) — adapter ici.

  it('driver position: recorded on a DISPATCHED load, deduped under 60s', async () => {
    const first = await request(http)
      .post(`/api/v1/public/driver/${ids.driverToken}/position`)
      .send({ latitude: 45.6, longitude: -73.2 })
      .expect(200);
    expect(first.body.recorded).toBe(true);

    const second = await request(http)
      .post(`/api/v1/public/driver/${ids.driverToken}/position`)
      .send({ latitude: 45.61, longitude: -73.21 })
      .expect(200);
    expect(second.body.recorded).toBe(false); // < 60s after the first one
  });

  it('driver position: 400 on out-of-bounds lat/lng (anonymous input is validated)', async () => {
    await request(http)
      .post(`/api/v1/public/driver/${ids.driverToken}/position`)
      .send({ latitude: 9999, longitude: 9999 })
      .expect(400);
  });

  it('driver position: 404 on unknown token', async () => {
    await request(http)
      .post('/api/v1/public/driver/not-a-real-token/position')
      .send({ latitude: 45, longitude: -73 })
      .expect(404);
  });

  it('driver position: 400 when the load is not DISPATCHED/IN_TRANSIT', async () => {
    // Fresh PLANNED load (driver links are allowed from PLANNED)
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/shipments/${planned.body.shipments[0].id}/assign-load`)
      .set(auth())
      .send({ loadId: load.body.id })
      .expect(201);
    const link = await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/driver-link`)
      .set(auth())
      .expect(201);
    const plannedToken = (link.body.url as string).split('/').pop()!;

    await request(http)
      .post(`/api/v1/public/driver/${plannedToken}/position`)
      .send({ latitude: 45, longitude: -73 })
      .expect(400);
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run : `pnpm --filter @pulsar/api test:e2e -- phase10-map`
Expected : FAIL — 404 sur `POST /public/driver/:token/position` (route inexistante).

- [ ] **Step 3 : implémentation service**

Dans `public-links.service.ts` :

(a) imports — étendre :

```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LoadStatus, MODULE_KEYS, ShipmentStatus, StopStatus, TrackingEventType } from '@pulsar/shared';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
```

(b) constructeur — ajouter `private readonly modulesCache: TenantModulesCacheService,`.

(c) nouvelle méthode (après `driverAttachPodPhoto`) :

```ts
  /** Driver position ping. Best-effort firehose: bounded DTO upstream, dedup 60s here. */
  async driverRecordPosition(token: string, latitude: number, longitude: number) {
    const load = await this.loadByDriverToken(token);
    // Public routes bypass ModulesGuard — re-check activation (CLAUDE.md rule 15).
    const enabled = await this.modulesCache.getEnabledKeys(load.tenantId);
    if (!enabled.has(MODULE_KEYS.TRANSPORTATION)) {
      throw new ForbiddenException('Transportation is not enabled for this shipper');
    }
    if (load.status !== LoadStatus.DISPATCHED && load.status !== LoadStatus.IN_TRANSIT) {
      throw new BadRequestException('Positions can only be recorded on DISPATCHED or IN_TRANSIT loads');
    }
    const last = await this.prisma.trackingEvent.findFirst({
      where: { tenantId: load.tenantId, loadId: load.id, type: TrackingEventType.POSITION_UPDATE },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    if (last && Date.now() - last.occurredAt.getTime() < 60_000) {
      return { recorded: false }; // at most one stored position per minute per load
    }
    await this.prisma.trackingEvent.create({
      data: {
        tenantId: load.tenantId,
        type: TrackingEventType.POSITION_UPDATE,
        loadId: load.id,
        latitude,
        longitude,
      },
    });
    return { recorded: true };
  }
```

NB : `loadByDriverToken` retourne le load avec `tenantId` et `status` (colonnes du
modèle) — rien à changer dans l'include.

- [ ] **Step 4 : implémentation contrôleur**

Dans `public-links.controller.ts` :

(a) import class-validator — ajouter `IsNumber, Max, Min` :

```ts
import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
```

(b) DTO après `DriverPodDto` :

```ts
class DriverPositionDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}
```

(c) endpoint après `driverPod` :

```ts
  /** Geolocation ping from the driver page. Deduped server-side (≥60s apart). */
  @Post('driver/:token/position')
  @HttpCode(200)
  driverPosition(@Param('token') token: string, @Body() dto: DriverPositionDto) {
    return this.links.driverRecordPosition(token, dto.latitude, dto.longitude);
  }
```

- [ ] **Step 5 : vérifier le vert**

Run : `pnpm --filter @pulsar/api test:e2e -- phase10-map`
Expected : PASS — les 4 tests position passent.

- [ ] **Step 6 : commit**

```bash
git add apps/api/src/modules/transportation/public apps/api/test/phase10-map.e2e-spec.ts
git commit -m "feat(api): public driver position endpoint (bounded, deduped, module re-checked)"
```

---

### Task 9 : `lastPosition` + coordonnées dans le suivi public

**Files:**
- Modify: `apps/api/src/modules/transportation/public/public-links.service.ts` (méthode `getTracking`)
- Test: `apps/api/test/phase10-map.e2e-spec.ts` (ajouts)

- [ ] **Step 1 : tests e2e qui échouent**

Ajouter à `phase10-map.e2e-spec.ts` :

```ts
  it('public tracking exposes origin/destination coords and lastPosition while undelivered', async () => {
    const view = await request(http)
      .get(`/api/v1/public/tracking/${ids.trackingToken}`)
      .expect(200);

    expect(view.body.origin.latitude).toBeCloseTo(45.5019, 3);
    expect(view.body.origin.longitude).toBeCloseTo(-73.5674, 3);
    expect(view.body.destination.latitude).toBeCloseTo(46.8131, 3);
    // Position posted in the earlier test:
    expect(view.body.lastPosition).toMatchObject({ latitude: 45.6, longitude: -73.2 });
    expect(view.body.lastPosition.occurredAt).toBeDefined();
    // Rule 10: no tenant/internal leakage, no position history
    expect(JSON.stringify(view.body)).not.toContain('tenantId');
    expect(view.body.events.find((e: { latitude?: number }) => e.latitude != null)).toBeUndefined();
  });
```

Run : `pnpm --filter @pulsar/api test:e2e -- phase10-map`
Expected : FAIL — `origin.latitude` undefined / `lastPosition` absent.

- [ ] **Step 2 : implémentation**

Dans `getTracking` de `public-links.service.ts` :

(a) selects coordonnées :

```ts
        originLocation: { select: { city: true, state: true, latitude: true, longitude: true } },
        destinationLocation: { select: { city: true, state: true, latitude: true, longitude: true } },
```

(b) après le `if (!shipment) throw …`, calcul de la dernière position :

```ts
    // Last position of the carrying load, only while the shipment is not delivered.
    // Single point, no history, no other stops — a multi-customer load never leaks
    // its itinerary (rule 10 + spec §B).
    const delivered =
      shipment.status === ShipmentStatus.DELIVERED || shipment.status === ShipmentStatus.CLOSED;
    let lastPosition: { latitude: number; longitude: number; occurredAt: Date } | null = null;
    if (!delivered && shipment.loadId) {
      const pos = await this.prisma.trackingEvent.findFirst({
        where: {
          tenantId: shipment.tenantId,
          loadId: shipment.loadId,
          type: TrackingEventType.POSITION_UPDATE,
          latitude: { not: null },
          longitude: { not: null },
        },
        orderBy: { occurredAt: 'desc' },
        select: { latitude: true, longitude: true, occurredAt: true },
      });
      if (pos) {
        lastPosition = { latitude: pos.latitude!, longitude: pos.longitude!, occurredAt: pos.occurredAt };
      }
    }
```

(c) ajouter `lastPosition,` dans l'objet retourné (projection explicite).

Les imports `ShipmentStatus`/`TrackingEventType` sont déjà ajoutés en Task 8.

- [ ] **Step 3 : vérifier le vert**

Run : `pnpm --filter @pulsar/api test:e2e -- phase10-map`
Expected : PASS.

- [ ] **Step 4 : commit**

```bash
git add apps/api/src/modules/transportation/public apps/api/test/phase10-map.e2e-spec.ts
git commit -m "feat(api): public tracking exposes o/d coords + last load position (undelivered only)"
```

---

### Task 10 : endpoint `active-map` + fallback haversine vérifié

**Files:**
- Modify: `apps/api/src/modules/transportation/loads/loads.service.ts`
- Modify: `apps/api/src/modules/transportation/loads/loads.controller.ts`
- Test: `apps/api/test/phase10-map.e2e-spec.ts` (ajouts)

- [ ] **Step 1 : tests e2e qui échouent**

Ajouter à `phase10-map.e2e-spec.ts` :

```ts
  it('haversine fallback: route built without manual distance got HAVERSINE source ~233 km', async () => {
    const loadDetail = await request(http)
      .get(`/api/v1/transportation/loads/${ids.loadId}`)
      .set(auth())
      .expect(200);
    const route = loadDetail.body.route;
    expect(route.distanceSource).toBe('HAVERSINE');
    expect(route.totalDistanceKm).toBeGreaterThan(225);
    expect(route.totalDistanceKm).toBeLessThan(242);
    expect(route.estimatedDurationMin).toBeNull(); // haversine gives no duration
  });

  it('manual distance wins: MANUAL source, value untouched, no haversine overwrite', async () => {
    // Rebuild the PLANNED load's route from Task 8 with a manual distance
    // (the DISPATCHED one cannot be rebuilt).
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/shipments/${planned.body.shipments[0].id}/assign-load`)
      .set(auth())
      .send({ loadId: load.body.id })
      .expect(201);

    const route = await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: load.body.id,
        totalDistanceKm: 500,
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: ids.origin },
          { sequence: 2, type: 'DELIVERY', locationId: ids.destination },
        ],
      })
      .expect(201);
    expect(route.body.totalDistanceKm).toBe(500);
    expect(route.body.distanceSource).toBe('MANUAL');
  });

  it('active-map: dispatched load listed with stops coords, lastPosition, isLate=false', async () => {
    const map = await request(http)
      .get('/api/v1/transportation/loads/active-map')
      .set(auth())
      .expect(200);
    const entry = map.body.find((l: { id: string }) => l.id === ids.loadId);
    expect(entry).toBeDefined();
    expect(entry.loadNumber).toBe(ids.loadNumber);
    expect(entry.carrier).toBe('P10 Carrier');
    expect(entry.isLate).toBe(false);
    expect(entry.lastPosition).toMatchObject({ latitude: 45.6, longitude: -73.2 });
    expect(entry.stops).toHaveLength(2);
    expect(entry.stops[0]).toMatchObject({
      sequence: 1, type: 'PICKUP', city: 'Montréal', latitude: 45.5019,
    });
    // Spec §C: no geometry in this payload (markers only)
    expect(entry.geometry).toBeUndefined();
  });

  it('active-map: late stop flips isLate (same isLate as the exception engine)', async () => {
    // Dedicated load with a past arrival window, dispatched
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/shipments/${planned.body.shipments[0].id}/assign-load`)
      .set(auth())
      .send({ loadId: load.body.id })
      .expect(201);
    await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: load.body.id,
        stops: [
          {
            sequence: 1, type: 'PICKUP', locationId: ids.origin,
            plannedArrivalEarly: new Date(Date.now() - 90 * 60_000).toISOString(),
            plannedArrivalLate: new Date(Date.now() - 60 * 60_000).toISOString(),
          },
          { sequence: 2, type: 'DELIVERY', locationId: ids.destination },
        ],
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/dispatch`)
      .set(auth())
      .expect(201);

    const map = await request(http)
      .get('/api/v1/transportation/loads/active-map')
      .set(auth())
      .expect(200);
    const entry = map.body.find((l: { id: string }) => l.id === load.body.id);
    expect(entry.isLate).toBe(true);
  });

  it('active-map requires auth', async () => {
    await request(http).get('/api/v1/transportation/loads/active-map').expect(401);
  });
```

Run : `pnpm --filter @pulsar/api test:e2e -- phase10-map`
Expected : FAIL — les tests haversine passent déjà (Task 7), `active-map` répond 404
(en fait 400/404 via `@Get(':id')` qui matche `active-map` comme id) — c'est le bug
d'ordre de routes que l'implémentation corrige en déclarant `active-map` AVANT `:id`.

- [ ] **Step 2 : implémentation service**

Dans `loads.service.ts` :

(a) imports — ajouter :

```ts
import { TrackingEventType } from '@pulsar/shared';
import { isLate } from '../exceptions/delay-detection.service';
```

(`LoadStatus` est déjà importé ; fusionner avec l'import `@pulsar/shared` existant.)

(b) nouvelle méthode (placer près de `list`) :

```ts
  /**
   * Aggregated payload for the operational dashboard map. Markers only — the
   * route geometry is deliberately NOT included (heavy, re-fetched every poll;
   * it stays on the load detail). Lateness reuses the exception engine's pure
   * isLate — no duplicated logic.
   */
  async activeMap(tenantId: string) {
    const loads = await this.prisma.load.findMany({
      where: { tenantId, status: { in: [LoadStatus.DISPATCHED, LoadStatus.IN_TRANSIT] } },
      orderBy: { dispatchedAt: 'desc' },
      include: {
        carrier: { select: { name: true } },
        route: {
          select: {
            stops: {
              orderBy: { sequence: 'asc' },
              select: {
                sequence: true,
                type: true,
                status: true,
                plannedArrivalEarly: true,
                plannedArrivalLate: true,
                actualArrivalAt: true,
                location: { select: { name: true, city: true, latitude: true, longitude: true } },
              },
            },
          },
        },
      },
    });

    // Latest POSITION_UPDATE per load — one query for the whole board.
    const positions = await this.prisma.trackingEvent.findMany({
      where: {
        tenantId,
        loadId: { in: loads.map((l) => l.id) },
        type: TrackingEventType.POSITION_UPDATE,
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: { occurredAt: 'desc' },
      select: { loadId: true, latitude: true, longitude: true, occurredAt: true },
    });
    const lastByLoad = new Map<string, (typeof positions)[number]>();
    for (const p of positions) {
      if (p.loadId && !lastByLoad.has(p.loadId)) lastByLoad.set(p.loadId, p);
    }

    const now = new Date();
    return loads.map((load) => {
      const stops = load.route?.stops ?? [];
      const pos = lastByLoad.get(load.id);
      return {
        id: load.id,
        loadNumber: load.loadNumber,
        status: load.status,
        carrier: load.carrier?.name ?? null,
        isLate: stops.some((s) => isLate(s, now).late),
        lastPosition: pos
          ? { latitude: pos.latitude!, longitude: pos.longitude!, occurredAt: pos.occurredAt }
          : null,
        stops: stops.map((s) => ({
          sequence: s.sequence,
          type: s.type,
          status: s.status,
          name: s.location.name,
          city: s.location.city,
          latitude: s.location.latitude,
          longitude: s.location.longitude,
        })),
      };
    });
  }
```

- [ ] **Step 3 : implémentation contrôleur — ORDRE CRITIQUE**

Dans `loads.controller.ts`, insérer ENTRE `list` (`@Get()`) et `get` (`@Get(':id')`) —
Nest matche dans l'ordre de déclaration, après `@Get(':id')` la route serait avalée :

```ts
  /** Operational dashboard map — markers only, no geometry (spec §C). */
  @Get('active-map')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  activeMap(@CurrentUser() user: AuthUser) {
    return this.loads.activeMap(user.tenantId);
  }
```

- [ ] **Step 4 : vérifier le vert**

Run : `pnpm --filter @pulsar/api test:e2e -- phase10-map`
Expected : PASS — la suite complète phase 10 (position + tracking + haversine + active-map).

- [ ] **Step 5 : commit**

```bash
git add apps/api/src/modules/transportation/loads apps/api/test/phase10-map.e2e-spec.ts
git commit -m "feat(api): loads/active-map aggregate (isLate reuse, last positions, no geometry)"
```

---

### Task 11 : pings géoloc sur la page chauffeur (web)

**Files:**
- Modify: `apps/web/src/routes/driver/[token]/+page.svelte`

- [ ] **Step 1 : implémentation script**

Dans le `<script lang="ts">`, après la déclaration `podCandidates`, ajouter :

```ts
  // --- Position sharing (phase 10) ---------------------------------------
  // Immediate ping on load + on tab-visible + every 2 min while the page is
  // open and the load active. Screen locked / page closed = no pings (assumed).
  let sharing = $state(true);
  let lastSentAt = $state<number | null>(null);

  const activeLoad = $derived(view?.status === 'DISPATCHED' || view?.status === 'IN_TRANSIT');

  function sendPosition() {
    if (!sharing || !activeLoad || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void api(`/public/driver/${token}/position`, {
          method: 'POST',
          body: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        })
          .then(() => (lastSentAt = Date.now()))
          .catch(() => {}); // best-effort: a failed ping never disturbs the driver
      },
      () => {}, // permission denied / unavailable: stay silent
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }

  $effect(() => {
    if (!view || !activeLoad) return;
    sendPosition(); // fresh point on every page open (spec §B)
    const timer = setInterval(sendPosition, 120_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') sendPosition();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });
```

- [ ] **Step 2 : indicateur UI**

Dans le markup, juste sous l'en-tête du load (repérer le bloc qui affiche
`view.loadNumber` / le statut), ajouter :

```svelte
    {#if activeLoad}
      <div class="mb-3 flex items-center justify-between rounded-card border border-edge bg-surface px-3 py-2 text-xs text-ink-muted">
        <span>
          {sharing ? 'Position sharing active' : 'Position sharing paused'}
          {#if sharing && lastSentAt}
            · last sent {new Date(lastSentAt).toLocaleTimeString()}
          {/if}
        </span>
        <button
          type="button"
          class="font-semibold text-accent hover:underline"
          onclick={() => (sharing = !sharing)}
        >
          {sharing ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    {/if}
```

(Adapter les classes au style ambiant de la page si elles diffèrent — la page
chauffeur est mobile-first ; rester sur les tokens `text-ink-muted`/`border-edge`.)

- [ ] **Step 3 : vérification**

Run : `pnpm --filter @pulsar/web typecheck`
Expected : OK.
Vérification manuelle (optionnelle ici, requise en Task 16) : `pnpm dev`, générer un
lien chauffeur sur un load DISPATCHED, ouvrir `/driver/<token>`, accepter la géoloc →
l'événement POSITION_UPDATE apparaît dans `GET /transportation/tracking/events?loadId=…`.

- [ ] **Step 4 : commit**

```bash
git add apps/web/src/routes/driver
git commit -m "feat(web): driver page geolocation pings (consent-gated, immediate + 2min + visible)"
```

---

### Task 12 : `OpsMap` + section carte du dashboard (polling 45 s)

**Files:**
- Create: `apps/web/src/lib/components/OpsMap.svelte`
- Modify: `apps/web/src/routes/(app)/dashboard/+page.svelte`

- [ ] **Step 1 : composant `OpsMap`**

```svelte
<script lang="ts">
  <!-- apps/web/src/lib/components/OpsMap.svelte -->
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import 'leaflet/dist/leaflet.css';

  interface MapStop {
    sequence: number;
    type: string;
    status: string;
    name: string;
    city: string;
    latitude: number | null;
    longitude: number | null;
  }
  interface MapLoad {
    id: string;
    loadNumber: string;
    status: string;
    carrier: string | null;
    isLate: boolean;
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
    stops: MapStop[];
  }

  let { loads = [] }: { loads: MapLoad[] } = $props();

  let el: HTMLDivElement;
  let leaflet = $state<typeof import('leaflet') | null>(null);
  let map: import('leaflet').Map | null = null;
  let markers: import('leaflet').LayerGroup | null = null;
  let fitted = false; // fit bounds on first data only — don't yank the user's pan/zoom on each poll

  onMount(() => {
    let destroyed = false;
    void import('leaflet').then((L) => {
      if (destroyed) return;
      map = L.map(el, { attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(map);
      markers = L.layerGroup().addTo(map);
      map.setView([46.0, -72.5], 6); // sensible default until data lands
      leaflet = L; // set last: triggers the $effect below once ready
    });
    return () => {
      destroyed = true;
      map?.remove();
    };
  });

  /** Marker anchor: last known position, else first pending stop with coords. */
  function anchorOf(load: MapLoad): [number, number] | null {
    if (load.lastPosition) return [load.lastPosition.latitude, load.lastPosition.longitude];
    const next =
      load.stops.find((s) => s.status === 'PENDING' && s.latitude != null && s.longitude != null) ??
      load.stops.find((s) => s.latitude != null && s.longitude != null);
    return next ? [next.latitude!, next.longitude!] : null;
  }

  $effect(() => {
    const L = leaflet;
    if (!L || !map || !markers) return;
    markers.clearLayers();
    const anchors: [number, number][] = [];
    for (const load of loads) {
      const at = anchorOf(load);
      if (!at) continue;
      anchors.push(at);
      // Leaflet draws outside the CSS cascade — literal colors accepted here.
      const color = load.isLate ? '#dc2626' : '#1d4ed8';
      L.circleMarker(at, { radius: 9, color, fillColor: color, fillOpacity: 0.85 })
        .addTo(markers)
        .bindTooltip(
          `${load.loadNumber} — ${load.carrier ?? 'no carrier'} · ${load.status}${load.isLate ? ' · LATE' : ''}`,
        )
        .on('click', () => void goto(`/loads/${load.id}`));
    }
    if (!fitted && anchors.length > 0) {
      fitted = true;
      if (anchors.length === 1) map.setView(anchors[0], 9);
      else map.fitBounds(L.latLngBounds(anchors).pad(0.2));
    }
  });
</script>

<div bind:this={el} class="h-80 w-full rounded-card border border-edge"></div>
```

NB : le commentaire HTML dans le script ci-dessus est un repère de chemin — ne pas le
copier (un commentaire HTML est invalide dans `<script>`); le fichier commence à
`import { goto }`.

- [ ] **Step 2 : section dashboard + polling**

Dans `apps/web/src/routes/(app)/dashboard/+page.svelte` :

(a) script — ajouter aux imports `EmptyState` (barrel ui) et le composant :

```ts
  import { PageHeader, Card, Skeleton, EmptyState } from '$lib/components/ui';
  import OpsMap from '$lib/components/OpsMap.svelte';
```

(b) état + chargement (après `loadStats`) :

```ts
  interface MapLoad {
    id: string;
    loadNumber: string;
    status: string;
    carrier: string | null;
    isLate: boolean;
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
    stops: {
      sequence: number; type: string; status: string; name: string; city: string;
      latitude: number | null; longitude: number | null;
    }[];
  }

  let mapLoads = $state<MapLoad[]>([]);
  let mapLoaded = $state(false);

  async function loadMap() {
    try {
      mapLoads = await api<MapLoad[]>('/transportation/loads/active-map');
    } catch {
      // map is an enhancement — stats above already surface API errors
    } finally {
      mapLoaded = true;
    }
  }

  $effect(() => {
    void loadMap();
    // 45s poll, visible tab only (spec §C)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadMap();
    }, 45_000);
    return () => clearInterval(timer);
  });
```

(c) markup — insérer entre la grille de stats et la Card « Workflow » :

```svelte
<div class="mt-4">
  <Card>
    <div class="mb-2 flex items-center justify-between">
      <h2 class="text-sm font-bold text-ink">Live operations</h2>
      {#if mapLoads.some((l) => l.isLate)}
        <span class="text-xs font-semibold text-danger">
          {mapLoads.filter((l) => l.isLate).length} late
        </span>
      {/if}
    </div>
    {#if !mapLoaded}
      <Skeleton rows={4} />
    {:else if mapLoads.length === 0}
      <EmptyState title="No active loads" description="Dispatched and in-transit loads appear here." />
    {:else}
      <OpsMap loads={mapLoads} />
    {/if}
  </Card>
</div>
```

(Si les props d'`EmptyState` diffèrent — vérifier `apps/web/src/lib/components/ui/EmptyState.svelte` —
adapter à sa signature réelle.)

- [ ] **Step 3 : vérification**

Run : `pnpm --filter @pulsar/web typecheck`
Expected : OK.

- [ ] **Step 4 : commit**

```bash
git add apps/web/src/lib/components/OpsMap.svelte "apps/web/src/routes/(app)/dashboard"
git commit -m "feat(web): live operations map on dashboard (45s poll, late loads in red)"
```

---

### Task 13 : mini-carte publique sur la page de suivi

**Files:**
- Create: `apps/web/src/lib/components/TrackMap.svelte`
- Modify: `apps/web/src/routes/track/[token]/+page.svelte`

- [ ] **Step 1 : composant `TrackMap`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import 'leaflet/dist/leaflet.css';

  interface Point {
    latitude: number | null;
    longitude: number | null;
  }
  let {
    origin,
    destination,
    lastPosition = null,
  }: {
    origin: Point;
    destination: Point;
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
  } = $props();

  let el: HTMLDivElement;
  let hasPoints = $state(false);

  onMount(() => {
    let map: import('leaflet').Map | null = null;
    let destroyed = false;

    void (async () => {
      const L = await import('leaflet');
      if (destroyed) return;

      const pts: [number, number][] = [];
      const add = (p: Point | null, color: string, label: string) => {
        if (p?.latitude == null || p?.longitude == null) return;
        const at: [number, number] = [p.latitude, p.longitude];
        pts.push(at);
        L.circleMarker(at, { radius: 8, color, fillColor: color, fillOpacity: 0.85 })
          .addTo(map!)
          .bindTooltip(label);
      };

      if (
        (origin.latitude == null || origin.longitude == null) &&
        (destination.latitude == null || destination.longitude == null) &&
        !lastPosition
      ) {
        return; // nothing to draw: map stays hidden (graceful degradation)
      }
      hasPoints = true;

      map = L.map(el, { attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(map);

      add(origin, '#1d4ed8', 'Origin');
      add(destination, '#1d4ed8', 'Destination');
      if (lastPosition) {
        add(
          lastPosition,
          '#15803d',
          `Last position — ${new Date(lastPosition.occurredAt).toLocaleString()}`,
        );
      }

      if (pts.length === 1) map.setView(pts[0], 9);
      else map.fitBounds(L.latLngBounds(pts).pad(0.2));
    })();

    return () => {
      destroyed = true;
      map?.remove();
    };
  });
</script>

<div bind:this={el} class={`h-56 w-full rounded-card border border-edge ${hasPoints ? '' : 'hidden'}`}></div>
```

- [ ] **Step 2 : brancher la page de suivi**

Dans `apps/web/src/routes/track/[token]/+page.svelte` :

(a) import : `import TrackMap from '$lib/components/TrackMap.svelte';`

(b) étendre `TrackingView` :

```ts
    origin: { city: string; state: string | null; latitude: number | null; longitude: number | null };
    destination: { city: string; state: string | null; latitude: number | null; longitude: number | null };
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
```

(c) markup — juste après le paragraphe origine → destination (avant la Card des dates) :

```svelte
    <div class="mb-5">
      <TrackMap origin={view.origin} destination={view.destination} lastPosition={view.lastPosition} />
    </div>
```

- [ ] **Step 3 : vérification**

Run : `pnpm --filter @pulsar/web typecheck`
Expected : OK.

- [ ] **Step 4 : commit**

```bash
git add apps/web/src/lib/components/TrackMap.svelte apps/web/src/routes/track
git commit -m "feat(web): public tracking mini-map (origin, destination, last position)"
```

---

### Task 14 : géométrie réelle sur `LoadMap` + badge provenance distance

**Files:**
- Modify: `apps/web/src/lib/components/LoadMap.svelte`
- Modify: `apps/web/src/routes/(app)/loads/[id]/+page.svelte`

- [ ] **Step 1 : `LoadMap` — prop `geometry`, tracé `L.geoJSON`**

(a) props :

```ts
  let { stops = [] as StopIn[], loadId, geometry = null as unknown } = $props();
```

(b) remplacer la ligne `L.polyline(latlngs, { color: '#1d4ed8', dashArray: '6 6' }).addTo(map);` par :

```ts
      if (geometry) {
        // OSRM GeoJSON is [lng, lat]; L.geoJSON handles the order natively.
        // NEVER feed raw GeoJSON coords to L.polyline (expects [lat, lng]) —
        // the route would draw in the ocean (spec §C).
        L.geoJSON(geometry as GeoJSON.GeoJsonObject, {
          style: { color: '#1d4ed8', weight: 3, opacity: 0.8 },
        }).addTo(map);
      } else {
        // Fallback: straight dashed lines between stops.
        L.polyline(latlngs, { color: '#1d4ed8', dashArray: '6 6' }).addTo(map);
      }
```

(`GeoJSON` est un namespace global apporté par `@types/leaflet` — si svelte-check le
refuse, typer `geometry` en `Parameters<typeof L.geoJSON>[0]`-équivalent local ou
`object | null` et caster à l'appel.)

- [ ] **Step 2 : page détail load — types + passage de la prop + badge**

Dans `apps/web/src/routes/(app)/loads/[id]/+page.svelte` :

(a) étendre `RouteDetail` :

```ts
    distanceSource: 'MANUAL' | 'OSRM' | 'HAVERSINE' | null;
    geometry: unknown;
```

(b) passer la géométrie à la carte (repérer `<LoadMap stops={mapStops} {loadId} />`) :

```svelte
              <LoadMap stops={mapStops} {loadId} geometry={route?.geometry ?? null} />
```

(c) badge de provenance — repérer l'endroit où `route.totalDistanceKm` est affiché
(en-tête de la section route) et ajouter à côté de la valeur :

```svelte
              {#if route.distanceSource === 'HAVERSINE'}
                <Badge tone="warning">estimate — straight-line</Badge>
              {:else if route.distanceSource === 'OSRM'}
                <Badge tone="neutral">OSRM</Badge>
              {/if}
```

Avant d'écrire : ouvrir `apps/web/src/lib/components/ui/Badge.svelte` et vérifier les
valeurs admises de `tone` ; utiliser le ton « warning/attention » réel du design system
pour HAVERSINE et le ton neutre pour OSRM. `Badge` est déjà importé dans la page.

Rappel spec §A : le badge « estimation » sur HAVERSINE est **non négociable**
(le vol d'oiseau sous-estime de 20-30 % et alimente PER_KM).

- [ ] **Step 3 : vérification**

Run : `pnpm --filter @pulsar/web typecheck`
Expected : OK.

- [ ] **Step 4 : commit**

```bash
git add apps/web/src/lib/components/LoadMap.svelte "apps/web/src/routes/(app)/loads"
git commit -m "feat(web): real OSRM geometry on load map + distance source badge"
```

---

### Task 15 : docker OSRM (profil), doc d'amorçage, e2e OSRM réel conditionnelle

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.gitignore`
- Modify: `docs/getting-started.md`
- Create: `apps/api/test/phase10-osrm-real.e2e-spec.ts`

- [ ] **Step 1 : service docker (profil opt-in — `pnpm db:up` n'est pas alourdi)**

Dans `docker-compose.yml`, après le service `db` :

```yaml
  # Optional self-hosted routing engine (phase 10). Opt-in profile:
  #   docker compose --profile osrm up -d osrm
  # Requires a prepared extract in ./osrm-data — see docs/getting-started.md.
  osrm:
    image: ghcr.io/project-osrm/osrm-backend:v6.0.0
    container_name: pulsar-osrm
    profiles: ["osrm"]
    restart: unless-stopped
    command: osrm-routed --algorithm mld /data/region.osrm
    ports:
      - "5000:5000"
    volumes:
      - ./osrm-data:/data
```

- [ ] **Step 2 : `.gitignore`**

Ajouter une ligne : `osrm-data/`

- [ ] **Step 3 : doc d'amorçage**

Dans `docs/getting-started.md`, ajouter une section (avant la section dépannage s'il y
en a une, sinon à la fin) :

````markdown
## Moteur carto OSRM (optionnel, phase 10)

Sans OSRM (`ROUTING_DRIVER=none`, défaut), tout fonctionne : distances saisies à la
main ou estimées à vol d'oiseau (badge « estimate »). Pour les vraies distances
routières en local :

```bash
# 1. Télécharger un extrait OSM (Québec ≈ 350 Mo) dans ./osrm-data
mkdir -p osrm-data
curl -L -o osrm-data/region.osm.pbf \
  https://download.geofabrik.de/north-america/canada/quebec-latest.osm.pbf

# 2. Préparer l'extrait (une seule fois, ~10 min ; conteneurs jetables)
docker run --rm -t -v ./osrm-data:/data ghcr.io/project-osrm/osrm-backend:v6.0.0 \
  osrm-extract -p /opt/car.lua /data/region.osm.pbf
docker run --rm -t -v ./osrm-data:/data ghcr.io/project-osrm/osrm-backend:v6.0.0 \
  osrm-partition /data/region.osrm
docker run --rm -t -v ./osrm-data:/data ghcr.io/project-osrm/osrm-backend:v6.0.0 \
  osrm-customize /data/region.osrm

# 3. Lancer le serveur (profil opt-in, pas démarré par pnpm db:up)
docker compose --profile osrm up -d osrm
curl "http://localhost:5000/route/v1/driving/-73.5674,45.5019;-71.2075,46.8131?overview=false"
```

Puis dans `.env` : `ROUTING_DRIVER=osrm` et `OSRM_HOST=http://localhost:5000`.
Géocodage : `GEOCODING_DRIVER=nominatim` utilise le Nominatim public (1 req/s,
cache persistant en BD) — convient au dev et aux petits volumes ; auto-héberger
Nominatim avant tout usage intensif.
````

- [ ] **Step 4 : e2e OSRM réel (skippée sans env)**

```ts
// apps/api/test/phase10-osrm-real.e2e-spec.ts
/**
 * OPTIONAL e2e — runs only when a real OSRM is configured:
 *   ROUTING_DRIVER=osrm OSRM_HOST=http://localhost:5000 pnpm --filter @pulsar/api test:e2e -- osrm-real
 * Skipped entirely otherwise (CI stays network-free).
 * Verifies distance/duration/geometry on a known trip and the geometry's
 * coordinate bounds — catches any [lng,lat]/[lat,lng] inversion (spec §D).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const OSRM_ENABLED = process.env.ROUTING_DRIVER === 'osrm' && !!process.env.OSRM_HOST;
const d = OSRM_ENABLED ? describe : describe.skip;

d('Phase 10 — real OSRM routing (optional e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;
  const suffix = `P10R${Date.now().toString(36).toUpperCase()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Montréal → Québec: OSRM distance/duration/geometry with sane bounds', async () => {
    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'P10R Customer' })
      .expect(201);
    const origin = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-ORI`, name: 'P10R MTL', type: 'WAREHOUSE',
        addressLine1: '1 St', city: 'Montréal', state: 'QC', country: 'CA',
        latitude: 45.5019, longitude: -73.5674,
      })
      .expect(201);
    const destination = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-DST`, name: 'P10R QC', type: 'WAREHOUSE',
        addressLine1: '2 St', city: 'Québec', state: 'QC', country: 'CA',
        latitude: 46.8131, longitude: -71.2075,
      })
      .expect(201);

    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: customer.body.id,
        originLocationId: origin.body.id,
        destinationLocationId: destination.body.id,
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order.body.id}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/shipments/${planned.body.shipments[0].id}/assign-load`)
      .set(auth())
      .send({ loadId: load.body.id })
      .expect(201);

    const route = await request(http)
      .post('/api/v1/transportation/routes')
      .set(auth())
      .send({
        loadId: load.body.id,
        stops: [
          { sequence: 1, type: 'PICKUP', locationId: origin.body.id },
          { sequence: 2, type: 'DELIVERY', locationId: destination.body.id },
        ],
      })
      .expect(201);

    expect(route.body.distanceSource).toBe('OSRM');
    // Road distance MTL→QC ≈ 250-270 km; generous bounds for extract variations.
    expect(route.body.totalDistanceKm).toBeGreaterThan(230);
    expect(route.body.totalDistanceKm).toBeLessThan(330);
    expect(route.body.estimatedDurationMin).toBeGreaterThan(90);

    const geometry = route.body.geometry as { type: string; coordinates: [number, number][] };
    expect(geometry.type).toBe('LineString');
    expect(geometry.coordinates.length).toBeGreaterThan(2);
    // [lng, lat] order: lng in [-75, -70], lat in [45, 48] for this corridor.
    for (const [lng, lat] of geometry.coordinates) {
      expect(lng).toBeGreaterThan(-75);
      expect(lng).toBeLessThan(-70);
      expect(lat).toBeGreaterThan(45);
      expect(lat).toBeLessThan(48);
    }
  });
});
```

- [ ] **Step 5 : vérifier le skip propre**

Run : `pnpm --filter @pulsar/api test:e2e -- osrm-real`
Expected : suite **skipped** (env non défini) — 0 failure.

- [ ] **Step 6 : commit**

```bash
git add docker-compose.yml .gitignore docs/getting-started.md apps/api/test/phase10-osrm-real.e2e-spec.ts
git commit -m "feat(infra): opt-in OSRM docker profile, bootstrap doc, conditional real-OSRM e2e"
```

---

### Task 16 : docs de phase + vérification finale

**Files:**
- Modify: `docs/etat-du-projet.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1 : `CLAUDE.md` — règles dures phase 10**

Ajouter après le bloc « Hard rules (continued, phase 7) » :

```markdown
## Hard rules (continued, phase 10)

19. Tout appel OSRM/Nominatim passe par `RoutingService` (core/routing) — best-effort,
    timeout 3 s, jamais bloquant. `Route.distanceSource = MANUAL` n'est JAMAIS écrasé
    par un recalcul ; `geometry` est purement display (jamais d'usage billing).
20. Le payload public de suivi n'expose qu'UNE position (la dernière, load non livré)
    et les coordonnées origine/destination du shipment — jamais d'historique ni les
    autres stops d'une tournée. `active-map` n'embarque pas de géométrie.
```

- [ ] **Step 2 : `docs/etat-du-projet.md`**

Ajouter la ligne phase 10 au tableau « Où on est rendu » (après la ligne 9) :

```markdown
| 10 — OSRM + carte opérationnelle | ✅ | **Moteur carto** `RoutingService` core (drivers env `ROUTING_DRIVER`/`GEOCODING_DRIVER`, défaut `none`, timeout 3 s best-effort), distances/durées auto au build de route (`distanceSource MANUAL\|OSRM\|HAVERSINE`, manuel jamais écrasé, géométrie GeoJSON stockée même en manuel), **fallback haversine** badgé « estimate » dans l'UI ; **géocodage Nominatim** (cache BD `geocode_cache` global, 1 req/s in-process, UA custom) au create/update de location ; **positions chauffeur** (`POST /public/driver/:token/position` borné + dédoublonné 60 s, pings page chauffeur : immédiat + visibilitychange + 2 min) ; **carte live dashboard** (`GET /loads/active-map` sans géométrie, isLate réutilisé, OpsMap polling 45 s, retards rouges) ; **suivi public avec carte** (lastPosition + coords o/d, jamais d'historique) ; docker profil `osrm` opt-in ; 17ᵉ migration |
```

Et remplacer la section « Prochaine session » : phase 10 livrée → pointer la phase 11
(différenciateurs IA, §19.2 agent + §19.1 ingestion + §19.4 factures) comme prochain
chantier décidé.

- [ ] **Step 3 : vérification finale complète**

```bash
pnpm typecheck
pnpm build
pnpm --filter @pulsar/api test
pnpm test          # unit shared
pnpm test:e2e      # DB seedée requise — TOUTES les suites (anciennes + phase10-map)
```

Expected : tout vert. En cas d'échec d'une suite ancienne → STOP, diagnostiquer
(probable régression routes/locations), ne pas committer.

- [ ] **Step 4 : vérification manuelle (Sam ou session)**

`pnpm dev` puis :
1. Créer une location sans coordonnées avec `GEOCODING_DRIVER=none` → reste sans coords, rien ne casse.
2. Build de route entre 2 locations à coordonnées → distance HAVERSINE + badge « estimate » sur le détail load.
3. Dispatcher le load, ouvrir `/driver/<token>` sur le téléphone (ou devtools mobile), accepter la géoloc → marqueur vert sur LoadMap, load visible sur la carte dashboard.
4. Ouvrir `/track/<trackingToken>` → mini-carte avec origine/destination/dernière position.
5. (Optionnel, avec OSRM préparé) refaire 2 → distance OSRM + tracé routier réel.

- [ ] **Step 5 : commit + push**

```bash
git add docs CLAUDE.md
git commit -m "docs: phase 10 shipped (OSRM routing, geocoding, live ops map, public map)"
git push -u origin phase-10
```

---

## Self-review du plan (fait à l'écriture)

- **Couverture spec** : §A moteur/drivers (T2-T5), distances auto + MANUAL + haversine + badge (T7, T14), géocodage + cache + throttle + UA (T4-T6), migration sans réseau (T1) ; §B position endpoint borné/dédoublonné/module re-check (T8), pings page chauffeur immédiat+visible+2 min (T11), payload public minimal + carte (T9, T13) ; §C active-map sans géométrie + isLate réutilisé (T10), OpsMap 45 s onglet visible (T12), L.geoJSON + bornes e2e (T14, T15) ; §D drivers none en CI (toutes les suites), docker profil + doc (T15), e2e conditionnelle (T15).
- **Cohérence de types** : `LatLng {lat,lng}` partout ; `DistanceSource` string enum miroir ; `lastPosition {latitude, longitude, occurredAt}` identique dans position/tracking/active-map/web ; `RoutingService.route(points)/geocode(address)` unique signature.
- **Pièges signalés dans les tâches** : ordre de déclaration `active-map` avant `:id` (T10) ; jamais de coords GeoJSON brutes dans `L.polyline` (T14) ; rebuilds shared/database après schema (T1) ; e2e anciens = filet de non-régression (T7, T16).
