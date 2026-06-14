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

- [x] SSO (OIDC) per tenant: `Tenant.authConfig` (clientSecret chiffré), flow PKCE avec
      state chiffré AES-GCM, lookup `oidcSubject` d'abord (email = fallback de liaison,
      refusé si `email_verified: false`), code d'échange one-shot 60 s atomique,
      provisioning au premier login, page Settings → SSO
- [x] Platform administration plane: modèle `PlatformUser` disjoint, stratégies JWT
      étanches, `PlatformGuard` avec relecture du status, création de tenant complète
      (rôle admin + invitation 72 h + modules), suspend/reactivate (sessions tuées,
      `refresh()` re-vérifie le statut), pages `/platform/*`, garde-fou prod
      (mot de passe par défaut et secrets d'exemple publiés refusés au boot)
- [x] Billing v2: rapprochement facture transporteur — tolérance sur l'écart BRUT
      (Σ|écart ligne|, attrape les compensations), DISPUTED + re-reconcile (facture
      corrigée), résolution codifiée (`DisputeReasonCode`), PAID (`billing.invoices.pay`),
      export CSV non plafonné — sell-side reporté après rating engine v2 (audit TMS §5)
- [x] Fleet module discovery doc (docs/fleet-module-discovery.md)
- [x] SOC2-track hardening: CryptoService (enc:v1, boot fail-fast), Integration.config
      chiffré + masqué, script reencrypt-secrets idempotent (rotation + sweep initial),
      docs/runbooks.md
- [x] (imprévu) Restauration des drivers file-storage perdus par une règle .gitignore
      trop large (`storage/` → `/apps/api/storage/`)

### Dette notée à la revue des plans phase 6 (durcissements différés)

- [x] Décorateur composite `@PlatformController()` (= `@Public()` + `@UseGuards(PlatformGuard)`)
      — le pattern actuel rend l'oubli du second décorateur silencieusement ouvert
      **→ livré en 7.4** : `apps/api/src/common/decorators/platform-controller.decorator.ts` ;
      `platform-tenants.controller.ts` + `platform-mfa.controller.ts` migrated vers ce décorateur
- [x] Throttling sur `POST /platform/auth/login` (porte cross-tenant exposée)
      **→ livré en 7.4** : `ThrottlerModule` dans `AppModule`, `@UseGuards(ThrottlerGuard)` sur
      `PlatformAuthController` uniquement, 20 req/min/IP (commentaire in-code explique le seuil)
- [x] Inclure le slug du tenant dans le state OIDC chiffré et le vérifier au callback
      (défense en profondeur contre le rejeu d'états entre tenants)
      **→ livré en 7.4** : `tenantSlug` inclus dans le state via `packOidcState` ; `callback`
      vérifie `state.tenantSlug !== slug` et retourne 401 en cas de divergence
- [x] Cache du `Issuer.discover` par issuer (un aller-retour de découverte par login OIDC)
      **→ livré en 7.4** : `issuerCache` TTL 1 h dans `OidcService` ; retry-once avec
      `forceRefresh = true` si l'échange IdP échoue (rotation d'endpoints)
- [x] MFA (TOTP + recovery) pour les comptes plateforme — phase 7 (voir spec phase 6)
      **→ livré en 7.4** : `PlatformMfaService` (otplib v12, fenêtre ±1) ; colonnes
      `totpSecret enc:v1`, `mfaEnabledAt`, `recoveryCodes` bcrypt à usage unique sur `PlatformUser` ;
      step tokens `mfa-enroll` (10 min, secret chiffré dans payload) et `mfa-pending` (5 min)
      rejetés par `platform-jwt.strategy` ; endpoints `login` (3 branches dont
      `PLATFORM_MFA_ENFORCED`), `mfa/enroll`, `mfa/verify` (publics) et `mfa/enroll-start`
      (authentifié via `@PlatformController`) ; 14ᵉ migration
- [x] Export CSV factures : préfixer les champs libres commençant par `=+-@` (injection de
      formule tableur) — risque faible (outil interne mono-tenant), à durcir avant exposition
      **→ livré en 7.4** : `csvSafe()` dans `apps/api/src/common/csv.ts` appliqué sur tous les
      champs libres de l'export CSV des factures transporteur
- [x] Gardes de statut des factures dans la transaction (`updateMany` conditionnel + count)
      plutôt que read-then-write — fenêtre TOCTOU acceptable en UI d'ops, à fermer si API publique
      **→ livré en 7.4** : transitions buy-side (`approve`, `markPaid`, `reconcile`,
      `resolveDispute`) utilisent `updateMany` conditionnel sur le statut attendu ; `createDrafts`
      dans `CustomerInvoicesService` est transactionnel avec `P2002 → 409`

## Phase 7 — Le « cerveau » TMS (rattrapage audit)

### Chantier 7.1 — Rating engine v2 + entité Lane ✅

- [x] Lane comme entité de première classe : hiérarchie géo LOCATION < CITY < STATE < COUNTRY,
      clés normalisées NFD (`originKey`/`destinationKey`), contrainte d'unicité, ordre de
      spécificité déterministe (`compareLanes`, tie-break `rateId`)
- [x] Tarifs rattachés aux lanes : tranches CWT (`RateBreak`) avec règle as-if à toutes les
      bornes, prix d'accessorials (`RateAccessorialPrice`), table carburant datée
      (`FuelSurchargeTable` / `FuelSurchargeEntry`) — résolution à la date de référence
      (premier pickup planifié, sinon today), priorité `fuelTableId` sur pourcentage statique
- [x] Snapshot figé `Load.costDetail` : invariant « jamais de recompute sur COMPLETED »,
      `updateMany` conditionnel atomique (race-safe), forme documentée dans data-model.md
- [x] Rate shopping (`GET /loads/:id/rate-options`) : tri devise → complets → total → spécificité
      → rateId
- [x] Auto-tender par spécificité : la lane la plus spécifique ayant des préférences est
      sélectionnée en priorité
- [x] CRUD accessorials (`/transportation/accessorials`) + tables carburant
      (`/transportation/fuel-tables`) avec entrées datées
- [x] 4 nouvelles permissions (`transportation.accessorials.read`/`.manage`,
      `transportation.fuel-tables.read`/`.manage`) — `transportation.rates.*` pré-existait
- [x] Seed démo : lanes, accessorials, fuel-table avec entrées, tarifs v2 avec tranches
- [x] Suite e2e phase7 (11 tests) + migration de la suite tender-automation
- [x] 4 nouvelles pages web : rates v2, lanes v2, accessorials, fuel-tables ; détail du load
      enrichi (costDetail snapshot + rate options)
- [x] Migration Prisma `20260611100309_phase7_rating_engine_lanes` (11ᵉ migration)

### Chantier 7.2 — Intégrité du plan ✅

- [x] Fenêtres temporelles early/late sur TransportOrder, Shipment et Stop : colonnes renommées
      sans perte de données (RENAME), colonne `late` ajoutée ; `TimeWindow`, `validateWindowPair`,
      `windowViolations` dans `packages/shared/src/planning/windows.ts`
- [x] Validations dures (400) : early ≤ late par paire, pickupEarly ≤ deliveryLate — mais
      pickupLate ≤ deliveryEarly délibérément NON validé (fenêtres qui se chevauchent = légitimes) ;
      `assertWindowCoherence` + `resolveSplitWindows` dans `window-validation.ts`
- [x] Avertissements consultatifs `windowWarnings` sur GET order et GET load : compare les fenêtres
      planifiées des shipments aux bornes demandées par l'ordre (`shipmentWindowWarnings`) — jamais bloquant
- [x] Capacité 3 axes (poids/volume/palettes) : `checkCapacity` dans
      `packages/shared/src/planning/capacity.ts` ; axes sans valeur ignorés ; égal à la capacité = OK ;
      gate dans `shipments.assignToLoad` et `loads.assignResources` avec `force` booléen ;
      dépassement forcé = entrée d'audit unique consolidée
- [x] `capacityPallets` ajouté au modèle `Trailer` et exposé dans le DTO trailer
- [x] Entité de jonction `shipment_load_legs` : migration `20260611120000_phase7_2_plan_integrity`
      avec backfill des assignations existantes ; maintenue dans la même transaction que
      `Shipment.loadId` dans `assignToLoad`, `removeFromLoad` et `loads.cancel`
- [x] Analytics on-time : la borne de comparaison est `plannedDeliveryLate ?? plannedDeliveryEarly`
      (couvre les données migrées sans `late`)
- [x] Suite e2e phase7-2 (6 tests) ; 12 migrations au total

### Chantier 7.3 — Billing sell-side ✅

- [x] `CustomerInvoiceStatus` enum + `canTransitionCustomerInvoice` dans `packages/shared`
      (DRAFT → APPROVED → SENT → PAID ; suppression d'un DRAFT = échappatoire, pas une transition)
- [x] 4 permissions `billing.customer-invoices.read|manage|send|pay` dans le catalogue
- [x] Migration Prisma `20260611153442_phase7_3_customer_invoices` : tables
      `customer_invoices` + `customer_invoice_lines` (`transportOrderId @unique` — anti-double-billing ;
      lignes cascade à la suppression de la facture, RESTRICT sur l'ordre)
- [x] Séquence CINV (`customer-invoice`) via `SequencesService.nextNumber`
- [x] Seed : taux client démo FLAT 1 450 CAD (lane city, rattaché au customer de démo)
- [x] `RatingService.rateOrder` : taux *client* uniquement (`customerId`), correspondance lane ou
      catch-all client, date de référence = dernier `actualDeliveryAt` des shipments sinon today,
      évaluation via `compareRateOptions` → le moins cher retenu
- [x] `CustomerInvoicesService` : preview billable (`ratable` / `unratable: NO_APPLICABLE_RATE`),
      `createDrafts` groupés par devise (un relevé par devise), `deleteDraft` (seule échappatoire),
      transitions conditionnelles `updateMany` (race-safe), `send` conditionné sur email client + succès `EmailService`
      (libellé « Billing statement »)
- [x] `CustomerInvoicesController` sous `@RequireModule(BILLING)`, chaque endpoint décoré
      `@RequirePermissions`
- [x] Web : page Invoices enrichie avec deux onglets (carrier / customer statements)
- [x] Suite e2e `phase7-3-sell-side` (7 tests) ; 13ᵉ migration

### Chantier 7.4 — Durcissements différés phase 6 ✅

Tous les items de la dette phase 6 sont soldés (voir annotations ci-dessus).

- [x] Décorateur composite `@PlatformController()` — `applyDecorators(Public(), UseGuards(PlatformGuard))`
- [x] Throttling sur `POST /platform/auth/login` — `ThrottlerGuard` 20 req/min/IP
- [x] Slug du tenant dans le state OIDC chiffré — `packOidcState` + vérification callback
- [x] Cache du `Issuer.discover` par issuer — TTL 1 h + retry-once refresh
- [x] MFA (TOTP + recovery) pour les comptes plateforme — `PlatformMfaService`, step tokens,
      3 branches login, `PLATFORM_MFA_ENFORCED`, 8 codes de récupération bcrypt à usage unique
- [x] Injection de formule tableur dans l'export CSV factures — `csvSafe()` sur champs libres
- [x] Gardes de statut des factures dans la transaction — `updateMany` conditionnel, `createDrafts`
      transactionnel `P2002 → 409`
- [x] Suite e2e `phase7-4-hardening` (6 tests) ; 14ᵉ migration

## Phase 8 — Audit MVP line closed (BOL, Transport Mode, Exceptions)

### Chantier 8.1 — Bill of Lading (BOL) ✅

- [x] `bol-data.ts` : pure builder `buildBolData` (shipper = first PICKUP stop, fallback
      shipment originLocation ; consignee = last DELIVERY stop, fallback destinationLocation)
- [x] `bol-render.ts` : pdfkit (LETTER, 3 signature blocks + exceptions/damages lines +
      conditions footer)
- [x] `BolService.generate` : allowed on DISPATCHED/IN_TRANSIT/COMPLETED ; BOL- sequence via
      `SequencesService` ; `DocumentsService.upload` with `entityType = 'bill-of-lading'` ;
      audited (AuditAction.CREATE)
- [x] `POST /loads/:id/bol` — generate (or regenerate; each call = new document)
- [x] `GET /loads/:id/documents` — list all BOL documents for a load
- [x] `GET /public/driver/:token/bol` — latest BOL for the load resolved by driver token;
      no document id exposed in public payloads; 404 when no BOL has been generated yet

### Chantier 8.2 — Transport Mode (FTL / LTL / PARCEL) ✅

- [x] `TransportMode` enum (FTL / LTL / PARCEL) in `packages/shared/src/enums/transportation.ts`
      ; mirrored in `schema.prisma`
- [x] `mode` field on `TransportOrder`, `Load`, and `Rate` (null on Rate = applies to all modes)
- [x] Rating engine filters both load mode and rate mode when evaluating options
- [x] First-assign mode inheritance: when a shipment is assigned to a load, the load's mode is
      inherited from the order if the load has none
- [x] `modeWarning` (non-blocking) returned by `assign-load` when load mode and order mode differ
- [x] `suggestMode` pure function (PARCEL ≤ 30 kg, LTL ≤ 4000 kg, FTL above) in
      `packages/shared/src/planning/mode.ts` — hint only, no automatic threshold arbitrage
      (assumed gap vs audit §4 — parameterizable thresholds deferred)
- [x] 15th Prisma migration `20260611200000_phase8_mode_notifications_bol`

### Chantier 8.3 — Exception & delay detection ✅

- [x] `isLate` pure function : deadline = `plannedArrivalLate ?? plannedArrivalEarly` ; never
      late if stop has been arrived at or if no deadline is defined
- [x] `DelayDetectionService` cron every 5 minutes; public `tick(now)` for E2E injection
- [x] Dedup on `(stopId, deadline)` stored in `TrackingEvent.payload.deadline` — a
      replanned-then-missed window re-alerts (new deadline = new key)
- [x] Creates a `DELAYED` `TrackingEvent` + a tenant-wide `Notification` (userId nullable)
      per late stop
- [x] `Notification.userId` nullable — broadcast: `OR [{ userId }, { userId: null }]` ;
      read-by-one = read-for-all v1 (cosmetic; real per-user read state deferred)
- [x] Bell UI integration in web shell

### Limitation connue — réplanning / alertes multiples (post-dispatch)

- Route rebuild (stop replanning) is API-restricted to OPEN/PLANNED loads today. The
  dedup key design correctly handles the replanned-window re-alert path (new deadline =
  new dedup key), but this code path is not exercisable over HTTP until continuous planning
  is shipped (audit §19.5). Noted for the future; not a phase-8 gap.

## Phase 10 — OSRM + carte opérationnelle

### Dette notée aux revues phase 10 (à ne pas « réparer » en silence)

- [ ] `routes.createForLoad` : le check OPEN/PLANNED puis l'appel OSRM (≤3 s) puis
      deleteMany+create hors transaction élargissent la fenêtre TOCTOU préexistante —
      envelopper deleteMany+create dans une transaction avec re-check de statut quand
      on s'y attaque.
- [ ] `loads/active-map` : la requête « dernière position par load » est non bornée
      (toutes les POSITION_UPDATE des loads actifs triées puis dédupliquées en JS).
      Passer à `DISTINCT ON` (queryRaw) ou borner par fenêtre temporelle, et/ou prévoir
      une purge/rétention des POSITION_UPDATE avant que les pings s'accumulent sur des
      semaines.
- [ ] Règle 15 incohérente sur les anciens handlers publics : seul `driver/:token/position`
      re-vérifie l'activation du module ; `getTracking`, `getDriverView`, `driverUpdateStop`,
      `driverCreatePod` ne le font pas (préexistant, à harmoniser).
- [ ] Throttle Nominatim 1 req/s in-process : valable mono-instance seulement (à revoir
      avec le passage Redis du cache modules).

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

## Phase 11 (palier 1) — Agent governance + MCP exposure

### Shared + DB
- [x] `@pulsar/shared` agent vocabulary: `RiskTier`/`AgentStatus`/`ProposalStatus` enums +
      pure helpers `isExecutableLive`/`evaluateAmountCap`/`evaluateRateCap`/`deriveIdempotencyKey`
      (vitest, browser-safe — `node:crypto` resolved lazily)
- [x] `agents.*` permission catalog entries (`core.agents.read|manage|actions.read|actions.approve`)
- [x] Prisma `Agent` + `ProposedAction` models (+ 3 enums), 18th migration

### API
- [x] `AgentsService` — register/list/revoke + one hidden DISABLED service-user per agent +
      `validateKey` → `AgentPrincipal` (rule 13)
- [x] `AgentsController` — JWT-auth CRUD (`agents.read`/`agents.manage`)
- [x] Tool registry — 8 dispatch tools (tier/permission/module/zod/handler over real TMS services)
- [x] `ProposedActionsService` — idempotent capped enqueue, race-safe approve (execute+audit)/reject
- [x] MCP server factory — per-agent scoped tool surface (permission ∩ modules ∩ allowlist)
- [x] `POST /api/v1/mcp` Streamable-HTTP stateless endpoint (agent-key auth, `@Public`) +
      `agent-actions` inbox controller (`agents.actions.read`/`agents.actions.approve`)
- [x] `AgentsModule` wired into `AppModule`; tool-services adapter bridges the registry to real services
- [x] E2E governance flow (`phase11-agents.e2e-spec.ts`, 7 tests)

### Web
- [x] Settings → Agents page (register, scopes, caps, one-time key reveal)
- [x] Agent-actions inbox + nav badge (gated on `core.agents.actions.read`; actions gated on approve)

### Docs
- [x] `docs/agents.md` Hermes/MCP connection guide; CLAUDE.md hard rules 21–23; status + TODO

### Deferred (noted at reviews — do not "fix" silently)
- [ ] `caps.autoApprove` bypasses the proposed-actions queue and its audit entity; audit then
      relies on the underlying TMS services' own `@Audit`/`AuditLogsService.log`. If autoApprove
      is used for SENSITIVE tools, add an explicit agent-action audit trail for it.
- [ ] `agent-actions` badge fetches the full pending list just to count `.length` — add a
      count-only endpoint when pending volumes grow.
- [ ] `create_load` tool only accepts `notes` (the real `CreateLoadDto`); carrier/mode/resource
      assignment needs separate tools before an agent can build a complete load end-to-end.
- [ ] Rate-limit / throttle the public `POST /mcp` endpoint (currently agent-key gated but
      unthrottled, unlike the public driver endpoints — `ThrottlerGuard` 20/min/IP).
- [ ] `ProposedActionsService.approve` does not re-check `agent.status === ACTIVE` nor module
      activation before executing — a proposal enqueued before the agent was revoked / the module
      disabled would still run on approval. Human approval is the gate, but re-checking would
      align with rule 15 and the factory's own filtering.
- [ ] `enqueue` idempotency TOCTOU: two concurrent identical calls both pass the `findUnique`
      check then `create`; the `(agentId, idempotencyKey)` unique index makes the second throw
      P2002 (uncaught → 500). No duplicate side effect (mutations don't run at enqueue). Catch
      P2002 and return the existing projection.

## Phase 11 (palier 2a) — Employee-agents (Hermes brain in Pulsar)

### Shared + DB
- [x] `@pulsar/shared` `AgentAutonomy` enum (`PROPOSE`/`ACT_LOW`/`AUTONOMOUS`) + helper
      (`packages/shared/src/agents/autonomy.ts`, vitest `autonomy.spec`)
- [x] `core.agents.chat` permission catalog entry
- [x] Prisma migration `20260613195333_phase11b_agents_employes` (19th migration): employee
      fields on `Agent` (persona/role/model/autonomy/avatar) + agent-conversations/messages tables

### API
- [x] Agent session token (short-lived, signed with `AGENT_SESSION_SECRET` → `JWT_SECRET` →
      dev default) so the Hermes runtime calls `/mcp` as the agent (`agent-session-token.spec`)
- [x] `HermesAcpClient` — ACP transport (stdio, newline-framed) + fake ACP server for tests
      (`hermes-acp.client.spec`)
- [x] `AgentRuntimeService` — spawns `python -m acp_adapter` as a child process **per
      conversation** (configurable via `HERMES_ACP_CMD`/`HERMES_ACP_ARGS`/`HERMES_ACP_CWD`)
- [x] `AgentConversationsService` persistence + `AgentConversationsController`
      (`GET/POST /agent-conversations`, `GET :id`, `POST :id/messages`, SSE turn endpoint)
- [x] `AgentRuntime` + `AgentConversations` wired into `AgentsModule`
- [x] Amount-cap-on-autoApprove fix: the auto-approve path now enforces `maxAmountPerAction`
      (governance hole closed in `mcp-server.factory.ts`)
- [x] E2E suite `phase11b-agents-employes.e2e-spec.ts`

### Web
- [x] Settings → Agents employee fields (persona/role/model/autonomy/avatar)
- [x] ⌘K "AI assistant" panel — streaming conversation + proposed-action cards

### Deferred (noted at reviews — do not silently fix)
- [ ] Set `AGENT_SESSION_SECRET` (or `JWT_SECRET`) in non-dev — the dev fallback is silent and
      insecure.
- [ ] Rate cap is NOT enforced on the auto-approve path (only the amount cap is) — auto-approved
      actions don't create proposals, so there's no trailing-minute count; needs a separate
      execution counter.
- [ ] `AgentRuntimeService`: no timeout on `initialize`/`newSession` (a hung Hermes leaks the
      child process); child stderr is not consumed (could block on a full pipe); the `live` Map
      can grow unbounded if `closeSession` is never called (no TTL/sweep).
- [ ] `closeSession` during an active `prompt()` silently ends the stream without an error.
- [ ] `GET /agent-conversations/:id` is tenant-scoped but NOT user-scoped (any tenant member can
      read another member's conversation) — asymmetric with `list()`; and `get()` returns the raw
      row including `tenantId`.
- [ ] SSE turn endpoint: client disconnect does not abort the runtime turn; no SSE heartbeat
      (proxy-timeout risk on long turns).
- [ ] `tool_call`→`proposalId` correlation is not persisted on `AgentMessage` (only assistant
      text is persisted) — needed for full audit linkage.
- [ ] `start()` does a double agent lookup (`getOwned` then `conversations.start` re-fetches).
- [ ] Rename `nowMs`→`nowSec` in agent-session-token for clarity (cosmetic).
- [ ] ACP runtime smoke (`HERMES_ENABLED`): verify real byte framing (newline-delimited),
      camelCase fields / snake_case methods, the `session/set_model` param key, and that
      non-permission reverse-ACP calls don't break a turn.

## Phase 11 (R1 — runtime managé)

Goal: Hermes is **installable and configurable from Pulsar**, per tenant, without editing `.env`.

### Install + shared
- [x] `scripts/setup-agents.mjs` (`pnpm agents:setup`): installs Hermes into `hermes-agent/.venv`
      via **uv** (auto-fetches a standalone CPython 3.12 — Hermes pins 3.11–3.13, so no manual
      Python install; idempotent venv create + always re-run pip install)
- [x] `@pulsar/shared` `RUNTIME_PROVIDERS` provider catalog (pure data, browser-safe — no Node
      import; api-key vs login providers, `keyEnvVar`/`loginCommand`)

### API
- [x] `AgentRuntimeConfig` Prisma model + 20th migration `20260613211931_phase11r1_agent_runtime_config`
- [x] `agent-runtime-env.ts` env builder (per-tenant `HERMES_HOME`, provider key env var or login)
      + `runtime-config.service.ts` (encrypts the API key via `CryptoService`, never returns it)
- [x] `runtime-config.controller.ts` — `/agent-runtime` REST (`GET providers`, `GET`/`PUT`,
      `POST test`) + `POST connect` **SSE** login (streams device code + URL); gated `agents.manage`
- [x] `openSession` injects the resolved runtime config (env + decrypted key) into the spawned child
- [x] E2E `phase11r1-agent-runtime.e2e-spec.ts`

### Web
- [x] **Settings → Runtime agents** page (pick provider, paste key or "Connecter" login over SSE)

### Deferred (noted at reviews — do not "fix" silently)
- [ ] **Vendoring**: decide whether `hermes-agent/` ships in the repo (commit) or as a git
      submodule, so a fresh clone has it — today it's local/untracked (`.gitignore` only covers
      `.venv`/`.hermes-home`).
- [ ] **`HERMES_ENABLED` real smoke test**: install via `pnpm agents:setup`, configure a real
      provider (or a login like Codex — note the `--type oauth` flag may be needed in the
      `openai-codex` `loginCommand` of `runtime-providers.ts`), confirm `/test` lists models and a
      ⌘K conversation gets a real reply + a proposed action.
- [ ] `testConnection` doesn't surface real model names (`HermesAcpClient` has no advertised-models
      API) — wire it when the client exposes models.
- [ ] `connectLogin` has no `req.on('close')` abort — the login child is killed only on generator
      teardown; add explicit abort on SSE disconnect.
- [ ] `UpsertRuntimeDto` lacks `@ApiProperty` decorators (Swagger docs).
- [ ] Carry forward palier-2a deferred items not yet resolved (auto-approve rate cap,
      `tool_call`→`proposalId` persistence on `AgentMessage`, `AgentRuntime` `live` Map TTL/stderr
      consumption, SSE client-disconnect abort + heartbeat, etc. — see the palier-2a list above).
- [x] **R2 (next palier): the rich agent UI Sam asked for** — an agent profile page; an activity
      view ("what they do": conversations + tool calls + proposed actions per agent); guided config
      with inline help; a first-class chat surface beyond the ⌘K drawer. **(shipped in R2 below)**

## Phase 11 (R2 — agents experience: first-class)

Goal: agents are **first-class citizens** of the UI — a roster, a per-agent profile + guided
config, an activity view, and a dedicated chat surface.

### Shared
- [x] `@pulsar/shared` `AGENT_ROLE_PRESETS` (pure data, browser-safe): dispatcher / billing-clerk /
      analyst, each with persona + suggested permissions + suggested autonomy (`role-presets.ts`,
      vitest `role-presets.spec`)

### API
- [x] `GET /agents/:id` projects the profile (`role`/`persona`/`autonomyLevel`/`permissions`) and
      **never leaks `secretHash`/`serviceUserId`** (shared `agentSelect`)
- [x] `GET /agents/:id/activity` → `{ conversations, proposedActions, stats }` scoped tenant+agent
      (counters: conversations/pending/executed/rejected); gated `core.agents.read`
- [x] E2E `phase11r2-agent-experience.e2e-spec.ts` (profile projection + no-leak, bogus-id 404,
      empty-then-populated activity)

### Web
- [x] Top-level **Agents** nav (gated `core.agents.read`) → roster of employee cards
- [x] Per-agent page `/agents/[id]` — **Profil & config guidée** (inline help + role presets),
      **Activité** (conversations + proposed actions + counters), **Chat** (talk to this employee)

### Deferred (noted at reviews — do not "fix" silently)
- [ ] `tool_call` → `proposalId` linkage on the activity list (today the proposed-action list and
      the conversation list are shown side by side, not threaded — needs `AgentMessage.proposalId`
      persistence carried forward from palier 2a).
- [ ] `riskTier` badge tone mapping for `MUTATING`/`SENSITIVE` on the agent activity list (minor
      cosmetic — currently a neutral tone for all tiers).
- [ ] **hermes-agent/ vendoring** (carried from R1): decide commit vs submodule so a fresh clone
      has the runtime — today it's local/untracked.
- [ ] **`HERMES_ENABLED` real smoke test** (carried from R1): install + configure a real provider,
      confirm `/test` lists models and a chat turn yields a real reply + proposed action.
