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

A `Lane` is a first-class entity that represents an origin/destination corridor for pricing.

**Hierarchy levels** (enum `LaneLevel`): `LOCATION` < `CITY` < `STATE` < `COUNTRY`.  
A lane is matched against a load's actual origin/destination using **normalized keys** computed
by `buildLaneKey()` from `@pulsar/shared/rating/lane-key`. Keys are NFD-normalized, lower-cased,
accent-stripped, whitespace-collapsed strings of the form `"city:state:country"` (or subset
thereof depending on level).

**Uniqueness constraint**: `(tenantId, originKey, destinationKey)` is unique in the database.
The `originKey`/`destinationKey` columns are the canonical storage form; human-readable fields
(`originCity`, `originState`, etc.) are stored alongside for display.

**Specificity ordering**: `compareLanes()` (from `@pulsar/shared`) establishes a total order:
1. Higher `LaneLevel` wins (LOCATION > CITY > STATE > COUNTRY for origin, then destination).
2. Tie-break: lower `rateId` (string comparison) for determinism.

`LaneCarrierPreference` rows are now lane-based (replacing the v1 string-key approach):
`(laneId, carrierId, rank)` with a unique constraint per lane+carrier.

### Rate extensions

`Rate` gained two new fields:
- `laneId` (nullable FK → `Lane`): when set, this rate applies only to that lane. A `null`
  `laneId` means the rate is a **catch-all** (applied when no lane-specific rate matches).
- `fuelTableId` (nullable FK → `FuelSurchargeTable`): when set, takes **precedence** over the
  static `fuelSurchargePct` for computing fuel surcharge.

**`RateBreak`** (weight breaks for CWT pricing): each row stores `minWeight`, `maxWeight`
(nullable = no ceiling), and `ratePerCwt`. The **as-if rule** is applied at every break
boundary: the total cost is `min(cost_at_break_boundary)` across all boundaries up to the
actual weight, ensuring monotonicity (heavier freight never costs more than lighter freight
at the next boundary).

**`RateAccessorialPrice`**: joins a `Rate` to an `Accessorial` with a `price` override. When
a load includes an accessorial that has a `RateAccessorialPrice` on the selected rate, that
price is used; otherwise the `Accessorial.defaultPrice` applies.

### Accessorial

`Accessorial` is a tenant-scoped master-data entity (code, name, defaultPrice). Loads reference
accessorials via `LoadAccessorial` (load ↔ accessorial join with the resolved `price` stored at
booking time).

### FuelSurchargeTable / FuelSurchargeEntry

`FuelSurchargeTable` groups a set of dated `FuelSurchargeEntry` rows (each with an `effectiveDate`
and a `surchargePct`). At rating time the **reference date** is the earliest planned pickup date
on the load (or today if none exists). The entry with the greatest `effectiveDate` ≤ reference
date is selected — i.e., the most recent entry that was already in effect.

### Load.costDetail snapshot

`Load.costDetail` is a JSON column that stores the full breakdown of the estimated cost at the
moment it was last computed, including: base amount, fuel surcharge amount, accessorial amounts,
applied rate id/version, and the reference date used for the fuel table.

**INVARIANT 1 — no recompute on COMPLETED**: `LoadCostService.recompute()` is a no-op (early
return) when `load.status === LoadStatus.COMPLETED`. The snapshot is frozen at completion.

**INVARIANT 2 — reconciliation reads the snapshot**: billing reconciliation reads
`Load.estimatedCost` and the `costDetail` JSON. It never triggers a recompute. This ensures
the invoice total matches the cost that was visible to the dispatcher at dispatch time, not a
potentially-different recalculation.

The `updateMany` call that persists a new snapshot uses a conditional `WHERE status != COMPLETED`
clause, making the freeze atomic and race-safe.

### Rate shopping

`GET /loads/:id/rate-options` returns all rates that are valid for the load's lane, sorted by:
1. Currency (tenant's base currency first).
2. Complete vs. partial match (rates covering all accessorials first).
3. Total estimated cost (ascending).
4. Lane specificity (most specific first, using `compareLanes`).
5. `rateId` for determinism.
