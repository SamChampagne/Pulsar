# Tressage automatique v1 (arc B) — design

> Spec de design. **Arc B** du programme « plateforme tressée » (séquence A → B → C : *flux visible →
> tressage approfondi → modules configurables*). L'arc A (Control Tower de flux) est livré ; il rend
> le système nerveux **visible**. L'arc B le rend **actif** : les modules se déclenchent
> automatiquement entre eux.

## 0. Intention

Donner à la plateforme la capacité de **réagir** : quand un événement métier survient, exécuter
automatiquement une opération **dans un autre module**, de façon déterministe (sans agent ni humain).
On s'appuie sur deux choses qui existent déjà : l'outbox `DomainEvent` (+ son worker `processPending`)
et l'entité `AutomationRule` (règles tenant `eventType` + conditions + action, déjà câblée via
`CustomRuleResolver` — mais dont la **seule action possible aujourd'hui est `CREATE_TASK`**).

Deux pièces :
- **B1 — émettre les événements de cycle de vie manquants** (les signaux inter-modules).
- **B2 — moteur de réactions exécutables** : une nouvelle action de règle qui *fait* quelque chose
  dans un autre module ; livrée avec des tressages built-in **et** un éditeur tenant configurable.

## 1. Modèle de sécurité (central — tout le reste en découle)

L'auto-exécution déterministe contourne la file de gouvernance des agents. Garde-fous :

- **Liste blanche d'opérations sûres & réversibles uniquement** (`REACTION_CATALOG`, `@pulsar/shared`,
  pure data) : créer un pick, créer une facture **brouillon**, avancer un statut interne, créer une
  tâche. **Jamais** d'engagement externe ni d'argent sortant (tender transporteur, ouverture de
  litige, envoi de facture/courriel) — ça reste gouverné par les agents. Les capacités plus
  puissantes sont listées au **§8 Backlog**.
- **Idempotence** : table `ReactionExecution` avec contrainte unique `(tenantId, eventId, ruleId)` —
  un événement re-traité ou une règle re-évaluée n'exécute jamais l'action deux fois. Les handlers
  sont en plus idempotents par construction quand c'est possible (dedup métier).
- **Anti-boucle (un seul saut en v1)** : toute réaction s'exécute dans un contexte qui **tague** les
  `DomainEvent` émis pendant son exécution (`DomainEvent.reactionRuleId`). Le résolveur **n'évalue
  PAS les règles `RUN_ACTION` pour un événement tagué** ⇒ une réaction ne peut pas en déclencher une
  autre en cascade. Les `CREATE_TASK` et les agents continuent normalement. Un plafond dur de
  réactions par tick d'événement est aussi appliqué (filet).
- **Best-effort & isolé** : l'échec d'une réaction est loggé + audité et ne bloque **jamais** le
  traitement de l'événement, la création des tâches, ni les autres réactions.
- **Audit & traçabilité** : chaque exécution est auditée (`AuditLogsService.log`, acteur =
  service-account du tenant, règle 13) avec la cause (`rule:<id>` + `event:<id>`), donc visible dans
  le **flux de l'arc A** (timeline causale).
- **Contrôle** : kill switch par tenant (réglage module) + chaque `AutomationRule` activable/
  désactivable (`enabled`). Une réaction dont un module requis est désactivé est ignorée (no-op).
- **Tenant isolation (règle 1)** sur tout (règles, exécutions, handlers).

## 2. B1 — Événements de cycle de vie manquants

Nouveaux types ajoutés à `DOMAIN_EVENT_TYPES` (`@pulsar/shared/operating`), émis best-effort dans les
services concernés via `DomainEventsService.emit` (comme les events existants — règle « best-effort,
jamais bloquant ») :

| Événement | Émis dans | Sert à (déclencheur de) |
| --- | --- | --- |
| `transport-order.confirmed` | `transport-orders.service` (confirm) | création auto des picks WMS |
| `load.dispatched` | `loads.service.dispatch` | (futur) préparation cour |
| `load.completed` | `loads.service.complete` | relevé client brouillon (Billing) |
| `yard.visit.checked-out` | `visits.service.checkOut` | (futur) avance load IN_TRANSIT |
| `wms.receipt.posted` | `receiving.service` (post) | (futur) dispo dispatch |

`subjectType`/`subjectId` renseignés (ex. `load`/`<id>`). Bénéfice immédiat : tous apparaissent dans
le flux de l'arc A même sans réaction câblée.

## 3. B2 — Moteur de réactions

### 3.1 Catalogue de réactions (pur)
`packages/shared/src/automation/reactions.ts` — pure data, browser-safe : liste de
`ReactionDescriptor { key, label, module, requiredModules: ModuleKey[], description, argKeys: string[] }`.
v1 catalogue (sûr & réversible) :
- `create_picks_for_order` (module WMS) — crée les pick orders des shipments à origine entrepôt d'une commande.
- `draft_customer_invoice` (module BILLING) — crée un relevé client **brouillon** pour un load livré.

(Le catalogue est extensible ; les ajouts futurs au §8.)

### 3.2 Action de règle `RUN_ACTION`
`packages/shared/src/automation/rules.ts` — `RuleAction` gagne la variante
`{ kind: 'RUN_ACTION', action: string /* clé catalogue */, args: Record<string,string> /* templates {payload.path} */ }`
en plus de `CREATE_TASK`. Helper pur `produceRuleReaction(rule, event)` → `ReactionCommand
{ ruleId, action, args }` (args interpolés depuis le payload via `interpolateTemplate` existant).
`CustomRuleResolver.resolve` retourne désormais `{ taskSpecs, reactionCommands }`.

