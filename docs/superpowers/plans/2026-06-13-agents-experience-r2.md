# Expérience agents-employés (R2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Faire des agents des employés de premier plan : roster `/agents`, profil `/agents/[id]` (config guidée + aide inline + presets de rôle), vue d'activité (« ce qu'ils font »), et chat pour parler à un employé.

**Architecture:** Backend minimal (2 endpoints de lecture + un catalogue de presets shared) ; l'essentiel est l'UI (Svelte 5). On lit l'existant (`Agent`, `AgentConversation`, `ProposedAction`).

**Tech Stack:** NestJS, Prisma, SvelteKit (Svelte 5 runes, SSE via le client agent-stream existant), Vitest, Jest+supertest.

**Spec:** `docs/superpowers/specs/2026-06-13-agents-experience-r2-design.md`

**Conventions:** isolation tenant (r1) ; `@RequirePermissions(core.agents.read)` (r5) ; presets shared = pure data browser-safe ; `pnpm build` complet avant vert ; mêmes idiomes UI que les pages existantes.

---

## Task 1: Backend — agent detail + activity + role presets

**Files:** `packages/shared/src/agents/role-presets.ts` (+`.spec.ts`, re-export) ; `apps/api/src/core/agents/agents.service.ts` (modif) ; `apps/api/src/core/agents/agents.controller.ts` (modif) ; e2e in Task — covered by R2-T5 e2e, but add the endpoints here.

- [ ] **Step 1 (TDD shared): role presets** — `role-presets.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { AGENT_ROLE_PRESETS } from './role-presets';
import { AgentAutonomy } from './autonomy';
import { ALL_PERMISSION_KEYS } from '../permissions';

describe('AGENT_ROLE_PRESETS', () => {
  it('each preset has persona, valid permissions, valid autonomy', () => {
    const valid = new Set(ALL_PERMISSION_KEYS);
    for (const p of AGENT_ROLE_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.persona.length).toBeGreaterThan(0);
      expect(Object.values(AgentAutonomy)).toContain(p.suggestedAutonomy);
      for (const k of p.suggestedPermissions) expect(valid.has(k)).toBe(true);
    }
  });
  it('ids unique', () => {
    const ids = AGENT_ROLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```
Run → fail: `pnpm --filter @pulsar/shared test -- role-presets`.

- [ ] **Step 2: implement `role-presets.ts`** (pure data, no node imports). Use real permission keys (grep `PERMISSIONS.TRANSPORTATION` values) + `AgentAutonomy`:
```ts
import { AgentAutonomy } from './autonomy';
export interface AgentRolePreset { id: string; label: string; persona: string; suggestedPermissions: string[]; suggestedAutonomy: AgentAutonomy; }
export const AGENT_ROLE_PRESETS: AgentRolePreset[] = [
  { id: 'dispatcher', label: 'Répartiteur', persona: 'Tu es un répartiteur logistique...', suggestedPermissions: ['transportation.orders.read','transportation.planning.read','transportation.planning.manage'], suggestedAutonomy: AgentAutonomy.PROPOSE },
  { id: 'billing-clerk', label: 'Commis facturation', persona: 'Tu es un commis à la facturation...', suggestedPermissions: ['transportation.orders.read','transportation.analytics.read'], suggestedAutonomy: AgentAutonomy.PROPOSE },
  { id: 'analyst', label: 'Analyste', persona: 'Tu es un analyste des opérations...', suggestedPermissions: ['transportation.orders.read','transportation.planning.read','transportation.analytics.read'], suggestedAutonomy: AgentAutonomy.PROPOSE },
];
```
(Verify the permission key strings exist via `ALL_PERMISSION_KEYS`; adjust to real values. Personas: 1-2 sentences FR each.) Run → pass. Add `export * from './agents/role-presets';` to `index.ts`; `pnpm --filter @pulsar/shared build`.

