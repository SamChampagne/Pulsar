# Runtime Hermes managé par Pulsar (phase 11, palier 2a-R1) — Design

> Brainstormé le 2026-06-13. Fait suite au palier 2a (bridge ACP + ⌘K). Objectif de ce
> palier : pouvoir **parler à un vrai agent** de bout en bout, avec un runtime Hermes **livré
> avec le repo** et **configuré depuis Pulsar** (pas d'install/CLI manuel à côté).

## But

Aujourd'hui le palier 2a a livré le bridge ⌘K↔ACP↔MCP, mais **aucun runtime Hermes ne tourne** :
parler à un agent renvoie 503. Ce palier rend le runtime **réel et turnkey** :
1. Hermes s'installe via une commande du repo (`pnpm agents:setup`).
2. Le provider de modèle se configure **dans Pulsar** (écran « Runtime agents ») — soit par
   **clé API**, soit par **login/OAuth** (OpenAI Codex, Nous Portal, GitHub Copilot) sans clé.
3. Pulsar spawn `hermes-acp` en injectant cette config ; on parle à un agent et on voit ses
   actions arriver dans la file de gouvernance.

Sam est l'opérateur (projet perso) ; pas de mise en marché. Cf. `pulsar-objectif-plateforme`.

## Décisions (prises en autonomie — Sam délègue)

- **Portée config = par tenant** : un `AgentRuntimeConfig` par tenant, un `HERMES_HOME` par tenant.
- **Permission** : réutiliser `core.agents.manage` (configurer le runtime = gérer les agents).
- **Catalogue de providers** : une constante partagée (`@pulsar/shared`) encodant les providers
  d'Hermes + leur mode d'auth, dérivée de `hermes-agent/cli-config.yaml.example`. Source unique ;
  pas de hardcode dans l'UI.
- **Install** : script Node `scripts/setup-agents.mjs` (tâche `pnpm agents:setup`) — venv +
  `pip install -e ./hermes-agent[acp]`. Préfère un Python 3.11/3.12 si présent, sinon 3.14
  best-effort. Ne PAS l'inclure dans `pnpm setup` (lourd, opt-in).
- **Clés au repos** : chiffrées via le `CryptoService` existant (enc:v1, palier 6).
- **R1 ne couvre que le runtime + sa config + la vérification.** La refonte UI riche (profil
  d'agent, vue d'activité, config guidée) est **R2**, documentée comme suite, hors scope ici.

## Architecture (4 pièces)

1. **Install (livré avec le repo)** — `pnpm agents:setup` → `scripts/setup-agents.mjs` crée
   `hermes-agent/.venv` (gitignoré) et installe `hermes-agent[acp]`. Écrit dans `.gitignore` :
   `hermes-agent/.venv/` et `hermes-agent/.hermes-home/`.
2. **Config dans Pulsar** — écran `Réglages → Runtime agents` (perm `core.agents.manage`) : provider
   (catalogue dynamique), auth (clé chiffrée OU bouton « Connecter » pour les providers login),
   modèle par défaut, base URL si provider custom. Persisté dans `AgentRuntimeConfig`.
3. **Spawn injecté** — `AgentRuntimeService.openSession` (palier 2a) construit l'environnement du
   process enfant : `HERMES_HOME` du tenant, la clé du provider **déchiffrée** en variable d'env
   (providers à clé) ou rien (providers login — jetons déjà dans HERMES_HOME), et écrit un
   `cli-config.yaml` minimal (provider + modèle). Le `python` du venv est `HERMES_ACP_CMD`.
4. **Parler & vérifier** — ⌘K → vraie réponse LLM streamée + appel d'outil réel → `/mcp`
   (gouvernance palier 1) → action proposée. Un bouton « Tester la connexion » spawn `hermes-acp`
   une fois (init + liste modèles).

## Catalogue de providers (dynamique)

`packages/shared/src/agents/runtime-providers.ts` (nouveau) — une constante `RUNTIME_PROVIDERS`
encodant, pour chaque provider supporté par Hermes (source : `cli-config.yaml.example`) :
`{ id, label, authMode: 'apiKey' | 'login', keyEnvVar?, loginCommand?, providerKey }` où
`providerKey` est la valeur `model.provider` d'Hermes (ex. `openrouter`, `anthropic`,
`openai-codex`, `nous`, `copilot`, `custom`). Exemples :
- `{ id:'openrouter', label:'OpenRouter', authMode:'apiKey', keyEnvVar:'OPENROUTER_API_KEY', providerKey:'openrouter' }`
- `{ id:'anthropic', label:'Anthropic (Claude)', authMode:'apiKey', keyEnvVar:'ANTHROPIC_API_KEY', providerKey:'anthropic' }`
- `{ id:'openai-codex', label:'OpenAI Codex', authMode:'login', loginCommand:'auth', providerKey:'openai-codex' }`
- `{ id:'nous', label:'Nous Portal', authMode:'login', loginCommand:'login', providerKey:'nous' }`
- `{ id:'copilot', label:'GitHub Copilot', authMode:'login', loginCommand:'auth', providerKey:'copilot' }`
- `{ id:'custom', label:'Custom (OpenAI-compatible)', authMode:'apiKey', keyEnvVar:'OPENAI_API_KEY', providerKey:'custom', needsBaseUrl:true }`

