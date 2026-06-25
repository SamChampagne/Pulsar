# CLAUDE.md — Pulsar

Guidance for AI coding sessions in this repository.

## What this is

Pulsar is a **multi-tenant modular logistics SaaS**. Platform core (auth/RBAC/audit/module
registry) + business modules activable per tenant. Three live modules: **Transportation (TMS)**,
**Customer Portal**, **Billing**. Phases 0–5 are shipped.
**Start with [docs/etat-du-projet.md](./docs/etat-du-projet.md)** (status + what to do next),
then [ROADMAP.md](./ROADMAP.md) / [TODO.md](./TODO.md); domain context in
[PRODUCT_SPEC.md](./PRODUCT_SPEC.md).

## Layout

| Path                | Contents                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| `apps/api`          | NestJS REST API. `src/core/*` = platform, `src/modules/*` = business    |
| `apps/web`          | SvelteKit **SPA** (Svelte 5 runes, `ssr=false`, adapter-static)         |
| `packages/shared`   | Source of truth: status enums, state machines, permission catalog, types|
| `packages/database` | Prisma schema + seed; re-exports `@prisma/client`                       |

## Commands

```bash
pnpm setup        # install + prisma generate + build shared/database
pnpm db:up        # start postgres (docker)
pnpm db:migrate   # prisma migrate dev (run from repo root)
pnpm db:seed      # seed catalogs + demo tenant (admin@pulsar.dev / admin123, tenant: acme)
pnpm dev          # api :3000 + web :5173 (web proxies /api → :3000)
pnpm build        # build everything (order matters: shared → database → api → web)
pnpm typecheck    # all workspaces
pnpm test         # unit tests (state machines in packages/shared)
pnpm test:e2e     # full workflow over HTTP — needs a seeded DB (db:up + db:migrate + db:seed)
```

Swagger: http://localhost:3000/api/docs. Env: copy `.env.example` → `.env` at the repo root.

## Hard rules

1. **Tenant isolation**: every query on tenant-scoped tables MUST filter by `tenantId` taken from
   the JWT (`@CurrentUser()`). Never trust a tenantId from the request body.
2. **Status changes go through the state machines** in `packages/shared/src/workflows`. Never
   `update({ status })` directly without a `canTransition*` check.
3. **Enums live in `packages/shared`** and are mirrored in `schema.prisma` with identical value
   names. Change both together; regenerate (`pnpm db:generate`) and migrate.
4. **Apps import Prisma via `@pulsar/database`**, never `@prisma/client` directly.
5. **Permissions**: every new endpoint needs `@RequirePermissions(...)`; business-module
   controllers also need `@RequireModule(MODULE_KEYS.X)` at class level. New permission keys go
   in `packages/shared/src/permissions.ts` (catalog) and are picked up by the seed.
