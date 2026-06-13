# Agents-employés (phase 11, palier 2) — Design

> Brainstormé le 2026-06-13. Fait suite au **palier 1** (gouvernance d'agents + exposition MCP),
> livré sur la branche `phase-11`. Spec palier 1 :
> `docs/superpowers/specs/2026-06-13-agents-gouvernance-mcp-design.md`.

## But

Donner vie, **dans Pulsar**, à des **agents qui simulent des employés** : chacun a un rôle, une
personnalité, ses outils et un niveau d'autonomie. Ils **gèrent des opérations et font des suivis**
pour faciliter l'usage du logiciel — l'angle « IA opérationnelle » qui différencie Pulsar des TMS
classiques (cf. benchmark Fleetbase : aucune IA). Pulsar est un **LSOS** (plateforme logistique
modulaire) ; le module TMS est le terrain de jeu de ces agents.

**Aucun LLM ne tourne dans Pulsar.** Le cerveau est le runtime **Hermes** (vendoré dans
`hermes-agent/`, Python, MIT, multi-modèles). On ne le reconstruit pas et on ne le porte pas en TS.

## Vision complète (C) et découpage

La cible est un employé complet **entièrement configurable dans Pulsar** : persona + rôle + modèle
+ autonomie + déclencheurs proactifs + présence multi-plateforme + mémoire persistante. C'est trop
gros pour une seule spec → on **séquence**, chaque sous-palier ayant son cycle spec→plan→PR :

- **2a — L'employé qui parle et agit** *(cette spec)* : entité `Agent` étendue (persona/rôle/
  modèle/autonomie) + UI ; assistant **⌘K** branché à Hermes en **ACP** ; les actions passent par
  la **file de gouvernance** du palier 1.
- **2b — L'employé proactif** *(plus tard)* : déclencheurs configurables (cron + événements Pulsar :
  tender sans réponse, load en retard, POD manquant) + horaire de travail → suivis autonomes.
- **2c — L'employé présent** *(plus tard)* : passerelles (Teams/Discord) joignables, configurables
  dans Pulsar + mémoire/contexte persistant par agent (modèle de l'utilisateur, rappel
  inter-sessions façon Hermes).

**Cette spec ne couvre que 2a.** 2b et 2c sont documentés ici uniquement comme trajectoire.

## Architecture

```
┌─────────────────────────── Pulsar (la maison) ───────────────────────────┐
│  Web SPA                          API NestJS                              │
│  ┌──────────────┐                 ┌───────────────────────────────────┐  │
│  │ ⌘K assistant │── SSE/POST ────▶│ AgentRuntime (pont ACP)           │  │
│  │ (choisir     │                 │  • 1 session ACP / conversation    │  │
│  │  l'employé)  │◀── stream SSE ──│  • passe modèle+persona+MCP+jeton  │  │
│  └──────────────┘                 │ Agent (persona/rôle/modèle/auto.)  │  │
│  ┌──────────────┐                 │ /mcp + file ProposedAction (P1)    │  │
│  │ Réglages →   │                 └──────────────▲────────────────────┘  │
│  │  Agents (UI) │                                │ outils (jeton d'agent) │
│  └──────────────┘                                │                        │
└─────────────────────────────────────────────────┼────────────────────────┘
                         ACP (session)             │ MCP (HTTP, palier 1)
                              ▼                     │
                  ┌─────────────────────────────────┴──┐
                  │ Hermes (le cerveau, sidecar Python) │
                  │  • raisonnement + routage multi-LLM │
                  │  • client MCP → rappelle Pulsar     │
                  └─────────────────────────────────────┘
```

**Frontière nette** : Pulsar possède l'**UI**, l'**identité/permissions/plafonds** (palier 1), les
**outils** (serveur MCP) et la **gouvernance** (file `ProposedAction`). Hermes possède le
**raisonnement** et le **routage multi-modèles**.

- **Hermes tourne en sidecar** (profil docker `agents` opt-in, comme `osrm` en phase 10) et expose
  son **serveur ACP** (`hermes-agent/acp_adapter/`). L'ACP supporte déjà le **modèle par session**
  (`SetSessionModel…`) et les **serveurs MCP par session** (`McpServerSse`/`McpServerStdio` au
  `session/new`) — vérifié dans le code vendoré.
