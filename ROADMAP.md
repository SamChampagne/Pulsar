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

## Phase 6 — Commercial readiness ✅ (current)

- ✅ Platform administration plane: disjoint `PlatformUser` model, watertight tenant/platform
  JWT strategies, tenant lifecycle (create with full provisioning + invitation, suspend with
  session revocation, reactivate), `/platform` web pages, production boot guards.
- ✅ SSO (OIDC) per tenant: encrypted `authConfig`, PKCE flow with AES-GCM-encrypted state,
  `oidcSubject`-first user resolution with guarded email binding, one-shot atomic exchange
  code, first-login provisioning, SSO settings page.
- ✅ Billing v2 — **reoriented to carrier invoice reconciliation** after the TMS audit
  (`docs/audit-tms-2026-06-10.md`): gross-variance tolerance (catches compensating errors),
  dispute workflow with codified reasons and corrected-invoice re-reconcile, PAID tracking,
  CSV export. Customer invoicing (sell-side) deferred until a real rating engine exists.
- ✅ SOC2-track hardening: secrets encrypted at rest (AES-256-GCM `enc:v1`), idempotent key
  rotation script, operational runbooks (key rotation, backup/restore).
- ✅ Fleet module discovery doc (scope, model sketch, open questions — no code).

## Phase 7 — TMS brain (rating engine v2 + lanes) 🚧

- ✅ **7.1 — Rating engine v2 + Lane entity**: Lane as a first-class entity (geo hierarchy
  LOCATION < CITY < STATE < COUNTRY, NFD-normalized keys, deterministic specificity ordering);
  rates attached to lanes with CWT weight breaks and as-if rule; accessorials with per-rate
  pricing; dated fuel surcharge tables (resolved at earliest planned pickup date); frozen
  `Load.costDetail` snapshot (never recomputed after COMPLETED, atomic conditional updateMany);
  rate shopping endpoint (sorted by specificity); auto-tender uses the most specific lane;
  CRUD for accessorials and fuel tables; 4 new permissions; demo seed; 11 e2e tests; 4 new
  web pages (rates v2, lanes v2, accessorials, fuel-tables) + enriched load detail.
- 7.2 — Plan integrity: time windows (early/late per stop), 3-axis capacity check
  (weight / pallets / volume), shipment↔load junction entity.
- 7.3 — Billing sell-side: customer invoicing (rated loads → sell-side drafts), unblocked
  by the rating engine v2.
- 7.4 — Deferred phase-6 hardening: `@PlatformController()` composite decorator, platform
  login throttling, OIDC state slug, `Issuer.discover` cache, platform MFA (TOTP).

## Later / exploratory

- Planning optimization (load building suggestions, carrier selection rules).
- EDI (204/214/210) for NA market.
- Analytics module (warehouse + dashboards).
- Mobile driver app (stop completion, e-POD, photos).
