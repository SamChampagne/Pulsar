# Manufacturing Master-Data — Design (sub-project 2 of the Manufacturing/APS arc)

**Date:** 2026-06-26
**Branch:** `manufacturing-aps`
**Depends on:** nothing (parallel to SP1); consumed by SP3 (scheduling)

## Context

With the APS runtime foundation in place (SP1), Pulsar needs to **own** the manufacturing
master-data that feeds the scheduling engine. This sub-project adds a native `manufacturing`
business module (NestJS + Prisma) — Pulsar is the source of truth; SP3 will project this data into
the engine's canonical snapshot. Entities map 1:1 onto the APS domain (Machine, WorkingCalendar,
WorkOrder, Operation, Routing) so the SP3 snapshot builder is a thin translation.

## Goals

A tenant-scoped `manufacturing` module with CRUD + lifecycle for:

- **WorkingCalendar** + **Shift** — working hours (→ APS `WorkingCalendar`/`Shift`).
- **WorkCenter** — a production resource (→ APS `Machine`): calendar, capabilities, efficiency.
- **Routing** (gamme) + **RoutingStep** — a reusable process template for a product.
- **Bom** (nomenclature) + **BomLine** — bill of materials (material refs + qty per unit).
- **ManufacturingOrder** (MO, → APS `WorkOrder`) + **ManufacturingOperation** (→ APS `Operation`):
  the actual production demand with its ordered operations.

All gated by `@RequireModule(MODULE_KEYS.MANUFACTURING)` + `manufacturing.read|manage`,
tenant-scoped (rule 1), FK-checked via `OwnershipService` (rule 9), MO numbers from
`SequencesService` (rule 8), status via a shared state machine (rule 2), audited (rule 6).

## Non-goals (later sub-projects)

- No scheduling / snapshot building / Gantt (SP3, SP4).
- No material↔WMS tie — `BomLine.materialRef` is a soft string ref in v1 (SP5 wires WMS items).
- No work-center↔Fleet-asset tie (later).
- No setup matrices, transfer times, secondary resources, lot sizing, preemption in the UI yet —
  the engine supports them; we expose the common fields first and extend in SP3+.

## Enums (`@pulsar/shared/enums/manufacturing`, mirrored in schema.prisma — rule 3)

- `ManufacturingOrderStatus`: `DRAFT, RELEASED, IN_PROGRESS, COMPLETED, CANCELLED`.
- `ManufacturingOperationStatus`: `PENDING, SCHEDULED, IN_PROGRESS, COMPLETED`.
- `ManufacturingPriority`: `LOW, NORMAL, HIGH, URGENT` (→ APS priority).
- `ManufacturingFirmness`: `FIRM, FORECAST, TENTATIVE` (→ APS Cas 2 firmness).

## Workflow (`workflows/manufacturing-order.workflow.ts` — rule 2)

`canTransitionManufacturingOrder(from, to)`:
- `DRAFT → RELEASED | CANCELLED`
- `RELEASED → IN_PROGRESS | DRAFT | CANCELLED`
- `IN_PROGRESS → COMPLETED | CANCELLED`
- `COMPLETED → []`, `CANCELLED → []`

## Data model (Prisma — cuid ids, `tenantId`, `@@unique([tenantId, code|number])`, `@@index([tenantId])`)

- **WorkingCalendar**: code, name, isActive. → shifts[], workCenters[].
- **WorkCenterShift**: calendarId, weekday (0–6 Mon=0), startTime "HH:MM", endTime "HH:MM".
- **WorkCenter**: code, name, calendarId, capabilities `String[]`, efficiency `Float @default(1)`,
  isActive. (→ APS Machine.)
- **Routing**: code, name, productRef?, isActive. → steps[].
- **RoutingStep**: routingId, sequence, name, durationMinutes, setupMinutes `@default(0)`,
  eligibleWorkCenterIds `String[]`.
- **Bom**: code, name, productRef?, isActive. → lines[].
- **BomLine**: bomId, materialRef, materialName?, quantityPerUnit `Float`.
- **ManufacturingOrder**: number (MO- via Sequences), name, productRef, quantity, dueDate,
  releaseDate, priority `ManufacturingPriority @default(NORMAL)`, status
  `ManufacturingOrderStatus @default(DRAFT)`, firmness `ManufacturingFirmness @default(FIRM)`,
  routingId?, bomId?. → operations[].
- **ManufacturingOperation**: orderId, sequence, name, durationMinutes, setupMinutes `@default(0)`,
  eligibleWorkCenterIds `String[]`, dependsOn `String[]` (predecessor operation ids; empty ⇒ SP3
  derives a finish-to-start chain from `sequence`), status
  `ManufacturingOperationStatus @default(PENDING)`.

Back-relations added to `Tenant`. New migration `manufacturing_master_data`.

## API (`/api/v1/manufacturing/*`, plural resources, `Paginated<T>`)

Per resource (work-centers, calendars, routings, boms, orders): `GET` (list, paginated +
`search`), `GET :id`, `POST`, `PATCH :id`, `DELETE :id` where safe. Plus:
- `POST /manufacturing/orders/:id/release|start|complete|cancel` — lifecycle verbs through
  `canTransitionManufacturingOrder`, audited before/after (rule 14/6).
- `POST /manufacturing/orders/:id/operations`, `PATCH/DELETE .../operations/:opId` — manage an MO's
  operations (also `POST /manufacturing/orders/:id/operations/from-routing` to materialize
  operations from a Routing).
- Calendars own their shifts (`POST/DELETE /manufacturing/calendars/:id/shifts`).

Controllers: `@RequireModule(MODULE_KEYS.MANUFACTURING)` at class level; `manufacturing.read` on
reads, `manufacturing.manage` on writes. Create/update carry `@Audit(entityType, action)`.

## Web (`apps/web/src/routes/(app)/manufacturing/*`)

SvelteKit pages following the existing `$state` + `$effect` load() pattern and `api<T>()` client:
work centers, calendars (with shift editor), routings, BOMs, and orders (list + detail with
operations + lifecycle actions). Nav entry in `(app)/+layout.svelte` conditioned on
`$auth.tenant.enabledModules` including `manufacturing`.

## Seeding & enablement

- Permission keys + module catalog flip (`available: true`) picked up by the seed (rules 5).
- Enable for the `acme` demo tenant; seed a small demo dataset (one calendar with a Mon–Fri shift,
  two work centers, one routing, one MO with two operations) so SP3 has data to schedule.

## Testing

- Unit (shared): `canTransitionManufacturingOrder` transition table.
- e2e (`apps/api/test/manufacturing.e2e-spec.ts`): create calendar+shift, work centers, an MO with
  operations; exercise the lifecycle (release → start → complete) and reject illegal transitions;
  assert tenant isolation and module gating.

## Sequencing within SP2

2a. Shared (enums, workflow, permissions, module key) + Prisma + migration + module skeleton.
2b. Scheduling-critical resources first: WorkingCalendar/Shift, WorkCenter, ManufacturingOrder +
    Operations (these feed SP3).
2c. Routing + BOM (templating; routing can materialize MO operations).
2d. Web pages + nav + seed + e2e.