- **Pulsar → Hermes** : pour une conversation ⌘K, l'API Pulsar ouvre une **session ACP**, y passe le
  modèle, le persona (amorce de contexte), et le **serveur MCP de Pulsar + un jeton d'agent**.
- **Hermes → Pulsar** : pour *agir*, Hermes appelle le `/mcp` de Pulsar **comme cet agent** → on
  retombe sur la gouvernance du palier 1 (lectures en direct, mutations → file, ou `autoApprove`).
- **Pulsar = plan de contrôle** : la config d'un agent vit dans l'entité `Agent`, jamais dans un
  fichier ou un CLI Hermes. Le choix du modèle LLM devient un champ du formulaire d'agent.

### Topologie retenue : un service Hermes partagé, configuré par session (approche A)

Un seul process Hermes ; Pulsar ouvre une session ACP par conversation et y injecte modèle + persona
+ MCP + jeton. Alternatives écartées pour 2a : un process Hermes **par agent** (approche B — plus
lourd, utile surtout pour la mémoire persistante de 2c, migration possible plus tard) ; invocation
**CLI par tour** (approche C — pas de streaming/session continue, mauvais pour ⌘K).

## Modèle de données (19ᵉ migration)

### Extension de l'entité `Agent` (palier 1)

L'`Agent` a déjà `permissions`, `caps` (Json : `maxAmountPerAction`, `maxActionsPerMinute`,
`toolAllowlist`, `autoApprove`), `status`, `serviceUserId`, `prefix`, `secretHash`. On ajoute :

| Champ | Type | Rôle |
|---|---|---|
| `persona` | `String?` (Text) | Personnalité + instructions système, injectées en amorce de session ACP |
| `role` | `String?` | Libellé du poste (« Répartiteur », « Commis facturation »), affiché dans ⌘K |
| `model` | `String?` | Modèle LLM utilisé par Hermes (null = défaut Hermes) |
| `autonomyLevel` | `enum AgentAutonomy` | Cadran grossier d'autonomie → dérive `caps.autoApprove` |
| `avatar` | `String?` | Emoji/couleur pour identifier l'agent dans ⌘K (cosmétique) |

`AgentAutonomy` (enum miroir `@pulsar/shared` ↔ `schema.prisma`, règle 3) :

- **`PROPOSE`** *(défaut)* — toute mutation → file de validation (`autoApprove = []`).
- **`ACT_LOW`** — outils `MUTATING` auto-approuvés ; `SENSITIVE` (ex. `tender_load`) toujours en file.
- **`AUTONOMOUS`** — `MUTATING` **et** `SENSITIVE` auto-approuvés.

Les plafonds `caps` du palier 1 s'appliquent **à tous les niveaux**, y compris `AUTONOMOUS` : une
action auto-approuvée qui dépasse un cap est **rejetée**, jamais exécutée.

**Relation autonomie ↔ `autoApprove`** : `autonomyLevel` est le **cadran principal** géré dans l'UI ;
une fonction pure `@pulsar/shared` traduit le niveau en ensemble de tiers auto-approuvés
(`PROPOSE → {}`, `ACT_LOW → {MUTATING}`, `AUTONOMOUS → {MUTATING, SENSITIVE}`). À l'exécution dans la
factory MCP (palier 1), un outil est auto-approuvé si **son tier est couvert par le niveau de
l'agent** OU si son nom figure dans `caps.autoApprove` (l'override fin par outil du palier 1 reste un
ajout possible). Le palier 1 ne perd rien : `autonomyLevel` est simplement une porte plus large,
toujours bornée par les `caps`.

### Conversations

- **`AgentConversation`** : `id`, `tenantId`, `agentId`, `userId`, `hermesSessionId`, `title`,
  `createdAt`. Relie une conversation ⌘K à la session ACP Hermes ; scope tenant (règle 1).
- **`AgentMessage`** : `id`, `conversationId`, `role` (`user|assistant|tool`), `content`,
  `proposalId?` (lien vers `ProposedAction` quand le tour a mis une action en file), `createdAt`.

