# Control Tower de flux v1 — design

> Spec de design. **Arc A** du grand programme « plateforme tressée » adopté avec Sam le
> 2026-06-21 (séquence A → B → C : *flux visible → tressage approfondi → modules configurables*).
> Cet arc rend **visible** le système nerveux inter-modules qui existe déjà ; il n'en crée pas de
> nouveau (les nouveaux événements/actions inter-modules = arc B).

## 0. Intention & principe

Pulsar a déjà un système nerveux : un outbox `DomainEvent` (13 types, tous les modules, dont 2
inter-modules), des `OperationalTask` produites par policies, des `ProposedAction` exécutées par les
agents, et un `AuditLog`. **La causalité est déjà enregistrée dans les données**, mais invisible :
le Control Tower actuel ne montre que des KPI figés (snapshots) + une liste d'alertes.

Cet arc surface ce flux en **trois vues** bâties sur **une seule épine dorsale de données**, le tout
**calculé à la lecture** (règle 30 — comme le Control Tower actuel : aucun store de rollup, calculs
purs dans `@pulsar/shared`). Réponse directe à « voir qui envoie quoi à qui, qui fait quoi ».

**Invariants directeurs :**
- Aucune mutation : cet arc est **lecture seule** (les outils agent sont tier READ). Le tressage
  actif (nouveaux events, actions auto module→module) est l'arc B.
- Tenant isolation (règle 1) sur toutes les requêtes ; projections agent sans `secretHash`/
  `serviceUserId` (règle 26).
- Outils agent **via le registre** (règle 21), tier READ → exécution directe (règle 22, pas de file).
- Calculs purs et testables dans `@pulsar/shared` ; rafraîchissement par **polling** (comme l'OpsMap
  existant), pas de temps-réel.

## 1. Épine dorsale — la chaîne de causalité

La causalité est reconstituable par des clés déjà présentes :

```
DomainEvent.id  ←  OperationalTask.sourceEventId  ←  ProposedAction.triggeredByRef ("task:<id>")  →  résultat (resultJson) / AuditLog
```

Helper pur `buildFlowChains(events, tasks, actions, audit)` → liste de `FlowChain` :

```ts
interface FlowChain {
  event: FlowEvent;                 // l'événement déclencheur (ou null pour une action sans event)
  tasks: FlowTask[];                // tâches dont sourceEventId == event.id
  actions: FlowAction[];            // actions dont triggeredByRef == "task:<taskId>"
  modules: ModuleKey[];             // modules touchés par la chaîne (dérivés)
  crossModule: boolean;            // true si la chaîne traverse ≥2 modules
  startedAt: string; lastAt: string;
}
```

Les `FlowEvent`/`FlowTask`/`FlowAction` sont des projections minces (pas d'exposition de secrets).
Le module d'un événement est dérivé de son type via `moduleOfEventType(type)` (pur : `wms.*`→WMS,
`yard.*`→YARD, `fleet.*`→FLEET, `tender.*`/`stop.*`/`driver.*`→TRANSPORTATION,
`carrier-invoice.*`→BILLING, `portal.*`→CUSTOMER_PORTAL).

## 2. Vue 1 — Timeline d'activité (le cœur)

Flux chronologique unifié de tout ce qui se passe à travers les modules (events + tâches + actions
agent + audit pertinent), fusionné via `mergeTimeline` (déjà existant) et **enrichi des chaînes de
causalité** : chaque entrée dépliable montre `événement → tâche(s) → action(s) agent → résultat`.

- Filtres : module(s), type d'événement, plage (`days` 1/7/30), bascule « inter-modules seulement ».
- Endpoint : `GET /analytics/flow/timeline?days&modules&types&crossOnly&limit`.
- Borne dure de résultats (`limit`, défaut 200) — pas de scan non borné.

## 3. Vue 2 — Tracé de parcours d'entité

Recherche une entité racine (TransportOrder, ou Shipment/Load) → son **parcours à travers les
modules** en étapes dérivées, avec horodatage, blocages et la chaîne d'events par étape.

- Graphe d'entités suivi (liens **déjà existants**, aucun nouveau couplage) :
  `TransportOrder → Shipment(s) → Load(s) → PickOrder(s) (WMS) / YardVisit(s) (Yard) / IncomingCarrierInvoice (Billing)`.
- Étapes dérivées (pur `buildEntityTrace`) : `Créée → Préparée (WMS, via deriveShipmentPickStatus) →
  Dispatchée (TMS) → Cour (Yard) → Livrée → Facturée (Billing)`, chaque étape `{ stage, status:
  PENDING|ACTIVE|DONE|BLOCKED, at?, refs[], events[] }`.
- Endpoint : `GET /analytics/flow/trace?entityType&entityId`. `entityType ∈ {TRANSPORT_ORDER,
  SHIPMENT, LOAD}` ; on résout la racine puis on agrège events/tâches/actions touchant l'entité **ou
  ses entités liées** (par `subjectId` et via les FK existantes).
- Tenant-scopé + ownership de la racine vérifiée (règle 9).

## 4. Vue 3 — Carte de flux

