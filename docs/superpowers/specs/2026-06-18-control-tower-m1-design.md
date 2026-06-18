# Chantier 1 · Morceau 1 — Module analytics + Control Tower opérationnelle (MVP)

Date : 2026-06-18 · Branche : `analytics-control-tower`

## Objectif

Activer un module business `analytics` et livrer une page **Control Tower opérationnelle** qui
répond à « qu'est-ce qui mérite mon attention maintenant ? » + KPI en-tête. Tout est calculé **à la
lecture** (aucun store de rollup, aucune migration — cohérent règle 30), tenant-scopé (règle 1).

## Architecture

- Math/types purs dans `@pulsar/shared/analytics` (testés vitest).
- Module API `apps/api/src/modules/analytics/` : `ControlTowerService` agrège des requêtes
  read-time sur les modèles existants, `ControlTowerController` expose
  `GET /analytics/control-tower?days=` (gardé `@RequireModule(ANALYTICS)` + `analytics.read`).
- Web : domaine de nav `analytics` + universe, page `/analytics/control-tower`.

## Périmètre & tâches

### Tâche 1 — Shared : module flag, permission, types & math pure
Fichiers : `packages/shared/src/modules.ts` (flip `analytics.available = true`),
`packages/shared/src/permissions.ts` (`PERMISSIONS.ANALYTICS = { READ: 'analytics.read' }` +
union `PermissionKey` + `PERMISSION_CATALOG` via factory `analytics()`),
`packages/shared/src/analytics/control-tower.ts` (créé) + `.spec.ts`, export depuis `index.ts`.

Types & fonctions pures (consommés par l'API et le web) :
```ts
export type AttentionSeverity = 'critical' | 'warning' | 'info';
export type AttentionKind =
  | 'load_late' | 'freight_dispute' | 'asset_out_of_service'
  | 'dock_at_risk' | 'pick_ready_not_dispatched' | 'agent_action_pending';
export interface AttentionItem {
  kind: AttentionKind; severity: AttentionSeverity; label: string;
  ref?: string;   // entity id
  href?: string;  // web deep-link
  at?: string;    // ISO, for sorting
}
export interface ControlTowerKpis {
  loadsInTransit: number; loadsLate: number; otifPct: number | null;
  avgCostPerLoad: number | null; recoveredAmount: number; disputesOpen: number;
  fleetAvailabilityPct: number | null; agentActionsPending: number; tasksOpen: number;
}
export interface ControlTower { rangeDays: number; kpis: ControlTowerKpis; attention: AttentionItem[]; }

// OTIF = livraisons à temps / livraisons totales sur la période (shipment delivered
// avec actualDeliveryAt <= plannedDeliveryLate). null si dénominateur 0.
export function computeOtif(rows: { onTime: boolean }[]): number | null;
// dispo flotte = assets AVAILABLE / (total hors RETIRED). null si 0.
export function computeFleetAvailability(c: { available: number; total: number }): number | null;
export function avg(values: number[]): number | null;
export function sortAttention(items: AttentionItem[]): AttentionItem[]; // critical→warning→info, puis at desc
```
Les seuils/dérivations métier (ex. « load en retard ») vivent côté service (données), mais les
agrégations pures (otif, moyenne, dispo, tri) vivent ici et sont testées.

### Tâche 2 — API : module analytics + Control Tower service/controller
Fichiers : `apps/api/src/modules/analytics/{analytics.module.ts,control-tower.service.ts,
control-tower.controller.ts}`, enregistrement dans `apps/api/src/app.module.ts`, et seed de la
permission (`packages/database` seed reprend `ALL_PERMISSION_KEYS` automatiquement — vérifier que
le rôle admin du seed obtient `analytics.read`).

`ControlTowerService.controlTower(tenantId, days)` :
- **Attention** (tenant-scopé, borné, top ~50, trié `sortAttention`) :
  - `load_late` : `Load` non livré dont une échéance shipment (`plannedDeliveryLate`) est dépassée.
  - `freight_dispute` : `IncomingCarrierInvoice.status = DISPUTED` (ou litige ouvert).
  - `asset_out_of_service` : `Vehicle`/`Trailer.status = OUT_OF_SERVICE`.
  - `dock_at_risk` : `DockAppointment` non terminé dont `windowEnd < now` (SCHEDULED/CONFIRMED).
  - `pick_ready_not_dispatched` : `PickOrder.status = COMPLETED` avec `shipmentId` dont le shipment
    n'est pas dispatché (loadId null OU load non dispatché).
  - `agent_action_pending` : `ProposedAction.status = PENDING`.
- **KPIs** sur la fenêtre `days` :
  - `loadsInTransit` (loads DISPATCHED/IN_TRANSIT), `loadsLate` (count attention load_late),
  - `otifPct` via `computeOtif` (shipments livrés sur la période),
  - `avgCostPerLoad` via `avg` des `Load.estimatedCost` (loads de la période),
  - `recoveredAmount` = somme `IncomingCarrierInvoice.recoveredAmount` (résolus sur la période),
  - `disputesOpen` (count), `fleetAvailabilityPct` via `computeFleetAvailability`,
  - `agentActionsPending` (count PENDING), `tasksOpen` (`OperationalTask` OPEN/IN_PROGRESS).
- Module gating : si un sous-module (fleet/yard/wms/billing/agents) n'est pas activé pour le
  tenant, on **omet** silencieusement ses contributions (best-effort, jamais d'erreur). Utiliser
  `TenantModulesCacheService` comme ailleurs ; à défaut, try/catch tolérant par bloc.

### Tâche 3 — Web : nav/universe + page Control Tower
Fichiers : `apps/web/src/lib/modules/navigation.ts` (domaine `analytics`,
`module: MODULE_KEYS.ANALYTICS`, `anyPerms: ['analytics.read']`, lien `/analytics/control-tower`
+ lien vers carrier scorecard existant), `apps/web/src/lib/modules/universe.ts`
(`MODULE_UNIVERSES['analytics']` accent), `apps/web/src/routes/(app)/analytics/control-tower/+page.svelte`.

Page : filtre `days` (7/30/90), tuiles KPI, panneau « Attention » (liste avec severity color +
deep-links via `href`), pattern standard `api<ControlTower>()` + `$state`/`$effect`, `ErrorNotice`.

### Tâche 4 — Vérification
`pnpm --filter @pulsar/shared test`, `pnpm typecheck` (web 0 err ; api : ignorer les 5 TS2554
préexistantes fleet/wms/yard), smoke test API : login → `GET /analytics/control-tower` (200, shape).

## Hors scope (morceaux suivants)
Profitabilité lane/customer, agent ROI détaillé, heatmap, scorecards approfondis (M2). Pas de
nouvelle entité, pas de migration.

## Critères de succès
1. Module `analytics` activable ; `analytics.read` au catalogue + seed admin.
2. `GET /analytics/control-tower?days=` renvoie kpis + attention, tenant-scopé, best-effort.
3. Page `/analytics/control-tower` affiche Attention + KPI, filtre days, deep-links.
4. Math pure testée ; typecheck web propre ; shared tests verts.