La **mémoire transverse** (modèle de l'utilisateur, rappel inter-sessions) est **hors scope 2a** →
palier 2c. Ici on persiste seulement le fil pour l'historique, la reprise et l'audit.

## Composants (chacun une responsabilité)

**Backend NestJS** (extension du module `agents` du palier 1) :

1. **`HermesAcpClient`** — transport ACP bas niveau vers le sidecar : JSON-RPC (`session/new`,
   `session/prompt`, updates streamés, demandes de permission). *Une seule job : parler ACP.*
2. **`AgentRuntimeService`** — le pont : `openSession(agent, conversation)` (modèle + persona +
   serveur MCP de Pulsar + jeton d'agent) ; `sendTurn(text)` → flux d'événements ; `closeSession`.
   Traduit ACP ↔ Pulsar. Best-effort : si Hermes est injoignable, échoue proprement sans impacter
   le reste de Pulsar.
3. **`AgentConversationsService`** — persistance `AgentConversation`/`AgentMessage` ; append au fil
   du stream (dont les `proposalId`).
4. **`AgentConversationsController`** — REST + endpoint **SSE** : créer une conversation (choix de
   l'`agentId`), envoyer un tour (→ stream), lister/relire l'historique. Gardé par une **nouvelle
   permission `core.agents.chat`** (converser avec un agent ≠ gérer sa config `core.agents.manage`
   ou voir l'inbox `core.agents.actions.read`). Ajoutée au catalogue `@pulsar/shared` (règle 5).
5. **`AgentsService`/`AgentsController` étendus** — nouveaux champs dans les DTO create/update ;
   `autonomyLevel` → dérive `caps.autoApprove` au provisioning.
6. **Jeton de session d'agent** — `AgentsService` mint un **jeton court-vécu** (signé, expirant,
   lié à l'`agentId`) côté serveur ; le serveur `/mcp` (palier 1) accepte ce jeton **en plus** des
   vraies clés `ak_` et le résout vers le **même `AgentPrincipal`**. Évite de stocker la clé en clair
   et de réutiliser la clé utilisateur (montrée une seule fois au palier 1).

**Réutilisé tel quel du palier 1** : serveur `/mcp`, `ProposedActionsService`, registre d'outils,
inbox `agent-actions`. Hermes appelle `/mcp` comme l'agent → gouvernance inchangée.

**Web (Svelte 5 runes)** :

7. **Panneau assistant ⌘K** — sélecteur d'employé (agents `ACTIVE` avec rôle+avatar), vue
   conversation, messages streamés (SSE), **cartes « action proposée » en ligne** (avec `proposalId`,
   lien vers l'inbox Agent actions). Occupe le slot ⌘K réservé en phase 9.
8. **Réglages → Agents** (page de la Task 12 du palier 1, étendue) — persona (textarea), rôle,
   modèle (dropdown), autonomie (radio), avatar.

**Infra** :

9. **Sidecar Hermes** — profil docker `agents` opt-in, ACP exposé, clés des fournisseurs de modèles
   en env, doc d'amorçage. Jamais requis pour le cœur de Pulsar.

**Transport Pulsar→navigateur** : **SSE** (un sens : tokens + événements) ; tour utilisateur en POST.

## Flux d'un tour de conversation ⌘K

1. **Ouverture** — `POST /agent-conversations {agentId}` → création de la conversation ;
   `AgentRuntimeService.openSession` → `session/new` ACP avec modèle = `agent.model`, serveurs MCP
   = `[{ url: /mcp de Pulsar, header X-Agent-Key: <jeton de session> }]`, persona en amorce. Ouvre le
   flux SSE.
2. **Tour utilisateur** — `POST /agent-conversations/:id/messages {text}` → persiste le message
   `user` → `sendTurn` → `session/prompt` ACP.
3. **Raisonnement + outils** — Hermes raisonne (modèle choisi), appelle des outils via son client
   MCP → `POST /mcp` de Pulsar **comme l'agent** → palier 1 : `READ/LOW` exécuté en direct ;
   `MUTATING/SENSITIVE` → file `ProposedAction` (sauf `autoApprove`) → `{queued, proposalId}`.
4. **Stream retour** — ACP renvoie les updates → `AgentRuntimeService` → **SSE** → ⌘K affiche le
   texte streamé + une **carte « action proposée »**. Chaque update persisté en `AgentMessage`.
5. **Fin de tour** — la session ACP reste ouverte (conversation reprenable) ; les mutations attendent
   l'inbox Agent actions (sauf `autoApprove`), où l'approbation les exécute via `ProposedActionsService`.

## Gestion d'erreurs

Principe : la couche agent est **best-effort et isolée** — si Hermes tombe, le cœur de Pulsar n'est
jamais impacté (posture `RoutingService`/OSRM de la phase 10).

- **Sidecar injoignable** → `openSession` échoue ; ⌘K « assistant indisponible » ; API conversations
  503 ; reste de Pulsar intact.
- **Erreur de session ACP en cours** → message d'erreur dans le stream, persisté ; session
  reprenable/réouvrable.
- **Erreur d'appel d'outil** (`/mcp` 4xx/5xx) → error boundary MCP du palier 1 ; Hermes voit l'erreur
  et réagit ; ⌘K l'affiche. Dépassement de plafond → message de cap renvoyé à l'agent.
- **Erreur fournisseur de modèle** (clé invalide, rate-limit) → événement d'erreur Hermes → ⌘K
  « erreur modèle ».
- **Déconnexion SSE** → nettoyage sur `res.close` (pattern du contrôleur MCP) ; reprise via
  `conversationId` + `hermesSessionId`.
- **Expiration du jeton de session** en cours → `AgentRuntime` en re-mint un de façon transparente.
- **Garde-fou autonomie** : un agent `AUTONOMOUS` reste borné par ses plafonds — action
  auto-approuvée hors cap = **rejetée**, jamais exécutée en silence.
- **Agent révoqué en cours** → le prochain appel d'outil résout un agent révoqué → 401 ; l'agent ne
  peut plus agir ; ⌘K le signale.

## Stratégie de tests

Pas de vrai LLM en CI (Hermes = Python + modèles externes : coût, non-déterminisme).

- **Unit** : mapping `autonomyLevel → caps.autoApprove` (fonction pure `@pulsar/shared`, vitest) ;
  mint/vérif du jeton de session (signature + expiration + résolution `AgentPrincipal`).
- **E2E déterministe** — contre un **faux serveur ACP** in-repo (stub qui parle le sous-ensemble
  utilisé : `session/new`, `session/prompt`, puis émet un appel d'outil + du texte). Hors-ligne,
  reproductible. Vérifie le pont Pulsar : ouverture provisionne la session (modèle+persona+MCP+jeton) ;
  tour → outil READ exécuté en direct ; tour → outil MUTATING mis en file (rien exécuté, carte
  renvoyée) ; agent `AUTONOMOUS` exécute en direct mais cap dépassé = rejeté ; conversation+messages
  persistés (dont `proposalId`) ; stream SSE reçu.
- **Smoke test réel conditionnel** — e2e gated par env (`HERMES_ENABLED`, comme `OSRM_ENABLED` en
  phase 10) parlant au vrai sidecar Hermes (câblage ACP↔MCP live). Hors CI.
- **Web** : `typecheck` ; le panneau ⌘K rend les messages streamés + les cartes « action proposée ».

## Hors scope (2a)

- Déclencheurs proactifs (cron + événements) et horaire de travail → **2b**.
- Passerelles Teams/Discord et mémoire/contexte persistant par agent → **2c**.
- Multi-agent collaboratif (un agent qui en délègue un autre) — non envisagé à ce palier.
- Choix/validation fine de la liste des modèles disponibles (on stocke un champ libre `model` que
  Hermes résout ; la curation d'un catalogue de modèles est différée).

## Conventions à respecter (CLAUDE.md)

Isolation tenant depuis le principal (règle 1) — `AgentConversation`/`AgentMessage` scellés au tenant
de l'utilisateur ; les actions passent par le `serviceUserId` de l'agent. Enums miroir
`@pulsar/shared` ↔ `schema.prisma` (règle 3) pour `AgentAutonomy`. Permissions `@RequirePermissions`
sur tout endpoint (règle 5). Audit des mutations sensibles (règle 6) — déjà couvert par le palier 1
sur l'exécution des `ProposedAction`. Rebuild `shared`/`database` après modif (règle 7). Règles dures
palier 11 (21–23) : outils via le registre, mutations jamais exécutées dans le handler MCP, portée =
permissions ∩ modules ∩ allowlist, `autoApprove` seul contournement de la file. **Build complet
(`pnpm build`) avant de déclarer vert** — leçon du palier 1 (un import `node:crypto` au niveau module
avait cassé le build web ; les `typecheck` par tâche ne l'avaient pas vu).
