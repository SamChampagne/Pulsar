# Connecting an AI agent to Pulsar (MCP)

> Phase 11, palier 1. Pulsar exposes its dispatch operations as **scoped, authenticated MCP
> tools** so an external agent can read live data and *propose* mutating actions that a human
> approves inside Pulsar. **No LLM runs in Pulsar** — you bring your own agent.

Pulsar is **MCP-agnostic**: any [Model Context Protocol](https://modelcontextprotocol.io)
client (Claude Desktop, a custom script, an internal "Hermes" agent, …) can connect. Hermes is
our **reference client**, not a dependency — nothing in Pulsar is coupled to it.

## The endpoint

| | |
| --- | --- |
| URL | `POST {API_BASE}/api/v1/mcp` (e.g. `http://localhost:3000/api/v1/mcp` in dev) |
| Transport | MCP **Streamable HTTP**, stateless (one request/response, no session id) |
| Auth | `X-Agent-Key: <agent key>` header (or `Authorization: Bearer <agent key>`) |
| `Accept` | must include both `application/json` and `text/event-stream` |

`GET` and `DELETE` on `/mcp` return `405` — stateless mode is POST-only.

The endpoint is *public to the JWT layer* (it does not use a user session) but it **always
authenticates the agent key itself**: a missing or revoked key returns `401`. The agent acts as
its own hidden, non-loginable service account for tenant isolation and audit attribution.

## 1. Register an agent

In the web app, go to **Settings → Agents** (requires the `core.agents.manage` permission) and
**Register agent**:

- **Name / description** — shown in the audit trail and the approval inbox.
- **Permissions** — the dispatch scopes the agent may use (TMS read/planning/analytics). An
  agent only ever sees a tool if it holds that tool's permission.
- **Caps** (all optional):
  - `maxAmountPerAction` — reject any proposed action whose monetary amount exceeds this.
  - `maxActionsPerMinute` — throughput ceiling per agent.
  - `toolAllowlist` — restrict the agent to a subset of tool names.
  - `autoApprove` — list of tool names that skip the human queue and execute immediately
    (**the only bypass of the approval queue** — use sparingly; see the warning below).

The **agent key is shown exactly once** on creation (prefix `ak_…`). Pulsar stores only its
SHA-256 hash — copy it now; it cannot be retrieved later. Revoke an agent any time from the same
page (`DELETE /api/v1/agents/:id`); a revoked key is rejected immediately.

You can also create agents over the REST API: `POST /api/v1/agents`
`{ name, description?, permissions: string[], caps? }`.

## 2. Point your MCP client at Pulsar

Generic MCP client config (HTTP/Streamable transport with a custom auth header):

```jsonc
{
  "mcpServers": {
    "pulsar": {
      "type": "http",
      "url": "http://localhost:3000/api/v1/mcp",
      "headers": { "X-Agent-Key": "ak_REPLACE_WITH_YOUR_AGENT_KEY" }
    }
  }
}
```

Or test it by hand with `curl` (list the tools the agent may use):

```bash
curl -sS http://localhost:3000/api/v1/mcp \
  -H "X-Agent-Key: ak_REPLACE_WITH_YOUR_AGENT_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The tool list is **scoped per agent**: it is the intersection of the agent's `permissions`, the
tenant's **enabled modules**, and (if set) `caps.toolAllowlist`. An agent without
`transportation.analytics.read`, for example, never sees `carrier_scorecard`.

## 3. What the agent can do

The 8 dispatch tools (palier 1, all under the Transportation module):

| Tool | Risk tier | Permission | Behaviour |
| --- | --- | --- | --- |
| `list_transport_orders` | READ | `transportation.orders.read` | runs live |
| `get_load` | READ | `transportation.planning.read` | runs live |
| `list_shipments` | READ | `transportation.planning.read` | runs live |
| `rate_options` | READ | `transportation.planning.read` | runs live |
| `carrier_scorecard` | READ | `transportation.analytics.read` | runs live |
| `create_load` | MUTATING | `transportation.planning.manage` | **proposed → human approval** |
| `assign_shipment` | MUTATING | `transportation.planning.manage` | **proposed → human approval** |
| `tender_load` | SENSITIVE | `transportation.planning.manage` | **proposed → human approval** |

**READ/LOW tools execute immediately** and return their result. **MUTATING/SENSITIVE tools never
execute in the MCP handler** — they are enqueued as a `ProposedAction` and the tool call returns
`{ queued: true, proposalId, status: "PENDING" }`. Enqueuing is **idempotent** on
`(agent, idempotency key)`: re-issuing the same call returns the same proposal rather than a
duplicate.

## 4. A human approves (or rejects)

Pending proposals land in the web app under **Agent actions** (nav badge shows the count; gated
on `core.agents.actions.read`). A user with `core.agents.actions.approve` can **Approve** or
**Reject** each one:

- **Approve** re-checks the proposal is still `PENDING` (atomic claim), re-checks caps, then runs
  the real service call — attributed to the agent's service account and **audited with the
  approver**. The proposal moves to `EXECUTED` (or `FAILED`, with the error recorded).
- **Reject** discards it (`REJECTED`, audited).

REST equivalents: `GET /api/v1/agent-actions`, `POST /api/v1/agent-actions/:id/approve`,
`POST /api/v1/agent-actions/:id/reject`.

> ⚠️ **`caps.autoApprove`** lets a named MUTATING/SENSITIVE tool execute **without** the human
> step. It is the only way to bypass the queue. When you use it, the proposed-actions audit
> entity is skipped — auditing then relies on the underlying TMS services' own audit logging.
> Grant it deliberately, and prefer leaving SENSITIVE tools (e.g. `tender_load`) in the queue.

## Design notes

- The tool surface is defined once in `apps/api/src/core/agents/tool-registry.ts` (name → tier,
  permission, module, zod schema, handler). Handlers reuse the existing TMS services; nothing is
  re-implemented for agents.
- Tenant isolation and audit attribution come from the agent's hidden service user; the agent key
  is the credential and the tenant is derived from it, never from the request body.
- See CLAUDE.md "Hard rules (continued, phase 11)" (rules 21–23) for the invariants.

## Agents-employés (palier 2a)

Palier 1 exposed Pulsar's operations as MCP tools for a *bring-your-own* agent. Palier 2a adds
the missing half: a **brain that lives inside Pulsar's UI**. You register an **employee-agent**
in **Settings → Agents** — a persona (name, avatar, description), a **role**, an **LLM model**,
and an **autonomy level** — then talk to it from the **⌘K → "AI assistant"** panel. The
conversation streams over [ACP](https://modelcontextprotocol.io) and the agent's tool calls flow
straight into the palier-1 governance machinery.

### Autonomy levels

| Level | Behaviour |
| --- | --- |
| `PROPOSE` | every mutating tool call becomes a `ProposedAction` for a human to approve — nothing executes on its own. |
| `ACT_LOW` | low-risk mutations auto-execute; SENSITIVE ones still queue for approval. |
| `AUTONOMOUS` | mutating tool calls auto-execute without the human step. |

Autonomy is a *convenience*, not a blank cheque: **the agent's caps still bound auto-approved
actions**. The `maxAmountPerAction` cap is enforced on the auto-approve path too — an
`AUTONOMOUS` agent that proposes an action above its amount cap is still rejected
(`mcp-server.factory.ts`). Autonomy only decides *whether a human clicks approve*; it never lifts
the caps.

### Architecture (one paragraph)

**Hermes is the brain; Pulsar is the home.** Hermes is a Python ACP process that the API
**spawns per conversation** over stdio — one child process per conversation, deliberately, because
Hermes' MCP tool registration is process-global, so a process-per-conversation is how we keep one
tenant's tools from leaking into another's. Pulsar owns everything around it: the UI (⌘K panel and
Settings), the agent's **identity**, the **tools** (the palier-1 MCP surface), and the
**governance queue**. When Hermes wants to act, its tool calls hit `POST /api/v1/mcp` **as the
agent** — authenticated with a short-lived **session token** (signed with `AGENT_SESSION_SECRET`,
falling back to `JWT_SECRET`) — so they land in exactly the palier-1 path: scoped tool surface,
caps, idempotent proposed-action queue, human approval.

### Setup requirement

Running employee-agents requires the **Hermes Python environment to be runnable on the same host
as the API** — there is no network sidecar; the API literally `spawn`s a child process. Configure
it with three env vars (see `.env.example`):

- `HERMES_ACP_CMD` (default `python`)
- `HERMES_ACP_ARGS` (default `-m acp_adapter`)
- `HERMES_ACP_CWD` (default `./hermes-agent` — the vendored Hermes checkout)

It is **opt-in and best-effort**: if Hermes isn't installed or can't start, the ⌘K assistant
returns *unavailable* (HTTP 503) and **the rest of Pulsar is completely unaffected** — the runtime
is isolated, a Hermes failure never crashes core Pulsar.

### Still MCP-agnostic

Nothing here couples Pulsar to Hermes. The agent talks to Pulsar over the same `/api/v1/mcp`
endpoint any MCP client uses; **Hermes is the reference runtime**, swappable for any other ACP/MCP
brain that can call back into Pulsar with a session token.

### Installer + configurer le runtime (R1)

Palier 2a décrivait *comment* le runtime se branche ; R1 le rend **installable et configurable
sans toucher au `.env`**. Trois étapes :

1. **Installer Hermes** — depuis la racine du repo :

   ```bash
   pnpm agents:setup
   ```

   Le script installe Hermes dans `hermes-agent/.venv` via **[uv](https://docs.astral.sh/uv/)**,
   qui **récupère automatiquement un CPython 3.12 autonome** (Hermes exige 3.11–3.13). Aucune
   installation manuelle de Python n'est nécessaire — même une machine qui ne porte que Python
   3.14 (qui ne peut pas *héberger* Hermes) fonctionne, car uv provisionne son propre 3.12. Le
   script est idempotent (saute la création du venv s'il existe, rejoue toujours le `pip install`).

2. **Configurer un provider** — dans **Réglages → Runtime agents** (permission
   `core.agents.manage`), choisir un provider du catalogue puis, selon son type :
   - **clé API** (OpenRouter, Anthropic, OpenAI, Nous Portal API, Custom…) : coller la clé.
     Elle est **chiffrée au repos** (`enc:v1` via `CryptoService`) et n'est jamais renvoyée par
     l'API ;
   - **login OAuth** (Nous Portal, OpenAI Codex…) : cliquer **« Connecter »**. Pulsar lance la
     commande de login de Hermes et **streame en SSE** le *device code* + l'URL à ouvrir dans le
     navigateur ; les jetons obtenus vivent dans le `HERMES_HOME` **par tenant** (pas dans Pulsar).

   Le bouton **« Tester »** (`POST /agent-runtime/test`) vérifie que le runtime démarre et liste
   les modèles disponibles.

3. **Parler à un agent** — ouvrir la palette **⌘K → « AI assistant »** et discuter. La
   conversation streame via ACP comme au palier 2a ; les appels d'outils retombent dans la file
   de gouvernance palier 1.

**Endpoints** (`/api/v1/agent-runtime`, gated `core.agents.manage`) : `GET providers` (catalogue),
`GET` / `PUT` (config du tenant, jamais la clé en clair), `POST test`, `POST connect` (SSE login).

Le runtime est **par tenant** et **best-effort** : si Hermes est absent ou ne démarre pas,
l'assistant renvoie *indisponible* (HTTP **503**) et le reste de Pulsar n'est pas affecté. Le
catalogue de providers vit dans `@pulsar/shared` (`runtime-providers.ts`, pure data, utilisable
côté navigateur — aucun import Node).

### Espace Agents (R2)

R2 fait des agents des **citoyens de premier ordre** de l'UI : un onglet **Agents** au niveau
supérieur de la navigation (gated `core.agents.read`) mène à un **roster de cartes « employés »**
(une par agent : avatar, rôle, niveau d'autonomie, statut). Cliquer une carte ouvre la **page de
l'agent** (`/agents/[id]`) à trois volets :

- **Profil & config guidée** — édition de la persona, du rôle, du modèle, du niveau d'autonomie
  et des permissions, avec de l'**aide inline** et des **presets de rôle** (`AGENT_ROLE_PRESETS`
  de `@pulsar/shared` : répartiteur, commis à la facturation, analyste — chacun avec persona +
  permissions + autonomie suggérées) pour démarrer en un clic.
- **Activité** — les **conversations** récentes et les **actions proposées** de l'agent, plus des
  **compteurs** (`conversations`, `pending`, `executed`, `rejected`).
- **Chat** — parler directement à cet employé (même chemin ACP/gouvernance que la palette ⌘K).

**Endpoints** : `GET /api/v1/agents/:id` projette le profil (`role`, `persona`, `autonomyLevel`,
`permissions`) **sans jamais exposer** le `secretHash` ni le `serviceUserId` ; `GET
/api/v1/agents/:id/activity` renvoie `{ conversations, proposedActions, stats }`, **scopé au
tenant + à l'agent**. Les deux sont gated `core.agents.read`.
