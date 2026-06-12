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
- The requested total is rounded to 2 decimal places before comparison (capacity is
  compared as entered) — sub-cent overages are not excesses.

Gates are enforced in two places:

| Gate | Endpoint |
| ---- | -------- |
| `shipments.assignToLoad` | `POST /shipments/:id/assign-load` |
| `loads.assignResources` | `POST /loads/:id/assign` |

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

## Customer billing statements — sell-side (phase 7.3)

### Model

```
CustomerInvoice (customer_invoices)
  id, tenantId, invoiceNumber (CINV-000001), customerId
  status CustomerInvoiceStatus, currency, totalAmount DECIMAL(12,2)
  approvedAt?, sentAt?, paidAt?, createdAt, updatedAt
  @@unique([tenantId, invoiceNumber])

CustomerInvoiceLine (customer_invoice_lines)
  id, customerInvoiceId, transportOrderId (@@unique — anti-double-billing)
  description, amount DECIMAL(12,2), priceDetail JSONB (frozen snapshot)
```

**Foreign-key constraints**: `customerInvoiceId` is `onDelete: Cascade` — deleting an invoice
also deletes its lines. `transportOrderId` is `onDelete: Restrict` — an order with a line
cannot be deleted while it is being billed.

**Sequence**: `SequencesService.nextNumber(tenantId, 'customer-invoice')` → `CINV-000001`,
`CINV-000002`, …

### Lifecycle

```
DRAFT ──approve──▶ APPROVED ──send──▶ SENT ──pay──▶ PAID
  │
  └──delete (escape)──▶ (gone — orders freed)
```

Status changes go through `canTransitionCustomerInvoice` (from `packages/shared`).
All transitions use a conditional `updateMany WHERE status = <expected>` — race-safe (no
read-then-write window). `DELETE /billing/customer-invoices/:id` is only allowed in DRAFT;
APPROVED+ statements are immutable.

**Wording note**: the UI and emails say **"billing statement"**, not "invoice", until taxes
(GST/QST/VAT) are implemented. The enum and sequence are named `CustomerInvoice`/`CINV` in
code because that is what they will become once tax support lands.

### Two invariants

**INVARIANT 1 — frozen line snapshot once APPROVED**: `priceDetail` on each
`CustomerInvoiceLine` is written at draft creation time and never updated. It is a
self-contained pricing record (same shape as `Load.costDetail`, `version: 1`): rate name,
type, currency, base amount, fuel, inputs (weight, pallets), and the full `CostBreakdown`.
Mutating the underlying `Rate` after the draft is created cannot alter any statement.

**INVARIANT 2 — deletion of DRAFT is the only escape; it frees orders**: deleting a DRAFT
statement removes the `CustomerInvoiceLine` rows (cascade), releasing the `transportOrderId`
unique constraint. The orders reappear in the next `GET /billing/customer-invoices/billable`
preview and can be re-included in a new draft. No other status allows deletion.

### Currency rule

`createDrafts` calls `groupByCurrency` to partition the rated orders by the currency of the
winning rate. It creates **one DRAFT statement per currency**. A single call may therefore
produce multiple invoices (e.g., one CAD and one USD statement) — the caller receives them
all in the `invoices` array response. There is no currency conversion.

### Rating rule

`RatingService.rateOrder(tenantId, orderId)` prices each delivered order:

- **Customer rates only**: only `Rate` rows with `customerId = order.customerId` and
  `status = ACTIVE` are considered. Carrier rates are never used for sell-side billing.
- **Lane match or customer catch-all**: rates with a `laneId` must have their lane's
  `originKey`/`destinationKey` match the order's origin/destination `Location` via
  `candidateEndpointKeys`. Rates with `laneId = null` are included for any order of
  that customer.
- **Reference date**: the latest `actualDeliveryAt` across the order's shipments (the real
  delivery date); falls back to `new Date()` when none is set. Governs rate validity
  (`validFrom`/`validTo`) and fuel-surcharge table entry selection.
- **Cheapest wins**: all valid candidates are sorted with `compareRateOptions` (currency asc →
  complete first → total asc → lane specificity desc → rateId asc); the first result is taken.
- **No sell-side accessorials in v1**: orders are rated as a single pseudo-shipment with their
  `totalWeightKg` and `palletCount`; the accessorials list is empty. Accessorials on the
  underlying loads are not considered.

