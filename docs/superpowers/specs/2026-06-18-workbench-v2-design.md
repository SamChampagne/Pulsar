# Chantier 2 — Workbench v2 (centre de résolution)

Date : 2026-06-18 · Branche : `analytics-control-tower`

## Décision de design

`OperationalTask` **EST** le cas (ExceptionCase). On l'enrichit plutôt que de créer une entité
parallèle : tout le pipeline existe déjà (DomainEvents→policies→tasks, `AgentWorkerService`,
`ProposedAction` lié par `triggeredByRef='task:<id>'`, `canTransitionOperationalTask`, permissions
`core.operating.tasks.*`, page `/workbench`). Une entité `ExceptionCase` séparée obligerait à
dupliquer l'assignation agent, les hooks worker, le lien ProposedAction et l'UI (règles 27/28).

On ajoute : numéro de cas (rule 8), SLA + priorité, escalade + notification, notes, timeline
dérivée, pièces jointes. Les **playbooks** = la config (catégorie → SLA/priorité/checklist) qui
enrichit les policies existantes. Pas de nouvelle entité ; un seul `OperationalTask` enrichi.

## Morceaux

### C2-M1 — Fondation cas (schéma + SLA/playbooks + escalade + notes + timeline) [API/shared]

**Schéma** (`packages/database/prisma/schema.prisma`, `OperationalTask`) — colonnes nullables
(rétrocompat, pas de backfill) :
- `caseNumber String?` (EC-000001, via `SequencesService`, clé `'exception-case'` préfixe `EC` —
  généré à la création de la task dans `processPending`).
- `slaDueAt DateTime?` (échéance SLA calculée à la création selon le playbook de la catégorie).
- `escalatedAt DateTime?` (posé par le worker d'escalade quand SLA dépassé).
- `notes Json?` (tableau `{ at, byUserId, byName?, text }`, append-only via endpoint).
- Index `(tenantId, status, slaDueAt)` pour la sweep d'escalade.

**Shared** (`packages/shared/src/operating/playbooks.ts`, pur + testé) :
- `PLAYBOOKS: Record<string, { slaMinutes: number; priority: NotificationLevel; checklist: string[] }>`
  indexé par catégorie (`DELAY`, `TENDER_FAILURE`, `FREIGHT_AUDIT`, `FLEET_MAINTENANCE`,
  `FLEET_PM_DUE`, `WMS_REPLENISH`, `WMS_COUNT_VARIANCE`, `FULFILLMENT_READY`, `YARD_ARRIVAL`,
  `YARD_DETENTION`, `YARD_APPOINTMENT_LATE`) + défaut.
- `getPlaybook(category): Playbook` (défaut si inconnu).
- `computeSlaDueAt(category, createdAtMs): string | null` (ISO ; null si pas de SLA).
- `isSlaBreached(slaDueAt, nowMs): boolean`.
- Réutiliser `mergeTimeline`/`TimelineEntry` (déjà dans `@pulsar/shared/agents`) pour la timeline.

**API** (`apps/api/src/core/operating/`) :
- `DomainEventsService.processPending` : à la création de la task, générer `caseNumber` +
  `slaDueAt` (via playbook). Best-effort (pas de blocage si la séquence échoue).
- `OperationalTasksService` :
  - `addNote(tenantId, id, userId, text)` → append dans `notes` (audit `UPDATE`).
  - `timeline(tenantId, id)` → dérivée read-time : transitions (AuditLog `entityType='OperationalTask'`,
    `entityId=id`) + ProposedAction (`triggeredByRef='task:<id>'`) + notes, fusionnées via
    `mergeTimeline`. Aucune dénormalisation.
  - `get` renvoie aussi `caseNumber/slaDueAt/escalatedAt/notes` + `slaBreached` (calculé).
- `SlaEscalationService` (cron `EVERY_5_MINUTES`, best-effort, jamais throw) : sweep des tasks
  OPEN/IN_PROGRESS avec `slaDueAt < now` et `escalatedAt = null` ; claim race-safe
  (`updateMany where escalatedAt=null SET escalatedAt=now`) ; pour chaque escaladée :
  `NotificationsService.notify` (tenant-wide ou assignee), audit. Ne change PAS le status.
- Endpoints : `POST /operational-tasks/:id/note` (`OPERATING_TASKS_MANAGE`),
  `GET /operational-tasks/:id/timeline` (`OPERATING_TASKS_READ`),
  `POST /operational-tasks/:id/start` (exposer, `OPERATING_TASKS_MANAGE`),
  documents déjà via `DocumentsService` (`entityType='operational-task'`).
- `SequencesService` : ajouter clé `'exception-case'` préfixe `EC`.

### C2-M2 — Workbench v2 UI (Kanban + détail cas enrichi) [web]
- Vue **Kanban** (toggle via `ViewToggle` existant) : colonnes par statut — Nouveau (OPEN),
  En analyse (IN_PROGRESS), Résolu (RESOLVED) — + lane dérivée « En attente humain » (IN_PROGRESS
  avec ProposedAction PENDING). Cartes avec badges severity/priority + **SLA** (compte à rebours /
  « En retard » si `slaBreached`) + assignee + caseNumber.
- Détail cas : timeline (`GET :id/timeline`), notes (liste + ajout), pièces jointes
  (`GET/POST /documents`), proposed actions, checklist du playbook, impact (details), actions
  Resolve/Dismiss/Assign/Start.
- Compléter la liste de catégories du filtre (manquantes aujourd'hui).

## Contraintes
- Transitions via `canTransitionOperationalTask` (règle 2) — inchangé. Idempotence tâche/policy
  inchangée. Escalade best-effort/race-safe (règle 24/27/28 préservées : jamais de crash).
- Tenant-scopé (règle 1), numéros via `SequencesService` (règle 8), notifs via
  `NotificationsService`, docs via `DocumentsService` (règle 12), timeline calculée à la lecture
  (règle 30), playbooks/SLA purs dans `@pulsar/shared`.
- Migration légère (colonnes nullables, pas de backfill).

## Critères de succès
1. Nouvelles tasks portent `caseNumber` + `slaDueAt` ; anciennes intactes (nullable).
2. SLA dépassé → escalade (escalatedAt + notification) idempotente, best-effort, sans crash.
3. `GET :id/timeline` fusionne transitions + proposed actions + notes (read-time).
4. Notes ajoutables ; documents attachables.
5. Kanban Workbench avec SLA/priorité ; détail cas enrichi.
6. Playbooks/SLA purs testés ; typecheck propre ; API boote.
