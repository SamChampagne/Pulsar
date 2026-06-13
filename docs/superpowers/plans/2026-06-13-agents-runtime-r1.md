# Runtime Hermes managé par Pulsar (palier 2a-R1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rendre le runtime Hermes **réel et turnkey** : installable via `pnpm agents:setup`, configurable depuis Pulsar (provider par **clé API** ou **login/OAuth** type Codex), pour parler à un vrai agent en ⌘K dont les actions passent par la gouvernance palier 1.

**Architecture:** Un écran « Runtime agents » écrit un `AgentRuntimeConfig` par tenant (clé chiffrée via CryptoService, ou login OAuth dont les jetons vivent dans un `HERMES_HOME` par tenant). `AgentRuntimeService.openSession` (palier 2a) spawn le `python` d'un venv repo (`hermes-agent/.venv`) en injectant `HERMES_HOME` + la clé en env + un `cli-config.yaml` généré. Catalogue de providers dynamique dans `@pulsar/shared`.

**Tech Stack:** NestJS 11, Prisma/PostgreSQL, CryptoService (enc:v1, existant), SvelteKit (Svelte 5 runes, SSE), Python venv + `hermes-agent[acp]` (vendoré), Jest+supertest (e2e contre faux ACP + faux `hermes`), Vitest (shared).

**Spec:** `docs/superpowers/specs/2026-06-13-agents-runtime-managed-design.md`

**Conventions (CLAUDE.md):** isolation tenant (r1) ; `@RequirePermissions(core.agents.manage)` (r5) ; secrets chiffrés via CryptoService (palier 6) ; rebuild shared/database (r7) ; runtime best-effort/isolé (r24) ; **`pnpm build` complet avant vert** (le catalogue providers doit être pure-data, browser-safe — aucun import node-only dans `@pulsar/shared`).

---

## File Structure

- `packages/shared/src/agents/runtime-providers.ts` (+ `.spec.ts`, re-export) — catalogue providers.
- `packages/database/prisma/schema.prisma` — `AgentRuntimeConfig` + 20ᵉ migration.
- `apps/api/src/core/agents/agent-runtime-env.ts` (+ `.spec.ts`) — helper pur build-env + cli-config.
- `apps/api/src/core/agents/runtime-config.service.ts` — CRUD + crypto + HERMES_HOME.
- `apps/api/src/core/agents/runtime-install.ts` — détection venv/python.
- `apps/api/src/core/agents/runtime-config.controller.ts` — REST + SSE connect/test.
- `apps/api/src/core/agents/agent-runtime.service.ts` (modif) — openSession lit la config réelle.
- `apps/api/src/core/agents/agents.module.ts` (modif) — wiring.
- `scripts/setup-agents.mjs` + `package.json` (`agents:setup`) + `.gitignore`.
- `apps/web/src/routes/(app)/settings/agent-runtime/+page.svelte` (+ nav dans `+layout.svelte`).
- `apps/web/src/lib/api/agent-runtime-connect.ts` — client SSE du login.
- `apps/api/test/phase11r1-agent-runtime.e2e-spec.ts` + `test/support/fake-hermes.*`.

---

## Task 1: Install script + RUN it + verified Hermes contract (gating spike)

Le risque #1 : `hermes-agent[acp]` s'installe-t-il sur cette machine (Python 3.14, Windows) et `hermes-acp` se lance-t-il ? On le PROUVE ici, et on documente le contrat réel (providers, commandes de login, format `cli-config.yaml`, `HERMES_HOME`) qui pilote les tâches suivantes. Aucune supposition non vérifiée.

**Files:**
- Create: `scripts/setup-agents.mjs`
- Modify: root `package.json` (script `agents:setup`), `.gitignore`
- Create: `docs/agents-runtime-notes.md`

- [ ] **Step 1: Write `scripts/setup-agents.mjs`**

