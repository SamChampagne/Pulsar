# Module I — Rules / Policy Builder (spec)

Backlog F→J. Branche `analytics-control-tower`. Autonomie (mandat Lebron).

## But

Une UI « **Quand** \<événement\> [**Si** \<conditions\>] **Alors** créer une tâche » configurable par
tenant, **au-dessus** du moteur de policies existant (codé en dur). Couche **purement additive** :
les policies codées et l'émission/traitement d'événements ne changent pas ; on consulte des règles
custom au **point d'intégration unique** après `resolvePolicies`.

## Existant réutilisé (NE PAS modifier le comportement)

- `resolvePolicies(event)` (`@pulsar/shared/operating/policies.ts`) → `TaskSpec[]` (pur). 14 events
  catalogués dans `DOMAIN_EVENT_TYPES`. `TaskSpec` = {type,category,severity,title,subjectType,
  subjectId,dedupKey,details,assignHint}.
- `DomainEventsService.processPending` (`core/operating/domain-events.service.ts:~83`) = **point
  d'intégration unique** : après `resolvePolicies`, concaténer les TaskSpec des règles custom.
  Best-effort (règle 24) : une règle qui throw ne doit JAMAIS empêcher les tâches codées.
- Création de tâche idempotente sur `(tenantId, dedupKey)`. Assignation agent via
  `TaskAssignmentResolver` (caps.alwaysOn ∩ handlesCategories) — inchangée.
- Patterns de config tenant : entité dédiée (`AgentRuntimeConfig`) OU JSON (`Agent.caps`,
  `Tenant.settings`). Ici → **entité dédiée `AutomationRule`** (requêtable par eventType).

## Périmètre LIVRÉ (I-phase-1)

### Action supportée = CREATE_TASK uniquement

La règle produit une `OperationalTask` (exactement comme une policy codée). Autres actions (email,
appel d'outil agent, webhook) → **I-phase-2**. C'est l'action la plus utile et zéro risque (slotte
dans le pipeline TaskSpec existant).

### Incrément 1 — shared + database + permissions

**`@pulsar/shared`** (nouveau dossier `src/automation/`, pure data + fonctions pures, browser-safe,
aucun import Node) :
```ts
type RuleOperator = 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'contains'|'exists'|'not_exists';
type RuleMatch = 'ALL'|'ANY';
interface RuleCondition { field: string; operator: RuleOperator; value?: string|number|boolean }
interface RuleAction {
  kind: 'CREATE_TASK';
  category: string;            // catégorie OperationalTask (réutiliser les 11 existantes ou custom)
  severity: 'INFO'|'WARNING'|'CRITICAL';
  titleTemplate: string;       // interpolation {chemin.point}
  assignHint: 'AUTO'|'UNASSIGNED';
  subjectField?: string;       // dot-path du subjectId dans le payload (défaut: subjectId|id)
  subjectType?: string;        // défaut: eventType
}
interface AutomationRuleLike { id; eventType; match: RuleMatch; conditions: RuleCondition[]; action: RuleAction }
```
Fonctions pures + **tests** :
- `getByPath(obj, 'a.b.c')` ; `evaluateRuleConditions(conditions, match, payload): boolean`
  (operators numériques/chaîne/exists ; `ALL`/`ANY` ; conditions vides ⇒ true).
- `interpolateTemplate(tpl, payload): string` (remplace `{path}`, vide si absent).
- `produceRuleTaskSpec(rule, event): TaskSpec | null` — résout subjectId via `subjectField` (fallback
  `payload.subjectId`/`payload.id`/`event.subjectId`) ; **dedupKey = `rule:${rule.id}:${subjectId}`**
  (idempotent, ne peut PAS collisionner avec les dedupKey des policies codées) ; category/severity/
  title/assignHint depuis l'action ; `type='EXCEPTION'`. Retourne null si subjectId introuvable.
- `AUTOMATION_EVENT_CATALOG: { type; label; description; fields: { path; label; kind: 'string'|'number'|'boolean' }[]; defaultSubjectField }[]`
  — un descripteur par event de `DOMAIN_EVENT_TYPES` (champs connus du payload pour piloter les
  dropdowns du builder). `RULE_OPERATORS` (libellés) + `SUGGESTED_TASK_CATEGORIES` (les 11 existantes).
- Exporter le tout depuis l'index `@pulsar/shared`.