`GET /api/v1/agent-runtime/providers` renvoie ce catalogue (sans secret). L'écran web s'affiche
à partir de lui — quand Hermes ajoute un provider, on l'ajoute en un endroit.

## Modèle de données (20ᵉ migration)

`AgentRuntimeConfig` (un par tenant) :
- `id` cuid, `tenantId @unique`
- `provider` String (un `id` du catalogue), `authMode` String
- `apiKeyEnc` String? (CryptoService enc:v1 ; null pour les providers login)
- `defaultModel` String?, `baseUrl` String?
- `connectedAt` DateTime? (renseigné après un login OAuth réussi)
- `lastTestAt` DateTime?, `lastTestOk` Boolean?
- `createdAt`, `updatedAt`

Back-relation `Tenant.agentRuntimeConfig AgentRuntimeConfig?`. Projection publique : **jamais**
`apiKeyEnc` — l'API renvoie un booléen `hasApiKey`. `HERMES_HOME` du tenant =
`hermes-agent/.hermes-home/<tenantId>` (créé à la volée, gitignoré) ; contient le `cli-config.yaml`
généré + (providers login) les jetons OAuth.

## Composants (chacun une responsabilité)

**Backend** (`apps/api/src/core/agents/`) :
- `runtime-config.service.ts` — CRUD `AgentRuntimeConfig` (get/upsert), chiffre/déchiffre la clé via
  CryptoService, projection sans secret. Résout le `HERMES_HOME` du tenant.
- `agent-runtime-env.ts` (helper pur) — construit `{ env, homeDir }` pour le spawn à partir d'un
  `AgentRuntimeConfig` + le catalogue (variable d'env de clé, `HERMES_HOME`), et **génère le contenu
  `cli-config.yaml`** (provider + defaultModel + baseUrl). Testable unitairement.
- `runtime-config.controller.ts` — `GET /agent-runtime` (config projetée + état installé/connecté),
  `PUT /agent-runtime` (provider + clé + modèle), `GET /agent-runtime/providers` (catalogue),
  `POST /agent-runtime/test` (spawn une fois → init + liste modèles → ok/err), et un endpoint
  **SSE** `POST /agent-runtime/connect` (providers login : lance `hermes <loginCommand>` dans le
  HERMES_HOME du tenant, streame stdout = code/URL, met `connectedAt` au succès). Perm
  `core.agents.manage`.
- `AgentRuntimeService` (palier 2a, modifié) — `openSession` lit `AgentRuntimeConfig` via
  `runtime-config.service`, applique `agent-runtime-env` (HERMES_HOME + env + cli-config écrit), et
  spawn le `python` du venv. Si pas de config → `BadRequestException` « runtime agents non configuré »
  (message clair, pas un 503 générique). Si venv absent → message d'install.
- `install-check.ts` (helper) — détecte la présence du venv (`hermes-agent/.venv`) + un binaire
  python ; alimente l'état « installé » de l'écran.

**Web** (`apps/web/src/routes/(app)/settings/agent-runtime/+page.svelte`, nouveau) — l'écran décrit
en Section 2 : bandeau d'état (installé/configuré/dernier test), provider (depuis le catalogue),
bloc d'auth conditionnel (clé chiffrée write-once OU bouton « Connecter » qui consomme le SSE de
login et affiche code/URL), modèle par défaut, base URL si custom, boutons Tester/Enregistrer.
Nav : ajouter « Runtime agents » sous Réglages (gated `core.agents.manage`).

