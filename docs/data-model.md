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
