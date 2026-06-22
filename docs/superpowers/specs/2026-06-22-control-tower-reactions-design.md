# Control Tower enrichi — réactions cross-module visibles (arc F)

> Spec de design. Capstone de l'arc « plateforme tressée » : maintenant que les modules sont
> configurables (TMS/Billing/WMS/Yard/Fleet/Procurement) et tressés (5 réactions `RUN_ACTION`),
> on rend le **tressage causal visible** dans le Flow Control Tower (`/analytics/flow`). Décidé
> avec Sam le 2026-06-22 : 3 morceaux (timeline + map + KPI), sur la surface flow uniquement.

## 0. Intention & invariants

Le Flow Control Tower lit aujourd'hui DomainEvents + OperationalTasks + ProposedActions et en
dérive des **chaînes** (timeline), une **carte** inter-modules et une **trace** d'entité — tout
**à la lecture**, via des helpers purs `@pulsar/shared/analytics/flow.ts` (rule 30). Il **ignore
les `ReactionExecution`** : event → réaction → effet est donc invisible. Cet arc ajoute
`ReactionExecution` comme source read-time supplémentaire.

**Invariants (rule 30 + co.)** : aucun store de rollup, **aucune migration** ; calculs purs +
testés dans `@pulsar/shared` ; tenant-scopé (rule 1) ; projections excluent
`secretHash`/`serviceUserId` (rule 26) ; `analytics.read` existant, **aucune nouvelle permission**.
Best-effort : si aucune réaction n'existe, l'affichage est identique à aujourd'hui (rétro-compat).

## 1. Hors périmètre (YAGNI)

- **`/control-tower` (KPIs agents, phase 15)** : non touché — les réactions ne sont pas des runs
  d'agent ; elles vivent dans le flux.
