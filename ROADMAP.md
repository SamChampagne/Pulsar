# Pulsar — Roadmap

Phases are scoped to ship a usable increment each time. Detailed tasks live in [TODO.md](./TODO.md).

## Phase 0 — Foundation ✅

- Monorepo (pnpm workspaces): `apps/api`, `apps/web`, `packages/shared`, `packages/database`.
- Multi-tenant Prisma schema: platform core + full transportation domain.
- NestJS API: JWT auth, RBAC (roles/permissions catalog), audit logs, module registry with
  per-tenant activation, guards (`JwtAuthGuard` → `ModulesGuard` → `PermissionsGuard`).
- Transportation module v0: master data CRUD, order lifecycle (draft→confirm→plan→cancel),
  shipment consolidation into loads, dispatch/transit/delivery, routes & stops, tracking events, POD.
- SvelteKit SPA: login, dashboard, transport orders, customers, carriers, module settings.
- Docker Compose (PostgreSQL), seed with demo tenant.

## Phase 1 — Usable TMS happy path ✅

- ✅ Web UI for the full workflow: shipments list with load assignment, load detail (resources,
  route generation, stop arrive/depart, dispatch/transit/complete), tracking timeline, POD capture.
- ✅ Transport order detail page (shipments, tracking events, actions).
- ✅ Per-tenant sequence generation for order/shipment/load numbers (atomic, replaces count-based).
- ✅ Input hardening: cross-entity tenant ownership checks on all foreign keys in write payloads.
- ✅ E2E happy-path test (order → delivered → POD → closed) + unit tests on state machines.
- ✅ CI (GitHub Actions): prisma validate, typecheck, build, unit + e2e against a Postgres service.
- Remaining: manual route editor (reorder/planned times), service-level unit tests,
  machine-readable error codes.

## Phase 2 — Collaboration & cost ✅ (current)

The increment that turns Pulsar from an internal tool into a collaborative platform:

- ✅ Carrier tendering: PLANNED → TENDERED workflow, public accept/decline page (tokenized link,
  no carrier account), expiry, dispatch gated on acceptance, audit + tracking events.
- ✅ Public shipment tracking link (parcel-style page for the end customer, revocable).
- ✅ Mobile driver page: stop arrive/depart + POD capture with photo, via revocable link.
- ✅ Cost engine: estimated load cost from the assigned rate (FLAT/PER_KM/CWT/PER_PALLET/SPOT,
  fuel surcharge, minimum charge), recomputed on assignment and route changes.
- ✅ Carrier scorecard: completed/active loads, tender acceptance rate, on-time %, est. spend.
- ✅ Outbound webhooks v0 (HMAC-signed; tender + load lifecycle events).
- ✅ Debt settled: rotating refresh tokens (15 min access tokens), real file storage
  (local/S3 driver) with upload/download endpoints.

## Phase 2.5 — Operational depth (next)

- Email channel for notifications — sends tender links and status updates automatically.
- Order splitting: 1 order → N shipments; multi-stop loads with per-shipment stops.
- Manual route editor (reorder stops, planned times per stop).
- Tender preference lists per lane; sequential auto-retender on decline/expiry.
- Password reset + user invitation flow.
- Module/permission caching (drop per-request DB hit in `ModulesGuard`).
- Webhook outbox with retries; inbound API keys.

## Phase 3 — Platform & integrations

- SSO (OIDC) per tenant; SCIM-lite user provisioning.
- Integration framework: webhook outbox, inbound API keys, first telematics connector.
- Platform administration plane (cross-tenant ops: create tenant, suspend, impersonate-support).
- Audit log retention & export.
- Performance pass: indexes review, pagination cursors, load tests.

## Phase 4 — Second module & commercial readiness

- Customer Portal module (shipper's customers: order entry + tracking) — validates the
  multi-module architecture end-to-end.
- Billing foundations: rated costs → invoice drafts.
- Fleet module discovery (maintenance, compliance).
- SOC2-track hardening: secrets management, encrypted integration configs, backup/restore runbook.

## Later / exploratory

- Planning optimization (load building suggestions, carrier selection rules).
- EDI (204/214/210) for NA market.
- Analytics module (warehouse + dashboards).
- Mobile driver app (stop completion, e-POD, photos).