**Install** — `scripts/setup-agents.mjs` + tâche `agents:setup` dans le `package.json` racine ;
section `.gitignore`.

## Flux

- **Configurer (clé)** : `PUT /agent-runtime { provider, apiKey, defaultModel }` → chiffre la clé,
  upsert. **Tester** : `POST /agent-runtime/test` → build env → spawn `hermes-acp` → init + `models`
  → `{ ok, models }`, met `lastTestAt/Ok`.
- **Configurer (login)** : `PUT /agent-runtime { provider, defaultModel }` (sans clé) → upsert ;
  l'UI affiche « Connecter ». `POST /agent-runtime/connect` (SSE) → spawn `hermes <loginCommand>`
  dans le HERMES_HOME du tenant → streame le code/URL (events `text`) → à la fin du flux, si succès,
  `connectedAt = now` → event `end`.
- **Parler** (palier 2a, inchangé côté contrôleur) : `openSession` injecte désormais la vraie config →
  Hermes répond pour de vrai ; ses appels d'outils passent par `/mcp` (gouvernance + caps).

## Gestion d'erreurs

Best-effort, messages **précis** (jamais un 503 nu) :
- Runtime non installé (venv absent) → 400 « Lance `pnpm agents:setup` » (+ commande).
- Runtime non configuré → 400 « Configure le runtime agents (Réglages → Runtime agents) ».
- Provider login non connecté → 400 « Connecte d'abord <provider> ».
- Hermes spawn/échec d'init → 503, jamais de crash du cœur Pulsar (posture OSRM).
- Le flux de login expose le code/URL puis un statut ; échec → event `error` clair.

## Stratégie de tests

Pas de vrai LLM ni de vrai login OAuth en CI.
- **Unit** : `agent-runtime-env` (build env + génération `cli-config.yaml` par provider, clé→env,
  HERMES_HOME) ; round-trip chiffrement (chiffrer/déchiffrer via CryptoService) ; le catalogue
  (chaque entrée a un `authMode` valide + `keyEnvVar` xor `loginCommand`).
- **E2E déterministe** : CRUD `AgentRuntimeConfig` (PUT puis GET → `hasApiKey:true`, jamais la clé
  en clair) ; `GET /agent-runtime/providers` ; `POST /agent-runtime/test` et `openSession` **contre
  le faux serveur ACP** (override comme au palier 2a) en vérifiant que l'env injecté contient la
  bonne variable de clé + HERMES_HOME (le faux runtime expose ce qu'il a reçu). `connect` SSE testé
  avec un faux `hermes` scripté.
- **Smoke réel conditionnel** (`HERMES_ENABLED`) : `pnpm agents:setup` puis configurer un provider
  réel, `test` doit lister des modèles, et une conversation ⌘K doit produire une vraie réponse +
  une action proposée. Hors CI (manuel/Sam).

## Hors scope (R2 — la suite, la richesse UI)

- **Profil d'agent** (page dédiée : identité, persona, autonomie, scopes, caps, avec aide inline).
- **Vue d'activité** (« ce qu'ils font ») : conversations + outils appelés + actions proposées par
  agent, timeline.
- **Surface de chat de premier plan** (au-delà du tiroir ⌘K).
- **Config d'agent guidée** (aide contextuelle, presets de rôle).
- Corrélation `tool_call`→`proposalId` persistée (déjà notée en dette palier 2a).

## Conventions (CLAUDE.md)

Isolation tenant (règle 1) — `AgentRuntimeConfig` et `HERMES_HOME` par tenant ; jamais de clé en
clair dans une projection. Enums/constantes partagées dans `@pulsar/shared` (règle 3 si enum).
`@RequirePermissions(core.agents.manage)` sur chaque endpoint runtime (règle 5). Secrets chiffrés au
repos via `CryptoService` enc:v1 (palier 6). Rebuild shared/database après modif (règle 7). Runtime
best-effort et isolé (règle 24). **Build complet (`pnpm build`) avant de déclarer vert** (leçon
palier 1 : un import node-only dans `@pulsar/shared` casse le web). Le catalogue de providers ne doit
contenir **aucun** import node-only (pure data) pour rester browser-safe.