Vue graphique du réseau : **nœuds = modules**, **arêtes = flux d'événements inter-modules** sur la
plage (volume/débit). Helper pur `buildFlowMap(events)` → `{ nodes: {module, eventCount}[], edges:
{from, to, type, count}[] }`. Les arêtes sortent des chaînes où `source ≠ cible` (l'event d'un module
produit une tâche routée vers un autre — la cible vient de la policy `category`→module). Les flux
intra-module sont agrégés en self-count sur le nœud.

> Détermination source→cible : `moduleOfEventType(event.type)` pour la source ; la cible vient du
> mapping `category → module` de la policy résolue (`@pulsar/shared/operating`). Pur, pas d'I/O.

## 5. Outils agent — observer le tableau

Deux outils **READ** ajoutés au registre (`core/agents/tool-registry.ts`, règle 21 ; tier READ →
exécution directe, règle 22) réutilisant `FlowService` via l'adaptateur `AGENT_TOOL_SERVICES` :
- `get_flow_timeline(args: { days?, modules?, crossOnly?, limit? })` → la timeline causale.
- `trace_entity(args: { entityType, entityId })` → le parcours d'une entité.

Permission : `analytics.read` ; module `ANALYTICS`. L'agent « regarde le tableau » comme un employé,
sans rien muter (le mutating cross-module = arc B).

## 6. Surface technique

- **`packages/shared/src/analytics/flow.ts`** (pur, browser-safe) : types (`FlowEvent`, `FlowTask`,
  `FlowAction`, `FlowChain`, `FlowTimeline`, `FlowMap`, `EntityTraceStage`, `EntityTrace`) + helpers
  `moduleOfEventType`, `buildFlowChains`, `buildFlowMap`, `buildEntityTrace`. Export depuis le barrel.
  Tests unitaires (`flow.spec.ts`).
- **API** (`apps/api/src/modules/analytics/`) : `FlowService` (requêtes read-time tenant-scopées +
  appel des helpers purs) + `FlowController` — `GET /analytics/flow/{timeline,trace,map}`, gated
  `@RequireModule(MODULE_KEYS.ANALYTICS)` + `@RequirePermissions(PERMISSIONS.ANALYTICS.READ)`.
  `FlowService` exporté (consommé par les outils agent).
- **Agent** : 2 `ToolDef` READ dans `tool-registry.ts` + branchement `FlowService` dans
  `ToolServices`/`AGENT_TOOL_SERVICES`.
- **Web** : nouvelle page dédiée **`/analytics/flow`** à 3 onglets (**Timeline** / **Tracé** /
  **Carte**), liée depuis l'overview `/analytics` et depuis le Control Tower (on ne surcharge pas la
  page control-tower existante). Réutilise le design system, polling ~30 s onglet visible (pattern
  OpsMap), et la projection sévérité/badges existante. Entrée nav sous le domaine Analytics.
- **Migration** : **un seul index** `DomainEvent @@index([tenantId, subjectType, subjectId])` pour le
  tracé d'entité (les autres requêtes utilisent les index existants `[status, createdAt]` /
  `[tenantId, type, createdAt]`). Aucune nouvelle table, aucun nouveau statut, aucun enum.

## 7. Tests

- **Unit `@pulsar/shared`** : `moduleOfEventType` (chaque préfixe + inconnu), `buildFlowChains`
  (liaison event↔task↔action par sourceEventId/triggeredByRef, chaîne multi-modules, action orpheline),
  `buildFlowMap` (arêtes inter-modules vs self), `buildEntityTrace` (étapes dérivées + blocage).
- **e2e `flow-control-tower`** (DB seedée) : émettre un événement réel (ex. via un parcours
  tender-decline ou pick-completed), faire tourner le worker, puis `GET /flow/timeline` montre la
  chaîne event→tâche ; `GET /flow/trace` sur une commande montre ses étapes ; `GET /flow/map` agrège ;
  isolation tenant (tenant B ne voit pas le flux de A) ; gating module/permission.
- **Outils agent** : un test que `get_flow_timeline`/`trace_entity` sont exposés (READ) et renvoient
  les mêmes données scopées.

## 8. Hors périmètre (YAGNI / arcs suivants)

- Aucun **nouvel** événement inter-modules ni action automatique module→module (= **arc B**).
- Pas de temps-réel (SSE/WebSocket) — polling.
- Pas de rollup persisté ni de purge des `DomainEvent` (dette existante notée ailleurs).
- Pas de configurabilité de modules (= **arc C**).

## 9. Découpage d'implémentation (aperçu — détaillé dans le plan)

1. `@pulsar/shared/analytics/flow.ts` : types + `moduleOfEventType` + `buildFlowChains` +
   `buildFlowMap` + `buildEntityTrace` + tests. Rebuild shared (règle 7).
2. Migration : index `DomainEvent[tenantId, subjectType, subjectId]`.
3. API `FlowService` + `FlowController` (3 endpoints) + enregistrement module.
4. Outils agent READ (`get_flow_timeline`, `trace_entity`) au registre + adaptateur.
5. Web : 3 onglets sur le Control Tower (Timeline / Tracé / Carte) + polling.
6. e2e `flow-control-tower` + vérification navigateur + docs (etat-du-projet ; règle CLAUDE.md si un
   invariant le mérite — ex. « le flux est calculé à la lecture, aucun rollup ; outils flux en READ »).
