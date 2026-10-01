# AGENTS.md — Pulsar

Guidance for AI coding sessions in this repository.

## What this is

Pulsar is a **multi-tenant modular logistics SaaS**. Platform core (auth/RBAC/audit/module
registry) + business modules activable per tenant. Three live modules: **Transportation (TMS)**,
**Customer Portal**, **Billing**. Phases 0–5 are shipped.
**Start with [docs/etat-du-projet.md](./docs/etat-du-projet.md)** (status + what to do next),
then [ROADMAP.md](./ROADMAP.md) / [TODO.md](./TODO.md); domain context in
[PRODUCT_SPEC.md](./PRODUCT_SPEC.md).

## Layout

| Path                | Contents                                                                 |
| ------------------- | ------------------------------------------------------------------------ |
| `apps/api`          | NestJS REST API. `src/core/*` = platform, `src/modules/*` = business     |
| `apps/web`          | SvelteKit **SPA** (Svelte 5 runes, `ssr=false`, adapter-static)          |
| `packages/shared`   | Source of truth: status enums, state machines, permission catalog, types |
| `packages/database` | Prisma schema + seed; re-exports `@prisma/client`                        |

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
    _revert_ la tâche (IN*PROGRESS→OPEN) QUE s'il l'a réellement \_claim* (sinon il finit SKIPPED
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
    writers communs via `OperationalRecordsModule` et les façades `fleet/data/*`
    (pas de duplication CRUD ni activation TMS requise; les endpoints TMS historiques restent compatibles). Tout endpoint
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
    colonne `customData Json?` de chaque entité TMS. Les _réglages de processus_ (eux) restent dans
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

## Hard rules (continued, Yard — dossiers connectés)

39. `YardDossierLink` décrit un contexte, jamais une transition : aucun stock, coût ou
    statut TMS/WMS ne change à l'ajout/retrait. Une visite liée à un rendez-vous utilise
    les liens du rendez-vous (pas de copie). Écritures via `YardDossiersService`, verrou
    de site partagé avec Yard, droits de lecture de la cible et `yard.manage`, tenant/FK
    vérifiés, compatibilité site/sens contrôlée, audit et idempotence. Un passage terminé
    est en lecture seule. Les contraintes SQL exactement une source/une cible doivent
    être préservées. Détail : `docs/plans/yard-connected-dossiers.md`.

## Hard rules (continued, WMS — poste visuel)

40. `Bin.zone` est un classement d'affichage, jamais une capacité ou un déplacement.
    Les lectures du workspace sont tenant/site-scopées et calculées à la lecture;
    ne jamais additionner les quantités d'articles/unités différents. Tous les writers
    de stock passent par `InventoryService.postMovement` et son verrou transactionnel
    de tenant, partagé avec `BinsService.update`. Site d'un bin immuable; pas de
    désactivation/changement de type avec un solde non nul. L'UI transmet
    `expectedUpdatedAt` pour les zones et confirme les MOVE existants; aucune transition
    automatique des dossiers. Contrats et limites : `docs/plans/wms-visual-workspace.md`.

## Hard rules (continued, WMS — documents guidés)

41. Les writers de réception/préparation (lignes, métadonnées, validation, annulation)
    prennent le verrou tenant AVANT de relire le document et ses lignes, via
    `lockWmsDocument`. Une édition de ligne avance aussi `updatedAt` du parent via
    `nextWmsVersion`; le client guidé transmet cette version sur chaque mutation.
    `readiness` est une lecture, jamais une réservation : besoin cumulé Decimal par
    article/bin, stock revérifié par le writer existant à la validation atomique.
    Article/bin actifs et même entrepôt revérifiés en transaction; les documents
    historiques ne sont pas recontrôlés contre le stock courant. Pas de retry après
    réponse incertaine sans inspection. Voir `docs/plans/wms-guided-operations.md`.

## Hard rules (continued, WMS — rangement et journal)

42. Un MOVE avec `operationKey` est idempotent sur `(tenantId, operationKey)` dans
    `StockMovement` : verrou tenant AVANT lookup, fingerprint lié à l'acteur et au
    corps, replay avant validation de disponibilité, conflit de contenu ⇒ 409.
    Clé, registre et soldes sont écrits dans la MÊME transaction via `postMovement`.
    Le client conserve la demande avant envoi et reprend EXACTEMENT la même clé
    après une réponse incertaine (jamais une nouvelle clé pour « réessayer »).
    `unitSnapshot` capture l'unité des nouveaux mouvements; les anciens NULL sont
    signalés, jamais backfillés par une unité supposée. Le journal est une lecture
    tenant-scopée, pas une provenance par lot ni une réservation de stock.
    Contrats et limites : `docs/plans/wms-putaway-traceability.md`.

## Hard rules (continued, Flotte — poste visuel)

43. Les mutations d’ordres de maintenance passent par le verrou tenant de
    `MaintenanceService.locked` (création, édition, démarrage et clôtures, y compris
    génération depuis un plan). Ordre + sync actif + réancrage du plan sont atomiques.
    Une clôture ne remet AVAILABLE que si l’actif est encore MAINTENANCE et n’a plus
    aucun ordre OPEN/IN_PROGRESS. Les state machines restent obligatoires, RETIRED
    n’est jamais réactivé. Audit et événement sont émis après commit via les services
    best-effort existants. Les nouveaux clients envoient `expectedUpdatedAt`;
    l’échéancier `dueDate` est UTC/display de dates limites, jamais une réservation
    d’atelier ou une disponibilité TMS. Le contexte transport du poste Flotte exige
    Transportation activé ET `transportation.planning.read`.

## Hard rules (continued, Fabrication — passerelle APS)

44. (Fabrication — passerelle APS A1) Les nouveaux calculs métier passent par
    `/internal/pulsar/run` : clé de service + tenant serveur, repositories mémoire
    par requête, use cases PlaniAdvance existants. `inputRequest`/`engineResult`
    sont immuables; le hash couvre la requête exacte. Le contrat A1 est UTC seulement.
    Le replay produit une simulation historique non publiable. Publication via le
    gate moteur, baseline attendue, révision des dossiers et verrou transactionnel
    tenant; préserver l'index partiel unique de baseline. Ne jamais supprimer de
    demande invalide ni inventer un snapshot pour un ancien run. Aucun effet WMS/TMS
    à la publication. Voir `docs/plans/manufacturing-aps-foundation.md`.

45. (Fabrication — scénarios A2.1) Le contrat V2 capture le fuseau IANA commun,
    les bornes UTC et `calendar_windows` dans la requête immuable : le rejeu ne
    recompile jamais les quarts avec les règles de fuseau courantes. Dans le moteur,
    `resolved_windows=None` signifie hebdomadaire historique, `[]` signifie fermé;
    une transformation future doit préserver ces fenêtres, jamais revenir
    implicitement aux heures locales. La revue utilise `PublishScenario.assess`
    en lecture seule. L'UI confirme avec `reviewToken`; le gate et les contrôles
    de publication A1 restent obligatoires. Aucun contournement de `review` ou
    `blocked` n'est exposé. Voir `docs/plans/manufacturing-scenario-review.md`.

46. (Fabrication — MRP M1) Le calcul MRP passe par le bridge privé PlaniAdvance
    `/internal/pulsar/mrp`, Decimal et snapshot tenant/entrepôt explicite. Les règles
    et entrées sont versionnées, les calculs immuables ; aucun stock, OF ou achat
    n'est créé par un calcul. Une réception WMS POSTED liée réduit l'arrivage attendu
    sans ajouter du stock. Ne jamais agréger les sites ni convertir les unités
    implicitement. Le poste exige Fabrication + WMS activés et leurs droits de
    lecture, y compris sur l'historique. Contrats et limites :
    `docs/plans/manufacturing-mrp.md`.

47. (Fabrication — MRP M2.1) `BomRevision`/lignes sont des artefacts publiés
    append-only; aucun writer métier ne les modifie. MAKE utilise une version
    explicite, jamais le brouillon/la dernière version implicite. SKU/unité WMS
    utilisés sont protégés sous le verrou tenant partagé. Site/version d'un OF
    sont choisis sur un DRAFT à jour; libération et `materialSnapshot` sont
    atomiques, quantités/matières ensuite figées. Aucun backfill historique.
    APS avec matières lit l'instantané et le stock du site capturé, refuse les
    OF BOM historiques non capturés et les calculs multi-sites (jusqu'à M4).
    Aucun stock/achat/OF n'est créé par le calcul MRP. Contrats et compatibilité :
    `docs/plans/manufacturing-definitions.md`.

48. (Fabrication — MRP M2.2a) Une demande CRM est un rattachement explicite unique
    par `(tenantId, sourceSalesOrderLineId)` : article/site/source immuables,
    quantité serveur et unité 1:1 reconnue ou ratio explicite capturé (règle 49).
    Ne jamais mapper par nom/SKU implicite.
    La consommation de prévision passe par `deriveDemandCoverage` (pur/exact);
    FULFILLED/INVOICED continuent de consommer, CANCELLED restitue la prévision.
    Historique/provenance figés et droits CRM revérifiés sur toute lecture dérivée.
    Les writers de lignes CRM relisent DRAFT sous le verrou tenant partagé avec
    confirmation et rattachement MRP. Aucun stock/achat/OF n'est créé par le calcul.
    Contrats et limites : `docs/plans/manufacturing-demand-sources.md`.

49. (MRP — unités commerciales et worker) `MrpProductMapping` ne convertit que les
    nouvelles demandes, par ratio explicite exact via `convertMrpCommercialQuantity`.
    Quantité source/convertie et ratio sont capturés; pas d'arrondi ni de réécriture
    rétroactive. Les revues MRP utilisent DomainEvents → OperationalTask →
    AgentWorkerService et le registre MCP, jamais un appel LLM dans le calcul.
    `submit_mrp_review` et `recalculate_mrp` sont MUTATING, passent par la gouvernance;
    la synthèse exige le contexte signé `task:<id>`, l'affectation et le service-user
    valides. `MrpReview` est append-only/idempotent. Le preset PROPOSE n'expose pas
    `resolve_task`. Revue automatique opt-in, jamais réémise par un recalcul agent.
    Aucun stock/achat/OF créé. Voir `docs/plans/manufacturing-mrp-units-ai.md`.

50. (MRP — préparation M3a) Un calcul reste une lecture sans effet opérationnel.
    La préparation humaine utilise `MrpPreparationService` : prévisualisation,
    hash recontrôlé sous verrou tenant, opération idempotente liée à l'acteur,
    numéro/document/provenance atomiques. Une proposition ne produit qu'un seul
    document. Préparation non annulée d'un autre calcul ⇒ blocage conservateur
    article/site, jamais double achat/OF. BUY reste une demande INTERNE, jamais
    stock/SUPPLY/commande fournisseur. MAKE réutilise OrdersService et son workflow;
    pas d'arrondi fractionnaire ni de suppression du lien. Les dates BOM publiées
    sont figées; aucune sélection automatique. Les postes héritent du site du
    calendrier et APS filtre les candidats par site. Aucun nouvel outil mutating
    exposé au worker. Voir `docs/plans/manufacturing-mrp-preparation.md`.

51. (MRP — achats matières M3b) Une commande `MaterialPurchaseOrder` cible une seule
    préparation BUY immuable. DRAFT ne compte jamais comme supply; CONFIRMED exige
    une confirmation humaine de commande passée hors Pulsar, jamais un envoi implicite.
    Statuts via `canTransitionMaterialPurchase`. Écritures sous verrou tenant WMS;
    créations achat/réception idempotentes (acteur/corps/clé), versions obligatoires.
    Chaque réception liée revalide article/unité/site/commande active et cumul reçu
    sous verrou au posting. Stock exclusivement via `InventoryService.postMovement`.
    MRP compte le reste CONFIRMED, jamais les brouillons ni deux fois les réceptions;
    une réception liée n'est pas réutilisable en SUPPLY manuel. Le blocage inter-calcul
    BUY n'est levé que pour une commande capturée dans le snapshot courant. Aucun
    nouvel outil mutating IA. Voir `docs/plans/manufacturing-material-purchases.md`.

52. (Fabrication — boucle opérationnelle M3c/M4/M5 v1) Avenants d'achat sous verrou
    tenant et version : clôture de reliquat distincte d'une réception, historique
    append-only, aucun stock fictif. APS capture stock/arrivages datés et une révision
    matières revalidée à la revue/publication; promesses échues exclues, date minimale
    uniquement dans le snapshot. Les déclarations atelier sont append-only/idempotentes,
    acteur/corps/clé liés; consommation explicite + production bonne passent par
    InventoryService.postMovement dans la même transaction. Rebut ne crée pas de stock.
    COMPLETED exige toutes les unités déclarées; pas d'annulation après déclaration.
    Aucun APS global sur WIP déclaré sans temps par opération. Les preuves MRP sont
    figées, le contexte IA courant est identifié; aucun nouveau pouvoir mutating.
    Voir `docs/plans/manufacturing-operational-loop.md`.

53. (Référentiels — carnet enterprise E1a, étendu E1b.5) Une `PartyDirectoryEntry` appartient à exactement
    un Customer OU BusinessPartner OU CrmCompany du tenant (FK composites et XOR SQL). Les writers
    passent par `PartyDirectoryService`, validation partagée fermée et verrou business tenant;
    entrée courante et révision append-only sont atomiques. Édition à version attendue,
    reprise liée tenant/acteur/clé/corps; rejouer retourne le reçu sans restaurer l'ancien état.
    Les façades appliquent les droits du module consommateur, jamais un module fourni dans
    le payload. La fonction et les dates de validité d'un contact sont descriptives : aucun
    accès portail, envoi, changement d'adresse principale ou réécriture de document implicite.
    Voir `docs/plans/enterprise-audit-program.md`.

54. (Coordonnées document E1b) `documentCoordinates` de ServiceQuote/CustomerInvoice/TransportOrder/SalesOrder/SupplierOrder est
    choisi via `DocumentCoordinatesService`, jamais depuis un snapshot fourni par le client.
    Tenant/propriétaire/type/version/validité sont recontrôlés; édition avec version attendue
    et verrou business tenant partagé avec le carnet. Le workflow accepte/approuve ET fige
    la copie dans la même transaction. Une facture capturée exige `expectedUpdatedAt` à
    l'approbation. Après engagement, aucune réécriture depuis le carnet; aucun backfill des
    documents historiques. Un contact choisi ne change pas le destinataire d'envoi, les taxes,
    la Location ou les droits portail. Voir `docs/plans/document-coordinates.md`.

55. (Commandes Transport E1b.2) L'édition et les transitions TransportOrder prennent le verrou
    business tenant et relisent le statut/version avant CAS. Une commande avec coordonnées
    exige `expectedUpdatedAt` pour édition/confirmation; le gel est atomique à CONFIRMED.
    Changer de client exige le retrait explicite préalable des choix. Planification :
    numéros + toutes les expéditions + statut PLANNED dans la même transaction, jamais
    de création partielle; ajout d'expédition garde le statut PLANNED par CAS. Les coordonnées
    privées ne sont pas propagées aux Locations, BOL/public, emails ou factures implicitement.

56. (Avoirs — coordonnées E1b.3) Le choix `INVOICE` projette la copie `documentCoordinates`
    gelée et appartenant au client de la facture via `invoiceCreditRecipient`, avec empreinte
    recontrôlée au premier gel. Jamais de relecture du carnet actuel pour reconstruire le passé.
    Une saisie manuelle alternative exige un motif si une copie existe. Le rejeu conserve
    instantané et PDF canoniques, y compris après panne de stockage; les anciennes empreintes
    manuelles restent compatibles. Contact capturé = suggestion explicite, jamais autorité
    d'envoi. Notes privées, livraison et email ne sont pas imprimés. Contrats :
    `docs/plans/credit-document-coordinates.md`.

57. (Factures clients — documents E1b.4) Publication hors DRAFT sous verrou de facture tenant,
    snapshot immuable et PDF canonique via DocumentsService, rattachement conditionnel et SHA-256.
    Ne jamais recalculer les taxes historiques ni choisir un upload arbitraire. Envoi explicitement
    confirmé via la voie financière MailService, un par canal; simulation/file ne changent pas
    le statut comptable. L’ancien send implicite et les options auto client sont fermés; les
    messages historiques sans canal qualifié ne sont pas rejoués. Ancien envoi ⇒ revue opérateur.
    Le portail sert le canonique vérifié dès publication, sans fallback en cas de panne.
    Aucun nouvel outil agent. Contrat et déploiement : `docs/plans/customer-invoice-documents.md`.

58. (CRM — coordonnées E1b.5) Le carnet accepte Customer XOR BusinessPartner XOR
    CrmCompany (FK tenant et XOR SQL). CRM seul utilise le carnet de la société,
    jamais un Customer déduit. La commande choisit ses versions via le service commun;
    confirmation sous verrous business puis tenant/MRP, relecture/version/CAS et gel atomique.
    Aucun backfill ni propagation implicite. Ne pas changer la forme des anciens fingerprints
    de reprise des carnets. Devise figée après confirmation; aucune conversion implicite
    des lignes. Voir `docs/plans/crm-order-coordinates.md`.

59. (Achats fournisseurs — coordonnées E1b.6) `SupplierOrder` capture le BusinessPartner
    avec `owner.kind='supplier'` et rôle `isSupplier`; jamais un client déduit. Le slot
    technique `billingAddress` signifie ici adresse DU fournisseur; `deliveryAddress`
    est interdit, car le site de réception appartient à l’acheteur. Confirmation et gel
    atomiques sous verrou business, version et CAS; changer le fournisseur exige de vider
    explicitement les choix. Aucun transfert vers WMS/MaterialPurchaseOrder/PDF/envoi.
    Une réception ne relit pas le carnet pour réécrire l’engagement. Contrats et limites :
    `docs/plans/supplier-order-coordinates.md`.

60. (Carnet — impact E1b.7) Les usages sont une lecture bornée par entrée et type,
    filtrée AVANT requête par module et droits consommateurs. Aucun compteur de document
    masqué. FK du document ET propriétaire du snapshot doivent correspondre au carnet;
    aucun parcours implicite des liens Customer/BusinessPartner/CRM. Brouillons et copies
    figées historiques sont distincts; la revue d’une entrée ne valide pas tout le dossier.
    Aucun writer, propagation ou backfill. Contrat : `docs/plans/directory-document-impact.md`.

61. (Fiches entreprise et identités E1b.8) `PartyBusinessProfile` est privé, descriptif et
    appartient à un seul Customer/BusinessPartner/CrmCompany (XOR + FK tenant). Validation
    fermée par `validatePartyProfile`, version obligatoire et verrou business; aucune
    propagation aux documents/portails ou règle opérationnelle implicite. Les rapprochements
    réutilisent `ServicesCommerceService.partnerLinks`; revue/confirmation recontrôlent
    acteur, versions et cibles, droits consommateurs avant projection. Ne jamais retourner
    `CrmCompany.customerId` dans une projection CRM sans droits sur la famille Customer.
    Les writers CRM de liens/conversion prennent le même verrou; aucune correspondance
    contradictoire ni client dupliqué sur lecture périmée. Voir
    `docs/plans/enterprise-information-depth.md`.

## Hard rules (continued, Catalogue/Achats)

62. (Catalogue/Achats I1a) `CatalogItemDetails` est privé, validé par `validateCatalogDetails`
    et versionné sous verrou business tenant. Mesures par unité seulement, jamais conversion
    ou capacité implicite. `CatalogSupplierOffer` : FK tenant, une référence courante par
    article/fournisseur, prix/minimum/multiple dans l’unité catalogue. Choix explicite
    ID+version sur ligne; `captureSupplierTerms` revalide exactement sous verrou à la saisie
    ET confirmation. Snapshot serveur figé après engagement, aucun backfill. Pas de coûts
    fournisseur dans Services ni de nouveau pouvoir IA. Voir `docs/plans/catalog-purchasing-depth.md`.

63. (Catalogue/Achats I1b) `CatalogPackage` : contenu/code/code-barres/fractionnement immuables,
    libellé/activation versionnés sous verrou business tenant. `packageQuantity` est l’unique
    conversion exacte, sans arrondi (commande 4 décimales, WMS 3). Prix et quantités des lignes
    restent en unité de base. Choix ID/version/nombre revalidé à saisie ET confirmation;
    snapshot serveur figé ensuite, lu à réception sans réinterprétation du catalogue courant.
    Scan = sélection sans mutation. Nombre de colis reçu conservé, fingerprint historique
    préservé si absent; stock uniquement par le writer WMS transactionnel existant.
    Voir `docs/plans/catalog-packaging.md`.

64. (WMS — lots I2a) `lotTracked` est opt-in à création et immuable, sans backfill. `WmsLot`
    identité/dates sont immuables. Réception/préparation/mouvement portent une FK composite
    tenant/article/lot. `postMovement` exige/refuse le lot selon l’article, vérifie le solde
    du lot et écrit solde lot + total + journal sous le même verrou/transaction. Aucun
    prélèvement implicite sur un autre lot. Readiness groupe article/bin/lot, sans réservation.
    Dates déclaratives seulement, aucun FEFO/quarantaine. Writers non équipés et comptages
    agrégés refusent les articles suivis. Fingerprints/replays historiques préservés sans lot;
    reprise navigateur conserve le lot exact. Voir `docs/plans/wms-lots.md`.

## Hard rules (continued, WMS — comptages)

65. (WMS — comptages I2b) Writers de comptage sous le verrou tenant de stock avant lecture.
    Snapshot immuable article/lot/unité et nombre de mouvements du bin; changement du registre
    (même net zéro) ⇒ 409, jamais recalage automatique. NULL historique ⇒ consultation/annulation,
    pas de réconciliation ni backfill. Toutes les lignes exigent une quantité explicite.
    Réconciliation via state machine + CAS et postMovement dans la même transaction.
    Ajustement manuel avec operationKey : acteur/corps/lot signés, replay avant disponibilité,
    clé unique partagée avec MOVE; même clé/corps après réponse incertaine. Aucun effacement
    aveugle d’intention navigateur. Contrat : `docs/plans/wms-lot-counts.md`.

## Hard rules (continued, Services — lots des pièces)

66. (Services — lots I2c) `ServicePartUsage.lotId/lotSnapshot` sont des preuves immuables
    capturées à la consommation, avec FK tenant/article/lot et sans backfill historique.
    Verrou business puis WMS; usage + PICK + soldes total/lot dans la même transaction.
    Un retour conserve le lot/bin/article/unité d’origine; vérifier sa preuve PICK avant
    postMovement, jamais suivre une nouvelle correspondance Catalogue ni accepter un lot
    du client au retour. Droits WMS et avoirs toujours vérifiés; lecture historique Services
    seule sans projection de stock courant. Fingerprints sans lot historiques inchangés.
    Une reprise incertaine conserve sa clé/corps/lot, même si la reprise est refusée.
    Voir `docs/plans/services-part-lots.md`.

## Hard rules (continued, Fabrication — lots atelier)

67. (Fabrication — lots I2d) Les déclarations capturent `evidence.version=2`, lots sources
    et lot produit explicites, dans la même transaction que les mouvements et soldes WMS.
    Une ligne zéro ne porte pas de lot; rebut seul ne produit aucun stock. Un lot de sortie
    par déclaration, plusieurs lots/bins par composant. Généalogie directe de cette déclaration
    seulement : jamais d’allocation par pièce ou rattachement implicite aux consommations
    antérieures. Les preuves v1 et fingerprints sans lot restent inchangés, aucun backfill.
    Lien OF du journal WMS gardé par Fabrication activée + manufacturing.read avant projection.
    Reprise incertaine garde clé/corps/lots après refus intermédiaire. Voir
    `docs/plans/manufacturing-lots.md`.

## Hard rules (continued, Fabrication — corrections atelier)

68. (Fabrication — corrections I2e) Contrepassation complète v2 sur OF IN_PROGRESS seulement.
    Revue/version/hash puis recontrôle sous verrou tenant WMS; correction, ajustements via
    postMovement, soldes et version d’OF atomiques. Retrait produit avant restitutions;
    mêmes lots/bins/unités, manque ⇒ refus. Original immuable, aucune réouverture/édition
    destructive. Quantités nettes et impacts excluent les contrepassées; MRP capture la
    correction sans réécrire les anciens runs. APS global et annulation OF restent gardés
    par tout historique. Replay lié acteur/corps/clé; reprise UI conserve la demande après
    refus intermédiaire. Aucun nouvel outil IA. Voir `docs/plans/manufacturing-reversals.md`.

69. (WMS — quarantaine I2f) La disposition d’un lot entier passe par la state machine partagée,
    révision attendue et verrou tenant WMS. Décision append-only et état atomiques; replay lié
    tenant/acteur/corps/clé avant version. Libération : wms.lots.release + motif/compte rendu.
    postMovement bloque toutes les jambes sortantes sauf MOVE conservant le lot; entrées et
    retours ne libèrent rien. Ajustements négatifs/comptages/contrepassations ne contournent pas
    le blocage. MRP/APS/impacts excluent le stock bloqué au site; snapshots historiques intacts.
    Aucun effet automatique de Qualité ni nouvelle permission IA. Voir `docs/plans/wms-lot-quarantine.md`.

## Hard rules (continued, Qualité — contrôles de lots)

70. (Qualité ↔ lots I2g) Source LOT immuable dès la création, FK tenant/article/lot,
    identité + révision de disposition + compteur de mouvements capturés. Verrou business
    puis WMS à création/clôture; mouvement même net zéro ou décision ⇒ contrôle périmé.
    Aucun effet stock d’une inspection. Citation facultative à la libération : Qualité active
    - quality.read, même lot, COMPLETED/PASS, version exacte et contexte inchangé sous verrou
      WMS. Résumé figé dans la décision append-only; replay exact après droits actuels, anciens
      fingerprints manuels préservés. Preuve structurée masquée sans lecture Qualité; source
      masquée sans lecture WMS. Pas de rattachement rétroactif ni rappel transitif. WMS seul
      garde sa libération manuelle. Voir `docs/plans/quality-lot-controls.md`.

## Hard rules (continued, WMS — traçabilité bornée)

71. (Lots I2h) La traçabilité amont/aval est une lecture RepeatableRead, jamais un
    workflow de rappel. Liens depuis preuves v2 et mouvements exacts d’une même déclaration
    non contrepassée; chronologie physique et bornes explicites obligatoires. Aucun lien
    reconstruit depuis BOM ou stock actuel, aucune allocation par pièce ni somme des sorties
    répétées entre arêtes. Les dossiers directs couvrent toutes les dates du lot, sans les
    attribuer à un chemin. WMS autonome; métadonnées Fabrication/Services/Transport seulement
    avec module et droits de lecture correspondants. Aucun effet de stock, blocage ou IA.
    Voir `docs/plans/wms-lot-traceability.md`.

72. (WMS I2i — sorties documentées) DISPOSAL/SUPPLIER_RETURN passent par
    `StockExitsService` : DRAFT ne réserve rien, revue fraîche et confirmation humaine
    avec `wms.stock.dispose|return`, version et reprise acteur/clé/corps. Verrou business
    puis WMS; mouvement, soldes lot/total, preuve et POSTED atomiques. Le writer central
    exige un dossier DRAFT exactement correspondant et sans mouvement antérieur;
    `stock-exit` est une source réservée, index partiel unique à préserver. Seule la
    quantité documentée peut sortir en quarantaine, sans libérer le reste. Fournisseur
    explicite capturé, changement avant sortie bloquant; WMS autonome sans Achats.
    POSTED/CANCELLED terminaux. Aucun avoir, transport, envoi externe ou outil IA ajouté.
    Voir `docs/plans/wms-stock-exits.md`.

73. (WMS I2j — rapprochement et justificatifs) Le retour peut capturer une réception
    fournisseur POSTED exacte (fournisseur/article/lot/site/unité), jamais un lien implicite.
    Source/copie immuables; cumul DRAFT+POSTED borné par la ligne reçue, sous verrou business
    puis WMS. La lecture commerciale et les écritures liées/replays exigent Achats + read;
    WMS autonome reste possible. Les reçus ne diminuent pas et aucun avoir n’est calculé.
    `WmsStockExitEvidence` est append-only et n’altère pas la preuve/updatedAt du dossier.
    Upload via DocumentsService, type réservé aux endpoints métier, précontrôle/recontrôle
    sous verrou, fichier non lié nettoyé, reprise acteur/clé/corps/hash identiques. Ajout
    après POSTED identifié, aucun nouvel ajout CANCELLED, aucune suppression de pièce liée.
    Voir `docs/plans/wms-return-purchase-evidence.md`.

## Hard rules (continued, WMS — suivi fournisseur)

74. (WMS I2k — suivi fournisseur) `SupplierReturnReport` est append-only : cumuls reçus,
    acceptés, refusés, version attendue, pièce du même retour POSTED, motif obligatoire
    pour baisse/date antérieure. Verrou business puis WMS, reprise acteur/clé/corps,
    humains actifs et wms.stock.return. Calculs exacts Shared; aucune mutation du parent,
    de sa preuve/updatedAt, des mouvements, des reçus d’achat ou de la finance. WMS autonome;
    copie commerciale I2j toujours gardée séparément. Voir `docs/plans/wms-supplier-return-followup.md`.

## Hard rules (continued, Finance — factures fournisseur documentaires)

75. (I2l.1) `SupplierInvoice` est distinct des factures transporteur et clients.
    Finance seul fonctionne via les références partagées; montants déclarés exacts,
    aucune taxe/prix inféré. DRAFT → QUALIFIED/CANCELLED via state machine Shared,
    verrou business, version attendue et opération acteur/clé/corps atomique.
    QUALIFIED fige lignes et original, sans paiement, grand livre, stock ni envoi.
    Justificatifs protégés via DocumentsService, append-only et upload DRAFT seulement.
    Liens d’achat explicites : mêmes fournisseur/devise/unité, module/droit Achats
    revérifiés, snapshot commercial masqué sans accès, y compris sur reprise.
    Une acceptation WMS ne crée jamais de crédit financier. Aucun nouveau pouvoir IA.
    Contrat et limites : `docs/plans/billing-supplier-invoices.md`.

## Hard rules (continued, Finance — avoirs fournisseur reçus)

76. (Finance I2l.2 — avoir reçu) SupplierCredit ne référence qu’une SupplierInvoice
    QUALIFIED, source immuable et devise/fournisseur hérités. Montants déclarés sans
    quantité physique; cumuls QUALIFIED plafonnés par ligne et position de taxe via
    supplierCreditBalance, recontrôlés sous verrou business à qualification. Brouillons
    sans réservation, state machine, version et reprise acteur/clé/corps obligatoires.
    Original du même avoir protégé; aucune mutation de facture, stock ou comptabilité.
    Retour facultatif = dernière révision SupplierReturnReport du même fournisseur,
    copie figée; nouvelle révision bloque le brouillon, jamais réécriture historique.
    Accès WMS revérifié pour les mutations/replays liés, contexte masqué sans accès.
    Aucun prix d’achat ni montant déduit du retour. Voir `docs/plans/billing-supplier-credits.md`.

77. (Finance I2l.3 — dossier fournisseur) Dossier = lecture financière seulement,
    aucune dette/paiement inférée. Synthèse QUALIFIED exacte par devise via Shared,
    indépendante des filtres; pas de Number monétaire, pas de store de rollup.
    UNION paginées et count en snapshot RepeatableRead; toutes les branches/jointures
    sont tenant-scopées. Aucun snapshot ou ID Achats/WMS ni clé de stockage exposé.
    Les preuves utilisent les téléchargements protégés existants. Voir
    `docs/plans/billing-supplier-dossiers.md`.

78. (Finance I2m.1 — échéancier fournisseur) Planning opérationnel, jamais une dette
    comptabilisée ou preuve de paiement. Révisions append-only via
    `canTransitionSupplierSchedule`, revue hashée, version, confirmation humaine,
    verrou business tenant partagé avec factures/avoirs et reprise acteur/clé/corps.
    Sommes exactes du reste QUALIFIED, sans conversion de devise; nouvel avoir ⇒
    À revoir calculé, anciennes dates hors prévision jusqu’à reconfirmation.
    Dates civiles distinctes croissantes, zéro explicite, retrait sans effacer.
    Lecture/synthèse paginées SQL sous RepeatableRead, pas de balance historique.
    Ne jamais brancher ce registre sur le GL historique sans devise ni les paiements
    clients/transporteurs. Aucun nouvel outil mutating IA.
    Contrat : `docs/plans/billing-supplier-schedules.md`.

## Hard rules (continued, Finance — devise du journal)

79. (Finance I2m.2a — devise du journal) Toute nouvelle écriture capture la devise
    de sa source, jamais un défaut tenant; historique NULL sans backfill. Seules les
    contrepassations de paiements historiques NULL peuvent créer un NULL (exception
    amortissement fermée depuis I2m.2c). Reversal = devise originale; avoir client exige original
    connu de même devise, ou qualifié par le rapprochement I2m.2d.2b (règle 84).
    Writers par LedgerService.postTx, verrou GL tenant avant
    lookup, validation exacte Shared, audit dans la même transaction. Saisie manuelle
    UUID/acteur/corps, reprise exacte; pas d’effacement d’une demande incertaine.
    Rapports GL par devise explicite, SQL NUMERIC + Shared BigInt, couverture dans
    le même snapshot; jamais sommer les devises. Aucun change, période fermée ou
    branchement du registre fournisseur documentaire dans ce lot. Contrat et API :
    `docs/plans/billing-ledger-currency.md`.

80. (Finance I2m.2b — préparation comptable) Le profil est une cible configurable,
    jamais une activation du GL officiel ni un défaut de devise/conversion.
    Révisions append-only, droit dédié, version et reprise acteur/UUID/corps.
    Les nouveaux budgets figent devise et dates inclusives UTC; historique NULL
    laissé en lecture seule. Révisions et archivage sans suppression, verrou
    business tenant, audit atomique, replay avant revalidation des comptes.
    Écarts exacts dans le snapshot du budget; couverture limitée aux comptes
    sélectionnés, pas de faux total entre natures comptables. Voir
    `docs/plans/billing-accounting-profile-budgets.md`.

81. (Finance I2m.2c — immobilisations) Nouveaux actifs à devise explicite; anciens
    NULL en lecture seule. Plan exact Shared figé à l’activation après reviewToken,
    jamais régénéré pour un actif actif. Dotations chronologiques, fin civile UTC
    non future, montant serveur; période nulle tracée sans faux GL. Writers sous
    verrou business tenant puis GL, version et UUID/acteur/corps; replay avant
    nouvel état. Dotation/cumul/journal/opération/audit atomiques. Humain actif et
    `billing.assets.post`, aucun nouvel outil agent. Retrait motivé via state machine,
    aucune suppression ni cession comptable implicite. Voir
    `docs/plans/billing-fixed-assets-currency.md`.

82. (Finance I2m.2d.1 — reprise historique) La qualification manuelle concerne
    seulement les écritures NULL manuelles/sans source, jamais les sources métier.
    Aucun writer ne modifie les lignes originales ni leur devise NULL : annotation
    QUALIFIED/WITHDRAWN versionnée via Shared, preuve protégée et revue liée à
    l’acteur. Humain actif + `billing.ledger.qualify`; business lock puis GL;
    annotation/révision/audit atomiques, reprise UUID/acteur/corps avant état courant.
    Retrait motivé sans contrepassation. Lectures GL/rapports/budgets utilisent la
    devise effective et signalent la qualification actuelle des périodes historiques.
    Aucun nouvel outil agent. Voir `docs/plans/billing-historical-qualification.md`.

## Hard rules (continued, Finance — reprise des paiements)

83. (Finance I2m.2d.2a — paiements historiques) Qualification via rapprochement du
    paiement/affectations/original/contrepassation, jamais par le parcours manuel.
    Devise attestée = source; NULL original conservé. `sourceEntryId` relie les
    annotations atomiques; révision sur l’original, enfants non modifiables seuls.
    Verrous business → paiement → GL, mêmes droits source sur preuve/replay.
    Annulation inverse les lignes originales et transmet leur annotation dans la
    même transaction; jamais les réglages courants. Qualification/retrait interdits
    tant que le paiement est rapproché en banque. Voir
    `docs/plans/billing-payment-qualification.md`.

## Hard rules (continued, Finance — reprise des factures)

84. (Finance I2m.2d.2b — factures historiques) La reprise rapproche facture,
    lignes, taxes figées, tiers, journal et avoirs clients émis dans le tenant.
    Aucun GL absent créé, taux recalculé ou payable déduit pour remplacer le header.
    Facture NULL et avoirs NULL sont qualifiés/retirés atomiquement avec provenance
    `sourceEntryId`; pas de décision enfant. Avoir connu conservé tel quel et retrait
    isolé interdit. Nouvel avoir après reprise : devise source connue, jamais NULL;
    source recontrôlée sous verrou facture partagé avec qualification/retrait.
    Verrous business → facture → GL; droits facture sur dossier/preuve/replay.
    Cents exacts Shared, aucun nouveau pouvoir IA ni activation TMS implicite.
    Contrat et limites : `docs/plans/billing-invoice-qualification.md`.

## Hard rules (continued, Finance — paiements partiellement affectés)

85. (Finance I2m.2d.2c) La qualification d'un paiement historique porte uniquement
    sur ses affectations positives : journal exact = somme affectée ≤ montant
    déclaré, via `reconcilePaymentLedger` (Shared). Le reste est hors journal,
    jamais crédit client, avance fournisseur ou preuve bancaire implicite.
    Montants déclaré/affecté/reste capturés dans la revue et montrés dans l'UI;
    original/contrepassation gardent les règles 83. Aucun solde ou affectation
    modifié par la reprise. Banque exige toujours une affectation complète,
    même après qualification. Voir `docs/plans/billing-partial-payment-qualification.md`.

## Hard rules (continued, Finance — payable transporteur accepté)

86. (Finance I2m.2d.2d) Une reprise de facture transporteur ajustée exige une
    acceptation `ACCEPT_INVOICED` unique/cohérente dans l'audit du tenant et le
    rapprochement exact des lignes reçues/écarts, via Shared. Payable = header,
    jamais somme attendue; net comptabilisé = payable moins taxes déjà figées,
    validé contre le journal existant. Aucun recalcul fiscal ou GL manquant créé.
    La revue capture les montants et l'empreinte de la décision; source réévaluée
    sous les verrous de la règle 84. Attendu/reçu/payable/écarts distincts dans l'UI,
    droits source sur preuves/replays, aucun nouveau pouvoir IA. Voir
    `docs/plans/billing-accepted-carrier-qualification.md`.

## Hard rules (continued, Finance — dotations historiques groupées)

87. (Finance I2m.2d.2e.1) Les dotations historiques d'un actif se qualifient ou
    se retirent ensemble, ancrées sur la première période, jamais individuellement.
    `reconcileAssetHistory` (Shared exact) rapproche chaque GL existant et le cumul;
    mois absents signalés, aucun recalcul ni GL créé. La devise est explicitement
    attestée sur preuve; actif/périodes/journaux NULL restent inchangés et le plan
    futur reste bloqué. Revue capturée, verrou business → actif → GL, annotations
    groupées/révision/audit atomiques, reprise UUID/acteur/corps. Droits actifs et
    journal sur dossier/preuve/replay, aucun nouveau pouvoir IA. Voir
    `docs/plans/billing-asset-history-qualification.md`.

## Pilot preparation P1a

Le précontrôle d'Exploitation est réservé au plan plateforme : lecture seule,
aucune migration, email, action métier ou appel LLM. La comparaison des migrations
est bornée et retourne inconnu en cas d'échec, jamais zéro. Noms/checksums/erreurs
brutes et secrets ne sont pas exposés. `derivePilotReadiness` (Shared pur) ne donne
jamais un verdict prêt production : les preuves VPS/métier/IA restent une recette
distincte. Profil et option IA ne changent ni modules ni réglages. Voir
`docs/plans/pilot-next-stage.md`.

## Customer workspace P2a

Le dossier 360° est une lecture RepeatableRead via les façades PARTY_ACCESS.
Filtrer PARTY_WORKSPACE_SOURCES par module ET droit document AVANT requête ou
compteur; le droit référentiel ne suffit pas. Une seule correspondance actuelle
Customer/BusinessPartner/CrmCompany, jamais de transitivité ni matching par nom.
Toute relation de sélection porte tenantId serveur, y compris les anciennes FK
CRM. Recherche/pagination en base, erreurs explicites et projection fermée; aucun
total monétaire, document privé, mutation ou pouvoir IA. Voir
`docs/plans/customer-workspace.md`.

## Services work acceptance P3a.1

L’acceptation porte sur le rapport de travaux terminés, jamais les quantités/prix.
Choix `acceptanceRequired` en DRAFT seulement; défaut false, aucun backfill supposé.
Décisions via `canTransitionServiceAcceptance`, humain actif et droit dédié;
verrou business, version/CAS, record append-only et audit atomiques, UUID/acteur/corps.
ACCEPTED terminal; le client du projet est figé dès une décision. Facture Services
et clôture relisent l’exigence sous le même verrou. Aucune signature client ou action
IA implicite. Contrat : `docs/plans/services-work-acceptance.md`.

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

## Hard rules (communications — Telnyx / email)

- SMS via `SmsService` : core, tenant-scopé, utilisateur humain actif, confirmation,
  version de connexion et clé acteur/corps/tenant. Registre et audit avant réseau,
  cap de tentatives sous verrou tenant; aucun nouvel outil agent ou réaction sortante.
- Réel SMS autorisé dans l’UI par tenant (`liveAuthorized`, confirmation humaine,
  version et audit); `SMS_DRIVER` ne contrôle plus l’envoi. Migration fail-closed.
  API Telnyx fixe, aucun retry après engagement.
  SENDING/UNKNOWN ne doivent jamais être réémis : conserver la demande, inspecter le
  fournisseur. Les transitions utilisent `canTransitionSms`; ACCEPTED n’est pas DELIVERED.
- Retours Telnyx : octets raw + signature Ed25519/fenêtre 5 min, tenant résolu côté
  serveur, profil/numéros contrôlés. Conserver l’index partiel unique profil/numéro
  vérifié. Événement dédoublonné et audit atomiques sous verrou SMS; rapprochement
  exact par ID fournisseur, jamais par texte. Livraison via `canTransitionSmsDelivery`.
  STOP tenant/numéro bloque toute nouvelle préparation; START ne lève rien. Aucun
  effet externe automatique. La télémétrie webhook ne change pas la version config.
- Secrets par tenant chiffrés via CryptoService, projections sans ciphertext. Changer
  hôte/identifiant SMTP ou IMAP retire l’ancien secret sans remplacement explicite.
  SMTP tenant peut envoyer réellement même en EMAIL_DRIVER=log; désactiver ce SMTP
  réutilise le transport plateforme, sans kill switch global implicite.
- IMAP : routeur `TenantInboundDriver`, `inboundLive` confirmé dans Pulsar, jamais
  EMAIL_DRIVER. Migration des anciennes boîtes en simulation; compte changé ⇒
  nouvelle confirmation humaine. SMTP plateforme reste le repli historique.
- Contrats et limites : `docs/plans/communications-telnyx-email.md`.

## Known gotchas / debt (don't "fix" silently, see TODO.md)

- IA A1 : lancement ACP via `scripts/pulsar-hermes-acp.py`, environnement OS en
  liste fermée + clé tenant, workspace tenant. Outils MCP Pulsar seulement; refus
  de toute permission hôte ACP, protocole 1 requis. Ne jamais restaurer l’auto-allow
  ni ignorer un échec du modèle choisi. Changer fournisseur/auth/URL retire l’ancien
  secret/login et invalide tests/modèles; résultat de test/login lié à la version.
  Diagnostic = métadonnées locales sans LLM, contrôle ACP != inférence validée.
  Qualifier le wrapper/fork avant upgrade; aucun sandbox OS revendiqué. Contrat :
  `docs/plans/ai-runtime-renewal.md`.
  A2a : reprise par `session/load` avec rejet explicite `None` dans le wrapper;
  jamais `session/resume` qui peut créer une autre session sans identifiant retourné.
  `scripts/fixtures/hermes-qualification-entry.py` est exclusivement un banc isolé,
  jamais un point d’entrée API. Candidat 0.21.5 non promu : contrat et blocages dans
  `docs/plans/ai-runtime-qualification.md`.
  A2b/A3a : le wrapper classe les champs structurés de `AIAgent`, jamais sa prose,
  dans `_meta.pulsarTurn` v1. Résultat absent/invalide ⇒ échec; `end` seul n’est pas
  un succès. Worker : un seul résultat réussi sans erreur; aucune relance automatique
  après un tour commencé/FAILED/KILLED. Annulation ne défait aucun effet métier.
  Libération d’une tâche réellement claimée via `releaseWorkerClaim`, state machine,
  CAS IN_PROGRESS→OPEN et audit; jamais rouvrir RESOLVED. Timeout de tour 120 s,
  enfant arrêté; compteurs explicitement cumulatifs, jamais un prix inventé.
  Titres IA auxiliaires désactivés. Contrat : `docs/plans/ai-turn-outcomes.md`.
  A2c.1 : `deploy/agents` est un banc OFFLINE, jamais un runner de production.
  Ne lui monter ni secrets ni homes réels ni socket Docker. Son réseau est `none`;
  manifestes et lock vérifiés avant/après. Ne pas confondre deux homes synthétiques
  dans un conteneur avec une frontière OS inter-tenants. L'API OVH reste sans Hermes;
  non-root/read-only avec seul volume documents inscriptible, migration explicite
  des anciennes permissions. Contrat : `docs/plans/ai-linux-qualification.md`.
  A2c.2 : production distante via `services/agent-runner` / `deploy/agent-runner`.
  Une identité, un volume, un réseau interne et un secret par tenant; routage
  serveur uniquement, aucun fallback local en mode remote. ACP duplex fermé ⇒
  enfant arrêté, aucun retry/replay de prompt. A2d : quatre processus simultanés
  par défaut (plafond opérateur 1–8), un par conversation, libérés après le tour;
  reprise stricte. Configuration de groupe immuable tant qu’un enfant vit, login
  OAuth exclusif; ne jamais réécrire config.yaml à chaque démarrage concurrent.
  Le runner ne connaît ni DB ni JWT. Le chat global est core, permission chat;
  historique tenant/utilisateur, un tour par conversation sur l’instance API.
  Multi-réplicas API exige un bail distribué, pas le Set local actuel.
  Egress HTTPS exact via proxy, jamais de Docker socket, provider env en liste
  fermée, wrapper Pulsar inchangé. OAuth ne valide que la version capturée.
  L’image offline n’est pas réutilisée. Contrat : `deploy/agent-runner/README.md`.
  Usage/concurrence : `docs/plans/global-ai-workspace.md`.
  A2e : images privées via DocumentsService/type protégé agent-chat-image;
  propriétaire/conversation/message revérifiés avant lecture, jamais accès générique.
  ACP inline seulement, 4 × 512 Kio; capture ponctuelle explicitement confirmée.
  Le wrapper conserve les pixels (pas d’override de persistance textuel), interdit
  vision auxiliaire et fallback text-only après rejet. Ne pas retirer ces gardes
  sur upgrade sans requalifier le test multimodal et la reprise historique.

- Communications de dossier C3a : accès fermé `COMMUNICATION_ACCESS`, module/droit
  source + canal sur lecture ET replay. Suggestions par FK explicite tenant-scopée,
  jamais matching par numéro/nom. Journal exact par dossier; SMS liés exclus du
  journal global. Préférence tenant/canal/coordonnée versionnée avec preuve auditée,
  inconnue bloquante dans les dossiers; STOP ne se réactive pas ici.
  Registre/audit avant réseau; SMS via le hook interne de `SmsService`, courriel
  via un seul appel `EmailService` avec SMTP tenant capturé (sinon simulation,
  jamais repli plateforme). UNKNOWN/SENDING sans retry. Aucun fichier financier,
  auto-envoi ou nouvel outil IA. Contrat : `docs/plans/dossier-communications.md`.

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
