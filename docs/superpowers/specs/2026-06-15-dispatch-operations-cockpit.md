# Spec — Dispatch Operations Cockpit

Date: 2026-06-15
Status: implemented in first UI slice
Reference inputs: Sam's Fleetbase screenshots (map/detail, board, ledger)

## Product thesis

Pulsar should not become a Fleetbase clone. Pulsar should become a logistics operating system where:

```text
TMS data + operational surfaces + governed Hermes agents = dispatch/billing/customer-service employees in one system.
```

Fleetbase wins visually because it shows the operator a complete workbench: map, board, resources, detail drawers, and finance. Pulsar already has many primitives, but they need to be presented as operational surfaces.

## First slice

Improve `/dispatch` as the primary dispatch cockpit.

### Existing capabilities preserved

- Backlog of unassigned shipments.
- Select shipments.
- Consolidate selected shipments into a load.
- Select open/planned loads.
- Add selected shipments to selected load.
- Remove assigned shipments from load.
- See route/stops.
- See route map when a route exists.
- See rate options.
- Tender to a carrier.

### New UX structure

#### 1. Operations cockpit header

Purpose: immediately show that the page is an operational control surface.

Metrics:
- unplanned shipments;
- late unplanned shipments;
- planned/open loads;
- moving/dispatched loads;
- selected load context.

#### 2. Mode switcher

Modes:

- `Map`: route/rates detail emphasized. This is the default because Sam specifically called out Fleetbase maps/tracking.
- `Board`: state pipeline inspired by Fleetbase's created/dispatched/started board.
- `Table`: keeps the prior dense planner layout for operators who need compact workflow.

#### 3. Board mode

Columns:
- `Created`: unassigned shipments.
- `Planned`: planned loads.
- `Open`: open loads.
- `Dispatched / Moving`: dispatched and in-transit loads.

Board cards should compress the data an operator cares about:
- shipment/load identifier;
- state badge;
- pickup/delivery cities or route skeleton;
- order/pallet hints;
- click-to-select load.

#### 4. Activity rail

Selected-load panel showing a simple progression:

```text
Created → Planned → Tendered → Dispatched → In transit → Delivered
```

This mirrors Fleetbase's activity timeline while staying generic to Pulsar status semantics.

## Design decisions

### Use Fleetbase mechanisms, not Fleetbase execution

Allowed to transpose:
- map/table/board modes;
- detail drawer thinking;
- compact route cards;
- activity rail;
- operational KPI header.

Not allowed:
- copying Fleetbase visual assets/code/layout verbatim;
- treating Fleetbase's modules as Pulsar's roadmap by default;
- importing AGPL code.

### Stay inside Pulsar design system

This is product UI inside an existing app shell, so the correct client-native decision is consistency:
- keep Inter/Tailwind tokens already used by Pulsar;
- keep existing `Badge`, `Card`, `PageHeader` components;
- avoid a full visual rebrand;
- make hierarchy and workflow stronger before changing palette.

### Keep this frontend-only

The first slice deliberately avoids backend/schema changes so it can ship alongside other work.

## Future data/API extensions

Later, the cockpit should get richer payloads:

- endpoint for dispatch board summary with shipment counts per load;
- active-map endpoint that can optionally return simplified route polylines for selected tenant operators, not public tracking;
- exception case count per load/shipment;
- agent proposed action count attached to load/shipment;
- driver/vehicle assigned summaries;
- SLA/risk score.

## Hermes agent direction

This cockpit should become the place where an agent like Hermes works:

```text
Operator selects context → Hermes reads backlog/load/rates/map → Hermes proposes consolidate/tender/message/customer update → Pulsar routes mutating actions through ProposedAction and audit.
```

The UI should eventually expose:
- “Ask dispatcher agent” contextual action;
- proposed load plan cards;
- tender recommendation rationale;
- customer notification draft;
- risk/evidence panel.

## Acceptance criteria for this slice

- `/dispatch` still supports existing actions.
- Operator can switch between Map, Board, and Table.
- Board view exposes workflow states without needing a new backend endpoint.
- Selected load context is visible in the header and side panels.
- No schema/API/shared changes.
- Build/typecheck pass.

## Known limitations

- Board mode currently uses existing list endpoints; load cards do not yet show full shipment counts unless the load is selected.
- Map mode still depends on selected load route availability; no all-load map in the dispatch page yet.
- Ledger/billing difference is documented here but not implemented in this slice.

## Verification notes

- `LoadBuilder` receives optional mutation guards so active/moving loads can be viewed without exposing invalid add/remove actions.
- Planning loads (`OPEN`, `PLANNED`) and active loads (`DISPATCHED`, `IN_TRANSIT`) are kept in separate client collections to avoid double-counted KPIs and unsafe selector actions.
- Status fetches use `Promise.allSettled` so one active-status endpoint failure does not erase planning loads.