Un script Node qui : détecte un interpréteur Python (préfère `python3.12`/`python3.11` si présent, sinon `python`/`py`) ; crée un venv `hermes-agent/.venv` ; `pip install -e ./hermes-agent[acp]` ; affiche le chemin de l'exécutable `hermes-acp`/`python` du venv. Idempotent (si le venv existe, ne recrée pas). Échec clair si aucun python. Cross-platform (le venv python est `.venv/Scripts/python.exe` sur Windows, `.venv/bin/python` sinon).

- [ ] **Step 2: Wire `pnpm agents:setup` + .gitignore**

Dans le `package.json` racine, ajouter `"agents:setup": "node scripts/setup-agents.mjs"`. Ajouter à `.gitignore` : `hermes-agent/.venv/` et `hermes-agent/.hermes-home/`.

- [ ] **Step 3: RUN it (prove install)**

Run: `pnpm agents:setup`
Expected: venv créé, `hermes-agent[acp]` installé. Puis vérifier que l'ACP se lance :
Run (adapter au chemin OS du venv) : `hermes-agent/.venv/Scripts/python.exe -c "import acp_adapter, acp; print('acp ok')"`
Expected: `acp ok`. Si l'install échoue sur Python 3.14 (wheels manquantes), ESSAYER un python 3.11/3.12 si dispo et l'utiliser dans le script ; sinon reporter DONE_WITH_CONCERNS en documentant l'échec exact (et ce qu'il faudrait — un python plus ancien). C'est gating : si `hermes-acp` ne peut pas tourner ici, le dire fort.

- [ ] **Step 4: Document the verified Hermes contract**

Lire `hermes-agent/cli-config.yaml.example`, `hermes-agent/hermes_constants.py` (HERMES_HOME), `hermes-agent/cli.py` (commandes `auth`/`login`/`setup`/`model`), et écrire `docs/agents-runtime-notes.md` :
1. Le **format `cli-config.yaml`** minimal pour fixer provider + modèle (clés exactes : `model.provider`, `model.default`, `model.base_url` ?).
2. Pour chaque provider visé (openrouter, anthropic, nous, openai-codex, copilot, custom) : la valeur exacte de `model.provider`, la **variable d'env de clé** (OPENROUTER_API_KEY, ANTHROPIC_API_KEY…), et pour les login : la **commande exacte** (`hermes auth` ? `hermes login` ? avec quels args) + comment elle émet le code/URL (stdout ?).
3. Comment `HERMES_HOME` est résolu (env `HERMES_HOME`) et ce qu'il contient.
4. La commande exacte pour lancer l'ACP (`<venv>/python -m acp_adapter` confirmé en Step 3) — met à jour `HERMES_ACP_CMD/ARGS` si besoin.
Citer fichier:ligne. Ce doc pilote T2 (catalogue) et T4/T5 (env + login).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/samol/IntebecProject/Pulsar
git add scripts/setup-agents.mjs package.json .gitignore docs/agents-runtime-notes.md
git commit -m "feat(agents): pnpm agents:setup installs Hermes venv; verified runtime contract"
```

Report: install OK ou non (et sur quel python), le chemin du python du venv, le contrat vérifié (providers/env/login/cli-config), commit SHA.

---

## Task 2: Shared — `RUNTIME_PROVIDERS` catalog

**Files:** Create `packages/shared/src/agents/runtime-providers.ts` + `.spec.ts` ; modify `index.ts`.

- [ ] **Step 1: Failing test** — `runtime-providers.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RUNTIME_PROVIDERS, getRuntimeProvider } from './runtime-providers';

