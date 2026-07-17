# Plan canonique — Pulsar Operational Convergence

> Statut : **en cours**. Branche : `operational-convergence` (depuis `main` à `f4abb52`).
> Objectif du stage : faire passer Pulsar de « bêta avancée riche en fonctionnalités » à un
> stade de maturité opérationnelle — stabilisation, UX opérationnelle, workflows intermodules,
> agents utiles, préparation production. **Aucun nouveau module métier** tant que l'existant
> n'est pas cohérent, connecté, rapide et fiable.
>
> Ce document est la source de vérité de l'exécution. Il est mis à jour au fil des waves.

---

## 1. État réel observé (baseline vérifiée le 2026-07-16)

Vérifié contre le code, pas seulement la doc :

- **Typecheck** : `pnpm typecheck` → **0 erreur, 41 avertissements** (a11y Svelte, préexistants ;
  concentrés sur `crm/deals/[id]`, `crm/sales-orders/[id]`, `sites/[id]`, `sites`, `crm/inbox`).
- **Build** : réussi (rapporté par l'audit précédent).
- **Tests** : 786 unit ✅ ; E2E 537 ✅ / 1 échec / 1 skip. L'échec E2E réussit en isolation
  → **pollution de données / dépendance à l'ordre** (à confirmer et isoler, Wave 6).
- **Périmètre** : 141 modèles Prisma, 69 migrations, 116 contrôleurs, 133 services, 131 pages
  Svelte, 13 modules activables, 84 permissions, 56 outils agent.
- **Architecture métier forte** ; le problème n'est plus le manque de features mais : finition,
  cohérence, rapidité opérationnelle, visibilité transversale, fiabilité UI, interconnexion
  perçue, preuve de valeur des agents, préparation production.

### Manques structurels confirmés

- Pas de healthcheck général (`/health/live`, `/health/ready`).
- Pas de déploiement cloud reproductible complet (API + web).
- Runtime agent réel non connecté dans l'environnement audité.
- Très faible couverture UI automatisée (aucun Playwright).
- Caches/queues en mémoire (modules 30 s, dispatcher agents en mémoire, throttle Nominatim
  in-process) → non multi-instance.

---

## 2. Problèmes confirmés (vérifiés dans le code)

| # | Problème | Preuve (fichier) | Impact |
|---|----------|------------------|--------|
| P0-A | `CarrierPortalService.getView()` **n'expose pas** `load.id` ni `invoice.id`, mais l'UI les utilise comme clés `{#each}` et dans les URLs d'upload POD/pièce jointe | `carrier-portal.service.ts:158-181` vs `carrier-portal/[token]/+page.svelte:25-49,106,126,222,282` | `each_key_duplicate` dès 2 loads/invoices ; upload vers `/loads/undefined/pod` |
| P0-B | `SitesService.list()` **n'inclut pas** `_count.submissions`, mais la table le rend | `sites.service.ts:35-38` vs `sites/+page.svelte:31,179` | crash rendu `Cannot read properties of undefined` |
| P0-C | Page Gantt demande `pageSize: 200` alors que le max API est **100** | `manufacturing/scheduling/+page.svelte:73` ; `ListQueryDto` max 100 | work centers >100 affichés en ID brut dans le Gantt |
| P0-D | Bouton agent « Exécuter maintenant » peut afficher un succès sans résultat observable | à cartographier (`agents/[id]`, run-now) | succès trompeur |
| P0-E | Actions conducteur possiblement modifiables sur un load `COMPLETED` | à cartographier (portail conducteur + state machine) | contournement workflow |
| P0-F | Projection publique tender pauvre en contexte décisionnel | à cartographier (`TendersService`, public tender payload) | transporteur décide sans contexte |

Les baselines P0-A/B/C sont **entièrement vérifiées** ; D/E/F seront cartographiés en tête de
leurs tâches respectives (contrat exact + fichiers) avant modification.

---

## 3. Workstreams (mission)

1. **WS1 — Stabilisation P0** : corriger les bugs confirmés + tests de régression.
2. **WS2 — UX opérationnelle** : shell responsive, primitives partagées, densité, i18n, a11y,
   IDs humains, recherche/navigation contextuelle.
3. **WS3 — Interconnexion** : rendre visibles et testés les workflows canoniques intermodules
   (lead-to-cash, procure-to-pay, warehouse-to-delivery, asset-to-dispatch,
   manufacturing-to-fulfillment, exception-to-resolution).
4. **WS4 — Agents utiles & durables** : LLM-agnostique, 2 agents phares (Freight Audit, Dispatch
   Exception), transparence agent, harness d'évaluation, KPIs.
5. **WS5 — Tests & qualité** : Playwright, contrats API/UI, a11y, responsive, isolation E2E, CI.
6. **WS6 — Production & cloud** : health, logs structurés, correlation IDs, conteneurs, runtime
   durable, runbook, chemin Redis/queue.

---

## 4. Ordre d'exécution (waves) + cases de progression

> Règle : **terminer complètement chaque wave** (code + test dans l'UI réelle + workflow métier)
> avant d'élargir la suivante. Ne jamais déclarer terminé sur la seule compilation.

### Wave 0 — Audit & plan canonique
- [x] Lecture AGENTS.md / etat-du-projet / api-conventions
- [x] Vérification des bugs P0-A/B/C contre le code
- [x] Baseline typecheck (0 err / 41 warn)
- [x] Branche `operational-convergence` créée depuis `main`
- [x] Plan canonique écrit (ce document)

### Wave 1 — Stabilisation P0
- [x] **P0-A** Carrier portal : `id` loads/invoices exposé (projection scopée transporteur) + e2e `carrier-portal.e2e-spec.ts` 2/2 (ids distincts, pas de fuite tenantId/carrierId)
- [x] **P0-B** Sites : `_count.submissions` dans `list()` + e2e sites scénario 9 (liste multi-soumissions) — suite 9/9
- [x] **P0-C** Manufacturing : chargement paginé complet des work centers (`loadAllWorkCenters`, pages de 100) — corrige aussi le 400 dur (pageSize 200 > @Max 100)
- [x] **P0-D** Agents : « Exécuter maintenant » honnête — gate `runNow` (503 si runtime non installé/non configuré/sans modèle via `AgentRuntimeService.readiness`), `worker.runNow` retourne `{enqueued,runId,taskId,reason}`, UI ne toast un succès que si un run est créé (sinon info/erreur), `toast.info` ajouté ; phase13 B4/C1 verts
- [x] **P0-E** Conducteur : guard serveur `assertLoadMutableByDriver` (COMPLETED/CANCELLED → 400) sur updateStop/POD/photo/signature + UI masque actions & bannière ; e2e `driver-load-closed` 3/3 + collaboration vert
- [x] **P0-F** Tender public : projection explicite enrichie (`offeredRate`/`offeredCurrency`, `mode`, volume, fenêtres pickup/delivery, origine/destination) ; page web affiche taux proéminent + O/D + fenêtres ; assertions e2e collaboration
- [x] Critère de sortie : typecheck 0 err, suites affectées vertes (sites 9/9, carrier-portal 2/2, driver-load-closed 3/3, collaboration, phase13 10/10), erreurs explicites, **zéro assouplissement métier**

### Wave 2 — Fondations UX ✅ (2026-07-16)
- [x] Shell responsive : sidebar off-canvas (drawer) < `lg`, top-bar mobile (hamburger + bell + profil), `p-4 lg:p-6`, portails publics ≥360 px (overflow-x-auto sur tables carrier/portal) — commit `258eaa3`
- [x] Primitives partagées **utiles** (sous-ensemble ciblé, YAGNI) : `Drawer`, `RelatedEntities` (« Lié à »), `ExceptionBanner`, `StatusTimeline` — câblées dans `loads/[id]` — commit `2884392`. (Existaient déjà : PageHeader, Table, Badge, EmptyState, ErrorNotice, Skeleton, Modal, CommandPalette, Toasts, TrackingTimeline.) Reportées (non nécessaires avant un consommateur réel) : WorkQueue, EntitySummary, NextBestActions, AgentRecommendation, SavedView, recherche globale d'entités.
- [x] États loading/empty/error cohérents : 9 pages `[id]` alignées sur `Skeleton`/`ErrorNotice`, sweep i18n français des primitives partagées — commit `19bf8ea`
- [x] Dashboard orienté attention & **multi-module** (gated `enabledModules`, chaque bucket best-effort isolé) : retard/bloqué, décisions PENDING, tâches ouvertes, exceptions coût (freight-audit), CRM, récent — commit `3974b42`
- [x] i18n : pas de framework (hors périmètre) ; sweep de cohérence français des primitives partagées. Décision d'architecture i18n = dette documentée.

### Wave 3 — Deux vertical slices intermodules ✅ (2026-07-16)
- [x] **Lead-to-cash** (pipeline **CRM réellement connecté**) : deal (WON + lignes) → convert Customer → SalesOrder → confirm/fulfill/invoice → réaction `crm.sales_order.invoiced` → CustomerInvoice DRAFT → approve/send/pay + 2 écritures GL équilibrées. E2e `lead-to-cash.e2e-spec.ts` 1/1 — commit `f69873b`.
- [x] **Freight-audit-to-resolution** : déjà entièrement couvert par `phase16-freight-audit.e2e-spec.ts` (intake→audit→FLAGGED→dispute→resolve KEEP_EXPECTED→recoveredAmount→savings KPI ; +MATCHED→PAID) — vérifié vert (22/22 avec crm-cross-module). Pas de duplication.
- [x] UI de relations : `RelatedEntities` (« Lié à ») + `StatusTimeline` câblés sur `transport-orders/[id]` (client, chargements, expéditions, historique) et `crm/sales-orders/[id]` (deal, société, client) — commit `d8c4ee6`. (Déjà sur `loads/[id]` en Wave 2.)
- **⚠️ Découverte invalidante du plan** : il n'existe **aucun chemin de code** `SalesOrder` → `TransportOrder` (grep confirmé). Le lead-to-cash « pur » du plan (CRM→TMS→livraison→facture) est en réalité **deux pipelines séparés** convergeant seulement au `Customer` partagé. La slice lead-to-cash prouvée est donc le pipeline CRM→billing. Construire un pont SO→TO (schéma + migration + sémantique origine/destination) est un **choix stratégique** laissé à décision (cf. résumé).

### Wave 4 — Agents ✅ (2026-07-16)
- [x] Runtime réel connectable + testé (provider LLM remplaçable **par tenant**, 8 providers, clé chiffrée/OAuth) — déjà en place ; le cas « runtime down » est désormais couvert par le harness d'éval + `testConnection`.
- [x] Freight Audit Agent : outils `audit_carrier_invoice` (READ, variance) + `dispute_carrier_invoice` (SENSITIVE, cap) déjà présents ; `$ récupéré` via `GET /freight-audit/savings`.
- [x] Dispatch Exception Agent : outils **ajoutés** — `list_dispatch_exceptions` (READ), `check_load_capacity` (READ), re-tender via `tender_load` (SENSITIVE, cap) — commit `abdcd9c`, e2e 5/5.
- [x] Transparence agent : `GET /agent-runtime/readiness` + chip readiness (raison `blockReason` FR) + « pourquoi en attente » par action proposée — commit `61f970f`, e2e 2/2.
- [x] Harness d'évaluation : `agent-evals.e2e-spec.ts` — 16 assertions (scoping/outil interdit, cap dur, mutating→file, idempotence, course d'approbation, isolation cross-tenant, args hostiles/prompt-injection, runtime-down gracieux) — commit `2d7306a`, 16/16.
- [~] KPIs agent : génériques déjà calculés (`deriveAgentKpis` : approval/auto/error rate, runs, breaker, tasks). KPIs **spécifiques domaine** (dispute $ récupéré, exceptions rattrapées) = dette légère documentée.

### Wave 5 — Workflows supplémentaires ✅ (2026-07-16)
- [x] Relations UI cross-module câblées sur WMS (pick/receipt) + Fleet (asset↔maintenance/conformité) — commit `430de77`. Braids automatisés (transport-order.planned→picks, load.completed→facture+close TO, maintenance/dock) **vérifiés verts** : `cross-module-automation` + `arc-e-reactions` 17/17. (Yard/Manufacturing/APS : braids déjà couverts ; relations UI supplémentaires = dette légère.)

### Wave 6 — Tests UI & CI ✅ fondation (2026-07-16)
- [x] Playwright installé + 4 smoke tests critiques (login page sans backend ✅ exécuté ; login/dashboard/loads authentifiés écrits sur sélecteurs accessibles, exécutés en CI) — commit `cee1392`. (Fondation ~4 parcours, pas 12 — extension = dette.)
- [x] Isolation E2E : suites nouvelles utilisent des codes uniques + cleanup FK-safe ; **8 suites nouvelles exécutées ensemble en un batch (51 tests) sans interférence**. (Le vieux flake cross-suite de la baseline reste à isoler — dette.)
- [x] CI `.github/workflows/ci.yml` : jobs séparés typecheck / unit / api-e2e (Postgres service + migrate deploy + seed) / web-build / browser-e2e (Playwright + artifact HTML report).

### Wave 7 — Fondation cloud ✅ (2026-07-16)
- [x] `/health/live` + `/health/ready` (PostgreSQL fatal ; runtime agent + APS best-effort informatifs) — commit `a8c9507`, e2e 3/3.
- [x] Logs structurés (interceptor par requête, skip `/health`) + correlation/request ID (`x-request-id`) — commit `a8c9507`.
- [x] Conteneurs API + web (Dockerfile multi-stage + nginx SPA fallback) ; migrations au déploiement (`prisma migrate deploy`) ; CORS configurable (`CORS_ORIGINS`) ; arrêt propre des enfants Hermes (`onModuleDestroy`) — commit `54c6fde`. (Images non `docker build`-testées — documenté.)
- [x] Chemin Redis/queue documenté dans le runbook (composants in-memory identifiés + migration path). Traçabilité runs agent = déjà durable (`AgentRun`).
- [x] Runbook `docs/runbook.md` : env, migrations, conteneurs, health, shutdown, scaling Redis, backup/restore — commit `54c6fde`.
- [x] Durcissement post-revue : backfill snapshot tender + `/health/ready` sans erreur brute — commit final-review.

---

## 5. Fichiers & composants concernés (indicatif, enrichi au fil des waves)

- **P0-A** : `apps/api/src/modules/carrier-portal/carrier-portal.service.ts` ; `apps/web/src/routes/carrier-portal/[token]/+page.svelte` ; nouveau `apps/api/test/carrier-portal.e2e-spec.ts`
- **P0-B** : `apps/api/src/modules/sites/sites.service.ts` ; `apps/api/test/sites.e2e-spec.ts`
- **P0-C** : `apps/web/src/routes/(app)/manufacturing/scheduling/+page.svelte` (+ helper de pagination client si besoin)
- **P0-D/E/F** : cartographiés en tête de tâche
- **WS2** : `apps/web/src/lib/components/ui/*`, `apps/web/src/routes/(app)/+layout.svelte`
- **WS7** : `apps/api/src/core/health/*` (nouveau), `apps/api/src/main.ts`, `Dockerfile*`

---

## 6. Dépendances

- Wave 1 est autonome (aucune dépendance).
- Wave 3 (slices) dépend de Wave 1 (contrats stables) et bénéficie de Wave 2 (primitives UI).
- Wave 4 (agents phares) dépend d'un runtime connectable (peut être stubé pour les evals).
- Wave 6 (CI browser E2E) dépend de Wave 2 (sélecteurs stables) et Wave 1 (pages non crashantes).
- E2E existants exigent PostgreSQL seedé (`db:up` + `db:migrate` + `db:seed`).

---

## 7. Risques

- **Règle 10 vs upload transporteur** : exposer `load.id`/`invoice.id` au transporteur authentifié
  par token est nécessaire aux uploads. Résolution : projection scopée au transporteur (comme
  `tender.id` déjà exposé), jamais `tenantId`/`carrierId`. Documenté, pas un assouplissement.
- **Régression E2E cross-suite** : la pollution de données doit être corrigée sans masquer un vrai
  bug ; isoler avec namespaces uniques.
- **Runtime agent** : indisponible ⇒ toute UI agent doit dégrader proprement (jamais de crash,
  jamais de succès trompeur — règle 24).
- **Scope UX** : ne pas faire de refonte globale risquée ; incréments vérifiables.
- **Format** : ne jamais formater tout le dépôt ni les sous-projets vendored (APS Python, Hermes).

---

## 8. Critères d'acceptation du stage

- 3 crashs UI confirmés corrigés (A/B/C) ; aucun succès trompeur ; portails publics mobiles ;
  shell interne sur tablette ; fiches montrant leurs relations intermodules ; 2 vertical slices
  bout-en-bout ; 2 agents à utilité mesurable ; toutes les écritures agent gouvernées ; provider
  LLM réel connectable/testé ; tests UI critiques en CI ; E2E isolés ; healthchecks ; déploiement
  reproductible ; build + typecheck verts ; **aucun nouveau problème tenant/permission/ownership/
  audit** ; ce plan reflète exactement ce qui a été livré.

---

## 9. Journal des livraisons

- **2026-07-16** — Wave 0 : branche créée, baseline vérifiée, plan écrit.
- **2026-07-16** — Wave 1 (P0) livrée : A/B/C/D/E/F corrigés + tests de régression.
  Suites vertes : sites 9/9, carrier-portal 2/2, driver-load-closed 3/3, collaboration,
  phase13-workforce 10/10. Typecheck 0 erreur. Aucun assouplissement des règles métier.
  Ajouts transverses réutilisables : `toast.info`, `AgentRuntimeService.readiness()`.
- **2026-07-16** — **Waves 2→7 livrées** (session autonome, subagent-driven, branche `operational-convergence`). Wave 2 (shell responsive, primitives d'interconnexion, cohérence états/i18n, dashboard attention) ; Wave 3 (e2e lead-to-cash CRM→billing + relations UI ; **gap SO→TO documenté**) ; Wave 4 (outils Dispatch Exception, harness d'éval 16 scénarios, transparence readiness) ; Wave 5 (relations WMS/Fleet + braids vérifiés 17/17) ; Wave 6 (Playwright 4 smoke + CI multi-jobs) ; Wave 7 (health, correlation id, logs, conteneurs, CORS, shutdown, runbook). Vérif finale : build monorepo OK, typecheck 0 err (api+web), unit 218 api + 557 shared, 8 suites e2e nouvelles 51/51 en batch. Revue finale opus : aucun défaut bloquant ; 2 items mineurs corrigés. **Restes/dette** : pont SO→TO (choix stratégique), KPIs agent spécifiques domaine, extension Playwright à 12 parcours, isolation du flake e2e baseline, docker build réel, i18n framework.
- **2026-07-16** — Wave 1.1 (durcissement) livrée :
  - **P0-F+** Offre tender **immuable** : snapshot `Tender.offeredAmount/offeredCurrency`
    figé à l'envoi depuis `Load.estimatedCost/costCurrency` (migration
    `20260716120000_tender_offer_snapshot`) ; la projection publique lit le snapshot, jamais
    le coût vivant → un recompute ultérieur du load ne change pas une offre déjà envoyée
    (esprit règle 16). E2e `tender-offer-snapshot` 1/1.
  - **P0-D+** Readiness runtime extraite en helper **pur** `@pulsar/shared`
    (`deriveRuntimeReadiness`/`runtimeBlockMessage`, `agents/runtime-readiness.ts`) :
    ordre de priorité install→config→**auth** (clé API stockée / login connecté)→modèle→dernier
    probe. `AgentRuntimeService.readiness()` renvoie désormais la décision complète (le gate
    `runNow` couvre l'auth manquante et un `test-failed`, non couverts avant) ; message unique
    par `blockReason`. +12 tests unitaires. phase13-workforce + collaboration 17/17.

---

## 10. Release Qualification (2026-07-17)

> Stage « Connected Fulfillment & Release Qualification ». But : (1) qualifier réellement
> la branche comme release candidate ; (2) construire le pont CRM SalesOrder → TMS
> TransportOrder. **Résultats réels inscrits au fil du travail** — jamais « vert » sur la seule
> compilation. Base de qualification isolée : `pulsar_rc` (jamais la base de travail `pulsar_aps`).

### Gate A — Qualification complète (base isolée `pulsar_rc`)

Exécuté sur une base Postgres fraîche (`pulsar_rc`, migrée via `prisma migrate deploy` + seedée),
`.env` pointé temporairement dessus puis restauré. Node 22, pnpm 11.5.3.

| Commande | Résultat réel |
| --- | --- |
| `pnpm setup` | ✅ exit 0 (submodules à jour, prisma generate, build shared+database) |
| `pnpm typecheck` | ✅ **0 erreur** (api + web), 41 warnings a11y préexistants (baseline inchangée) |
| `pnpm build` | ✅ monorepo complet (shared→database→api→web), SPA statique écrite |
| `pnpm test` (unit) | ✅ **798** — shared 557/557, api 218/218, web 23/23 |
| `pnpm test:e2e` (complet, 1 run) | ✅ **572 passed, 1 skip, 0 fail / 573** (69 suites, 68 exécutées) après corrections ci-dessous ; le skip = timing phase13 connu |

**Défauts réels trouvés et corrigés (pas masqués) :**

1. **`pnpm test` cassé sur `apps/web`** — Vitest ramassait les specs Playwright (`e2e/*.spec.ts`)
   et plantait (`test.describe()` de Playwright hors runtime Playwright). Régression introduite par
   la fondation Playwright (Wave 6) : la config Vitest n'avait ni `include` ni `exclude`. **Fix** :
   `apps/web/vitest.config.ts` — `include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}']` +
   `exclude: [...configDefaults.exclude, 'e2e/**']`. Les vrais unit tests vivent sous `src/`.

2. **Flake E2E cross-suite (root cause identifiée, non masquée)** — l'outbox `DomainEvent` est une
   file **globale** (tous tenants), drainée **oldest-first** par lots (`processPending(limit)`).
   Sur un run complet `--runInBand`, les suites qui émettent des events sans tout drainer laissent
   un backlog PENDING croissant ; une suite plus tardive qui fait `emit → processPending(50) →
   assert l'effet de MON event` voit son event (le plus récent) **affamé** hors du lot de 50 → 0
   tâche/réaction → échec dépendant de l'ordre. **Reproduit déterministiquement** en injectant 60
   events PENDING anciens : `arc-e-reactions` passe de 7/7 à 1 échec, puis re-passe 7/7 avec le fix.
   **Fix d'isolation** (les 9 suites concernées : `arc-e-reactions`, `crm-cross-module`,
   `crm-module`, `cross-module-automation`, `flow-control-tower`, `lead-to-cash`,
   `phase12-operating-workbench`, `phase13-workforce`, `phase16-freight-audit`) : au démarrage de
   chaque suite (juste après `app.get(DomainEventsService)`), drainer le backlog **hérité** (events
   de suites déjà terminées → traitement inoffensif) pour partir d'une file vide. Aucune assertion
   affaiblie ; le comportement métier de `processPending` est inchangé.

