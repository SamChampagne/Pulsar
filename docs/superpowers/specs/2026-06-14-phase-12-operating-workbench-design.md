# Phase 12 — Operating Workbench (design)

> 🇫🇷 Spec de conception. Première phase de la roadmap Agent OS
> ([2026-06-14-pulsar-agent-os-roadmap.md](./2026-06-14-pulsar-agent-os-roadmap.md)).
> Adopté le 2026-06-14. Règles de dev : [CLAUDE.md](../../../CLAUDE.md).

## Objectif

Livrer le **squelette opérationnel** de Pulsar — `événement → policy → tâche → assignation
(humain|agent) → ProposedAction → audit` — **prouvé de bout en bout par un agent réel** :
l'agent répartition/exceptions est réveillé par le système (sans ⌘K), traite ses cas assignés,
et propose des actions via la file de gouvernance existante (palier 11).

Tranche **verticale** : on ne bâtit pas une plateforme d'infra abstraite, on prouve la boucle
complète avec un seul agent et un jeu d'événements minimal. La généralisation (tous les agents
always-on, heartbeat, run history) est la phase 13 ; les policies data-driven sont la phase 14.

## Décisions de conception verrouillées

1. **Un seul modèle `OperationalTask`** (pas de table `ExceptionCase` séparée). Les exceptions
   sont des tâches de `type = EXCEPTION`. YAGNI, extensible (d'autres `type` plus tard).
2. **Boucle headless minimale INCLUSE** : l'agent travaille ses cas sans conversation ⌘K.
3. **Policies en code** (registre, comme le tool-registry) — pas de moteur configurable (phase 14).
4. **Événements ajoutés à 2-3 sites seulement** (retard, refus/expiration tender) — pas de refonte
   de tous les émetteurs existants.
5. On **étend** le substrat du palier 11, on ne le reconstruit pas : la file `ProposedAction`
   (champ `triggeredByRef` déjà présent), les caps/idempotence, l'auto-approbation sous autonomie,
   le runtime Hermes par tenant (R1), le faux serveur ACP de test (palier 2a) sont réutilisés tels quels.

## Flux cible

```
événement métier (stop.delayed, tender.declined, tender.expired)
  → DomainEventsService.emit()            [nouveau ; calqué sur l'outbox webhook]
  → DomainEvent (PENDING, durable)
  → cron processPending() applique les EventPolicy
  → OperationalTask (OPEN, dedupKey unique, assignée à l'agent répartition s'il existe)
  → inbox unifiée /workbench (humains + agents)
  → WorkbenchAgentRunner (cron) réveille l'agent sur ses cas OPEN assignés
  → session Hermes headless (config R1 par tenant) ; l'agent voit le cas + ses outils
  → appels d'outils via le MÊME chemin de gouvernance (POST /mcp en tant qu'agent) :
       READ/LOW direct ; MUTATING/SENSITIVE → ProposedAction (triggeredByRef = "task:<id>")
  → humain approuve dans l'inbox actions (ou auto sous autonomie ACT_LOW/AUTONOMOUS + caps)
  → OperationalTask RESOLVED + audit
```

## Composants

### 1. `DomainEventsService` (nouveau `apps/api/src/core/operating/`)

- `emit(tenantId, type, subject, payload)` persiste une ligne `DomainEvent` (statut `PENDING`).
  Émission **best-effort, non bloquante** : un échec d'émission ne casse jamais la mutation métier.
- `@Cron(EVERY_MINUTE) processPending()` : prend les `DomainEvent` `PENDING` (bornés), applique
  les policies (§2), crée/dédoublonne les `OperationalTask`, marque l'event `PROCESSED`
  (ou `FAILED` + `lastError`). Race-safe via claim conditionnel `updateMany`.
- Pas de bus pub/sub en mémoire : la durabilité passe par la table, comme `WebhookDelivery`.

### 2. `EventPolicy` (registre en code)

- Tableau de règles dans `apps/api/src/core/operating/event-policies.ts`.
- Une règle : `{ eventType, match?(payload), produce(event) → TaskSpec }`.
- `TaskSpec` = `{ type, category, severity, title, subjectType, subjectId, dedupKey, details, assignTo }`.
- `assignTo` : l'agent répartition du tenant si présent et always-on, sinon `UNASSIGNED`
  (l'humain prend le relais dans l'inbox).
- Policies de la phase 12 :
  - `stop.delayed` → `OperationalTask(type=EXCEPTION, category=DELAY, severity from minutesLate)`.
  - `tender.declined` / `tender.expired` → `OperationalTask(type=EXCEPTION, category=TENDER_FAILURE)`.
- Une fonction pure `resolvePolicies(event) → TaskSpec[]` (testable unitairement).

### 3. Modèle `OperationalTask` + enums + machine d'états

Champs : `id`, `tenantId`, `type` (`OperationalTaskType`), `category` (string),
`status` (`OperationalTaskStatus`), `severity` (réutilise `NotificationLevel`),
`title`, `details` (JSON), `subjectType` (string), `subjectId` (string),
`assigneeType` (`HUMAN`|`AGENT`|`UNASSIGNED`), `assigneeUserId?`, `assigneeAgentId?`,
`dedupKey` (unique `(tenantId, dedupKey)`), `sourceEventId?`, `resolvedById?`,
`resolutionNote?`, `createdAt`, `updatedAt`, `resolvedAt?`.

Enums dans `@pulsar/shared` (miroir Prisma — règle 3) :
- `OperationalTaskType` : `EXCEPTION` (extensible).
- `OperationalTaskStatus` : `OPEN`, `IN_PROGRESS`, `RESOLVED`, `DISMISSED`.

Machine d'états `canTransitionOperationalTask` dans `packages/shared/src/workflows` (règle 2) :
- `OPEN → IN_PROGRESS | DISMISSED`
- `IN_PROGRESS → RESOLVED | DISMISSED | OPEN`
- terminal : `RESOLVED`, `DISMISSED`.

### 4. Inbox unifiée (API + web)

Endpoints (`OperationalTasksController`, gated par permissions, règle 5) :
- `GET /operational-tasks` — `Paginated<T>`, filtres `status`/`type`/`assigneeType`/`category`.
- `GET /operational-tasks/:id` — détail + actions proposées liées (`triggeredByRef = task:<id>`).
- `POST /operational-tasks/:id/assign` — `{ assigneeType, assigneeUserId?|assigneeAgentId? }`.
- `POST /operational-tasks/:id/resolve` — `{ note? }` (via la machine d'états).
- `POST /operational-tasks/:id/dismiss` — `{ note? }`.
- `POST /operational-tasks/:id/note` — commentaire (timeline).

Permissions (catalogue `packages/shared/src/permissions.ts`, règle 5) :
`core.operating.tasks.read`, `core.operating.tasks.manage`.

Transitions et résolutions auditées (`AuditLogsService.log`, règle 6).

Web : page `/workbench` (pattern liste+Panel phase 9) — liste filtrable, Panel détail montrant
le cas, son sujet (lien vers le load/stop), les actions proposées liées et leur statut, la
timeline (events + notes). Entrée de navigation conditionnée sur `core.operating.tasks.read`.

### 5. `WorkbenchAgentRunner` (tick headless — la nouveauté)

- `@Cron` (toutes les 2-5 min) dans `core/operating/`.
- Pour chaque tenant ayant un agent de rôle répartition `ACTIVE` avec always-on activé
  (flag sur `Agent.caps`, ex. `caps.alwaysOn`) :
  1. prend jusqu'à N `OperationalTask` `OPEN` assignées à cet agent (`assigneeAgentId`) ;
  2. passe chaque tâche `OPEN → IN_PROGRESS` (claim atomique) ;
  3. ouvre une session Hermes **headless** via `AgentRuntimeService.openSession`
     (config R1 par tenant), injecte un prompt structuré : le cas, son sujet, les outils permis ;
  4. laisse l'agent jouer un tour ; ses appels d'outils tapent `POST /api/v1/mcp` **en tant
     qu'agent** (jeton de session court, comme palier 2a) → chemin de gouvernance intact ;
  5. ferme la session.
- **Best-effort & isolé** (règle 24) : Hermes indisponible / erreur ⇒ log + skip, la tâche
  redevient `OPEN` (ou reste `IN_PROGRESS` avec retry borné), **jamais de crash**.
- **Bornage** : N tâches/tick, concurrence limitée, un seul tour par tâche par tick.
- **Kill switch** : agent `REVOKED` ou `caps.alwaysOn=false` ⇒ l'agent n'est plus réveillé.
- Délibérément minimal (un seul rôle, borné). La généralisation = phase 13.

### 6. Outils workbench dans le registre (règle 21)

Ajoutés à `tool-registry.ts` pour que l'agent gère sa file :
- `list_my_tasks` (READ) — ses cas OPEN/IN_PROGRESS.
- `get_task` (READ) — détail d'un cas + sujet.
- `resolve_task` (LOW) — résout un cas avec note.
- `add_task_note` (LOW) — ajoute une note.
Les outils d'action métier (re-tender, etc.) sont les outils TMS existants déjà au registre ;
en MUTATING ils passent par la file avec `triggeredByRef = task:<id>`.

### 7. Upgrade `DelayDetectionService`

Après le `DELAYED` TrackingEvent + Notification existants (inchangés), ajoute
`domainEvents.emit('stop.delayed', { stopId, loadId, deadline, minutesLate })`. Idempotence
préservée (même dedupKey logique). Pareil aux sites tender (`tender.declined`/`expired`).

## Migration

21ᵉ migration : tables `DomainEvent` (+ statut) et `OperationalTask` (+ enums
`OperationalTaskType`, `OperationalTaskStatus`), index `(tenantId, status)`,
unique `(tenantId, dedupKey)`. Générée en non-interactif (`prisma migrate diff` + `migrate deploy`).

## Tests

- **Unitaires** (`pnpm test`, `@pulsar/shared`) : `canTransitionOperationalTask` ;
  `resolvePolicies(event)` (pure) ; dérivation de `dedupKey`/`severity`.
- **e2e** `phase12-operating-workbench` : retard simulé (clock injecté dans `DelayDetection.tick`)
  → `DomainEvent` → `processPending` crée la tâche → visible dans `/operational-tasks` →
  faux serveur ACP (réutilisé du palier 2a) joue l'agent → action proposée avec
  `triggeredByRef=task:<id>` → approbation humaine → tâche `RESOLVED`. Plus un cas
  `assigneeType=UNASSIGNED` (pas d'agent) résolu manuellement par un humain.

## Hors périmètre (différé, explicitement)

- Policies configurables data-driven → **phase 14**.
- Tous les agents always-on + heartbeat + historique de runs + concurrence générale → **phase 13**.
- Deux modèles séparés (ExceptionCase) → fusionnés dans `OperationalTask`.
- Custom fields / checklists / configurabilité → **Acte III**.
- Refonte de tous les sites d'émission d'événements → seulement retard + tender en phase 12.

## Nouvelle règle dure (à ajouter à CLAUDE.md en fin de phase)

> 27. (phase 12) Les `OperationalTask` ne changent de statut QUE via `canTransitionOperationalTask`
> (`@pulsar/shared/workflows`). Une tâche produite par une policy est idempotente sur
> `(tenantId, dedupKey)`. Le `WorkbenchAgentRunner` est best-effort et isolé (Hermes absent ⇒
> skip, jamais de crash) ; les actions de l'agent passent TOUJOURS par la file `ProposedAction`
> avec `triggeredByRef = "task:<id>"` — l'autonomie n'exécute jamais hors caps.