**`packages/database`** :
- Modèle `AutomationRule` : `id, tenantId, name, eventType (String), enabled (Boolean @default(true)),
  match (String), conditions (Json), action (Json), createdById?, createdAt, updatedAt`,
  `@@index([tenantId, eventType, enabled])`, `@@map("automation_rules")`. **Pas de nouvel enum
  Prisma** (match/operator/severity vivent en union TS shared, stockés en String/Json).
- Migration SQL à la main (pattern `migrations/<timestamp>_automation_rules/migration.sql`, suivre
  les migrations récentes) + `pnpm db:generate` (offline). La migration s'applique au prochain
  `pnpm db:migrate`.

**`permissions.ts`** : `CORE.AUTOMATION_RULES_READ='core.automation.rules.read'`,
`CORE.AUTOMATION_RULES_MANAGE='core.automation.rules.manage'` (catalog → repris par le seed).

### Incrément 2 — API (CRUD + intégration)

- `core/automation/automation-rules.{controller,service}.ts` :
  - `GET /automation/rules` (READ, paginé/liste), `GET /automation/rules/:id`,
    `POST /automation/rules` (MANAGE), `PATCH /automation/rules/:id` (MANAGE),
    `DELETE /automation/rules/:id` (MANAGE). Tenant-scopé (règle 1). Audit create/update/delete
    (règle 6, via `@Audit` ou `AuditLogsService.log`). DTO validés : `eventType` ∈ catalog,
    `action.kind='CREATE_TASK'`, `action.category` non vide, `severity`/`assignHint`/`match`/
    operators dans les unions, conditions bien formées.
  - Endpoint optionnel `POST /automation/rules/:id/test` (évalue conditions+produit le TaskSpec sur
    un payload fourni, sans rien créer) — **différable** si temps limité.
- `CustomRuleResolver` (core/operating ou core/automation) : `resolve(tenantId, eventType, payload):
  Promise<TaskSpec[]>` — query `automationRule` WHERE `{tenantId, eventType, enabled:true}`, pour
  chaque règle `evaluateRuleConditions` puis `produceRuleTaskSpec` (try/catch par règle, log, jamais
  throw). Injecté dans `DomainEventsService` ; appelé après `resolvePolicies`, specs concaténés
  AVANT la boucle de création. **Ne change pas** la logique existante.

### Incrément 3 — Web (Rules Builder UI)

- Page `apps/web/src/routes/(app)/automation/+page.svelte` : liste des règles (nom, event, enabled
  toggle, action résumée) + création/édition via builder :
  1. choisir l'event (depuis `AUTOMATION_EVENT_CATALOG`) → affiche les champs dispo,
  2. match ALL/ANY + conditions (field dropdown depuis le catalog, operator, value),
  3. action : category (suggérées + libre), severity, titleTemplate (avec aide `{champ}`),
     assignHint, subjectField/subjectType optionnels.
  - CRUD via `api<T>()`. Toggle enabled = PATCH. Suppression confirmée. Empty states.
- Nav : domaine **Agents** (autonomie gouvernée / operating), ajouter
  `{ href: '/automation', label: "Règles d'automatisation", perm: AUTOMATION_RULES_READ }` +
  `/automation` aux prefixes du domaine agents.

## DIFFÉRÉ (I-phase-2)

- Actions autres que CREATE_TASK (email, appel d'outil agent via la file ProposedAction, webhook).
- Éditeur de conditions imbriquées (groupes), simulation « dry-run » sur événements historiques,
  versioning/audit-trail détaillé des règles, activation/désactivation planifiée.

## Règles CLAUDE.md

- Règle 1 (tenant scope partout), 2 (les tâches gardent leurs transitions via
  `canTransitionOperationalTask` — inchangé), 5 (perms ; core → pas de module), 6 (audit CRUD),
  24/27 (best-effort : une règle ne casse jamais `processPending` ; idempotence (tenantId,dedupKey)),
  3/7 (shared+database changés ⇒ rebuild). Moteur de règles **pur** dans `@pulsar/shared`.

## Tâches

- **I-T1 (shared+db+perms)** : types/évaluateur/catalog + tests ; modèle `AutomationRule` + migration
  + generate ; 2 permissions. Vérifier : `pnpm test` (shared) vert sur les nouveaux tests,
  `pnpm --filter @pulsar/shared build` + `db:generate` OK, typecheck shared 0 err.
- **I-T2 (api)** : CRUD + `CustomRuleResolver` + intégration `processPending`. Vérifier : typecheck
  api 0 nouvelle err, build nest OK, resolver best-effort (try/catch), gating+audit+tenant-scope.
- **I-T3 (web)** : page `/automation` + nav. Vérifier : `pnpm --filter web typecheck` 0 err.
- Reviewer après chaque incrément.