3. **NB** : le vieux flake « Reports/Cash Flow » **ne s'est pas reproduit** (`reports.e2e-spec.ts`
   vert dans les 3 runs complets) ; le flake réel de la baseline était le pattern outbox ci-dessus.

Critères Gate A : build ✅, typecheck 0 err ✅, unit ✅, **E2E complet vert en 1 run** ✅, aucune
donnée laissée dans `acme` (qualif sur `pulsar_rc`) ✅.

### Gate B — chemin CI Playwright

**Défaut réel trouvé** : `apps/web/vite.config.ts` ne définissait que `server.proxy` (serveur de
dev). En mode `vite preview` (le chemin **CI** quand `CI=true`), le proxy `/api` **ne s'applique
pas** (`vite preview` a sa propre clé `preview.proxy`) → tout appel `/api/v1/...` de la SPA tombait
sur le fallback SPA (index.html) au lieu d'atteindre l'API → **tous les tests Playwright
authentifiés auraient échoué** sur le chemin CI. **Fix** : ajout de `preview.proxy` miroir du dev
proxy. (Le contrat same-origin `/api` tient donc en dev ET en preview.)

**Chemin CI reproduit localement** (PAS « exécuté en CI » — aucun run GitHub) : API bâtie
(`node dist/main.js`) sur :3100 contre `pulsar_rc` seedée, `CI=true` → `pnpm build` +
`vite preview` (port paramétrable `PW_WEB_PORT`) → Playwright chromium. **16/16 verts** sur 3
projets (desktop 1280, tablette 810, mobile Pixel 5). Défauts additionnels trouvés et corrigés
(le chemin CI **n'avait jamais réellement tourné**) :
- **`pnpm run preview -- --port` casse le port** : pnpm transmet le `--` littéralement à vite
  (`vite preview -- --port 5199`), donc vite ignore le port et bind son 4173 par défaut →
  Playwright attend indéfiniment. **Fix** : `pnpm exec vite preview --port …` (corrige aussi le
  vrai job CI). Timeout webServer porté à 240 s (build+preview à froid).
- **Assertion périmée** `login.spec` : cherchait un lien nav « Bureau des apps » renommé →
  remplacé par le titre stable « Centre des opérations ».
- **Moteur webkit non installé** : le device `iPad` de Playwright est webkit (la CI n'installe
  que chromium) → projet tablette repassé sous chromium + viewport iPad.

Parcours couverts (render-smoke sur sélecteurs accessibles, sans attente arbitraire, trace/
screenshot on-retry) : login (+page publique), dashboard opérationnel, transport-orders,
sales-orders (CRM), WMS, Yard, Fleet, Agents, factures transporteur, Gantt manufacturing (sans
crash), + shell responsive tablette (pas de scroll horizontal) + page publique mobile.

**Dette honnête** : ce sont des smoke-tests de rendu, pas les 13 parcours profonds multi-étapes
demandés. Le parcours SO→TO (« Préparer l'expédition ») est prouvé bout-en-bout par l'e2e API
`fulfillment-bridge` (14/14, dont la slice verticale) mais **pas** encore comme flux Playwright UI.
Portail transporteur multi-load, tender public, portail conducteur load fermé, pick WMS lié,
Freight Audit→litige, agent Run Now = couverts côté e2e API, non re-testés en navigateur ici.

### Gate C — Docker build & smoke conteneurisé same-origin (**réellement exécuté**)

`docker build` des deux images **réellement lancé** ; 4 défauts trouvés et corrigés
(les images ne construisaient pas avant) :

1. **pnpm via corepack non pinné** → corepack résolvait pnpm **latest (11.13.1)**, dont
   le store sqlite exige `node:sqlite` (Node 22.5+) → crash de `pnpm install`. **Fix** :
   installer `pnpm@10` directement (aligné sur la CI `pnpm/action-setup version: 10`).
2. **`ERR_PNPM_IGNORED_BUILDS`** (pnpm 11 en env propre refusait les scripts de build) — évité
   en revenant à pnpm 10 (comme la CI) + `ignoredBuiltDependencies: ['@scarf/scarf']`.
3. **`tsconfig.base.json` absent de l'image** → les builds tsc (shared/database/api) tombaient
   sur les defaults (target ES3) → erreurs downlevel-iteration. **Fix** : copier
   `tsconfig.base.json` dans l'étape de build.
4. **Base Node** bumpée `node:20-alpine` → `node:22-alpine` (aligne dev/CI/CLAUDE.md).

**Smoke conteneurisé reproductible** (`docker-compose.smoke.yml`, base isolée dédiée) :
`postgres` → `migrate` one-shot (`prisma migrate deploy` + seed, **exit 0**) → `api` (interne,
non exposé) → `web`/nginx (seul port publié 8080, **proxy `/api` → api:3000**). Tourne en
`NODE_ENV=production` (exerce les boot-checks prod). Vérifié **via l'origine web (8080)** :

| Vérif | Résultat |
| --- | --- |
| `GET /api/v1/health/live` (nginx→api) | **200** |
| `GET /api/v1/health/ready` | **200** `{postgres:{ok:true}, agentRuntime/aps installed:false}` |
| Deep link SPA `GET /loads` | **200 text/html** (fallback index.html) |
| `POST /api/v1/auth/login` (origine web) | **200** (jeton 2992 c.) |
| `GET /api/v1/transportation/transport-orders` authentifié (origine web) | **200** |
| SPA racine | `<title>Pulsar</title>` |

**Correction du défaut nginx** : `apps/web/nginx.conf` ne proxifiait PAS `/api` (le conteneur web
ne pouvait pas servir le same-origin). Remplacé par `nginx.conf.template` (rendu par l'entrypoint
nginx via envsubst) avec `location /api/ { proxy_pass ${PULSAR_API_UPSTREAM}; }` (défaut
`http://api:3000`, SSE non bufferisé). **C'est la preuve de fonctionnement demandée — pas une phrase
de runbook.**

**Logs** : structurés en **`clé=valeur`** (`method=… path=… status=… durationMs=… requestId=…
tenantId=… userId=…`) avec correlation id `x-request-id` — **PAS du JSON** (à ne pas décrire
comme tel). Suffisamment exploitables pour le tri opérationnel.

Hermes/APS restent optionnels (`APS_AUTOSTART=false`, `installed:false` en readiness, jamais
bloquant — règle 24). S3/SMTP non requis pour le smoke (storage local + email `log`).

### Gate D — Pont CRM SalesOrder → TMS TransportOrder (**livré + testé**)

Décision produit appliquée : **pas** de création auto à la confirmation (une SalesOrder n'a pas
les infos logistiques). Workflow explicite « Préparer l'expédition » depuis une SalesOrder
**CONFIRMED**.

**Schéma / migration** (`20260717120000_fulfillment_sales_order_transport_order`) :
`TransportOrder.sourceSalesOrderId` + `sourceFulfillmentKey` (nullables) + contrainte unique
`(tenantId, sourceSalesOrderId, sourceFulfillmentKey)` (idempotence ; NULLs distincts en Postgres →
les TO ordinaires ne collisionnent jamais) ; FK `ON DELETE SET NULL` ; back-relation
`SalesOrder.fulfillmentOrders`.

**Pont (CRM→TMS)** : `POST /transportation/transport-orders/from-sales-order/:salesOrderId`
(perms `transportation.orders.manage` **ET** `crm.read` ; CRM re-vérifié en service). Client
**dérivé** de `SalesOrder.customerId` (jamais du front) ; `customerReference` = n° SO par défaut ;
poids/volume/palettes fournis explicitement (jamais déduits). Réutilise
`TransportOrdersService.create` (séquences r8, ownership r9, custom fields r35, audit r6) ;
idempotent par `fulfillmentKey` (P2002 → retour de l'existant). Émet
`crm.sales_order.transport_requested` ; lien audité des deux côtés. `GET …/context` (lecture) pour
l'UI. `moduleOfEventType` inchangé (préfixes `crm`/`transport-order` déjà mappés — pas de
réimplémentation).

**Fulfillment (TMS→CRM)** : `LoadsService.complete` émet `transport-order.completed` pour les TO
issues d'une SO ; réaction `fulfill_sales_order` (`REACTION_CATALOG` + règle seedée,
`ReactionExecutorService`, idempotence `ReactionExecution`, service-account) →
`SalesOrdersService.fulfillFromTransport` : CONFIRMED → FULFILLED **ssi** toutes les TO liées sont
terminales et ≥1 livrée (décision **pure** `deriveSalesOrderFulfillment` `@pulsar/shared` ;
transition gardée par `canTransitionSalesOrder` + claim conditionnel). FULFILLED et INVOICED
restent 2 transitions distinctes (pas de facturation auto).

**Agents** : `create_transport_order_from_sales_order` (MUTATING) + `get_sales_order_fulfillment_context`
(READ) via le registre + `handleMutatingTool` → `ProposedAction` (jamais d'exécution directe dans
le handler ; l'agent ne peut inventer client/origine/destination/poids).

**UI** : fiche SalesOrder → panneau « Expédition » (bouton visible seulement si CONFIRMED + client
lié, sinon message ; wizard logistique modal ; anti-double-clic ; liste des TO liées + n° créé) ;
fiche TransportOrder → SalesOrder source dans « Lié à » (clé de fulfillment humanisée).

**Tests** : unit `deriveSalesOrderFulfillment` (shared, 4 cas) ; e2e `fulfillment-bridge` **14/14** —
création depuis CONFIRMED, refus DRAFT/CANCELLED/sans-client/SO-inconnue/location-non-possédée/
CRM-désactivé, idempotence (même clé) + multi-clés, réaction de fulfillment (mono/partiel/annulé
seul/dupliqué idempotent), gouvernance agent (READ direct + MUTATING mis en file puis approuvé),
et **slice verticale** Deal WON → Customer → SalesOrder → CONFIRMED → Préparer l'expédition → TO →
livraison → SalesOrder **FULFILLED** → INVOICED → CustomerInvoice → paiement → **GL équilibré**.
C'est la preuve « lead-to-cash » complète **à travers le pont**.

### Correction des incohérences du plan

- Balises parasites `</content></invoke>` en fin de fichier retirées.
- Le stage « Operational Convergence » (Waves 0→7) reste la base ; **cette qualification (Gate A→D)
  valide réellement** ce qui était marqué terminé : l'E2E complet passe en 1 run (flake d'isolation
  outbox corrigé), le chemin CI Playwright tourne (preview proxy + fix `vite`), les images Docker
  **construisent et tournent** (smoke same-origin prouvé). Les « manques structurels » de la §1
  (pas de Playwright, pas de déploiement reproductible) sont **levés** ; restent en dette : les
  parcours Playwright profonds (13), les caches/queues en mémoire (chemin Redis documenté).

### Vérification finale combinée (2026-07-17)

Tout vert **ensemble**, base isolée `pulsar_rc` (jamais `pulsar_aps`) :
- `pnpm typecheck` : 0 erreur ; `pnpm build` : OK ; `pnpm test` : **802** (shared 561, api 218,
  web 23).
- `pnpm test:e2e` (1 run, 70 suites) : **586 passed, 1 skip, 0 fail / 587** (le skip = timing
  phase13 connu). Inclut la nouvelle suite `fulfillment-bridge` 14/14.
- Playwright (chemin CI reproduit) : **16/16** (desktop/tablette/mobile).
- Docker : `pulsar-api:rc` + `pulsar-web:rc` construites ; smoke same-origin conteneurisé vérifié.

**Recommandation** : prêt à ouvrir une PR de `operational-convergence` vers `main` (sous réserve
de la revue humaine des captures navigateur et de la décision sur la dette Playwright profonde).
Aucun push/merge effectué.

### Passe de durcissement final (2026-07-17, P0→P2)

Revue finale : 6 commits ciblés (aucune nouvelle feature majeure), tous vérifiés sur `pulsar_rc`.

- **P0 — Autorisation cross-module des outils agents** (`fix(agents)`). `ToolDef` gagne
  `additionalPermissions[]`/`additionalModules[]` + helpers purs `toolRequiredPermissions`/
  `toolRequiredModules`. `buildAgentMcpServer` exige TOUTES les permissions ET TOUS les modules
  avant d'exposer un outil (jamais d'autorisation partielle). Les 2 outils du pont exigent
  `transportation.orders.{read|manage}` **ET** `crm.read` + modules transportation **ET** crm.
  `approve` re-vérifie perms+modules (une rétrogradation entre enfilage et approbation bloque
  l'exécution). +6 e2e (visibles avec les 2 perms ; absents sans crm.read / sans perm TMS / CRM
  off ; invocation directe rejetée ; toolAllowlist ; mutating toujours mis en file).
