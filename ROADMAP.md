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

## Phase 7 — TMS brain (rating engine v2 + lanes) ✅

- ✅ **7.1 — Rating engine v2 + Lane entity**: Lane as a first-class entity (geo hierarchy
  LOCATION < CITY < STATE < COUNTRY, NFD-normalized keys, deterministic specificity ordering);
  rates attached to lanes with CWT weight breaks and as-if rule; accessorials with per-rate
  pricing; dated fuel surcharge tables (resolved at earliest planned pickup date); frozen
  `Load.costDetail` snapshot (never recomputed after COMPLETED, atomic conditional updateMany);
  rate shopping endpoint (sorted by specificity); auto-tender uses the most specific lane;
  CRUD for accessorials and fuel tables; 4 new permissions; demo seed; 11 e2e tests; 4 new
  web pages (rates v2, lanes v2, accessorials, fuel-tables) + enriched load detail.
- ✅ **7.2 — Plan integrity**: time windows [early, late?] on TransportOrder/Shipment/Stop (column
  rename, no data loss); hard coherence 400s (`assertWindowCoherence`) + advisory `windowWarnings`
  on order and load GET; 3-axis capacity check (`checkCapacity`: weight/volume/pallets, unknown axes
  ignored, exactly-at-capacity OK) gating `assignToLoad` and `assignResources` with `force` override
  (single merged audit entry); `shipment_load_legs` junction with same-transaction invariant and
  backfill migration; on-time analytics uses `plannedDeliveryLate ?? plannedDeliveryEarly`; 6 new e2e
  tests; 12th migration.
- ✅ **7.3 — Billing sell-side**: customer billing statements from rated delivered orders
  (DRAFT → APPROVED → SENT → PAID); `RatingService.rateOrder` (customer rates only, lane match
  or customer catch-all, latest `actualDeliveryAt` as reference date, cheapest wins);
  `groupByCurrency` — one statement per currency; draft escape (delete frees orders);
  `transportOrderId @unique` prevents double-billing; send gated on customer email + email delivery;
  4 new permissions (`billing.customer-invoices.*`); CINV sequence; 8 e2e tests; 13th migration.
  **Note: Taxes (GST/QST/VAT) are the FIRST post-7.3 addition if customers invoice for real.**
- ✅ **7.4 — Deferred phase-6 hardening**: `@PlatformController()` composite decorator
  (`applyDecorators(Public(), UseGuards(PlatformGuard))` — eliminates silent open routes);
  `ThrottlerModule` on `PlatformAuthController` (20 req/min/IP); OIDC encrypted state carries
  `tenantSlug`, verified at callback (replay defense); `Issuer.discover` cache (1 h TTL +
  refresh-once retry on exchange failure); **platform MFA** — `PlatformMfaService` with otplib
  TOTP (±1 window), `totpSecret enc:v1` + `mfaEnabledAt` + `recoveryCodes` bcrypt single-use on
  `PlatformUser`, step tokens (`mfa-enroll` 10 min / `mfa-pending` 5 min) rejected by
  `PlatformJwtStrategy`, login with 3 branches incl. `PLATFORM_MFA_ENFORCED`, opt-in
  `enroll-start` authenticated endpoint; `csvSafe()` on free-text export columns; conditional
  `updateMany` transitions on buy-side invoices; transactional `createDrafts` with `P2002 → 409`;
  6 e2e tests; 14th migration. **Phase 7 complete.**

## Phase 8 — Audit MVP line closed (BOL, modes, exceptions) ✅

The audit's MVP line is now closed. The three blockers identified in §18 are all resolved.

- ✅ **8.1 — Bill of Lading (BOL)**: pure `buildBolData` builder (shipper = first PICKUP stop,
  consignee = last DELIVERY stop, fallback to shipment locations); `renderBol` (pdfkit, LETTER
  format, 3 signature blocks, exceptions/damages lines, conditions footer); `BolService.generate`
  (DISPATCHED/IN_TRANSIT/COMPLETED only, BOL- sequence, `entityType = 'bill-of-lading'`, audited);
  `POST /loads/:id/bol` (generate or regenerate — each call produces a new document);
  `GET /loads/:id/documents`; public `GET /public/driver/:token/bol` (token-resolved, 404 when no
  BOL, internal document id never exposed in the public payload).
