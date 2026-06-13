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
