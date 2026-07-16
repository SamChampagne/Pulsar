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

### Wave 2 — Fondations UX
- [ ] Shell responsive (sidebar repliable / drawer, tablette OK, portails publics ≥360 px)
- [ ] Primitives partagées **utiles** (réduisent clics ou augmentent compréhension) :
      OperationalPageHeader, WorkQueue, EntitySummary, StatusTimeline, RelatedEntities,
      NextBestActions, ExceptionBanner, ContextDrawer, ActivityTimeline, AgentRecommendation,
      SavedView, CommandPalette/recherche globale
- [ ] États loading/empty/error/success cohérents ; IDs humains (jamais d'ID brut si nom existe)
- [ ] Dashboard orienté rôle & attention (retard/bloqué/décision/coût/automatisable/proposé/récent)
- [ ] Cohérence i18n (français) ou architecture i18n claire

### Wave 3 — Deux vertical slices intermodules
- [ ] **Lead-to-cash** : site/lead → deal → SO → transport order → shipment/load → livraison → facture client → paiement (e2e bout-en-bout)
- [ ] **Freight-audit-to-resolution** : facture entrante → audit → litige gouverné → résolution → paiement + KPI récupéré (e2e)
- [ ] UI de relations : panneau « Lié à », navigation directe, timeline fusionnée, trace workflow

### Wave 4 — Agents
- [ ] Runtime réel connectable + testé (provider LLM remplaçable)
- [ ] Freight Audit Agent (coût figé, écarts expliqués, preuves, litige gouverné, $ récupéré)
- [ ] Dispatch Exception Agent (détection retard/capacité/tender expiré/asset/conflit, résolution)
- [ ] Transparence agent (dispo runtime, modèle, session, dernier run, outils, preuves, raison PROPOSE/AUTO/DENY, résultat)
- [ ] Harness d'évaluation (scénarios reproductibles : outils autorisés/interdits, cap, idempotence, prompt-injection, cross-tenant, runtime down, réponse invalide, double exécution)
- [ ] KPIs agent

### Wave 5 — Workflows supplémentaires
- [ ] WMS/Yard/Fleet · CRM/Sites · Manufacturing/APS : relations + tests

### Wave 6 — Tests UI & CI
- [ ] Playwright (12 parcours critiques, sélecteurs stables/accessibles)
- [ ] Isolation E2E stricte (namespaces uniques, diag handles Jest ouverts, échec E2E reproduit & corrigé)
- [ ] CI distinguant unit / API E2E / web component / browser E2E / typecheck / build ; artifacts Playwright

### Wave 7 — Fondation cloud
- [ ] `/health/live`, `/health/ready` (PostgreSQL, APS, runtime agent)
- [ ] Logs structurés + correlation/request ID + métriques minimales
- [ ] Conteneurs API + web ; migrations au déploiement ; CORS configurable ; arrêt propre des enfants
- [ ] Chemin Redis/queue durable identifié/isolé ; traçabilité des runs agent jamais uniquement en mémoire
- [ ] Runbook secrets/S3/SMTP/backup-restore

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
</content>
</invoke>