- ✅ **8.2 — Transport Mode (FTL/LTL/PARCEL)**: `TransportMode` enum in `packages/shared`,
  mirrored in Prisma; `mode` field on `TransportOrder`, `Load`, and `Rate` (null on Rate = all
  modes); rating engine filters both sides; first-assign mode inheritance; non-blocking
  `modeWarning` when load and order mode differ; `suggestMode` hint (≤30 kg PARCEL / ≤4000 kg
  LTL / above FTL) — thresholds are constants, not parameterized (assumed gap vs audit §4).
- ✅ **8.3 — Delay detection engine**: `isLate` pure function (deadline = `plannedArrivalLate ??
  plannedArrivalEarly`); `DelayDetectionService` cron every 5 minutes + clock-injectable `tick()`
  for testing; dedup on `(stopId, deadline)` — a replanned deadline re-alerts; `DELAYED`
  `TrackingEvent` + tenant-wide `Notification` (userId nullable, read-by-one = read-for-all v1)
  per late stop; bell UI.
- ✅ **15th Prisma migration** (`20260611200000_phase8_mode_notifications_bol`).
- **Known limitation**: post-dispatch route rebuild is API-restricted to OPEN/PLANNED loads
  today; the replanned-window re-alert dedup path is correctly designed but not exercisable
  over HTTP until continuous planning lands (audit §19.5).

## Phases 9–11 ✅ (shipped — see [docs/etat-du-projet.md](./docs/etat-du-projet.md))

- **9 — UI refonte** (design system maison, console hybride, 30 pages).
- **10 — OSRM + carte opérationnelle** (routing best-effort, positions chauffeur, carte live).
- **11 — Agents** (paliers 1/2a/R1/R2): gouvernance + MCP, agents-employés Hermes via ACP,
  runtime managé par tenant, espace `/agents` premier ordre.

## Phases 12 → 22 — Pulsar Agent OS

Adopted 2026-06-14. Full strategic breakdown:
[docs/superpowers/specs/2026-06-14-pulsar-agent-os-roadmap.md](./docs/superpowers/specs/2026-06-14-pulsar-agent-os-roadmap.md).

**North star:** modular logistics OS where governed Hermes agents run 24/7 as digital employees.
Arc = agents first (deepen on the 3 current modules), then modules woven in — each new module
ships *with* its agent.

**Act I — 24/7 operating substrate**
- ✅ **12 — Operating Workbench** (shipped): `DomainEvent` outbox + policies événement→tâche
  (`@pulsar/shared/operating`, pures) ; `OperationalTask` idempotente `(tenantId, dedupKey)` +
  inbox `/workbench` ; `WorkbenchAgentRunner` headless best-effort (Hermes absent ⇒ skip, jamais
  de crash) ; 4 outils workbench + `triggeredByRef = "task:<id>"` ; retards + échecs tender émis
  comme events ; 21ᵉ migration ; 2 permissions `core.operating.tasks.*`.
- ✅ **13 — 24/7 workforce** (shipped): `AgentWorkerService` dispatcher (réveil sur event + cron
  filet de sécurité, concurrence plafonnée global/tenant/agent) ; `AgentRun` ledger durable +
  `GET /agents/:id/runs` ; heartbeat (`lastSeenAt`/`lastRunAt`) ; `PAUSED` kill switch à chaud
  (+ endpoints pause/resume/run-now/pause-all) tuant les sessions Hermes en vol ; retry borné sur
  erreurs de connectivité (SKIPPED quand Hermes absent) ; revert de tâche claim-guarded ; 22ᵉ
  migration ; règle 28 ; UI web « Activité 24/7 ».
