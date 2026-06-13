# Expérience agents-employés (phase 11, palier 2a-R2) — Design

> 2026-06-13. Suite de R1 (runtime managé). Répond au retour de Sam : « l'UI ne représente
> pas ce qui se passe ; agent-actions est vide ; configurer un agent ne semble pas réel, pas
> d'aide ; je n'ai pas l'impression de pouvoir parler à mes agents et voir ce qu'ils font ».
> Conçu et décidé en autonomie (Sam délègue — cf. `pulsar-autonomie-execution`).

## But

Faire des agents des **employés de premier plan** dans Pulsar : un **roster**, un **profil**
par agent (identité + config **guidée avec aide**), une **vue d'activité** (« ce qu'ils font » :
conversations + actions proposées), et une **surface de chat** pour parler à un employé donné.
Backend de R2 minimal ; l'essentiel est l'expérience.

## Décisions (autonomes)

- **Espace top-level `/agents`** (nav, gated `core.agents.read`) — le roster, plutôt qu'enterré
  dans Réglages. `Réglages → Agents` (R1/palier 2a) reste pour l'admin/clé, mais le roster
  devient l'entrée principale (lien réciproque).
- **`/agents/[id]`** = page employé unique : sections **Profil/Config**, **Activité**, **Chat**.
- **Activité = conversations + actions proposées** de l'agent (deux flux corrélables par le temps).
  La liaison fine `tool_call→proposalId` reste différée (le proposalId n'est pas sur le flux ACP).
- **Config guidée** : aide inline par champ + **presets de rôle** (gabarits persona+permissions).
- **Chat** : réutilise `agent-stream` (R-palier 2a), pré-ciblé sur l'agent de la page.
- Pas de nouveau modèle de données ; on lit l'existant (`Agent`, `AgentConversation`,
  `ProposedAction`).

## Backend (peu)

- `AgentsService.getOne(tenantId, id)` → projection profil complète de l'agent (le `agentSelect`
  existant : id, name, description, role, avatar, model, autonomyLevel, permissions, caps,
  status, prefix, createdAt, lastUsedAt) — sans secret. 404 si autre tenant.
- `AgentsService.activity(tenantId, id)` → `{ conversations: [{id,title,createdAt,messageCount}],
  proposedActions: [{id,tool,status,riskTier,proposedAt,decidedAt}], stats: {conversations,
  pending, executed, rejected} }`, scoping tenant + agentId. (Lit `agentConversation` +
  `proposedAction`.)
- `AgentsController` : `GET /agents/:id` (perm `core.agents.read`), `GET /agents/:id/activity`
  (perm `core.agents.read`). (Le `PATCH /agents/:id` existe déjà — R1/2a.)
- Catalogue de **presets de rôle** dans `@pulsar/shared` (`AGENT_ROLE_PRESETS` : pure data —
  `{ id, label, persona, suggestedPermissions: string[], suggestedAutonomy }`), ex. Répartiteur,
  Commis facturation, Analyste. Browser-safe.

## Web

- **`/agents` (roster)** — top-level nav. Cartes d'employés (avatar, nom, rôle, badge statut +
  badge autonomie, nb d'actions en attente). Bouton « Engager un agent » (réutilise le flux
  POST /agents existant, enrichi des presets). Carte → `/agents/[id]`.
- **`/agents/[id]` (employé)** — 3 sections (onglets ou ancres) :
  - **Profil & config** : identité (avatar/nom/rôle/persona) + config éditable (modèle, autonomie
    radio avec explication, permissions à cocher avec descriptions du catalogue, caps) — **aide
    inline par champ** ; sauvegarde via `PATCH /agents/:id`. Bouton révoquer.
  - **Activité** : stats (compteurs) + liste des conversations (→ ouvre le chat/relit) + liste des
    actions proposées avec badge de statut/risque (lien vers l'inbox `/agent-actions`).
  - **Chat** : panneau de conversation pleine largeur (réutilise `agent-stream`/le composant du
    palier 2a), pré-ciblé sur cet agent (démarre/charge une conversation avec lui).
- **Presets de rôle** dans le formulaire d'engagement : choisir un preset pré-remplit
  persona + permissions + autonomie (modifiable).
- **Aide inline** : courts textes explicatifs sous chaque champ (autonomie, scopes, caps, modèle,
  persona) — réutilise les descriptions du `PERMISSION_CATALOG` pour les scopes.
- **Nav** : ajouter « Agents » en top-level (gated `core.agents.read`), à côté de la cloche /
  agent-actions. `Réglages → Agents` conservé (admin).

## Gestion d'erreurs

`GET :id`/`activity` : 404 hors tenant (rule 1). Chat : best-effort (runtime down ⇒ message
« indisponible », déjà géré R1/2a). Activité : si une source échoue, afficher l'autre + un
message local (pas de page blanche). Pas de fuite : projections sans secret/clé.

## Tests

- **Unit** : `AGENT_ROLE_PRESETS` (chaque preset a persona + permissions valides ∈ catalogue +
  autonomie valide).
- **E2E** : `GET /agents/:id` (projection sans secret, 404 cross-tenant) ; `GET /agents/:id/activity`
  (après avoir créé une conversation + une action proposée pour l'agent → les compteurs/listes
  reflètent, scoping tenant). Réutilise le pattern d'override fake-ACP si une conversation doit
  être créée.
- **Web** : `typecheck` 0 erreur. Le rendu visuel (roster, profil, activité, chat) se valide
  manuellement (Sam) — les e2e ne couvrent pas le rendu.

## Hors scope

- Liaison fine `tool_call→proposalId` persistée (différée — fragile sur le flux ACP).
- Édition multi-agent / collaboration entre agents.
- Métriques avancées / timeline temps réel (polling simple suffit).

## Conventions (CLAUDE.md)

Isolation tenant (r1) sur `getOne`/`activity`. `@RequirePermissions(core.agents.read)` (r5).
Presets dans `@pulsar/shared` = pure data, browser-safe (pas d'import node). Pages web : Svelte 5
runes, `api()` client, composants `$lib/components/ui`, mêmes idiomes que les pages existantes.
`pnpm build` complet avant vert.