### 3.3 Exécution (API)
- **Registre de handlers** : `ReactionExecutorService` (core/automation) mappe chaque `key` du
  catalogue à un handler `(tenantId, args) => Promise<void>` réutilisant les services métier existants
  (via un adaptateur type `AGENT_TOOL_SERVICES` ou injection directe). Vérifie `requiredModules`
  activés (sinon no-op).
- **Branchement** : `DomainEventsService.processPending`, après la création des tâches, pour chaque
  `ReactionCommand` : revendiquer une ligne `ReactionExecution (tenantId, eventId, ruleId)` (insert
  conditionnel — si déjà présent, skip = idempotence), puis exécuter le handler **dans le contexte
  de tag anti-boucle** (les events émis pendant ⇒ `reactionRuleId` renseigné), en try/catch (échec
  loggé + `ReactionExecution.status=FAILED`, jamais throw), puis audit. Skip les `RUN_ACTION` si
  l'événement courant porte déjà `reactionRuleId` (anti-cascade).

### 3.4 Tressages built-in (clé en main)
Livrés comme `AutomationRule` par défaut (au **seed**, marquées `builtin`/system) :
1. `transport-order.confirmed` → `create_picks_for_order` *(si WMS activé)*.
2. `load.completed` → `draft_customer_invoice` *(si BILLING activé)*.

Désactivables par le tenant comme n'importe quelle règle.

### 3.5 Éditeur configurable (web)
Page d'admin **Automatisations** (sous Réglages ou un domaine dédié) : liste des règles (built-in +
custom), création/édition guidée — `eventType` (select des `DOMAIN_EVENT_TYPES`), conditions
(field/operator/value, match ALL/ANY), action = `CREATE_TASK` (catégorie/sévérité/titre) **ou**
`RUN_ACTION` (select d'une réaction du catalogue + mapping d'arguments depuis le payload),
`enabled` on/off. CRUD via le `AutomationRulesService` existant (étendu pour valider `RUN_ACTION`
contre le catalogue). Gated par **nouvelles permissions `core.automation.read|manage`** (catalogue
`permissions.ts` + seed) — surface d'admin distincte, justifie ses propres clés.

## 4. Migration & permissions

- **Migration** : table `ReactionExecution { id, tenantId, eventId, ruleId, action, status
  (EXECUTED|FAILED), error?, createdAt, @@unique([tenantId, eventId, ruleId]) }` + colonne
  `DomainEvent.reactionRuleId String?` (tag anti-boucle). `AutomationRule` existe déjà.
- **Permission** : nouvelles clés `core.automation.read|manage` (catalogue `permissions.ts` + seed).
- Aucun nouveau statut métier, aucune state machine modifiée (règle 2).

## 5. Conformité CLAUDE.md
Règle 1 (isolation) ; règle 6/13 (audit en service-account) ; règle 9 (FK vérifiées par les services
métier réutilisés) ; les invariants existants des handlers réutilisés sont préservés (ex. un pick
créé respecte la règle 33 ; une facture brouillon respecte la règle 7.3 anti-double-billing). Le
worker reste best-effort/race-safe (claim conditionnel) — règle 27.

## 6. Tests
- **Unit `@pulsar/shared`** : `produceRuleReaction` (interpolation d'args, match conditions),
  variante `RUN_ACTION` de `RuleAction`, validation catalogue.
- **e2e `cross-module-automation`** (DB seedée) :
  - Émission : confirmer une commande émet `transport-order.confirmed` ; compléter un load émet `load.completed`.
  - Built-in WMS : commande confirmée (origine entrepôt) → pick order créé automatiquement.
  - Built-in Billing : load livré → relevé client **brouillon** créé.
  - Idempotence : re-traiter le même événement ne crée pas de doublon (ledger).
  - Anti-boucle : une réaction n'en déclenche pas une autre (event tagué `reactionRuleId` ⇒ skip RUN_ACTION).
  - Module désactivé : réaction WMS no-op si WMS off.
  - Règle désactivée : `enabled=false` ⇒ pas d'action.
  - Isolation tenant.
  - Best-effort : un handler qui throw n'empêche pas le traitement (event PROCESSED, `ReactionExecution=FAILED`, audité).

## 7. Découpage d'implémentation (aperçu — détaillé dans le plan)
1. `@pulsar/shared` : `DOMAIN_EVENT_TYPES` += 5 ; `reactions.ts` catalogue ; `RuleAction.RUN_ACTION` +
   `produceRuleReaction` ; tests. Rebuild.
2. Migration : `ReactionExecution` + `DomainEvent.reactionRuleId`.
3. B1 : émettre les 5 événements dans les services.
4. `ReactionExecutorService` + handlers (2 réactions) + adaptateur services.
5. Branchement dans `processPending` (idempotence + tag anti-boucle + audit) ; `CustomRuleResolver`
   retourne les `reactionCommands`.
6. Seed des 2 règles built-in ; `AutomationRulesService` valide `RUN_ACTION`.
7. Web : éditeur Automatisations.
8. e2e `cross-module-automation` + vérification navigateur + docs.

## 8. Backlog (Sam — « plus tard ») / hors périmètre v1
- **Réactions à effet externe** (envoyer un relevé client, notifier un partenaire, confirmer un
  rendez-vous cour) — nécessitent des **plafonds dédiés** au chemin déterministe (le contournement
  de la gouvernance agent demande son propre cap montant/débit) avant d'être autorisées.
- **Réactions multi-sauts / cascades** (au-delà du single-hop) avec détection de boucle robuste.
- **Multi-actions par règle** et branches conditionnelles riches (aujourd'hui : une action par règle).
- Réactions supplémentaires au catalogue (yard.checked-out → load IN_TRANSIT, receipt.posted → dispo
  dispatch, etc.).
- Promotion d'une réaction déterministe vers le chemin agent-gouverné (ou inversement) à la volée.
