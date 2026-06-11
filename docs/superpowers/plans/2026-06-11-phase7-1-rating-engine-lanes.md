# Phase 7.1 — Rating engine v2 + entité Lane : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter la spec [2026-06-11-rating-engine-v2-lanes-design.md](../specs/2026-06-11-rating-engine-v2-lanes-design.md) : entité Lane hiérarchique, tarifs rattachés aux lanes (tranches, accessorials, carburant daté), snapshot de calcul figé sur le load, rate shopping.

**Architecture:** L'arithmétique pure (tranches + as-if, accessorials, carburant, min charge) vit dans `packages/shared` (vitest). La résolution (lane matching par clés normalisées, date de référence, validité, entrée carburant) vit dans un `RatingService` API. `LoadCostService.recompute()` persiste `estimatedCost` + snapshot `costDetail` et refuse les loads COMPLETED. L'auto-tender bascule sur « la lane la plus spécifique qui a des préférences ».

**Tech stack:** NestJS + Prisma (PostgreSQL), SvelteKit SPA (Svelte 5 runes), vitest (shared), jest (API unit + e2e supertest).

**Conventions à respecter (CLAUDE.md):** tenantId du JWT partout, `OwnershipService.assertOwned(IfSet)` sur toute FK écrite, `@RequireModule` + `@RequirePermissions` sur tout endpoint, `@Audit` sur les mutations master-data, rebuild `packages/shared` et `packages/database` après modification (l'API consomme leur `dist/`).

**Précisions vs spec (décisions de plan):**
- La hiérarchie géo utilise le champ existant `Location.state` → le niveau s'appelle **STATE** (et non PROVINCE) : `LOCATION | CITY | STATE | COUNTRY`.
- Les permissions lanes restent `transportation.master-data.*` (les clés `transportation.lanes.*` de la spec n'existent pas ; on suit l'existant). Nouvelles clés uniquement pour accessorials et fuel-tables.
- `calculateRateCost` évolue de façon **additive** (champs optionnels en entrée, champs supplémentaires en sortie) pour que `LoadCostService` continue de compiler entre les tâches 3 et 8.
- `PATCH /lanes/:id` ne modifie que `name` : changer une extrémité = supprimer/recréer (les clés normalisées et l'unicité rendent l'update partiel piégeux — YAGNI).

---

## Carte des fichiers

| Fichier | Rôle |
| ------- | ---- |
| `packages/shared/src/enums/transportation.ts` | + `LaneEndpointType`, `AccessorialUnit` |
| `packages/shared/src/permissions.ts` | + 4 clés accessorials / fuel-tables |
| `packages/shared/src/rating/lane-key.ts` (nouveau) | Normalisation (NFD), clés d'extrémité, spécificité, ordre total `compareLanes` |
| `packages/shared/src/rating/__tests__/lane-key.spec.ts` (nouveau) | Tests vitest |
| `packages/shared/src/cost/rate-cost.ts` | v2 : tranches + as-if, accessorials, lignes, `pickFuelEntry` |
| `packages/shared/src/cost/__tests__/rate-cost.spec.ts` | Réécrit (couvre v1 + v2) |
| `packages/shared/src/index.ts` | + export `rating/lane-key` |
| `packages/database/prisma/schema.prisma` | + Lane, RateBreak, Accessorial, RateAccessorialPrice, LoadAccessorial, FuelSurchargeTable/Entry ; Rate.laneId/fuelTableId ; Load.costDetail ; refonte LaneCarrierPreference |
| `packages/database/prisma/migrations/<ts>_phase7_rating_engine_lanes/migration.sql` | DDL + **migration de données** (paires → lanes LOCATION) |
| `packages/database/prisma/seed.ts` | + accessorials, table carburant, lanes, tarif complet |
| `apps/api/src/prisma/ownership.service.ts` | + `lane`, `accessorial`, `fuelSurchargeTable` |
| `apps/api/src/modules/transportation/lanes/*` | Refonte : CRUD lanes + sous-ressource carriers + matching |
| `apps/api/src/modules/transportation/lanes/dto/lane.dto.ts` (nouveau) | DTOs |
| `apps/api/src/modules/transportation/rating/load-endpoints.ts` (nouveau) | Origine/destination physiques d'un load |
| `apps/api/src/modules/transportation/rating/rating.service.ts` (nouveau) | Date de référence, validité, carburant, évaluation, rate-options, snapshot |
| `apps/api/src/modules/transportation/rating/rating.service.spec.ts` (nouveau) | Jest unitaires (date de référence, validité) |
| `apps/api/src/modules/transportation/accessorials/*` (nouveau) | CRUD catalogue |
| `apps/api/src/modules/transportation/fuel-tables/*` (nouveau) | CRUD tables carburant |
| `apps/api/src/modules/transportation/rates/dto/rate.dto.ts` | + laneId, fuelTableId, breaks[], accessorialPrices[] |
| `apps/api/src/modules/transportation/rates/rates.service.ts` | Nested writes + validations |
| `apps/api/src/modules/transportation/loads/load-cost.service.ts` | v2 : snapshot + invariant COMPLETED |
| `apps/api/src/modules/transportation/loads/loads.service.ts` + `loads.controller.ts` | `PUT :id/accessorials`, `GET :id/rate-options` |
| `apps/api/src/modules/transportation/tenders/tenders.service.ts` | Auto-tender via lane la plus spécifique |
| `apps/api/src/modules/transportation/transportation.module.ts` | Enregistrement des nouveaux providers/controllers |
| `apps/api/test/phase7-rating.e2e-spec.ts` (nouveau) | Suite e2e du chantier |
| `apps/web/src/routes/(app)/rates/+page.svelte` (nouveau) | Page Rates |
| `apps/web/src/routes/(app)/lanes/+page.svelte` | Refonte |
| `apps/web/src/routes/(app)/accessorials/+page.svelte` (nouveau) | Catalogue accessorials |
| `apps/web/src/routes/(app)/fuel-tables/+page.svelte` (nouveau) | Tables carburant |
| `apps/web/src/routes/(app)/loads/[id]/+page.svelte` | Accessorials + Comparer les tarifs + snapshot |
| `apps/web/src/routes/(app)/+layout.svelte` | Navigation |

**Gate de typecheck :** entre la fin de la tâche 4 (schéma) et la fin de la tâche 5 (refonte lanes), `pnpm typecheck` est **attendu rouge** (l'ancien `LanesService` référence des colonnes supprimées). On committe quand même la tâche 4 (migration isolée) ; le typecheck redevient vert à la fin de la tâche 5. Partout ailleurs, chaque commit doit être vert.

---

### Task 1 : Enums partagés + permissions

**Files:**
- Modify: `packages/shared/src/enums/transportation.ts`
- Modify: `packages/shared/src/permissions.ts`

- [ ] **Step 1 : Ajouter les enums**

À la fin de `packages/shared/src/enums/transportation.ts` :

```ts
/** Geographic level of a lane endpoint, most → least specific. Mirrored in schema.prisma. */
export enum LaneEndpointType {
  LOCATION = 'LOCATION',
  CITY = 'CITY',
  STATE = 'STATE',
  COUNTRY = 'COUNTRY',
}

/** Pricing unit of an accessorial charge. Mirrored in schema.prisma. */
export enum AccessorialUnit {
  FLAT = 'FLAT',
  PER_HOUR = 'PER_HOUR',
  PER_UNIT = 'PER_UNIT',
}
```

- [ ] **Step 2 : Ajouter les permissions**

Dans `packages/shared/src/permissions.ts`, bloc `TRANSPORTATION` (après `RATES_MANAGE`) :

```ts
    ACCESSORIALS_READ: 'transportation.accessorials.read',
    ACCESSORIALS_MANAGE: 'transportation.accessorials.manage',
    FUEL_TABLES_READ: 'transportation.fuel-tables.read',
    FUEL_TABLES_MANAGE: 'transportation.fuel-tables.manage',
```

Dans `PERMISSION_CATALOG` (après la ligne `RATES_MANAGE`) :

```ts
  tms(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_READ, 'View accessorial catalog'),
  tms(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_MANAGE, 'Manage accessorial catalog'),
  tms(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_READ, 'View fuel surcharge tables'),
  tms(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_MANAGE, 'Manage fuel surcharge tables'),
```

- [ ] **Step 3 : Build + typecheck**

Run: `pnpm --filter @pulsar/shared build` puis `pnpm typecheck`
Expected: PASS (changement purement additif).

- [ ] **Step 4 : Commit**

```bash
git add packages/shared/src/enums/transportation.ts packages/shared/src/permissions.ts
git commit -m "feat(shared): LaneEndpointType + AccessorialUnit enums, accessorial/fuel-table permissions"
```

---

### Task 2 : Clés de lane normalisées + ordre de spécificité (shared, TDD)

**Files:**
- Create: `packages/shared/src/rating/lane-key.ts`
- Create: `packages/shared/src/rating/__tests__/lane-key.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1 : Écrire les tests (échec attendu)**

`packages/shared/src/rating/__tests__/lane-key.spec.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { LaneEndpointType } from '../../enums/transportation';
import {
  buildEndpointKey,
  candidateEndpointKeys,
  compareLanes,
  normalizeGeo,
} from '../lane-key';

describe('normalizeGeo', () => {
  it('strips diacritics, case and whitespace — Québec market requirement', () => {
    expect(normalizeGeo('Montréal')).toBe('montreal');
    expect(normalizeGeo('  MONTREAL ')).toBe('montreal');
    expect(normalizeGeo('Trois-Rivières')).toBe('trois-rivieres');
  });
});

describe('buildEndpointKey', () => {
  it('builds keys per level', () => {
    expect(buildEndpointKey(LaneEndpointType.LOCATION, { locationId: 'loc1' })).toBe('LOCATION:loc1');
    expect(
      buildEndpointKey(LaneEndpointType.CITY, { city: 'Montréal', state: 'QC', country: 'CA' }),
    ).toBe('CITY:ca|qc|montreal');
    expect(buildEndpointKey(LaneEndpointType.STATE, { state: 'QC', country: 'CA' })).toBe('STATE:ca|qc');
    expect(buildEndpointKey(LaneEndpointType.COUNTRY, { country: 'CA' })).toBe('COUNTRY:ca');
  });

  it('throws on missing required fields', () => {
    expect(() => buildEndpointKey(LaneEndpointType.CITY, { city: 'Montréal' })).toThrow();
    expect(() => buildEndpointKey(LaneEndpointType.LOCATION, {})).toThrow();
  });
});

describe('candidateEndpointKeys', () => {
  it('returns all matchable keys, most specific first', () => {
    expect(
      candidateEndpointKeys({ id: 'loc1', city: 'Montréal', state: 'QC', country: 'CA' }),
    ).toEqual(['LOCATION:loc1', 'CITY:ca|qc|montreal', 'STATE:ca|qc', 'COUNTRY:ca']);
  });

  it('skips CITY and STATE levels when the location has no state', () => {
    expect(candidateEndpointKeys({ id: 'loc1', city: 'Montréal', state: null, country: 'CA' })).toEqual([
      'LOCATION:loc1',
      'COUNTRY:ca',
    ]);
  });
});

describe('compareLanes — deterministic total ordering', () => {
  const lane = (
    originType: LaneEndpointType,
    destinationType: LaneEndpointType,
    createdAt = new Date('2026-01-01'),
  ) => ({ originType, destinationType, createdAt });

  it('higher total specificity wins', () => {
    const a = lane(LaneEndpointType.LOCATION, LaneEndpointType.LOCATION); // 6
    const b = lane(LaneEndpointType.CITY, LaneEndpointType.CITY); // 4
    expect([b, a].sort(compareLanes)[0]).toBe(a);
  });

  it('tie on total → destination specificity wins (3+2 vs 2+3 ⇒ LOCATION destination first)', () => {
    const locToCity = lane(LaneEndpointType.LOCATION, LaneEndpointType.CITY); // 3+2
    const cityToLoc = lane(LaneEndpointType.CITY, LaneEndpointType.LOCATION); // 2+3
    expect([locToCity, cityToLoc].sort(compareLanes)[0]).toBe(cityToLoc);
  });

  it('full tie → newest lane wins (deterministic safety net)', () => {
    const old = lane(LaneEndpointType.CITY, LaneEndpointType.CITY, new Date('2026-01-01'));
    const recent = lane(LaneEndpointType.CITY, LaneEndpointType.CITY, new Date('2026-02-01'));
    expect([old, recent].sort(compareLanes)[0]).toBe(recent);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @pulsar/shared test`
Expected: FAIL — `Cannot find module '../lane-key'`.

- [ ] **Step 3 : Implémenter**

`packages/shared/src/rating/lane-key.ts` :

```ts
import { LaneEndpointType } from '../enums/transportation';

export interface LaneEndpointInput {
  locationId?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

/** Trim, lowercase, strip diacritics (NFD) — « Montréal », "MONTREAL " share one key. */
export function normalizeGeo(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Literal union ('LOCATION' | 'CITY' | …) so both the shared enum and the Prisma enum
 * ($Enums.LaneEndpointType) are accepted without casts.
 */
export type LaneEndpointTypeLike = `${LaneEndpointType}`;

export const ENDPOINT_SPECIFICITY: Record<LaneEndpointTypeLike, number> = {
  [LaneEndpointType.LOCATION]: 3,
  [LaneEndpointType.CITY]: 2,
  [LaneEndpointType.STATE]: 1,
  [LaneEndpointType.COUNTRY]: 0,
};

export function buildEndpointKey(type: LaneEndpointType, input: LaneEndpointInput): string {
  switch (type) {
    case LaneEndpointType.LOCATION:
      if (!input.locationId) throw new Error('A LOCATION endpoint requires locationId');
      return `LOCATION:${input.locationId}`;
    case LaneEndpointType.CITY:
      if (!input.city || !input.state || !input.country)
        throw new Error('A CITY endpoint requires city, state and country');
      return `CITY:${normalizeGeo(input.country)}|${normalizeGeo(input.state)}|${normalizeGeo(input.city)}`;
    case LaneEndpointType.STATE:
      if (!input.state || !input.country) throw new Error('A STATE endpoint requires state and country');
      return `STATE:${normalizeGeo(input.country)}|${normalizeGeo(input.state)}`;
    case LaneEndpointType.COUNTRY:
      if (!input.country) throw new Error('A COUNTRY endpoint requires country');
      return `COUNTRY:${normalizeGeo(input.country)}`;
  }
}

export interface PhysicalLocation {
  id: string;
  city: string;
  state?: string | null;
  country: string;
}

/** Every key a physical location can match, most specific first. Levels missing data are skipped. */
export function candidateEndpointKeys(location: PhysicalLocation): string[] {
  const keys = [buildEndpointKey(LaneEndpointType.LOCATION, { locationId: location.id })];
  if (location.state) {
    keys.push(
      buildEndpointKey(LaneEndpointType.CITY, location),
      buildEndpointKey(LaneEndpointType.STATE, location),
    );
  }
  keys.push(buildEndpointKey(LaneEndpointType.COUNTRY, location));
  return keys;
}

export interface LaneForOrdering {
  originType: LaneEndpointTypeLike;
  destinationType: LaneEndpointTypeLike;
  createdAt: Date;
}

/**
 * Deterministic lane ordering, most preferred first:
 * total specificity desc → destination desc → origin desc → newest first.
 * The rating engine AND auto-tendering both use this — never reimplement it.
 */
export function compareLanes(a: LaneForOrdering, b: LaneForOrdering): number {
  const spec = (l: LaneForOrdering) =>
    ENDPOINT_SPECIFICITY[l.originType] + ENDPOINT_SPECIFICITY[l.destinationType];
  if (spec(a) !== spec(b)) return spec(b) - spec(a);
  const destDiff = ENDPOINT_SPECIFICITY[b.destinationType] - ENDPOINT_SPECIFICITY[a.destinationType];
  if (destDiff !== 0) return destDiff;
  const originDiff = ENDPOINT_SPECIFICITY[b.originType] - ENDPOINT_SPECIFICITY[a.originType];
  if (originDiff !== 0) return originDiff;
  return b.createdAt.getTime() - a.createdAt.getTime();
}
```

Dans `packages/shared/src/index.ts`, ajouter après la ligne `export * from './cost/rate-cost';` :

```ts
export * from './rating/lane-key';
```

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter @pulsar/shared test`
Expected: PASS (tous les tests lane-key + suites existantes).

- [ ] **Step 5 : Build + commit**

```bash
pnpm --filter @pulsar/shared build
git add packages/shared/src/rating packages/shared/src/index.ts
git commit -m "feat(shared): normalized lane endpoint keys + deterministic specificity ordering"
```

---

### Task 3 : Moteur de calcul v2 (shared, TDD, additif)

**Files:**
- Modify: `packages/shared/src/cost/rate-cost.ts`
- Modify: `packages/shared/src/cost/__tests__/rate-cost.spec.ts`

- [ ] **Step 1 : Réécrire la suite de tests (échec attendu)**

Remplacer intégralement `packages/shared/src/cost/__tests__/rate-cost.spec.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { AccessorialUnit, RateType } from '../../enums/transportation';
import { calculateRateCost, pickFuelEntry } from '../rate-cost';

describe('calculateRateCost — v1 behaviours kept', () => {
  it('FLAT: base + fuel surcharge', () => {
    const cost = calculateRateCost({ rateType: RateType.FLAT, baseAmount: 1000, fuelSurchargePct: 12 }, {});
    expect(cost?.base).toBe(1000);
    expect(cost?.fuelSurcharge).toBe(120);
    expect(cost?.total).toBe(1120);
    expect(cost?.lines.map((l) => l.type)).toEqual(['BASE', 'FUEL']);
  });

  it('PER_KM multiplies by distance; null without distance', () => {
    expect(calculateRateCost({ rateType: RateType.PER_KM, baseAmount: 2.5 }, { distanceKm: 250 })?.total).toBe(625);
    expect(calculateRateCost({ rateType: RateType.PER_KM, baseAmount: 2.5 }, {})).toBeNull();
  });

  it('PER_HUNDREDWEIGHT without breaks uses baseAmount per CWT', () => {
    // 4535.9237 kg = exactly 100 CWT
    expect(
      calculateRateCost({ rateType: RateType.PER_HUNDREDWEIGHT, baseAmount: 10 }, { weightKg: 4535.9237 })?.total,
    ).toBe(1000);
  });

  it('PER_PALLET multiplies by pallet count', () => {
    expect(
      calculateRateCost({ rateType: RateType.PER_PALLET, baseAmount: 45, fuelSurchargePct: 10 }, { palletCount: 20 })
        ?.total,
    ).toBe(990);
  });

  it('SPOT behaves like FLAT', () => {
    expect(calculateRateCost({ rateType: RateType.SPOT, baseAmount: 850 }, {})?.total).toBe(850);
  });
});

describe('weight breaks + as-if (deficit weight)', () => {
  const rate = {
    rateType: RateType.PER_HUNDREDWEIGHT,
    baseAmount: 999, // ignored when breaks exist
    breaks: [
      { upToKg: 500, amount: 20 },
      { upToKg: 1000, amount: 15 },
      { upToKg: 5000, amount: 10 },
    ],
  };

  it('picks the bracket containing the weight', () => {
    const cost = calculateRateCost(rate, { weightKg: 900 });
    // 900 kg = 19.8415 CWT × 15
    expect(cost?.total).toBe(297.62);
    expect(cost?.appliedBreak).toEqual({ upToKg: 1000, amount: 15, asIfApplied: false });
  });

  it('weights beyond the last bracket use the last bracket', () => {
    const cost = calculateRateCost(rate, { weightKg: 9000 });
    expect(cost?.appliedBreak).toEqual({ upToKg: 5000, amount: 10, asIfApplied: false });
  });

  it('as-if: 480 kg must not cost more than 500 kg (spec demo case)', () => {
    const at480 = calculateRateCost(rate, { weightKg: 480 });
    const at500 = calculateRateCost(rate, { weightKg: 500 });
    // 480 kg in bracket ≤500 @20 = 211.65 ; as-if 500 kg in bracket ≤1000 @15 = 165.35 → min wins
    expect(at480?.total).toBe(165.35);
    expect(at480?.appliedBreak).toEqual({ upToKg: 1000, amount: 15, asIfApplied: true });
    expect(at480!.total).toBeLessThanOrEqual(at500!.total!);
  });

  it('as-if is not applied when the own bracket is cheaper', () => {
    const cost = calculateRateCost(rate, { weightKg: 100 });
    // 100 kg @20 = 44.09 < as-if 500 kg @15 = 165.35
    expect(cost?.appliedBreak?.asIfApplied).toBe(false);
  });
});

describe('accessorials', () => {
  const rate = {
    rateType: RateType.FLAT,
    baseAmount: 1000,
    accessorialPrices: [
      { code: 'TAILGATE', amount: 75 },
      { code: 'WAIT_HOUR', amount: 60 },
    ],
  };

  it('FLAT unit ignores quantity; PER_HOUR/PER_UNIT multiply', () => {
    const cost = calculateRateCost(rate, {}, [
      { code: 'TAILGATE', unit: AccessorialUnit.FLAT, quantity: 3 },
      { code: 'WAIT_HOUR', unit: AccessorialUnit.PER_HOUR, quantity: 2.5 },
    ]);
    expect(cost?.accessorialsTotal).toBe(225); // 75 + 60×2.5
    expect(cost?.total).toBe(1225);
    expect(cost?.missingAccessorials).toEqual([]);
  });

  it('unpriced requested accessorials are flagged, total still computed', () => {
    const cost = calculateRateCost(rate, {}, [
      { code: 'RESIDENTIAL', unit: AccessorialUnit.FLAT, quantity: 1 },
    ]);
    expect(cost?.total).toBe(1000);
    expect(cost?.missingAccessorials).toEqual(['RESIDENTIAL']);
  });
});

describe('minimum charge', () => {
  it('applies after fuel AND accessorials, as an adjustment line', () => {
    const cost = calculateRateCost(
      {
        rateType: RateType.FLAT,
        baseAmount: 100,
        fuelSurchargePct: 10,
        minCharge: 500,
        accessorialPrices: [{ code: 'TAILGATE', amount: 50 }],
      },
      {},
      [{ code: 'TAILGATE', unit: AccessorialUnit.FLAT, quantity: 1 }],
    );
    // 100 + 10 + 50 = 160 → adjusted to 500
    expect(cost?.total).toBe(500);
    expect(cost?.lines.at(-1)).toEqual({
      type: 'MIN_CHARGE_ADJUSTMENT',
      label: 'Minimum charge adjustment',
      amount: 340,
    });
  });
});

describe('pickFuelEntry', () => {
  const entries = [
    { effectiveFrom: new Date('2026-01-01'), pct: 8 },
    { effectiveFrom: new Date('2026-06-01'), pct: 12 },
  ];

  it('picks the latest entry effective at the reference date', () => {
    expect(pickFuelEntry(entries, new Date('2026-03-15'))?.pct).toBe(8);
    expect(pickFuelEntry(entries, new Date('2026-06-01'))?.pct).toBe(12);
  });

  it('returns null when no entry is effective yet', () => {
    expect(pickFuelEntry(entries, new Date('2025-12-31'))).toBeNull();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @pulsar/shared test`
Expected: FAIL — `pickFuelEntry` inexistant, shapes de retour inconnues.

- [ ] **Step 3 : Implémenter**

Remplacer intégralement `packages/shared/src/cost/rate-cost.ts` :

```ts
import { AccessorialUnit, RateType } from '../enums/transportation';

export interface RateBreakLike {
  /** Bracket upper bound in kg (inclusive). The last bracket also covers heavier weights. */
  upToKg: number;
  /** Amount per CWT inside this bracket. */
  amount: number;
}

export interface AccessorialPriceLike {
  code: string;
  amount: number;
}

export interface RateLike {
  rateType: RateType;
  /** Base amount in the rate's currency (ignored for PER_HUNDREDWEIGHT when breaks exist). */
  baseAmount: number;
  /** Resolved upstream: dated fuel-table entry when the rate has one, static pct otherwise. */
  fuelSurchargePct?: number | null;
  minCharge?: number | null;
  breaks?: RateBreakLike[];
  accessorialPrices?: AccessorialPriceLike[];
}

export interface RequestedAccessorial {
  code: string;
  unit: AccessorialUnit;
  quantity: number;
}

export interface CostMetrics {
  distanceKm?: number | null;
  weightKg?: number | null;
  palletCount?: number | null;
}

export type CostLineType = 'BASE' | 'FUEL' | 'ACCESSORIAL' | 'MIN_CHARGE_ADJUSTMENT';

export interface CostLine {
  type: CostLineType;
  /** Accessorial code, for ACCESSORIAL lines. */
  code?: string;
  label: string;
  amount: number;
}

export interface AppliedBreak {
  upToKg: number;
  amount: number;
  /** True when the deficit-weight ("as-if") rule priced the next bracket cheaper. */
  asIfApplied: boolean;
}

export interface CostBreakdown {
  lines: CostLine[];
  base: number;
  fuelSurcharge: number;
  accessorialsTotal: number;
  total: number;
  appliedBreak: AppliedBreak | null;
  /** Requested accessorial codes the rate does not price — total still computed. */
  missingAccessorials: string[];
}

const KG_PER_CWT = 45.359237; // 1 hundredweight (CWT) = 100 lb

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function cwtOf(weightKg: number): number {
  return weightKg / KG_PER_CWT;
}

/** Bracket selection + deficit-weight ("as-if") rule for PER_HUNDREDWEIGHT rates. */
function weightBase(rate: RateLike, weightKg: number): { base: number; appliedBreak: AppliedBreak | null } {
  const breaks = [...(rate.breaks ?? [])].sort((a, b) => a.upToKg - b.upToKg);
  if (breaks.length === 0) {
    return { base: cwtOf(weightKg) * rate.baseAmount, appliedBreak: null };
  }
  const index = breaks.findIndex((b) => weightKg <= b.upToKg);
  const applied = index === -1 ? breaks.length - 1 : index;
  let base = cwtOf(weightKg) * breaks[applied].amount;
  let appliedBreak: AppliedBreak = { upToKg: breaks[applied].upToKg, amount: breaks[applied].amount, asIfApplied: false };
  if (index !== -1 && applied < breaks.length - 1) {
    // As-if: price as the next bracket's minimum weight (= this bracket's bound) if cheaper.
    const next = breaks[applied + 1];
    const asIf = cwtOf(breaks[applied].upToKg) * next.amount;
    if (asIf < base) {
      base = asIf;
      appliedBreak = { upToKg: next.upToKg, amount: next.amount, asIfApplied: true };
    }
  }
  return { base, appliedBreak };
}

/**
 * Computes the cost of a load for a given rate. Pure arithmetic only — lane matching,
 * date validity and fuel-entry selection are resolved by the caller (RatingService).
 * Returns null when the metric required by the rate type is missing ("cannot estimate yet").
 */
export function calculateRateCost(
  rate: RateLike,
  metrics: CostMetrics,
  accessorials: RequestedAccessorial[] = [],
): CostBreakdown | null {
  let base: number;
  let appliedBreak: AppliedBreak | null = null;
  switch (rate.rateType) {
    case RateType.FLAT:
    case RateType.SPOT:
      base = rate.baseAmount;
      break;
    case RateType.PER_KM:
      if (metrics.distanceKm == null) return null;
      base = rate.baseAmount * metrics.distanceKm;
      break;
    case RateType.PER_HUNDREDWEIGHT: {
      if (metrics.weightKg == null) return null;
      ({ base, appliedBreak } = weightBase(rate, metrics.weightKg));
      break;
    }
    case RateType.PER_PALLET:
      if (metrics.palletCount == null) return null;
      base = rate.baseAmount * metrics.palletCount;
      break;
  }

  const fuelSurcharge = base * ((rate.fuelSurchargePct ?? 0) / 100);

  const prices = new Map((rate.accessorialPrices ?? []).map((p) => [p.code, p.amount]));
  const missingAccessorials: string[] = [];
  const accessorialLines: CostLine[] = [];
  for (const req of accessorials) {
    const price = prices.get(req.code);
    if (price === undefined) {
      missingAccessorials.push(req.code);
      continue;
    }
    const quantity = req.unit === AccessorialUnit.FLAT ? 1 : req.quantity;
    accessorialLines.push({
      type: 'ACCESSORIAL',
      code: req.code,
      label: quantity === 1 ? req.code : `${req.code} × ${quantity}`,
      amount: round2(price * quantity),
    });
  }
  const accessorialsTotal = accessorialLines.reduce((acc, l) => acc + l.amount, 0);

  const lines: CostLine[] = [
    {
      type: 'BASE',
      label: appliedBreak
        ? `Base (bracket ≤ ${appliedBreak.upToKg} kg${appliedBreak.asIfApplied ? ', as-if' : ''})`
        : 'Base',
      amount: round2(base),
    },
  ];
  if (fuelSurcharge > 0) {
    lines.push({ type: 'FUEL', label: `Fuel surcharge ${rate.fuelSurchargePct}%`, amount: round2(fuelSurcharge) });
  }
  lines.push(...accessorialLines);

  let total = base + fuelSurcharge + accessorialsTotal;
  if (rate.minCharge != null && total < rate.minCharge) {
    lines.push({
      type: 'MIN_CHARGE_ADJUSTMENT',
      label: 'Minimum charge adjustment',
      amount: round2(rate.minCharge - total),
    });
    total = rate.minCharge;
  }

  return {
    lines,
    base: round2(base),
    fuelSurcharge: round2(fuelSurcharge),
    accessorialsTotal: round2(accessorialsTotal),
    total: round2(total),
    appliedBreak,
    missingAccessorials,
  };
}

/** Fuel-table entry in force at the reference date: latest effectiveFrom ≤ date, else null. */
export function pickFuelEntry<T extends { effectiveFrom: Date; pct: number }>(
  entries: T[],
  referenceDate: Date,
): T | null {
  return (
    [...entries]
      .filter((e) => e.effectiveFrom.getTime() <= referenceDate.getTime())
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
  );
}
```

- [ ] **Step 4 : Vérifier le succès + non-régression**

Run: `pnpm --filter @pulsar/shared test` puis `pnpm --filter @pulsar/shared build` puis `pnpm typecheck`
Expected: PASS partout — `LoadCostService` compile toujours (`cost.total` existe encore ; les nouveaux champs de `RateLike` sont optionnels).

- [ ] **Step 5 : Commit**

```bash
git add packages/shared/src/cost
git commit -m "feat(shared): rate cost v2 — weight breaks with as-if rule, accessorials, cost lines, dated fuel entry picker"
```

---

### Task 4 : Schéma Prisma + migration (avec migration de données)

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_phase7_rating_engine_lanes/migration.sql`
- Modify: `apps/api/src/prisma/ownership.service.ts`

> ⚠️ À la fin de cette tâche, `pnpm typecheck` est **rouge** (l'ancien `LanesService` référence
> `originLocationId` sur `LaneCarrierPreference`). C'est attendu ; la tâche 5 le répare.
> Le package database, lui, doit builder.

- [ ] **Step 1 : Éditer le schéma — enums + nouvelles tables**

Dans `packages/database/prisma/schema.prisma`, ajouter avant `model LaneCarrierPreference` :

```prisma
// Geographic level of a lane endpoint, most → least specific (mirror of @pulsar/shared).
enum LaneEndpointType {
  LOCATION
  CITY
  STATE
  COUNTRY
}

// First-class lane: each endpoint is one level of the geo hierarchy site < city < state < country.
// originKey/destinationKey are normalized matching keys (see packages/shared rating/lane-key.ts);
// the unique below makes strictly identical lanes impossible.
model Lane {
  id                    String           @id @default(cuid())
  tenantId              String
  name                  String?
  originType            LaneEndpointType
  originLocationId      String?
  originCity            String?
  originState           String?
  originCountry         String?
  destinationType       LaneEndpointType
  destinationLocationId String?
  destinationCity       String?
  destinationState      String?
  destinationCountry    String?
  originKey             String
  destinationKey        String
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt

  tenant              Tenant                  @relation(fields: [tenantId], references: [id])
  originLocation      Location?               @relation("LaneOrigin", fields: [originLocationId], references: [id])
  destinationLocation Location?               @relation("LaneDestination", fields: [destinationLocationId], references: [id])
  rates               Rate[]
  carrierPreferences  LaneCarrierPreference[]

  @@unique([tenantId, originKey, destinationKey])
  @@index([tenantId])
  @@map("lanes")
}
```

Remplacer le `model LaneCarrierPreference` existant par :

```prisma
model LaneCarrierPreference {
  id        String @id @default(cuid())
  tenantId  String
  laneId    String
  carrierId String
  rank      Int

  tenant  Tenant  @relation(fields: [tenantId], references: [id])
  lane    Lane    @relation(fields: [laneId], references: [id], onDelete: Restrict)
  carrier Carrier @relation(fields: [carrierId], references: [id])

  @@unique([tenantId, laneId, rank], map: "lane_prefs_lane_rank_key")
  @@unique([tenantId, laneId, carrierId], map: "lane_prefs_lane_carrier_key")
  @@map("lane_carrier_preferences")
}
```

Ajouter après le `model Rate` (qu'on modifie au step 2) :

```prisma
// Degressive weight bracket of a PER_HUNDREDWEIGHT rate (amount per CWT up to upToKg).
model RateBreak {
  id     String  @id @default(cuid())
  rateId String
  upToKg Float
  amount Decimal @db.Decimal(12, 2)

  rate Rate @relation(fields: [rateId], references: [id], onDelete: Cascade)

  @@unique([rateId, upToKg])
  @@map("rate_breaks")
}

// Pricing unit of an accessorial charge (mirror of @pulsar/shared).
enum AccessorialUnit {
  FLAT
  PER_HOUR
  PER_UNIT
}

// Tenant accessorial catalog (tailgate, wait time, residential…).
model Accessorial {
  id        String          @id @default(cuid())
  tenantId  String
  code      String
  name      String
  unit      AccessorialUnit @default(FLAT)
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  tenant           Tenant                 @relation(fields: [tenantId], references: [id])
  ratePrices       RateAccessorialPrice[]
  loadAccessorials LoadAccessorial[]

  @@unique([tenantId, code])
  @@map("accessorials")
}

// Price of one accessorial under one rate — lets rate shopping compare carriers like for like.
model RateAccessorialPrice {
  id            String  @id @default(cuid())
  rateId        String
  accessorialId String
  amount        Decimal @db.Decimal(12, 2)

  rate        Rate        @relation(fields: [rateId], references: [id], onDelete: Cascade)
  accessorial Accessorial @relation(fields: [accessorialId], references: [id], onDelete: Restrict)

  @@unique([rateId, accessorialId])
  @@map("rate_accessorial_prices")
}

// Accessorials the planner flagged on a load (quantity forced to 1 for FLAT units).
model LoadAccessorial {
  id            String @id @default(cuid())
  loadId        String
  accessorialId String
  quantity      Float  @default(1)

  load        Load        @relation(fields: [loadId], references: [id], onDelete: Cascade)
  accessorial Accessorial @relation(fields: [accessorialId], references: [id], onDelete: Restrict)

  @@unique([loadId, accessorialId])
  @@map("load_accessorials")
}

// Dated fuel surcharge table; the entry in force at the load's reference date applies.
model FuelSurchargeTable {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenant  Tenant               @relation(fields: [tenantId], references: [id])
  entries FuelSurchargeEntry[]
  rates   Rate[]

  @@index([tenantId])
  @@map("fuel_surcharge_tables")
}

model FuelSurchargeEntry {
  id            String   @id @default(cuid())
  tableId       String
  effectiveFrom DateTime
  pct           Float

  table FuelSurchargeTable @relation(fields: [tableId], references: [id], onDelete: Cascade)

  @@unique([tableId, effectiveFrom])
  @@map("fuel_surcharge_entries")
}
```

- [ ] **Step 2 : Éditer le schéma — Rate, Load, Location, Tenant**

Dans `model Rate`, ajouter après `customerId String?` :

```prisma
  laneId           String?
  fuelTableId      String?
```

et dans le bloc relations de `Rate` :

```prisma
  lane              Lane?                  @relation(fields: [laneId], references: [id], onDelete: Restrict)
  fuelTable         FuelSurchargeTable?    @relation(fields: [fuelTableId], references: [id], onDelete: Restrict)
  breaks            RateBreak[]
  accessorialPrices RateAccessorialPrice[]
```

et ajouter l'index `@@index([tenantId, laneId])` sous le `@@index([tenantId])` existant.

Dans `model Load`, après `costCurrency String?` :

```prisma
  // Frozen calculation snapshot (rate as used + inputs + lines). See spec invariants:
  // a COMPLETED load is never recomputed; reconciliation reads this, never recomputes.
  costDetail    Json?
```

et dans le bloc relations de `Load` : `accessorials LoadAccessorial[]`.

Dans `model Location`, remplacer les deux relations lane :

```prisma
  laneOrigins          Lane[] @relation("LaneOrigin")
  laneDestinations     Lane[] @relation("LaneDestination")
```

Dans `model Tenant`, ajouter aux relations (à côté de `laneCarrierPreferences` existant) :

```prisma
  lanes               Lane[]
  accessorials        Accessorial[]
  fuelSurchargeTables FuelSurchargeTable[]
```

(Si le nom exact de la relation existante diffère, suivre le style du bloc — Prisma exige
la relation inverse pour chaque FK ajoutée ; `prisma validate` au step 3 confirme.)

- [ ] **Step 3 : Valider le schéma**

Run: `pnpm --filter @pulsar/database exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4 : Générer la migration SANS l'appliquer**

Run: `pnpm --filter @pulsar/database exec dotenv -e ../../.env -- prisma migrate dev --create-only --name phase7_rating_engine_lanes`
Expected: un dossier `packages/database/prisma/migrations/<ts>_phase7_rating_engine_lanes/` avec `migration.sql` (et un avertissement de drop sur les colonnes de `lane_carrier_preferences` — c'est ce qu'on va corriger).

- [ ] **Step 5 : Insérer la migration de données dans le SQL généré**

Dans le `migration.sql` généré, le bloc qui touche `lane_carrier_preferences` ressemble à :

```sql
ALTER TABLE "lane_carrier_preferences" DROP CONSTRAINT ...;
ALTER TABLE "lane_carrier_preferences" DROP COLUMN "originLocationId",
DROP COLUMN "destinationLocationId",
ADD COLUMN "laneId" TEXT NOT NULL;
```

Le **remplacer** par (en gardant les `CREATE TABLE "lanes"` etc. AVANT ce bloc) :

```sql
-- Data migration: each existing (origin, destination) preference pair becomes a
-- LOCATION→LOCATION lane (max specificity → auto-tender behaviour preserved identically).
-- Deterministic ids via md5 so reruns against a restored dump stay idempotent.
INSERT INTO "lanes" ("id", "tenantId", "originType", "originLocationId", "destinationType",
                     "destinationLocationId", "originKey", "destinationKey", "createdAt", "updatedAt")
SELECT 'lane_' || md5(p."tenantId" || ':' || p."originLocationId" || ':' || p."destinationLocationId"),
       p."tenantId", 'LOCATION', p."originLocationId", 'LOCATION', p."destinationLocationId",
       'LOCATION:' || p."originLocationId", 'LOCATION:' || p."destinationLocationId", now(), now()
FROM (SELECT DISTINCT "tenantId", "originLocationId", "destinationLocationId"
      FROM "lane_carrier_preferences") p;

-- Attach preferences to their lane, then drop the old endpoint columns.
ALTER TABLE "lane_carrier_preferences" ADD COLUMN "laneId" TEXT;

UPDATE "lane_carrier_preferences" lcp
SET "laneId" = l."id"
FROM "lanes" l
WHERE l."tenantId" = lcp."tenantId"
  AND l."originLocationId" = lcp."originLocationId"
  AND l."destinationLocationId" = lcp."destinationLocationId";

ALTER TABLE "lane_carrier_preferences" ALTER COLUMN "laneId" SET NOT NULL;

ALTER TABLE "lane_carrier_preferences"
  DROP CONSTRAINT IF EXISTS "lane_carrier_preferences_originLocationId_fkey",
  DROP CONSTRAINT IF EXISTS "lane_carrier_preferences_destinationLocationId_fkey";
ALTER TABLE "lane_carrier_preferences"
  DROP COLUMN "originLocationId",
  DROP COLUMN "destinationLocationId";
```

Conserver telles quelles les lignes générées qui (a) droppent les anciens index uniques
`lane_prefs_*`, (b) créent les nouveaux (`tenantId, laneId, rank` / `tenantId, laneId, carrierId`),
(c) ajoutent la FK `lane_carrier_preferences_laneId_fkey` — en vérifiant qu'elles apparaissent
**après** le bloc ci-dessus. Vérifier aussi que la FK `laneId` est `ON DELETE RESTRICT`.

- [ ] **Step 6 : Appliquer la migration + régénérer le client**

Run: `pnpm --filter @pulsar/database exec dotenv -e ../../.env -- prisma migrate dev`
Expected: `Your database is now in sync with your schema.` (la migration s'applique sans erreur sur la base seedée).
Run ensuite: `pnpm --filter @pulsar/database build`
Expected: PASS.

- [ ] **Step 7 : Étendre OwnershipService**

Dans `apps/api/src/prisma/ownership.service.ts`, étendre le type `OwnedEntity` :

```ts
export type OwnedEntity =
  | 'customer'
  | 'location'
  | 'carrier'
  | 'driver'
  | 'vehicle'
  | 'trailer'
  | 'rate'
  | 'lane'
  | 'accessorial'
  | 'fuelSurchargeTable'
  | 'transportOrder'
  | 'shipment'
  | 'load'
  | 'stop'
  | 'role'
  | 'user';
```

- [ ] **Step 8 : Commit (typecheck rouge attendu, voir gate)**

```bash
git add packages/database/prisma apps/api/src/prisma/ownership.service.ts
git commit -m "feat(db): Lane entity + rating tables (breaks, accessorials, fuel tables), Load.costDetail — with data migration of lane preferences"
```

---

### Task 5 : Refonte Lanes — CRUD, matching, auto-tender

**Files:**
- Create: `apps/api/src/modules/transportation/lanes/dto/lane.dto.ts`
- Create: `apps/api/src/modules/transportation/rating/load-endpoints.ts`
- Rewrite: `apps/api/src/modules/transportation/lanes/lanes.service.ts`
- Rewrite: `apps/api/src/modules/transportation/lanes/lanes.controller.ts`
- Modify: `apps/api/src/modules/transportation/tenders/tenders.service.ts`

- [ ] **Step 1 : DTOs**

`apps/api/src/modules/transportation/lanes/dto/lane.dto.ts` :

```ts
import { Type } from 'class-transformer';
import { LaneEndpointType } from '@pulsar/shared';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class LaneEndpointDto {
  /** Required when the endpoint type is LOCATION. */
  @IsOptional()
  @IsString()
  locationId?: string;

  /** Required for CITY (with state + country). */
  @IsOptional()
  @IsString()
  city?: string;

  /** Required for CITY and STATE (with country). */
  @IsOptional()
  @IsString()
  state?: string;

  /** Required for CITY, STATE and COUNTRY. */
  @IsOptional()
  @IsString()
  country?: string;
}

export class CreateLaneDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsEnum(LaneEndpointType)
  originType!: LaneEndpointType;

  @ValidateNested()
  @Type(() => LaneEndpointDto)
  origin!: LaneEndpointDto;

  @IsEnum(LaneEndpointType)
  destinationType!: LaneEndpointType;

  @ValidateNested()
  @Type(() => LaneEndpointDto)
  destination!: LaneEndpointDto;
}

/** Endpoints are immutable (normalized keys + uniqueness): delete/recreate to change them. */
export class UpdateLaneDto {
  @IsOptional()
  @IsString()
  name?: string;
}

export class SetLaneCarriersDto {
  /** Ordered by preference — first carrier is tendered first. */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  carrierIds!: string[];
}
```

- [ ] **Step 2 : Résolution des extrémités physiques d'un load**

`apps/api/src/modules/transportation/rating/load-endpoints.ts` :

```ts
import { StopType } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';

export interface PhysicalEndpoint {
  id: string;
  city: string;
  state: string | null;
  country: string;
}

export interface LoadEndpoints {
  origin: PhysicalEndpoint;
  destination: PhysicalEndpoint;
}

const endpointSelect = { id: true, city: true, state: true, country: true } as const;

/**
 * Physical origin/destination of a load: first pickup / last delivery via the route's
 * stops when a route exists, else the shipments' shared O/D. Returns null when
 * indeterminable (multi-origin without a route) — only catch-all rates apply then.
 */
export async function resolveLoadEndpoints(
  prisma: PrismaService,
  tenantId: string,
  loadId: string,
): Promise<LoadEndpoints | null> {
  const load = await prisma.load.findFirst({
    where: { id: loadId, tenantId },
    select: {
      route: {
        select: {
          stops: {
            orderBy: { sequence: 'asc' },
            select: { type: true, location: { select: endpointSelect } },
          },
        },
      },
      shipments: {
        select: {
          originLocationId: true,
          destinationLocationId: true,
          originLocation: { select: endpointSelect },
          destinationLocation: { select: endpointSelect },
        },
      },
    },
  });
  if (!load) return null;

  const stops = load.route?.stops ?? [];
  const pickups = stops.filter((s) => s.type === StopType.PICKUP);
  const deliveries = stops.filter((s) => s.type === StopType.DELIVERY);
  if (pickups.length > 0 && deliveries.length > 0) {
    return { origin: pickups[0].location, destination: deliveries[deliveries.length - 1].location };
  }

  if (load.shipments.length === 0) return null;
  const origins = new Set(load.shipments.map((s) => s.originLocationId));
  const destinations = new Set(load.shipments.map((s) => s.destinationLocationId));
  if (origins.size === 1 && destinations.size === 1) {
    return {
      origin: load.shipments[0].originLocation,
      destination: load.shipments[0].destinationLocation,
    };
  }
  return null;
}
```

- [ ] **Step 3 : Réécrire LanesService**

Remplacer intégralement `apps/api/src/modules/transportation/lanes/lanes.service.ts` :

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LaneEndpointType, buildEndpointKey, compareLanes, candidateEndpointKeys } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveLoadEndpoints } from '../rating/load-endpoints';
import { CreateLaneDto, LaneEndpointDto, UpdateLaneDto } from './dto/lane.dto';

const laneInclude = {
  originLocation: { select: { id: true, code: true, name: true, city: true } },
  destinationLocation: { select: { id: true, code: true, name: true, city: true } },
  carrierPreferences: {
    orderBy: { rank: 'asc' as const },
    include: { carrier: { select: { id: true, code: true, name: true, email: true } } },
  },
} satisfies Prisma.LaneInclude;

interface EndpointColumns {
  locationId: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  key: string;
}

@Injectable()
export class LanesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  /** Validates one endpoint per its level and produces the column values + normalized key. */
  private async buildEndpoint(
    tenantId: string,
    type: LaneEndpointType,
    input: LaneEndpointDto,
  ): Promise<EndpointColumns> {
    if (type === LaneEndpointType.LOCATION) {
      if (!input.locationId) {
        throw new BadRequestException('locationId is required for a LOCATION endpoint');
      }
      await this.ownership.assertOwned('location', input.locationId, tenantId);
    }
    let key: string;
    try {
      key = buildEndpointKey(type, input);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const isCity = type === LaneEndpointType.CITY;
    const hasState = isCity || type === LaneEndpointType.STATE;
    return {
      locationId: type === LaneEndpointType.LOCATION ? input.locationId! : null,
      city: isCity ? input.city! : null,
      state: hasState ? input.state! : null,
      country: type === LaneEndpointType.LOCATION ? null : input.country!,
      key,
    };
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.LaneWhereInput = {
      tenantId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lane.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: laneInclude,
      }),
      this.prisma.lane.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const lane = await this.prisma.lane.findFirst({ where: { id, tenantId }, include: laneInclude });
    if (!lane) throw new NotFoundException('Lane not found');
    return lane;
  }

  async create(tenantId: string, dto: CreateLaneDto) {
    const origin = await this.buildEndpoint(tenantId, dto.originType, dto.origin);
    const destination = await this.buildEndpoint(tenantId, dto.destinationType, dto.destination);
    try {
      return await this.prisma.lane.create({
        data: {
          tenantId,
          name: dto.name,
          originType: dto.originType,
          originLocationId: origin.locationId,
          originCity: origin.city,
          originState: origin.state,
          originCountry: origin.country,
          destinationType: dto.destinationType,
          destinationLocationId: destination.locationId,
          destinationCity: destination.city,
          destinationState: destination.state,
          destinationCountry: destination.country,
          originKey: origin.key,
          destinationKey: destination.key,
        },
        include: laneInclude,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An identical lane already exists');
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateLaneDto) {
    await this.get(tenantId, id);
    return this.prisma.lane.update({ where: { id }, data: { name: dto.name }, include: laneInclude });
  }

  /** Restrict policy: refuse deletion while rates or preferences reference the lane. */
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const [rates, prefs] = await this.prisma.$transaction([
      this.prisma.rate.count({ where: { laneId: id } }),
      this.prisma.laneCarrierPreference.count({ where: { laneId: id } }),
    ]);
    if (rates > 0 || prefs > 0) {
      throw new ConflictException(
        `Lane is referenced by ${rates} rate(s) and ${prefs} carrier preference(s) — remove them first`,
      );
    }
    await this.prisma.lane.delete({ where: { id } });
    return { deleted: true };
  }

  /** Replaces the ordered carrier list of a lane (idempotent PUT semantics). */
  async setCarriers(tenantId: string, laneId: string, carrierIds: string[]) {
    if (new Set(carrierIds).size !== carrierIds.length) {
      throw new BadRequestException('Duplicate carriers in the preference list');
    }
    await this.get(tenantId, laneId);
    await Promise.all(carrierIds.map((id) => this.ownership.assertOwned('carrier', id, tenantId)));

    await this.prisma.$transaction([
      this.prisma.laneCarrierPreference.deleteMany({ where: { tenantId, laneId } }),
      this.prisma.laneCarrierPreference.createMany({
        data: carrierIds.map((carrierId, index) => ({ tenantId, laneId, carrierId, rank: index + 1 })),
      }),
    ]);
    return this.get(tenantId, laneId);
  }

  /** Lanes matching a physical O/D, most specific first (shared compareLanes ordering). */
  async findMatching(
    tenantId: string,
    origin: Parameters<typeof candidateEndpointKeys>[0],
    destination: Parameters<typeof candidateEndpointKeys>[0],
  ) {
    const lanes = await this.prisma.lane.findMany({
      where: {
        tenantId,
        originKey: { in: candidateEndpointKeys(origin) },
        destinationKey: { in: candidateEndpointKeys(destination) },
      },
      include: { carrierPreferences: { orderBy: { rank: 'asc' } } },
    });
    return [...lanes].sort(compareLanes);
  }

  /**
   * Ordered carrier ids for auto-tendering: the most specific matching lane THAT HAS
   * preferences wins (a more specific lane without preferences does not mask a broader one).
   */
  async orderedCarrierIdsForLoad(tenantId: string, loadId: string): Promise<string[]> {
    const endpoints = await resolveLoadEndpoints(this.prisma, tenantId, loadId);
    if (!endpoints) return [];
    const lanes = await this.findMatching(tenantId, endpoints.origin, endpoints.destination);
    const withPrefs = lanes.find((l) => l.carrierPreferences.length > 0);
    return withPrefs ? withPrefs.carrierPreferences.map((p) => p.carrierId) : [];
  }
}
```

- [ ] **Step 4 : Réécrire LanesController**

Remplacer intégralement `apps/api/src/modules/transportation/lanes/lanes.controller.ts` :

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateLaneDto, SetLaneCarriersDto, UpdateLaneDto } from './dto/lane.dto';
import { LanesService } from './lanes.service';

@ApiTags('transportation/lanes')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/lanes')
export class LanesController {
  constructor(private readonly lanes: LanesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.lanes.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lanes.get(user.tenantId, id);
  }

  @Post()
  @Audit('lane', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLaneDto) {
    return this.lanes.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('lane', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLaneDto) {
    return this.lanes.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Audit('lane', AuditAction.DELETE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lanes.remove(user.tenantId, id);
  }

  @Put(':id/carriers')
  @Audit('lane', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  setCarriers(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetLaneCarriersDto) {
    return this.lanes.setCarriers(user.tenantId, id, dto.carrierIds);
  }
}
```

- [ ] **Step 5 : Adapter TendersService**

Dans `apps/api/src/modules/transportation/tenders/tenders.service.ts` :

(a) Dans `autoTender(...)`, remplacer le bloc qui lit `load.shipments[0]` et appelle
`this.lanes.orderedCarrierIds(...)` par :

```ts
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      select: { id: true, shipments: { select: { id: true }, take: 1 } },
    });
    if (!load) throw new NotFoundException('Load not found');
    if (load.shipments.length === 0) {
      throw new BadRequestException('Cannot auto-tender a load without shipments');
    }

    const carrierIds = await this.lanes.orderedCarrierIdsForLoad(tenantId, loadId);
    if (carrierIds.length === 0) {
      throw new BadRequestException('No carrier preference list matches this lane');
    }
```

(b) Dans `advanceChain(...)`, remplacer le `findUnique` (avec son include shipments) et
l'appel `orderedCarrierIds` par :

```ts
      const tender = await this.prisma.tender.findUnique({
        where: { id: tenderId },
        include: { load: { select: { status: true } } },
      });
      if (!tender?.isAuto || tender.load.status !== LoadStatus.PLANNED) return;

      const carrierIds = await this.lanes.orderedCarrierIdsForLoad(tender.tenantId, tender.loadId);
      if (carrierIds.length === 0) return;
```

(le reste de `advanceChain` — `nextCarrierInChain`, `create` — est inchangé).

- [ ] **Step 6 : Typecheck + tests unitaires**

Run: `pnpm typecheck`
Expected: PASS — le gate rouge de la tâche 4 est refermé.
Run: `pnpm test`
Expected: PASS (vitest shared inchangé vert ; jest API existant vert).

- [ ] **Step 7 : Commit**

```bash
git add apps/api/src/modules/transportation/lanes apps/api/src/modules/transportation/rating/load-endpoints.ts apps/api/src/modules/transportation/tenders/tenders.service.ts
git commit -m "feat(api): first-class lanes CRUD + specificity matching; auto-tender uses the most specific matching lane"
```

---

### Task 6 : CRUD Accessorials + Fuel tables

**Files:**
- Create: `apps/api/src/modules/transportation/accessorials/accessorials.service.ts`
- Create: `apps/api/src/modules/transportation/accessorials/accessorials.controller.ts`
- Create: `apps/api/src/modules/transportation/accessorials/dto/accessorial.dto.ts`
- Create: `apps/api/src/modules/transportation/fuel-tables/fuel-tables.service.ts`
- Create: `apps/api/src/modules/transportation/fuel-tables/fuel-tables.controller.ts`
- Create: `apps/api/src/modules/transportation/fuel-tables/dto/fuel-table.dto.ts`
- Modify: `apps/api/src/modules/transportation/transportation.module.ts`

- [ ] **Step 1 : DTOs accessorials**

`apps/api/src/modules/transportation/accessorials/dto/accessorial.dto.ts` :

```ts
import { PartialType } from '@nestjs/swagger';
import { AccessorialUnit } from '@pulsar/shared';
import { IsEnum, IsString, Matches } from 'class-validator';

export class CreateAccessorialDto {
  /** Stable identifier used by rate prices and load flags (e.g. TAILGATE). */
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,32}$/, { message: 'code must be 2-32 chars of A-Z, 0-9, _ or -' })
  code!: string;

  @IsString()
  name!: string;

  @IsEnum(AccessorialUnit)
  unit!: AccessorialUnit;
}

export class UpdateAccessorialDto extends PartialType(CreateAccessorialDto) {}
```

- [ ] **Step 2 : Service accessorials**

`apps/api/src/modules/transportation/accessorials/accessorials.service.ts` :

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateAccessorialDto, UpdateAccessorialDto } from './dto/accessorial.dto';

@Injectable()
export class AccessorialsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.AccessorialWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.accessorial.findMany({ where, skip, take, orderBy: { code: 'asc' } }),
      this.prisma.accessorial.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.accessorial.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Accessorial not found');
    return row;
  }

  async create(tenantId: string, dto: CreateAccessorialDto) {
    try {
      return await this.prisma.accessorial.create({ data: { tenantId, ...dto } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Accessorial code "${dto.code}" already exists`);
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateAccessorialDto) {
    await this.get(tenantId, id);
    try {
      return await this.prisma.accessorial.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Accessorial code "${dto.code}" already exists`);
      }
      throw e;
    }
  }

  /** Restrict policy: refuse deletion while rate prices or load flags reference it. */
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const [ratePrices, loadFlags] = await this.prisma.$transaction([
      this.prisma.rateAccessorialPrice.count({ where: { accessorialId: id } }),
      this.prisma.loadAccessorial.count({ where: { accessorialId: id } }),
    ]);
    if (ratePrices > 0 || loadFlags > 0) {
      throw new ConflictException(
        `Accessorial is referenced by ${ratePrices} rate price(s) and ${loadFlags} load flag(s) — remove them first`,
      );
    }
    await this.prisma.accessorial.delete({ where: { id } });
    return { deleted: true };
  }
}
```

- [ ] **Step 3 : Controller accessorials**

`apps/api/src/modules/transportation/accessorials/accessorials.controller.ts` :

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { AccessorialsService } from './accessorials.service';
import { CreateAccessorialDto, UpdateAccessorialDto } from './dto/accessorial.dto';

@ApiTags('transportation/accessorials')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/accessorials')
export class AccessorialsController {
  constructor(private readonly accessorials: AccessorialsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.accessorials.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accessorials.get(user.tenantId, id);
  }

  @Post()
  @Audit('accessorial', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccessorialDto) {
    return this.accessorials.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('accessorial', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAccessorialDto) {
    return this.accessorials.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Audit('accessorial', AuditAction.DELETE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accessorials.remove(user.tenantId, id);
  }
}
```

- [ ] **Step 4 : DTOs fuel tables**

`apps/api/src/modules/transportation/fuel-tables/dto/fuel-table.dto.ts` :

```ts
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class FuelEntryDto {
  @IsDateString()
  effectiveFrom!: string;

  @IsNumber()
  @Min(0)
  pct!: number;
}

export class CreateFuelTableDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FuelEntryDto)
  entries?: FuelEntryDto[];
}

export class UpdateFuelTableDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** When provided, REPLACES the whole entry set (PUT semantics on the nested collection). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FuelEntryDto)
  entries?: FuelEntryDto[];
}
```

- [ ] **Step 5 : Service fuel tables**

`apps/api/src/modules/transportation/fuel-tables/fuel-tables.service.ts` :

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateFuelTableDto, FuelEntryDto, UpdateFuelTableDto } from './dto/fuel-table.dto';

const tableInclude = { entries: { orderBy: { effectiveFrom: 'desc' as const } } } as const;

@Injectable()
export class FuelTablesService {
  constructor(private readonly prisma: PrismaService) {}

  private assertDistinctDates(entries: FuelEntryDto[]) {
    const dates = entries.map((e) => new Date(e.effectiveFrom).toISOString());
    if (new Set(dates).size !== dates.length) {
      throw new BadRequestException('Duplicate effectiveFrom dates in the entry set');
    }
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.FuelSurchargeTableWhereInput = {
      tenantId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fuelSurchargeTable.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        include: tableInclude,
      }),
      this.prisma.fuelSurchargeTable.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const table = await this.prisma.fuelSurchargeTable.findFirst({
      where: { id, tenantId },
      include: tableInclude,
    });
    if (!table) throw new NotFoundException('Fuel surcharge table not found');
    return table;
  }

  async create(tenantId: string, dto: CreateFuelTableDto) {
    this.assertDistinctDates(dto.entries ?? []);
    return this.prisma.fuelSurchargeTable.create({
      data: {
        tenantId,
        name: dto.name,
        entries: {
          create: (dto.entries ?? []).map((e) => ({
            effectiveFrom: new Date(e.effectiveFrom),
            pct: e.pct,
          })),
        },
      },
      include: tableInclude,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateFuelTableDto) {
    await this.get(tenantId, id);
    if (dto.entries) this.assertDistinctDates(dto.entries);
    await this.prisma.$transaction([
      ...(dto.entries
        ? [
            this.prisma.fuelSurchargeEntry.deleteMany({ where: { tableId: id } }),
            this.prisma.fuelSurchargeEntry.createMany({
              data: dto.entries.map((e) => ({
                tableId: id,
                effectiveFrom: new Date(e.effectiveFrom),
                pct: e.pct,
              })),
            }),
          ]
        : []),
      this.prisma.fuelSurchargeTable.update({
        where: { id },
        data: { name: dto.name },
      }),
    ]);
    return this.get(tenantId, id);
  }

  /** Restrict policy: refuse deletion while rates reference the table. */
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const rates = await this.prisma.rate.count({ where: { fuelTableId: id } });
    if (rates > 0) {
      throw new ConflictException(`Fuel table is referenced by ${rates} rate(s) — detach them first`);
    }
    await this.prisma.fuelSurchargeTable.delete({ where: { id } });
    return { deleted: true };
  }
}
```

- [ ] **Step 6 : Controller fuel tables**

`apps/api/src/modules/transportation/fuel-tables/fuel-tables.controller.ts` :

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateFuelTableDto, UpdateFuelTableDto } from './dto/fuel-table.dto';
import { FuelTablesService } from './fuel-tables.service';

@ApiTags('transportation/fuel-tables')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/fuel-tables')
export class FuelTablesController {
  constructor(private readonly fuelTables: FuelTablesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.fuelTables.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.fuelTables.get(user.tenantId, id);
  }

  @Post()
  @Audit('fuel-table', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFuelTableDto) {
    return this.fuelTables.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('fuel-table', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFuelTableDto) {
    return this.fuelTables.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Audit('fuel-table', AuditAction.DELETE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.fuelTables.remove(user.tenantId, id);
  }
}
```

- [ ] **Step 7 : Enregistrer dans le module**

Dans `apps/api/src/modules/transportation/transportation.module.ts`, importer et ajouter
`AccessorialsController`, `FuelTablesController` aux `controllers` et
`AccessorialsService`, `FuelTablesService` aux `providers`.

- [ ] **Step 8 : Typecheck + commit**

Run: `pnpm typecheck` — Expected: PASS.

```bash
git add apps/api/src/modules/transportation/accessorials apps/api/src/modules/transportation/fuel-tables apps/api/src/modules/transportation/transportation.module.ts
git commit -m "feat(api): accessorial catalog + dated fuel surcharge tables (CRUD, restrict deletes)"
```

---

### Task 7 : Extension des Rates (lane, fuel table, tranches, prix d'accessorials)

**Files:**
- Modify: `apps/api/src/modules/transportation/rates/dto/rate.dto.ts`
- Modify: `apps/api/src/modules/transportation/rates/rates.service.ts`

- [ ] **Step 1 : Étendre les DTOs**

Dans `apps/api/src/modules/transportation/rates/dto/rate.dto.ts`, ajouter les imports
(`Type` de `class-transformer` ; `IsArray`, `ValidateNested` de `class-validator`) puis,
avant `CreateRateDto` :

```ts
export class RateBreakDto {
  @IsNumber()
  @Min(0.001)
  upToKg!: number;

  @IsNumber()
  @Min(0)
  amount!: number;
}

export class RateAccessorialPriceDto {
  @IsString()
  accessorialId!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}
```

et dans `CreateRateDto`, après `customerId` :

```ts
  @IsOptional()
  @IsString()
  laneId?: string;

  @IsOptional()
  @IsString()
  fuelTableId?: string;

  /** PER_HUNDREDWEIGHT only — degressive brackets, amount per CWT up to upToKg. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateBreakDto)
  breaks?: RateBreakDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateAccessorialPriceDto)
  accessorialPrices?: RateAccessorialPriceDto[];
}
```

- [ ] **Step 2 : Étendre RatesService**

Remplacer intégralement `apps/api/src/modules/transportation/rates/rates.service.ts` :

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { RateType } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRateDto, UpdateRateDto } from './dto/rate.dto';

const rateInclude = {
  carrier: { select: { id: true, code: true, name: true } },
  customer: { select: { id: true, code: true, name: true } },
  lane: { select: { id: true, name: true, originType: true, destinationType: true } },
  fuelTable: { select: { id: true, name: true } },
  breaks: { orderBy: { upToKg: 'asc' as const } },
  accessorialPrices: { include: { accessorial: { select: { id: true, code: true, name: true, unit: true } } } },
} satisfies Prisma.RateInclude;

@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  private async assertReferences(tenantId: string, dto: UpdateRateDto) {
    await Promise.all([
      this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId),
      this.ownership.assertOwnedIfSet('customer', dto.customerId, tenantId),
      this.ownership.assertOwnedIfSet('lane', dto.laneId, tenantId),
      this.ownership.assertOwnedIfSet('fuelSurchargeTable', dto.fuelTableId, tenantId),
      ...(dto.accessorialPrices ?? []).map((p) =>
        this.ownership.assertOwned('accessorial', p.accessorialId, tenantId),
      ),
    ]);
  }

  /** Breaks only make sense for PER_HUNDREDWEIGHT; distinct bounds enforced here, not in DB errors. */
  private assertBreaks(rateType: RateType | undefined, dto: UpdateRateDto) {
    if (!dto.breaks || dto.breaks.length === 0) return;
    if (rateType !== RateType.PER_HUNDREDWEIGHT) {
      throw new BadRequestException('Weight breaks are only allowed on PER_HUNDREDWEIGHT rates');
    }
    const bounds = dto.breaks.map((b) => b.upToKg);
    if (new Set(bounds).size !== bounds.length) {
      throw new BadRequestException('Duplicate upToKg bounds in weight breaks');
    }
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.RateWhereInput = {
      tenantId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rate.findMany({ where, skip, take, orderBy: { name: 'asc' }, include: rateInclude }),
      this.prisma.rate.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const rate = await this.prisma.rate.findFirst({ where: { id, tenantId }, include: rateInclude });
    if (!rate) throw new NotFoundException('Rate not found');
    return rate;
  }

  async create(tenantId: string, dto: CreateRateDto) {
    await this.assertReferences(tenantId, dto);
    this.assertBreaks(dto.rateType, dto);
    const { breaks, accessorialPrices, validFrom, validTo, ...scalars } = dto;
    return this.prisma.rate.create({
      data: {
        tenantId,
        ...scalars,
        validFrom: validFrom ? new Date(validFrom) : undefined,
        validTo: validTo ? new Date(validTo) : undefined,
        breaks: { create: breaks ?? [] },
        accessorialPrices: { create: accessorialPrices ?? [] },
      },
      include: rateInclude,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRateDto) {
    const existing = await this.get(tenantId, id);
    await this.assertReferences(tenantId, dto);
    this.assertBreaks((dto.rateType ?? existing.rateType) as RateType, dto);
    const { breaks, accessorialPrices, validFrom, validTo, ...scalars } = dto;
    const [, updated] = await this.prisma.$transaction([
      // When provided, the nested collections are replaced wholesale (PUT semantics).
      ...(breaks
        ? [this.prisma.rateBreak.deleteMany({ where: { rateId: id } })]
        : [this.prisma.rateBreak.deleteMany({ where: { rateId: '__none__' } })]),
      this.prisma.rate.update({
        where: { id },
        data: {
          ...scalars,
          validFrom: validFrom ? new Date(validFrom) : undefined,
          validTo: validTo ? new Date(validTo) : undefined,
          ...(breaks ? { breaks: { create: breaks } } : {}),
        },
        include: rateInclude,
      }),
    ]);
    if (accessorialPrices) {
      await this.prisma.$transaction([
        this.prisma.rateAccessorialPrice.deleteMany({ where: { rateId: id } }),
        this.prisma.rateAccessorialPrice.createMany({
          data: accessorialPrices.map((p) => ({ rateId: id, ...p })),
        }),
      ]);
      return this.get(tenantId, id);
    }
    return updated;
  }
}
```

> Note : le `deleteMany({ where: { rateId: '__none__' } })` no-op garde la transaction à
> taille fixe ; si tu préfères, construis le tableau de la transaction conditionnellement —
> l'important est : suppression des tranches AVANT le `rate.update` qui les recrée.

- [ ] **Step 3 : Typecheck + tests + commit**

Run: `pnpm typecheck` puis `pnpm test` — Expected: PASS.

```bash
git add apps/api/src/modules/transportation/rates
git commit -m "feat(api): rates carry lane, fuel table, weight breaks and accessorial prices"
```

---

### Task 8 : RatingService + LoadCostService v2 (snapshot + invariant COMPLETED)

**Files:**
- Create: `apps/api/src/modules/transportation/rating/rating.service.ts`
- Create: `apps/api/src/modules/transportation/rating/rating.service.spec.ts`
- Rewrite: `apps/api/src/modules/transportation/loads/load-cost.service.ts`
- Modify: `apps/api/src/modules/transportation/transportation.module.ts`

- [ ] **Step 1 : Écrire le test jest (échec attendu)**

`apps/api/src/modules/transportation/rating/rating.service.spec.ts` :

```ts
import { RatingService } from './rating.service';

describe('RatingService (pure helpers)', () => {
  const service = new RatingService(null as never);

  describe('referenceDate', () => {
    it('uses the earliest planned pickup of the shipments', () => {
      const date = service.referenceDate([
        { plannedPickupAt: new Date('2026-07-02') },
        { plannedPickupAt: new Date('2026-07-01') },
        { plannedPickupAt: null },
      ]);
      expect(date.toISOString()).toBe(new Date('2026-07-01').toISOString());
    });

    it('falls back to now when no shipment has a planned pickup', () => {
      const before = Date.now();
      const date = service.referenceDate([{ plannedPickupAt: null }]);
      expect(date.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('isValidAt — same reference date governs validFrom/validTo AND fuel entries', () => {
    const date = new Date('2026-07-01');
    it('open-ended rates are valid', () => {
      expect(service.isValidAt({ validFrom: null, validTo: null }, date)).toBe(true);
    });
    it('bounded rates honour both bounds', () => {
      expect(service.isValidAt({ validFrom: new Date('2026-06-01'), validTo: new Date('2026-06-30') }, date)).toBe(false);
      expect(service.isValidAt({ validFrom: new Date('2026-07-01'), validTo: null }, date)).toBe(true);
      expect(service.isValidAt({ validFrom: null, validTo: new Date('2026-07-01') }, date)).toBe(true);
    });
  });
});
```

Run: `pnpm --filter @pulsar/api test` (ou `pnpm test`) — Expected: FAIL (module inexistant).

- [ ] **Step 2 : Implémenter RatingService**

`apps/api/src/modules/transportation/rating/rating.service.ts` :

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AccessorialUnit,
  CostBreakdown,
  CostMetrics,
  ENDPOINT_SPECIFICITY,
  RateStatus,
  RateType,
  RequestedAccessorial,
  calculateRateCost,
  candidateEndpointKeys,
  pickFuelEntry,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveLoadEndpoints } from './load-endpoints';

const rateDetailInclude = {
  carrier: { select: { id: true, code: true, name: true } },
  lane: { select: { id: true, name: true, originType: true, destinationType: true, createdAt: true } },
  fuelTable: { select: { id: true, name: true, entries: { orderBy: { effectiveFrom: 'desc' as const } } } },
  breaks: { orderBy: { upToKg: 'asc' as const } },
  accessorialPrices: { include: { accessorial: { select: { code: true, name: true, unit: true } } } },
} satisfies Prisma.RateInclude;

type RateDetail = Prisma.RateGetPayload<{ include: typeof rateDetailInclude }>;

interface LoadForRating {
  id: string;
  route: { totalDistanceKm: number | null } | null;
  shipments: { weightKg: number | null; palletCount: number | null; plannedPickupAt: Date | null }[];
  accessorials: { quantity: number; accessorial: { code: string; unit: string } }[];
}

interface FuelResolution {
  pct: number;
  source: 'TABLE' | 'STATIC' | 'NONE';
  tableId?: string;
  effectiveFrom?: string;
}

export interface RateEvaluation {
  breakdown: CostBreakdown;
  currency: string;
  fuel: FuelResolution;
  snapshot: Prisma.InputJsonValue;
}

@Injectable()
export class RatingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reference date: earliest planned pickup, else today. Governs fuel AND validity. */
  referenceDate(shipments: { plannedPickupAt: Date | null }[]): Date {
    const dates = shipments
      .map((s) => s.plannedPickupAt)
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime());
    return dates.length > 0 ? new Date(Math.min(...dates)) : new Date();
  }

  isValidAt(rate: { validFrom: Date | null; validTo: Date | null }, date: Date): boolean {
    if (rate.validFrom && rate.validFrom.getTime() > date.getTime()) return false;
    if (rate.validTo && rate.validTo.getTime() < date.getTime()) return false;
    return true;
  }

  private metricsOf(load: LoadForRating): CostMetrics {
    const sum = (values: (number | null)[]) =>
      values.some((v) => v !== null) ? values.reduce<number>((acc, v) => acc + (v ?? 0), 0) : null;
    return {
      distanceKm: load.route?.totalDistanceKm ?? null,
      weightKg: sum(load.shipments.map((s) => s.weightKg)),
      palletCount: sum(load.shipments.map((s) => s.palletCount)),
    };
  }

  private requestedAccessorials(load: LoadForRating): RequestedAccessorial[] {
    return load.accessorials.map((a) => ({
      code: a.accessorial.code,
      unit: a.accessorial.unit as AccessorialUnit,
      quantity: a.quantity,
    }));
  }

  private resolveFuel(rate: RateDetail, date: Date): FuelResolution {
    if (rate.fuelTable) {
      const entry = pickFuelEntry(rate.fuelTable.entries, date);
      return entry
        ? {
            pct: entry.pct,
            source: 'TABLE',
            tableId: rate.fuelTable.id,
            effectiveFrom: entry.effectiveFrom.toISOString(),
          }
        : { pct: 0, source: 'NONE', tableId: rate.fuelTable.id };
    }
    return rate.fuelSurchargePct != null
      ? { pct: rate.fuelSurchargePct, source: 'STATIC' }
      : { pct: 0, source: 'NONE' };
  }

  async loadForRating(tenantId: string, loadId: string) {
    return this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      select: {
        id: true,
        status: true,
        rateId: true,
        route: { select: { totalDistanceKm: true } },
        shipments: { select: { weightKg: true, palletCount: true, plannedPickupAt: true } },
        accessorials: { select: { quantity: true, accessorial: { select: { code: true, unit: true } } } },
      },
    });
  }

  /**
   * Evaluates one rate against one load. The snapshot is self-contained: the rate as
   * used, the inputs and the result — re-explainable without touching the live rate.
   */
  evaluate(rate: RateDetail, load: LoadForRating, referenceDate: Date): RateEvaluation | null {
    const fuel = this.resolveFuel(rate, referenceDate);
    const requested = this.requestedAccessorials(load);
    const metrics = this.metricsOf(load);
    const breakdown = calculateRateCost(
      {
        rateType: rate.rateType as RateType,
        baseAmount: Number(rate.baseAmount),
        fuelSurchargePct: fuel.pct,
        minCharge: rate.minCharge === null ? null : Number(rate.minCharge),
        breaks: rate.breaks.map((b) => ({ upToKg: b.upToKg, amount: Number(b.amount) })),
        accessorialPrices: rate.accessorialPrices.map((p) => ({
          code: p.accessorial.code,
          amount: Number(p.amount),
        })),
      },
      metrics,
      requested,
    );
    if (!breakdown) return null;

    const snapshot = {
      version: 1,
      computedAt: new Date().toISOString(),
      referenceDate: referenceDate.toISOString(),
      rate: {
        id: rate.id,
        name: rate.name,
        rateType: rate.rateType,
        currency: rate.currency,
        baseAmount: Number(rate.baseAmount),
        minCharge: rate.minCharge === null ? null : Number(rate.minCharge),
        laneId: rate.laneId,
        validFrom: rate.validFrom?.toISOString() ?? null,
        validTo: rate.validTo?.toISOString() ?? null,
        breaks: rate.breaks.map((b) => ({ upToKg: b.upToKg, amount: Number(b.amount) })),
        accessorialPrices: rate.accessorialPrices.map((p) => ({
          code: p.accessorial.code,
          amount: Number(p.amount),
        })),
        fuel,
      },
      inputs: { ...metrics, accessorials: requested },
      result: breakdown,
    };

    return {
      breakdown,
      currency: rate.currency,
      fuel,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    };
  }

  /** Evaluation of the load's assigned rate — what recompute() persists. */
  async evaluateAssignedRate(tenantId: string, loadId: string): Promise<RateEvaluation | null> {
    const load = await this.loadForRating(tenantId, loadId);
    if (!load?.rateId) return null;
    const rate = await this.prisma.rate.findFirst({
      where: { id: load.rateId, tenantId },
      include: rateDetailInclude,
    });
    if (!rate) return null;
    return this.evaluate(rate, load, this.referenceDate(load.shipments));
  }

  /**
   * Rate shopping: every ACTIVE rate valid at the reference date whose lane matches the
   * load (or catch-all), costed in full. Sorted per currency, complete candidates first,
   * cheapest first. Read-only — assignment stays the existing manual endpoint.
   */
  async rateOptions(tenantId: string, loadId: string) {
    const load = await this.loadForRating(tenantId, loadId);
    if (!load) throw new NotFoundException('Load not found');
    const endpoints = await resolveLoadEndpoints(this.prisma, tenantId, loadId);
    const date = this.referenceDate(load.shipments);

    const laneFilter: Prisma.RateWhereInput = endpoints
      ? {
          OR: [
            { laneId: null },
            {
              lane: {
                originKey: { in: candidateEndpointKeys(endpoints.origin) },
                destinationKey: { in: candidateEndpointKeys(endpoints.destination) },
              },
            },
          ],
        }
      : { laneId: null };

    const rates = await this.prisma.rate.findMany({
      where: {
        tenantId,
        status: RateStatus.ACTIVE,
        AND: [
          laneFilter,
          { OR: [{ validFrom: null }, { validFrom: { lte: date } }] },
          { OR: [{ validTo: null }, { validTo: { gte: date } }] },
        ],
      },
      include: rateDetailInclude,
    });

    const options = rates
      .map((rate) => ({ rate, evaluation: this.evaluate(rate, load, date) }))
      .filter((o): o is { rate: RateDetail; evaluation: RateEvaluation } => o.evaluation !== null)
      .map(({ rate, evaluation }) => ({
        rateId: rate.id,
        rateName: rate.name,
        currency: rate.currency,
        carrier: rate.carrier,
        laneSpecificity: rate.lane
          ? {
              originType: rate.lane.originType,
              destinationType: rate.lane.destinationType,
              total:
                ENDPOINT_SPECIFICITY[rate.lane.originType] +
                ENDPOINT_SPECIFICITY[rate.lane.destinationType],
            }
          : null,
        breakdown: evaluation.breakdown,
        missingAccessorials: evaluation.breakdown.missingAccessorials,
      }))
      .sort((a, b) => {
        if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
        const aIncomplete = a.missingAccessorials.length > 0 ? 1 : 0;
        const bIncomplete = b.missingAccessorials.length > 0 ? 1 : 0;
        if (aIncomplete !== bIncomplete) return aIncomplete - bIncomplete;
        return a.breakdown.total - b.breakdown.total;
      });

    return { referenceDate: date.toISOString(), options };
  }
}
```

- [ ] **Step 3 : Réécrire LoadCostService**

Remplacer intégralement `apps/api/src/modules/transportation/loads/load-cost.service.ts` :

```ts
import { Injectable } from '@nestjs/common';
import { LoadStatus } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { RatingService } from '../rating/rating.service';

/**
 * Recomputes the estimated buy-side cost + frozen calculation snapshot of a load.
 * Called whenever the rate, the route (distance), the shipment mix or the load's
 * accessorial flags change.
 *
 * SPEC INVARIANT (audit trail): a COMPLETED load is NEVER recomputed — its
 * estimatedCost/costDetail snapshot is the source of truth for reconciliation.
 */
@Injectable()
export class LoadCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rating: RatingService,
  ) {}

  async recompute(tenantId: string, loadId: string): Promise<void> {
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      select: { status: true, rateId: true },
    });
    if (!load) return;
    if (load.status === LoadStatus.COMPLETED) return;

    if (!load.rateId) {
      await this.prisma.load.update({
        where: { id: loadId },
        data: { estimatedCost: null, costCurrency: null, costDetail: Prisma.DbNull },
      });
      return;
    }

    const evaluation = await this.rating.evaluateAssignedRate(tenantId, loadId);
    await this.prisma.load.update({
      where: { id: loadId },
      data: {
        estimatedCost: evaluation ? evaluation.breakdown.total : null,
        costCurrency: evaluation ? evaluation.currency : null,
        costDetail: evaluation ? evaluation.snapshot : Prisma.DbNull,
      },
    });
  }
}
```

- [ ] **Step 4 : Enregistrer RatingService**

Dans `transportation.module.ts`, importer `RatingService` et l'ajouter aux `providers`.

- [ ] **Step 5 : Tests + typecheck**

Run: `pnpm test` puis `pnpm typecheck`
Expected: PASS (les nouveaux tests jest de `rating.service.spec.ts` passent).

- [ ] **Step 6 : Commit**

```bash
git add apps/api/src/modules/transportation/rating apps/api/src/modules/transportation/loads/load-cost.service.ts apps/api/src/modules/transportation/transportation.module.ts
git commit -m "feat(api): RatingService (reference date, dated fuel, lane-aware evaluation) + frozen costDetail snapshot with COMPLETED invariant"
```

---

### Task 9 : Endpoints load — accessorials + rate-options

**Files:**
- Modify: `apps/api/src/modules/transportation/loads/dto/load.dto.ts`
- Modify: `apps/api/src/modules/transportation/loads/loads.service.ts`
- Modify: `apps/api/src/modules/transportation/loads/loads.controller.ts`

- [ ] **Step 1 : DTO**

Dans `apps/api/src/modules/transportation/loads/dto/load.dto.ts`, ajouter (avec les imports
`Type` de `class-transformer`, `IsArray/IsNumber/Min/ValidateNested` de `class-validator`) :

```ts
export class LoadAccessorialItemDto {
  @IsString()
  accessorialId!: string;

  /** Ignored (forced to 1) for FLAT-unit accessorials. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;
}

export class SetLoadAccessorialsDto {
  /** Replaces the whole set (PUT semantics). Empty array clears all flags. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoadAccessorialItemDto)
  items!: LoadAccessorialItemDto[];
}
```

- [ ] **Step 2 : Service**

Dans `LoadsService`, ajouter (import `SetLoadAccessorialsDto` depuis `./dto/load.dto`) :

```ts
  /** Replaces the load's accessorial flags and recomputes the cost snapshot. */
  async setAccessorials(tenantId: string, userId: string, id: string, dto: SetLoadAccessorialsDto) {
    const load = await this.get(tenantId, id);
    if (load.status === LoadStatus.COMPLETED || load.status === LoadStatus.CANCELLED) {
      throw new BadRequestException('Accessorials cannot be changed on a COMPLETED or CANCELLED load');
    }
    const ids = dto.items.map((i) => i.accessorialId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate accessorials in the list');
    }
    await Promise.all(ids.map((aid) => this.ownership.assertOwned('accessorial', aid, tenantId)));

    const catalog = await this.prisma.accessorial.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, unit: true },
    });
    const unitOf = new Map(catalog.map((a) => [a.id, a.unit]));

    await this.prisma.$transaction([
      this.prisma.loadAccessorial.deleteMany({ where: { loadId: id } }),
      this.prisma.loadAccessorial.createMany({
        data: dto.items.map((i) => ({
          loadId: id,
          accessorialId: i.accessorialId,
          quantity: unitOf.get(i.accessorialId) === 'FLAT' ? 1 : (i.quantity ?? 1),
        })),
      }),
    ]);
    await this.cost.recompute(tenantId, id);
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'load',
      entityId: id,
      after: { accessorials: dto.items },
    });
    return this.get(tenantId, id);
  }
```

Et dans le `loadInclude` du service, ajouter :

```ts
  accessorials: {
    select: {
      id: true,
      quantity: true,
      accessorial: { select: { id: true, code: true, name: true, unit: true } },
    },
  },
```

- [ ] **Step 3 : Controller**

Dans `LoadsController` (imports : `Put`, `SetLoadAccessorialsDto`, `RatingService`) —
injecter `private readonly rating: RatingService` dans le constructeur, puis ajouter :

```ts
  // --- Rating ---------------------------------------------------------------

  /** Replaces the accessorial flags (tailgate, wait…) priced into the load's cost. */
  @Put(':id/accessorials')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  setAccessorials(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetLoadAccessorialsDto,
  ) {
    return this.loads.setAccessorials(user.tenantId, user.id, id, dto);
  }

  /** Rate shopping: ranked candidate rates for this load (read-only decision aid). */
  @Get(':id/rate-options')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.RATES_READ)
  rateOptions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rating.rateOptions(user.tenantId, id);
  }
```

- [ ] **Step 4 : Typecheck + tests + commit**

Run: `pnpm typecheck` puis `pnpm test` — Expected: PASS.

```bash
git add apps/api/src/modules/transportation/loads
git commit -m "feat(api): load accessorial flags (PUT) + rate shopping endpoint (GET rate-options)"
```

---

### Task 10 : Seed — catalogue d'exemple complet

**Files:**
- Modify: `packages/database/prisma/seed.ts`

> `@pulsar/shared` est déjà une devDependency de `@pulsar/database` — on importe les
> helpers de clés au lieu de dupliquer la normalisation.

- [ ] **Step 1 : Ajouter le bloc rating au seed**

Dans `packages/database/prisma/seed.ts`, ajouter l'import en tête :

```ts
import { LaneEndpointType, buildEndpointKey } from '@pulsar/shared';
```

puis, dans `main()`, **après** la création de `carrier` (et avant le `transportOrder`) :

```ts
  // --- Phase 7: rating master data -------------------------------------------------

  const accessorials = [
    { code: 'TAILGATE', name: 'Tailgate service', unit: 'FLAT' as const },
    { code: 'WAIT_HOUR', name: 'Waiting time (per hour)', unit: 'PER_HOUR' as const },
    { code: 'RESIDENTIAL', name: 'Residential delivery', unit: 'FLAT' as const },
  ];
  const accessorialRows = [] as { id: string; code: string }[];
  for (const a of accessorials) {
    const row = await prisma.accessorial.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: a.code } },
      update: {},
      create: { tenantId: tenant.id, ...a },
    });
    accessorialRows.push(row);
  }

  let fuelTable = await prisma.fuelSurchargeTable.findFirst({
    where: { tenantId: tenant.id, name: 'Standard diesel index' },
  });
  if (!fuelTable) {
    fuelTable = await prisma.fuelSurchargeTable.create({
      data: {
        tenantId: tenant.id,
        name: 'Standard diesel index',
        entries: {
          create: [
            { effectiveFrom: new Date('2026-01-01'), pct: 8 },
            { effectiveFrom: new Date('2026-06-01'), pct: 11.5 },
          ],
        },
      },
    });
  }

  // LOCATION→LOCATION lane (plant → dc) carrying the carrier preference list.
  const siteLane = await prisma.lane.upsert({
    where: {
      tenantId_originKey_destinationKey: {
        tenantId: tenant.id,
        originKey: buildEndpointKey(LaneEndpointType.LOCATION, { locationId: plant.id }),
        destinationKey: buildEndpointKey(LaneEndpointType.LOCATION, { locationId: dc.id }),
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Plant → DC (site level)',
      originType: 'LOCATION',
      originLocationId: plant.id,
      destinationType: 'LOCATION',
      destinationLocationId: dc.id,
      originKey: buildEndpointKey(LaneEndpointType.LOCATION, { locationId: plant.id }),
      destinationKey: buildEndpointKey(LaneEndpointType.LOCATION, { locationId: dc.id }),
    },
  });
  await prisma.laneCarrierPreference.upsert({
    where: {
      tenantId_laneId_carrierId: { tenantId: tenant.id, laneId: siteLane.id, carrierId: carrier.id },
    },
    update: { rank: 1 },
    create: { tenantId: tenant.id, laneId: siteLane.id, carrierId: carrier.id, rank: 1 },
  });

  // CITY→CITY lane derived from the same two locations (state/country fall back to QC/CA
  // when the seeded locations don't carry them).
  const cityOf = (loc: { city: string; state: string | null; country: string }) => ({
    city: loc.city,
    state: loc.state ?? 'QC',
    country: loc.country,
  });
  const cityOriginKey = buildEndpointKey(LaneEndpointType.CITY, cityOf(plant));
  const cityDestinationKey = buildEndpointKey(LaneEndpointType.CITY, cityOf(dc));
  const cityLane = await prisma.lane.upsert({
    where: {
      tenantId_originKey_destinationKey: {
        tenantId: tenant.id,
        originKey: cityOriginKey,
        destinationKey: cityDestinationKey,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: `${plant.city} → ${dc.city} (city level)`,
      originType: 'CITY',
      originCity: plant.city,
      originState: plant.state ?? 'QC',
      originCountry: plant.country,
      destinationType: 'CITY',
      destinationCity: dc.city,
      destinationState: dc.state ?? 'QC',
      destinationCountry: dc.country,
      originKey: cityOriginKey,
      destinationKey: cityDestinationKey,
    },
  });

  // A complete demo rate: CWT brackets + accessorial prices + dated fuel table, on the city lane.
  const demoRateName = 'Demo CWT grid (city lane)';
  const existingDemoRate = await prisma.rate.findFirst({
    where: { tenantId: tenant.id, name: demoRateName },
  });
  if (!existingDemoRate) {
    await prisma.rate.create({
      data: {
        tenantId: tenant.id,
        name: demoRateName,
        carrierId: carrier.id,
        laneId: cityLane.id,
        fuelTableId: fuelTable.id,
        rateType: 'PER_HUNDREDWEIGHT',
        baseAmount: 25,
        minCharge: 150,
        status: 'ACTIVE',
        breaks: {
          create: [
            { upToKg: 500, amount: 25 },
            { upToKg: 2000, amount: 18 },
            { upToKg: 10000, amount: 12 },
          ],
        },
        accessorialPrices: {
          create: [
            { accessorialId: accessorialRows[0].id, amount: 75 },
            { accessorialId: accessorialRows[1].id, amount: 60 },
          ],
        },
      },
    });
  }
```

> Si les variables du seed ont d'autres noms (`plant`/`dc`/`carrier`/`tenant`), s'aligner
> sur l'existant — ne pas créer de nouvelles locations. Si `plant.state` est null en base,
> le fallback `'QC'` ci-dessus garde le lane CITY cohérent avec les locations du seed.

- [ ] **Step 2 : Rejouer le seed (idempotence)**

Run: `pnpm db:seed` puis **une seconde fois** `pnpm db:seed`
Expected: deux exécutions vertes, pas de doublons (uniques `tenantId_code`,
`tenantId_originKey_destinationKey`, `tenantId_laneId_carrierId` respectés, rate protégé
par le `findFirst`).

- [ ] **Step 3 : Commit**

```bash
git add packages/database/prisma/seed.ts
git commit -m "feat(db): seed rating demo data — accessorials, dated fuel table, site+city lanes, CWT grid rate"
```

---

### Task 11 : Suite e2e phase 7

**Files:**
- Create: `apps/api/test/phase7-rating.e2e-spec.ts`

> Prérequis : DB démarrée + migrée + seedée (`pnpm db:up && pnpm db:migrate && pnpm db:seed`).
> Suivre le style des suites existantes : master data à codes uniques (suffixe), rejouable.

- [ ] **Step 1 : Écrire la suite**

`apps/api/test/phase7-rating.e2e-spec.ts` :

```ts
/**
 * E2E for phase 7.1: first-class lanes, rating engine v2 (breaks + as-if, accessorials,
 * dated fuel), frozen costDetail snapshot, rate shopping, lane-aware auto-tendering.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 7.1 rating engine (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P7${Date.now().toString(36).toUpperCase()}`;
  const ids = {
    customer: '',
    origin: '',
    destination: '',
    carrier: '',
    carrier2: '',
    tailgate: '',
    waitHour: '',
    fuelTable: '',
    cityLane: '',
    siteLane: '',
    cwtRate: '',
    flatRate: '',
    order: '',
    shipment: '',
    load: '',
    order2: '',
    shipment2: '',
    load2: '',
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
      .send({ code: `${suffix}-CUST`, name: 'P7 Customer' })
      .expect(201);
    ids.customer = customer.body.id;

    // Locations with explicit state/country so CITY-level lanes can match.
    // Diacritics on purpose: the lane will be created WITHOUT them and must still match.
    const origin = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-ORI`,
        name: 'P7 Plant',
        type: 'PLANT',
        addressLine1: '1 Test St',
        city: `Montréal-${suffix}`,
        state: 'QC',
        country: 'CA',
      })
      .expect(201);
    ids.origin = origin.body.id;

    const destination = await request(http)
      .post('/api/v1/transportation/locations')
      .set(auth())
      .send({
        code: `${suffix}-DST`,
        name: 'P7 DC',
        type: 'DISTRIBUTION_CENTER',
        addressLine1: '2 Test Av',
        city: `Québec-${suffix}`,
        state: 'QC',
        country: 'CA',
      })
      .expect(201);
    ids.destination = destination.body.id;

    for (const [field, code] of [
      ['carrier', `${suffix}-CARR`],
      ['carrier2', `${suffix}-CAR2`],
    ] as const) {
      const carrier = await request(http)
        .post('/api/v1/transportation/carriers')
        .set(auth())
        .send({ code, name: `P7 ${code}` })
        .expect(201);
      ids[field] = carrier.body.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates the accessorial catalog', async () => {
    const tailgate = await request(http)
      .post('/api/v1/transportation/accessorials')
      .set(auth())
      .send({ code: `TLG-${suffix}`, name: 'Tailgate', unit: 'FLAT' })
      .expect(201);
    ids.tailgate = tailgate.body.id;

    const waitHour = await request(http)
      .post('/api/v1/transportation/accessorials')
      .set(auth())
      .send({ code: `WAIT-${suffix}`, name: 'Waiting time', unit: 'PER_HOUR' })
      .expect(201);
    ids.waitHour = waitHour.body.id;

    // Duplicate code → 409
    await request(http)
      .post('/api/v1/transportation/accessorials')
      .set(auth())
      .send({ code: `TLG-${suffix}`, name: 'Dup', unit: 'FLAT' })
      .expect(409);
  });

  it('creates a dated fuel table — the entry in force at the reference date applies', async () => {
    const table = await request(http)
      .post('/api/v1/transportation/fuel-tables')
      .set(auth())
      .send({
        name: `Fuel-${suffix}`,
        entries: [
          { effectiveFrom: '2020-01-01T00:00:00.000Z', pct: 5 },
          { effectiveFrom: '2026-01-01T00:00:00.000Z', pct: 10 },
        ],
      })
      .expect(201);
    ids.fuelTable = table.body.id;
    expect(table.body.entries).toHaveLength(2);
  });

  it('creates lanes — diacritics-insensitive CITY lane + LOCATION lane, duplicates rejected', async () => {
    // City names WITHOUT accents; the locations carry « Montréal »/« Québec » — must match anyway.
    const cityLane = await request(http)
      .post('/api/v1/transportation/lanes')
      .set(auth())
      .send({
        name: `City lane ${suffix}`,
        originType: 'CITY',
        origin: { city: `MONTREAL-${suffix}`, state: 'qc', country: 'ca' },
        destinationType: 'CITY',
        destination: { city: `quebec-${suffix}`, state: 'QC', country: 'CA' },
      })
      .expect(201);
    ids.cityLane = cityLane.body.id;

    // Strictly identical lane (modulo case/accents) → 409.
    await request(http)
      .post('/api/v1/transportation/lanes')
      .set(auth())
      .send({
        originType: 'CITY',
        origin: { city: `Montréal-${suffix}`, state: 'QC', country: 'CA' },
        destinationType: 'CITY',
        destination: { city: `Québec-${suffix}`, state: 'QC', country: 'CA' },
      })
      .expect(409);

    const siteLane = await request(http)
      .post('/api/v1/transportation/lanes')
      .set(auth())
      .send({
        name: `Site lane ${suffix}`,
        originType: 'LOCATION',
        origin: { locationId: ids.origin },
        destinationType: 'LOCATION',
        destination: { locationId: ids.destination },
      })
      .expect(201);
    ids.siteLane = siteLane.body.id;

    // Carrier preferences: carrier2 on the CITY lane, carrier on the more specific SITE lane.
    await request(http)
      .put(`/api/v1/transportation/lanes/${ids.cityLane}/carriers`)
      .set(auth())
      .send({ carrierIds: [ids.carrier2] })
      .expect(200);
    await request(http)
      .put(`/api/v1/transportation/lanes/${ids.siteLane}/carriers`)
      .set(auth())
      .send({ carrierIds: [ids.carrier] })
      .expect(200);
  });

  it('creates rates: CWT grid on the city lane, catch-all FLAT, expired rate', async () => {
    const cwt = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} CWT grid`,
        rateType: 'PER_HUNDREDWEIGHT',
        baseAmount: 20,
        carrierId: ids.carrier,
        laneId: ids.cityLane,
        fuelTableId: ids.fuelTable,
        breaks: [
          { upToKg: 500, amount: 20 },
          { upToKg: 2000, amount: 15 },
        ],
        accessorialPrices: [
          { accessorialId: ids.tailgate, amount: 75 },
          { accessorialId: ids.waitHour, amount: 60 },
        ],
      })
      .expect(201);
    ids.cwtRate = cwt.body.id;
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.cwtRate}`)
      .set(auth())
      .send({ status: 'ACTIVE' })
      .expect(200);

    const flat = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({ name: `${suffix} flat catch-all`, rateType: 'FLAT', baseAmount: 999, carrierId: ids.carrier2 })
      .expect(201);
    ids.flatRate = flat.body.id;
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.flatRate}`)
      .set(auth())
      .send({ status: 'ACTIVE' })
      .expect(200);

    // Expired: must never appear in rate-options.
    const expired = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} expired`,
        rateType: 'FLAT',
        baseAmount: 1,
        validTo: '2020-01-01T00:00:00.000Z',
      })
      .expect(201);
    await request(http)
      .patch(`/api/v1/transportation/rates/${expired.body.id}`)
      .set(auth())
      .send({ status: 'ACTIVE' })
      .expect(200);

    // Breaks on a FLAT rate → 400.
    await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({
        name: `${suffix} invalid breaks`,
        rateType: 'FLAT',
        baseAmount: 10,
        breaks: [{ upToKg: 100, amount: 5 }],
      })
      .expect(400);
  });

  it('plans an order into a load (480 kg — the as-if demo weight)', async () => {
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        totalWeightKg: 480,
        palletCount: 2,
      })
      .expect(201);
    ids.order = order.body.id;
    await request(http).post(`/api/v1/transportation/transport-orders/${ids.order}/confirm`).set(auth()).expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/plan`)
      .set(auth())
      .expect(201);
    ids.shipment = planned.body.shipments[0].id;

    const load = await request(http).post('/api/v1/transportation/loads').set(auth()).send({}).expect(201);
    ids.load = load.body.id;
    await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipment}/assign-load`)
      .set(auth())
      .send({ loadId: ids.load })
      .expect(201);
  });

  it('flags accessorials on the load', async () => {
    const res = await request(http)
      .put(`/api/v1/transportation/loads/${ids.load}/accessorials`)
      .set(auth())
      .send({
        items: [
          { accessorialId: ids.tailgate },
          { accessorialId: ids.waitHour, quantity: 2 },
        ],
      })
      .expect(200);
    expect(res.body.accessorials).toHaveLength(2);
  });

  it('rate shopping: lane match (diacritics-insensitive), ordering, expired excluded, specificity exposed', async () => {
    const res = await request(http)
      .get(`/api/v1/transportation/loads/${ids.load}/rate-options`)
      .set(auth())
      .expect(200);
    const options = res.body.options as Array<{
      rateId: string;
      laneSpecificity: { total: number } | null;
      missingAccessorials: string[];
      breakdown: { total: number; appliedBreak: { asIfApplied: boolean } | null };
    }>;

    const names = options.map((o) => o.rateId);
    expect(names).toContain(ids.cwtRate); // CITY lane matched despite accents/case differences
    expect(names).toContain(ids.flatRate); // catch-all
    expect(names).not.toContain(undefined);
    expect(options.some((o) => o.rateId === ids.cwtRate && o.laneSpecificity?.total === 4)).toBe(true);

    const cwtOption = options.find((o) => o.rateId === ids.cwtRate)!;
    const flatOption = options.find((o) => o.rateId === ids.flatRate)!;
    // 480 kg → as-if rule must price the ≤2000 bracket.
    expect(cwtOption.breakdown.appliedBreak?.asIfApplied).toBe(true);
    expect(cwtOption.missingAccessorials).toEqual([]);
    // The flat rate prices no accessorial → flagged incomplete and ranked after complete ones.
    expect(flatOption.missingAccessorials.length).toBeGreaterThan(0);
    expect(options.indexOf(cwtOption)).toBeLessThan(options.indexOf(flatOption));
  });

  it('assigning the rate persists the frozen costDetail snapshot', async () => {
    await request(http)
      .post(`/api/v1/transportation/loads/${ids.load}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier, rateId: ids.cwtRate })
      .expect(201);

    const load = await request(http).get(`/api/v1/transportation/loads/${ids.load}`).set(auth()).expect(200);
    expect(load.body.estimatedCost).not.toBeNull();
    const detail = load.body.costDetail;
    expect(detail.version).toBe(1);
    expect(detail.rate.id).toBe(ids.cwtRate);
    expect(detail.rate.fuel.source).toBe('TABLE');
    expect(detail.rate.fuel.pct).toBe(10); // 2026 entry, not the 2020 one
    expect(detail.inputs.weightKg).toBe(480);
    expect(detail.result.appliedBreak.asIfApplied).toBe(true);
    expect(detail.result.lines.map((l: { type: string }) => l.type)).toEqual(
      expect.arrayContaining(['BASE', 'FUEL', 'ACCESSORIAL']),
    );
  });

  it('INVARIANT: completing freezes the snapshot — later rate edits never rewrite it', async () => {
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/dispatch`).set(auth()).expect(201);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/start-transit`).set(auth()).expect(201);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/complete`).set(auth()).expect(201);

    const before = await request(http).get(`/api/v1/transportation/loads/${ids.load}`).set(auth()).expect(200);

    // Mutate the rate aggressively…
    await request(http)
      .patch(`/api/v1/transportation/rates/${ids.cwtRate}`)
      .set(auth())
      .send({ baseAmount: 99999, breaks: [{ upToKg: 99999, amount: 99999 }] })
      .expect(200);

    // …the COMPLETED load must not move (accessorial change is even rejected).
    await request(http)
      .put(`/api/v1/transportation/loads/${ids.load}/accessorials`)
      .set(auth())
      .send({ items: [] })
      .expect(400);

    const after = await request(http).get(`/api/v1/transportation/loads/${ids.load}`).set(auth()).expect(200);
    expect(after.body.estimatedCost).toBe(before.body.estimatedCost);
    expect(after.body.costDetail).toEqual(before.body.costDetail);
  });

  it('auto-tender picks the most specific matching lane (site beats city)', async () => {
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        totalWeightKg: 100,
      })
      .expect(201);
    ids.order2 = order.body.id;
    await request(http).post(`/api/v1/transportation/transport-orders/${ids.order2}/confirm`).set(auth()).expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order2}/plan`)
      .set(auth())
      .expect(201);
    ids.shipment2 = planned.body.shipments[0].id;

    const load = await request(http).post('/api/v1/transportation/loads').set(auth()).send({}).expect(201);
    ids.load2 = load.body.id;
    await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipment2}/assign-load`)
      .set(auth())
      .send({ loadId: ids.load2 })
      .expect(201);

    const tender = await request(http)
      .post(`/api/v1/transportation/loads/${ids.load2}/auto-tender`)
      .set(auth())
      .send({})
      .expect(201);
    // SITE lane (specificity 6, carrier) must beat CITY lane (specificity 4, carrier2).
    expect(tender.body.carrierId).toBe(ids.carrier);
  });

  it('restrict deletes: referenced lane, accessorial and fuel table are protected', async () => {
    await request(http).delete(`/api/v1/transportation/lanes/${ids.cityLane}`).set(auth()).expect(409);
    await request(http).delete(`/api/v1/transportation/accessorials/${ids.tailgate}`).set(auth()).expect(409);
    await request(http).delete(`/api/v1/transportation/fuel-tables/${ids.fuelTable}`).set(auth()).expect(409);
  });
});
```

