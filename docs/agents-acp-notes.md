# Hermes ACP wire contract — verified notes (palier 2a spike)

> Mise à jour du 28 septembre 2026 : ce spike est historique. Le client utilise
> maintenant `session/load` pour une reprise stricte et le wrapper refuse un
> historique absent; `session/resume` peut créer un autre ID sans le renvoyer.
> Voir [qualification A2a et limites](./plans/ai-runtime-qualification.md).

Source of truth for the future `HermesAcpClient` (Task 7) and `AgentRuntimeService` (Task 8).
Every fact below was extracted from the **vendored** Hermes runtime at `hermes-agent/` (Python),
not assumed. Citations are `file:line` against that subtree. This is a read-only spike — no
production code was written.

## TL;DR for the Pulsar client design

- **Transport**: newline-delimited JSON-RPC 2.0 over the ACP server process's **stdio** (stdout =
  protocol, stderr = logs). We launch it as a sidecar subprocess and talk over its stdin/stdout.
- **Library**: the wire format is the published PyPI package `agent-client-protocol==0.9.0`
  (Rust/TS "Agent Client Protocol", a.k.a. ACP as used by Zed / Claude Code / OpenCode). Hermes is
  just an _agent_ implementation of it. Pulsar must implement the **client** side of the same spec.
  Reference the upstream ACP schema for any field not nailed down here.
- **Model**: NOT a `session/new` parameter. The model+provider come from the **server-side** Hermes
  config (`~/.hermes`) / env. The client can _switch_ model post-creation via `session/setModel`,
  using model ids the server advertises in the `models` field of the `session/new` response.
- **MCP servers**: ARE per-session — passed in `session/new` `mcpServers`. SSE/HTTP and stdio
  shapes confirmed below. **This is the load-bearing assumption for our design and it holds.**
- **Persona / system prompt**: there is **NO native per-session system-prompt field** in
  `session/new`. The system prompt is built internally by Hermes' `AIAgent`. **Recommended
  fallback: inject the persona as the first `session/prompt` turn.** (See §3.)
- **Auth**: stdio is local-trust; the ACP connection itself needs no client auth. The server's
  `initialize` advertises auth methods only for _provider credential_ setup, which Pulsar can ignore.
- **Permissions**: the server makes a reverse call `session/requestPermission`; Pulsar auto-allows
  by replying with the `allow_once` option (governance lives in the MCP layer, not ACP).

---

## 1. Launch & transport

**Entrypoint** — two equivalent ways (`hermes-agent/acp_adapter/entry.py`, `__main__.py`):

```
python -m acp_adapter            # __main__.py -> entry.main()   (acp_adapter/__main__.py:1)
python -m acp_adapter.entry      # same
hermes-acp                       # console script (pyproject.toml:275 -> acp_adapter.entry:main)
```

`entry.main()` ultimately runs (`acp_adapter/entry.py` ~L230):

```python
import acp
agent = HermesACPAgent()
asyncio.run(acp.run_agent(agent, use_unstable_protocol=True))
```

- `use_unstable_protocol=True` is required and asserted in tests (`tests/acp/test_entry.py:23`).
- **Transport is stdio JSON-RPC** — `acp.run_agent` reads requests from **stdin** and writes
  responses/notifications to **stdout**. Confirmed by the explicit stdout-hygiene measures:
  - logging is forced to **stderr** "so stdout stays clean for ACP stdio" (`entry.py` `_setup_logging`).
  - agent print output is rerouted to stderr (`acp_adapter/session.py` `_acp_stderr_print`,
    set as `agent._print_fn` in `_make_agent`).
  - UTF-8 stdio bootstrap on Windows (`entry.py` top, `hermes_bootstrap`).
- **Framing**: standard ACP framing as implemented by `agent-client-protocol==0.9.0`
  (newline-delimited JSON, one JSON-RPC message per line over stdio). Not Content-Length framed.
  _Confirm at runtime_ — see Open Questions.