- **P0 — Complétion TransportOrder tenant-scopée & auditée** (`fix(fulfillment)`). Nouvelle
  `TransportOrdersService.completeFromDelivery` : garde `canTransitionTransportOrder`, claim
  conditionnel `updateMany {id, tenantId, IN_EXECUTION}`, `AuditLog` STATUS_CHANGE (acteur réel),
  event `transport-order.completed` émis **exactement une fois** (count===1, uniquement si issu
  d'une SO) ; coûts jamais recalculés (règle 16). `LoadsService.complete` : `shipment.count`
  tenant-scopé + appel centralisé. +4 e2e (transition/audit/event-unique, retry idempotent,
  CANCELLED non transitionné, autre tenant sans effet).
- **P1 — Contrat logistique aligné** (`fix(fulfillment)`). Helper pur
  `validateFulfillmentLogistics` (source unique, browser-safe) : origine+destination+mode requis
  **et ≥1 mesure physique > 0** (zéro ne compte pas, jamais déduit). Branché : service (source de
  vérité, chemins HTTP+agent), DTO (`mode` requis), Zod (`mode` requis, mesures `.positive()`),
  contexte READ (`requiredLogisticsFields` = constante partagée + `optionalLogisticsFields`),
  descriptions MCP, wizard UI (validation client + fenêtres annoncées facultatives). +unit +7 e2e.
- **P1 — Isolation DomainEvents + catch-up borné** (`test(operating)`). 10 suites e2e : les blocs
  de drain copiés-collés remplacés par un helper unique documenté `drainInheritedDomainEvents`
  (E2E, base isolée). Production : `processCron` utilise `drainInBatches` pur (rattrape jusqu'à
  `DOMAIN_EVENT_MAX_CATCHUP_BATCHES=20` batches/exécution, jamais infini, jamais throw, pas de
  double exécution) ; `processPending(limit)` inchangé/race-safe ; file toujours mono-process
  in-memory-orchestrée + DB-durable (runbook). +5 unit (`drainInBatches`) + e2e prouvant le
  fulfillment derrière un backlog de 120 events PENDING.
- **P1 — Parcours Playwright profond CRM→TMS** (`test(browser)`). `fulfillment.spec.ts` : SO
  CONFIRMED → panneau Expédition → wizard → refus sans mesure → création → TO listé → lien retour
  → 2ᵉ expédition (clé différente) → 2 TO distincts ; + wizard tablette sans débordement
  horizontal. Sélecteurs accessibles, sans attente arbitraire, captures sous
  `apps/web/playwright-artifacts/fulfillment/` (01 panneau, 02 wizard, 03 lien CRM, 04 tablette).
- **P2 — Polish** (`chore(deploy)`). `git diff --check` propre (ligne vide EOF retirée) ; API
  Dockerfile : plus de `prisma generate` au démarrage (build+runtime = node:22-alpine → engine
  musl déjà généré/copié ; prouvé par le smoke) ; dette d'image documentée (dev-deps non prunées
  car migrate/seed via la même image ont besoin de prisma+tsx ; runtime encore root — non prouvable
  par le smoke actuel, prod devrait de toute façon utiliser S3).