- ✅ **14 — Autonomy & policy engine** (shipped): porte de policy unifiée (`evaluatePolicy`,
  `@pulsar/shared` pur, **point de décision unique** dans `ProposedActionsService`) ; policy-as-data
  (`caps.policies` + preset dérivé du dial `autonomyLevel`, rétro-compatible avec `caps.autoApprove`) ;
  auto-exécution **persistée dans le registre des propositions** (`ProposedAction EXECUTED
  autoApproved=true` — trou du cap débit fermé sur le chemin auto) ; circuit breaker réversible
  (`Agent.breakerTrippedAt` rétrograde en PROPOSE, ne touche jamais `autonomyLevel`, jamais
  d'escalade) ; score de confiance + promotion d'autonomie **confirmée par un humain** ; 23ᵉ
  migration ; règle 29.
- ✅ **15-A — Control Tower (observabilité)** (shipped): KPI par agent + dashboard manager du
  tenant + timeline d'activité/audit unifiée + compteur de trips de breaker alimentant le score
  de confiance — tout **calculé à la lecture** depuis `AgentRun`/`ProposedAction`/`OperationalTask`/
  `AuditLog` (`deriveAgentKpis`/`mergeTimeline` purs dans `@pulsar/shared`, aucun store de rollup,
  **aucune migration**) ; règle 30.
- **15-B — Red-team harness** (à venir, slice séparée) : prompt-injection + cross-tenant.
- **15-C — Playbooks** (à venir, slice séparée).

**Act II — Flagship agents (depth, ROI)**
- ✅ **16 — Freight Audit autonome** (shipped): `IncomingCarrierInvoice` découplé + matching
  déterministe (`FreightAuditService`) de chaque ligne contre `Load.estimatedCost` **figé**
  (règle 16, jamais recalculé) via `evaluateReconciliation` + tolérances buy-side ; transitions
  par `canTransitionFreightAudit` (`@pulsar/shared`) ; l'agent litige ouvre via la file de
  gouvernance (`handleMutatingTool` → `ProposedAction`, `triggeredByRef = "task:<id>"`, tier
  SENSITIVE, cap sur `varianceTotal`) ; KPI économies récupérées (`recoveredAmount` positif sur
  résolution `KEEP_EXPECTED`) ; 24ᵉ migration ; règle 31.
- **17 — Continuous planning** (§19.5 unlock): versioned plans/routes, mutable-after-confirm with
  diff, `PlanProposal`/`PlanCommit`.

**Act III — Module expansion (woven, re-orderable)** — each module ships with its agent
- **18 — Integrations/Connectivity** (canonical inbound message: email/PDF/EDI) + integration agents.
- **19 — Yard / Dock scheduling** + Dock Scheduler agent (carries minimal configurability enabler).
- **20 — Fleet** + maintenance/compliance agent.
- **21 — Light WMS** + warehouse-prep agent.
- **22 — Analytics / Control Tower + data network** (§19.6) + ops-analyst/savings agents.

## Operational Workbenches — product-experience track

A track parallel to the Agent OS phases above. **Product pivot (2026-06-15):** Pulsar's gap was
no longer "more features" but **tool experience** — the app read like an admin SaaS
(navbar → page → Card → Table → Form → Modal) instead of real operational workstations. This track
delivers the dense, in-context, single-screen surfaces that make Pulsar feel like a deep
operational tool, not a CRUD console. Agents are the *augmentation*, not the substance — they
arrive as a panel inside these surfaces (workbench v2). Design:
[docs/superpowers/specs/2026-06-15-dispatch-workbench-design.md](./docs/superpowers/specs/2026-06-15-dispatch-workbench-design.md).

- ✅ **Dispatch Workbench v1** (shipped): `/dispatch`, a 3-panel planning workstation where the
  operator never leaves the screen — **backlog** of unassigned shipments (left) → **load builder**
  with live 3-axis capacity bars + stops timeline + frozen cost snapshot (`costDetail`, rule 16)
  (center) → **side panel** route/stops map + rate options (by specificity) + carrier scorecard +
  tender (right). Click-to-assign (no drag/drop in v1). Plus nav/shell polish (groups open by
  default + persisted, prominent Dispatch entry, de-duped agent surfaces). Backend: minimal,
  **no migration, no new permission** (reuses `transportation.planning.read|manage`) —
  `GET /shipments?unassigned=true` filter + atomic `POST /loads/consolidate` (single transaction:
  ownership rule 9, sequence rule 8, capacity-as-warning + `shipment_load_legs` rule 18, recompute
  rule 11, audited rule 6); `dispatch-workbench` e2e.
- **Load Control Room** (upcoming) — live load fleet view + exception triage.
- **Agent Operations Center** (upcoming) — manager surface for the 24/7 workforce.
- **Exception Desk** (upcoming) — operational task triage workstation.
- **Rate Explorer** (upcoming) — interactive lane/rate analysis.
- **Workflow Config Designer** (upcoming) — visual workflow/policy editor.
- **Workbench v2 enhancements** (upcoming) — drag & drop (backlog → builder, stop reorder) and the
  agent "propose" panel ("Hermes optimizes this run" → `ProposedAction`).
