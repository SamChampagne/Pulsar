# Data model

Schema source: `packages/database/prisma/schema.prisma`. All tenant-scoped tables carry
`tenantId` (+ index). Status enums mirror `packages/shared/src/enums`.

## Platform core

```
Tenant ─┬─ User ─── UserRole ─── Role ─── RolePermission ─── Permission (global catalog)
        ├─ AuditLog            (action, entityType/Id, before/after JSON)
        ├─ Document            (metadata; binary storage by storageKey — phase 2)
        ├─ Notification        (in-app, per user)
        ├─ Integration         (per-tenant connector config)
        └─ TenantModule ─── ModuleDefinition (global module catalog)
```

- `Permission` and `ModuleDefinition` are **platform-wide catalogs**, seeded from
  `packages/shared`. Roles are tenant-scoped and reference catalog permissions.
- `TenantModule.enabled` is what `ModulesGuard` checks — the heart of per-tenant modularity.

## Transportation

### Master data

| Entity     | Notes                                                              |
| ---------- | ------------------------------------------------------------------ |
| `Customer` | The shipper's client. Unique `code` per tenant.                    |
| `Location` | Plants, warehouses, DCs, customer sites. Optional `customerId`.    |
| `Carrier`  | SCAC/MC/DOT identifiers, contact info.                             |
| `Driver`   | `carrierId` nullable → internal fleet driver.                      |
| `Vehicle`  | Tractor/straight truck/van; unique `unitNumber` per tenant.        |
| `Trailer`  | Dry van/reefer/flatbed/tanker; capacity fields.                    |
| `Rate`     | Buy-side (carrier) or sell-side (customer) pricing; FLAT/PER_KM/…  |

### Operational chain

```
TransportOrder (demand)            "what the customer asked us to move"
   │ 1..N  (v0: exactly 1, splitting is phase 2)
   ▼
Shipment (planning unit)           "a movable unit of freight"
   │ N..1
   ▼
Load (carrier execution)           "what a truck actually carries"
   │ 1..1
   ▼
Route ── Stop (sequence, PICKUP/DELIVERY, planned/actual times)
   │
   ├─ TrackingEvent (timeline: DISPATCHED, ARRIVED_AT_STOP, POSITION_UPDATE, DELIVERED…)
   └─ ProofOfDelivery (1..1 per shipment: signature, timestamp, notes)
```

## Workflow & status synchronization

```
TransportOrder: DRAFT → CONFIRMED → PLANNED → IN_EXECUTION → COMPLETED → CLOSED
                  └────────┴──────────┴→ CANCELLED
Shipment:       PENDING → PLANNED → DISPATCHED → IN_TRANSIT → DELIVERED → CLOSED
Load:           OPEN → PLANNED → DISPATCHED → IN_TRANSIT → COMPLETED
```

Cross-entity effects (implemented in `LoadsService` / `TransportOrdersService`):

| Action                  | Effect                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| Order `plan`            | Creates 1 Shipment (PENDING), order → PLANNED                           |
| Shipment `assign-load`  | shipment → PLANNED, attached to an OPEN/PLANNED load                    |
| Load `assign` resources | OPEN load → PLANNED (carrier selection)                                 |
| Load `dispatch`         | load+shipments → DISPATCHED, parent orders → IN_EXECUTION, event emitted|
| Load `start-transit`    | load+shipments → IN_TRANSIT, `actualPickupAt` stamped                   |
| Load `complete`         | shipments → DELIVERED, orders with all shipments delivered → COMPLETED  |
| Load `cancel`           | shipments detached and returned to PENDING                              |
| Stop ARRIVED/DEPARTED   | timestamps + ARRIVED_AT_STOP / DEPARTED_STOP tracking events            |
| POD                     | allowed for IN_TRANSIT/DELIVERED shipments, unique per shipment         |

## Identifiers

