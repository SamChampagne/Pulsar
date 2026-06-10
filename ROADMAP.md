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

## Phase 1 — Usable TMS happy path ✅ (current)

- ✅ Web UI for the full workflow: shipments list with load assignment, load detail (resources,
  route generation, stop arrive/depart, dispatch/transit/complete), tracking timeline, POD capture.
- ✅ Transport order detail page (shipments, tracking events, actions).
- ✅ Per-tenant sequence generation for order/shipment/load numbers (atomic, replaces count-based).
- ✅ Input hardening: cross-entity tenant ownership checks on all foreign keys in write payloads.
- ✅ E2E happy-path test (order → delivered → POD → closed) + unit tests on state machines.
- ✅ CI (GitHub Actions): prisma validate, typecheck, build, unit + e2e against a Postgres service.
- Remaining: manual route editor (reorder/planned times), service-level unit tests,
  machine-readable error codes.

## Phase 2 — Operational depth

- Order splitting: 1 order → N shipments; multi-stop loads with per-shipment stops.
- Rating: rate selection at load assignment, cost estimate on load, fuel surcharge math.
- Documents: real object storage (S3-compatible), upload/download with pre-signed URLs.
- Notifications: in-app + email channel (dispatch, delay, delivered).
- Refresh tokens, password reset, user invitations.
- Module/permission caching (drop per-request DB hit in `ModulesGuard`).
- Reporting basics: on-time %, orders per status, carrier volume.

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