- **No socket / no TCP port.** Pure stdin/stdout of the child process.
- **Liveness probes**: clients may send `ping` / `health` / `healthcheck`; the server returns
  JSON-RPC `-32601` (method not found) and treats that as "alive". The error is benign and the
  traceback is suppressed server-side (`entry.py` `_BENIGN_PROBE_METHODS`,
  `_BenignProbeMethodFilter`).

**Env / credentials the server needs** (the _server_ side, not the ACP wire):

- Loads `.env` from `HERMES_HOME` (default `~/.hermes`) via `entry._load_env()`.
- The model **provider + api key** are resolved server-side by `resolve_runtime_provider()` from
  that config/env (`acp_adapter/session.py` `_make_agent`, `acp_adapter/auth.py detect_provider`).
  If no provider is configured, sessions fall back to `"openrouter"` and prompts will fail to run.
  **Pulsar's sidecar must have a provisioned `~/.hermes` (provider + key) before serving prompts.**
- `--check` verifies imports only; `--setup` / `--setup-browser` are interactive (do NOT call from
  Pulsar). Useful: `hermes-acp --version`, `hermes-acp --check`.

## 2. `initialize` handshake

Handler: `acp_adapter/server.py:859 HermesACPAgent.initialize(...)`.

**Request params** (client → agent):

- `protocolVersion: int` (optional; server falls back to `acp.PROTOCOL_VERSION` if absent —
  server.py:866-868).
- `clientCapabilities: ClientCapabilities` (optional).
- `clientInfo: Implementation { name, version }` (optional; used only for logging).

**Response** (`InitializeResponse`, server.py:878):

```jsonc
{
  "protocolVersion": <acp.PROTOCOL_VERSION>,           // echoes the server's supported version
  "agentInfo": { "name": "hermes-agent", "version": "<HERMES_VERSION>" },
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": { "image": true },
    "sessionCapabilities": { "fork": {}, "list": {}, "resume": {} }
  },
  "authMethods": [ /* see §7 */ ]
}
```

- The numeric `PROTOCOL_VERSION` is whatever `agent-client-protocol==0.9.0` defines; the client
  should send the same constant from its own ACP version and accept the server's echoed value
  (`tests/acp/test_server.py:95` asserts the response equals `acp.PROTOCOL_VERSION`).
- Field names on the wire are camelCase (`protocolVersion`, `agentCapabilities`, …); the Python
  models use snake_case aliases. The client speaks the camelCase wire form.

## 3. `session/new` — model, MCP servers, persona

Handler: `acp_adapter/server.py:1107 new_session(self, cwd, mcp_servers=None, **kwargs)`.

**Request params** (client → agent):

- `cwd: string` — **required**. Working directory for the agent's tools. (Hermes translates it via
  `_translate_acp_cwd`; pass an absolute path Pulsar controls, e.g. a per-tenant scratch dir.)
- `mcpServers: McpServer[]` — optional list of MCP servers to attach to **this session** (see shapes).
- **No `model` param.** **No `systemPrompt` / `instructions` / `persona` param.** Confirmed by the
  handler signature (only `cwd`, `mcp_servers`) and `SessionManager.create_session(cwd=".")`
  (`session.py:210`), which builds the agent purely from server-side config.

**MCP server entry shapes** (discriminated by type; field names confirmed by both the conversion
code `server.py:803-812` and the e2e test `tests/acp/test_mcp_e2e.py:59-103`):

stdio MCP server (`McpServerStdio`):

```jsonc
{
  "name": "test-fs",
  "command": "/usr/bin/mcp-fs",
  "args": ["--root", "/tmp"],
  "env": [{ "name": "DEBUG", "value": "1" }], // array of {name,value}, NOT a map
}
```

HTTP / SSE MCP server (`McpServerHttp` and `McpServerSse` — both handled by the same non-stdio
branch using `url` + `headers`, server.py:810-812):

```jsonc
{
  "name": "test-api",
  "url": "https://api.example.com/mcp",
  "headers": [{ "name": "Authorization", "value": "Bearer tok123" }], // array of {name,value}
}
```

