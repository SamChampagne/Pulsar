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

- [ ] Order splitting (1 order → N shipments)
- [ ] Multi-stop load planning UI + manual route editor
- [ ] Email notifications beyond tendering (status updates to customer contacts)
- [ ] Password reset + user invitation flow
- [ ] Webhook outbox with retries; inbound API keys
- [ ] Audit interceptor (declarative auditing instead of manual service calls)
- [ ] Pre-signed URLs for direct-to-S3 uploads (skip the API for large files)

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
