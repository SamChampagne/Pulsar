# Phase 15-A — Control Tower (observabilité) — Design

> Statut : approuvé (brainstorm 2026-06-15). Dernier morceau de l'Acte I de la roadmap Pulsar
> Agent OS ([roadmap](./2026-06-14-pulsar-agent-os-roadmap.md)). Suit la phase 14 (Autonomie &
> policies). **Décomposition** : la phase 15 de la roadmap couvrait 3 sous-systèmes
> indépendants — (A) observabilité/dashboard, (B) banc red-team, (C) playbooks. Sam a choisi de
> ne livrer que **(A)** pour l'instant ; B et C restent des cycles séparés ultérieurs.

## Objectif

« On ne gouverne 24/7 que ce qu'on mesure. » Rendre visibles et mesurables les agents construits
aux phases 11→14 : KPI concrets par agent, dashboard manager tenant-wide, et timeline d'activité
unifiée — **le tout calculé à la lecture** depuis les données déjà persistées, sans nouvelle table
ni migration.

## Décisions verrouillées (brainstorm)

1. **Périmètre = (A) observabilité uniquement.** Pas de red-team, pas de playbooks (cycles
   séparés si Sam y revient).
2. **KPI concrets honnêtes, PAS de chiffre d'économies $.** On mesure le réel/vérifiable (actions,
   tâches résolues, taux d'approbation/auto-approbation, taux d'erreur, latence, trips de breaker).
   Le vrai montant récupéré viendra de la phase 16 (Freight Audit) et se branchera plus tard.
3. **Tout dérivé de l'existant.** Aucune table `AgentEvent`, aucune migration. La timeline fusionne
   `AgentRun` + `ProposedAction` + `AuditLog` à la lecture ; le compteur de trips vient des
   `AuditLog`.
4. **Pas de page `/control-tower` séparée** : le roster `/agents` DEVIENT le dashboard manager.
5. **Fenêtre 30 jours par défaut** (paramétrable `?days=`).
6. **Latence moyenne calculée en JS** sur un échantillon borné de runs terminés (pas d'agrégat SQL
   de diff de dates).

## État actuel (réutilisé)

- `GET /agents/:id/activity` → conversations + proposedActions (50) + `stats {conversations,
  pending, executed, rejected}`.
- `GET /agents/:id/runs` → `Paginated<AgentRun>` (trigger, taskId, status, attempt, startedAt,
  finishedAt, error, proposedActionCount).
- `GET /agents/:id/trust` → `computeTrustScore(...)` (reçoit aujourd'hui `breakerTrips: 0` en dur —
  **dette à corriger ici**).
- `ProposedAction` : `status` (PENDING/APPROVED/EXECUTED/REJECTED/FAILED), `autoApproved`,
  `proposedAt`/`decidedAt`.
- `AgentRun` : `status` (SUCCEEDED/FAILED/SKIPPED/KILLED), `startedAt`/`finishedAt`.
- `AuditLog` : le trip de breaker (phase 14, `maybeTripBreaker`) logge `entityType='agent'`,
  `action=UPDATE`, `after.breakerTripped=true`.
- `OperationalTask` : `assigneeAgentId`, `status` (incl. RESOLVED).
- `agentSelect` partagé (exclut `secretHash`/`serviceUserId`, règle 26).

## Architecture

### A. Rollup KPI par agent

**Helper pur (`@pulsar/shared/agents/kpis.ts`)** — calcule les ratios à partir de comptes bruts :

```ts
export interface AgentKpiRaw {
  executed: number; autoApproved: number; pending: number; rejected: number; failed: number;
  runsTotal: number; runsSucceeded: number; runsFailed: number; runsSkipped: number; runsKilled: number;
  runLatenciesMs: number[];   // échantillon borné de (finishedAt - startedAt)
  breakerTrips: number;
  tasksResolved: number;
}
export interface AgentKpis {
  actions: { total: number; executed: number; autoApproved: number; pending: number; rejected: number; failed: number };
  approvalRate: number;      // executed / (executed + rejected)  (0 si aucune décision)
  autoApprovalRate: number;  // autoApproved / executed           (0 si aucun executed)
  errorRate: number;         // failed / (executed + failed)      (0 si aucune action terminée)
  runs: { total: number; succeeded: number; failed: number; skipped: number; killed: number };
  avgRunLatencyMs: number | null;  // null si aucun run terminé
  breakerTrips: number;
  tasksResolved: number;
}
export function deriveAgentKpis(raw: AgentKpiRaw): AgentKpis;
```

`actions.total = executed + pending + rejected + failed`. Tous les ratios bornés `[0,1]`,
zéro-guards explicites. Pur, browser-safe (aucun `node:*`).

**Service (`AgentsService.kpis(tenantId, id, days)`)** — agrège via Prisma (toutes les requêtes
scopées `tenantId` + `agentId`), borne la fenêtre à `proposedAt/createdAt >= now - days*24h`,
échantillonne les runs terminés (ex. `take: 200`) pour la latence, compte les `AuditLog` de trip
et les `OperationalTask` RESOLVED, puis appelle `deriveAgentKpis`.

