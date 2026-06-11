# Phase 7.2 — Intégrité du plan : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter la spec [2026-06-11-phase7-2-plan-integrity-design.md](../specs/2026-06-11-phase7-2-plan-integrity-design.md) : fenêtres temporelles `[early, late?]`, vérification de capacité 3 axes avec override audité, jonction `ShipmentLoadLeg`.

**Architecture:** Les fonctions pures (`windowViolations`, `checkCapacity`) vivent dans `packages/shared/src/planning/` (vitest). La migration renomme les colonnes de dates (⚠️ jamais de DROP/ADD) et backfille la jonction. Les services existants intègrent les contrôles aux points d'assignation ; `windowWarnings` est un champ calculé des réponses de détail. `Shipment.loadId` reste la dénormalisation « leg courant », écrite dans la même transaction que la jonction.

**Tech stack:** NestJS + Prisma (PostgreSQL), SvelteKit (Svelte 5 runes), vitest (shared), jest (API), supertest (e2e). Branche : `phase-7-2`.

**Gate de typecheck :** entre la fin de la tâche 3 (schéma/migration) et la fin de la tâche 4 (sweep des renommages API), `pnpm typecheck` est **attendu rouge**. Vert obligatoire à la fin de la tâche 4 et de chaque tâche suivante.

---

## Carte des fichiers

| Fichier | Rôle |
| ------- | ---- |
| `packages/shared/src/planning/windows.ts` (+ tests) | `TimeWindow`, `validateWindowPair`, `windowViolations` |
| `packages/shared/src/planning/capacity.ts` (+ tests) | `CapacityAxes`, `CapacityExcess`, `checkCapacity` |
| `packages/shared/src/index.ts` | exports `planning/*` |
| `packages/database/prisma/schema.prisma` + migration | renommages `*Early`, ajout `*Late`, `Trailer.capacityPallets`, `ShipmentLoadLeg` + backfill |
| `transport-orders/dto` + service | paires requested/planned, validations 400, mapping plan/addShipment |
| `routes/dto` + service | fenêtre `plannedArrivalEarly/Late` par stop (+ validation), `plannedDepartureAt` inchangé |
| `rating/rating.service.ts` (+ spec) | `referenceDate` lit `plannedPickupEarly` |
| `customer-portal/portal.*` | paires requested en saisie + projection |
| `public/public-links.service.ts`, `tenders.service.ts` | projections publiques → nouvelles bornes |
| `analytics/analytics.service.ts` | on-time = `actual ≤ (plannedDeliveryLate ?? plannedDeliveryEarly)` |
| `planning/window-warnings.ts` (nouveau, API) | calcul `windowWarnings[]` pour détail ordre + load |
| `shipments.service.ts`, `loads.service.ts` + DTOs | capacité (400 `CapacityExcess[]` + `force`), jonction (mêmes transactions) |
| `apps/api/test/phase7-2-integrity.e2e-spec.ts` | suite e2e du chantier |
| Web : `transport-orders/*`, `portal`, `shipments`, `loads/[id]`, `track`, `tender`, `driver` | paires de dates, badges warnings, erreur capacité + « Forcer » |
| `TODO.md`, `ROADMAP.md`, `docs/etat-du-projet.md`, `docs/data-model.md`, `CLAUDE.md` | docs + hard rule 18 |

---

### Task 1 : `windowViolations` + `validateWindowPair` (shared, TDD)

**Files:**
- Create: `packages/shared/src/planning/windows.ts`
- Create: `packages/shared/src/planning/__tests__/windows.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1 : Tests (échec attendu)** — `packages/shared/src/planning/__tests__/windows.spec.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { validateWindowPair, windowViolations } from '../windows';

const d = (s: string) => new Date(s);

describe('validateWindowPair', () => {
  it('accepts early ≤ late and open bounds', () => {
    expect(validateWindowPair({ early: d('2026-07-01'), late: d('2026-07-02') })).toBeNull();
    expect(validateWindowPair({ early: d('2026-07-01'), late: null })).toBeNull();
    expect(validateWindowPair({ early: null, late: d('2026-07-02') })).toBeNull();
    expect(validateWindowPair({ early: null, late: null })).toBeNull();
  });

  it('rejects early > late', () => {
    expect(validateWindowPair({ early: d('2026-07-03'), late: d('2026-07-02') })).toMatch(/early/);
  });
});