**Preuves finales combinées (`pulsar_rc`, `APS_AUTOSTART=false`)** : voir §« Résultats des gates »
ci-dessous (mis à jour au run). Le smoke Docker a en plus validé la **création du pont via
l'origine web** (no-mesure → 400, poids → 201, `sourceSalesOrderId` posé).

### Niveaux de préparation (honnête)

- **Prêt pour PR** : OUI — build/typecheck/unit/e2e/Playwright verts, smoke conteneurisé prouvé,
  `git diff --check` propre.
- **Prêt pour staging** : OUI mono-instance (health/ready, migrations explicites, same-origin nginx,
  secrets via env, S3+SMTP à brancher).
- **Prêt pour production mono-instance** : OUI sous conditions — S3 pour le stockage (local non
  durable), SMTP réel, `JWT_SECRET`/`ENCRYPTION_KEY`/`PLATFORM_ADMIN_PASSWORD` réels, Hermes réel
  non qualifié dans ce gate (best-effort 503 sinon).
- **Prêt pour production multi-instance** : NON — caches modules en mémoire (30 s), dispatcher
  d'agents + file DomainEvent orchestrés en mémoire mono-process, throttle Nominatim in-process ;
  chemin Redis documenté (§6) non implémenté. Observabilité = logs `clé=valeur` + `x-request-id`
  (pas de tracing/metrics agrégés).

