# Agents-employés (phase 11, palier 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire vivre dans Pulsar des **agents-employés** (persona/rôle/modèle/autonomie) avec qui on converse via l'assistant **⌘K**, propulsés par le runtime **Hermes** (cerveau, sidecar Python) connecté en **ACP**, dont les actions repassent par la **file de gouvernance** du palier 1.

**Architecture:** Hermes = cerveau (sidecar), Pulsar = maison (UI + identité + outils MCP + gouvernance). Le backend Pulsar ouvre une **session ACP** par conversation (modèle + persona + serveur MCP de Pulsar + jeton d'agent court-vécu), streame la réponse en **SSE** vers le navigateur, et Hermes rappelle le `/mcp` de Pulsar **comme l'agent** → lectures live, mutations en file `ProposedAction` (ou `autoApprove` selon le niveau d'autonomie).

**Tech Stack:** NestJS 11 (Express), Prisma/PostgreSQL, `@modelcontextprotocol/sdk` (déjà là, palier 1), ACP (Agent Client Protocol — JSON-RPC vers le sidecar Hermes vendoré dans `hermes-agent/acp_adapter/`), SvelteKit (Svelte 5 runes, SSE), Jest + supertest (e2e contre un **faux serveur ACP**), Vitest (shared).

**Spec:** `docs/superpowers/specs/2026-06-13-agents-employes-palier2-design.md`

**Conventions à honorer (CLAUDE.md):** isolation tenant depuis le principal (règle 1) ; enums miroir `@pulsar/shared` ↔ `schema.prisma` (règle 3) ; apps importent Prisma via `@pulsar/database` (règle 4) ; `@RequirePermissions` sur chaque endpoint (règle 5) ; audit des mutations sensibles (règle 6, déjà couvert par l'exécution des `ProposedAction` du palier 1) ; rebuild `shared`/`database` après modif (règle 7) ; règles dures palier 11 (21–23). **Leçon palier 1 : lancer `pnpm build` complet — pas seulement `typecheck` — avant de déclarer vert (un import `node:crypto` au niveau module avait cassé le build web).**

---

## File Structure

**`packages/shared/src/agents/`** (étendu) :
- `autonomy.ts` (nouveau) — enum `AgentAutonomy` + helper pur `autoApprovedTiers(level)` ; tests `autonomy.spec.ts`.
- `permissions.ts` (modifié) — clé `AGENTS_CHAT`.
- re-export depuis `index.ts`.

**`packages/database/prisma/schema.prisma`** (modifié) — champs sur `Agent`, modèles `AgentConversation` + `AgentMessage`, enum `AgentAutonomy` ; 19ᵉ migration.

**`apps/api/src/core/agents/`** (étendu) :
- `agent-session-token.ts` (nouveau) — mint/verify d'un jeton de session signé court-vécu.
- `agents.service.ts` / `agents.controller.ts` (modifiés) — nouveaux champs + provisioning autonomie + mint de jeton.
- `agents.service.ts` `validateKey` (modifié) — accepte aussi un jeton de session → `AgentPrincipal`.
- `hermes-acp.client.ts` (nouveau) — transport ACP bas niveau vers le sidecar.
- `agent-runtime.service.ts` (nouveau) — pont : config session ⌘K ↔ ACP, flux d'événements normalisés.
- `agent-conversations.service.ts` (nouveau) — persistance `AgentConversation`/`AgentMessage`.
- `agent-conversations.controller.ts` (nouveau) — REST + endpoint SSE.
- `agents.module.ts` (modifié) — câblage des nouveaux providers/controllers + config connexion Hermes.

**`apps/api/test/`** :
- `support/fake-acp-server.ts` (nouveau) — faux serveur ACP déterministe pour les tests.
- `phase11b-agents-employes.e2e-spec.ts` (nouveau) — flux bout en bout.

**`apps/web/src/`** :
- `routes/(app)/settings/agents/+page.svelte` (modifié) — champs persona/rôle/modèle/autonomie/avatar.
- `lib/components/agents/AssistantPanel.svelte` (nouveau) — panneau de conversation ⌘K.
- `lib/api/agent-stream.ts` (nouveau) — client SSE pour le stream de conversation.
- branchement dans le slot ⌘K existant (`CommandPalette.svelte` / le shell phase 9).

**Infra/docs** : profil docker `agents` (sidecar Hermes) + `docs/agents.md` (section connexion interne) + note CLAUDE.md.

**Note de séquencement :** ce plan ne couvre que **2a**. Les déclencheurs proactifs (2b) et passerelles/mémoire (2c) sont hors scope.

---

## Task 1: ACP protocol spike — verify the real Hermes ACP wire contract

C'est le vrai inconnu du palier. Avant d'écrire le client ACP, on **documente le contrat réel** depuis le code vendoré (méthodes JSON-RPC, params de `session/new`, comment passer modèle + serveurs MCP + persona/system-prompt, modèle de connexion stdio vs socket, comment lancer le process). Cette tâche produit un **doc committé** qui pilote les Tasks 7–8. Aucune supposition non vérifiée ne doit survivre.

**Files:**
- Create: `docs/agents-acp-notes.md`

- [ ] **Step 1: Lire l'adaptateur ACP vendoré**

Lire et noter précisément :
- `hermes-agent/acp_adapter/server.py` — méthodes JSON-RPC supportées (chercher `initialize`, `session/new`, `session/prompt`, `session/update`, `session/set_model`, `session/cancel`, `session/request_permission`), et la forme de `NewSessionRequest`/`NewSessionResponse` (champs `cwd`, `mcpServers`, `model`, `systemPrompt`/instructions ?).
- `hermes-agent/acp_adapter/session.py` — `create_session(cwd)`, champ `model`, comment un system-prompt/persona est injecté (ou pas), comment les `mcp_server_names` sont attachés (fonction vue : toolsets à partir de `mcp_server_names`).
- `hermes-agent/acp_adapter/entry.py` / `__main__.py` — **comment on lance le serveur ACP** (commande exacte, ex. `hermes acp` / `python -m acp_adapter`), et **sur quel canal** (stdio JSON-RPC ? socket ?).
- `hermes-agent/acp_adapter/auth.py` + `permissions.py` — l'ACP exige-t-il une auth côté connexion ? comment les demandes de permission (`session/request_permission`) sont émises (on veut auto-répondre « allow » côté Pulsar puisque la gouvernance est dans le MCP).

Commandes utiles :
```bash
cd hermes-agent && grep -rniE "session/new|session/prompt|session/update|mcpServers|McpServer|set_model|system_prompt|instructions|request_permission" acp_adapter/ | head -60
grep -rniE "def main|argparse|stdio|read_message|jsonrpc|StdioServerParameters" acp_adapter/entry.py acp_adapter/__main__.py acp_adapter/server.py | head -40
```

- [ ] **Step 2: Écrire le doc de contrat**

Créer `docs/agents-acp-notes.md` avec, en clair et vérifié dans le code :
1. La **commande de lancement** du sidecar ACP (et le canal : stdio attendu).
2. La séquence d'**initialisation** (méthode `initialize`, version de protocole, capabilities).
3. Les **params exacts de `session/new`** : comment passer le **modèle**, les **serveurs MCP** (forme `McpServerSse` : `{name, url, headers}` ou stdio), et le **persona/system-prompt** (champ natif, sinon : injecter le persona comme **premier message `session/prompt`** — décider et noter).
4. Le format des **`session/update`** streamés (chunks de texte assistant, notifications d'appel d'outil) et de `session/request_permission` (et qu'on **auto-allow** côté Pulsar).
5. La forme de `session/prompt` (envoi d'un tour) et de sa réponse de fin de tour.

Si un élément n'existe pas (ex. pas de champ system-prompt natif), **documenter le contournement retenu** (persona en 1er prompt). Ce doc est la source de vérité des Tasks 7–8.

- [ ] **Step 3: Commit**

```bash
git add docs/agents-acp-notes.md
git commit -m "docs(agents): verified Hermes ACP wire contract (palier 2a spike)"
```

---

## Task 2: Shared — `AgentAutonomy` + pure autonomy→tiers helper

**Files:**
- Create: `packages/shared/src/agents/autonomy.ts`
- Test: `packages/shared/src/agents/autonomy.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/agents/autonomy.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AgentAutonomy, autoApprovedTiers } from './autonomy';
import { RiskTier } from './risk';

describe('autoApprovedTiers', () => {
  it('PROPOSE auto-approves nothing', () => {
    expect(autoApprovedTiers(AgentAutonomy.PROPOSE)).toEqual([]);
  });
  it('ACT_LOW auto-approves MUTATING only', () => {
    expect(autoApprovedTiers(AgentAutonomy.ACT_LOW)).toEqual([RiskTier.MUTATING]);
  });
  it('AUTONOMOUS auto-approves MUTATING and SENSITIVE', () => {
    expect(autoApprovedTiers(AgentAutonomy.AUTONOMOUS)).toEqual([
      RiskTier.MUTATING,
      RiskTier.SENSITIVE,
    ]);
  });
  it('never auto-approves READ/LOW explicitly (they run live anyway)', () => {
    for (const lvl of [AgentAutonomy.PROPOSE, AgentAutonomy.ACT_LOW, AgentAutonomy.AUTONOMOUS]) {
      expect(autoApprovedTiers(lvl)).not.toContain(RiskTier.READ);
      expect(autoApprovedTiers(lvl)).not.toContain(RiskTier.LOW);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- autonomy`
Expected: FAIL — `Cannot find module './autonomy'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/agents/autonomy.ts`:

```ts
import { RiskTier } from './risk';

// Mirrored in packages/database schema.prisma (Task 4 of the palier 2a plan).
/** Coarse autonomy dial for an employee-agent. Maps to which risk tiers auto-approve. */
export enum AgentAutonomy {
  PROPOSE = 'PROPOSE',
  ACT_LOW = 'ACT_LOW',
  AUTONOMOUS = 'AUTONOMOUS',
}

/**
 * Which MUTATING/SENSITIVE tiers a given autonomy level auto-approves.
 * READ/LOW are never listed — they execute live regardless (palier 1).
 * Caps (amount/rate) still bound auto-approved actions at execution time.
 */
export function autoApprovedTiers(level: AgentAutonomy): RiskTier[] {
  switch (level) {
    case AgentAutonomy.PROPOSE:
      return [];
    case AgentAutonomy.ACT_LOW:
      return [RiskTier.MUTATING];
    case AgentAutonomy.AUTONOMOUS:
      return [RiskTier.MUTATING, RiskTier.SENSITIVE];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pulsar/shared test -- autonomy`
Expected: PASS.

- [ ] **Step 5: Re-export + build**

Add to `packages/shared/src/index.ts` next to the `export * from './agents/risk';` line:

```ts
export * from './agents/autonomy';
```

Run: `pnpm --filter @pulsar/shared build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agents/autonomy.ts packages/shared/src/agents/autonomy.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): AgentAutonomy enum + autoApprovedTiers helper"
```

---

## Task 3: Shared — `agents.chat` permission

**Files:**
- Modify: `packages/shared/src/permissions.ts`

- [ ] **Step 1: Add the constant**

In `PERMISSIONS.CORE`, after `AGENTS_ACTIONS_APPROVE`:

```ts
    AGENTS_ACTIONS_APPROVE: 'core.agents.actions.approve',
    AGENTS_CHAT: 'core.agents.chat',
```

- [ ] **Step 2: Add the catalog entry**

After the `AGENTS_ACTIONS_APPROVE` `core(...)` row:

```ts
  core(PERMISSIONS.CORE.AGENTS_CHAT, 'Converse with AI agents (⌘K assistant)'),
```

(First READ `packages/shared/src/permissions.ts` to confirm the `core(...)` helper shape and the exact existing `AGENTS_*` rows — match them exactly; CORE keys use the `core.` prefix.)

- [ ] **Step 3: Build**

Run: `pnpm --filter @pulsar/shared build`
Expected: success; `ALL_PERMISSION_KEYS` now includes `core.agents.chat`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/permissions.ts
git commit -m "feat(shared): agents.chat permission"
```

---

## Task 4: DB — extend Agent + AgentConversation + AgentMessage + migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration under `packages/database/prisma/migrations/`

PostgreSQL est lancé (localhost:5432, DB `pulsar`, 18 migrations appliquées). Les scripts DB chargent l'env via `dotenv -e ../../.env`. La génération de migration doit être **non-interactive** (passer `--name`).

- [ ] **Step 1: Add the enum + fields + models**

Dans `packages/database/prisma/schema.prisma`. D'abord l'enum (valeurs identiques à `@pulsar/shared` `AgentAutonomy`, règle 3) :

```prisma
enum AgentAutonomy {
  PROPOSE
  ACT_LOW
  AUTONOMOUS
}
```

Ajouter au modèle `Agent` existant (lire le modèle d'abord pour insérer proprement parmi ses champs) :

```prisma
  persona       String?
  role          String?
  model         String?
  autonomyLevel AgentAutonomy @default(PROPOSE)
  avatar        String?
  conversations AgentConversation[]
```

Ajouter les deux modèles :

```prisma
model AgentConversation {
  id             String         @id @default(cuid())
  tenantId       String
  agentId        String
  userId         String
  hermesSessionId String?
  title          String?
  createdAt      DateTime       @default(now())

  tenant   Tenant         @relation(fields: [tenantId], references: [id])
  agent    Agent          @relation(fields: [agentId], references: [id])
  messages AgentMessage[]

  @@index([tenantId, agentId])
  @@map("agent_conversations")
}

model AgentMessage {
  id             String   @id @default(cuid())
  conversationId String
  role           String
  content        String
  proposalId     String?
  createdAt      DateTime @default(now())

  conversation AgentConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@map("agent_messages")
}
```

Ajouter la back-relation sur `Tenant` (parmi ses autres `X[]`) :

```prisma
  agentConversations AgentConversation[]
```

- [ ] **Step 2: Create + apply the migration**

Depuis la racine, non-interactif :

```bash
cd /c/Users/samol/IntebecProject/Pulsar/packages/database && pnpm exec dotenv -e ../../.env -- prisma migrate dev --name phase11b_agents_employes
```

Si Prisma signale un drift ou demande un reset → STOP, reporter BLOCKED (ne jamais reset la DB). La SQL doit créer l'enum `AgentAutonomy`, les 5 colonnes sur `agents`, les tables `agent_conversations`/`agent_messages`, leurs FK + index.

- [ ] **Step 3: Regenerate + build**

```bash
cd /c/Users/samol/IntebecProject/Pulsar && pnpm db:generate && pnpm --filter @pulsar/database build
```

Expected: client régénéré avec les nouveaux champs/modèles/enum. (Si EPERM Windows sur un fichier verrouillé par l'API compilée en cours, stopper UNIQUEMENT ce process node compilé et réessayer — jamais le watcher/web.)

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): Agent employee fields + AgentConversation/AgentMessage, 19th migration"
```

---

## Task 5: Agent session token — mint/verify + accept on /mcp

Un jeton court-vécu signé permet à Hermes (sidecar interne) de rappeler `/mcp` comme l'agent sans stocker/réutiliser la clé `ak_` (montrée une seule fois au palier 1). Le serveur `/mcp` doit résoudre **soit** une vraie clé `ak_`, **soit** ce jeton, vers le **même `AgentPrincipal`**.

**Files:**
- Create: `apps/api/src/core/agents/agent-session-token.ts`
- Test: `apps/api/src/core/agents/agent-session-token.spec.ts`
- Modify: `apps/api/src/core/agents/agents.service.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/core/agents/agent-session-token.spec.ts`:

```ts
import { mintAgentSessionToken, verifyAgentSessionToken } from './agent-session-token';

const SECRET = 'test-secret-please-change';

describe('agent session token', () => {
  it('round-trips agentId for a valid unexpired token', () => {
    const token = mintAgentSessionToken('agent_123', SECRET, 60, 1_000_000);
    const agentId = verifyAgentSessionToken(token, SECRET, 1_000_030);
    expect(agentId).toBe('agent_123');
  });
  it('rejects an expired token', () => {
    const token = mintAgentSessionToken('agent_123', SECRET, 60, 1_000_000);
    expect(verifyAgentSessionToken(token, SECRET, 1_000_061)).toBeNull();
  });
  it('rejects a tampered token', () => {
    const token = mintAgentSessionToken('agent_123', SECRET, 60, 1_000_000);
    expect(verifyAgentSessionToken(token + 'x', SECRET, 1_000_010)).toBeNull();
  });
  it('rejects a token signed with a different secret', () => {
    const token = mintAgentSessionToken('agent_123', SECRET, 60, 1_000_000);
    expect(verifyAgentSessionToken(token, 'other', 1_000_010)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/api test -- agent-session-token`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/core/agents/agent-session-token.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Prefix distinguishes session tokens from real `ak_` agent keys. */
const PREFIX = 'as_';

const b64u = (s: string | Buffer) =>
  Buffer.from(s).toString('base64url');

/**
 * Mint a short-lived signed session token for an agent.
 * Format: as_<base64url(agentId.expiresAtMs)>.<base64url(hmac)>
 * @param ttlSeconds lifetime; @param nowMs injectable clock for tests.
 */
export function mintAgentSessionToken(
  agentId: string,
  secret: string,
  ttlSeconds: number,
  nowMs: number = Date.now(),
): string {
  const expiresAt = nowMs + ttlSeconds * 1000;
  const payload = `${agentId}.${expiresAt}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${PREFIX}${b64u(payload)}.${sig}`;
}

/** Returns the agentId if the token is valid and unexpired, else null. */
export function verifyAgentSessionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): string | null {
  if (!token.startsWith(PREFIX)) return null;
  const body = token.slice(PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot < 0) return null;
  const payloadB64 = body.slice(0, dot);
  const sig = body.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const dotp = payload.lastIndexOf('.');
  const agentId = payload.slice(0, dotp);
  const expiresAt = Number(payload.slice(dotp + 1));
  if (!Number.isFinite(expiresAt) || nowMs > expiresAt) return null;
  return agentId || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pulsar/api test -- agent-session-token`
Expected: PASS.

- [ ] **Step 5: Wire mint + accept into AgentsService**

In `apps/api/src/core/agents/agents.service.ts`:
- Read the file first. It already has `validateKey(rawKey)`.
- Add a secret source: read `process.env.AGENT_SESSION_SECRET` with a fallback to `process.env.JWT_SECRET` (confirm `JWT_SECRET` exists by grepping `apps/api/src` / `.env.example`; use whatever the app uses for signing). Store it as a private readonly resolved in the constructor or a getter.
- Add method:

```ts
mintSessionToken(agentId: string, ttlSeconds = 300): string {
  return mintAgentSessionToken(agentId, this.sessionSecret, ttlSeconds);
}
```

- Modify `validateKey(rawKey)` so that, **before** the existing `findUnique({ where: { secretHash } })`, it checks for a session token:

```ts
const sessionAgentId = verifyAgentSessionToken(rawKey, this.sessionSecret);
const agent = sessionAgentId
  ? await this.prisma.agent.findUnique({ where: { id: sessionAgentId } })
  : await this.prisma.agent.findUnique({ where: { secretHash: sha256(rawKey) } });
```

Keep the rest of `validateKey` identical (revoked check, lastUsedAt, principal build). Add the imports `import { mintAgentSessionToken, verifyAgentSessionToken } from './agent-session-token';`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/core/agents/agent-session-token.ts apps/api/src/core/agents/agent-session-token.spec.ts apps/api/src/core/agents/agents.service.ts
git commit -m "feat(api): short-lived agent session token accepted by /mcp"
```

---

## Task 6: Extend AgentsService.create/update + DTO with employee fields + autonomy provisioning

**Files:**
- Modify: `apps/api/src/core/agents/agents.service.ts`
- Modify: `apps/api/src/core/agents/agents.controller.ts`

- [ ] **Step 1: Extend the create/update input + autonomy→autoApprove**

In `agents.service.ts`:
- Read the current `create()` and `agentSelect`. Add `persona`, `role`, `model`, `autonomyLevel`, `avatar` to `agentSelect` and to the `create` data.
- Extend the `create` input type to include `persona?`, `role?`, `model?`, `autonomyLevel?: AgentAutonomy`, `avatar?`.
- When persisting, **derive `caps.autoApprove`** from `autonomyLevel` using the tool registry tiers: import `TOOL_REGISTRY` and `autoApprovedTiers`; compute the tool names whose tier is in `autoApprovedTiers(level)` and union with any explicit `caps.autoApprove` passed in. Helper:

```ts
private applyAutonomy(level: AgentAutonomy | undefined, caps: AgentCaps): AgentCaps {
  const tiers = autoApprovedTiers(level ?? AgentAutonomy.PROPOSE);
  const byTier = TOOL_REGISTRY.filter((t) => tiers.includes(t.tier)).map((t) => t.name);
  const explicit = caps.autoApprove ?? [];
  return { ...caps, autoApprove: Array.from(new Set([...byTier, ...explicit])) };
}
```

Use it in `create` (and add an `update` method if one doesn't exist — mirror `create`'s validation/shape) so `caps` stored already reflects the autonomy level. Imports: `import { AgentAutonomy, autoApprovedTiers } from '@pulsar/shared';` and `import { TOOL_REGISTRY } from './tool-registry';`.

- [ ] **Step 2: Extend the DTO + add update endpoint**

In `agents.controller.ts`, extend `CreateAgentDto` with optional fields:

```ts
  @IsOptional() @IsString() persona?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsEnum(AgentAutonomy) autonomyLevel?: AgentAutonomy;
  @IsOptional() @IsString() avatar?: string;
```

Add `import { AgentAutonomy } from '@pulsar/shared';` and `IsEnum` to the class-validator import. If no `PATCH :id` exists, add one gated by `@RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)` using `PartialType(CreateAgentDto)` (mirror how other controllers do updates with `@nestjs/swagger` `PartialType`) calling a new `agents.update(tenantId, id, dto)`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/core/agents/agents.service.ts apps/api/src/core/agents/agents.controller.ts
git commit -m "feat(api): employee-agent fields + autonomy→autoApprove provisioning"
```

---

## Task 7: HermesAcpClient — ACP transport (tested against a fake ACP server)

Implémenter le client ACP **selon le contrat vérifié en Task 1** (`docs/agents-acp-notes.md`). Le code ci-dessous est la forme attendue ; **réconcilier les noms de méthodes/params exacts avec le doc de Task 1** (comme on a réconcilié les services TMS au palier 1 — adapter ICI, pas inventer).

**Files:**
- Create: `apps/api/src/core/agents/hermes-acp.client.ts`
- Create: `apps/api/test/support/fake-acp-server.ts`
- Test: `apps/api/src/core/agents/hermes-acp.client.spec.ts`

- [ ] **Step 1: Build the fake ACP server (test support)**

Create `apps/api/test/support/fake-acp-server.ts` — a deterministic in-process stand-in speaking the JSON-RPC subset over a pair of streams (Node `Readable`/`Writable` or a child process simulating stdio). It must: respond to `initialize`; `session/new` → return a `sessionId`, record the passed `model` + `mcpServers`; `session/prompt` → emit a scripted sequence of `session/update` notifications (one assistant text chunk, optionally one tool-call notice) then a final result. Expose hooks to assert what config it received and to script the prompt response. Match the EXACT method names/shapes from `docs/agents-acp-notes.md`.

```ts
// Shape (adapt method names/params to docs/agents-acp-notes.md):
export interface FakeAcpScript {
  assistantText?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
}
export class FakeAcpServer {
  lastNewSession?: { model?: string; mcpServers?: unknown };
  script: FakeAcpScript = { assistantText: 'ok' };
  // wire a duplex JSON-RPC loop that the client connects to
  // handle('initialize'), handle('session/new'), handle('session/prompt')
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/core/agents/hermes-acp.client.spec.ts`:

```ts
import { HermesAcpClient } from './hermes-acp.client';
import { FakeAcpServer } from '../../../test/support/fake-acp-server';

describe('HermesAcpClient', () => {
  it('initializes, opens a session with model + mcpServers, and streams a prompt', async () => {
    const fake = new FakeAcpServer();
    fake.script = { assistantText: 'Bonjour', toolCall: { name: 'get_load', args: { loadId: 'L1' } } };
    const client = new HermesAcpClient(fake.duplex()); // or spawn-config in real use
    await client.initialize();
    const session = await client.newSession({
      model: 'claude-sonnet-4-6',
      mcpServers: [{ name: 'pulsar', url: 'http://localhost:3000/api/v1/mcp', headers: { 'X-Agent-Key': 'as_x' } }],
    });
    expect(fake.lastNewSession?.model).toBe('claude-sonnet-4-6');
    const events: string[] = [];
    for await (const ev of client.prompt(session.sessionId, 'où est L1 ?')) {
      events.push(ev.type);
    }
    expect(events).toContain('text');
    expect(events).toContain('tool_call');
    expect(events.at(-1)).toBe('end');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @pulsar/api test -- hermes-acp.client`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the client**

Create `apps/api/src/core/agents/hermes-acp.client.ts` — a thin JSON-RPC client over the transport from Task 1 (stdio of a spawned `hermes acp` process in production; an injected duplex in tests). Public surface:

```ts
export interface AcpMcpServer { name: string; url: string; headers?: Record<string, string>; }
export interface AcpNewSession { model?: string; mcpServers?: AcpMcpServer[]; systemPrompt?: string; cwd?: string; }
export type AcpEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'error'; message: string }
  | { type: 'end' };

export class HermesAcpClient {
  constructor(private readonly transport: { write(line: string): void; lines: AsyncIterable<string> }) {}
  async initialize(): Promise<void> { /* JSON-RPC 'initialize' per Task 1 */ }
  async newSession(cfg: AcpNewSession): Promise<{ sessionId: string }> { /* 'session/new' */ }
  async *prompt(sessionId: string, text: string): AsyncGenerator<AcpEvent> { /* 'session/prompt' → map session/update → AcpEvent; auto-allow request_permission */ }
  async closeSession(sessionId: string): Promise<void> { /* 'session/cancel' or close */ }
}
```

Implement JSON-RPC framing (id correlation, newline-delimited JSON per ACP/stdio) and map `session/update` notifications to `AcpEvent`. Auto-respond "allow" to any `session/request_permission` (governance lives in MCP, not ACP). **Use the exact method names/param shapes recorded in `docs/agents-acp-notes.md`.**

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @pulsar/api test -- hermes-acp.client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/agents/hermes-acp.client.ts apps/api/test/support/fake-acp-server.ts apps/api/src/core/agents/hermes-acp.client.spec.ts
git commit -m "feat(api): HermesAcpClient ACP transport + fake ACP server for tests"
```

---

## Task 8: AgentRuntimeService — bridge Agent config ↔ ACP session

**Files:**
- Create: `apps/api/src/core/agents/agent-runtime.service.ts`

- [ ] **Step 1: Implement the bridge**

Create `apps/api/src/core/agents/agent-runtime.service.ts`:

**Topologie révisée au spike (Task 1) : UN process Hermes ACP PAR conversation** (l'enregistrement MCP d'Hermes est global au process → isolation tenant impossible en process partagé). On spawn `python -m acp_adapter` (stdio) à `openSession`, on garde une `Map<hermesSessionId → {client, child}>`, on tue le child à `closeSession`. **Pas de modèle au `session/new`** (on appelle `setModel` après si l'agent a un `model` préféré) ; **pas de persona natif** → on retourne le persona pour que le contrôleur l'injecte comme 1er tour (ou `AgentRuntime` l'injecte au 1er `sendTurn`). En-têtes MCP = **tableau** `[{name, value}]`.

```ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { HermesAcpClient, type AcpEvent } from './hermes-acp.client';
import { AgentsService } from './agents.service';

interface OpenSessionInput {
  agent: { id: string; model: string | null; persona: string | null };
  pulsarMcpUrl: string; // process.env.PULSAR_MCP_URL ?? 'http://localhost:3000/api/v1/mcp'
}

interface Live { client: HermesAcpClient; child: ChildProcessWithoutNullStreams; persona: string | null; firstTurnDone: boolean; }

@Injectable()
export class AgentRuntimeService {
  // ONE Hermes process PER conversation (isolation — spike finding). Keyed by hermes sessionId.
  private readonly live = new Map<string, Live>();

  constructor(private readonly agents: AgentsService) {}

  /** Spawns a dedicated Hermes ACP process, opens a session scoped to this agent. */
  async openSession(input: OpenSessionInput): Promise<string> {
    let child: ChildProcessWithoutNullStreams;
    try {
      // Exact command from docs/agents-acp-notes.md (e.g. `python -m acp_adapter`).
      child = spawn(process.env.HERMES_ACP_CMD ?? 'python', ['-m', 'acp_adapter'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      throw new ServiceUnavailableException('Agent runtime (Hermes) unavailable');
    }
    try {
      const client = new HermesAcpClient(HermesAcpClient.stdioTransport(child));
      await client.initialize();
      const token = this.agents.mintSessionToken(input.agent.id, 300);
      const { sessionId } = await client.newSession({
        cwd: process.cwd(),
        mcpServers: [
          { name: 'pulsar', url: input.pulsarMcpUrl, headers: [{ name: 'X-Agent-Key', value: token }] },
        ],
      });
      if (input.agent.model) await client.setModel(sessionId, input.agent.model).catch(() => undefined);
      this.live.set(sessionId, { client, child, persona: input.agent.persona, firstTurnDone: false });
      return sessionId;
    } catch (err) {
      child.kill();
      throw new ServiceUnavailableException('Agent runtime (Hermes) session failed');
    }
  }

  /** Streams normalized events for one user turn. Injects persona on the first turn. */
  async *sendTurn(sessionId: string, text: string): AsyncGenerator<AcpEvent> {
    const l = this.live.get(sessionId);
    if (!l) throw new ServiceUnavailableException('Conversation session not live');
    const prompt = !l.firstTurnDone && l.persona ? `${l.persona}\n\n---\n\n${text}` : text;
    l.firstTurnDone = true;
    yield* l.client.prompt(sessionId, prompt);
  }

  async closeSession(sessionId: string): Promise<void> {
    const l = this.live.get(sessionId);
    if (!l) return;
    this.live.delete(sessionId);
    await l.client.closeSession(sessionId).catch(() => undefined);
    l.child.kill();
  }
}
```

> NOTE implémenteur : `HermesAcpClient.stdioTransport(child)` (Task 7) adapte stdin/stdout du child en `{write, lines}`. Réconcilier la commande de spawn, le framing et les noms de méthodes avec `docs/agents-acp-notes.md`. Best-effort : tout échec de spawn/session → `ServiceUnavailableException` (l'API la traduit en 503), jamais de crash du cœur Pulsar. Limiter le nombre de process concurrents est un durcissement noté en TODO (hors 2a).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes (module wired in Task 11).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/core/agents/agent-runtime.service.ts
git commit -m "feat(api): AgentRuntimeService bridges agent config to an ACP session"
```

---

## Task 9: AgentConversationsService — persistence

**Files:**
- Create: `apps/api/src/core/agents/agent-conversations.service.ts`

- [ ] **Step 1: Implement**

Create `apps/api/src/core/agents/agent-conversations.service.ts`:

```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AgentConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async start(tenantId: string, userId: string, agentId: string, hermesSessionId: string, title?: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.prisma.agentConversation.create({
      data: { tenantId, userId, agentId, hermesSessionId, title },
    });
  }

  async get(tenantId: string, id: string) {
    const conv = await this.prisma.agentConversation.findFirst({
      where: { id, tenantId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    return conv;
  }

  list(tenantId: string, userId: string) {
    return this.prisma.agentConversation.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, agentId: true, title: true, createdAt: true },
    });
  }

  addMessage(conversationId: string, role: 'user' | 'assistant' | 'tool', content: string, proposalId?: string) {
    return this.prisma.agentMessage.create({
      data: { conversationId, role, content, proposalId },
    });
  }

  /** Tenant-scoped guard used before streaming a turn. */
  async assertOwned(tenantId: string, userId: string, id: string) {
    const conv = await this.prisma.agentConversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== userId) throw new ForbiddenException('Not your conversation');
    return conv;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/core/agents/agent-conversations.service.ts
git commit -m "feat(api): AgentConversationsService persistence"
```

---

## Task 10: AgentConversationsController — REST + SSE turn endpoint

**Files:**
- Create: `apps/api/src/core/agents/agent-conversations.controller.ts`

- [ ] **Step 1: Implement**

Create `apps/api/src/core/agents/agent-conversations.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentsService } from './agents.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentConversationsService } from './agent-conversations.service';

class StartDto { @IsString() agentId!: string; }
class TurnDto { @IsString() text!: string; }

const PULSAR_MCP_URL = process.env.PULSAR_MCP_URL ?? 'http://localhost:3000/api/v1/mcp';

@ApiTags('core/agent-conversations')
@ApiBearerAuth()
@Controller('agent-conversations')
export class AgentConversationsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly runtime: AgentRuntimeService,
    private readonly conversations: AgentConversationsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  list(@CurrentUser() user: AuthUser) {
    return this.conversations.list(user.tenantId, user.id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  async start(@CurrentUser() user: AuthUser, @Body() dto: StartDto) {
    const agent = await this.agents.getOwned(user.tenantId, dto.agentId); // add a tenant-scoped getter returning {id, model, persona,...}
    const sessionId = await this.runtime.openSession({ agent, pulsarMcpUrl: PULSAR_MCP_URL });
    return this.conversations.start(user.tenantId, user.id, dto.agentId, sessionId);
  }

  @Post(':id/messages')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  async turn(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TurnDto, @Res() res: Response) {
    const conv = await this.conversations.assertOwned(user.tenantId, user.id, id);
    await this.conversations.addMessage(conv.id, 'user', dto.text);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    let assistantText = '';
    try {
      for await (const ev of this.runtime.sendTurn(conv.hermesSessionId!, dto.text)) {
        if (ev.type === 'text') { assistantText += ev.text; send('text', { text: ev.text }); }
        else if (ev.type === 'tool_call') { send('tool_call', { name: ev.name, args: ev.args }); }
        else if (ev.type === 'error') { send('error', { message: ev.message }); }
        else if (ev.type === 'end') { send('end', {}); }
      }
      if (assistantText) await this.conversations.addMessage(conv.id, 'assistant', assistantText);
    } catch (err) {
      send('error', { message: 'Agent runtime error' });
    } finally {
      res.end();
    }
  }
}
```

> NOTE: add `getOwned(tenantId, id)` to `AgentsService` (tenant-scoped `findFirst` selecting `id, model, persona, status`), throwing NotFound if missing/REVOKED. The `tool_call` → proposalId correlation (persisting a `tool` message with `proposalId`) can be enriched once the ACP tool-result carries the queued proposalId; for 2a, persisting the `tool_call` name is sufficient — note this in TODO.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes once `getOwned` exists.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/core/agents/agent-conversations.controller.ts apps/api/src/core/agents/agents.service.ts
git commit -m "feat(api): agent-conversations REST + SSE turn endpoint"
```

---

## Task 11: Wire into AgentsModule

**Files:**
- Modify: `apps/api/src/core/agents/agents.module.ts`

- [ ] **Step 1: Register providers + controller**

In `agents.module.ts` (read it first — palier 1 wired it): add to `providers`: `AgentRuntimeService`, `AgentConversationsService`. Add to `controllers`: `AgentConversationsController`. Keep the existing palier-1 wiring intact. `HermesAcpClient` is constructed by `AgentRuntimeService` (not a provider) unless you prefer a factory; keep it internal for now.

- [ ] **Step 2: Build the API**

Run: `pnpm --filter @pulsar/api build`
Expected: builds (handle EPERM per Task 4 note if needed).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/core/agents/agents.module.ts
git commit -m "feat(api): wire AgentRuntime + AgentConversations into AgentsModule"
```

---

## Task 12: E2E — deterministic governance-through-conversation flow (fake ACP)

**Files:**
- Create: `apps/api/test/phase11b-agents-employes.e2e-spec.ts`

Injecte le **faux serveur ACP** (Task 7) à la place du vrai sidecar : surcharge `AgentRuntimeService.connect()` via le DI override de NestJS testing (`overrideProvider(AgentRuntimeService).useValue(...)` ou injecter un `HermesAcpClient` fake). Reseed d'abord pour les permissions.

- [ ] **Step 1: Reseed**

Run: `pnpm db:seed` (admin obtient `core.agents.chat`).

- [ ] **Step 2: Write the e2e**

Create `apps/api/test/phase11b-agents-employes.e2e-spec.ts` covering:
- login (`{ email, password, tenant: 'acme' }`, expect 200 — mirror `phase11-agents.e2e-spec.ts`).
- register an employee-agent via `POST /agents` with `autonomyLevel: 'PROPOSE'`, planning permissions, persona/role/model.
- `POST /agent-conversations { agentId }` → 201, returns conversation with `hermesSessionId`.
- assert the fake ACP server received `model` and an `mcpServers` entry pointing at `/mcp` with an `X-Agent-Key` header that starts with `as_`.
- `POST /agent-conversations/:id/messages { text }` with the fake scripted to emit a `create_load` tool call → consume the SSE stream; assert a `tool_call` event arrived AND a `ProposedAction` row was created (governance reached through the bridge) AND the load table did NOT grow.
- script the fake with `autonomyLevel: 'AUTONOMOUS'` agent for a MUTATING tool → assert it executed live (no new PENDING proposal) but a cap breach (amount over `maxAmountPerAction`) is rejected.
- assert `AgentConversation` + `AgentMessage` rows persisted (user + assistant).

Use supertest; for SSE, read `res.text` and split on `\n\n` to parse `event:`/`data:` frames (or use a small helper). Mirror the parsing rigor of `phase11-agents.e2e-spec.ts`'s `parseMcp`.

- [ ] **Step 3: Run**

Run: `pnpm --filter @pulsar/api test:e2e -- phase11b-agents-employes`
Expected: all pass. If a real bug in Tasks 5–11 surfaces, STOP and report it (don't weaken assertions).

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/phase11b-agents-employes.e2e-spec.ts
git commit -m "test(api): phase 11b e2e — conversation→governance flow against fake ACP"
```

---

## Task 13: Web — extend Réglages → Agents with employee fields

**Files:**
- Modify: `apps/web/src/routes/(app)/settings/agents/+page.svelte`

- [ ] **Step 1: Add the fields**

Read the existing page (palier 1, Task 12). Add to the register/edit form: `persona` (textarea), `role` (Input), `model` (Input or select — free text is fine per spec), `autonomyLevel` (radio: PROPOSE / ACT_LOW / AUTONOMOUS with helper text), `avatar` (Input, emoji). Include them in the `POST /agents` body. Show `role` + `avatar` in the list rows. Mirror the page's existing `$state`/`api()`/Modal idioms exactly.

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/routes/(app)/settings/agents/+page.svelte"
git commit -m "feat(web): employee-agent fields (persona/role/model/autonomy/avatar)"
```

---

## Task 14: Web — ⌘K assistant panel + SSE client

**Files:**
- Create: `apps/web/src/lib/api/agent-stream.ts`
- Create: `apps/web/src/lib/components/agents/AssistantPanel.svelte`
- Modify: the command-palette/shell slot (`apps/web/src/lib/components/ui/CommandPalette.svelte` or the phase-9 shell — read it first to find the reserved assistant slot)

- [ ] **Step 1: SSE client helper**

Create `apps/web/src/lib/api/agent-stream.ts`: a function that POSTs to `/agent-conversations/:id/messages` with the auth header (reuse the `api` client's token source) and yields parsed SSE events (`text`/`tool_call`/`error`/`end`) via a `ReadableStream`/`fetch` + `TextDecoder` loop. (Confirm how `$lib/api/client` attaches the bearer token; reuse it.)

- [ ] **Step 2: AssistantPanel component**

Create `apps/web/src/lib/components/agents/AssistantPanel.svelte`: agent picker (fetch `GET /agents`, list ACTIVE with `avatar`+`role`), a conversation view ($state messages), an input; on submit → `POST /agent-conversations` (if no active conversation) then stream the turn, appending streamed text and rendering a **proposed-action card** for each `tool_call` event (with a link to `/agent-actions`). Mirror the project's UI components/idioms.

- [ ] **Step 3: Mount in the ⌘K slot**

Wire `AssistantPanel` into the reserved assistant slot of the command palette / shell (phase 9). Gate visibility on the user having `core.agents.chat` (mirror the layout's permission-derive pattern from palier 1 Task 13).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/lib/api/agent-stream.ts" "apps/web/src/lib/components/agents/AssistantPanel.svelte" apps/web/src/lib/components/ui/CommandPalette.svelte
git commit -m "feat(web): ⌘K assistant panel with streaming conversation + proposed-action cards"
```

---

## Task 15: Infra + docs + full verification + PR

**Files:**
- Modify: `docker-compose.yml` (profil `agents`)
- Modify: `docs/agents.md`, `CLAUDE.md`, `docs/etat-du-projet.md`, `TODO.md`
- Modify: `.env.example`

- [ ] **Step 1: Hermes sidecar docker profile**

Add an `agents`-profiled service to `docker-compose.yml` running the Hermes ACP sidecar (image/build per `hermes-agent/`), opt-in like the `osrm` profile (phase 10 — mirror that profile's structure). Add env to `.env.example`: `AGENT_SESSION_SECRET`, `PULSAR_MCP_URL`, the model-provider key(s) Hermes needs, and `HERMES_ENABLED` (for the conditional smoke test). Document the launch in `docs/agents.md` (a new "Agents-employés (palier 2a)" section: how to start the sidecar, configure an employee, talk to it in ⌘K).

- [ ] **Step 2: Docs**

- `CLAUDE.md`: add a phase-11-palier-2 note (agents-employés via Hermes ACP; config in Pulsar; conversation actions still flow through the palier-1 queue; Hermes is best-effort/isolated).
- `docs/etat-du-projet.md`: add a palier-2a row + update chiffres (19 migrations, new endpoints).
- `TODO.md`: mark palier-2a items done; add deferred (`tool_call`→proposalId correlation in SSE; 2b triggers; 2c gateways+memory; one-Hermes-per-agent for memory isolation).

- [ ] **Step 3: Full verification (build complet — leçon palier 1)**

```bash
pnpm db:seed
pnpm build          # shared → database → api → web (handle EPERM per Task 4)
pnpm typecheck
pnpm test           # incl. autonomy.spec + agent-session-token.spec + hermes-acp.client.spec
pnpm test:e2e -- phase11b-agents-employes
pnpm test:e2e       # full regression — confirm no phase-11 break (1 env-skip OSRM expected)
```
Expected: all green. Le build **web** doit passer (vérifier qu'aucun import node-only ne fuit dans `@pulsar/shared`).

- [ ] **Step 4: Commit docs + push**

```bash
git add docker-compose.yml .env.example docs/agents.md CLAUDE.md docs/etat-du-projet.md TODO.md
git commit -m "docs+infra: phase 11 palier 2a shipped — agents-employés (Hermes ACP sidecar)"
git push origin phase-11
```

- [ ] **Step 5: PR**

Si `gh` indisponible : ouvrir via `https://github.com/SamChampagne/Pulsar/pull/new/phase-11` (ou cibler une branche `phase-11-palier2` si Sam préfère isoler — lui demander).

---

## Self-Review notes (for the executor)

- **Task 1 est obligatoire et bloquante** : le contrat ACP réel (méthodes, params `session/new`, canal stdio, injection persona) pilote les Tasks 7–8. Ne pas écrire le client avant d'avoir le doc.
- **Réconcilier, ne pas inventer** : comme au palier 1 (signatures TMS), les noms/params ACP du code des Tasks 7–8 sont la *forme attendue* — les aligner sur `docs/agents-acp-notes.md`.
- **Gouvernance préservée** : la conversation n'exécute jamais une mutation directement ; Hermes appelle `/mcp` → file `ProposedAction` (sauf `autoApprove` dérivé du niveau d'autonomie), toujours borné par les `caps` (règles dures 21–23).
- **Best-effort** : sidecar absent ⇒ 503 propre, jamais de crash du cœur Pulsar (posture OSRM phase 10).
- **Build complet avant vert** (leçon palier 1).
- **Couverture spec** : persona/rôle/modèle/autonomie/avatar (T4/T6/T13), conversations persistées (T4/T9), ⌘K (T14), jeton de session (T5), ACP bridge (T7/T8/T10), gouvernance réutilisée (T5 `/mcp`), tests stub ACP + smoke conditionnel (T12/T15), permission `agents.chat` (T3). 2b/2c explicitement hors scope.
```