describe('windowViolations — planned vs requested', () => {
  const requested = { early: d('2026-07-01T08:00Z'), late: d('2026-07-01T12:00Z') };

  it('no violation when planned inside the requested window', () => {
    expect(
      windowViolations('pickup', requested, { early: d('2026-07-01T09:00Z'), late: d('2026-07-01T11:00Z') }),
    ).toEqual([]);
  });

  it('flags planned starting before requested.early and ending after requested.late', () => {
    const violations = windowViolations('pickup', requested, {
      early: d('2026-07-01T06:00Z'),
      late: d('2026-07-01T14:00Z'),
    });
    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({
      field: 'pickup',
      kind: 'BEFORE_EARLY',
      requested: requested.early!.toISOString(),
      planned: d('2026-07-01T06:00Z').toISOString(),
    });
    expect(violations[1].kind).toBe('AFTER_LATE');
  });

  it('open requested bounds constrain nothing on that side', () => {
    expect(
      windowViolations('delivery', { early: null, late: d('2026-07-01T12:00Z') }, { early: d('2026-06-01T00:00Z'), late: d('2026-07-01T10:00Z') }),
    ).toEqual([]);
  });

  it('no violation when planned is entirely absent', () => {
    expect(windowViolations('pickup', requested, { early: null, late: null })).toEqual([]);
  });

  it('a single planned point (late null) is checked against both requested bounds', () => {
    expect(
      windowViolations('pickup', requested, { early: d('2026-07-01T13:00Z'), late: null }),
    ).toEqual([
      {
        field: 'pickup',
        kind: 'AFTER_LATE',
        requested: requested.late!.toISOString(),
        planned: d('2026-07-01T13:00Z').toISOString(),
      },
    ]);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm --filter @pulsar/shared test` → FAIL (module introuvable).

- [ ] **Step 3 : Implémenter** — `packages/shared/src/planning/windows.ts` :

```ts
/**
 * Time windows [early, late?]. Stored in UTC; the SEMANTIC of a bound is the local
 * time of the site involved (Location.timezone) — see the phase 7.2 spec, timezone §.
 */
export interface TimeWindow {
  early: Date | null;
  late: Date | null;
}

export type WindowViolationKind = 'BEFORE_EARLY' | 'AFTER_LATE';

export interface WindowViolation {
  /** Which window pair this is about (e.g. 'pickup', 'delivery'). */
  field: string;
  kind: WindowViolationKind;
  /** The requested bound that is crossed (ISO). */
  requested: string;
  /** The planned bound that crosses it (ISO). */
  planned: string;
}

/** Hard coherence check: early ≤ late when both exist. Returns an error message or null. */
export function validateWindowPair(window: TimeWindow): string | null {
  if (window.early && window.late && window.early.getTime() > window.late.getTime()) {
    return 'Window early bound must be ≤ late bound';
  }
  return null;
}

/**
 * Advisory comparison of a PLANNED window against the REQUESTED one (never blocking:
 * the customer asked, operations decide). Open bounds constrain nothing on their side.
 * The planned early is checked against requested.early; the latest planned bound
 * (late ?? early) against requested.late.
 */
export function windowViolations(
  field: string,
  requested: TimeWindow,
  planned: TimeWindow,
): WindowViolation[] {
  const violations: WindowViolation[] = [];
  if (requested.early && planned.early && planned.early.getTime() < requested.early.getTime()) {
    violations.push({
      field,
      kind: 'BEFORE_EARLY',
      requested: requested.early.toISOString(),
      planned: planned.early.toISOString(),
    });
  }
  const plannedLatest = planned.late ?? planned.early;
  if (requested.late && plannedLatest && plannedLatest.getTime() > requested.late.getTime()) {
    violations.push({
      field,
      kind: 'AFTER_LATE',
      requested: requested.late.toISOString(),
      planned: plannedLatest.toISOString(),
    });
  }
  return violations;
}
```

Dans `packages/shared/src/index.ts`, après `export * from './rating/lane-key';` :

```ts
export * from './planning/windows';
```

- [ ] **Step 4 : Vérifier** — `pnpm --filter @pulsar/shared test` → PASS ; `pnpm --filter @pulsar/shared build`.

- [ ] **Step 5 : Commit**

```bash
git add packages/shared/src/planning packages/shared/src/index.ts
git commit -m "feat(shared): time windows — pair validation + advisory planned-vs-requested violations"
```

---

### Task 2 : `checkCapacity` (shared, TDD)

**Files:**
- Create: `packages/shared/src/planning/capacity.ts`
- Create: `packages/shared/src/planning/__tests__/capacity.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1 : Tests (échec attendu)** — `packages/shared/src/planning/__tests__/capacity.spec.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { checkCapacity } from '../capacity';

describe('checkCapacity — 3 axes, unknown axes ignored', () => {
  const capacities = { weightKg: 1000, volumeM3: 50, pallets: 10 };

  it('returns [] when everything fits', () => {
    expect(checkCapacity(capacities, { weightKg: 900, volumeM3: 49.5, pallets: 10 })).toEqual([]);
  });

  it('exactly at capacity is NOT an excess (≤, not <)', () => {
    expect(checkCapacity(capacities, { weightKg: 1000, volumeM3: 50, pallets: 10 })).toEqual([]);
  });

  it('reports every exceeded axis with capacity/requested/excess', () => {
    const excesses = checkCapacity(capacities, { weightKg: 1200, volumeM3: 60, pallets: 12 });
    expect(excesses).toEqual([
      { axis: 'weightKg', capacity: 1000, requested: 1200, excess: 200 },
      { axis: 'volumeM3', capacity: 50, requested: 60, excess: 10 },
      { axis: 'pallets', capacity: 10, requested: 12, excess: 2 },
    ]);
  });

  it('an axis without a capacity OR without a computable total is ignored', () => {
    expect(checkCapacity({ weightKg: null, volumeM3: 50, pallets: null }, { weightKg: 99999, volumeM3: null, pallets: 99 })).toEqual([]);
  });

  it('fractional excess is rounded to 2 decimals', () => {
    expect(checkCapacity({ weightKg: 100, volumeM3: null, pallets: null }, { weightKg: 100.005, volumeM3: null, pallets: null })).toEqual([
      { axis: 'weightKg', capacity: 100, requested: 100.01, excess: 0.01 },
    ]);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm --filter @pulsar/shared test` → FAIL.

- [ ] **Step 3 : Implémenter** — `packages/shared/src/planning/capacity.ts` :

```ts
/** The three capacity axes of a trailer vs the totals of a load's shipments. */
export interface CapacityAxes {
  weightKg: number | null;
  volumeM3: number | null;
  pallets: number | null;
}

export type CapacityAxis = keyof CapacityAxes;

export interface CapacityExcess {
  axis: CapacityAxis;
  capacity: number;
  requested: number;
  excess: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Compares requested totals against capacities, axis by axis. An axis with no
 * capacity entered OR no computable total is IGNORED (we don't verify what we
 * don't know). Exactly-at-capacity is not an excess. Empty result = nothing to flag.
 */
export function checkCapacity(capacities: CapacityAxes, totals: CapacityAxes): CapacityExcess[] {
  const excesses: CapacityExcess[] = [];
  for (const axis of ['weightKg', 'volumeM3', 'pallets'] as CapacityAxis[]) {
    const capacity = capacities[axis];
    const requested = totals[axis];
    if (capacity == null || requested == null) continue;
    if (requested > capacity) {
      excesses.push({
        axis,
        capacity,
        requested: round2(requested),
        excess: round2(requested - capacity),
      });
    }
  }
  return excesses;
}
```

Dans `packages/shared/src/index.ts`, après l'export windows :

```ts
export * from './planning/capacity';
```

- [ ] **Step 4 : Vérifier + build** — `pnpm --filter @pulsar/shared test` → PASS ; `pnpm --filter @pulsar/shared build` ; `pnpm typecheck` → PASS.

- [ ] **Step 5 : Commit**

```bash
git add packages/shared/src/planning packages/shared/src/index.ts
git commit -m "feat(shared): 3-axis capacity check — unknown axes ignored, at-capacity ok, rounded excesses"
```

---

### Task 3 : Schéma Prisma + migration (⚠️ RENAME, jamais DROP)

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<ts>_phase7_2_plan_integrity/migration.sql`

> ⚠️⚠️ **PIÈGE CRITIQUE — lis ceci avant toute commande.** Quand Prisma diffe un
> renommage de colonne, il génère par défaut **`DROP COLUMN` + `ADD COLUMN` = perte de
> données silencieuse** sur toutes les dates existantes. La procédure OBLIGATOIRE :
> (1) générer la migration en `--create-only` (ou l'écrire à la main comme en 7.1 si
> Prisma refuse le mode non-interactif) ; (2) **éditer le SQL** pour remplacer chaque
> paire drop/add par `ALTER TABLE ... RENAME COLUMN ancienne TO nouvelle` ; (3) vérifier
> le fichier : **la migration ne doit contenir AUCUN `DROP COLUMN` sur
> `requestedPickupDate`, `requestedDeliveryDate`, `plannedPickupAt`, `plannedDeliveryAt`,
> `plannedArrivalAt`** (commande de contrôle au Step 4) ; (4) seulement ensuite,
> appliquer ; (5) vérifier la non-perte sur la base seedée (Step 6).

- [ ] **Step 1 : Éditer le schéma**

`model TransportOrder` — remplacer :
```prisma
  requestedPickupDate   DateTime?
  requestedDeliveryDate DateTime?
```
par :
```prisma
  requestedPickupEarly   DateTime?
  requestedPickupLate    DateTime?
  requestedDeliveryEarly DateTime?
  requestedDeliveryLate  DateTime?
```

`model Shipment` — remplacer `plannedPickupAt`/`plannedDeliveryAt` par :
```prisma
  plannedPickupEarly    DateTime?
  plannedPickupLate     DateTime?
  plannedDeliveryEarly  DateTime?
  plannedDeliveryLate   DateTime?
```
et ajouter la relation `legs ShipmentLoadLeg[]`.

`model Stop` — remplacer `plannedArrivalAt DateTime?` par :
```prisma
  plannedArrivalEarly DateTime?
  plannedArrivalLate  DateTime?
```
(`plannedDepartureAt` reste inchangé — la spec ne fenêtre que l'arrivée.)

`model Trailer` — après `capacityVolumeM3 Float?` :
```prisma
  capacityPallets  Int?
```

`model Load` — ajouter la relation `legs ShipmentLoadLeg[]`.

Nouvelle table (après `model Load`) :
```prisma
// Junction shipment×load×sequence — unlocks future multi-leg (audit §3). In v1
// (single-leg) it mirrors Shipment.loadId, written in the SAME transaction: never
// divergent. loadId stays as the "current leg" denormalization for existing readers.
model ShipmentLoadLeg {
  id         String   @id @default(cuid())
  tenantId   String
  shipmentId String
  loadId     String
  sequence   Int      @default(1)
  createdAt  DateTime @default(now())

  tenant   Tenant   @relation(fields: [tenantId], references: [id])
  shipment Shipment @relation(fields: [shipmentId], references: [id], onDelete: Restrict)
  load     Load     @relation(fields: [loadId], references: [id], onDelete: Restrict)

  @@unique([shipmentId, sequence])
  @@unique([shipmentId, loadId])
  @@index([tenantId])
  @@index([loadId])
  @@map("shipment_load_legs")
}
```
(+ relation `shipmentLoadLegs ShipmentLoadLeg[]` sur `Tenant`.)

- [ ] **Step 2 : Valider** — `pnpm --filter @pulsar/database exec prisma validate` → valid.

- [ ] **Step 3 : Générer puis ÉDITER la migration**

`pnpm --filter @pulsar/database exec dotenv -e ../../.env -- prisma migrate dev --create-only --name phase7_2_plan_integrity` (si Prisma refuse en non-interactif, écrire le SQL à la main comme la migration 7.1).

Dans le SQL généré, REMPLACER chaque paire drop/add de colonnes de dates par :

```sql
-- Time windows: RENAME (never drop/add — existing dates become the early bound).
ALTER TABLE "transport_orders" RENAME COLUMN "requestedPickupDate" TO "requestedPickupEarly";
ALTER TABLE "transport_orders" RENAME COLUMN "requestedDeliveryDate" TO "requestedDeliveryEarly";
ALTER TABLE "transport_orders" ADD COLUMN "requestedPickupLate" TIMESTAMP(3);
ALTER TABLE "transport_orders" ADD COLUMN "requestedDeliveryLate" TIMESTAMP(3);

ALTER TABLE "shipments" RENAME COLUMN "plannedPickupAt" TO "plannedPickupEarly";
ALTER TABLE "shipments" RENAME COLUMN "plannedDeliveryAt" TO "plannedDeliveryEarly";
ALTER TABLE "shipments" ADD COLUMN "plannedPickupLate" TIMESTAMP(3);
ALTER TABLE "shipments" ADD COLUMN "plannedDeliveryLate" TIMESTAMP(3);

ALTER TABLE "stops" RENAME COLUMN "plannedArrivalAt" TO "plannedArrivalEarly";
ALTER TABLE "stops" ADD COLUMN "plannedArrivalLate" TIMESTAMP(3);

ALTER TABLE "trailers" ADD COLUMN "capacityPallets" INTEGER;
```

Conserver tel quel le `CREATE TABLE "shipment_load_legs"` généré (+ ses uniques/index/FKs `ON DELETE RESTRICT`), et ajouter le **backfill** APRÈS le CREATE TABLE :

```sql
-- Backfill: one sequence-1 leg per currently assigned shipment.
INSERT INTO "shipment_load_legs" ("id", "tenantId", "shipmentId", "loadId", "sequence", "createdAt")
SELECT 'leg_' || md5(s."id" || ':' || s."loadId"), s."tenantId", s."id", s."loadId", 1, CURRENT_TIMESTAMP
FROM "shipments" s
WHERE s."loadId" IS NOT NULL;
```

- [ ] **Step 4 : CONTRÔLE ANTI-PERTE (obligatoire avant d'appliquer)**

```powershell
Select-String -Path "packages\database\prisma\migrations\*phase7_2*\migration.sql" -Pattern 'DROP COLUMN.*(requestedPickup|requestedDelivery|plannedPickup|plannedDelivery|plannedArrival)'
```
Expected : **AUCUN résultat**. S'il y en a un, NE PAS APPLIQUER — corriger le SQL d'abord.

- [ ] **Step 5 : Appliquer + drift check**

`pnpm --filter @pulsar/database exec dotenv -e ../../.env -- prisma migrate dev` (ou `migrate deploy` si écrite à la main) → applique sans erreur.
Drift : `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <pulsar_shadow> --exit-code` → exit 0.
Puis `pnpm --filter @pulsar/database build`.

- [ ] **Step 6 : VÉRIFICATION DE NON-PERTE sur la base seedée**

Script temporaire `packages/database/check-rename.mjs` :
```js
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const order = await p.transportOrder.findFirst({ where: { requestedPickupEarly: { not: null } } });
const legs = await p.shipmentLoadLeg.count();
const assigned = await p.shipment.count({ where: { loadId: { not: null } } });
console.log({ orderWithDate: !!order, legs, assigned, legsMatchAssigned: legs === assigned });
await p.$disconnect();
```
Run avec dotenv ; Expected : `orderWithDate: true` (la date du seed a survécu au renommage) et `legsMatchAssigned: true` (backfill complet). SUPPRIMER le script avant commit.

- [ ] **Step 7 : Commit (typecheck rouge attendu — gate)**

```bash
git add packages/database/prisma
git commit -m "feat(db): time-window columns (RENAME, no data loss), trailer pallet capacity, shipment_load_legs junction with backfill"
```

---

### Task 4 : Sweep API des fenêtres (referme le typecheck)

**Files (tous Modify):**
- `transport-orders/dto/transport-order.dto.ts`, `transport-orders.service.ts`
- `routes/dto/route.dto.ts`, `routes.service.ts`
- `rating/rating.service.ts`, `rating/rating.service.spec.ts`
- `customer-portal/portal.service.ts`, `portal.controller.ts`
- `public/public-links.service.ts`, `tenders/tenders.service.ts`
- `analytics/analytics.service.ts`

- [ ] **Step 1 : DTO transport-orders**

Dans `CreateTransportOrderDto`, remplacer `requestedPickupDate`/`requestedDeliveryDate` par quatre champs `@IsOptional() @IsDateString()` : `requestedPickupEarly`, `requestedPickupLate`, `requestedDeliveryEarly`, `requestedDeliveryLate`. Dans `ShipmentSplitDto`, remplacer `plannedPickupAt`/`plannedDeliveryAt` par `plannedPickupEarly`, `plannedPickupLate`, `plannedDeliveryEarly`, `plannedDeliveryLate` (mêmes décorateurs).

- [ ] **Step 2 : Service transport-orders — mapping + validations**

Ajouter en haut du service (import `validateWindowPair` depuis `@pulsar/shared`) :

```ts
const toDate = (value?: string | null): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(value);

/** 400 on incoherent windows: early ≤ late per pair, pickupEarly ≤ deliveryLate. */
function assertWindowCoherence(windows: {
  pickupEarly?: Date | null;
  pickupLate?: Date | null;
  deliveryEarly?: Date | null;
  deliveryLate?: Date | null;
}) {
  const pickupError = validateWindowPair({ early: windows.pickupEarly ?? null, late: windows.pickupLate ?? null });
  if (pickupError) throw new BadRequestException(`Pickup window: ${pickupError}`);
  const deliveryError = validateWindowPair({ early: windows.deliveryEarly ?? null, late: windows.deliveryLate ?? null });
  if (deliveryError) throw new BadRequestException(`Delivery window: ${deliveryError}`);
  if (
    windows.pickupEarly &&
    windows.deliveryLate &&
    windows.pickupEarly.getTime() > windows.deliveryLate.getTime()
  ) {
    throw new BadRequestException('Pickup window must start before the delivery window ends');
  }
  // Deliberately NOT validating pickupLate ≤ deliveryEarly: overlapping windows are legitimate.
}
```

`create()` : construire les 4 dates avec `toDate`, appeler `assertWindowCoherence({ pickupEarly, pickupLate, deliveryEarly, deliveryLate })`, et écrire les 4 colonnes (remplace l'ancien mapping 2 champs). `update()` : idem en fusionnant avec l'existant (`dto.x !== undefined ? toDate(dto.x) : order.x` pour chacune des 4 bornes AVANT la validation — on valide l'état résultant, pas le delta). `plan()` et `addShipment()` : les splits écrivent `plannedPickupEarly: split.plannedPickupEarly ? new Date(...) : order.requestedPickupEarly`, `plannedPickupLate: split.plannedPickupLate ? new Date(...) : order.requestedPickupLate` (idem delivery — le défaut hérite de la FENÊTRE demandée complète), avec `assertWindowCoherence` sur chaque split résolu.

- [ ] **Step 3 : Routes — fenêtre d'arrivée par stop**

`StopInputDto` : remplacer `plannedArrivalAt` par `plannedArrivalEarly` + `plannedArrivalLate` (`@IsOptional() @IsDateString()` chacun ; `plannedDepartureAt` inchangé). `routes.service.createForLoad` : mapper les deux bornes (`new Date(...)`/undefined) et valider par stop :

```ts
      const arrivalError = validateWindowPair({
        early: s.plannedArrivalEarly ? new Date(s.plannedArrivalEarly) : null,
        late: s.plannedArrivalLate ? new Date(s.plannedArrivalLate) : null,
      });
      if (arrivalError) {
        throw new BadRequestException(`Stop ${s.sequence} arrival window: ${arrivalError}`);
      }
```

- [ ] **Step 4 : Rating — date de référence**

Dans `rating.service.ts` : les 3 occurrences de `plannedPickupAt` deviennent `plannedPickupEarly` (interface `LoadForRating`, `referenceDate()`, le select de `loadForRating`). Dans `rating.service.spec.ts` : renommer le champ dans les fixtures. La sémantique reste « premier pickup planifié ».

- [ ] **Step 5 : Portail, projections publiques, tenders, analytics**

- `portal.controller.ts` + `portal.service.ts` : l'interface/le mapping de création passent aux 4 champs requested (mêmes noms que le DTO interne) ; la projection `select` du portail expose les 4 bornes.
- `public-links.service.ts` : projections — `plannedPickupEarly/Late`, `plannedDeliveryEarly/Late` (l.49-50), `plannedArrivalEarly/Late` (l.107). Les payloads publics gagnent les bornes, jamais de `tenantId` (règle 10 inchangée).
- `tenders.service.ts` l.245 : `plannedArrivalAt: true` → `plannedArrivalEarly: true, plannedArrivalLate: true`.
- `analytics.service.ts` : le on-time devient `actualDeliveryAt ≤ (plannedDeliveryLate ?? plannedDeliveryEarly)` — `measurable` = shipments avec au moins une borne delivery ; adapter le select (deux colonnes) et le commentaire (« on or before the latest known planned bound »).

- [ ] **Step 6 : Vérifier le gate refermé**

`pnpm typecheck` → PASS (plus aucune référence aux anciennes colonnes). `pnpm test` → PASS (spec rating renommée incluse). `pnpm test:e2e` → **échecs attendus** sur les suites qui envoient les anciens champs (phase5 portail, etc.) — NE PAS les corriger ici, c'est la tâche 9 ; lister les suites rouges dans le rapport.

- [ ] **Step 7 : Commit**

```bash
git add apps/api/src
git commit -m "feat(api): time-window pairs across orders, splits, stops, portal, public payloads; rating reference uses plannedPickupEarly; on-time uses latest bound"
```

---

### Task 5 : `windowWarnings` calculés (détail ordre + détail load)

**Files:**
- Create: `apps/api/src/modules/transportation/planning/window-warnings.ts`
- Modify: `transport-orders.service.ts` (get), `loads/loads.service.ts` (get)

- [ ] **Step 1 : Helper** — `apps/api/src/modules/transportation/planning/window-warnings.ts` :

```ts
import { WindowViolation, windowViolations } from '@pulsar/shared';

interface RequestedWindows {
  requestedPickupEarly: Date | null;
  requestedPickupLate: Date | null;
  requestedDeliveryEarly: Date | null;
  requestedDeliveryLate: Date | null;
}

interface PlannedShipmentWindows {
  shipmentNumber: string;
  plannedPickupEarly: Date | null;
  plannedPickupLate: Date | null;
  plannedDeliveryEarly: Date | null;
  plannedDeliveryLate: Date | null;
}

export interface ShipmentWindowWarning extends WindowViolation {
  shipmentNumber: string;
}

/** Advisory: planned shipment windows vs the order's requested windows. Never blocking. */
export function shipmentWindowWarnings(
  order: RequestedWindows,
  shipments: PlannedShipmentWindows[],
): ShipmentWindowWarning[] {
  return shipments.flatMap((s) => [
    ...windowViolations(
      'pickup',
      { early: order.requestedPickupEarly, late: order.requestedPickupLate },
      { early: s.plannedPickupEarly, late: s.plannedPickupLate },
    ),
    ...windowViolations(
      'delivery',
      { early: order.requestedDeliveryEarly, late: order.requestedDeliveryLate },
      { early: s.plannedDeliveryEarly, late: s.plannedDeliveryLate },
    ),
  ].map((v) => ({ ...v, shipmentNumber: s.shipmentNumber })));
}
```

- [ ] **Step 2 : Brancher dans les détails**

`transport-orders.service.get()` : enrichir le `select` des shipments de l'include avec les 4 bornes planifiées + `shipmentNumber`, et retourner `{ ...order, windowWarnings: shipmentWindowWarnings(order, order.shipments) }`. `loads.service.get()` : le `loadInclude` des shipments gagne les 4 bornes + leur `transportOrder` (4 bornes requested) ; retourner `{ ...load, windowWarnings }` en agrégeant `shipmentWindowWarnings(s.transportOrder, [s])` par shipment. (Les stops héritent des fenêtres shipment — la comparaison stop-vs-demandé passe par le shipment ; pas de double signal.)

- [ ] **Step 3 : Vérifier + commit** — `pnpm typecheck && pnpm test` → PASS.

```bash
git add apps/api/src/modules/transportation
git commit -m "feat(api): advisory windowWarnings on order and load detail responses"
```

---

### Task 6 : Capacité 3 axes aux points d'assignation (+ force audité)

**Files:**
- Modify: `shipments/shipments.controller.ts` (DTO AssignLoadDto + force), `shipments/shipments.service.ts`
- Modify: `loads/dto/load.dto.ts` (AssignLoadResourcesDto + force), `loads/loads.service.ts`

- [ ] **Step 1 : DTOs** — `AssignLoadDto` (dans shipments.controller.ts) et `AssignLoadResourcesDto` gagnent :

```ts
  /** Bypasses the capacity check; the override is written to the audit log. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
```

- [ ] **Step 2 : Helper de totaux + contrôle dans `shipments.service.assignToLoad`**

Le service injecte déjà prisma/cost ; ajouter `AuditLogsService` (module: déjà exporté par AuditLogsModule importé dans TransportationModule — vérifier le constructeur des autres services). Signature : `assignToLoad(tenantId, userId, id, dto: { loadId; force? })` (le controller passe `user.id` — l'aligner). Avant l'update :

```ts
    const trailer = load.trailerId
      ? await this.prisma.trailer.findFirst({
          where: { id: load.trailerId, tenantId },
          select: { capacityWeightKg: true, capacityVolumeM3: true, capacityPallets: true },
        })
      : null;
    if (trailer) {
      const siblings = await this.prisma.shipment.findMany({
        where: { loadId, tenantId },
        select: { weightKg: true, volumeM3: true, palletCount: true },
      });
      const all = [...siblings, { weightKg: shipment.weightKg, volumeM3: shipment.volumeM3, palletCount: shipment.palletCount }];
      const sum = (values: (number | null)[]) =>
        values.some((v) => v !== null) ? values.reduce<number>((acc, v) => acc + (v ?? 0), 0) : null;
      const excesses = checkCapacity(
        { weightKg: trailer.capacityWeightKg, volumeM3: trailer.capacityVolumeM3, pallets: trailer.capacityPallets },
        { weightKg: sum(all.map((s) => s.weightKg)), volumeM3: sum(all.map((s) => s.volumeM3)), pallets: sum(all.map((s) => s.palletCount)) },
      );
      if (excesses.length > 0 && !dto.force) {
        throw new BadRequestException({
          message: 'Trailer capacity exceeded',
          excesses,
        });
      }
      if (excesses.length > 0 && dto.force) {
        await this.audit.log({
          tenantId,
          userId,
          action: AuditAction.UPDATE,
          entityType: 'load',
          entityId: loadId,
          after: { capacityOverride: true, excesses, shipmentId: id },
        });
      }
    }
```

(Le corps du 400 transporte `excesses: CapacityExcess[]` tel quel — le front l'affiche sans transformation.)

- [ ] **Step 3 : Contrôle au changement de trailer — `loads.service.assignResources`**

Quand `dto.trailerId` est fourni : charger les capacités du nouveau trailer + les totaux des shipments du load (même `sum`), appeler `checkCapacity` ; même 400 `{ message, excesses }` sans `force`, même entrée d'audit `capacityOverride` avec `force` (entityId = load, `after: { capacityOverride: true, excesses, trailerId }`). Le `force` ne doit PAS être épandu dans l'update Prisma : destructurer `const { force, ...resources } = dto;` et utiliser `resources`.

- [ ] **Step 4 : Vérifier + commit** — `pnpm typecheck && pnpm test` → PASS.

```bash
git add apps/api/src/modules/transportation/shipments apps/api/src/modules/transportation/loads
git commit -m "feat(api): 3-axis capacity check on shipment assignment and trailer change — blocking with audited force override"
```

---

### Task 7 : Jonction `ShipmentLoadLeg` (mêmes transactions que loadId)

**Files:**
- Modify: `shipments/shipments.service.ts` (assignToLoad, removeFromLoad)
- Modify: `loads/loads.service.ts` (cancel)

- [ ] **Step 1 : assignToLoad** — remplacer le `shipment.update` simple par une transaction :

```ts
    const [updated] = await this.prisma.$transaction([
      this.prisma.shipment.update({
        where: { id },
        data: { loadId, status: ShipmentStatus.PLANNED },
        include: shipmentInclude,
      }),
      // Junction mirrors the denormalized loadId in the SAME transaction (spec invariant).
      this.prisma.shipmentLoadLeg.upsert({
        where: { shipmentId_sequence: { shipmentId: id, sequence: 1 } },
        update: { loadId },
        create: { tenantId, shipmentId: id, loadId, sequence: 1 },
      }),
    ]);
```

- [ ] **Step 2 : removeFromLoad** — transaction `shipment.update({ loadId: null, status: PENDING })` + `shipmentLoadLeg.deleteMany({ where: { shipmentId: id } })`.

- [ ] **Step 3 : loads.cancel** — dans la transaction existante (load CANCELLED + shipments rendus au pool + tenders), ajouter `this.prisma.shipmentLoadLeg.deleteMany({ where: { loadId: id } })`.

- [ ] **Step 4 : Vérifier + commit** — `pnpm typecheck && pnpm test` → PASS.

```bash
git add apps/api/src/modules/transportation
git commit -m "feat(api): shipment_load_legs junction maintained in the same transactions as Shipment.loadId"
```

---

### Task 8 : Seed (fenêtres + capacité palettes)

**Files:**
- Modify: `packages/database/prisma/seed.ts`

- [ ] **Step 1 :** Ligne ~363 : `requestedPickupDate:` → `requestedPickupEarly:` (même valeur) et ajouter dessous `requestedPickupLate: new Date(Date.now() + 3 * 24 * 3600 * 1000),` (fenêtre J+2 → J+3). Ligne ~214 (trailer) : ajouter `capacityPallets: 26,` après `capacityWeightKg`.
- [ ] **Step 2 :** `pnpm db:seed` deux fois → vert, idempotent.
- [ ] **Step 3 : Commit**

```bash
git add packages/database/prisma/seed.ts
git commit -m "feat(db): seed uses a requested pickup window and trailer pallet capacity"
```

---

### Task 9 : E2E — suite phase 7.2 + migration des suites existantes

**Files:**
- Create: `apps/api/test/phase7-2-integrity.e2e-spec.ts`
- Modify: toutes les suites e2e qui envoient les anciens champs (recensées en tâche 4 — au minimum `phase5.e2e-spec.ts` (portail, `requestedPickupDate`) ; vérifier `collaboration`, `phase3`, `phase4`, `tender-automation`, `phase7-rating` pour `plannedArrivalAt`/`plannedPickupAt`)

- [ ] **Step 1 : Migrer les suites existantes** — grep des anciens noms dans `apps/api/test/`, remplacement par la borne `Early` correspondante (comportement identique). Ne JAMAIS adapter l'API au test.

- [ ] **Step 2 : Écrire la nouvelle suite** — `apps/api/test/phase7-2-integrity.e2e-spec.ts` (squelette identique aux suites existantes : login seedé, suffixe unique, master data propre) :

```ts
/**
 * E2E for phase 7.2: time windows (coherence 400s + advisory warnings), 3-axis
 * capacity check with audited force override, shipment_load_legs junction invariant.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 7.2 plan integrity (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P72${Date.now().toString(36).toUpperCase()}`;
  const ids = {
    customer: '', origin: '', destination: '', carrier: '',
    trailer: '', order: '', shipment: '', load: '',
  };
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    http = app.getHttpServer();

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;

    const customer = await request(http).post('/api/v1/transportation/customers').set(auth())
      .send({ code: `${suffix}-CUST`, name: 'P72 Customer' }).expect(201);
    ids.customer = customer.body.id;
    for (const [field, code, type] of [
      ['origin', `${suffix}-ORI`, 'PLANT'],
      ['destination', `${suffix}-DST`, 'WAREHOUSE'],
    ] as const) {
      const location = await request(http).post('/api/v1/transportation/locations').set(auth())
        .send({ code, name: code, type, addressLine1: '1 Test', city: 'Sherbrooke' }).expect(201);
      ids[field] = location.body.id;
    }
    const carrier = await request(http).post('/api/v1/transportation/carriers').set(auth())
      .send({ code: `${suffix}-CARR`, name: 'P72 Carrier' }).expect(201);
    ids.carrier = carrier.body.id;
    const trailer = await request(http).post('/api/v1/transportation/trailers').set(auth())
      .send({ unitNumber: `${suffix}-TRL`, capacityWeightKg: 1000, capacityPallets: 4 }).expect(201);
    ids.trailer = trailer.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('NON-LOSS: the seeded demo order kept its date through the column rename', async () => {
    const res = await request(http)
      .get('/api/v1/transportation/transport-orders?pageSize=100').set(auth()).expect(200);
    const withWindow = res.body.items.filter((o: { requestedPickupEarly: string | null }) => o.requestedPickupEarly);
    expect(withWindow.length).toBeGreaterThan(0);
  });

  it('rejects an incoherent window (early > late) with 400', async () => {
    await request(http).post('/api/v1/transportation/transport-orders').set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        requestedPickupEarly: '2026-08-02T00:00:00.000Z',
        requestedPickupLate: '2026-08-01T00:00:00.000Z',
      })
      .expect(400);
  });

  it('creates an order with windows; planning outside them produces advisory warnings, not a block', async () => {
    const order = await request(http).post('/api/v1/transportation/transport-orders').set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
        totalWeightKg: 600,
        palletCount: 3,
        requestedPickupEarly: '2026-08-01T08:00:00.000Z',
        requestedPickupLate: '2026-08-01T12:00:00.000Z',
        requestedDeliveryEarly: '2026-08-02T08:00:00.000Z',
        requestedDeliveryLate: '2026-08-02T17:00:00.000Z',
      })
      .expect(201);
    ids.order = order.body.id;
    await request(http).post(`/api/v1/transportation/transport-orders/${ids.order}/confirm`).set(auth()).expect(201);

    // Plan with a pickup planned AFTER the requested late bound → 201 + warning.
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${ids.order}/plan`).set(auth())
      .send({
        shipments: [
          { weightKg: 600, palletCount: 3, plannedPickupEarly: '2026-08-01T14:00:00.000Z' },
        ],
      })
      .expect(201);
    ids.shipment = planned.body.shipments[0].id;

    const detail = await request(http)
      .get(`/api/v1/transportation/transport-orders/${ids.order}`).set(auth()).expect(200);
    expect(detail.body.windowWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'pickup', kind: 'AFTER_LATE' }),
      ]),
    );
  });

  it('capacity: assignment exceeding the trailer is rejected with the per-axis detail', async () => {
    const load = await request(http).post('/api/v1/transportation/loads').set(auth()).send({}).expect(201);
    ids.load = load.body.id;
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/assign`).set(auth())
      .send({ carrierId: ids.carrier, trailerId: ids.trailer }).expect(201);

    // 600 kg fits 1000 kg, but 3 pallets fit 4 — push it over with a second heavy order.
    const res = await request(http)
      .post(`/api/v1/transportation/shipments/${ids.shipment}/assign-load`).set(auth())
      .send({ loadId: ids.load })
      .expect(201); // 600 kg / 3 pallets fits

    // Second shipment that busts both weight and pallets.
    const order2 = await request(http).post('/api/v1/transportation/transport-orders').set(auth())
      .send({
        customerId: ids.customer, originLocationId: ids.origin, destinationLocationId: ids.destination,
        totalWeightKg: 700, palletCount: 3,
      }).expect(201);
    await request(http).post(`/api/v1/transportation/transport-orders/${order2.body.id}/confirm`).set(auth()).expect(201);
    const planned2 = await request(http)
      .post(`/api/v1/transportation/transport-orders/${order2.body.id}/plan`).set(auth()).expect(201);
    const shipment2 = planned2.body.shipments[0].id;

    const rejected = await request(http)
      .post(`/api/v1/transportation/shipments/${shipment2}/assign-load`).set(auth())
      .send({ loadId: ids.load })
      .expect(400);
    expect(rejected.body.excesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ axis: 'weightKg', capacity: 1000, requested: 1300, excess: 300 }),
        expect.objectContaining({ axis: 'pallets', capacity: 4, requested: 6, excess: 2 }),
      ]),
    );

    // force: true passes, and the override is audited.
    await request(http)
      .post(`/api/v1/transportation/shipments/${shipment2}/assign-load`).set(auth())
      .send({ loadId: ids.load, force: true })
      .expect(201);
    const audit = await request(http)
      .get(`/api/v1/audit-logs?entityType=load&entityId=${ids.load}`).set(auth()).expect(200);
    const flat = JSON.stringify(audit.body);
    expect(flat).toContain('capacityOverride');

    // Junction invariant: every assigned shipment of this load has exactly one leg.
    // (Indirect check via remove-load below — the API has no legs endpoint by design.)
    await request(http)
      .post(`/api/v1/transportation/shipments/${shipment2}/remove-load`).set(auth()).expect(201);
    const detail = await request(http).get(`/api/v1/transportation/loads/${ids.load}`).set(auth()).expect(200);
    expect(detail.body.shipments).toHaveLength(1);
  });

  it('changing to a smaller trailer is rejected, force passes', async () => {
    const small = await request(http).post('/api/v1/transportation/trailers').set(auth())
      .send({ unitNumber: `${suffix}-SML`, capacityWeightKg: 100 }).expect(201);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/assign`).set(auth())
      .send({ trailerId: small.body.id }).expect(400);
    await request(http).post(`/api/v1/transportation/loads/${ids.load}/assign`).set(auth())
      .send({ trailerId: small.body.id, force: true }).expect(201);
  });
});
```

> Adapter les statuts/chemins observés (ex. l'endpoint d'audit-logs : vérifier sa route
> et ses query params réels avant d'écrire l'assertion ; si la lecture des audits est
> trop indirecte, vérifier l'override via la base — mais préférer l'API). Si la création
> de trailer exige d'autres champs, les ajouter.

- [ ] **Step 3 : Lancer tout** — `pnpm test:e2e` → TOUTES les suites vertes (les anciennes migrées + la nouvelle + non-régression `phase7-rating`).

- [ ] **Step 4 : Commit**

```bash
git add apps/api/test
git commit -m "test(e2e): phase 7.2 — window coherence + warnings, capacity with audited force, junction; legacy suites migrated to window pairs"
```

---

### Task 10 : Web — formulaires et affichages des fenêtres

**Files:**
- Modify: `apps/web/src/routes/(app)/transport-orders/+page.svelte` (form création : 4 inputs date — pickup early/late, delivery early/late ; colonne liste affiche `early` comme avant)
- Modify: `apps/web/src/routes/(app)/transport-orders/[id]/+page.svelte` (affichage des 4 bornes ; badge `windowWarnings` — liste `field/kind` lisible, ex. « pickup planifié après la fenêtre demandée »)
- Modify: `apps/web/src/routes/portal/[token]/+page.svelte` (saisie : 4 inputs date ; affichage fenêtres)
- Modify: `apps/web/src/routes/(app)/shipments/+page.svelte`, `track/[token]`, `tender/[token]`, `driver/[token]` (affichage : `early` + « → late » quand présent)

- [ ] **Step 1 :** Pour chaque page : renommer les champs d'interface TS vers les paires, adapter les bindings/formats. Pattern d'affichage compact réutilisable inline : `fmtWindow(early, late)` = `early ? fmt(early) + (late ? ' → ' + fmt(late) : '') : '—'` (fonction locale par page, cohérente avec les `fmt` existants).
- [ ] **Step 2 :** `pnpm typecheck && pnpm build` → PASS.
- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/routes
git commit -m "feat(web): time-window pairs in order/portal forms and all window displays; windowWarnings badge on order detail"
```

---

### Task 11 : Web — éditeur de route (fenêtres) + erreur capacité avec « Forcer »

**Files:**
- Modify: `apps/web/src/routes/(app)/loads/[id]/+page.svelte` (éditeur de stops : `plannedArrivalAt` → deux `datetime-local` early/late ; badge `windowWarnings` du load ; le formulaire resources (trailer) gère le 400 capacité)
- Modify: `apps/web/src/routes/(app)/shipments/+page.svelte` (flux « assign to load » : afficher le 400 capacité par axe + case « Force assignment » qui renvoie `force: true`)

- [ ] **Step 1 :** Éditeur de route : l'état local des stops porte `plannedArrivalEarly`/`plannedArrivalLate` (le `toLocalInput`/`toISOString` existant s'applique aux deux bornes) ; envoi des deux champs dans le POST routes.
- [ ] **Step 2 :** Gestion du 400 capacité — les deux flux (assign-load côté shipments, assign trailer côté load detail) :

```ts
  // L'ApiError du client expose le corps du 400 ; vérifier la forme réelle de
  // l'erreur dans $lib/api/client (message vs body). Le corps contient
  // { message: 'Trailer capacity exceeded', excesses: [{ axis, capacity, requested, excess }] }.
  // Afficher un tableau : axe / capacité / demandé / excès, puis une case à cocher
  // « Force assignment (audited) » qui ré-émet la même requête avec force: true.
```

(Si `ApiError` ne porte pas le corps structuré, l'étendre dans `$lib/api/client.ts` pour exposer `body` — modification minimale, vérifier les usages existants.)

- [ ] **Step 3 :** `pnpm typecheck && pnpm build` → PASS.
- [ ] **Step 4 : Commit**

```bash
git add apps/web/src
git commit -m "feat(web): stop arrival windows in route editor; capacity 400 surfaced per-axis with audited force option"
```

---

### Task 12 : Docs + hard rule 18 + vérification finale

**Files:**
- Modify: `TODO.md`, `ROADMAP.md`, `docs/etat-du-projet.md`, `docs/data-model.md`, `CLAUDE.md`

- [ ] **Step 1 :** TODO.md : cocher le chantier 7.2 (détail des 3 volets) ; ROADMAP.md : ✅ 7.2 ; etat-du-projet.md : ligne 7.2 au tableau, chiffres à jour (compter les tests réels), prochaine session → 7.3 (Billing sell-side, débloqué par le rating v2).
- [ ] **Step 2 :** data-model.md : section fenêtres (sémantique `[early, late?]`, fuseau = heure locale du site, stockage UTC), capacité (3 axes, axes inconnus ignorés), `ShipmentLoadLeg` (invariant même-transaction, multi-leg futur). **Écrire depuis le code livré, pas de mémoire** (leçon de la 7.1).
- [ ] **Step 3 :** CLAUDE.md, bloc « Hard rules (continued, phase 7) », après la règle 17 :

```markdown
18. Tout endpoint qui modifie poids/volume/palettes d'un shipment ASSIGNÉ à un load doit
    re-déclencher `checkCapacity` sur ce load (niveau warning) ; et toute écriture de
    `Shipment.loadId` doit maintenir `shipment_load_legs` dans la même transaction.
```

- [ ] **Step 4 : Vérification finale** — `pnpm typecheck && pnpm build && pnpm test && pnpm test:e2e` → tout vert. Si échec : BLOCKED, ne pas « réparer » dans cette tâche.
- [ ] **Step 5 : Commit**

```bash
git add TODO.md ROADMAP.md docs/etat-du-projet.md docs/data-model.md CLAUDE.md
git commit -m "docs: phase 7.2 plan integrity shipped — windows, capacity, junction; hard rule 18"
```
