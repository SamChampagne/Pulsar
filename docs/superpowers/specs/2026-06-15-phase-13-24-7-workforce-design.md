# Phase 13 — La main-d'œuvre 24/7 — Design

> Statut : approuvé (brainstorm 2026-06-15). Acte I de la roadmap Pulsar Agent OS
> ([roadmap](./2026-06-14-pulsar-agent-os-roadmap.md)). Suit la phase 12 (Operating Workbench).

## Objectif

Généraliser la boucle always-on *minimale* de la phase 12 en un véritable **runtime de
workers d'agents permanents** : n'importe quel agent always-on est réveillé par événement
(et non plus seulement par cron), chaque réveil est tracé, la concurrence est plafonnée, les
échecs transitoires sont rejoués, et un opérateur peut **mettre en pause / tuer un agent à
chaud**. C'est ce qui transforme les agents en employés 24/7 plutôt qu'en assistants de chat.

Ce que la phase 13 **n'est pas** : on ne construit pas de process Hermes long-vécu, pas
d'horaires cron par agent, pas de moteur d'autonomie (phase 14), pas de KPI/Control Tower
(phase 15).

## Décisions verrouillées (brainstorm)

1. **Modèle worker = éphémère + couche de gestion.** On garde le spawn session-par-run actuel
   (`AgentRuntimeService` : Hermes lancé → turn(s) → tué). On l'**enrobe** d'une couche de
   gestion (dispatcher, ledger, heartbeat, concurrence, kill switch). On NE construit PAS de
   daemon persistant par agent : la valeur de la phase 13 est orthogonale à la persistance du
   process, et un daemon raviverait la contrainte cross-tenant de l'enregistrement MCP global
   de Hermes (règle 24) + risquerait de faire crasher le cœur.
2. **Déclencheurs = événement + cron-filet.** Réveil événementiel immédiat à l'assignation
   d'une tâche à un agent always-on ; le cron 5 min existant devient un filet de sécurité
   (rebalaie les tâches OPEN manquées). **Pas** d'horaires cron par agent.
3. **`PAUSED` ajouté à `AgentStatus`** (réversible) ≠ `REVOKED` (décommission permanente).
4. **File en mémoire** (mono-process, comme le cache ModulesGuard) — pas de table de queue
   durable. Le ledger `AgentRun` est le registre durable ; au reboot le cron-filet redécouvre
   les tâches OPEN (idempotent via le claim de tâche) → rien n'est perdu.
5. **Plafonds de concurrence par défaut : global 4, par tenant 2, par agent 1.**
6. **Retry uniquement sur erreur de connectivité runtime** (`ServiceUnavailableException`) ;
   tout le reste est terminal.

## Architecture

### `AgentWorkerService` — le dispatcher (cœur de la phase)

Remplace la boucle cron brute de `WorkbenchAgentRunner`. Un dispatcher unique par process avec
une file de runs en mémoire et un contrôle de concurrence.

Entrées (toutes best-effort, ne throw jamais) :

- **événement** — quand une policy crée+assigne une `OperationalTask` à un agent always-on,
  l'API appelle `worker.enqueue(run)` immédiatement (plus d'attente jusqu'à 5 min).
- **cron-filet** — le `@Cron(EVERY_5_MINUTES)` existant rebalaie les tâches OPEN des agents
  always-on et enfile les manquées (idempotent : le claim de tâche `OPEN→IN_PROGRESS` garde
  l'unicité).
- **manuel** — « Run now » depuis l'UI → `enqueue(run, trigger=MANUAL)`.

Contrôle de concurrence (env, défauts) :

| Plafond           | Env                              | Défaut |
| ----------------- | -------------------------------- | ------ |
| Global concurrent | `AGENT_WORKER_MAX_CONCURRENT`    | 4      |
| Par tenant        | `AGENT_WORKER_MAX_PER_TENANT`    | 2      |
| Par agent         | (constante)                      | 1      |

Le « par agent = 1 » garantit qu'un agent traite ses tâches **en série** (pas de course sur le
même sujet). Ces plafonds bornent le nombre de child process Hermes simultanés.

