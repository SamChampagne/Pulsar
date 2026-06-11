# TODO — structured by phase

Conventions: `[ ]` open, `[x]` done. Keep this file updated as work lands; link PRs when relevant.

## Phase 0 — Foundation

- [x] Monorepo pnpm workspaces + root scripts
- [x] Docker Compose PostgreSQL
- [x] Prisma schema: core (tenants, users, roles, permissions, audit, documents, notifications,
      integrations, module registry)
- [x] Prisma schema: transportation (Customer, Location, Carrier, Driver, Vehicle, Trailer,
      TransportOrder, Shipment, Load, Route, Stop, Rate, TrackingEvent, ProofOfDelivery)
- [x] Seed: permission catalog, module catalog, demo tenant + admin + sample data
- [x] API: auth (JWT login, /auth/me), guards (auth → module → permissions)
- [x] API: core controllers (tenant, users, roles, permissions, audit-logs, documents metadata,
      notifications, integrations, modules)
- [x] API: transportation controllers (master data CRUD, orders lifecycle, shipments,
      loads dispatch/transit/complete/cancel, routes & stops, tracking, POD)
- [x] Web: login, app shell, dashboard, transport orders (list/create/actions), customers,
      carriers, module settings
- [x] Docs: architecture, data model, multi-tenancy, module system, API conventions,
      getting started, PRODUCT_SPEC, ROADMAP, CLAUDE.md
- [x] First Prisma migration committed (`init`)
- [x] CI pipeline (.github/workflows/ci.yml: validate + typecheck + build + unit + e2e)

## Phase 1 — Usable TMS happy path

### API
- [x] Per-tenant number sequences (TO/SH/LD) — atomic `number_sequences` table
      (`SequencesService`)
- [x] Validate tenant ownership of all referenced ids in write payloads (`OwnershipService`)
- [x] Unit tests: workflow state machines (packages/shared, vitest)
- [x] E2E test: order → confirm → plan → load → dispatch → deliver → POD → close
      (`apps/api/test/workflow.e2e-spec.ts`)
- [ ] Unit tests on order/load services (mocked Prisma)
- [ ] Standardized error codes (machine-readable `code` field alongside message)

### Web
- [x] Transport order detail page (shipments, timeline, actions)
- [x] Shipments page with "assign to load" flow (pick existing load or create one)
- [x] Loads page: list + detail (assign resources, dispatch/start-transit/complete/cancel)
- [x] Route v0 on load detail: auto-generate stops from shipments + arrive/depart actions
- [ ] Route editor v1: manual stop reordering and planned times
- [x] Tracking timeline component (events per load/shipment)
- [x] POD capture form (load detail, per delivered shipment)
- [x] Toast notifications for action feedback

## Phase 2 — Collaboration & cost

- [x] Tendering: PLANNED→TENDERED workflow, Tender entity, public accept/decline endpoints +
      carrier page (`/tender/[token]`), expiry, dispatch gated on acceptance
- [x] Public tracking link per shipment (`/track/[token]`) + share/revoke endpoints
- [x] Driver mobile page (`/driver/[token]`): stop arrive/depart, POD + photo, revocable link
- [x] Cost engine: `calculateRateCost` (shared, unit-tested) + `LoadCostService` recompute hooks
- [x] Carrier scorecard endpoint + Analytics page (`transportation.analytics.read`)
- [x] Outbound webhooks v0 (HMAC signature, tender/load events)
- [x] Refresh tokens (rotation, hashed at rest) + transparent refresh in the web client + logout
- [x] File storage: local/S3 drivers behind FILE_STORAGE, upload/download endpoints, POD photos
- [x] E2E suite for the collaboration layer (7 tests)

## Phase 2.5 — Tender automation

- [x] Email channel (`EmailService`, log/SMTP drivers) — tender links emailed automatically,
      `emailedTo` surfaced in tender responses
- [x] Lane carrier preference lists (`LaneCarrierPreference`, GET/PUT /transportation/lanes,
      `/lanes` web page)
- [x] Auto-tendering chain (`auto-tender` endpoint, advance on decline, 5-min expiry cron,
      `tender.expired` webhook, `isAuto` flag)
- [x] Tenant modules cache (30 s TTL + invalidation on toggle) in `ModulesGuard`
- [x] E2E suite for tender automation (6 tests)

