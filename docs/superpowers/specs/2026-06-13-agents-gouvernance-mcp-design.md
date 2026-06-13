# Phase 11 (palier 1) — Couche de gouvernance d'agent + exposition MCP (design)

> Validé au brainstorming du 2026-06-13 (Sam). Vision : des agents-employés façon
> **Hermes** (Nous Research, MIT — vendoré dans `hermes-agent/`), avec personnalité,
> rôle et outils, branchables sur Pulsar, capables de communiquer avec le système ET
> avec des passerelles externes (Teams, Slack…). Décision d'architecture : **C —
> hybride par paliers**. Cette spec ne couvre que le **palier 1** : faire de Pulsar un
> système qu'un agent MCP peut piloter, avec gouvernance. C'est exactement le
> substrat §19.2 de l'[audit TMS](../../audit-tms-2026-06-10.md) (API permissionnées +
> compte de service + audit) augmenté des trois pièces manquantes qu'il pointe :
> **idempotence explicite, plafonds en données, file « actions proposées »**.

## Constat de départ (pourquoi ce périmètre)

Hermes est **déjà un runtime d'agent complet** : LLM interchangeable, passerelles
Teams/Slack/Telegram/Discord/email, scheduling, sous-agents, et il est **client MCP**
(il sait consommer des outils distants). On ne reconstruit donc pas Hermes dans
Pulsar. Pulsar fournit ce que Hermes n'a pas : le **système de référence** et la
**gouvernance d'agent**. Le LLM, la personnalité et les passerelles externes restent
côté agent — hors périmètre Pulsar.

Découplage :

- **Pulsar** : identité d'agent, rôle, permissions, plafonds, file de validation, audit,
  et exposition des opérations TMS comme outils MCP.
- **L'agent (Hermes ou autre client MCP)** : LLM, personnalité, conversation, passerelles.
- **« Connecter n'importe quel agent »** = Pulsar émet une clé + un endpoint MCP par
  agent ; tout client MCP s'y branche. Comme le LLM vit côté agent, Pulsar ne choisit
  aucun moteur LLM à ce palier.

**Statut d'Hermes (décidé 2026-06-13) : agent de référence, architecture agnostique.**
Pulsar reste 100 % MCP standard et **ne dépend de Hermes en rien** — n'importe quel
client MCP (Hermes, Claude Desktop, agent maison) se branche. Hermes est documenté comme
l'agent de référence (un guide de connexion + un exemple de config seront fournis avec
le palier 1, car c'est lui qui apporte les passerelles Teams/Slack gratuitement), mais
Pulsar ne l'héberge pas, ne le package pas, et ne s'optimise pas pour lui en particulier.
Zéro lock-in.

## Objectifs

1. **Identité d'agent dédiée** par tenant (rôle, permissions, plafonds), distincte des
   humains dans l'audit, enregistrant *qui* déclenche/approuve.
2. **Serveur MCP distant** (HTTP/SSE) authentifié par clé d'agent, exposant un **noyau
   dispatch** d'outils, scopés par permissions de l'agent ET modules du tenant.
3. **Modèle de confiance par paliers de risque** : lecture + actions à faible risque en
   direct ; actions mutantes/sensibles → **file « actions proposées »** validée par un
   humain.
4. **Idempotence explicite** et **plafonds en données**, re-vérifiés à la proposition et
   à l'exécution.
5. **UI « Boîte d'actions agent »** pour valider/rejeter, branchée sur le slot ⌘K
   réservé en phase 9.

Hors périmètre palier 1 (YAGNI) : client ⌘K natif et boucle LLM maison (palier 2) ;
hébergement de Hermes par Pulsar ; comms agent-à-agent ; passerelles Teams/Slack
(côté Hermes) ; exposition large des opérations TMS (master data, billing, routes…) —
on s'en tient au noyau dispatch.

## A. Modèle d'identité d'agent

Nouveau modèle Prisma `Agent` — cousin enrichi de `ApiKey` (même logique de clé hachée,
résolution en principal, scopes ⊆ `ALL_PERMISSION_KEYS`).

```
Agent {
  id, tenantId, name, description
  permissions  String[]          // sous-ensemble de ALL_PERMISSION_KEYS (plafond RBAC)
  caps         Json              // voir § D
  secretHash   String  @unique   // sha256 d'une clé "ak_<base64url(24)>"
  prefix       String            // affichage (11 car.)
  serviceUserId String           // user caché DISABLED dédié à CET agent (attribution audit)
  status       AgentStatus       // ACTIVE | REVOKED
  lastUsedAt, createdById, createdAt, revokedAt
  @@index([tenantId])
}
```