- [ ] **Step 3: AgentsService.getOne + activity** — read `agents.service.ts`. Add:
```ts
async getOne(tenantId: string, id: string) {
  const agent = await this.prisma.agent.findFirst({ where: { id, tenantId }, select: agentSelect });
  if (!agent) throw new NotFoundException('Agent not found');
  return agent;
}
async activity(tenantId: string, id: string) {
  await this.getOne(tenantId, id); // 404/tenant guard
  const [conversations, proposedActions] = await Promise.all([
    this.prisma.agentConversation.findMany({ where: { tenantId, agentId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, title: true, createdAt: true, _count: { select: { messages: true } } } }),
    this.prisma.proposedAction.findMany({ where: { tenantId, agentId: id }, orderBy: { proposedAt: 'desc' }, take: 50, select: { id: true, tool: true, status: true, riskTier: true, proposedAt: true, decidedAt: true } }),
  ]);
  const stats = {
    conversations: conversations.length,
    pending: proposedActions.filter((p) => p.status === 'PENDING').length,
    executed: proposedActions.filter((p) => p.status === 'EXECUTED').length,
    rejected: proposedActions.filter((p) => p.status === 'REJECTED').length,
  };
  return { conversations: conversations.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, messageCount: c._count.messages })), proposedActions, stats };
}
```
(Confirm `agentSelect` includes role/avatar/model/autonomyLevel/persona — added in palier 2a; if not, add them. Confirm `ProposalStatus` string values.)

- [ ] **Step 4: AgentsController routes** — add (perm `core.agents.read`):
```ts
@Get(':id') @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.agents.getOne(user.tenantId, id); }
@Get(':id/activity') @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
activity(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.agents.activity(user.tenantId, id); }
```
(Place BEFORE any conflicting route; ensure `:id` GET doesn't shadow the list `GET /` — it won't. Watch route order vs `DELETE :id`/`PATCH :id` — fine.)

- [ ] **Step 5: Typecheck.** `pnpm --filter @pulsar/api typecheck`.
- [ ] **Step 6: Commit**
```bash
git add packages/shared/src/agents/role-presets.ts packages/shared/src/agents/role-presets.spec.ts packages/shared/src/index.ts apps/api/src/core/agents/agents.service.ts apps/api/src/core/agents/agents.controller.ts
git commit -m "feat(agents): agent detail + activity endpoints + role presets"
```

---

## Task 2: Web — `/agents` roster + top-level nav

**Files:** Create `apps/web/src/routes/(app)/agents/+page.svelte`; modify `apps/web/src/routes/(app)/+layout.svelte`.

- [ ] **Step 1: Roster page** — read `settings/agents/+page.svelte` for the `api()`/$state/UI idioms. `/agents`: `GET /agents` into `$state`; render employee **cards** (avatar emoji, name, role, status Badge, autonomy Badge). Each card links to `/agents/{id}`. A "Engager un agent" button opens the existing register modal (reuse the create flow from settings/agents — you may import/share or replicate; replicate is fine to keep routes independent, but prefer extracting the register form into a shared component `$lib/components/agents/RegisterAgentModal.svelte` used by BOTH this page and settings/agents to avoid duplication). Empty state when none. Errors → local string.

- [ ] **Step 2: Nav** — in `+layout.svelte`, add a top-level nav item "Agents" → `/agents`, gated on `core.agents.read` (mirror the `canReadAgentActions` derived pattern; add `canReadAgents = $derived($auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_READ) ?? false)`). Place near Dashboard / agent-actions.

- [ ] **Step 3: Typecheck.** `pnpm --filter @pulsar/web typecheck` → 0 errors.
- [ ] **Step 4: Commit**
```bash
git add "apps/web/src/routes/(app)/agents/+page.svelte" "apps/web/src/routes/(app)/+layout.svelte" "apps/web/src/lib/components/agents/RegisterAgentModal.svelte"
git commit -m "feat(web): agents roster + top-level nav"
```

---

## Task 3: Web — `/agents/[id]` profile & guided config (+ presets)

**Files:** Create `apps/web/src/routes/(app)/agents/[id]/+page.svelte`; modify the register form/component for presets + inline help.

- [ ] **Step 1: Detail page shell + Profil/Config section** — `/agents/[id]`: `GET /agents/{id}` into `$state` (404 → error). Sections via tabs or anchors: this task does **Profil & config**. Show identity (avatar/name/role/persona). Editable config form (model Input, autonomy radio with one-line explanation each, permissions checkboxes WITH descriptions from `PERMISSION_CATALOG` (import from `@pulsar/shared`), caps inputs) — **inline help text under each field** (autonomy levels, scopes, caps, model, persona). Save → `PATCH /agents/{id}` (exists). Revoke button → `DELETE /agents/{id}` with confirm. Reuse `$lib/components/ui` (Field/Input/Select/Textarea/Badge/Button/Card).

- [ ] **Step 2: Role presets in the register form** — in `RegisterAgentModal.svelte` (from T2) add a "Preset de rôle" select from `AGENT_ROLE_PRESETS` (`@pulsar/shared`); selecting one pre-fills persona + permissions + autonomy (still editable). Add the same inline help texts.