Business numbers are human-readable and tenant-scoped: `TO-000001`, `SH-000001`, `LD-000001`.
v0 generates them from a row count (race-prone under concurrency) — phase 1 replaces this with
per-tenant database sequences. Primary keys are cuids.

## Rating engine v2 — Lanes, rates, accessorials, fuel tables (phase 7.1)

### Lane

`Lane` is a tenant-scoped first-class entity representing an origin/destination corridor.

**Endpoint hierarchy** (enum `LaneEndpointType`): `LOCATION` (3) > `CITY` (2) > `STATE` (1) >
`COUNTRY` (0). Numbers are the specificity scores used by `compareLanes`.

**Normalized keys** — `buildEndpointKey()` from `packages/shared/src/rating/lane-key.ts` builds
`originKey`/`destinationKey` from NFD-normalized (diacritics stripped), trimmed, lowercased
components. Formats (pipe separator, country first):

| Type | Key format |
| ---- | ---------- |
| `LOCATION` | `LOCATION:<locationId>` |
| `CITY` | `CITY:<country>|<state>|<city>` |
| `STATE` | `STATE:<country>|<state>` |
| `COUNTRY` | `COUNTRY:<country>` |

`@@unique([tenantId, originKey, destinationKey])` makes strictly identical lanes impossible.
Human-readable fields (`originCity`, `originState`, `originCountry`, and `destination*`
equivalents) are stored alongside for display.

**`candidateEndpointKeys(location)`** produces up to four keys (most specific first) that a
physical `Location` can match against. The rating engine queries `originKey IN (...)` AND
`destinationKey IN (...)` in one shot.

**Lane ordering** — `compareLanes()` (total specificity desc → destination specificity desc →
origin specificity desc → `createdAt` desc). Used by the rating engine and auto-tendering.

**`LaneCarrierPreference`**: `(tenantId, laneId, carrierId, rank)`. Two unique constraints:
`(tenantId, laneId, rank)` and `(tenantId, laneId, carrierId)`. Drives auto-tender sequencing.

### Rate extensions (phase 7.1)

`Rate` has two new nullable FKs (both `onDelete: Restrict`):

- **`laneId`** → `Lane`: when null the rate is a catch-all; the rating engine includes it for
  any load.
- **`fuelTableId`** → `FuelSurchargeTable`: when set, takes precedence over the static
  `fuelSurchargePct` field for computing the fuel surcharge.

**`RateBreak`** (table `rate_breaks`): one row per CWT weight bracket — fields `upToKg Float`
(inclusive upper bound) and `amount Decimal` (per-CWT rate for that bracket). The last bracket
is open-ended (covers all heavier weights). `@@unique([rateId, upToKg])`.

**As-if (deficit-weight) rule**: for actual weight W in bracket i, `calculateRateCost` scans
every higher bracket j and computes cost as if W = `breaks[j-1].upToKg` at `breaks[j].amount`.
The global minimum across all candidates is taken; when the rule fires, `appliedBreak` records
`asIfApplied: true` and `asIfWeightKg`.

**`RateAccessorialPrice`**: joins `Rate` to `Accessorial` with an `amount Decimal`.
`@@unique([rateId, accessorialId])`. An accessorial requested on a load but not priced in the
rate goes into `missingAccessorials[]` — there is no `Accessorial.defaultPrice` fallback.

### Accessorial

Tenant-scoped catalog entity — fields: `code` (unique per tenant), `name`,
`unit AccessorialUnit` (`FLAT | PER_HOUR | PER_UNIT`). No `defaultPrice`.

`LoadAccessorial` (table `load_accessorials`): join between a load and an accessorial flagged
by the planner — fields `loadId`, `accessorialId`, `quantity Float @default(1)`. No stored
price; the price is read from `RateAccessorialPrice` at rating time.

### FuelSurchargeTable / FuelSurchargeEntry