- **Onglet Trace** : inchangé (parcours d'UNE entité ; les réactions sont un signal de chaîne, pas
  d'entité). Extensible plus tard.
- **Pas de drill-down "qui a approuvé"** : les réactions `RUN_ACTION` sont déterministes/auto
  (pas d'approbation humaine) — on affiche statut + effet, pas un workflow d'approbation.

---

## 2. Modèle (helpers purs `@pulsar/shared/analytics/flow.ts`)

### 2.1 Nouveau type

```ts
export interface FlowReaction {
  id: string;
  action: string;        // clé de réaction (REACTION_CATALOG)
  status: string;        // EXECUTED | FAILED
  module: FlowModule;    // module cible de la réaction (du descripteur)
  eventId: string;       // event déclencheur (jointure)
  at: string;
}
```

`FlowChain` gagne `reactions: FlowReaction[]` (réactions dont `eventId` == `chain.event.id`).

### 2.2 `buildFlowChains` — signature étendue

`buildFlowChains(events, tasks, actions, reactions: FlowReaction[])` : grouper les réactions par
`eventId` (comme `tasksByEvent`), attacher à la chaîne de leur event. Les `modules`/`times` de la
chaîne incluent les modules/`at` des réactions. Réactions orphelines (event hors fenêtre) : ignorées
(pas de chaîne sans event pour une réaction — l'event est toujours dans la même fenêtre car la
réaction suit l'event de près).

### 2.3 `buildFlowMap` — arêtes de réaction

Pour chaque chaîne, en plus des arêtes event→task existantes, ajouter une arête
`from = chain.event.module → to = reaction.module` par réaction (skip si `to === from`). Pour
distinguer visuellement, `FlowMapEdge` gagne `kind: 'event' | 'reaction'` (défaut `'event'` pour
les arêtes existantes — rétro-compat). Les comptes restent agrégés par `(from,to,kind)`.

### 2.4 `deriveReactionKpis` — nouveau helper pur

```ts
export interface ReactionKpis {
  executed: number;
  failed: number;
  byAction: { action: string; executed: number; failed: number }[]; // trié desc par total
}
export function deriveReactionKpis(reactions: FlowReaction[]): ReactionKpis;
```

Tous testés unitairement (chaînage par eventId, arête reaction, comptes KPI, fenêtre vide = no-op).

---

## 3. API (`flow.service.ts` + controller)

- `timeline()` lit les `ReactionExecution` du tenant sur la fenêtre (`createdAt >= since`,
  tenant-scopé, borné par le même `limit`), les mappe en `FlowReaction` et les passe à
  `buildFlowChains`.
- **Mapping module** : le descripteur `reactionByKey(action)?.module` renvoie une **clé module en
  minuscules** (`'wms'`/`'billing'`/`'transportation'`/`'fleet'`/`'yard'`), alors que `FlowModule`
  est en MAJUSCULES. Ajouter un helper pur `moduleOfReaction(action: string): FlowModule` dans
  `flow.ts` qui résout via le catalogue puis mappe la clé minuscule → `FlowModule`
  (`transportation→TRANSPORTATION`, etc. ; fallback `'CORE'`). Utilisé côté API pour remplir
  `FlowReaction.module`.
- `map()` réutilise les chaînes (qui portent déjà les réactions) → `buildFlowMap` produit les arêtes
  `kind:'reaction'`.
- Nouveau champ KPI dans la réponse timeline (ou un léger `GET /analytics/flow/reaction-kpis?days=`) :
  `deriveReactionKpis(reactions)`. **Choix v1** : fold dans la réponse `timeline` (`{ chains, reactionKpis }`)
  pour éviter un endpoint de plus — le bandeau lit ce champ.
- Tenant isolation (rule 1) : le `where` sur `reactionExecution` filtre `tenantId`.

## 4. Web (`/analytics/flow/+page.svelte`)

- **Timeline (A)** : sous chaque chaîne, après tasks/actions, une ligne « Réactions » listant
  `action` (libellé via `reactionByKey`) → statut (EXECUTED vert / FAILED rouge) + module cible.
- **Map (B)** : les arêtes `kind:'reaction'` rendues distinctement (couleur accent / style pointillé)
  des arêtes d'events ; légende mise à jour.
- **KPI (C)** : petit bandeau en tête de l'onglet timeline (ou map) : « N réactions exécutées · M
  échouées (X j) » + top 3 actions. Lit `reactionKpis`.
- Aucune nouvelle dépendance ; réutilise le style existant des cartes de chaîne / de la carte.

---

## 5. Tests

- **Unit `@pulsar/shared`** : `buildFlowChains` attache les réactions par eventId ; `buildFlowMap`
  émet des arêtes `kind:'reaction'` (et garde `'event'` pour l'existant) ; `deriveReactionKpis`
  (exécutées/échouées/byAction trié, fenêtre vide → zéros). Rétro-compat : appeler `buildFlowChains`
  avec `reactions: []` reproduit le comportement actuel.
- **e2e `flow-control-tower`** (étendre l'existant) : créer une règle RUN_ACTION + déclencher
  l'event + `processPending` → `GET /analytics/flow` (timeline) renvoie une chaîne dont
  `reactions` contient la réaction EXECUTED ; `reactionKpis.executed >= 1` ; la map contient une
  arête `kind:'reaction'`. Sans aucune réaction, la réponse est inchangée (rétro-compat).

---

## 6. Découpage (aperçu — détaillé dans le plan)

1. `@pulsar/shared` : type `FlowReaction` + `FlowChain.reactions` + `buildFlowChains` étendu +
   `FlowMapEdge.kind` + `buildFlowMap` étendu + `deriveReactionKpis` + tests. Rebuild shared.
2. API : `flow.service` lit `ReactionExecution`, mappe en `FlowReaction` (module via catalogue),
   passe aux helpers ; `timeline` renvoie `reactionKpis`.
3. Web : réactions dans la timeline, arêtes de réaction sur la map, bandeau KPI.
4. e2e flow étendu + vérif navigateur (si l'outil est dispo ; sinon svelte-check + e2e).
