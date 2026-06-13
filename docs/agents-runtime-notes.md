# Hermes agent runtime — verified contract (phase 11, R1)

This documents the **vendored Hermes** runtime (`hermes-agent/`) that Pulsar's
`AgentRuntimeService` will spawn. Everything below is verified against the
vendored source with file:line citations. No speculation; open questions are
flagged in the last section.

## TL;DR — gating result

**The install CANNOT succeed on this machine as-is.** `hermes-agent` pins
`requires-python = ">=3.11,<3.14"` and the only interpreter present is **Python
3.14.3**, so `pip install -e ./hermes-agent[acp]` is rejected at the metadata
gate:

```
ERROR: Package 'hermes-agent' requires a different Python: 3.14.3 not in '<3.14,>=3.11'
```

This is a deliberate cap (see `hermes-agent/pyproject.toml:14-20`): Rust-backed
transitives such as `pydantic-core` have no cp314 wheels, so the project refuses
3.14 outright instead of attempting a maturin source build. **A Python 3.12 (or
3.11) interpreter must be installed**, then re-run `pnpm agents:setup`. The
setup script (`scripts/setup-agents.mjs`) already prefers 3.12/3.11 over 3.14 if
a compatible one is on PATH.

`ACP_OK` was therefore NOT obtained on this machine; it remains to be confirmed
on a 3.11/3.12 box.

---

## 1. Minimal `cli-config.yaml` to pin a provider + model

Lives at `<HERMES_HOME>/cli-config.yaml` (copied from
`hermes-agent/cli-config.yaml.example`). Keys are under the top-level `model:`
map. From `hermes-agent/cli-config.yaml.example:8-46`:

```yaml
model:
  # Both "default" and "model" work as the key name here.
  default: "anthropic/claude-opus-4.6"   # line 11
  provider: "auto"                        # line 42
  base_url: "https://openrouter.ai/api/v1"  # line 46 (provider-specific)
```

Minimal pin for a single provider + model:

```yaml
model:
  provider: "anthropic"            # or openrouter / openai-codex / nous / custom ...
  default: "anthropic/claude-opus-4.6"
  # base_url: only needed for custom / azure-foundry / aggregators
```

- `model.provider` — inference provider selector. `"auto"` auto-detects from
  available credentials (`cli-config.yaml.example:14`).
- `model.default` (alias `model.model`) — model id string
  (`cli-config.yaml.example:9-11`).
- `model.base_url` — only required for `custom`/`azure-foundry` or to override
  an aggregator endpoint (`cli-config.yaml.example:44-46`). Defaults to the
  provider's built-in endpoint otherwise.

Note: env vars in `<HERMES_HOME>/.env` take precedence over `cli-config.yaml`
(`cli-config.yaml.example:3`).

## 2. Per-provider: `model.provider` value + API key env var OR login command

Source: the provider enumeration comment block in
`hermes-agent/cli-config.yaml.example:13-33`.

| Target provider | `model.provider` value | Auth: API-key env var **or** login command |
| --- | --- | --- |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` (falls back to `OPENAI_API_KEY`) — `cli-config.yaml.example:15` |
| Anthropic (direct) | `anthropic` | `ANTHROPIC_API_KEY` — `cli-config.yaml.example:18`. Requires the `anthropic` extra (`pyproject.toml:182`). |
| OpenAI | `custom` (OpenAI-compatible) or `openrouter` | `OPENAI_API_KEY` (+ `OPENAI_BASE_URL` for `custom`) — `cli-config.yaml.example:36-37, 442` |
| Nous (OAuth) | `nous` | **Login command** `hermes login` — `cli-config.yaml.example:16` |
| Nous (API key) | `nous-api` | `NOUS_API_KEY` — `cli-config.yaml.example:17` |
| OpenAI Codex | `openai-codex` | **Login command** `hermes auth` (Codex device-code) — `cli-config.yaml.example:19` |
| GitHub Copilot | `copilot` | `GITHUB_TOKEN` (or `gh auth` fallback) — `cli-config.yaml.example:20`; copilot fallback in `hermes_cli/main.py:737-742` |
| Custom / local | `custom` (aliases `ollama`, `vllm`, `llamacpp`); LM Studio uses `lmstudio` | Set `model.base_url`; key optional (`LM_API_KEY` for LM Studio) — `cli-config.yaml.example:33-39` |

### Login providers — exact commands and how the device code is emitted

Both are top-level `hermes` subcommands, registered via dedicated parser
builders:

- `hermes login` — Nous Portal OAuth device-code flow. Parser:
  `hermes_cli/subcommands/login.py:17-18` (`subparsers.add_parser("login", ...)`).
- `hermes auth add <provider>` — pooled credentials incl. Codex OAuth. Parser:
  `hermes_cli/subcommands/auth.py:14-23` (`add_parser("auth")`, then
  `add_parser("add")` taking a `provider` arg whose help lists
  `anthropic, openai-codex, openrouter`).

**Device code is printed to stdout.** The Nous flow
(`hermes_cli/auth.py:7549-7567`) prints:

```
To continue:
  1. Open: <verification_uri_complete>
  2. If prompted, enter code: <user_code>