> NOTE the **headers/env are arrays of `{name, value}` objects**, not JSON maps. The adapter folds
> them into maps internally (`{item.name: item.value for item in server.headers}`). On the wire the
> client sends arrays.

**This is the channel Pulsar uses to expose its governed MCP server to the agent**: pass an SSE/HTTP
entry pointing at Pulsar's MCP endpoint, with the per-session/per-tenant capability token in
`headers` (e.g. `{ "name": "Authorization", "value": "Bearer <token>" }`). The adapter registers
them via `register_mcp_servers(config_map)` and refreshes the agent's tool surface
(server.py:787-852). `load_session` / `resume_session` / `fork_session` accept `mcpServers` the same
way (server.py:1127, 1174, 1223) — re-supply them on reconnect.

**Response** (`NewSessionResponse`, server.py:1116):

```jsonc
{
  "sessionId": "<uuid4>", // <-- this is where the sessionId comes from (server-generated uuid4)
  "models": {
    // SessionModelState — drives §model switching
    "availableModels": [{ "modelId": "<provider:model>", "name": "...", "description": "..." }],
    "currentModelId": "<provider:model>",
  },
  "modes": {
    /* SessionModeState */
  },
  "_meta": {
    /* provenance, server.py _provenance_meta */
  },
}
```

- `sessionId` is a server-generated `uuid4` (`session.py:215`). Pulsar keys its conversation⇄session
  map on this.
- `models.availableModels[].modelId` is encoded as `"<provider>:<model>"` (server.py:569
  `_encode_model_choice`); that exact id is what you send back in `session/setModel`.

**Persona / system prompt — recommendation.** Since there is no native field, inject the persona as
the **FIRST `session/prompt` turn** right after `session/new`, before any user text. Hermes appends
each prompt to its history and runs the agent on the full history, so a leading system/persona turn
is honored. (The agent's own base system prompt is built internally and cached as
`_cached_system_prompt`, server.py:681 — we cannot override it over ACP, only prepend to the
conversation.) Alternatively, bake the persona into the server-side Hermes config if a single static
persona per sidecar is acceptable — but per-conversation personas must go through the first-prompt
injection.

## 4. `session/prompt` — sending a turn & end-of-turn

Handler: `acp_adapter/server.py:1290 prompt(self, prompt, session_id, **kwargs)`.

**Request params** (client → agent):

- `sessionId: string` — required.
- `prompt: ContentBlock[]` — required, a list of content blocks. Supported block types:
  `TextContentBlock` (`{ "type": "text", "text": "..." }`), `ImageContentBlock`,
  `AudioContentBlock`, `ResourceContentBlock`, `EmbeddedResourceContentBlock` (server.py:1292-1300).
  For Pulsar, send a single text block per user turn.
- Slash commands: a **text-only** prompt whose text starts with `/` is intercepted server-side and
  handled without calling the LLM (server.py:1353). Avoid sending user text that starts with `/`
  unless you intend a Hermes slash command.

**End-of-turn signaling**: the `session/prompt` RPC **returns once, at end of turn**, with a
`PromptResponse` carrying `stopReason` (server.py:1670):

```jsonc
{ "stopReason": "end_turn" | "cancelled" | "refusal", "usage": { "inputTokens": …, "outputTokens": …, "totalTokens": …, "thoughtTokens": …, "cachedReadTokens": … } }
```

- `"end_turn"` = normal completion (server.py:1315/1361/1377/1560/1669).
- `"cancelled"` = the turn was cancelled via `session/cancel` (server.py:1669).
- `"refusal"` = session not found / unable to run (server.py:1306).
- All streamed assistant content arrives as `session/update` **notifications** _before_ this
  response resolves. So the client maps: stream notifications → `text`/`tool_call` events; the
  `session/prompt` result → the `end` event (with `stopReason`).
- Concurrency: if a prompt is sent while the session is still running, the server **queues** it and
  immediately returns `end_turn` after emitting an "Queued for the next turn" agent message
  (server.py:1366-1378). Pulsar should serialize turns per session (await the prior `session/prompt`
  result before sending the next) to avoid surprise queueing.