Le dispatcher tire de la file en respectant les plafonds ; un slot libéré → on dépile le
prochain run éligible. La file est volatile : sa perte au reboot est rattrapée par le
cron-filet.

### Cycle de vie d'un run

1. `enqueue` crée un `AgentRun` `QUEUED` (durable) + pousse dans la file mémoire.
2. Le dispatcher claim un slot (global/tenant/agent), passe le run `RUNNING`, claim la tâche
   (`OperationalTasksService.start`, `OPEN→IN_PROGRESS`).
3. Spawn Hermes (`AgentRuntimeService.openSession` avec `triggeredByRef = "task:<id>"`),
   un turn, drain des events, `closeSession`.
4. Succès → `AgentRun.status = SUCCEEDED`, `proposedActionCount` renseigné, `Agent.lastRunAt`
   et `lastSeenAt` mis à jour.
5. Échec :
   - **transitoire** (`ServiceUnavailableException` : Hermes indispo / timeout spawn / 503) →
     retry ≤ `MAX_ATTEMPTS` (défaut 2) avec backoff, `attempt++`. Épuisé → tâche revenue OPEN,
     `AgentRun = FAILED`.
   - **autre** → terminal : `AgentRun = FAILED`, tâche revenue OPEN + note.
6. Si Hermes n'est jamais joignable (pas installé / pas de runtime config) → `SKIPPED`
   (règle 24 : Hermes absent ⇒ skip, jamais de crash).

### Kill switch à chaud

`AgentStatus.PAUSED` (réversible). « À chaud » signifie que le dispatcher :

1. **refuse de démarrer** un run pour un agent non-ACTIVE (vérifié au claim) ;
2. **tue immédiatement les child process Hermes en vol** de cet agent. Pour cela, on indexe
   `agentId → sessionId(s) vivants` dans `AgentRuntimeService` (aujourd'hui `this.live` est
   keyé par sessionId uniquement) ; `killAgentSessions(agentId)` ferme/tue ces sessions.

Un run interrompu par une pause → `AgentRun.status = KILLED`, tâche revenue OPEN.

Endpoints :

- `POST /agents/:id/pause` → `status = PAUSED` + `killAgentSessions`.
- `POST /agents/:id/resume` → `status = ACTIVE`.
- `POST /agents/:id/run-now` → `enqueue(trigger = MANUAL)` (sur la prochaine tâche OPEN, ou
  no-op si aucune).
- `POST /agents/pause-all` → arrêt d'urgence tenant (boucle de pause sur les agents du tenant).