### Résultats des gates (2026-07-17, `pulsar_rc`, `APS_AUTOSTART=false`)

| Gate | Résultat |
| --- | --- |
| `pnpm typecheck` | ✅ 0 erreur (api + web ; 41 warnings a11y préexistants) |
| `pnpm build` | ✅ shared → database → api → web |
| `pnpm test` (unit) | ✅ **810** — shared 569, api 218, web 23 |
| `pnpm test:e2e` (1 run, 70 suites) | ✅ **604 passed, 1 skip, 0 fail / 605**, exit 0 propre (skip = timing phase13 connu) |
| Playwright (chemin CI reproduit) | ✅ **18/18** (desktop/tablette/mobile) — dont le parcours profond CRM→TMS |
| Docker `pulsar-api:rc` + `pulsar-web:rc` | ✅ construites ; smoke same-origin : health 200/200, deep-link, login, appel authentifié, **pont CRM→TMS via l'origine** (no-mesure→400, poids→201) |
| `git diff --check` | ✅ propre |

**Note `pnpm format`** : NON exécuté. Le dépôt a une **dérive Prettier préexistante systémique**
(quasi tout `apps/api` diverge du `.prettierrc` courant) — lancer `pnpm format` réécrirait des
centaines de fichiers **hors périmètre de cette mission**. Les fichiers ajoutés/édités ici suivent
le style de-facto du code environnant (cohérents). La normalisation Prettier globale = dette
séparée à traiter dans un commit dédié.