## 5. `session/update` notifications — streamed events

Agent → client JSON-RPC **notifications** (method `session/update`), one `update` object each, tagged
by a `sessionUpdate` discriminator. Emitted from `acp_adapter/events.py` + `server.py` via
`conn.session_update(session_id, update)`. Field names (wire camelCase / Python snake_case):

| Hermes event                   | `sessionUpdate` tag   | Shape (key fields)                                                                              | Built by                                                        |
| ------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| assistant text chunk           | `agent_message_chunk` | `{ content: { type:"text", text } }`                                                            | `acp.update_agent_message_text` (events.py:276, server.py:1632) |
| assistant reasoning/thought    | `agent_thought_chunk` | `{ content: { type:"text", text } }`                                                            | `acp.update_agent_thought_text` (events.py:199)                 |
| user message replay/echo       | `user_message_chunk`  | `{ content: { type:"text", text } }`                                                            | `acp.update_user_message_text` (server.py:1650)                 |
| tool call **started**          | `tool_call`           | `{ toolCallId, title, kind, status:"pending"/"in_progress", content[], locations[], rawInput }` | `acp.start_tool_call` → `ToolCallStart` (tools.py:1017)         |
| tool call **completed/failed** | `tool_call_update`    | `{ toolCallId, kind, status:"completed"/"failed", content[], rawOutput }`                       | `acp.update_tool_call` → `ToolCallProgress` (tools.py:1268)     |
| plan / todo panel              | `plan`                | `{ entries:[{ content, priority, status }] }`                                                   | `AgentPlanUpdate` (events.py:84)                                |
| token usage indicator          | usage update          | `Usage`/`UsageUpdate`                                                                           | `_send_usage_update` (server.py:1667)                           |

Mapping to the client event model `{type:'text'|'tool_call'|'error'|'end'}`:

- `agent_message_chunk` → `{ type:'text', text }` (concatenate chunks).
- `agent_thought_chunk` → optional `text`/thought stream (or drop if we don't surface reasoning).
- `tool_call` (status pending/in_progress) and `tool_call_update` (status completed/failed) →
  `{ type:'tool_call', toolCallId, title?, kind, status, ... }`. Correlate the two by `toolCallId`.
- `session/prompt` result `stopReason` → `{ type:'end', stopReason }`.
- A JSON-RPC error on `session/prompt`, or `stopReason:"refusal"` → `{ type:'error' }`.
- There is **no dedicated `error` session/update** type; errors surface as the RPC result/exception.

## 6. `session/requestPermission` — reverse call, how to auto-allow

This is an **agent → client** request (the server calls back into Pulsar). Emitted via
`conn.request_permission(session_id, tool_call, options)` (server.py:1415-1420,
`acp_adapter/permissions.py:139`, `edit_approval.py:261`).

**Request params** (agent → client):

- `sessionId: string`
- `toolCall: ToolCallUpdate` — `{ toolCallId, title, kind, status:"pending", content[], rawInput }`
  (permissions.py `_build_permission_tool_call`).
- `options: PermissionOption[]` — e.g. `allow_once`, `allow_session`, `allow_always`, `deny`,
  `deny_always`, each `{ optionId, kind, name }` (permissions.py `_build_permission_options`).

**Client response** (`RequestPermissionResponse`) to **auto-allow** (confirmed shape,
`tests/acp/test_permissions.py:18,65`):

```jsonc
{ "outcome": { "outcome": "selected", "optionId": "allow_once" } }
```

- Pulsar should always reply with `optionId: "allow_once"` (or `allow_always` if it wants to silence
  repeats). Governance is enforced in the MCP layer (capability tokens / scoped tools), so ACP-level
  permission can be blanket-allowed.
- Timeout: the server auto-**denies** if the client doesn't respond within 60 s
  (permissions.py `make_approval_callback` default `timeout=60.0`) — so respond promptly.
- A response of `null`, a `DeniedOutcome`, or an unknown `optionId` is treated as deny
  (permissions.py `_map_outcome_to_hermes`).

## 7. Auth — does the ACP connection need it?

**No client auth on the ACP connection itself.** ACP is stdio-only / local-trust
(`acp_adapter/auth.py` docstrings, server.py:896-899 "ACP is stdio-only, local-trust").

- `initialize` advertises `authMethods` (auth.py `build_auth_methods`), but these are for
  configuring the **model provider credentials** server-side, not for authenticating the client:
  - a `TerminalAuthMethod` `hermes-setup` (id `hermes-setup`, opens interactive `--setup`) — always
    present.
  - an `AuthMethodAgent` for the detected provider (only if Hermes already has provider creds).
- The `authenticate` handler (server.py:893) only acknowledges a `methodId` matching the advertised
  provider (or `hermes-setup`); it returns `null` otherwise. **Pulsar does not need to call
  `authenticate`** as long as the sidecar's `~/.hermes` already has working provider credentials
  (which it must, per §1). If creds are missing, prompts fail at runtime, not at connect time.

## 8. Open questions / risks (probe at runtime in later tasks)

1. **Exact JSON-RPC framing**: confirmed stdio + JSON-RPC, but the byte-level framing
   (newline-delimited vs. Content-Length) is defined by `agent-client-protocol==0.9.0`, not by
   Hermes code. **Probe**: capture stdout bytes from `hermes-acp` after sending an `initialize`, or
   read the upstream ACP 0.9.0 spec, before finalizing the client's reader/writer. (Strong prior:
   newline-delimited JSON.)