**Principal dédié.** On généralise `ApiKeysService.ensureServiceUser` : au lieu d'un
seul `service-account@pulsar.local` par tenant, chaque agent obtient un user caché
`DISABLED` dédié (`agent+<id>@pulsar.local`), pour que l'audit montre l'agent précis
(`agent:dispatch-bot`) et non le compte de service générique. Le compte de service
existant (clés API) reste inchangé. **Règle 13 respectée** : ces comptes ne sont jamais
loginables.

**Plafonds hérités** : permissions de l'agent (RBAC réutilisé) ∩ modules activés du
tenant. Un agent ne voit/n'appelle jamais un outil hors de ces deux plafonds.

## B. Serveur MCP distant (`core/agent-gateway`)

Endpoint MCP **HTTP/SSE** (streamable HTTP, le standard remote actuel), authentifié par
la clé d'agent (header `Authorization: Bearer ak_…` ou `X-Agent-Key`). Réutilise le
chemin d'auth machine du `JwtAuthGuard` (un `AgentKeyGuard` analogue résout la clé en
`AuthUser` du principal agent + ses permissions).

**Registre d'outils** : une table en code `tool → { permission, tier, module, handler,
inputSchema }`. `listTools` ne renvoie que les outils dont `permission ∈ agent.permissions`
ET `module ∈ tenant.enabledModules`. Chaque handler réutilise les **services existants**
(jamais de logique métier dupliquée).

### Noyau dispatch (palier 1)

| Outil | Tier | Permission (réelle, `packages/shared/src/permissions.ts`) | Service réutilisé |
| ----- | ---- | --------------------------------------------------------- | ----------------- |
| `list_transport_orders` | READ | `transportation.orders.read` | TransportOrders |
| `get_load` | READ | `transportation.planning.read` | Loads |
| `list_shipments` | READ | `transportation.planning.read` | Shipments |
| `rate_options` | READ | `transportation.planning.read` | Loads (`/rate-options`) |
| `carrier_scorecard` | READ | `transportation.analytics.read` | Analytics |
| `create_load` | MUTATING | `transportation.planning.manage` | Loads (`POST /loads`) |
| `assign_shipment` | MUTATING | `transportation.planning.manage` | Shipments (assignToLoad) |
| `tender_load` | SENSITIVE | `transportation.planning.manage` | Tenders (`POST /loads/:id/tender`) |

Permissions vérifiées contre le code : loads/shipments/tender relèvent de
`PLANNING_*` (et non d'un hypothétique `loads.*`) ; le dispatch/complete relève de
`EXECUTION_MANAGE` mais n'est pas dans le noyau palier 1. `tender_load` est classé
SENSITIVE (engage de l'argent + un tiers externe) **bien que** partageant la permission
`PLANNING_MANAGE` de `create_load`/`assign_shipment` — le tier est une notion de
gouvernance distincte de la permission RBAC. Liste fermée pour le palier 1.

## C. File « actions proposées » (`ProposedAction`)

```
ProposedAction {
  id, tenantId, agentId
  triggeredByRef String?          // ex: "teams:user@org" — opaque, jamais une FK humaine fictive
  tool        String
  argsJson    Json
  riskTier    RiskTier            // READ | LOW | MUTATING | SENSITIVE
  status      ProposalStatus      // PENDING | APPROVED | REJECTED | EXECUTED | FAILED
  idempotencyKey String
  decidedById String?             // user humain approbateur
  decidedAt   DateTime?
  resultJson  Json?               // résultat d'exécution ou message d'erreur
  proposedAt  DateTime
  @@unique([agentId, idempotencyKey])
  @@index([tenantId, status])
}
```

**Routage par tier.** READ et LOW s'exécutent en direct dans le handler MCP et
renvoient le résultat. MUTATING et SENSITIVE **n'exécutent pas** : ils créent une
`ProposedAction` `PENDING` et renvoient `{ queued: true, proposalId, status: "PENDING" }`.

**Idempotence (pièce manquante de l'audit).** `(agentId, idempotencyKey)` unique. Re-
proposer la même clé renvoie la proposition existante au lieu d'en créer une seconde —
un agent qui retente n'agit jamais deux fois. La clé est fournie par l'agent dans
l'appel d'outil ; à défaut, dérivée de `sha256(tool + argsJson canonicalisé)`.

**Exécution à l'approbation.** L'approbation appelle le vrai service (ex: `TenderService`),
attribué au principal agent, **avec re-vérification des plafonds et du statut** via le
pattern `updateMany` conditionnel déjà en vigueur dans le codebase (race-safe). Statut
`PENDING → EXECUTED` ou `FAILED` (avec `resultJson`). Toute transition de statut métier
sous-jacente passe par les state machines (règle 2).

## D. Plafonds en données (`Agent.caps`)

JSON par agent, vérifié à la proposition **et** à l'exécution :

- `maxAmountPerAction` — montant max (devise du tenant) pour un outil monétaire
  (ex: `tender_load`) ; dépassement → proposition refusée à la création (400 outil).
- `maxActionsPerMinute` — débit (analogue au throttle public existant).
- `toolAllowlist` — restriction optionnelle en deçà des permissions.
- `autoApprove` — allowlist d'outils promus en exécution directe (le « palier de
  confiance » qui monte : un outil MUTATING listé ici saute la file). Vide par défaut —
  **tout mutant passe par la file tant qu'on ne l'a pas explicitement promu**.

Fonctions pures de tiering et d'évaluation des plafonds dans `packages/shared`
(`agents/risk.ts`), unit-testées et réutilisées des deux côtés (proposition/exécution).

## E. UI « Boîte d'actions agent »

Nouvelle page web (design system phase 9, pattern liste + Panel) : propositions
`PENDING` du tenant, rendu **lisible** de l'outil + args + aperçu (ex: « Tender LD-123
au transporteur X pour 1 450 CAD »), boutons Approuver / Rejeter. Approbation →
exécution réelle + audit avec approbateur. Compteur dans la cloche/le slot ⌘K réservé.
Gestion d'agents (créer/révoquer, fixer permissions & plafonds, afficher la clé une
fois) sous Settings, calquée sur la page API keys.

## F. Permissions & audit

Nouvelles clés dans `packages/shared/src/permissions.ts` (reprises par le seed) :

- `agents.read`, `agents.manage` — voir / enregistrer-révoquer-configurer les agents.
- `agents.actions.read`, `agents.actions.approve` — voir / valider les propositions.

Audit (règles 6 & 14) : création de proposition, approbation, rejet, exécution
(succès/échec) → `AuditLogsService.log`, **acteur = agent**, approbateur humain
enregistré. Re-check d'activation du module en service pour tout outil mutant (règle 15).

## G. Tests

**e2e** (`apps/api/test/agents.e2e-spec.ts`, pattern existant — master data propre,
rerun-safe) :

1. Enregistrer un agent → `listTools` ne renvoie que les outils autorisés (scoping
   permissions × modules).
2. Outil de lecture → données en direct.
3. Outil mutant → **aucune mutation DB**, `ProposedAction` `PENDING` créée.
4. Dépassement de plafond (`maxAmountPerAction`) → refus à la proposition.
5. Approbation → mutation réelle + entrée d'audit avec approbateur + `EXECUTED`.
6. Idempotence → même `idempotencyKey` deux fois = une seule proposition.
7. Outil hors module (billing désactivé) → non listé / refusé.

**unit** (`packages/shared`) : classification de tier, évaluation des plafonds.

## H. Migration

1 migration Prisma (`Agent`, `ProposedAction`, enums `AgentStatus`/`RiskTier`/
`ProposalStatus`) + nouvelles permissions au seed. Aucune rupture des modèles existants.

## Risques / points ouverts

- **Support MCP remote en NestJS** : confirmer la lib/transport (SDK MCP TS + adaptateur
  HTTP/SSE) à l'étape writing-plans ; repli REST + shim si le remote MCP s'avère
  immature.
- **Rendu lisible des args** dans l'UI : générique d'abord (clé/valeur), gabarits par
  outil ensuite si besoin.
- **`triggeredByRef`** opaque (string) — pas de FK vers un humain fictif (règle 13). Le
  lien vers une vraie identité externe (SSO Teams) est un sujet de palier ultérieur.
- **Palier 2** (client ⌘K natif via Claude API) consommera les *mêmes* outils + la même
  file de gouvernance — voir la skill `claude-api` pour le choix de modèle à ce
  moment-là.
