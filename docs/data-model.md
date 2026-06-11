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