Gardés par les permissions agents existantes (`agents.manage` ou équivalent — à confirmer dans
le catalogue à l'implémentation).

## Modèle de données — 22ᵉ migration

### Nouvelle entité `AgentRun`

| Champ                 | Type                                                      | Notes                                  |
| --------------------- | -------------------------------------------------------- | -------------------------------------- |
| `id`                  | cuid                                                     |                                        |
| `tenantId`            | string (index)                                           | isolation (règle 1)                    |
| `agentId`             | string (FK Agent)                                        |                                        |
| `trigger`             | enum `AgentRunTrigger { EVENT, CRON, MANUAL }`           |                                        |
| `taskId`              | string? (FK OperationalTask)                             | la tâche traitée, si applicable        |
| `triggeredByRef`      | string?                                                  | miroir du ref du jeton de session      |
| `status`              | enum `AgentRunStatus { QUEUED, RUNNING, SUCCEEDED, FAILED, SKIPPED, KILLED }` | |
| `attempt`             | int (défaut 1)                                           | compteur de retry                      |
| `startedAt`           | DateTime?                                                | null tant que QUEUED                   |
| `finishedAt`          | DateTime?                                                |                                        |
| `error`               | string?                                                  | message en cas de FAILED               |
| `proposedActionCount` | int (défaut 0)                                           | métrique : actions enfilées ce run     |
| `model`               | string?                                                  | snapshot du modèle agent               |
| `createdAt`           | DateTime                                                 |                                        |

Index : `@@index([tenantId, agentId, createdAt])`, `@@index([tenantId, status])`.
`AgentRunTrigger` et `AgentRunStatus` vivent dans `@pulsar/shared` (enums) + miroir Prisma
(règle 3).

### Champs ajoutés à `Agent`

- `lastSeenAt DateTime?` — dernier contact runtime réussi (heartbeat).
- `lastRunAt DateTime?` — début du dernier run.

### Enum `AgentStatus`

Ajout de `PAUSED`. Miroir Prisma + `@pulsar/shared`. `agentSelect` partagé continue d'exclure
`secretHash`/`serviceUserId` (règle 26).

## API

- `GET /agents/:id/runs` — `Paginated<AgentRunView>`, projection sans secrets (règle 26),
  triée `createdAt desc`. Gardée par la permission de lecture agents existante.
- `POST /agents/:id/pause` · `/resume` · `/run-now` · `POST /agents/pause-all` (cf. kill switch).
- `GET /agents/:id` enrichi : `status` (incl. PAUSED), `lastSeenAt`, `lastRunAt`.

## UI (étend l'espace `/agents` de la phase 11 R2)

- `/agents/[id]` : onglet **Activité 24/7** — table d'historique (`trigger`, tâche, `status`,
  début, durée, erreur), badge heartbeat (« actif / en pause / vu il y a X »), boutons
  **Pause / Resume / Run now**.
- `/agents` (roster) : pastille de statut online/paused.

Suit le pattern web existant (`$state` + `$effect` → `load()`, client `api<T>()`, erreurs
locales). Aucun import `node:*` au niveau module dans `@pulsar/shared` (leçon technique : casse
le build web).

## Nouvelle règle dure (CLAUDE.md, phase 13)

> **28. (phase 13 — Main-d'œuvre 24/7)** Tout réveil d'un agent always-on passe par
> `AgentWorkerService` (dispatcher unique, file en mémoire, concurrence plafonnée
> global/tenant/agent) ; chaque réveil est enregistré comme `AgentRun` (durable). `PAUSED` est
> le kill switch à chaud réversible (tue les sessions Hermes en vol de l'agent) ; `REVOKED`
> reste permanent. Le retry ne s'applique qu'aux erreurs de connectivité runtime
> (`ServiceUnavailableException`) ; tout autre échec est terminal et renvoie la tâche en OPEN.
> Le dispatcher est best-effort et isolé (règle 24 préservée : Hermes absent ⇒ run `SKIPPED`,
> jamais de crash) ; les actions de l'agent passent TOUJOURS par la file `ProposedAction` avec
> `triggeredByRef = "task:<id>"`.

## Tests

E2e (sur DB seedée, faux Hermes) :

1. Agent always-on + événement (assignation de tâche) → run enfilé puis exécuté →
   `AgentRun = SUCCEEDED` + `ProposedAction` avec `triggeredByRef = task:<id>`.
2. Pause en vol → `AgentRun = KILLED`, tâche revenue OPEN, sessions Hermes tuées.
3. Faux Hermes-down transitoire → retry → `attempt = 2` ; épuisé → `FAILED`, tâche OPEN.
4. Hermes absent → `SKIPPED`, jamais d'exception (règle 24).
5. Plafond de concurrence respecté (N runs enfilés, ≤ cap simultanés).
6. Cron-filet rattrape une tâche OPEN jamais enfilée par événement.
7. `GET /agents/:id/runs` ne renvoie ni `secretHash` ni `serviceUserId`.

Unit : machine d'états/classification des échecs du dispatcher (pure si extraite dans
`@pulsar/shared`), respect des plafonds.

## Hors périmètre (phases suivantes)

- Moteur d'autonomie / policy-as-data graduée → **phase 14**.
- KPI par agent, dashboard manager, red-team → **phase 15**.
- Horaires cron par agent (agents proactifs sans tâche) → ultérieur si besoin.
- Process Hermes persistant / pooling → non retenu (décision 1).