2. **camelCase vs snake_case on the wire**: the Python models use snake_case with camelCase aliases.
   We assume the wire is camelCase (standard ACP). Confirm against a real capture or the upstream
   schema; if the 0.9.0 build emits snake_case, adjust the client's (de)serialization.
3. **`PROTOCOL_VERSION` numeric value**: read from `acp.PROTOCOL_VERSION` of 0.9.0 at runtime; not
   hard-codeable from the vendored Hermes source alone.
4. **Persona injection efficacy**: prepending the persona as the first prompt turn is the documented
   fallback, but we haven't verified Hermes weights a leading "system-style" user turn strongly
   enough vs. its internal `_cached_system_prompt`. Validate with a behavioral test once the sidecar
   runs. Consider whether a Hermes config-level persona is acceptable for static cases.
5. **Per-session model override**: the model can only be _switched_ via `session/setModel` using a
   server-advertised `modelId` (`"<provider>:<model>"`), and switching **rebuilds the agent**
   (`set_session_model` → `_make_agent`, server.py:1989). There is no way to _pin_ an arbitrary
   model at `session/new` if the server config doesn't already know that provider. Verify the model
   ids Pulsar wants are in `availableModels` (or that `setModel` accepts an unlisted
   `provider:model` — `_resolve_model_selection` suggests it parses arbitrary input, but unverified
   for unknown providers).
6. **MCP registration is process-global side-effect**: `register_mcp_servers(config_map)` mutates a
   shared registry and the agent tool surface (server.py:799-852). With multiple concurrent sessions
   in one sidecar process, per-session MCP isolation may leak. **Risk**: for strong tenant isolation,
   prefer **one sidecar process per tenant/conversation**, or verify the registry is keyed per
   session before sharing a process across tenants.
7. **Reconnect semantics**: `loadSession`/`resumeSession` replay history as `session/update`
   notifications _before_ the RPC returns (server.py:1141, 1198). The client must register its
   update handler before awaiting those calls or it will miss the transcript replay.

### Design-assumption verdict

The two load-bearing assumptions for palier 2a — **per-session MCP servers** and **model
selection** — both hold, but with caveats: model is selected by _switching_ against
server-advertised ids (not a free-form `session/new` field), and MCP registration appears
process-global (favor one sidecar per tenant). There is **no native per-session system prompt**;
persona must be injected as the first prompt turn. These are accommodations, not blockers — the
design stands.