### Send gating

`POST /billing/customer-invoices/:id/send` (permission `billing.customer-invoices.send`):
- Requires status `APPROVED`.
- Requires `customer.email` to be non-null — a 400 is returned otherwise.
- Calls `EmailService.send` with subject `Billing statement <CINV-number>`. A mail failure
  also returns 400 and leaves the statement in APPROVED.
- On success, transitions to SENT via the conditional `updateMany`.

## Phase 8 additions — Transport Mode, BOL, Notifications, Exceptions

### TransportMode

`TransportMode` enum (source: `packages/shared/src/enums/transportation.ts`, mirrored in
`schema.prisma`): `FTL | LTL | PARCEL`.

**Where it appears**:
- `TransportOrder.mode TransportMode?` — the mode requested by the order.
- `Load.mode TransportMode?` — the mode the carrier will execute under.
- `Rate.mode TransportMode?` — **null means the rate applies to all modes**. When a load has
  a mode set, the rating engine includes only rates whose `mode` is null or matches.

**First-assign mode inheritance**: when a shipment is assigned to a load, if the load has no
mode and the order has one, the load's mode is set to the order's mode. This is non-blocking —
the assignment always succeeds. If the load already has a mode that differs from the order's
mode, a `modeWarning: { loadMode, orderMode }` is returned alongside the updated shipment
(never a 400).

**`suggestMode` hint** (`packages/shared/src/planning/mode.ts`): pure, non-binding function
returning a mode suggestion based on total weight (≤30 kg → PARCEL, ≤4000 kg → LTL, above →
FTL). Thresholds are constants (not tenant-configurable in v1). Used by the UI to surface a
recommendation — never applied automatically.

### Bill of Lading (BOL)

BOLs are `Document` rows with `entityType = 'bill-of-lading'` and `entityId = loadId`.

**Sequence**: `SequencesService.nextNumber(tenantId, 'bol')` → `BOL-000001`, `BOL-000002`, …

**Generation rules**:
- Only allowed when the load is in DISPATCHED, IN_TRANSIT, or COMPLETED status.
- Each call to `POST /loads/:id/bol` creates a **new** document — there is no replacement of
  previous BOLs. The latest BOL is the last document ordered by `createdAt desc`.
- `GET /loads/:id/documents` lists all BOL documents for a load (oldest to newest).
- `GET /public/driver/:token/bol` streams the latest BOL by driver token; returns 404 when no
  BOL has been generated yet. The internal document id is never exposed in the public payload.

**Data shape** (`BolData` from `bol-data.ts`): `bolNumber`, `generatedAt`, carrier (name +
SCAC), driverName, equipment (vehicle + trailer unit numbers), shipper party (name/address/city
— first PICKUP stop, fallback to `Shipment.originLocation`), consignee party (last DELIVERY
stop, fallback to `Shipment.destinationLocation`), shipment lines (one per shipment: number,
order number, customer reference, weight, pallets), totals, notes, conditions string.

### Notification — userId nullable (broadcast)

`Notification.userId` is nullable. When null, the notification is **tenant-wide**: every user
in the tenant can see it via `listMine` (`OR [{ userId }, { userId: null }]`).

**Read-by-one = read-for-all (v1)**: `markRead` sets `readAt` on the notification row itself.
If the notification is tenant-wide (userId null), marking it read from any user's session marks
it globally. This is a deliberate v1 simplification; per-user read state is deferred.

### Exception deduplication — (stopId, deadline)

`DelayDetectionService` creates one `DELAYED` `TrackingEvent` per `(stopId, deadline)` pair
where `deadline = plannedArrivalLate ?? plannedArrivalEarly`.

**Dedup key design rationale**: if a stop's planned time is replanned to a later window and
that window is then also missed, a **new** DELAYED event is created (the deadline has changed,
so the `(stopId, deadline)` key is different). This is intentional — a replanned-then-missed
window should re-alert. The dedup is stored in `TrackingEvent.payload.deadline` as an ISO
string and queried with a Prisma JSON path filter.

**Post-dispatch replanning limitation (phase 8)**: route rebuild (stop replanning) is
API-restricted to OPEN/PLANNED loads. The re-alert path is correctly designed but not
exercisable over HTTP until continuous planning lands (audit §19.5).