`FuelSurchargeTable`: `(tenantId, name)`. `FuelSurchargeEntry`: `(tableId, effectiveFrom
DateTime, pct Float)`, `@@unique([tableId, effectiveFrom])`.

`pickFuelEntry(entries, referenceDate)` selects the entry with the greatest `effectiveFrom` ≤
reference date (i.e., the most recent entry in effect). Returns null when no entry qualifies
(fuel surcharge treated as 0).

**Reference date**: earliest `plannedPickupAt` across the load's shipments, or `new Date()` if
none is set. Governs both fuel-entry selection and `validFrom`/`validTo` rate validity.

### Load.costDetail snapshot

`Load.costDetail Json?` stores the full calculation breakdown frozen at the moment of the last
`recompute()`. Snapshot shape:

```
{
  version: 1,
  computedAt: ISO string,
  referenceDate: ISO string,
  rate: { id, name, rateType, currency, baseAmount, minCharge, laneId,
          validFrom, validTo, validAtReference,
          breaks: [{ upToKg, amount }],
          accessorialPrices: [{ code, amount }],
          fuel: { pct, source, tableId?, effectiveFrom? } },
  inputs: { distanceKm, weightKg, palletCount, accessorials: [{ code, unit, quantity }] },
  result: CostBreakdown  // lines[], base, fuelSurcharge, accessorialsTotal, total, appliedBreak
}
```

`sum(lines[].amount) === total` is an invariant of `calculateRateCost`. A `MIN_CHARGE_ADJUSTMENT`
line is appended when `minCharge` is triggered (it makes up the difference).

**INVARIANT 1 — no recompute on COMPLETED**: `LoadCostService.recompute()` returns early when
`load.status === LoadStatus.COMPLETED`. The snapshot is permanently frozen at that point.

**INVARIANT 2 — reconciliation reads the snapshot**: billing reads `Load.estimatedCost` and
`costDetail`; it never triggers a recompute. Mutating a rate after a load is completed cannot
silently rewrite historical cost data.

The `updateMany` that persists a new snapshot uses `WHERE status != COMPLETED`, making the
freeze atomic and race-safe.

### Rate shopping

`GET /loads/:id/rate-options` evaluates all `ACTIVE` rates valid at the reference date whose
lane matches the load (or catch-all). Sort order (implemented in `compareRateOptions`):

1. `currency` ascending (plain alphabetical — no currency conversion).
2. Complete candidates first (rates with no `missingAccessorials` before partial ones).
3. `breakdown.total` ascending.
4. Lane `laneSpecificity.total` descending (most specific lane first).
5. `rateId` ascending (deterministic tie-break).

Response includes `referenceDate` and, per option: `rateId`, `rateName`, `carrier`,
`laneSpecificity`, full `breakdown`, and `missingAccessorials`.

## Plan integrity — Time windows, capacity, junction (phase 7.2)

### Time windows

`TransportOrder`, `Shipment`, and `Stop` carry time windows in the form `[early, late?]`.

**Schema changes** (migration `20260611120000_phase7_2_plan_integrity`): the pre-existing
single-bound columns were **renamed** (never dropped — no data loss):
`requestedPickupDate` → `requestedPickupEarly`, `plannedPickupAt` → `plannedPickupEarly`,
`plannedArrivalAt` → `plannedArrivalEarly`. Corresponding `*Late` columns were added as nullable.

**`TimeWindow` interface** (`packages/shared/src/planning/windows.ts`):
```typescript
interface TimeWindow { early: Date | null; late: Date | null; }
```

**Storage and timezone semantics**: all bounds are stored in UTC. The *semantic* of a bound
is the local time of the site involved (`Location.timezone`). Display conversion to the site's
timezone is a v1 limitation — the browser renders UTC until a server-side or client-side
timezone conversion is added.

### Hard window validations (400)

`assertWindowCoherence` in `apps/api/src/modules/transportation/planning/window-validation.ts`
throws `BadRequestException` on:

- `pickupEarly > pickupLate` (early bound must be ≤ late bound within a pair)
- `deliveryEarly > deliveryLate` (same rule for the delivery pair)
- `pickupEarly > deliveryLate` (the overall delivery window must end after the pickup starts)

**Deliberately NOT validated**: `pickupLate ≤ deliveryEarly`. Overlapping pickup and delivery
windows are legitimate (same-day pickup-and-deliver, customer allowing flexibility). The code
carries an explicit comment to prevent this check from being added silently.

`resolveSplitWindows` inherits the order's requested bounds for undefined split fields; an
**explicit `null`** in the payload stays null (open bound). Coherence is validated after
resolution.

### Advisory window warnings

`shipmentWindowWarnings` (source: `window-warnings.ts`, wired into `GET /orders/:id` and
`GET /loads/:id`) compares each shipment's *planned* windows against the order's *requested*
windows. Violations are returned as a `windowWarnings` array — **never blocking**. Planned
operations decide; the customer asked.

`windowViolations` checks `plannedEarly < requestedEarly` (BEFORE_EARLY) and
`plannedLatest > requestedLate` (AFTER_LATE), where `plannedLatest = plannedLate ?? plannedEarly`.

### Capacity — 3 axes

`checkCapacity` (`packages/shared/src/planning/capacity.ts`) compares load totals to trailer
capacity axis by axis (weight kg, volume m³, pallets):

- An axis where **either** the trailer capacity **or** the shipment total is null/unknown is
  **ignored** — we don't enforce what we can't measure.
- Exactly-at-capacity is **not** an excess.
- Values are rounded to 2 decimal places before comparison.

Gates are enforced in two places:

| Gate | Endpoint |
| ---- | -------- |
| `shipments.assignToLoad` | `POST /shipments/:id/assign-load` |
| `loads.assignResources` | `PATCH /loads/:id/assign` |

Both accept a `force: boolean` field. Without `force`, an excess throws 400 with the per-axis
detail. With `force: true`, the operation proceeds and a **single merged audit entry** is
written containing both the resource change and `{ capacityOverride: true, excesses: [...] }`.

`Trailer.capacityPallets` (integer, nullable) was added in the 7.2 migration and is exposed on
the trailer DTO.

### ShipmentLoadLeg junction (`shipment_load_legs`)

**Purpose**: explicit junction table between `Shipment` and `Load`, mirroring the denormalized
`Shipment.loadId` FK. Current loads only ever have `sequence = 1`; the column is reserved for
the future multi-leg scenario (one shipment across multiple loads in sequence).

**Schema** (table `shipment_load_legs`): `id`, `tenantId`, `shipmentId`, `loadId`, `sequence`,
`createdAt`. Unique constraints: `(shipmentId, sequence)` and `(shipmentId, loadId)`. Indexes
on `tenantId` and `loadId`.

**Same-transaction invariant**: every write to `Shipment.loadId` must maintain
`shipment_load_legs` in the same `$transaction`. Three operations uphold this:

| Operation | `Shipment.loadId` change | Junction change |
| --------- | ------------------------ | --------------- |
| `assignToLoad` | set | upsert (`sequence = 1`) |
| `removeFromLoad` | null | deleteMany for the shipment |
| `loads.cancel` | null (via `updateMany`) | deleteMany for the load |

**Backfill**: the 7.2 migration includes an `INSERT … SELECT` that creates one `sequence = 1`
leg for every shipment that already had a `loadId` at migration time, using a deterministic id
(`'leg_' || md5(shipmentId || ':' || loadId)`).

### On-time analytics decision

The carrier scorecard's `onTimeDeliveryPct` uses
`bound = plannedDeliveryLate ?? plannedDeliveryEarly` as the deadline for comparison against
`actualDeliveryAt`. This means pre-7.2 shipments (which have no `plannedDeliveryLate`) are
measured against their single planned bound, preserving historical data without requiring a
backfill of the new column.