Le compte des trips :
```ts
this.prisma.auditLog.count({
  where: { tenantId, entityType: 'agent', after: { path: ['breakerTripped'], equals: true }, createdAt: { gte: since } },
});
```
(filtre JSON Postgres ; si le champ d'horodatage d'`AuditLog` diffère de `createdAt`, l'utiliser —
à confirmer à l'implémentation contre le modèle réel.)

**Endpoint** : `GET /agents/:id/kpis?days=30` (permission `agents.read`).

### B. Dashboard manager (tenant-wide)

**`AgentsService.controlTower(tenantId, days)`** → pour chaque agent du tenant (via `agentSelect`,
donc sans secrets) : `{ id, name, status, autonomyLevel, breakerTrippedAt, kpis: AgentKpis }`, plus
des **rollups tenant** dérivés en agrégeant les KPIs : `{ agents: total, active, paused, revoked,
totalActions, pendingApprovals, totalBreakerTrips, totalTasksResolved }`. Calcul à la lecture,
borné par le nombre d'agents (N petit ; N×requêtes acceptable, optimisable plus tard).

**Endpoint** : `GET /agents/control-tower?days=30` (permission `agents.read`). ⚠️ Ordre de routes :
déclarer AVANT `@Get(':id')` (sinon `control-tower` est capturé comme `:id`).

### C. Timeline d'activité/audit (par agent)

**Helper pur (`@pulsar/shared/agents/timeline.ts`)** — fusionne et trie :
```ts
export interface TimelineEntry { at: string; kind: string; summary: string; ref?: string; }
export function mergeTimeline(sources: TimelineEntry[][], limit: number): TimelineEntry[];
```
Concatène, trie `at` desc, tronque à `limit`. Pur.

**Service (`AgentsService.timeline(tenantId, id, limit)`)** — interroge (bornées) `AgentRun`,
`ProposedAction`, et les `AuditLog` `entityType='agent'` de l'agent, mappe chacun en `TimelineEntry`
(`kind` ∈ `run`/`action`/`lifecycle` ; `summary` lisible ; `at` = horodatage pertinent) puis
`mergeTimeline`.

**Endpoint** : `GET /agents/:id/timeline?limit=50` (permission `agents.read`). Déclarer avant
`@Get(':id')`.

### D. Résolution de la dette KPI de la phase 14

`AgentsService.trust(...)` passait `breakerTrips: 0` en dur à `computeTrustScore`. Le remplacer par
le **vrai** compte (`AuditLog` de trip pour l'agent — la même requête que le KPI). Le terme de
pénalité de la formule devient effectif. (Aucune modif de `@pulsar/shared` — juste la valeur passée.)

### E. Web — Control Tower

- **`/agents` (roster) → dashboard manager** : un bandeau de résumé tenant en tête (totaux depuis
  `GET /agents/control-tower`) + les cartes agents enrichies de badges KPI (actions, taux
  d'approbation, taux d'erreur, statut/breaker). Réutilise Card/Badge ; charge `control-tower` au
  lieu de (ou en plus de) la liste actuelle.
- **`/agents/[id]`** : nouveau **panneau KPI** (le rollup, `GET /agents/:id/kpis`) + section
  **Timeline** (`GET /agents/:id/timeline`), à côté des sections trust/breaker/Activité 24/7
  existantes. Pattern web existant (`$state`/`$effect`/`api()`).

### F. Nouvelle règle dure (CLAUDE.md, phase 15)

> **30. (phase 15 — Control Tower observabilité)** Les KPI, rollups et timeline du Control Tower
> sont calculés **à la lecture** depuis `AgentRun`/`ProposedAction`/`OperationalTask`/`AuditLog`
> (aucun store de rollup, aucune migration) ; les calculs de ratio vivent dans `@pulsar/shared`
> (`deriveAgentKpis`, `mergeTimeline` — purs) ; le compteur de trips de breaker vient des
> `AuditLog` `entityType='agent'` / `after.breakerTripped=true` (alimente aussi le `breakerTrips`
> du trust score) ; toute projection agent/KPI exclut `secretHash`/`serviceUserId` (règle 26) et
> reste scopée `tenantId` (règle 1).

## Tests

Unit (`@pulsar/shared`, vitest) :
- `deriveAgentKpis` : `actions.total` correct ; ratios bornés `[0,1]` ; zéro-guards (aucune
  décision → approvalRate 0 ; aucun run → avgRunLatencyMs null) ; `errorRate`/`autoApprovalRate`.
- `mergeTimeline` : ordre desc par `at`, troncature à `limit`, fusion multi-sources.

Unit (API) : `kpis()` mappe les comptes Prisma → `deriveAgentKpis` ; `trust()` reflète le vrai
`breakerTrips` ; `controlTower()` agrège les rollups tenant.

E2e (DB seedée) : agent avec des `ProposedAction` (EXECUTED auto, EXECUTED humain, REJECTED,
FAILED), des `AgentRun` (SUCCEEDED + FAILED), une `OperationalTask` RESOLVED, et un `AuditLog` de
trip →
1. `GET /agents/:id/kpis` : comptes + ratios corrects, `breakerTrips >= 1`, `tasksResolved >= 1`.
2. `GET /agents/control-tower` : l'agent figure ; rollups tenant cohérents (totalActions,
   pendingApprovals, totalBreakerTrips).
3. `GET /agents/:id/timeline` : entrées fusionnées triées desc, mélange `run`/`action`/`lifecycle`.
4. Projection : aucune réponse ne contient `secretHash`/`serviceUserId`.
5. Isolation : un agent d'un autre tenant n'apparaît jamais dans `control-tower`.

## Hors périmètre

- Banc red-team (prompt injection + cross-tenant) → cycle séparé (15-B) si repris.
- Playbooks (procédures par rôle) → cycle séparé (15-C) ou Acte II.
- Économies en $ → différé (phase 16 Freight Audit fournira un montant réel à brancher).
- Table de rollup / cron de matérialisation → non (calcul à la lecture ; à revisiter si le volume
  l'exige).
- Aucune migration.
