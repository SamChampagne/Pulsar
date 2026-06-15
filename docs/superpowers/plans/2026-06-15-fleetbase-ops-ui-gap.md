# Plan — Fleetbase UI gap → Pulsar operations workbench

Date: 2026-06-15
Branch: `hermes/fleetbase-ops-ui`
Scope: web UI only, no schema/API mutation.

## Why

Sam shared Fleetbase screenshots and called out that Fleetbase feels stronger because it shows maps, transport tracking, boards, and ledger surfaces. The product diagnosis is not “copy Fleetbase”; it is that Pulsar has strong logistics/backend primitives but its UI must express them as operational workbenches instead of admin pages.

## Screenshot analysis

### Fleetbase map/detail
- Big route map is the primary object.
- Right detail drawer contains QR/tracking id, status, activity timeline, assigned driver/vehicle/customer/facilitator, internal ids.
- The operator can see route + current status + operational metadata without changing page.

### Fleetbase board
- Kanban-like state columns: Created, Dispatched, Started, Driver Enroute.
- Each card compresses pickup/dropoff, customer, driver, status, and route progress.
- Sidebar exposes resources (drivers, vehicles, fleets, vendors, places, fuel reports) as an operational inventory.

### Fleetbase ledger
- Finance is a real module surface, not a menu item: revenue, payments, invoices, wallet balance, AR risk, cash flow.
- It makes the logistics loop feel connected to money.

## Difference vs Pulsar observed in repo

Pulsar already has:
- `/dashboard` with an active map component.
- `/dispatch` with backlog, load builder, side panel, route map, rate options, and tender.
- `/fleet` with assets, maintenance, compliance.
- Billing/freight-audit pages.
- Agents/workbench/proposed-actions.

Main gap:
- Fleetbase packages these into mode-based tools (`Map / Table / Board`) with deep contextual panels.
- Pulsar still often reads as `PageHeader → cards/table/modal` even when the workflow is deeper.

## Direction

Convert dispatch from “planning page” to **Operations Cockpit**:

1. Add an operational hero/header with live counts and selected-load context.
2. Add view modes: `Map`, `Board`, `Table`.
3. Keep existing working actions: consolidate, add to load, remove shipment, rate options, tender.
4. Add a board mode that makes state progression visible without new backend work.
5. Keep Fleetbase as mechanism inspiration only. No AGPL code copied.

## Files intentionally touched

- `apps/web/src/routes/(app)/dispatch/+page.svelte`
- `apps/web/src/lib/components/dispatch/LoadBuilder.svelte`
- `docs/superpowers/plans/2026-06-15-fleetbase-ops-ui-gap.md`
- `docs/superpowers/specs/2026-06-15-dispatch-operations-cockpit.md`

## Files intentionally avoided

To avoid interfering with Claude / backend work:
- `packages/database/prisma/schema.prisma`
- `apps/api/**`
- `packages/shared/**`
- `apps/web/src/routes/(app)/+layout.svelte`
- WMS/fleet data models

## Verification target

Run:
- `pnpm install` if node_modules absent in the worktree.
- `pnpm --filter @pulsar/web typecheck`
- `pnpm --filter @pulsar/web build`
- Browser visual check of `/dispatch` if API/dev environment is available.

## Next UI modules after this

1. Fleet Control Room: vehicle/driver board + compliance + maintenance + load assignment.
2. Tracking Control Room: live map as primary screen, exception drawer, customer message proposal.
3. Ledger/Billing dashboard: freight audit → invoice → AR/cash visibility.
4. Agent overlay: Hermes proposes route/tender/customer updates from the same cockpit.
