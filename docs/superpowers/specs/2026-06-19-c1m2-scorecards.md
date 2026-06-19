# C1-M2 — Scorecards & profitabilité (spec)

Backlog Chantier 1 / M2. Branche `analytics-control-tower`. Autonomie (mandat Lebron).
Suite de C1-M1 (Control Tower). Règle 30 : KPI **calculés à la lecture** (aucun store de rollup,
aucune migration) ; calculs **purs** dans `@pulsar/shared/analytics` ; tenant-scopé ; projections
sans `secretHash`/`serviceUserId`.

## But

Une surface « Scorecards » qui complète la Control Tower avec des indicateurs cross-module calculés
à la lecture : disponibilité flotte, congestion cour, préparation entrepôt, heatmap d'exceptions,
ROI des agents.

## Scope (décidé)

- **LIVRÉ (phase-1, READY, zéro migration)** : fleet uptime, yard congestion, warehouse readiness,
  exception heatmap, agent ROI. Un endpoint consolidé + une page.
- **DIFFÉRÉ (C1-M2-phase-2)** : lane profitability + customer profitability — nécessitent un lien
  revenu→load (`CustomerInvoiceLine` n'a pas de `loadId`/grain shipment). À concevoir séparément
  (junction ou attribution). Carrier scorecard existant (`/analytics`) reste tel quel (réutilisé en lien).

## Existant réutilisé (NE PAS réimplémenter)

- Module analytics : `apps/api/src/modules/analytics/*` (Control Tower lit déjà cross-module sous
  `@RequireModule(ANALYTICS)`+`analytics.read` : Vehicle/Trailer/PickOrder/ProposedAction/
  OperationalTask/IncomingCarrierInvoice). Mêmes gardes pour le nouvel endpoint.
- `@pulsar/shared/analytics/control-tower.ts` (`computeOtif`, `computeFleetAvailability`, `avg`,
  `sortAttention`) et `@pulsar/shared/agents/kpis.ts` (`deriveAgentKpis(raw)` → actions/approvalRate/
  autoApprovalRate/errorRate/runs/avgRunLatencyMs/breakerTrips/tasksResolved). **Réutiliser
  `deriveAgentKpis` pour le ROI agents** ; ne pas recoder les ratios.
- `agentSelect` partagé (projection sans secretHash/serviceUserId) pour lister les agents.

## Périmètre LIVRÉ (phase-1)

### Backend — endpoint consolidé read-only

`GET /api/v1/analytics/scorecards?days=7|30|90` (défaut 30)
- Gardes : `@RequireModule(MODULE_KEYS.ANALYTICS)` + `@RequirePermissions(ANALYTICS.READ)`. Tenant-scopé.
  Aucun écrit. Chaque section calculée défensivement (données absentes ⇒ section vide/null, jamais
  d'exception ; un module métier non activé ⇒ counts 0/empty).
- Réponse :
  ```ts
  interface ScorecardsDto {
    sinceDays: number;
    fleetUptime: {
      vehicles: { total: number; available: number; inMaintenance: number; uptimePct: number|null };
      trailers: { total: number; available: number; inMaintenance: number; uptimePct: number|null };
      avgMaintenanceDays: number|null;     // MaintenanceOrder completés (completedAt-openedAt) dans la fenêtre
      openMaintenanceOrders: number;
    } | null;
    yardCongestion: {
      activeVisits: number;                 // visites CHECKED_IN|ASSIGNED
      occupiedSpots: number; totalSpots: number; occupancyPct: number|null;
      avgDwellMinutes: number|null;         // checkOutAt-checkInAt dans la fenêtre
      appointmentsAtRisk: number;           // DockAppointment SCHEDULED|ARRIVED & windowEnd<now
    } | null;
    warehouseReadiness: {
      openPickOrders: number; completedPickOrders: number; readinessPct: number|null; // completed/(open+completed) fenêtre
      itemsBelowMin: number; stockOutItems: number;
    } | null;
    exceptionHeatmap: {
      categories: string[];                 // axes lignes (catégories présentes)
      buckets: string[];                    // axes colonnes (ex 7/30/90 → jours ou semaines)
      cells: { category: string; bucket: string; count: number; severityMax: 'INFO'|'WARNING'|'CRITICAL' }[];
      topCategories: { category: string; count: number }[];  // top 5
    };
    agentRoi: { agentId: string; name: string; avatar?: string; kpis: AgentKpis }[]; // via deriveAgentKpis
  }
  ```
- Calculs (tenant-scopés, à la lecture) :
  - fleetUptime : counts Vehicle/Trailer par status (exclure RETIRED du total) ; uptimePct =
    available/total ; avgMaintenanceDays = moyenne (completedAt-openedAt) des MO complétés depuis
    `since` ; openMaintenanceOrders = MO non COMPLETED/CANCELLED.
  - yardCongestion : activeVisits = YardVisit status∈{CHECKED_IN,ASSIGNED} ; occupiedSpots dérivé
    (spots distincts avec visite active) ; totalSpots = YardSpot du tenant ; avgDwellMinutes =
    moyenne des visites avec checkOutAt depuis since ; appointmentsAtRisk = DockAppointment.
  - warehouseReadiness : PickOrder open vs completed depuis since ; itemsBelowMin/stockOutItems via
    InventoryLevel vs WmsItem.minQty (réutiliser la logique de replenishment si un helper existe,
    sinon compter directement, tenant-scopé).
  - exceptionHeatmap : OperationalTask depuis since, groupé (category × bucket temporel) ; severityMax
    par cellule ; topCategories = 5 catégories les plus fréquentes. Le bucketing (jour/semaine selon
    `days`) vit dans un helper pur shared.
  - agentRoi : pour chaque agent (projection `agentSelect`), agréger runs/actions/etc. puis
    `deriveAgentKpis(raw)`. Pas de recoveredAmount par agent (ambigu — différé) ; garder les métriques
    nettes attribuables.
- **Helpers purs shared** (`@pulsar/shared/analytics/`, browser-safe, + tests) : `computeUptimePct`,
  `computeAvgMaintenanceDays`, `computeOccupancyPct`, `computeAvgDwellMinutes`, `computeReadinessPct`,
  `bucketizeByDay`/`buildExceptionHeatmap`. Réutiliser `avg`/`deriveAgentKpis` existants.

### Frontend — page `/analytics/scorecards`

- `apps/web/src/routes/(app)/analytics/scorecards/+page.svelte`. Pattern `$state`+`$effect`+`load()`,
  UI kit. Sélecteur de fenêtre (7/30/90 j, comme control-tower). Sections (carte par scorecard,
  masquée si la section est null) :
  - Fleet uptime : cartes (uptime % véhicules/remorques, jours moyens en atelier, MO ouverts).
  - Yard congestion : cartes (occupation %, visites actives, dwell moyen, rdv à risque).
  - Warehouse readiness : cartes (readiness %, picks ouverts, items sous min, ruptures).
  - Exception heatmap : grille category × bucket (intensité = count, couleur selon severityMax) +
    top 5 catégories.
  - Agent ROI : table par agent (runs, actions, taux d'approbation, auto, erreurs, tâches résolues,
    breaker trips) depuis `kpis`.
- Lien croisé vers `/analytics/control-tower` et `/analytics` (carrier scorecard).
- Pas de lib de charts (hand-rolled bars/grid comme l'existant). Empty/skeleton states.

### Navigation

- `navigation.ts` : domaine `analytics`, ajouter `{ href: '/analytics/scorecards', label: 'Scorecards',
  perm: 'analytics.read' }` (après Control Tower). `/analytics` est déjà dans les prefixes.

## Règles

- Règle 30 (read-time, pas de rollup/migration ; calculs purs shared ; exclure secretHash/
  serviceUserId via `agentSelect`), 1 (tenant scope), 5 (gating ANALYTICS+analytics.read). Pas
  d'entité, pas de migration, pas d'enum, pas de nouvelle permission.

## Tâches

- **M2-T1 (shared+api)** : helpers purs + tests ; `ScorecardsController`/`ScorecardsService` (ou
  étendre le service Control Tower) `GET /analytics/scorecards`. Réutilise `deriveAgentKpis`,
  `agentSelect`. Vérifier : `pnpm --filter @pulsar/shared test` nouveaux tests verts, typecheck api 0
  nouvelle err, build nest OK, gating+tenant-scope, sections défensives.
- **M2-T2 (web)** : page `/analytics/scorecards` + nav. Vérifier : `pnpm --filter web typecheck` 0 err.
- Reviewer après chaque tâche.