- [ ] **Step 2 : Lancer la suite**

Run: `pnpm db:up && pnpm db:migrate && pnpm db:seed` (si pas déjà fait), puis `pnpm test:e2e`
Expected: la nouvelle suite passe ET toutes les suites existantes restent vertes
(`workflow`, `collaboration`, `tender-automation` — celle-ci valide la non-régression de
l'auto-tender sur les lanes migrées).

> Si un statut HTTP diffère (200 vs 201 sur PUT/PATCH selon les conventions du projet),
> aligner le test sur le comportement réel observé — pas l'inverse.

- [ ] **Step 3 : Commit**

```bash
git add apps/api/test/phase7-rating.e2e-spec.ts
git commit -m "test(e2e): phase 7.1 — lanes, rating v2, snapshot invariants, lane-aware auto-tender"
```

---

### Task 12 : Web — page Rates (nouvelle) + navigation

**Files:**
- Create: `apps/web/src/routes/(app)/rates/+page.svelte`
- Modify: `apps/web/src/routes/(app)/+layout.svelte`

> Suivre le pattern des pages existantes : `$state` + `load()` déclenché par `$effect`,
> `api<T>()` de `$lib/api/client`, erreurs dans `error: string`, `toast` pour le feedback.
> Regarder `lanes/+page.svelte` (avant refonte) et `customers/+page.svelte` comme modèles.

- [ ] **Step 1 : Navigation**

Dans `apps/web/src/routes/(app)/+layout.svelte`, dans le tableau `tmsNav`, ajouter après
`{ href: '/lanes', label: 'Lanes' }` :

```ts
    { href: '/rates', label: 'Rates' },
    { href: '/accessorials', label: 'Accessorials' },
    { href: '/fuel-tables', label: 'Fuel tables' },
```

(les deux dernières routes arrivent à la tâche 14 — un lien 404 temporaire est acceptable
entre les deux commits, ou déplacer cette étape en tâche 14 si tu préfères des commits
strictement cohérents).

- [ ] **Step 2 : Page Rates**

`apps/web/src/routes/(app)/rates/+page.svelte` — contenu complet :

```svelte
<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';

  interface Option { id: string; name: string; code?: string }
  interface AccessorialOpt extends Option { unit: string }
  interface RateBreak { upToKg: number; amount: number }
  interface RateAccessorialPrice { accessorialId?: string; amount: number; accessorial?: AccessorialOpt }
  interface Rate {
    id: string; name: string; rateType: string; status: string; currency: string;
    baseAmount: string; minCharge: string | null; fuelSurchargePct: number | null;
    validFrom: string | null; validTo: string | null;
    carrier: Option | null; customer: Option | null;
    lane: { id: string; name: string | null; originType: string; destinationType: string } | null;
    fuelTable: Option | null;
    breaks: RateBreak[];
    accessorialPrices: RateAccessorialPrice[];
  }

  let rates = $state<Rate[]>([]);
  let lanes = $state<Option[]>([]);
  let carriers = $state<Option[]>([]);
  let fuelTables = $state<Option[]>([]);
  let accessorials = $state<AccessorialOpt[]>([]);
  let error = $state('');

  // Form state
  let editingId = $state<string | null>(null);
  let name = $state('');
  let rateType = $state('FLAT');
  let baseAmount = $state(0);
  let currency = $state('CAD');
  let minCharge = $state<number | null>(null);
  let fuelSurchargePct = $state<number | null>(null);
  let carrierId = $state('');
  let laneId = $state('');
  let fuelTableId = $state('');
  let validFrom = $state('');
  let validTo = $state('');
  let status = $state('DRAFT');
  let breaks = $state<RateBreak[]>([]);
  let prices = $state<{ accessorialId: string; amount: number }[]>([]);

  async function load() {
    try {
      const [r, l, c, f, a] = await Promise.all([
        api<Paginated<Rate>>('/transportation/rates', { query: { pageSize: 100 } }),
        api<Paginated<{ id: string; name: string | null; originType: string; destinationType: string }>>(
          '/transportation/lanes',
          { query: { pageSize: 100 } },
        ),
        api<Paginated<Option>>('/transportation/carriers', { query: { pageSize: 100 } }),
        api<Paginated<Option>>('/transportation/fuel-tables', { query: { pageSize: 100 } }),
        api<Paginated<AccessorialOpt>>('/transportation/accessorials', { query: { pageSize: 100 } }),
      ]);
      rates = r.items;
      lanes = l.items.map((x) => ({ id: x.id, name: x.name ?? `${x.originType} → ${x.destinationType}` }));
      carriers = c.items;
      fuelTables = f.items;
      accessorials = a.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load rates';
    }
  }

  function reset() {
    editingId = null;
    name = ''; rateType = 'FLAT'; baseAmount = 0; currency = 'CAD';
    minCharge = null; fuelSurchargePct = null;
    carrierId = ''; laneId = ''; fuelTableId = ''; validFrom = ''; validTo = '';
    status = 'DRAFT'; breaks = []; prices = [];
  }

  function edit(rate: Rate) {
    editingId = rate.id;
    name = rate.name; rateType = rate.rateType; baseAmount = Number(rate.baseAmount);
    currency = rate.currency;
    minCharge = rate.minCharge === null ? null : Number(rate.minCharge);
    fuelSurchargePct = rate.fuelSurchargePct;
    carrierId = rate.carrier?.id ?? '';
    laneId = rate.lane?.id ?? '';
    fuelTableId = rate.fuelTable?.id ?? '';
    validFrom = rate.validFrom?.slice(0, 10) ?? '';
    validTo = rate.validTo?.slice(0, 10) ?? '';
    status = rate.status;
    breaks = rate.breaks.map((b) => ({ ...b }));
    prices = rate.accessorialPrices.map((p) => ({
      accessorialId: p.accessorial?.id ?? p.accessorialId ?? '',
      amount: Number(p.amount),
    }));
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {
      name, rateType, baseAmount, currency,
      minCharge: minCharge ?? undefined,
      fuelSurchargePct: fuelSurchargePct ?? undefined,
      carrierId: carrierId || undefined,
      laneId: laneId || undefined,
      fuelTableId: fuelTableId || undefined,
      validFrom: validFrom ? new Date(validFrom).toISOString() : undefined,
      validTo: validTo ? new Date(validTo).toISOString() : undefined,
      breaks: rateType === 'PER_HUNDREDWEIGHT' ? breaks : undefined,
      accessorialPrices: prices.filter((p) => p.accessorialId),
    };
    try {
      if (editingId) {
        await api(`/transportation/rates/${editingId}`, { method: 'PATCH', body: { ...body, status } });
        toast.success('Rate updated');
      } else {
        await api('/transportation/rates', { method: 'POST', body });
        toast.success('Rate created');
      }
      reset();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save rate');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header"><h1>Rates</h1></div>

{#if error}<p class="error-text">{error}</p>{/if}

<form class="card" style="margin-bottom: 20px;" onsubmit={save}>
  <h2 style="margin-top: 0;">{editingId ? 'Edit rate' : 'New rate'}</h2>
  <div class="grid">
    <div class="field"><label for="rname">Name</label><input id="rname" bind:value={name} required /></div>
    <div class="field">
      <label for="rtype">Type</label>
      <select id="rtype" bind:value={rateType}>
        {#each ['FLAT', 'PER_KM', 'PER_HUNDREDWEIGHT', 'PER_PALLET', 'SPOT'] as t (t)}<option value={t}>{t}</option>{/each}
      </select>
    </div>
    <div class="field"><label for="rbase">Base amount</label><input id="rbase" type="number" min="0" step="0.01" bind:value={baseAmount} required /></div>
    <div class="field"><label for="rcur">Currency</label><input id="rcur" bind:value={currency} /></div>
    <div class="field"><label for="rmin">Min charge</label><input id="rmin" type="number" min="0" step="0.01" bind:value={minCharge} /></div>
    <div class="field"><label for="rfsp">Static fuel % (fallback)</label><input id="rfsp" type="number" min="0" step="0.1" bind:value={fuelSurchargePct} /></div>
    <div class="field">
      <label for="rcarr">Carrier</label>
      <select id="rcarr" bind:value={carrierId}><option value="">—</option>{#each carriers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select>
    </div>
    <div class="field">
      <label for="rlane">Lane (empty = catch-all)</label>
      <select id="rlane" bind:value={laneId}><option value="">— any lane —</option>{#each lanes as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select>
    </div>
    <div class="field">
      <label for="rft">Fuel table (overrides static %)</label>
      <select id="rft" bind:value={fuelTableId}><option value="">—</option>{#each fuelTables as f (f.id)}<option value={f.id}>{f.name}</option>{/each}</select>
    </div>
    <div class="field"><label for="rvf">Valid from</label><input id="rvf" type="date" bind:value={validFrom} /></div>
    <div class="field"><label for="rvt">Valid to</label><input id="rvt" type="date" bind:value={validTo} /></div>
    {#if editingId}
      <div class="field">
        <label for="rstatus">Status</label>
        <select id="rstatus" bind:value={status}>{#each ['DRAFT', 'ACTIVE', 'EXPIRED'] as s (s)}<option value={s}>{s}</option>{/each}</select>
      </div>
    {/if}
  </div>

  {#if rateType === 'PER_HUNDREDWEIGHT'}
    <h3>Weight breaks (per CWT, up to kg)</h3>
    {#each breaks as b, i (i)}
      <div class="break-row">
        <input type="number" min="1" step="1" bind:value={b.upToKg} placeholder="up to kg" />
        <input type="number" min="0" step="0.01" bind:value={b.amount} placeholder="$/CWT" />
        <button class="btn btn-danger btn-sm" type="button" onclick={() => (breaks = breaks.filter((_, j) => j !== i))}>✕</button>
      </div>
    {/each}
    <button class="btn btn-secondary btn-sm" type="button" onclick={() => (breaks = [...breaks, { upToKg: 0, amount: 0 }])}>
      Add break
    </button>
  {/if}

  <h3>Accessorial prices</h3>
  {#each prices as p, i (i)}
    <div class="break-row">
      <select bind:value={p.accessorialId}>
        <option value="" disabled>Accessorial…</option>
        {#each accessorials as a (a.id)}<option value={a.id}>{a.code} ({a.unit})</option>{/each}
      </select>
      <input type="number" min="0" step="0.01" bind:value={p.amount} placeholder="amount" />
      <button class="btn btn-danger btn-sm" type="button" onclick={() => (prices = prices.filter((_, j) => j !== i))}>✕</button>
    </div>
  {/each}
  <button class="btn btn-secondary btn-sm" type="button" onclick={() => (prices = [...prices, { accessorialId: '', amount: 0 }])}>
    Add accessorial price
  </button>

  <div style="margin-top: 16px; display: flex; gap: 8px;">
    <button class="btn" type="submit">{editingId ? 'Update' : 'Create'}</button>
    {#if editingId}<button class="btn btn-secondary" type="button" onclick={reset}>Cancel</button>{/if}
  </div>
</form>

<table class="table">
  <thead>
    <tr><th>Name</th><th>Type</th><th>Lane</th><th>Carrier</th><th>Base</th><th>Status</th><th></th></tr>
  </thead>
  <tbody>
    {#each rates as rate (rate.id)}
      <tr>
        <td>{rate.name}</td>
        <td>{rate.rateType}{rate.breaks.length ? ` (${rate.breaks.length} breaks)` : ''}</td>
        <td>{rate.lane ? (rate.lane.name ?? `${rate.lane.originType}→${rate.lane.destinationType}`) : 'catch-all'}</td>
        <td>{rate.carrier?.name ?? '—'}</td>
        <td>{rate.baseAmount} {rate.currency}</td>
        <td><span class="badge">{rate.status}</span></td>
        <td><button class="btn btn-secondary btn-sm" onclick={() => edit(rate)}>Edit</button></td>
      </tr>
    {:else}
      <tr><td colspan="7" class="muted">No rates yet.</td></tr>
    {/each}
  </tbody>
</table>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 20px; }
  .break-row { display: flex; gap: 8px; max-width: 480px; margin-bottom: 6px; }
</style>
```

(Adapter les classes CSS aux utilitaires réellement présents dans `app.css` — `table`,
`badge`, `card`, `field` existent déjà sur les autres pages ; sinon reprendre celles de
`customers/+page.svelte`.)

- [ ] **Step 3 : Vérification manuelle + commit**

Run: `pnpm dev`, ouvrir http://localhost:5173/rates — créer un tarif CWT avec 2 tranches +
1 prix d'accessorial, le passer ACTIVE, vérifier la liste.

```bash
git add "apps/web/src/routes/(app)/rates" "apps/web/src/routes/(app)/+layout.svelte"
git commit -m "feat(web): rates management page (lane, breaks, accessorial prices, fuel table, validity)"
```

---

### Task 13 : Web — refonte de la page Lanes

**Files:**
- Rewrite: `apps/web/src/routes/(app)/lanes/+page.svelte`

- [ ] **Step 1 : Réécrire la page**

Remplacer la page par : (1) un formulaire de création de lane avec, pour chaque extrémité,
un `<select>` de niveau (`LOCATION/CITY/STATE/COUNTRY`) et des champs conditionnels —
`LOCATION` → select de locations ; `CITY` → city + state + country ; `STATE` → state +
country ; `COUNTRY` → country ; (2) la liste paginée des lanes (GET `/transportation/lanes`,
`Paginated<T>`) avec nom, libellés d'extrémités, badge du niveau, transporteurs préférés
ordonnés ; (3) par lane : éditeur de préférences (réutiliser tel quel le pattern
add/move/remove de l'ancienne page, en envoyant `PUT /transportation/lanes/{id}/carriers`
avec `{ carrierIds }`) et bouton Delete (`DELETE /transportation/lanes/{id}`, toast d'erreur
sur 409 — message du restrict).

Squelette des appels (le balisage suit le pattern de l'ancienne page, déjà committée —
la récupérer au besoin via `git show HEAD~1:apps/web/src/routes/\(app\)/lanes/+page.svelte`) :

```ts
  interface Lane {
    id: string; name: string | null;
    originType: string; originCity: string | null; originState: string | null; originCountry: string | null;
    originLocation: { id: string; name: string; city: string } | null;
    destinationType: string; destinationCity: string | null; destinationState: string | null; destinationCountry: string | null;
    destinationLocation: { id: string; name: string; city: string } | null;
    carrierPreferences: { id: string; rank: number; carrier: { id: string; name: string; email: string | null } }[];
  }

  function endpointLabel(lane: Lane, side: 'origin' | 'destination'): string {
    const type = side === 'origin' ? lane.originType : lane.destinationType;
    const loc = side === 'origin' ? lane.originLocation : lane.destinationLocation;
    const city = side === 'origin' ? lane.originCity : lane.destinationCity;
    const state = side === 'origin' ? lane.originState : lane.destinationState;
    const country = side === 'origin' ? lane.originCountry : lane.destinationCountry;
    if (type === 'LOCATION') return `${loc?.name} (${loc?.city})`;
    if (type === 'CITY') return `${city}, ${state} (${country})`;
    if (type === 'STATE') return `${state} (${country})`;
    return country ?? '';
  }

  async function createLane(event: SubmitEvent) {
    event.preventDefault();
    const endpoint = (type: string, v: { locationId: string; city: string; state: string; country: string }) =>
      type === 'LOCATION'
        ? { locationId: v.locationId }
        : type === 'CITY'
          ? { city: v.city, state: v.state, country: v.country }
          : type === 'STATE'
            ? { state: v.state, country: v.country }
            : { country: v.country };
    try {
      await api('/transportation/lanes', {
        method: 'POST',
        body: {
          name: laneName || undefined,
          originType,
          origin: endpoint(originType, originForm),
          destinationType,
          destination: endpoint(destinationType, destinationForm),
        },
      });
      toast.success('Lane created');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create lane');
    }
  }
```

- [ ] **Step 2 : Vérification manuelle + commit**

Run: `pnpm dev` → /lanes : créer une lane CITY (avec accents) ; re-créer la même sans
accents → toast 409 « identical lane » ; attacher 2 transporteurs ; supprimer une lane sans
références.

```bash
git add "apps/web/src/routes/(app)/lanes"
git commit -m "feat(web): lanes page v2 — hierarchical endpoints, per-lane carrier preferences, delete with restrict feedback"
```

---

### Task 14 : Web — pages Accessorials et Fuel tables

**Files:**
- Create: `apps/web/src/routes/(app)/accessorials/+page.svelte`
- Create: `apps/web/src/routes/(app)/fuel-tables/+page.svelte`

- [ ] **Step 1 : Page Accessorials**

CRUD simple sur le pattern de la page Customers : liste (`GET /transportation/accessorials`,
`Paginated<T>` ; colonnes code / name / unit), formulaire create/edit (code, name,
select unit `FLAT|PER_HOUR|PER_UNIT`), bouton delete avec toast du message 409 (restrict).
Appels : `POST /transportation/accessorials`, `PATCH /transportation/accessorials/{id}`,
`DELETE /transportation/accessorials/{id}`.

- [ ] **Step 2 : Page Fuel tables**

Liste des tables avec leurs entrées (`entries` triées par `effectiveFrom` desc, renvoyées
par l'API). Formulaire : name + éditeur de lignes `{ effectiveFrom (date), pct (number) }`
(même pattern add/remove que les breaks de la page Rates). Create = POST avec `entries` ;
edit = PATCH avec name et/ou `entries` (remplace tout l'ensemble) ; delete avec toast 409.

- [ ] **Step 3 : Vérification + commit**

Run: `pnpm dev` → créer un accessorial et une table à 2 entrées, tenter de supprimer
l'accessorial référencé par le tarif de seed (toast 409 attendu si le seed l'a lié).

```bash
git add "apps/web/src/routes/(app)/accessorials" "apps/web/src/routes/(app)/fuel-tables"
git commit -m "feat(web): accessorial catalog + fuel surcharge tables pages"
```

---

### Task 15 : Web — load detail : accessorials, Comparer les tarifs, snapshot

**Files:**
- Modify: `apps/web/src/routes/(app)/loads/[id]/+page.svelte`

- [ ] **Step 1 : Bloc accessorials**

Lire la page existante pour repérer : le `load()` principal, l'interface `Load`, la carte
« cost/rate ». Étendre l'interface du load avec :

```ts
  accessorials: { id: string; quantity: number; accessorial: { id: string; code: string; name: string; unit: string } }[];
  costDetail: {
    referenceDate: string;
    rate: { name: string; fuel: { pct: number; source: string } };
    result: {
      lines: { type: string; label: string; amount: number }[];
      total: number;
      appliedBreak: { upToKg: number; amount: number; asIfApplied: boolean } | null;
      missingAccessorials: string[];
    };
  } | null;
```

Ajouter une carte « Accessorials » (visible quand le statut n'est ni COMPLETED ni
CANCELLED) : liste des accessorials du tenant (`GET /transportation/accessorials`,
pageSize 100) avec checkbox + input quantité (désactivé pour `FLAT`), bouton Save :

```ts
  async function saveAccessorials() {
    try {
      await api(`/transportation/loads/${load.id}/accessorials`, {
        method: 'PUT',
        body: {
          items: selected.map((s) => ({ accessorialId: s.id, quantity: s.quantity })),
        },
      });
      toast.success('Accessorials updated — cost recomputed');
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update accessorials');
    }
  }
```

- [ ] **Step 2 : Panneau « Compare rates »**

Sous la carte coût, un bouton « Compare rates » qui appelle :

```ts
  interface RateOption {
    rateId: string;
    rateName: string;
    currency: string;
    carrier: { id: string; name: string } | null;
    laneSpecificity: { originType: string; destinationType: string; total: number } | null;
    breakdown: { total: number; lines: { type: string; label: string; amount: number }[] };
    missingAccessorials: string[];
  }
  let rateOptions = $state<RateOption[] | null>(null);

  async function compareRates() {
    try {
      const res = await api<{ referenceDate: string; options: RateOption[] }>(
        `/transportation/loads/${load.id}/rate-options`,
      );
      rateOptions = res.options;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to fetch rate options');
    }
  }
```

Rendu : tableau trié tel que renvoyé (l'API garantit l'ordre) — colonnes : rate, carrier,
**lane specificity** (`laneSpecificity ? `${originType}→${destinationType} (${total})` :
'catch-all'` — c'est ce qui explique au planificateur pourquoi le tarif s'applique),
total + devise, badge `missing: X` si `missingAccessorials.length > 0`, détail dépliable
(`lines`), bouton **Assign** qui réutilise l'appel d'assignation existant de la page
(`POST /transportation/loads/{id}/assign` avec `{ rateId }`) puis `refresh()`.
Le premier candidat complet de chaque devise porte un badge « best ».

- [ ] **Step 3 : Affichage du snapshot**

Sous le coût estimé, quand `load.costDetail` existe : liste des `result.lines`
(label + montant), la ligne `appliedBreak` le cas échéant (`≤ X kg @ Y $/CWT` + badge
« as-if » si `asIfApplied`), `rate.fuel.pct` avec sa source (TABLE/STATIC), la
`referenceDate`, et un avertissement si `result.missingAccessorials.length > 0`.

- [ ] **Step 4 : Vérification + commit**

Run: `pnpm dev` → sur un load PLANNED : cocher des accessorials → coût recalculé ;
Compare rates → liste classée avec spécificité ; Assign → snapshot affiché.

```bash
git add "apps/web/src/routes/(app)/loads"
git commit -m "feat(web): load detail — accessorial flags, rate shopping panel with lane specificity, cost snapshot display"
```

---

### Task 16 : Documentation + vérification finale

**Files:**
- Modify: `TODO.md`, `ROADMAP.md`, `docs/etat-du-projet.md`, `docs/data-model.md`, `CLAUDE.md`

- [ ] **Step 1 : TODO.md**

Ajouter une section `## Phase 7 — Le « cerveau » TMS` avec les cases cochées du chantier
7.1 (lanes, rating v2, snapshot, shopping, UI, e2e) et les chantiers 7.2/7.3/7.4 ouverts
(reprendre la liste de `docs/etat-du-projet.md`).

- [ ] **Step 2 : ROADMAP.md**

Ajouter `## Phase 7 — TMS brain (rating engine v2) 🚧` avec le résumé du chantier livré
(reprendre le style des phases précédentes, ✅ sur le volet 7.1).

- [ ] **Step 3 : docs/etat-du-projet.md**

Mettre à jour : tableau des phases (ligne 7.1), chiffres (tests/migrations/endpoints/pages),
section « Prochaine session » → chantier 7.2 (intégrité du plan).

- [ ] **Step 4 : docs/data-model.md + CLAUDE.md**

`data-model.md` : décrire Lane (hiérarchie, clés normalisées, ordre de spécificité),
les tables de rating et `Load.costDetail`. Dans `CLAUDE.md`, ajouter aux hard rules :

```markdown
16. Le snapshot `Load.costDetail` est figé : jamais de recompute sur un load COMPLETED,
    et le rapprochement de factures lit `estimatedCost`/`costDetail`, jamais un recalcul.
17. Le lane matching passe par les clés normalisées (`@pulsar/shared` rating/lane-key) et
    l'ordre `compareLanes` — ne jamais réimplémenter la normalisation ou le tie-break.
```

- [ ] **Step 5 : Vérification finale complète**

```bash
pnpm typecheck && pnpm build && pnpm test && pnpm test:e2e
```

Expected: tout vert (suites e2e existantes incluses).

- [ ] **Step 6 : Commit**

```bash
git add TODO.md ROADMAP.md docs/etat-du-projet.md docs/data-model.md CLAUDE.md
git commit -m "docs: phase 7.1 rating engine v2 + lanes shipped — status, data model, hard rules"
```