describe('RUNTIME_PROVIDERS', () => {
  it('every provider has a valid authMode and the matching auth field', () => {
    for (const p of RUNTIME_PROVIDERS) {
      expect(['apiKey', 'login']).toContain(p.authMode);
      if (p.authMode === 'apiKey') {
        expect(p.keyEnvVar).toBeTruthy();
        expect(p.loginCommand).toBeUndefined();
      } else {
        expect(p.loginCommand).toBeTruthy();
        expect(p.keyEnvVar).toBeUndefined();
      }
      expect(p.providerKey).toBeTruthy();
    }
  });
  it('ids are unique', () => {
    const ids = RUNTIME_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('getRuntimeProvider finds by id and returns undefined otherwise', () => {
    expect(getRuntimeProvider('openrouter')?.authMode).toBe('apiKey');
    expect(getRuntimeProvider('openai-codex')?.authMode).toBe('login');
    expect(getRuntimeProvider('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @pulsar/shared test -- runtime-providers`

- [ ] **Step 3: Implement** — `runtime-providers.ts` (pure data, NO node imports — browser-safe). Encode the catalog per the VERIFIED contract from `docs/agents-runtime-notes.md` (adjust provider keys / env vars / login commands to what Task 1 found):

```ts
export type RuntimeAuthMode = 'apiKey' | 'login';
export interface RuntimeProvider {
  id: string;
  label: string;
  authMode: RuntimeAuthMode;
  providerKey: string;   // Hermes model.provider value
  keyEnvVar?: string;    // apiKey providers
  loginCommand?: string; // login providers — the `hermes <cmd>` subcommand
  needsBaseUrl?: boolean;
}

export const RUNTIME_PROVIDERS: RuntimeProvider[] = [
  { id: 'openrouter', label: 'OpenRouter', authMode: 'apiKey', providerKey: 'openrouter', keyEnvVar: 'OPENROUTER_API_KEY' },
  { id: 'anthropic', label: 'Anthropic (Claude)', authMode: 'apiKey', providerKey: 'anthropic', keyEnvVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'OpenAI', authMode: 'apiKey', providerKey: 'openai', keyEnvVar: 'OPENAI_API_KEY' },
  { id: 'nous', label: 'Nous Portal', authMode: 'login', providerKey: 'nous', loginCommand: 'login' },
  { id: 'openai-codex', label: 'OpenAI Codex', authMode: 'login', providerKey: 'openai-codex', loginCommand: 'auth' },
  { id: 'copilot', label: 'GitHub Copilot', authMode: 'login', providerKey: 'copilot', loginCommand: 'auth' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', authMode: 'apiKey', providerKey: 'custom', keyEnvVar: 'OPENAI_API_KEY', needsBaseUrl: true },
];

export function getRuntimeProvider(id: string): RuntimeProvider | undefined {
  return RUNTIME_PROVIDERS.find((p) => p.id === id);
}
```

- [ ] **Step 4: Run → pass.** Add `export * from './agents/runtime-providers';` to `index.ts`. `pnpm --filter @pulsar/shared build`.

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/agents/runtime-providers.ts packages/shared/src/agents/runtime-providers.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): Hermes runtime provider catalog (apiKey + login modes)"
```

---

## Task 3: DB — `AgentRuntimeConfig` + 20th migration

**Files:** Modify `schema.prisma`; create migration.

- [ ] **Step 1: Add the model** (read `Tenant` first to add the back-relation):

```prisma
model AgentRuntimeConfig {
  id           String   @id @default(cuid())
  tenantId     String   @unique
  provider     String
  authMode     String
  apiKeyEnc    String?
  defaultModel String?
  baseUrl      String?
  connectedAt  DateTime?
  lastTestAt   DateTime?
  lastTestOk   Boolean?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@map("agent_runtime_configs")
}
```
Back-relation on `Tenant`: `agentRuntimeConfig AgentRuntimeConfig?`.

- [ ] **Step 2: Migrate (non-interactive)** — Postgres running; EPERM note from prior plans applies.
```bash
cd /c/Users/samol/IntebecProject/Pulsar/packages/database && pnpm exec dotenv -e ../../.env -- prisma migrate dev --name phase11r1_agent_runtime_config
```
If drift/reset → STOP, BLOCKED.

- [ ] **Step 3: Generate + build**
```bash
cd /c/Users/samol/IntebecProject/Pulsar && pnpm db:generate && pnpm --filter @pulsar/database build
```

- [ ] **Step 4: Commit**
```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): AgentRuntimeConfig (per-tenant), 20th migration"
```

---

## Task 4: agent-runtime-env helper + RuntimeConfigService + install-check

**Files:** Create `agent-runtime-env.ts` (+ `.spec.ts`), `runtime-config.service.ts`, `runtime-install.ts`.

- [ ] **Step 1: Failing test** — `agent-runtime-env.spec.ts`:

```ts
import { buildRuntimeEnv, renderCliConfig } from './agent-runtime-env';

const base = { tenantId: 't1', provider: 'openrouter', authMode: 'apiKey', defaultModel: 'anthropic/claude-opus-4.6', baseUrl: null };

describe('buildRuntimeEnv', () => {
  it('apiKey provider sets the key env var + HERMES_HOME', () => {
    const { env, homeDir } = buildRuntimeEnv(base, 'sk-secret', '/data/hermes');
    expect(env.OPENROUTER_API_KEY).toBe('sk-secret');
    expect(env.HERMES_HOME).toBe('/data/hermes/t1');
  });
  it('login provider sets only HERMES_HOME (no key env)', () => {
    const { env } = buildRuntimeEnv({ ...base, provider: 'openai-codex', authMode: 'login' }, null, '/data/hermes');
    expect(env.HERMES_HOME).toBe('/data/hermes/t1');
    expect(Object.keys(env)).not.toContain('OPENROUTER_API_KEY');
  });
});

describe('renderCliConfig', () => {
  it('emits provider + default model', () => {
    const yaml = renderCliConfig(base);
    expect(yaml).toContain('openrouter');
    expect(yaml).toContain('anthropic/claude-opus-4.6');
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @pulsar/api test -- agent-runtime-env`

- [ ] **Step 3: Implement `agent-runtime-env.ts`** — pure functions using `getRuntimeProvider` from `@pulsar/shared`. `buildRuntimeEnv(config, decryptedKey, hermesHomeRoot)` → `{ env: Record<string,string>, homeDir }` where `homeDir = <root>/<tenantId>`, `env.HERMES_HOME = homeDir`, and for apiKey providers `env[provider.keyEnvVar] = decryptedKey` (custom also sets a base-url env if `baseUrl`). `renderCliConfig(config)` → a minimal YAML string (`model:\n  provider: <providerKey>\n  default: <defaultModel>` + `base_url` if set) per the VERIFIED format in `docs/agents-runtime-notes.md` (adjust keys to reality). No node-only deps beyond `node:path` (this file is API-side, node is fine here).

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Implement `runtime-config.service.ts`** — inject `PrismaService` + the existing `CryptoService` (grep its module/path: `grep -rn "class CryptoService" apps/api/src`). Methods:
  - `get(tenantId)` → the config row or null.
  - `project(config)` → public shape: `{ provider, authMode, defaultModel, baseUrl, hasApiKey: !!apiKeyEnc, connectedAt, lastTestAt, lastTestOk }` (NEVER apiKeyEnc).
  - `upsert(tenantId, { provider, authMode, apiKey?, defaultModel?, baseUrl? })` → if `apiKey` provided, `apiKeyEnc = crypto.encrypt(apiKey)`; upsert by `tenantId`.
  - `resolveForSpawn(tenantId)` → `{ config, decryptedKey: string | null }` (decrypts apiKeyEnc) — used by AgentRuntimeService. Throws `BadRequestException('Agent runtime not configured')` if no row.
  - `markConnected(tenantId)` / `markTested(tenantId, ok)`.
  - A `hermesHomeRoot()` getter → `path.join(process.cwd-ish repo root or env HERMES_HOME_ROOT, 'hermes-agent', '.hermes-home')` (use `process.env.HERMES_HOME_ROOT ?? <repo>/hermes-agent/.hermes-home`).

- [ ] **Step 6: Implement `runtime-install.ts`** — `venvPython()` returns the venv python path per-OS (`hermes-agent/.venv/Scripts/python.exe` on win32, `.../bin/python` else) and `isInstalled()` checks it exists (fs). Used for the "installed" status + as `HERMES_ACP_CMD`.

- [ ] **Step 7: Typecheck.** `pnpm --filter @pulsar/api typecheck`

- [ ] **Step 8: Commit**
```bash
git add apps/api/src/core/agents/agent-runtime-env.ts apps/api/src/core/agents/agent-runtime-env.spec.ts apps/api/src/core/agents/runtime-config.service.ts apps/api/src/core/agents/runtime-install.ts
git commit -m "feat(api): runtime config service (crypto) + env builder + install check"
```

---

## Task 5: RuntimeConfigController (REST + SSE connect/test)

**Files:** Create `runtime-config.controller.ts`.

- [ ] **Step 1: Implement** — `@Controller('agent-runtime')`, `@ApiBearerAuth`, all routes `@RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)`:
  - `GET /providers` → `RUNTIME_PROVIDERS` (from `@pulsar/shared`).
  - `GET /` → `{ ...runtimeConfig.project(get(tenantId)), installed: isInstalled() }` (null config → `{ installed, configured:false }`).
  - `PUT /` `{ provider, apiKey?, defaultModel?, baseUrl? }` → derive `authMode` from `getRuntimeProvider(provider)`; `upsert`. DTO class-validator.
  - `POST /test` → resolveForSpawn → build env (agent-runtime-env) → spawn the venv `python -m acp_adapter` (HermesAcpClient/AgentRuntimeService helper) → `initialize` + list models → `markTested(ok)` → `{ ok, models? , error? }`. Best-effort (catch → ok:false).
  - `POST /connect` (SSE, login providers) → spawn `<venvPython> -m hermes_cli ... <loginCommand>` (exact invocation per `docs/agents-runtime-notes.md`) in the tenant HERMES_HOME, stream stdout lines as `event: text`; on process exit success → `markConnected` + `event: end`; error → `event: error`. (Mirror the SSE pattern of `agent-conversations.controller.ts`.)

> NOTE: the exact spawn for `test` (reuse a small piece of `AgentRuntimeService`) and for `connect` (the `hermes <loginCommand>` invocation) come from Task 1's verified contract. If `AgentRuntimeService` doesn't expose a "test/open a bare session" helper, add a minimal `AgentRuntimeService.testConnection(tenantId)` in Task 6 and call it here.

- [ ] **Step 2: Typecheck.** `pnpm --filter @pulsar/api typecheck`

- [ ] **Step 3: Commit**
```bash
git add apps/api/src/core/agents/runtime-config.controller.ts
git commit -m "feat(api): agent-runtime REST + SSE (providers, config, test, login connect)"
```

---

## Task 6: Wire openSession to the real config + module

**Files:** Modify `agent-runtime.service.ts`, `agents.module.ts`.

- [ ] **Step 1: openSession uses real config** — read the current `agent-runtime.service.ts` (palier 2a). Inject `RuntimeConfigService`. In `openSession`, before spawning: `const { config, decryptedKey } = await this.runtimeConfig.resolveForSpawn(tenantId)` (tenantId derived from the agent — pass it into openSession; the conversations controller already has `user.tenantId`, thread it through `OpenSessionInput`). Build `{ env, homeDir }` via `buildRuntimeEnv`; ensure `homeDir` exists (mkdir -p); write `cli-config.yaml` into `homeDir` via `renderCliConfig`. Spawn `venvPython()` with `['-m','acp_adapter']`, `{ env: { ...process.env, ...env }, cwd: <hermes-agent> }`. If `!isInstalled()` → `BadRequestException('Run pnpm agents:setup')`. Add a `testConnection(tenantId)` method (open a session, list models, close) for the controller's `/test`.
  - Update `OpenSessionInput` to carry `tenantId`. Update the conversations controller (T10 palier 2a) call site to pass `user.tenantId`. (Read it; it currently passes `{agent, pulsarMcpUrl}` — add tenantId.)

- [ ] **Step 2: Module wiring** — add `RuntimeConfigService` to providers and `RuntimeConfigController` to controllers in `agents.module.ts`. CryptoService comes from its module — import it (grep the module that exports CryptoService; import it into AgentsModule).

- [ ] **Step 3: Build the API.** `pnpm --filter @pulsar/api build` (EPERM note).

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/core/agents/agent-runtime.service.ts apps/api/src/core/agents/agents.module.ts apps/api/src/core/agents/agent-conversations.controller.ts
git commit -m "feat(api): openSession injects the per-tenant runtime config; wire runtime module"
```

---

## Task 7: Web — Réglages → Runtime agents

**Files:** Create `apps/web/src/routes/(app)/settings/agent-runtime/+page.svelte`, `apps/web/src/lib/api/agent-runtime-connect.ts`; modify `+layout.svelte` (nav).

- [ ] **Step 1: Connect SSE client** — `agent-runtime-connect.ts`: a `streamRuntimeConnect()` async-gen mirroring `agent-stream.ts` (POST `/agent-runtime/connect`, reuse the auth token, parse `event:`/`data:` frames → `{type:'text'|'error'|'end', ...}`).

- [ ] **Step 2: The page** (mirror existing settings pages' `$state`/`api()`/UI idioms): load `GET /agent-runtime` + `GET /agent-runtime/providers`. Provider `Select` from the catalog. Conditional auth block: `apiKey` providers → password `Input` (show "configured" when `hasApiKey`); `login` providers → a "Connecter {label}" button that consumes `streamRuntimeConnect()` and shows the streamed code/URL lines + result. Default-model `Input`; base-URL `Input` only when the selected provider `needsBaseUrl`. "Tester la connexion" → `POST /agent-runtime/test`, show ok+models / error. "Enregistrer" → `PUT /agent-runtime`. Status banner: `installed` (else show the `pnpm agents:setup` hint), `configured`, `connectedAt`, `lastTestAt/Ok`. Errors → local string.

- [ ] **Step 3: Nav** — add `{ href: '/settings/agent-runtime', label: 'Runtime agents' }` to the Réglages group in `+layout.svelte` (next to Agents).

- [ ] **Step 4: Typecheck.** `pnpm --filter @pulsar/web typecheck` (0 errors).

- [ ] **Step 5: Commit**
```bash
git add "apps/web/src/routes/(app)/settings/agent-runtime/+page.svelte" "apps/web/src/lib/api/agent-runtime-connect.ts" "apps/web/src/routes/(app)/+layout.svelte"
git commit -m "feat(web): Agent runtime settings (provider, API key or OAuth login, test)"
```

---

## Task 8: E2E + unit verification (deterministic, fake Hermes)

**Files:** Create `apps/api/test/phase11r1-agent-runtime.e2e-spec.ts`; `test/support/fake-hermes` if needed.

- [ ] **Step 1: Reseed.** `pnpm db:seed`

- [ ] **Step 2: E2E** — login as admin; cover:
  - `GET /agent-runtime/providers` → contains openrouter (apiKey) + openai-codex (login).
  - `PUT /agent-runtime { provider:'openrouter', apiKey:'sk-test', defaultModel:'x' }` then `GET /agent-runtime` → `hasApiKey:true`, `provider:'openrouter'`, and the **raw key never appears** in the response body (assert the response JSON string does not contain `sk-test`). Confirm in DB the stored `apiKeyEnc` !== `'sk-test'` (encrypted).
  - `POST /agent-runtime/test` with `AgentRuntimeService` overridden to use the **fake ACP server** (palier 2a pattern) → asserts the build env passed to the fake contained `HERMES_HOME` + `OPENROUTER_API_KEY` (the fake records spawn env / session config), returns `{ ok:true, models:[...] }`, and `lastTestOk` persisted.
  - `openSession` path (via starting a conversation) with the runtime configured + fake ACP → succeeds (no 503), and without a config → 400 "not configured".
  - `connect` SSE: override the login spawn with a fake that emits a code line then exits 0 → stream yields a `text` then `end`, and `connectedAt` set. (For a login provider config.)
- Use the SSE frame parsing rigor from `phase11-agents`/`phase11b` specs.
- If a real bug in T2–T7 surfaces, STOP/BLOCKED — don't weaken.

- [ ] **Step 3: Run.**
```bash
pnpm --filter @pulsar/api test -- agent-runtime-env runtime-providers   # unit
pnpm --filter @pulsar/api test:e2e -- phase11r1-agent-runtime
```

- [ ] **Step 4: Commit**
```bash
git add apps/api/test/phase11r1-agent-runtime.e2e-spec.ts apps/api/test/support
git commit -m "test(api): agent-runtime config + spawn-env + connect (deterministic)"
```

---

## Task 9: Docs + full verification + push

**Files:** `.env.example`, `docs/agents.md`, `CLAUDE.md`, `docs/etat-du-projet.md`, `TODO.md`.

- [ ] **Step 1: Docs**
  - `.env.example`: add `HERMES_HOME_ROOT` (optional, default repo `hermes-agent/.hermes-home`) note; keep the palier-2a vars.
  - `docs/agents.md`: extend the palier-2a section — how to install (`pnpm agents:setup`) and configure the runtime in **Réglages → Runtime agents** (provider by API key OR login like Codex), then talk in ⌘K.
  - `CLAUDE.md`: note under rule 24 that the runtime is configured per-tenant in Pulsar (`AgentRuntimeConfig`, key encrypted via CryptoService), installed via `pnpm agents:setup`, providers come from the `@pulsar/shared` catalog.
  - `docs/etat-du-projet.md`: add the R1 line + 20th migration.
  - `TODO.md`: mark R1 done; deferred: R2 (rich agent UI: profile, activity view, guided config, first-class chat); the palier-2a deferred items still stand; per-tenant vs platform runtime config revisit if multi-operator.

- [ ] **Step 2: Full verification (build complet)**
```bash
pnpm db:seed
pnpm build
pnpm typecheck
pnpm test
pnpm test:e2e -- phase11r1-agent-runtime
pnpm test:e2e
```
All green (1 OSRM skip expected). WEB build must pass (runtime-providers is pure data — confirm no node import leaked into `@pulsar/shared`).

- [ ] **Step 3: Commit + push**
```bash
git add .env.example docs/agents.md CLAUDE.md docs/etat-du-projet.md TODO.md
git commit -m "docs: Pulsar-managed Hermes runtime (install + config UI) shipped"
git push origin phase-11
```

---

## Self-Review notes (executor)

- **Task 1 is gating**: prove `hermes-agent[acp]` installs + `python -m acp_adapter` runs on this machine, and document the real provider/login/cli-config contract. T2/T4/T5 reconcile to that doc (don't invent provider keys, env vars, or login commands).
- **Browser-safe**: `runtime-providers.ts` is pure data — no node imports (leçon palier 1, le build web).
- **Secrets**: API keys encrypted via CryptoService; never returned (projection `hasApiKey`); never logged. Login providers store OAuth tokens in the per-tenant HERMES_HOME, not in the DB.
- **Tenant isolation**: config + HERMES_HOME per tenant; resolveForSpawn keyed by the conversation's tenant.
- **Best-effort**: not-installed/not-configured/not-connected → clear 400s; Hermes failures → 503, never crash core Pulsar.
- **Deterministic tests**: real LLM/OAuth only behind HERMES_ENABLED (manual). CI uses the fake ACP + fake login spawn.
- **Scope**: R1 = runtime real + configurable. R2 (rich agent UI) is the documented next palier.
```
