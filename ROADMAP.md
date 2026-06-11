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

## Phase 2.5 — Tender automation ✅ (current)

- ✅ Email channel (log/SMTP drivers) — tender links are emailed to carriers automatically.
- ✅ Lane carrier preference lists (`/lanes` UI + API) with ordered ranking.
- ✅ Auto-tendering: sequential chain through the lane list on decline/expiry
  (5-minute expiry cron + lazy expiry on read), `tender.expired` webhook.
- ✅ Module cache (30 s TTL, invalidated on toggle) — ModulesGuard no longer hits the DB
  per request.

## Phase 3 — Operational depth ✅ (current)

- ✅ Order splitting: plan an order into N shipments (per-shipment weight/pallets), multi-stop
  loads already supported by consolidation.
- ✅ Manual route editor: reorder stops, planned arrival per stop, distance/duration
  (feeds PER_KM costing).
- ✅ Delivered email notification to the order's customer contact (with tracking link when shared).
- ✅ User invitations (one-shot 72 h links) + forgot/reset password (1 h links,
  enumeration-safe, sessions revoked on reset) + Users admin page.
- ✅ Webhook outbox: durable deliveries with retry backoff (5 attempts) and
  `GET /integrations/:id/deliveries` for inspection.
- Remaining (moved to phase 4): inbound API keys, audit interceptor, pre-signed S3 URLs.

## Phase 3 — Platform & integrations

- SSO (OIDC) per tenant; SCIM-lite user provisioning.
- Integration framework: webhook outbox, inbound API keys, first telematics connector.
- Platform administration plane (cross-tenant ops: create tenant, suspend, impersonate-support).
- Audit log retention & export.
- Performance pass: indexes review, pagination cursors, load tests.

## Phase 4 — Platform & second module ✅ (current)

- ✅ Inbound API keys (read-only scopes v1, X-Api-Key auth, revocation, admin UI).
- ✅ Declarative audit (`@Audit` + global interceptor) on master-data mutations.
- ✅ Pre-signed S3 URLs (download + direct PUT upload with confirm; local fallback).
- ✅ Post-planning shipment management (add/cancel shipments on a PLANNED order).
- ✅ **Customer Portal module v1** — second business module live, validating per-tenant
  modularity end-to-end (read-only customer visibility via capability link).

## Phase 5 — Portal v2, service accounts, Billing ✅ (current)

- ✅ Portal v2: customers submit transport requests from the portal (DRAFT orders to confirm).
- ✅ Service accounts: API keys gain write scopes, attributed to a hidden per-tenant
  service-account user (cannot sign in; audit intact).
- ✅ **Billing module v1** — third business module: completed loads' estimated costs → carrier
  invoice drafts (INV- sequence, one line per load, double-billing impossible) → approval.

## Phase 6 — Commercial readiness (in progress)

- ✅ Platform administration plane (cross-tenant ops): create tenants + initial admin + modules,
  suspend/activate, module toggling, platform overview. Gated by `isPlatformAdmin` /
  `PlatformAdminGuard` without weakening per-tenant isolation (see docs/platform-admin.md).
- SSO (OIDC) per tenant.
- Billing v2: customer invoicing, payment tracking, invoice export.
- Fleet module discovery (maintenance, compliance).
- SOC2-track hardening: secrets management, encrypted integration configs, backup/restore runbook.

## Later / exploratory

- Planning optimization (load building suggestions, carrier selection rules).
- EDI (204/214/210) for NA market.
- Analytics module (warehouse + dashboards).
- Mobile driver app (stop completion, e-POD, photos).