## Phase 3 — Operational depth

- [x] Order splitting at plan time (`PlanTransportOrderDto.shipments`, split form on order detail)
- [x] Manual route editor (reorder, planned arrival per stop, distance/duration → PER_KM cost)
- [x] Delivered email to the order's customer contact (tracking link included when shared)
- [x] User invitations (INVITED status, one-shot 72 h token, `inviteUrl` returned, Users page)
- [x] Forgot/reset password (1 h token, enumeration-safe, refresh tokens revoked on reset)
- [x] Webhook outbox (`webhook_deliveries`, retry cron with backoff, deliveries endpoint)
- [x] Phase 3 e2e suite (5 tests)

## Phase 4 — Platform & integrations

- [x] Inbound API keys (read-only scopes, X-Api-Key header, hash at rest, revocation,
      Settings → API keys page)
- [x] Audit interceptor (`@Audit` decorator, applied to master-data create/update)
- [x] Pre-signed URLs (S3 driver: GET + direct PUT upload with confirm step;
      local driver degrades to API download)
- [x] Post-planning shipment management (add shipment to PLANNED order, cancel PENDING shipment)
- [x] **Customer Portal module v1** (second business module): per-customer capability link,
      read-only orders/shipments/tracking view, module-gated management + public page
- [x] Phase 4 e2e suite (7 tests)

## Phase 5 — Portal v2, service accounts, Billing

- [x] Service accounts: API keys act as a hidden DISABLED tenant user → write scopes allowed,
      audit/FK attribution intact
- [x] Portal v2: order entry from the portal (DRAFT orders, locations projection, audited as
      `source: customer-portal`)
- [x] **Billing module v1** (third business module): carrier invoice drafts from completed
      loads' estimated costs, billable preview, approval, double-billing prevented by schema
- [x] Phase 5 e2e suite (4 tests; module-state resets make suites rerun-safe)

## Phase 6 — Commercial readiness (specs/plans: docs/superpowers/)

- [ ] SSO (OIDC) per tenant
- [ ] Platform administration plane (cross-tenant ops: create/suspend tenants)
- [ ] Billing v2: carrier invoice reconciliation (gross-variance tolerance, disputes,
      PAID, CSV export) — sell-side reported after rating engine v2 (see TMS audit §5)
- [ ] Fleet module discovery doc (maintenance, compliance)
- [ ] SOC2-track hardening: CryptoService, encrypted integration configs,
      reencrypt script, runbooks

### Dette notée à la revue des plans phase 6 (durcissements différés)

- [ ] Décorateur composite `@PlatformController()` (= `@Public()` + `@UseGuards(PlatformGuard)`)
      — le pattern actuel rend l'oubli du second décorateur silencieusement ouvert
- [ ] Throttling sur `POST /platform/auth/login` (porte cross-tenant exposée)
- [ ] Inclure le slug du tenant dans le state OIDC chiffré et le vérifier au callback
      (défense en profondeur contre le rejeu d'états entre tenants)
- [ ] Cache du `Issuer.discover` par issuer (un aller-retour de découverte par login OIDC)
- [ ] MFA (TOTP + recovery) pour les comptes plateforme — phase 7 (voir spec phase 6)
- [ ] Export CSV factures : préfixer les champs libres commençant par `=+-@` (injection de
      formule tableur) — risque faible (outil interne mono-tenant), à durcir avant exposition
- [ ] Gardes de statut des factures dans la transaction (`updateMany` conditionnel + count)
      plutôt que read-then-write — fenêtre TOCTOU acceptable en UI d'ops, à fermer si API publique

## Phase 3 — Platform & integrations

- [ ] OIDC SSO per tenant (keep `core/auth` issuance API stable)
- [ ] Webhook outbox + API keys for inbound integrations
- [ ] Encrypt integration `config` secrets at rest (`integrations.service.ts` TODO)
- [ ] Platform admin plane (cross-tenant tenant management)
- [ ] Pagination cursors for large tables; index review

## Phase 4 — Second module

- [ ] Customer Portal module (new `apps/api/src/modules/customer-portal`, flips `available` in
      module catalog)
- [ ] Billing foundations (rated loads → invoice drafts)
