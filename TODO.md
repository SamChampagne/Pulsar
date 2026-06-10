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

## Phase 2 — Operational depth

- [ ] Order splitting (1 order → N shipments)
- [ ] Multi-stop load planning UI
- [ ] Rate selection + cost estimate at load level
- [ ] S3-compatible document storage + pre-signed URLs (`documents.service.ts` TODO)
- [ ] Email notification channel (`notifications.service.ts` TODO)
- [ ] Refresh tokens + password reset + user invitation flow
- [ ] Cache tenant modules & permissions (drop per-request DB hit in `ModulesGuard`)
- [ ] Audit interceptor (declarative auditing instead of manual service calls)

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