Waiting for approval (polling every <interval>s)...
```

It also calls `webbrowser.open(...)` unless in a remote/headless session
(`hermes_cli/auth.py:7531-7532, 7559-7564`). The device-code endpoint returns
`device_code, user_code, verification_uri, verification_uri_complete,
expires_in, interval` (`hermes_cli/auth.py:4338-4351`).

#### Invoking login/auth under the venv

The `hermes` console script is installed by the package
(`pyproject.toml:273`, `hermes = "hermes_cli.main:main"`). Under the venv,
either form works:

```sh
# Windows
hermes-agent/.venv/Scripts/hermes.exe login
hermes-agent/.venv/Scripts/python.exe -m hermes_cli.main login
hermes-agent/.venv/Scripts/python.exe -m hermes_cli.main auth add openai-codex --type oauth

# POSIX
hermes-agent/.venv/bin/hermes login
hermes-agent/.venv/bin/python -m hermes_cli.main login
```

For Pulsar's runtime, prefer the explicit module form
(`<venv-python> -m hermes_cli.main login`) so it doesn't depend on the
Scripts/bin dir being on PATH. Pass `HERMES_HOME` in the env so the credentials
land in Pulsar's managed home (see §3).

## 3. HERMES_HOME resolution

Source of truth: `hermes-agent/hermes_constants.py`.

- `get_hermes_home()` (`hermes_constants.py:53-108`):
  1. an in-process override (ContextVar) if set,
  2. else the **`HERMES_HOME` env var** if non-empty (`hermes_constants.py:73-75`),
  3. else the platform-native default.
- Platform default (`_get_platform_default_hermes_home`,
  `hermes_constants.py:44-50`):
  - **win32:** `%LOCALAPPDATA%\hermes` (falls back to
    `~/AppData/Local/hermes` if `LOCALAPPDATA` unset).
  - **POSIX:** `~/.hermes`.

```python
def _get_platform_default_hermes_home() -> Path:
    if sys.platform == "win32":
        local_appdata = os.environ.get("LOCALAPPDATA", "").strip()
        base = Path(local_appdata) if local_appdata else Path.home() / "AppData" / "Local"
        return base / "hermes"
    return Path.home() / ".hermes"
```

`cli-config.yaml`, `skills/`, and `.env` all resolve under HERMES_HOME
(`hermes_constants.py:398, 407, 413`). **Pulsar should set `HERMES_HOME`
explicitly** when spawning (the code repeatedly warns that subprocess spawners
must propagate it — `hermes_constants.py:64-67, 95-100`). We gitignore
`hermes-agent/.hermes-home/` as the managed home for this purpose.

## 4. ACP adapter launch command (the argv for AgentRuntimeService)

The ACP adapter entry point is `acp_adapter.entry:main`, exposed three ways
(`hermes-agent/acp_adapter/entry.py:9-13`):

- `python -m acp_adapter` (via `acp_adapter/__main__.py`, which calls
  `entry.main()`),
- `python -m acp_adapter.entry`,
- the `hermes-acp` console script (`pyproject.toml:275`,
  `hermes-acp = "acp_adapter.entry:main"`), or `hermes acp`.

**Recommended argv for `AgentRuntimeService` to spawn** (module form — no PATH
dependency):

```
# Windows
[ "<repo>/hermes-agent/.venv/Scripts/python.exe", "-m", "acp_adapter" ]
# POSIX
[ "<repo>/hermes-agent/.venv/bin/python", "-m", "acp_adapter" ]
```

with `cwd` = `hermes-agent/` and env including `HERMES_HOME` + the provider key.
The adapter speaks ACP JSON-RPC over **stdio**: stdout is reserved for the
JSON-RPC transport and logging goes to stderr (`acp_adapter/entry.py:2-4`).
`hermes_bootstrap` is imported first for UTF-8 stdio on Windows
(`acp_adapter/entry.py:15-26`).

The Step-3 verification commands (to run once on a 3.11/3.12 machine):

```sh
hermes-agent/.venv/Scripts/python.exe -c "import acp_adapter, acp; print('ACP_OK')"
echo "" | hermes-agent/.venv/Scripts/python.exe -m acp_adapter   # should wait/parse-error, NOT ImportError
```

(`acp` is the `agent-client-protocol==0.9.0` package pulled by the `acp` extra —
`pyproject.toml:183`.)

## 5. Open questions (need a live provider/login to verify)

1. **`ACP_OK` not yet proven** — blocked by the Python 3.14 cap on this machine.
   Must be confirmed on a 3.11/3.12 install before the HERMES_ENABLED smoke
   test is meaningful.
2. **ACP initialize handshake** — exact JSON-RPC `initialize`/`session/new`
   methods and the minimum a client must send before the agent will accept a
   prompt are not documented here (would require reading `acp_adapter/server.py`
   and/or a live session). Confirm what `AgentRuntimeService` must send first.
3. **Does the adapter read `cli-config.yaml`/provider on startup, or only when
   a session begins?** i.e. will a missing/invalid provider key crash at spawn
   or only on first prompt? Needs a live run.
4. **Codex (`hermes auth`) device-code stdout shape** — verified for the Nous
   `hermes login` flow (`auth.py:7549-7567`); the Codex path
   (`_codex_device_code_login`, referenced in `main.py:311`) likely mirrors it
   but the exact printed lines were not quoted here.
5. **Copilot via `GITHUB_TOKEN` vs `gh auth`** — `main.py:737-742` shows a
   `gh auth` fallback; which one the spawned non-interactive runtime should rely
   on needs a live check.