6. **Audit**: status changes and sensitive mutations call `AuditLogsService.log()`.
7. After changing `packages/shared` or `packages/database`, **rebuild them** (`pnpm setup` or the
   package's `build` script) — the API consumes their `dist/`.

## Hard rules (continued, phase 4)

13. API-key requests act as the tenant's hidden service account
    (`service-account@pulsar.local`, DISABLED). Never make that account loginable, and never
    attribute key actions to a fake/non-User id.
14. Master-data create/update endpoints carry `@Audit(entityType, action)`; new ones must too.
    Workflow services keep explicit `AuditLogsService.log` calls (before/after state).
15. Public pages of a business module must re-check module activation in the service
    (`TenantModulesCacheService`) — public routes bypass ModulesGuard (see PortalService).

## Hard rules (continued, phase 7)

16. Le snapshot `Load.costDetail` est figé : jamais de recompute sur un load COMPLETED,
    et le rapprochement de factures lit `estimatedCost`/`costDetail`, jamais un recalcul.
17. Le lane matching passe par les clés normalisées (`@pulsar/shared` rating/lane-key) et
    l'ordre `compareLanes` — ne jamais réimplémenter la normalisation ou le tie-break.
18. Tout endpoint qui modifie poids/volume/palettes d'un shipment ASSIGNÉ à un load doit
    re-déclencher `checkCapacity` sur ce load (niveau warning) ; et toute écriture de
    `Shipment.loadId` doit maintenir `shipment_load_legs` dans la même transaction.

## Hard rules (continued, phase 10)

19. Tout appel OSRM/Nominatim passe par `RoutingService` (core/routing) — best-effort,
    timeout 3 s, jamais bloquant. `Route.distanceSource = MANUAL` n'est JAMAIS écrasé
    par un recalcul ; `geometry` est purement display (jamais d'usage billing).
20. Le payload public de suivi n'expose qu'UNE position (la dernière, load non livré)
    et les coordonnées origine/destination du shipment — jamais d'historique ni les
    autres stops d'une tournée. `active-map` n'embarque pas de géométrie.

## Hard rules (continued, phase 11)

21. Les outils exposés à un agent passent TOUJOURS par le registre
    (`core/agents/tool-registry.ts`) : un outil = {tier, permission, module, schéma zod,
    handler}. Jamais exposer une opération en appelant un contrôleur directement ; le
    handler réutilise les services métier existants via l'adaptateur `AGENT_TOOL_SERVICES`.
22. Un outil `MUTATING`/`SENSITIVE` ne s'exécute JAMAIS dans le handler MCP : il est mis en
    file comme `ProposedAction`. Seul `ProposedActionsService.approve` exécute le vrai appel,
    après re-vérification du statut (claim atomique `updateMany PENDING→APPROVED`) et des
    plafonds, attribué au service-user de l'agent et audité avec l'approbateur. READ/LOW
    s'exécutent en direct.
23. La portée d'un agent = ses `permissions` ∩ modules activés du tenant ∩
    `caps.toolAllowlist` (filtré dans `buildAgentMcpServer`). `caps.autoApprove` est le SEUL
    contournement de la file (exécution directe d'un outil mutating sans humain) ; l'audit
    repose alors sur les services métier sous-jacents (`@Audit`/`AuditLogsService.log`).
    Les plafonds (`evaluateAmountCap`/`evaluateRateCap`) et l'idempotence
    (`deriveIdempotencyKey`) vivent dans `@pulsar/shared` — ne pas les réimplémenter.
24. (palier 2a) Les **agents-employés** tournent sur Hermes via ACP — **un processus enfant
    par conversation** (isolation tenant : l'enregistrement MCP de Hermes est process-global) —
    et sont configurés ENTIÈREMENT dans Pulsar (l'entité `Agent` : persona/rôle/modèle/autonomie).
    Leurs appels d'outils passent TOUJOURS par la file de gouvernance palier 1 + les plafonds :
    le chemin d'auto-approbation (autonomie `ACT_LOW`/`AUTONOMOUS`) applique LUI AUSSI le plafond
    montant (`mcp-server.factory.ts`) — l'autonomie ne lève jamais les caps. Le runtime d'agent
    est best-effort et isolé : Hermes indisponible ⇒ 503, jamais de crash du cœur de Pulsar.
25. (R1 — runtime managé) Le runtime Hermes s'installe via `pnpm agents:setup` (venv Python
    provisionné par **uv**, CPython 3.12 autonome) et se configure ENTIÈREMENT dans Pulsar,
    **par tenant** (`AgentRuntimeConfig`) : soit une clé API **chiffrée via `CryptoService`**
    (jamais renvoyée en clair), soit un login OAuth dont les jetons vivent dans le `HERMES_HOME`
    par tenant — jamais dans la BD Pulsar. La liste des providers vient du catalogue
    `RUNTIME_PROVIDERS` de `@pulsar/shared` (**pure data, browser-safe, aucun import Node**).
26. (R2 — espace agents) L'UI des agents est de premier ordre : `/agents` (roster de cartes
    employés) + `/agents/[id]` (profil & config guidée, activité, chat). `GET /agents/:id` et
    `GET /agents/:id/activity` n'exposent JAMAIS `secretHash`/`serviceUserId` (projection via le
    `agentSelect` partagé) ; les presets de rôle vivent dans `AGENT_ROLE_PRESETS` de
    `@pulsar/shared` (pure data).

## Hard rules (continued, phase 12)

27. (phase 12 — Operating Workbench) Les `OperationalTask` ne changent de statut QUE via
    `canTransitionOperationalTask` (`@pulsar/shared/workflows`). Une tâche produite par une
    policy est idempotente sur `(tenantId, dedupKey)`. Les événements métier passent par
    `DomainEventsService.emit` (best-effort, jamais bloquant) ; le worker `processPending` est
    race-safe (claim conditionnel `PENDING→PROCESSED`) et les échecs sont terminaux (pas de retry).
    Les policies événement→tâche vivent dans `@pulsar/shared/operating` (pures) ; l'assignation à
    un agent (`caps.alwaysOn` + `caps.handlesCategories`) se résout côté API. Le
    `WorkbenchAgentRunner` est best-effort et isolé (Hermes absent ⇒ skip, tâche revenue OPEN,
    jamais de crash, `runCron` n'émet jamais d'exception) ; les actions de l'agent passent
    TOUJOURS par la file `ProposedAction` avec `triggeredByRef = "task:<id>"` (porté par le jeton
    de session) — l'autonomie n'exécute jamais hors caps.

## Hard rules (continued, phase 13)

28. (phase 13 — Main-d'œuvre 24/7) Tout réveil d'un agent always-on passe par
    `AgentWorkerService` (dispatcher unique, file en mémoire, concurrence plafonnée
    global/tenant/agent) ; chaque réveil est enregistré comme `AgentRun` (durable). Un run ne
    *revert* la tâche (IN_PROGRESS→OPEN) QUE s'il l'a réellement *claim* (sinon il finit SKIPPED
    sans toucher l'état d'un autre run). `PAUSED` est le kill switch à chaud réversible (tue les
    sessions Hermes en vol via `AgentRuntimeService.killAgentSessions`) ; `REVOKED` reste
    permanent. Le retry ne s'applique qu'aux erreurs de connectivité runtime
    (`ServiceUnavailableException`, classées par `classifyRunError` de `@pulsar/shared`) ; Hermes
    absent ⇒ run `SKIPPED`, tout autre échec est terminal et renvoie la tâche en OPEN. Le
    dispatcher est best-effort et isolé (règle 24 préservée : jamais de crash, `runCron`/
    `enqueueTask` n'émettent jamais d'exception) ; les actions de l'agent passent TOUJOURS par la
    file `ProposedAction` avec `triggeredByRef = "task:<id>"`.

## Hard rules (continued, phase 14)

29. (phase 14 — Autonomie & policies) Toute décision auto-act vs propose passe par
    `evaluatePolicy` (`@pulsar/shared`, pur) au **point d'application unique**
    (`ProposedActionsService.handleMutatingTool`, appelé par le handler MCP) ; les règles
    effectives viennent de `caps.policies` ou du preset dérivé de `autonomyLevel`
    (+ `caps.autoApprove` legacy). Une action auto-approuvée est TOUJOURS persistée comme
    `ProposedAction EXECUTED autoApproved=true` (auditable + comptée pour le cap débit — le
    chemin auto respecte désormais le débit). Le cap MONTANT dur (`maxAmountPerAction`) est
    toujours appliqué dans `enqueue` sur TOUS les chemins (seule enforcement montant pour un
    agent en PROPOSE) ; au-dessus → DENY, jamais levé par l'autonomie. Le circuit breaker
    (`Agent.breakerTrippedAt`) rétrograde en PROPOSE de façon réversible et ne modifie JAMAIS
    `autonomyLevel` ; la promotion d'autonomie est TOUJOURS confirmée par un humain (jamais
    d'escalade automatique). Règles 23/24 préservées (le moteur de policy/caps vit dans
    `@pulsar/shared`, pur).

## Hard rules (continued, phase 15)

30. (phase 15 — Control Tower observabilité) Les KPI, rollups et timeline du Control Tower sont
    calculés **à la lecture** depuis `AgentRun`/`ProposedAction`/`OperationalTask`/`AuditLog`
    (aucun store de rollup, aucune migration) ; les calculs de ratio/fusion vivent dans
    `@pulsar/shared` (`deriveAgentKpis`, `mergeTimeline` — purs) ; le compteur de trips de breaker
    vient des `AuditLog` `entityType='agent'` / `after.breakerTripped=true` (alimente aussi le
    `breakerTrips` du trust score) ; toute projection agent/KPI exclut `secretHash`/`serviceUserId`
    (règle 26) et reste scopée `tenantId` (règle 1).

## Hard rules (continued, phase 16)

31. (phase 16 — Freight Audit) L'audit de facture transporteur entrante (`IncomingCarrierInvoice`)
    matche chaque ligne contre `Load.estimatedCost` **figé** (jamais recalculé — règle 16), via le
    service déterministe `FreightAuditService` ; l'agent ne calcule jamais les variances, il propose.
    Les transitions passent par `canTransitionFreightAudit` (`@pulsar/shared`, règle 2) ; le matching
    réutilise `evaluateReconciliation` + les tolérances buy-side (jamais réimplémenté). L'ouverture de
    litige par un agent passe TOUJOURS par le gate `handleMutatingTool` → `ProposedAction`
    (`triggeredByRef = "task:<id>"`, tier SENSITIVE, cap montant sur `varianceTotal`) — règles 22/29.
    `recoveredAmount` n'est positif que sur une résolution `KEEP_EXPECTED` ; il alimente le KPI
    économies. Tenant isolation (règle 1) + module gating (`@RequireModule(BILLING)`) sur tout endpoint.

## Hard rules (continued, module Fleet)

32. (module Fleet — maintenance & conformité) Le statut d'un asset de flotte
    (`Vehicle`/`Trailer.status: AssetStatus`) ne change via le module Fleet QUE par le workflow de
    maintenance : ouvrir un `MaintenanceOrder` ⇒ asset `MAINTENANCE`, COMPLETED/CANCELLED ⇒
    `AVAILABLE`. Les transitions du WO passent par `canTransitionMaintenanceOrder` (`@pulsar/shared`,
    règle 2) avec claim conditionnel `updateMany` (TOCTOU) ; le sync asset est gardé par
    `canTransitionAsset` (best-effort, **jamais** sortir `RETIRED`, jamais throw) et audité (règle 6).
    Un `MaintenanceOrder` cible exactement UN asset (`vehicleId` XOR `trailerId`, validé en service).
    Le statut de conformité est **calculé** (`computeComplianceStatus`, pur `@pulsar/shared`), JAMAIS
    persisté ; `ComplianceDocument.subjectId` est une FK souple polymorphe (VEHICLE/TRAILER/DRIVER) dont
    l'ownership est vérifiée en service selon `subjectType` (règle 9). Le roster d'assets réutilise les
    endpoints `transportation/{vehicles,trailers,drivers}` (pas de duplication CRUD). Tout endpoint
    Fleet est `@RequireModule(MODULE_KEYS.FLEET)` + `fleet.read|manage`, tenant-scopé (règle 1) ;
    fichiers via `DocumentsService` (règle 12).

## Hard rules (continued, module WMS)

33. (module WMS — inventaire & flux entrepôt) Dans le module WMS, tout changement de stock passe par un
    `StockMovement` (registre append-only, source de vérité) ET met à jour le `InventoryLevel` correspondant
    dans la MÊME transaction (`InventoryService.postMovement`) — jamais de mutation directe d'un solde. Toute
    sortie (`PICK`, et la jambe sortante d'un `MOVE`) vérifie la disponibilité avant de poster ; un mouvement
    qui rendrait un bin négatif est refusé (409), SAUF un `ADJUSTMENT` explicite — et même un ajustement ne
    descend pas un bin sous 0. Les statuts `Receipt`/`PickOrder` ne changent que via `canTransitionReceipt`/
    `canTransitionPickOrder` (`@pulsar/shared/wms`, règle 2) avec claim conditionnel `updateMany` (TOCTOU) ;
    n° de documents via `SequencesService` (RC-/PK-, règle 8). L'entrepôt est une `Location` type `WAREHOUSE`
    (pas de nouvelle entité). Tout endpoint WMS est `@RequireModule(MODULE_KEYS.WMS)` + `wms.read|manage`,
    tenant-scopé (règle 1) ; FK vérifiées par `OwnershipService` (règle 9).
    (v2 — tressage TMS) Un `PickOrder` peut référencer un `Shipment` (`shipmentId?`) ; son `locationId`
    DOIT alors égaler `shipment.originLocationId` (Location `WAREHOUSE`), validé dans
    `PickingService.create`. Le décrément reste à la complétion du pick (inchangé). L'état « préparé »
    d'un shipment est **dérivé** de ses pick orders liés (`deriveShipmentPickStatus`, pur
    `@pulsar/shared`) — JAMAIS un nouveau `ShipmentStatus`, JAMAIS de blocage du dispatch (règle 2
    préservée) ; toute la surface vit dans le module WMS (aucun contrôleur TMS modifié).

## Hard rules (continued, module Yard)

34. (module Yard — cour & quais) Le statut d'une `YardVisit`/`DockAppointment` ne change QUE via
    `canTransitionYardVisit`/`canTransitionDockAppointment` (`@pulsar/shared/yard`, règle 2) avec claim
    conditionnel `updateMany` (TOCTOU). Un spot occupé (visite active CHECKED_IN/ASSIGNED dessus) ne peut
    recevoir une autre visite : refus 409 ; l'occupation est **dérivée** (count des visites actives sur le
    spot), jamais dénormalisée. Tout changement de `spotId` d'une visite écrit un `YardMove` dans la **même**
    transaction (`VisitsService.assignToSpot`/`checkOut`). N° via `SequencesService` (YV-/DA-, règle 8).
    Spots et sites sont des `Location` du tenant. Tout endpoint Yard est `@RequireModule(MODULE_KEYS.YARD)` +
    `yard.read|manage`, tenant-scopé (règle 1) ; FK (trailer/carrier/location/spot/appointment) vérifiées (règle 9).
    (Plan v2) `YardSpot.posX/posY` sont **display-only** (disposition du plan de cour) : jamais utilisés dans
    l'occupation/affectation/transitions (dérivées + serveur). `PUT /yard/spots/layout` ne persiste que des
    coordonnées d'affichage (tenant-scopé, `yard.manage`) ; le glisser-déposer du plan appelle les endpoints
    existants `assign`/`move` (gardés).

## Hard rules (continued, TMS configurable)

35. (TMS configurable v1) Les valeurs `customData` passent TOUJOURS par `validateCustomFields`
    (`@pulsar/shared`) avant persistance — jamais écrites sans validation (ni sur create, ni sur
    update). Les définitions vivent dans la table dédiée `CustomFieldDefinition` (tenant-scopée,
    `@@unique([tenantId, module, entityType, key])`) ; les valeurs sont tenant-scopées dans la
    colonne `customData Json?` de chaque entité TMS. Les *réglages de processus* (eux) restent dans
    `TenantModule.settings` via le framework de config. Le compteur de séquence est indexé
    sur la **clé** (`SequenceKey`), jamais sur le préfixe — changer `documentPrefixTransportOrder`
    ne remet pas le compteur à zéro.

## Hard rules (continued, Billing configurable)

36. (Billing configurable v1 — gabarit arc C) `CustomFieldsService` (`core/custom-fields`) est
    générique : il est paramétré par `module` (string) et délègue toute persistance à
    `CustomFieldDefinition` (`tenantId_module_entityType_key` unique). Chaque module branche son
    propre contrôleur `<module>/custom-fields` gated `@RequireModule` + permission `<module>.manage`.
    Les valeurs `customData` sont validées par `validateValues('billing', …)` à l'intake —
    jamais écrites sans validation (règle 35 généralisée). Les préfixes de numéros de documents
    billing (`invoiceNumberPrefix`, `customerInvoiceNumberPrefix`) sont stockés dans
    `TenantModule.settings` et résolus par `SequencesService` — le compteur est indexé sur la
    **clé de séquence**, jamais sur le préfixe (changer le préfixe ne remet pas le compteur à
    zéro). `defaultCurrency` est lu par `FreightAuditService.create` et `InvoicesService.createDraft`
    comme valeur de repli (jamais forcé si la devise est explicitement fournie). `autoSendOnApproval`
    est best-effort dans `approve()` : un échec d'envoi laisse le relevé à APPROVED sans erreur.

## Hard rules (continued, arc A — Control Tower de flux)

37. (arc A — Control Tower de flux) Les 3 endpoints `GET /analytics/flow/{timeline,map,trace}` sont
    **calculés à la lecture** depuis `DomainEvent`/`OperationalTask`/`ProposedAction` via les helpers
    purs `buildFlowChains`/`buildFlowMap`/`buildEntityTrace` (`@pulsar/shared/analytics/flow`) —
    **jamais de store de rollup, jamais de migration**. Les outils agent `get_flow_timeline` et
    `trace_entity` sont READ (exécutés en direct, jamais mis en file). Tout endpoint flow est
    `@RequireModule(ANALYTICS)` + `analytics.read`, tenant-scopé (règle 1). `moduleOfEventType`
    (même package) est la seule source de vérité pour la correspondance type→module — ne pas
    réimplémenter.
## Hard rules (continued, arc B — tressage automatique)

38. (arc B — réactions déterministes `RUN_ACTION`) Les réactions cross-module ne s'exécutent
    QUE via `ReactionExecutorService` (whitelist `REACTION_CATALOG` de `@pulsar/shared`) ; elles
    sont idempotentes sur `(tenantId, eventId, ruleId)` (unique constraint `ReactionExecution`) ;
    anti-boucle single-hop : un `DomainEvent` portant `reactionRuleId` n'est JAMAIS ré-évalué
    par des règles `RUN_ACTION` dans `processPending`. Le chemin est best-effort (échec → statut
    `FAILED`, jamais bloquant) et audité sous le service-account de l'agent (règle 13). Les
    effets externes (appels vers des systèmes tiers, envoi d'email, etc.) restent gouvernés par
    les agents (règles 22–29) — jamais dans un handler de réaction. `AutomationModule` n'importe
    JAMAIS `WmsModule` ni `BillingModule` statiquement (cycle JS) ; `ReactionExecutorService`
    résout `PickingService`/`CustomerInvoicesService` via `ModuleRef.get()` + lazy `require()`.

## Hard rules (continued, courriel bidirectionnel)

39. (courriel bidirectionnel + threads CRM) La réception passe TOUJOURS par un
    `InboundEmailDriver` (core/email/inbound — `log` en dev/CI, `imap` quand
    `EMAIL_DRIVER=smtp`) ; l'ingestion (`InboundIngestService`) est idempotente sur
    `messageId`, threade via headers RFC puis match `CrmContact.email` (décisions PURES
    `resolveThreadDecision`/`normalizeSubject` de `@pulsar/shared` — ne pas réimplémenter),
    et est best-effort/isolée par tenant (le cron ne throw JAMAIS, un tenant en échec
    n'affecte pas les autres). Les pièces jointes entrantes passent par `DocumentsService`
    (règle 12) ; le secret IMAP est chiffré via `CryptoService` et jamais renvoyé en clair
    (règle 25, projection `hasImapPassword`). `EmailMessage` est réutilisé (`direction`
    INBOUND/OUTBOUND) ; tout endpoint threads est `@RequireModule(CRM)` + `crm.read|manage`,
    tenant-scopé (règle 1), FK vérifiées (règle 9). Les réponses agent passent TOUJOURS par
    la file `ProposedAction` (`crm_reply_thread` SENSITIVE, `crm_link_thread` MUTATING —
    règles 22/29).

## Hard rules (continued, module Sites)

40. (module Sites — pages de destination publiques) Le payload public `GET /public/sites/:slug`
    est une **projection explicite** (jamais `tenantId` ni référence interne — règle 10) ; le
    service public re-vérifie l'activation du module SITES **et** le statut `PUBLISHED` de la page
    avant de répondre (règle 15 — la route `/public/**` bypass le `ModulesGuard`). La soumission
    de formulaire (`POST /public/sites/:slug/submit`) crée un lead CRM **uniquement si le module
    CRM est actif** — résolu via `ModuleRef.get(ContactsService)` (jamais d'import statique de
    `CrmModule` — règle 38 pattern). Le champ anti-spam `_hp` (honeypot) renvoyé non vide est
    silencieusement rejeté (200 sans création). Le slug est **globalement unique**
    (`@@unique([slug])`) — la route publique résout le tenant depuis le slug, donc il ne peut
    pas être scopé par tenant ; `slugify` de `@pulsar/shared` est la seule source de
    normalisation — ne pas réimplémenter.

## Hard rules (continued, Billing general ledger)

41. (Billing general ledger — grand livre double-entrée) Le grand livre est **double-entrée** :
    toute `JournalEntry` est postée UNIQUEMENT via `LedgerService.post` qui applique `isBalanced`
    (`@pulsar/shared`) — un lot non équilibré est refusé (400), jamais silencieux. L'auto-post
    depuis les transitions billing (approve/pay) est **best-effort** (jamais bloquant pour la
    transition) et **idempotent** sur `(tenantId, sourceType, sourceId, sourceKind)` (unique
    constraint `journal_entries`). Les mappings code-compte (`accountCode`) et l'activation de
    l'auto-post (`ledgerAutoPost`) sont configurables dans `TenantModule.settings` billing
    (framework de config — règle 36) ; les valeurs par défaut viennent du `DEFAULT_CHART`
    (`@pulsar/shared`). La balance de vérification (trial balance) est **calculée à la lecture**
    depuis `JournalLine` (aucun rollup, aucune migration supplémentaire). Le `normalBalance` d'un
    compte est **dérivé** de son `AccountType` via la fonction pure `normalBalance` (`@pulsar/shared`)
    — jamais persisté. Le plan comptable par défaut est seedé idempotement pour le tenant acme
    (upsert sur `(tenantId, code)`).

## Hard rules (continued, Billing Payments)

42. (Billing Payments — paiement comme entrée unique) `Payment`/`PaymentAllocation`/`ModeOfPayment`
    sont la seule voie de paiement billing. Tout paiement passe par `PaymentsService.submit` qui
    poste le GL **transactionnellement** via `LedgerService.postTx` (`sourceType='payment'`,
    `sourceId=payment.id`, `sourceKind=undefined`) ; l'annulation poste une écriture inversée
    (`sourceKind='reversal'`) dans la même transaction. Les statuts `Payment` ne changent QUE via
    `canTransitionPayment` (`@pulsar/shared`). Le mark-paid des relevés clients (`POST
    customer-invoices/:id/pay`) exige le statut `SENT` (pas `APPROVED`) et retourne le relevé
    mis à jour. Le mark-paid des factures transporteur (`POST invoices/:id/mark-paid`) retourne
    la facture mise à jour. Les deux endpoints créent et soumettent un `Payment` en coulisse —
    jamais de GL direct. `ModeOfPayment.accountCode` désigne le compte caisse/banque ; les
    comptes AR/AP viennent des réglages billing (`arAccountCode`/`apAccountCode`). Le plan
    comptable est seedé via `ensureChart` (idempotent) avant toute transaction GL.

## Hard rules (continued, Billing Taxes)

43. (Billing Taxes — TVA / TPS multi-taux) La taxe est appliquée aux relevés clients et factures
    transporteur UNIQUEMENT via `PATCH billing/customer-invoices/:id/tax` et
    `PATCH billing/invoices/:id/tax` (statut DRAFT requis, jamais auto-appliquée) ;
    `isDefault` est un indicateur de pré-sélection UI, pas un déclencheur automatique.
    Un `TaxTemplate` (SALES → relevés clients, PURCHASE → factures transporteur) agrège N lignes
    (`TaxTemplateLine` : taux + `accountCode`) ; appliquer un gabarit de mauvais type renvoie 400.
    `computeTax` (`@pulsar/shared`, pur) calcule la taxe à partir des lignes : flat-on-net v1
    (`rate × netAmount` par ligne, arrondi à 2 décimales, somme = `taxAmount`). `totalAmount =
    netAmount + taxAmount` (montant brut, ce qui est dû). Effacer la taxe : passer
    `taxTemplateId: null` (remet `taxAmount=0`, `totalAmount=netAmount`). Toute approbation avec
    taxe > 0 génère une écriture GL **fractionnée** best-effort + idempotente (règle 41) :
    relevé client → DR AR gross / CR Revenue net / CR compte-taxe par ligne du gabarit ;
    facture transporteur → DR Expense net / DR compte-taxe (input-tax) par ligne / CR AP gross.
    Les `accountCode` référencés par les lignes du gabarit doivent exister dans le plan comptable
    du tenant (400 sinon). Tout endpoint taxes est `@RequireModule(BILLING)` +
    `billing.taxes.read|manage`, tenant-scopé (règle 1).

## Adding a business module (the recipe)

1. Reserve the key in `packages/shared/src/modules.ts` (it's probably already in `MODULE_CATALOG`;
   flip `available: true`).
2. Add permission keys to `packages/shared/src/permissions.ts`.
3. Add Prisma models (with `tenantId` + indexes), migrate, reseed.
4. Create `apps/api/src/modules/<key>/` with controllers gated by
   `@RequireModule(MODULE_KEYS.<KEY>)`, register in `app.module.ts`.
5. Add navigation in `apps/web/src/routes/(app)/+layout.svelte` conditioned on
   `$auth.tenant.enabledModules`.
6. Reseed or enable via `PATCH /api/v1/modules/<key>`.

## Conventions

- REST: `/api/v1/...`, plural resources, workflow actions as `POST :id/<verb>`
  (see [docs/api-conventions.md](./docs/api-conventions.md)).
- Lists return `Paginated<T>` (`items/total/page/pageSize`); use `paginationArgs`/`paginated`
  helpers from `apps/api/src/common/pagination.ts`.
- DTO validation with class-validator; update DTOs use `PartialType` from `@nestjs/swagger`.
- Web pages follow the existing pattern: `$state` + `$effect`-triggered `load()`, `api<T>()`
  client from `$lib/api/client`, errors in a local `error` string.
- Prettier is the only formatter (`pnpm format`); no ESLint configured yet.

## Hard rules (continued)

8. Document numbers (TO/SH/LD) come from `SequencesService.nextNumber()` — never generate them
   any other way.
9. Every foreign key accepted in a write payload must be checked with
   `OwnershipService.assertOwned(IfSet)` before persisting.
10. Public (`/public/**`) payloads must never expose `tenantId` or internal references — build
    explicit projections (see docs/collaboration.md). Capability tokens come from
    `randomBytes(24).toString('base64url')`.
11. Anything that changes a load's rate, route distance or shipment mix must call
    `LoadCostService.recompute()`.
12. Files go through `DocumentsService.upload/download` (FILE_STORAGE driver) — never touch the
    filesystem or S3 directly from feature code.

## Known gotchas / debt (don't "fix" silently, see TODO.md)

- Permissions are embedded in the JWT → role changes apply at next **refresh** (15 min max).
- `ModulesGuard` uses a 30 s in-memory cache (single-process; Redis when scaling out).
- Email: `EMAIL_DRIVER=log` in dev/CI (logs only). Senders: tender links, invitations/resets,
  delivered notices.
- Webhooks go through a durable outbox (`webhook_deliveries`, 5 retries with backoff).
- Auto-tender chains advance best-effort: a failure logs and leaves the load PLANNED.
- Web route building is v0: stops auto-generated from shipments (pickups then deliveries);
  manual reordering is a phase-1 leftover.
- The e2e suites (`apps/api/test/*.e2e-spec.ts`) need a running, seeded database; they create
  their own master data with unique codes so reruns are safe.