- [ ] **Step 3: Typecheck.** `pnpm --filter @pulsar/web typecheck` → 0 errors.
- [ ] **Step 4: Commit**
```bash
git add "apps/web/src/routes/(app)/agents/[id]/+page.svelte" "apps/web/src/lib/components/agents/RegisterAgentModal.svelte"
git commit -m "feat(web): agent profile + guided config (inline help, role presets)"
```

---

## Task 4: Web — `/agents/[id]` activity + chat sections

**Files:** Modify `apps/web/src/routes/(app)/agents/[id]/+page.svelte`; reuse `$lib/api/agent-stream.ts` + the conversation rendering from `AssistantPanel.svelte`.

- [ ] **Step 1: Activity section** — `GET /agents/{id}/activity` into `$state`; show stats (counters: conversations, pending, executed, rejected), a list of recent conversations (title + messageCount + date; click → loads it in the Chat section), and a list of recent proposed actions (tool + riskTier Badge + status Badge + date; link to `/agent-actions`). Empty states. If activity fetch fails, show a local message but keep the rest of the page.

- [ ] **Step 2: Chat section** — a full-width conversation panel scoped to THIS agent: reuse `streamAgentTurn` from `$lib/api/agent-stream.ts` and the message/proposed-action-card rendering pattern from `AssistantPanel.svelte` (extract a shared `$lib/components/agents/Conversation.svelte` if clean, else inline). On first message → `POST /agent-conversations { agentId: <this id> }` then stream turns; clicking a conversation in Activity loads its history (`GET /agent-conversations/:id`) into the panel. Errors → local string; runtime-down → "assistant indisponible".

- [ ] **Step 3: Typecheck.** `pnpm --filter @pulsar/web typecheck` → 0 errors.
- [ ] **Step 4: Commit**
```bash
git add "apps/web/src/routes/(app)/agents/[id]/+page.svelte" "apps/web/src/lib/components/agents/Conversation.svelte"
git commit -m "feat(web): agent activity view + per-agent chat"
```

---

## Task 5: E2E + docs + full verify + push

**Files:** Create `apps/api/test/phase11r2-agent-experience.e2e-spec.ts`; modify docs.

- [ ] **Step 1: Reseed.** `pnpm db:seed`
- [ ] **Step 2: E2E** — login admin; register an agent; `GET /agents/:id` → projection has role/persona/autonomy, NO secretHash/serviceUserId, and 404 for a bogus id / cross-tenant. Create a conversation + a proposed action for that agent (reuse the palier-2a fake-ACP override OR directly create rows via prisma/the MCP path), then `GET /agents/:id/activity` → stats + lists reflect them, tenant-scoped. Run: `pnpm --filter @pulsar/api test:e2e -- phase11r2-agent-experience`. Also unit: `pnpm --filter @pulsar/shared test -- role-presets`.
- [ ] **Step 3: Docs** — `docs/agents.md`: add an "Espace Agents (R2)" note (roster, profil, activité, chat, presets). `docs/etat-du-projet.md`: R2 line. `TODO.md`: mark R2 done; keep deferred (tool_call→proposalId linkage; vendoring; HERMES_ENABLED smoke). `CLAUDE.md`: optional one-liner that the agents UI lives at `/agents` + `/agents/[id]`.
- [ ] **Step 4: Full verify**
```bash
pnpm build
pnpm typecheck
pnpm test
pnpm test:e2e -- phase11r2-agent-experience
pnpm test:e2e
```
All green (1 OSRM skip). Web build must pass (role-presets pure data).
- [ ] **Step 5: Commit + push**
```bash
git add apps/api/test/phase11r2-agent-experience.e2e-spec.ts docs/agents.md docs/etat-du-projet.md TODO.md CLAUDE.md
git commit -m "docs+test: agents experience (R2) shipped — roster, profile, activity, chat"
git push origin phase-11
```

---

## Self-Review notes
- R2 is mostly frontend (T2-T4) — typecheck-verified; visual rendering is Sam's manual check (e2e doesn't cover rendering).
- No new DB model; reads existing tables, all tenant-scoped (rule 1).
- `role-presets.ts` is pure data — browser-safe (no node import).
- Don't duplicate the register form — extract `RegisterAgentModal.svelte` shared by `/agents` and `settings/agents`.
- Chat reuses `agent-stream` + AssistantPanel patterns — extract `Conversation.svelte` if it keeps things DRY.
- Deferred: precise tool_call→proposalId linkage (proposalId not on the ACP stream).
