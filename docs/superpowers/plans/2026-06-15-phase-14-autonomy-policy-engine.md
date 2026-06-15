# Phase 14 — Autonomie & policy engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse autonomy dial with a declarative policy engine evaluated at a single unified gate (auto-act vs propose vs deny, per tool/tier/amount), persist auto-approved actions in the proposals ledger (closing the rate-cap gap), add a reversible circuit breaker that demotes a misbehaving agent to PROPOSE, and a trust score that suggests (never imposes) autonomy promotion.

**Architecture:** Pure decision functions live in `@pulsar/shared` (`evaluatePolicy`, `evaluateCircuitBreaker`, `computeTrustScore`). The MCP tool handler delegates every MUTATING/SENSITIVE call to a single `ProposedActionsService` entry point that builds the context (recent-execution count, breaker state) and applies the gate — AUTO runs + records an EXECUTED `autoApproved` proposal, PROPOSE enqueues PENDING, DENY refuses. The breaker state lives on `Agent.breakerTrippedAt`; the trust score is computed on read from existing `ProposedAction` + `AgentRun` rows.

**Tech Stack:** `@pulsar/shared` (pure, browser-safe — NO module-scope `node:*`), NestJS 11 + Prisma 6, MCP SDK tool server, SvelteKit 5 runes, Jest (api) + vitest (shared).

**Design spec:** `docs/superpowers/specs/2026-06-15-phase-14-autonomy-policy-engine-design.md`

**Branch:** `phase-14` (already created off phase-13 tip; the design doc is its first commit). Do NOT switch branches.

**Conventions reminder (CLAUDE.md):**
- Enums/pure logic in `@pulsar/shared`; the package is bundled from SOURCE by the web SPA — a module-scope `node:*` import breaks the web build without breaking typechecks. Keep new shared files pure.
- Rebuild shared/database after editing (`pnpm --filter @pulsar/shared build`, `pnpm --filter @pulsar/database build`).
- Agent projections never expose `secretHash`/`serviceUserId` (rule 26, the shared `agentSelect`).
- Caps never raised by autonomy (rule 23/24). The hard cap `maxAmountPerAction` is never exceeded by AUTO.
- Run `pnpm build` (full) AND `pnpm test` (specs aren't compiled by `nest build`) before declaring green.

---

## File Structure

**Create:**
- `packages/shared/src/agents/policy.ts` — `PolicyEffect`, `PolicyRule`, `PolicyContext`, `PolicyDecision`, `evaluatePolicy`, `presetPolicies`, `effectivePolicies`.
- `packages/shared/src/agents/policy.spec.ts`
- `packages/shared/src/agents/circuit-breaker.ts` — `BreakerConfig`, `BreakerOutcome`, `DEFAULT_BREAKER`, `evaluateCircuitBreaker`.
- `packages/shared/src/agents/circuit-breaker.spec.ts`
- `packages/shared/src/agents/trust.ts` — `TrustStats`, `TrustResult`, `TRUST_PROMOTION`, `computeTrustScore`.
- `packages/shared/src/agents/trust.spec.ts`
- `apps/api/src/core/agents/agent-autonomy.service.spec.ts` — unit tests for the new ProposedActionsService methods (gate decision, auto-record, breaker trip).
- `apps/api/test/phase14-autonomy.e2e-spec.ts`

**Modify:**
- `packages/shared/src/index.ts` — export the three new modules.
- `packages/database/prisma/schema.prisma` — `ProposedAction.autoApproved Boolean @default(false)`, `Agent.breakerTrippedAt DateTime?`. 23rd migration.
- `apps/api/src/core/agents/agent-principal.ts` — add `autonomyLevel` to `AgentPrincipal`; add `policies?: PolicyRule[]` to `AgentCaps`.
- `apps/api/src/core/agents/agents.service.ts` — `validateKey` sets `autonomyLevel`; `agentSelect` += `breakerTrippedAt`; `resetBreaker`; `trust`; accept `caps.policies` validation in create/update.
- `apps/api/src/core/agents/proposed-actions.service.ts` — `handleMutatingTool` (the gate), `recordAutoOutcome`, `maybeTripBreaker`, `isBreakerTripped`; wire `approve` to record outcome. Inject `NotificationsService`.
- `apps/api/src/core/agents/mcp-server.factory.ts` — delegate MUTATING/SENSITIVE to `proposals.handleMutatingTool`.
- `apps/api/src/core/agents/agents.controller.ts` — `GET :id/trust`, `POST :id/reset-breaker`.
- `apps/api/src/core/agents/agents.module.ts` — import `NotificationsModule` (for `NotificationsService`).
- `apps/web/src/routes/(app)/agents/[id]/+page.svelte` — policies editor + trust banner + breaker banner.
- `CLAUDE.md`, `ROADMAP.md`, `docs/etat-du-projet.md`.

---

## Task 1: Shared policy engine

**Files:**
- Create: `packages/shared/src/agents/policy.ts`, `packages/shared/src/agents/policy.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test** — `packages/shared/src/agents/policy.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RiskTier } from './risk';
import { AgentAutonomy } from './autonomy';
import { evaluatePolicy, presetPolicies, effectivePolicies, type PolicyRule } from './policy';

const base = { recentExecutions: 0, maxPerMinute: undefined, maxAmountPerAction: undefined, breakerTripped: false };

describe('evaluatePolicy', () => {
  it('most-specific rule wins: tool rule over tier rule over catch-all', () => {
    const rules: PolicyRule[] = [
      { effect: 'PROPOSE' },
      { tierMax: RiskTier.SENSITIVE, effect: 'PROPOSE' },
      { tool: 'create_load', effect: 'AUTO' },
    ];
    expect(evaluatePolicy(rules, { ...base, tool: 'create_load', tier: RiskTier.MUTATING }).effect).toBe('AUTO');
    expect(evaluatePolicy(rules, { ...base, tool: 'tender_load', tier: RiskTier.SENSITIVE }).effect).toBe('PROPOSE');
  });

  it('defaults to PROPOSE when no rule matches', () => {
    expect(evaluatePolicy([{ tool: 'x', effect: 'AUTO' }], { ...base, tool: 'y', tier: RiskTier.MUTATING }).effect).toBe('PROPOSE');
  });

  it('AUTO downgrades to PROPOSE above the rule maxAmount', () => {
    const rules: PolicyRule[] = [{ tool: 'tender_load', maxAmount: 1000, effect: 'AUTO' }];
    expect(evaluatePolicy(rules, { ...base, tool: 'tender_load', tier: RiskTier.SENSITIVE, amount: 500 }).effect).toBe('AUTO');
    expect(evaluatePolicy(rules, { ...base, tool: 'tender_load', tier: RiskTier.SENSITIVE, amount: 1500 }).effect).toBe('PROPOSE');
  });

  it('DENY above the hard global cap (autonomy never lifts caps)', () => {
    const rules: PolicyRule[] = [{ effect: 'AUTO' }];
    expect(evaluatePolicy(rules, { ...base, tool: 't', tier: RiskTier.MUTATING, amount: 5000, maxAmountPerAction: 1000 }).effect).toBe('DENY');
  });

  it('AUTO downgrades to PROPOSE when the rate cap is reached', () => {
    const rules: PolicyRule[] = [{ effect: 'AUTO' }];
    expect(evaluatePolicy(rules, { ...base, tool: 't', tier: RiskTier.MUTATING, recentExecutions: 5, maxPerMinute: 5 }).effect).toBe('PROPOSE');
  });

  it('breaker forces PROPOSE even when the rule says AUTO', () => {
    expect(evaluatePolicy([{ effect: 'AUTO' }], { ...base, tool: 't', tier: RiskTier.MUTATING, breakerTripped: true }).effect).toBe('PROPOSE');
  });
});

describe('presetPolicies / effectivePolicies', () => {
  it('PROPOSE level → everything proposes', () => {
    expect(presetPolicies(AgentAutonomy.PROPOSE)).toEqual([{ effect: 'PROPOSE' }]);
  });
  it('ACT_LOW → MUTATING auto, SENSITIVE proposes', () => {
    const r = presetPolicies(AgentAutonomy.ACT_LOW);
    expect(evaluatePolicy(r, { ...base, tool: 'a', tier: RiskTier.MUTATING }).effect).toBe('AUTO');
    expect(evaluatePolicy(r, { ...base, tool: 'b', tier: RiskTier.SENSITIVE }).effect).toBe('PROPOSE');
  });
  it('AUTONOMOUS → MUTATING + SENSITIVE auto', () => {
    const r = presetPolicies(AgentAutonomy.AUTONOMOUS);
    expect(evaluatePolicy(r, { ...base, tool: 'b', tier: RiskTier.SENSITIVE }).effect).toBe('AUTO');
  });
  it('effectivePolicies uses caps.policies when present, else preset + legacy autoApprove', () => {
    const explicit: PolicyRule[] = [{ tool: 'x', effect: 'DENY' }];
    expect(effectivePolicies(explicit, AgentAutonomy.PROPOSE, [])).toBe(explicit);
    const fallback = effectivePolicies(undefined, AgentAutonomy.PROPOSE, ['create_load']);
    expect(evaluatePolicy(fallback, { ...base, tool: 'create_load', tier: RiskTier.MUTATING }).effect).toBe('AUTO');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- policy.spec`
Expected: FAIL — cannot find `./policy`.

- [ ] **Step 3: Implement `packages/shared/src/agents/policy.ts`**

```ts
import { RiskTier } from './risk';
import { AgentAutonomy } from './autonomy';

// Pure, browser-safe. No node:* imports.

export type PolicyEffect = 'AUTO' | 'PROPOSE' | 'DENY';

/** A declarative governance rule. Absent fields = "matches anything". */
export interface PolicyRule {
  tool?: string;
  tierMax?: RiskTier;
  maxAmount?: number;
  effect: PolicyEffect;
}

export interface PolicyContext {
  tool: string;
  tier: RiskTier;
  amount?: number;
  recentExecutions: number;
  maxPerMinute?: number;
  maxAmountPerAction?: number;
  breakerTripped?: boolean;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  reason?: string;
}

const TIER_ORDER: Record<RiskTier, number> = {
  [RiskTier.READ]: 0,
  [RiskTier.LOW]: 1,
  [RiskTier.MUTATING]: 2,
  [RiskTier.SENSITIVE]: 3,
};

/** Higher = more specific. tool > tier > catch-all. */
function specificity(rule: PolicyRule): number {
  if (rule.tool !== undefined) return 2;
  if (rule.tierMax !== undefined) return 1;
  return 0;
}

function matches(rule: PolicyRule, ctx: PolicyContext): boolean {
  if (rule.tool !== undefined && rule.tool !== ctx.tool) return false;
  if (rule.tierMax !== undefined && TIER_ORDER[ctx.tier] > TIER_ORDER[rule.tierMax]) return false;
  return true;
}

/**
 * The single autonomy decision. READ/LOW are handled live upstream (isExecutableLive);
 * this is only called for MUTATING/SENSITIVE. Most-specific matching rule wins; no match
 * defaults to PROPOSE. An AUTO effect is downgraded to PROPOSE by the breaker, the rule's
 * maxAmount, or the rate cap; and DENIED above the hard global amount cap.
 */
export function evaluatePolicy(rules: PolicyRule[], ctx: PolicyContext): PolicyDecision {
  let best: PolicyRule | undefined;
  let bestScore = -1;
  for (const rule of rules) {
    if (!matches(rule, ctx)) continue;
    const s = specificity(rule);
    if (s > bestScore) {
      best = rule;
      bestScore = s;
    }
  }
  const effect = best?.effect ?? 'PROPOSE';
  if (effect !== 'AUTO') return { effect };

  // Hard global cap is absolute — autonomy never lifts it (rule 23).
  if (ctx.amount !== undefined && ctx.maxAmountPerAction !== undefined && ctx.amount > ctx.maxAmountPerAction) {
    return { effect: 'DENY', reason: `Amount ${ctx.amount} exceeds the hard cap ${ctx.maxAmountPerAction}.` };
  }
  if (ctx.breakerTripped) return { effect: 'PROPOSE', reason: 'Circuit breaker active.' };
  if (best?.maxAmount !== undefined && ctx.amount !== undefined && ctx.amount > best.maxAmount) {
    return { effect: 'PROPOSE', reason: `Amount ${ctx.amount} exceeds rule cap ${best.maxAmount}.` };
  }
  if (ctx.maxPerMinute !== undefined && ctx.recentExecutions >= ctx.maxPerMinute) {
    return { effect: 'PROPOSE', reason: `Rate limit ${ctx.maxPerMinute}/min reached.` };
  }
  return { effect: 'AUTO' };
}

/** Tier-based rules for the coarse autonomy dial. */
export function presetPolicies(level: AgentAutonomy): PolicyRule[] {
  switch (level) {
    case AgentAutonomy.PROPOSE:
      return [{ effect: 'PROPOSE' }];
    case AgentAutonomy.ACT_LOW:
      return [{ tierMax: RiskTier.MUTATING, effect: 'AUTO' }, { tierMax: RiskTier.SENSITIVE, effect: 'PROPOSE' }];
    case AgentAutonomy.AUTONOMOUS:
      return [{ tierMax: RiskTier.SENSITIVE, effect: 'AUTO' }];
  }
}

/**
 * Resolve the rules to evaluate for an agent. Explicit `caps.policies` win; otherwise the
 * dial preset plus any legacy `caps.autoApprove` tool names as tool-specific AUTO rules
 * (so existing agents' explicit grants are preserved and new tools are covered by the tier preset).
 */
export function effectivePolicies(
  policies: PolicyRule[] | undefined,
  level: AgentAutonomy,
  autoApprove: string[] | undefined,
): PolicyRule[] {
  if (policies && policies.length > 0) return policies;
  const legacy: PolicyRule[] = (autoApprove ?? []).map((tool) => ({ tool, effect: 'AUTO' as const }));
  return [...presetPolicies(level), ...legacy];
}
```

- [ ] **Step 4: Export** — in `packages/shared/src/index.ts`, after the `./agents/runs` export add:

```ts
export * from './agents/policy';
```

- [ ] **Step 5: Run test + build**

Run: `pnpm --filter @pulsar/shared test -- policy.spec` → PASS.
Run: `pnpm --filter @pulsar/shared build` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agents/policy.ts packages/shared/src/agents/policy.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): policy engine — evaluatePolicy + preset/effective policies

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared circuit breaker

**Files:**
- Create: `packages/shared/src/agents/circuit-breaker.ts`, `circuit-breaker.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test** — `circuit-breaker.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateCircuitBreaker, DEFAULT_BREAKER, type BreakerOutcome } from './circuit-breaker';

const fail = (at: number): BreakerOutcome => ({ failed: true, at });
const ok = (at: number): BreakerOutcome => ({ failed: false, at });

describe('evaluateCircuitBreaker', () => {
  it('trips on N consecutive failures (most-recent first ordering)', () => {
    expect(evaluateCircuitBreaker([fail(3), fail(2), fail(1)], DEFAULT_BREAKER)).toBe(true);
  });
  it('does not trip when a success interrupts the streak', () => {
    expect(evaluateCircuitBreaker([fail(4), fail(3), ok(2), fail(1)], DEFAULT_BREAKER)).toBe(false);
  });
  it('does not trip below the threshold', () => {
    expect(evaluateCircuitBreaker([fail(2), fail(1)], DEFAULT_BREAKER)).toBe(false);
  });
  it('empty history never trips', () => {
    expect(evaluateCircuitBreaker([], DEFAULT_BREAKER)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- circuit-breaker.spec`
Expected: FAIL — cannot find `./circuit-breaker`.

- [ ] **Step 3: Implement `circuit-breaker.ts`**

```ts
// Pure, browser-safe.

export interface BreakerConfig {
  /** Trip after this many consecutive failures. */
  consecutiveFailures: number;
  /** How long a tripped breaker stays tripped before auto-rearming. */
  cooldownMs: number;
}

/** One past action outcome. `at` is an epoch-ms timestamp (passed in by the caller). */
export interface BreakerOutcome {
  failed: boolean;
  at: number;
}

export const DEFAULT_BREAKER: BreakerConfig = { consecutiveFailures: 3, cooldownMs: 15 * 60_000 };

/**
 * True iff the most recent `cfg.consecutiveFailures` outcomes are ALL failures.
 * `recent` MUST be ordered most-recent-first.
 */
export function evaluateCircuitBreaker(recent: BreakerOutcome[], cfg: BreakerConfig): boolean {
  if (recent.length < cfg.consecutiveFailures) return false;
  for (let i = 0; i < cfg.consecutiveFailures; i++) {
    if (!recent[i].failed) return false;
  }
  return true;
}
```

- [ ] **Step 4: Export** — in `index.ts` add `export * from './agents/circuit-breaker';`.

- [ ] **Step 5: Run test + build**

Run: `pnpm --filter @pulsar/shared test -- circuit-breaker.spec` → PASS.
Run: `pnpm --filter @pulsar/shared build` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agents/circuit-breaker.ts packages/shared/src/agents/circuit-breaker.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): circuit breaker — trip on consecutive failures

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shared trust score

**Files:**
- Create: `packages/shared/src/agents/trust.ts`, `trust.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test** — `trust.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AgentAutonomy } from './autonomy';
import { computeTrustScore, TRUST_PROMOTION } from './trust';

describe('computeTrustScore', () => {
  it('high approval + clean runs → high score, ready for next', () => {
    const r = computeTrustScore(
      { executed: 40, rejected: 1, failed: 0, runsSucceeded: 40, runsTotal: 41, breakerTrips: 0 },
      AgentAutonomy.PROPOSE,
    );
    expect(r.score).toBeGreaterThanOrEqual(TRUST_PROMOTION.minScore);
    expect(r.readyForNext).toBe(true);
  });
  it('not ready below the minimum action volume', () => {
    const r = computeTrustScore(
      { executed: 3, rejected: 0, failed: 0, runsSucceeded: 3, runsTotal: 3, breakerTrips: 0 },
      AgentAutonomy.PROPOSE,
    );
    expect(r.readyForNext).toBe(false);
  });
  it('failures and breaker trips lower the score', () => {
    const clean = computeTrustScore({ executed: 30, rejected: 0, failed: 0, runsSucceeded: 30, runsTotal: 30, breakerTrips: 0 }, AgentAutonomy.PROPOSE);
    const dirty = computeTrustScore({ executed: 30, rejected: 5, failed: 8, runsSucceeded: 20, runsTotal: 30, breakerTrips: 2 }, AgentAutonomy.PROPOSE);
    expect(dirty.score).toBeLessThan(clean.score);
  });
  it('AUTONOMOUS is never "ready for next" (already top)', () => {
    const r = computeTrustScore({ executed: 100, rejected: 0, failed: 0, runsSucceeded: 100, runsTotal: 100, breakerTrips: 0 }, AgentAutonomy.AUTONOMOUS);
    expect(r.readyForNext).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- trust.spec`
Expected: FAIL — cannot find `./trust`.

- [ ] **Step 3: Implement `trust.ts`**

```ts
import { AgentAutonomy } from './autonomy';

// Pure, browser-safe.

export interface TrustStats {
  executed: number;     // EXECUTED proposals (auto + approved)
  rejected: number;     // human-rejected proposals
  failed: number;       // FAILED proposals
  runsSucceeded: number;
  runsTotal: number;
  breakerTrips: number;
}

export interface TrustResult {
  score: number;        // 0..100
  readyForNext: boolean;
  nextLevel: AgentAutonomy | null;
  reasons: string[];
}

export const TRUST_PROMOTION = { minScore: 80, minActions: 25 } as const;

function nextLevelOf(level: AgentAutonomy): AgentAutonomy | null {
  if (level === AgentAutonomy.PROPOSE) return AgentAutonomy.ACT_LOW;
  if (level === AgentAutonomy.ACT_LOW) return AgentAutonomy.AUTONOMOUS;
  return null;
}

/**
 * 0..100 trust score from an agent's track record. Approval rate and run success are the
 * positive signals; failures and breaker trips are penalties. `readyForNext` requires a
 * minimum action volume, a score over the threshold, and that a higher level exists.
 */
export function computeTrustScore(stats: TrustStats, level: AgentAutonomy): TrustResult {
  const decisions = stats.executed + stats.rejected;
  const approvalRate = decisions > 0 ? stats.executed / decisions : 0;
  const runRate = stats.runsTotal > 0 ? stats.runsSucceeded / stats.runsTotal : 1;
  const failurePenalty = stats.executed + stats.failed > 0 ? stats.failed / (stats.executed + stats.failed) : 0;

  let score = 100 * (0.5 * approvalRate + 0.4 * runRate);
  score += 10; // baseline credit for participating
  score -= 100 * 0.4 * failurePenalty;
  score -= stats.breakerTrips * 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const reasons: string[] = [];
  const next = nextLevelOf(level);
  const enoughVolume = stats.executed >= TRUST_PROMOTION.minActions;
  if (!next) reasons.push('Already at the highest autonomy level.');
  if (!enoughVolume) reasons.push(`Needs ${TRUST_PROMOTION.minActions} executed actions (has ${stats.executed}).`);
  if (score < TRUST_PROMOTION.minScore) reasons.push(`Score ${score} below ${TRUST_PROMOTION.minScore}.`);

  const readyForNext = !!next && enoughVolume && score >= TRUST_PROMOTION.minScore;
  return { score, readyForNext, nextLevel: readyForNext ? next : null, reasons };
}
```

- [ ] **Step 4: Export** — in `index.ts` add `export * from './agents/trust';`.

- [ ] **Step 5: Run test + build**

Run: `pnpm --filter @pulsar/shared test -- trust.spec` → PASS.
Run: `pnpm --filter @pulsar/shared build` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agents/trust.ts packages/shared/src/agents/trust.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): trust score — readiness for autonomy promotion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Prisma — autoApproved + breakerTrippedAt (23rd migration)

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add the fields**

In `model ProposedAction`, after `status ProposalStatus @default(PENDING)` add:

```prisma
  autoApproved   Boolean        @default(false)
```

In `model Agent`, after `lastRunAt DateTime?` (added in phase 13) add:

```prisma
  breakerTrippedAt DateTime?
```

- [ ] **Step 2: Migrate + regenerate + build**

DB up (`pnpm db:up`). From `packages/database`, run the non-interactive migrate (mirror the `migrate:dev` script's dotenv wrapper):

```bash
cd packages/database
pnpm exec dotenv -e ../../.env -- prisma migrate dev --name phase14_autonomy_policy
cd ../..
pnpm --filter @pulsar/database build
```

Expected: one new migration `*_phase14_autonomy_policy` with `ALTER TABLE "proposed_actions" ADD COLUMN "autoApproved" BOOLEAN NOT NULL DEFAULT false` and `ALTER TABLE "agents" ADD COLUMN "breakerTrippedAt" TIMESTAMP(3)`. Build clean.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): ProposedAction.autoApproved + Agent.breakerTrippedAt (23rd migration)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: AgentPrincipal — autonomyLevel + caps.policies type

**Files:**
- Modify: `apps/api/src/core/agents/agent-principal.ts`
- Modify: `apps/api/src/core/agents/agents.service.ts` (`validateKey`)

- [ ] **Step 1: Extend the types**

In `agent-principal.ts`:
- Add to the imports: `import type { AgentAutonomy, PolicyRule } from '@pulsar/shared';`
- In `AgentCaps`, add:
  ```ts
    /** phase 14: declarative governance rules; when present, override the autonomy dial. */
    policies?: PolicyRule[];
  ```
- In `AgentPrincipal`, add:
  ```ts
    /** phase 14: the agent's coarse autonomy dial (drives effectivePolicies fallback). */
    autonomyLevel: AgentAutonomy;
  ```

- [ ] **Step 2: Populate it in `validateKey`**

In `agents.service.ts` `validateKey`, the returned principal currently omits `autonomyLevel`. The fetched `agent` row has `agent.autonomyLevel`. Add it to the returned object:

```ts
    return {
      agentId: agent.id,
      name: agent.name,
      caps: (agent.caps ?? {}) as AgentCaps,
      autonomyLevel: agent.autonomyLevel as AgentPrincipal['autonomyLevel'],
      user,
      triggeredByRef: parsed?.triggeredByRef,
    };
```

Also: `ProposedActionsService.approve` builds a principal inline (around line 101) — add `autonomyLevel: agent.autonomyLevel as AgentPrincipal['autonomyLevel'],` there too (Task 7 touches this file; if doing Task 5 first, add it now and the build will confirm the type is satisfied).

- [ ] **Step 3: Build to verify types**

Run: `pnpm --filter @pulsar/api build`
Expected: clean (every `AgentPrincipal` construction now provides `autonomyLevel` — fix any the compiler flags).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/core/agents/agent-principal.ts apps/api/src/core/agents/agents.service.ts apps/api/src/core/agents/proposed-actions.service.ts
git commit -m "feat(api): carry autonomyLevel + caps.policies on AgentPrincipal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ProposedActionsService — the gate, auto-record, breaker

**Files:**
- Modify: `apps/api/src/core/agents/proposed-actions.service.ts`
- Modify: `apps/api/src/core/agents/agents.module.ts` (import `NotificationsModule`)
- Test: `apps/api/src/core/agents/agent-autonomy.service.spec.ts`

This task adds the unified decision + side-effects to `ProposedActionsService`. It depends on Tasks 1–5.

- [ ] **Step 1: Write the failing test** — `agent-autonomy.service.spec.ts`:

```ts
import { ProposalStatus, RiskTier } from '@pulsar/shared';
import { ProposedActionsService } from './proposed-actions.service';
import type { AgentPrincipal } from './agent-principal';
import { AgentAutonomy } from '@pulsar/shared';

function principal(overrides: Partial<AgentPrincipal['caps']> = {}): AgentPrincipal {
  return {
    agentId: 'a1',
    name: 'agent',
    autonomyLevel: AgentAutonomy.AUTONOMOUS,
    caps: { ...overrides },
    user: { id: 'svc1', tenantId: 't1', email: 'agent:agent', firstName: 'Agent', lastName: 'agent', permissions: [] },
  } as AgentPrincipal;
}

const tenderDef = {
  name: 'tender_load', tier: RiskTier.SENSITIVE,
  run: async () => ({ ok: true }),
  amountFrom: (a: Record<string, unknown>) => (typeof a.amount === 'number' ? a.amount : undefined),
} as any;

describe('ProposedActionsService.handleMutatingTool', () => {
  it('AUTO: runs the tool and records an EXECUTED autoApproved proposal', async () => {
    const created: any[] = [];
    const prisma = {
      proposedAction: {
        count: async () => 0,
        findUnique: async () => null,
        findMany: async () => [],
        create: async ({ data }: any) => { created.push(data); return { id: 'p1', ...data }; },
      },
      agent: { findFirst: async () => ({ breakerTrippedAt: null }), update: async () => ({}) },
    } as any;
    const audit = { log: async () => undefined } as any;
    const notifications = { notify: async () => undefined } as any;
    const svc = new ProposedActionsService(prisma, audit, notifications);

    const res = await svc.handleMutatingTool(principal(), tenderDef, { amount: 100 }, {} as any);
    expect(res.effect).toBe('AUTO');
    expect(created.some((d) => d.status === ProposalStatus.EXECUTED && d.autoApproved === true)).toBe(true);
  });

  it('PROPOSE: enqueues a PENDING proposal when the policy demotes', async () => {
    const created: any[] = [];
    const prisma = {
      proposedAction: {
        count: async () => 0,
        findUnique: async () => null,
        findMany: async () => [],
        create: async ({ data }: any) => { created.push(data); return { id: 'p2', ...data }; },
      },
      agent: { findFirst: async () => ({ breakerTrippedAt: null }), update: async () => ({}) },
    } as any;
    const svc = new ProposedActionsService(prisma, { log: async () => undefined } as any, { notify: async () => undefined } as any);
    // amount over the hard cap → DENY; over rule cap → PROPOSE. Here: PROPOSE level agent.
    const res = await svc.handleMutatingTool(principal({}), tenderDef, { amount: 100 }, {} as any);
    // AUTONOMOUS default in helper → AUTO; force PROPOSE via a policy:
    const res2 = await svc.handleMutatingTool(
      { ...principal({ policies: [{ tool: 'tender_load', effect: 'PROPOSE' }] }) },
      tenderDef, { amount: 100 }, {} as any,
    );
    expect(res2.effect).toBe('PROPOSE');
    expect(created.some((d) => d.status === ProposalStatus.PENDING)).toBe(true);
  });

  it('DENY: refuses above the hard amount cap, records nothing', async () => {
    const created: any[] = [];
    const prisma = {
      proposedAction: { count: async () => 0, findUnique: async () => null, findMany: async () => [], create: async ({ data }: any) => { created.push(data); return { id: 'x', ...data }; } },
      agent: { findFirst: async () => ({ breakerTrippedAt: null }), update: async () => ({}) },
    } as any;
    const svc = new ProposedActionsService(prisma, { log: async () => undefined } as any, { notify: async () => undefined } as any);
    const res = await svc.handleMutatingTool(principal({ maxAmountPerAction: 50 }), tenderDef, { amount: 5000 }, {} as any);
    expect(res.effect).toBe('DENY');
    expect(created).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/api test -- agent-autonomy.service`
Expected: FAIL — `handleMutatingTool is not a function` / constructor arity.

- [ ] **Step 3: Implement the new methods**

In `proposed-actions.service.ts`:

3a. Update imports:
```ts
import {
  ProposalStatus,
  deriveIdempotencyKey,
  evaluateAmountCap,
  evaluateRateCap,
  evaluatePolicy,
  effectivePolicies,
  evaluateCircuitBreaker,
  DEFAULT_BREAKER,
  type PolicyDecision,
} from '@pulsar/shared';
import { NotificationLevel } from '@pulsar/shared';
import { NotificationsService } from '../notifications/notifications.service';
```

3b. Add `NotificationsService` to the constructor:
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
  ) {}
```

3c. Add the unified gate + helpers (place after `enqueue`):
```ts
  /** Trailing-minute count of EXECUTED/PENDING actions for the agent (auto + proposed). */
  private async recentExecutionCount(agentId: string): Promise<number> {
    const since = new Date(Date.now() - 60_000);
    return this.prisma.proposedAction.count({ where: { agentId, proposedAt: { gte: since } } });
  }

  /** True iff the breaker is tripped AND still within cooldown. Lazily auto-rearms past cooldown. */
  private async isBreakerTripped(agentId: string): Promise<boolean> {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId }, select: { breakerTrippedAt: true } });
    const at = agent?.breakerTrippedAt;
    if (!at) return false;
    if (Date.now() - at.getTime() > DEFAULT_BREAKER.cooldownMs) {
      await this.prisma.agent.update({ where: { id: agentId }, data: { breakerTrippedAt: null } }).catch(() => undefined);
      return false;
    }
    return true;
  }

  /**
   * The SINGLE autonomy decision for a MUTATING/SENSITIVE tool call. Builds the policy context,
   * evaluates, then: AUTO → run + record EXECUTED/FAILED (autoApproved) + maybe trip breaker;
   * PROPOSE → enqueue PENDING; DENY → return the decision (caller surfaces an error).
   * Returns the decision augmented with proposalId/result for the caller's MCP envelope.
   */
  async handleMutatingTool(
    principal: AgentPrincipal,
    def: { name: string; tier: import('@pulsar/shared').RiskTier; run: (a: Record<string, unknown>, ctx: { principal: AgentPrincipal; services: ToolServices }) => Promise<unknown>; amountFrom?: (a: Record<string, unknown>) => number | undefined },
    args: Record<string, unknown>,
    services: ToolServices,
  ): Promise<PolicyDecision & { proposalId?: string; result?: unknown }> {
    const amount = def.amountFrom?.(args);
    const rules = effectivePolicies(principal.caps.policies, principal.autonomyLevel, principal.caps.autoApprove);
    const decision = evaluatePolicy(rules, {
      tool: def.name,
      tier: def.tier,
      amount,
      recentExecutions: await this.recentExecutionCount(principal.agentId),
      maxPerMinute: principal.caps.maxActionsPerMinute,
      maxAmountPerAction: principal.caps.maxAmountPerAction,
      breakerTripped: await this.isBreakerTripped(principal.agentId),
    });

    if (decision.effect === 'DENY') return decision;
    if (decision.effect === 'PROPOSE') {
      const proposal = await this.enqueue(principal, def.name, args, { triggeredByRef: principal.triggeredByRef });
      return { ...decision, proposalId: proposal.id };
    }
    // AUTO
    const key = deriveIdempotencyKey(def.name, args);
    try {
      const result = await def.run(args, { principal, services });
      await this.recordAutoOutcome(principal, def.name, def.tier, args, key, { ok: true, result });
      return { ...decision, result };
    } catch (err) {
      await this.recordAutoOutcome(principal, def.name, def.tier, args, key, { ok: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /** Persist an auto-executed action as a ProposedAction (EXECUTED|FAILED, autoApproved). Idempotent. */
  private async recordAutoOutcome(
    principal: AgentPrincipal,
    tool: string,
    tier: import('@pulsar/shared').RiskTier,
    args: Record<string, unknown>,
    key: string,
    outcome: { ok: boolean; result?: unknown; error?: string },
  ): Promise<void> {
    const existing = await this.prisma.proposedAction.findUnique({
      where: { agentId_idempotencyKey: { agentId: principal.agentId, idempotencyKey: key } },
    });
    if (!existing) {
      await this.prisma.proposedAction.create({
        data: {
          tenantId: principal.user.tenantId,
          agentId: principal.agentId,
          triggeredByRef: principal.triggeredByRef,
          tool,
          argsJson: args as object,
          riskTier: tier,
          idempotencyKey: key,
          status: outcome.ok ? ProposalStatus.EXECUTED : ProposalStatus.FAILED,
          autoApproved: true,
          resultJson: (outcome.ok ? outcome.result ?? {} : { error: outcome.error }) as object,
        },
      });
    }
    await this.maybeTripBreaker(principal);
  }

  /** Read recent outcomes and trip the breaker (set breakerTrippedAt) if the pattern warrants. */
  async maybeTripBreaker(principal: AgentPrincipal): Promise<void> {
    const agent = await this.prisma.agent.findFirst({ where: { id: principal.agentId }, select: { breakerTrippedAt: true } });
    if (agent?.breakerTrippedAt) return; // already tripped
    const rows = await this.prisma.proposedAction.findMany({
      where: { agentId: principal.agentId, status: { in: [ProposalStatus.EXECUTED, ProposalStatus.FAILED] } },
      orderBy: { proposedAt: 'desc' },
      take: DEFAULT_BREAKER.consecutiveFailures,
      select: { status: true, proposedAt: true },
    });
    const recent = rows.map((r) => ({ failed: r.status === ProposalStatus.FAILED, at: r.proposedAt.getTime() }));
    if (!evaluateCircuitBreaker(recent, DEFAULT_BREAKER)) return;
    await this.prisma.agent.update({ where: { id: principal.agentId }, data: { breakerTrippedAt: new Date() } }).catch(() => undefined);
    await this.audit.log({
      tenantId: principal.user.tenantId,
      userId: principal.user.id,
      action: AuditAction.UPDATE,
      entityType: 'agent',
      entityId: principal.agentId,
      after: { breakerTripped: true, reason: 'consecutive failures' },
    });
    await this.notifications.notify({
      tenantId: principal.user.tenantId,
      title: `Agent ${principal.name} — circuit breaker`,
      body: `L'agent a été rétrogradé en PROPOSE après ${DEFAULT_BREAKER.consecutiveFailures} échecs consécutifs.`,
      level: NotificationLevel.WARNING,
    }).catch(() => undefined);
  }
```

3d. Wire `approve` to feed the breaker. In `approve`, after the EXECUTED update (success path) and after the FAILED update (catch path), call `await this.maybeTripBreaker(principal);`. (The success path resets nothing but a successful action breaks the failure streak naturally because `maybeTripBreaker` reads the latest rows.)

3e. Mark the human-approved EXECUTED/FAILED rows as `autoApproved: false` is the default — no change needed (column defaults false).

- [ ] **Step 4: Import `NotificationsModule` in `agents.module.ts`**

Add to the `imports` array of `AgentsModule`: `NotificationsModule` (import it: `import { NotificationsModule } from '../notifications/notifications.module';`). Confirm `NotificationsModule` exports `NotificationsService` (it does — see `notifications.module.ts`).

- [ ] **Step 5: Run test + build**

Run: `pnpm --filter @pulsar/api test -- agent-autonomy.service` → PASS (3 tests).
Run: `pnpm --filter @pulsar/api build` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/agents/proposed-actions.service.ts apps/api/src/core/agents/agents.module.ts apps/api/src/core/agents/agent-autonomy.service.spec.ts
git commit -m "feat(api): unified policy gate, auto-execution ledger, circuit breaker trip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Unified gate in the MCP factory

**Files:**
- Modify: `apps/api/src/core/agents/mcp-server.factory.ts`

- [ ] **Step 1: Replace the auto/propose branching**

In `buildAgentMcpServer`, the tool handler currently branches on `isExecutableLive`, then `caps.autoApprove?.includes`, then amount cap, then enqueue. Replace the MUTATING/SENSITIVE branch (everything after the `isExecutableLive` live path) with a single delegation:

```ts
      async (args: Record<string, unknown>) => {
        if (isExecutableLive(def.tier)) {
          const result = await def.run(args, { principal, services });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }
        const decision = await proposals.handleMutatingTool(principal, def, args, services);
        if (decision.effect === 'DENY') {
          return {
            content: [{ type: 'text' as const, text: decision.reason ?? 'Denied by policy' }],
            isError: true,
          };
        }
        if (decision.effect === 'PROPOSE') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ queued: true, proposalId: decision.proposalId, status: 'PENDING' }) }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ autoApproved: true, result: decision.result }) }],
        };
      },
```

Remove the now-unused `evaluateAmountCap` import from this file (the cap logic moved into the gate). Keep `isExecutableLive`.

- [ ] **Step 2: Build**

Run: `pnpm --filter @pulsar/api build`
Expected: clean. (`def` passed to `handleMutatingTool` satisfies the structural param type — `ToolDef` has `name`/`tier`/`run`/`amountFrom`.)

- [ ] **Step 3: Run the agent unit + (if quick) an existing agents e2e to confirm the MCP path still works**

Run: `pnpm --filter @pulsar/api test -- agent-autonomy.service`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/core/agents/mcp-server.factory.ts
git commit -m "feat(api): MCP tool handler delegates to the unified policy gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: AgentsService + controller — trust, reset-breaker, policies validation

**Files:**
- Modify: `apps/api/src/core/agents/agents.service.ts`
- Modify: `apps/api/src/core/agents/agents.controller.ts`
- Test: `apps/api/src/core/agents/agents-trust.service.spec.ts`

- [ ] **Step 1: Write the failing test** — `agents-trust.service.spec.ts`:

```ts
import { AgentAutonomy } from '@pulsar/shared';
import { AgentsService } from './agents.service';

function makeService() {
  const prisma = {
    agent: {
      findFirst: async () => ({ id: 'a1', tenantId: 't1', autonomyLevel: AgentAutonomy.PROPOSE, status: 'ACTIVE' }),
      update: async ({ data }: any) => ({ id: 'a1', ...data }),
    },
    proposedAction: {
      count: async ({ where }: any) =>
        where.status === 'EXECUTED' ? 30 : where.status === 'REJECTED' ? 1 : where.status === 'FAILED' ? 0 : 0,
    },
    agentRun: { count: async ({ where }: any) => (where.status === 'SUCCEEDED' ? 30 : 30) },
  } as any;
  process.env.JWT_SECRET = 'test-secret';
  return new AgentsService(prisma, {} as any, {} as any, {} as any);
}

describe('AgentsService trust + resetBreaker', () => {
  it('trust() returns a score + readiness for an agent with a clean record', async () => {
    const svc = makeService();
    const r = await svc.trust('t1', 'a1');
    expect(r.score).toBeGreaterThan(0);
    expect(typeof r.readyForNext).toBe('boolean');
  });
  it('resetBreaker() clears breakerTrippedAt', async () => {
    const svc = makeService();
    const r = await svc.resetBreaker('t1', 'a1');
    expect(r).toEqual({ breakerReset: true });
  });
});
```

> The `AgentsService` constructor arity is `(prisma, runtime, worker, runs)` from phase 13. The trust/resetBreaker methods only use `prisma`, so the test passes `{} as any` for the other three.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/api test -- agents-trust`
Expected: FAIL — `trust is not a function`.

- [ ] **Step 3: Implement in `agents.service.ts`**

3a. Imports: add `computeTrustScore`, `AgentStatus` already imported, and:
```ts
import { computeTrustScore, type AgentAutonomy } from '@pulsar/shared';
```

3b. Add `breakerTrippedAt: true,` to the `agentSelect` const (so `GET /agents/:id` exposes it).

3c. Add methods (before `validateKey`):
```ts
  /** Trust score from the agent's track record (proposals + runs). Computed on read. */
  async trust(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId }, select: { id: true, autonomyLevel: true } });
    if (!agent) throw new NotFoundException('Agent not found');
    const [executed, rejected, failed, runsSucceeded, runsTotal] = await Promise.all([
      this.prisma.proposedAction.count({ where: { tenantId, agentId: id, status: 'EXECUTED' } }),
      this.prisma.proposedAction.count({ where: { tenantId, agentId: id, status: 'REJECTED' } }),
      this.prisma.proposedAction.count({ where: { tenantId, agentId: id, status: 'FAILED' } }),
      this.prisma.agentRun.count({ where: { tenantId, agentId: id, status: 'SUCCEEDED' } }),
      this.prisma.agentRun.count({ where: { tenantId, agentId: id } }),
    ]);
    const result = computeTrustScore(
      { executed, rejected, failed, runsSucceeded, runsTotal, breakerTrips: 0 },
      agent.autonomyLevel as AgentAutonomy,
    );
    return { ...result, currentLevel: agent.autonomyLevel };
  }

  /** Human reset of a tripped circuit breaker. */
  async resetBreaker(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    await this.prisma.agent.update({ where: { id }, data: { breakerTrippedAt: null } });
    return { breakerReset: true };
  }
```
> `breakerTrips: 0` for now — there is no persisted trip counter; the penalty is approximated by the failure ratio. (Acceptable per the design; a counter can be added later.)

3d. Accept + validate `caps.policies` in create/update: in the existing `create`/`update`, `caps` is already passed through. Add a light validation helper called from both: every rule's `effect` must be `'AUTO'|'PROPOSE'|'DENY'`, `tool` (if set) must be a known tool name (`TOOL_BY_NAME`), `maxAmount` (if set) ≥ 0. Throw `BadRequestException` otherwise. Place near `applyAutonomy`:
```ts
  private validatePolicies(caps?: AgentCaps): void {
    const rules = caps?.policies;
    if (!rules) return;
    const valid = new Set(['AUTO', 'PROPOSE', 'DENY']);
    for (const r of rules) {
      if (!valid.has(r.effect)) throw new BadRequestException(`Invalid policy effect "${r.effect}"`);
      if (r.tool !== undefined && !TOOL_BY_NAME.has(r.tool)) throw new BadRequestException(`Unknown tool in policy "${r.tool}"`);
      if (r.maxAmount !== undefined && r.maxAmount < 0) throw new BadRequestException('policy maxAmount must be >= 0');
    }
  }
```
Import `TOOL_BY_NAME` from `./tool-registry`. Call `this.validatePolicies(input.caps)` at the top of both `create` and `update`.

- [ ] **Step 4: Add controller endpoints** — in `agents.controller.ts`, add (place `:id/trust` near the other GET `:id/...` before `@Get(':id')`, and `:id/reset-breaker` with the other POST `:id/...`):

```ts
  @Get(':id/trust')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  trust(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.trust(user.tenantId, id);
  }

  @Post(':id/reset-breaker')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  resetBreaker(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.resetBreaker(user.tenantId, id);
  }
```

- [ ] **Step 5: Run test + build**

Run: `pnpm --filter @pulsar/api test -- agents-trust` → PASS.
Run: `pnpm --filter @pulsar/api build` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/agents/agents.service.ts apps/api/src/core/agents/agents.controller.ts apps/api/src/core/agents/agents-trust.service.spec.ts
git commit -m "feat(api): GET /agents/:id/trust + POST /agents/:id/reset-breaker + policies validation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Web — policies editor + trust + breaker banners

**Files:**
- Modify: `apps/web/src/routes/(app)/agents/[id]/+page.svelte`

Follow the page's existing conventions (read it first; reuse Card/Badge/Button, the real `api()` signature, French copy, the phase-13 `runAction` pattern).

- [ ] **Step 1: Read the page** to match patterns: `sed -n '1,120p' "apps/web/src/routes/(app)/agents/[id]/+page.svelte"`.

- [ ] **Step 2: Add trust + breaker state + loaders**

```ts
type Trust = { score: number; readyForNext: boolean; nextLevel: string | null; reasons: string[]; currentLevel: string };
let trust = $state<Trust | null>(null);
async function loadTrust(id: string) {
  try { trust = await api<Trust>(`/agents/${id}/trust`); } catch { trust = null; }
}
async function resetBreaker() {
  busy = true;
  try { await api(`/agents/${id}/reset-breaker`, { method: 'POST' }); await load(); } finally { busy = false; }
}
async function promote() {
  if (!trust?.nextLevel) return;
  busy = true;
  try { await api(`/agents/${id}`, { method: 'PATCH', body: { autonomyLevel: trust.nextLevel } }); await load(); await loadTrust(id); } finally { busy = false; }
}
```
Call `loadTrust(id)` from the same `$effect` that loads the agent.

- [ ] **Step 3: Add the banners + a read-only policies summary**

A breaker banner (when `agent.breakerTrippedAt` is set): "Circuit breaker actif — l'agent est rétrogradé en PROPOSE" + a "Réarmer" button calling `resetBreaker()`.

A trust banner: show `trust.score` and, when `trust.readyForNext`, "Prêt pour {trust.nextLevel}" + a "Promouvoir" button calling `promote()`; otherwise show `trust.reasons` as muted text.

A read-only list of `agent.caps?.policies` (tool/tierMax/maxAmount/effect) when present, with a note that editing rules is done via the agent config. (A full rule editor is OPTIONAL — if the page already has a caps editor, extend it; otherwise a read-only summary + the dial is sufficient for this phase. Do NOT build a complex editor; YAGNI.)

Match existing Card/Badge/Button markup. Use `loading={busy}`/`disabled={busy}` on the buttons (consistent with the phase-13 controls).

- [ ] **Step 4: Build + typecheck**

Run: `pnpm --filter @pulsar/web build` → clean.
Run: `pnpm --filter @pulsar/web typecheck` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(app)/agents/[id]/+page.svelte"
git commit -m "feat(web): agent trust banner, autonomy promotion, circuit-breaker reset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Phase-14 e2e

**Files:**
- Create: `apps/api/test/phase14-autonomy.e2e-spec.ts`

Reuse the phase-13 e2e bootstrap (FakeAgentRuntimeService, `app.listen(0)`, login, `waitFor`, cleanup) — read `apps/api/test/phase13-workforce.e2e-spec.ts` and `phase12-operating-workbench.e2e-spec.ts` first. The fake runtime's `sendTurn` makes a REAL governed `/api/v1/mcp` tools/call, so policy decisions are exercised end-to-end.

- [ ] **Step 1: Implement the scenarios** (adapt assertions to real behavior; never weaken intent):

Register an agent and drive `/mcp` tools/calls (the fake's `setScript` controls which tool + args). Scenarios:
1. **AUTO under cap**: agent with `caps.policies = [{ tool:'create_load', effect:'AUTO' }]` (autonomyLevel PROPOSE), no maxAmount. Drive `create_load` → the MCP response is `autoApproved` AND a `ProposedAction { status:'EXECUTED', autoApproved:true, triggeredByRef }` exists for the agent.
2. **PROPOSE above rule cap**: policy `[{ tool:'tender_load', maxAmount: 1000, effect:'AUTO' }]`; drive `tender_load` with `amount: 5000` → response `queued`/PENDING; a `ProposedAction PENDING` exists.
3. **DENY above hard cap**: `caps.maxAmountPerAction = 100`, policy AUTO; drive `tender_load` amount 5000 → MCP `isError` (denied); NO new EXECUTED row.
4. **Rate cap closes on auto path**: policy AUTO for `create_load`, `caps.maxActionsPerMinute = 1`. Drive `create_load` twice in the same minute → first AUTO/EXECUTED, second demoted to PROPOSE/PENDING (the previously-open gap).
5. **Breaker**: configure the fake tool to fail (e.g. point `create_load` at args that make the underlying service throw, OR use a tool whose run throws). Drive it 3× (DEFAULT_BREAKER.consecutiveFailures) → `GET /agents/:id` shows `breakerTrippedAt` set; a subsequent AUTO-policy call is demoted to PROPOSE; `POST /agents/:id/reset-breaker` clears it and the next call is AUTO again. (If making the real service fail is awkward, assert the breaker via the unit test in Task 6 and keep the e2e to steps 1–4 + 6 — note this adaptation in your report.)
6. **Trust endpoint**: `GET /agents/:id/trust` → returns `{ score, readyForNext, nextLevel, currentLevel, reasons }` consistent with the agent's executed/rejected history.

Use `waitFor` for any outcome that depends on the eager worker; for direct `/mcp` calls the response is synchronous so assert directly. Unique ids per scenario; `afterAll` cleanup deletes the agent's proposedAction/agentRun rows + the agent.

- [ ] **Step 2: Run the e2e (DB up + seeded)**

Run: `pnpm db:migrate && pnpm db:seed` (if needed) then `pnpm --filter @pulsar/api test:e2e -- phase14-autonomy`
Expected: all scenarios pass. Run 2× to confirm determinism.

Also run the prior suites to confirm no regression: `pnpm --filter @pulsar/api test:e2e -- phase12-operating-workbench phase13-workforce phase14-autonomy`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/phase14-autonomy.e2e-spec.ts
git commit -m "test(api): phase-14 e2e — policy gate (auto/propose/deny), rate-cap close, breaker, trust

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Hard rule 29 + docs + full verification

**Files:**
- Modify: `CLAUDE.md`, `ROADMAP.md`, `docs/etat-du-projet.md`

- [ ] **Step 1: Add hard rule 29 to `CLAUDE.md`** — after the phase-13 rule 28 block:

```markdown
## Hard rules (continued, phase 14)

29. (phase 14 — Autonomie & policies) Toute décision auto-act vs propose passe par
    `evaluatePolicy` (`@pulsar/shared`, pur) au **point d'application unique** du handler MCP
    (`ProposedActionsService.handleMutatingTool`) ; les règles effectives viennent de
    `caps.policies` ou du preset dérivé de `autonomyLevel` (+ `caps.autoApprove` legacy). Une
    action auto-approuvée est TOUJOURS persistée comme `ProposedAction EXECUTED autoApproved=true`
    (auditable + comptée pour le cap débit — le chemin auto respecte désormais le débit). Le
    circuit breaker (`Agent.breakerTrippedAt`) rétrograde en PROPOSE de façon réversible et ne
    modifie JAMAIS `autonomyLevel` ; la promotion d'autonomie est TOUJOURS confirmée par un humain
    (jamais d'escalade automatique). Le plafond dur `maxAmountPerAction` n'est jamais levé par
    l'autonomie (au-dessus → DENY) — règles 23/24 préservées.
```

- [ ] **Step 2: Update `ROADMAP.md`** — flip the phase 14 bullet to `✅ **14 —` shipped, matching the phase-13 entry style; summarize: unified policy gate (`evaluatePolicy`), policy-as-data (`caps.policies` + dial preset), auto-execution persisted in the proposals ledger (rate-cap gap closed), reversible circuit breaker (demote to PROPOSE), trust score + human-confirmed promotion, 23rd migration, rule 29.

- [ ] **Step 3: Update `docs/etat-du-projet.md`** — note phase 14 shipped, migrations 22→23, next = phase 15 (Control Tower). Match the doc's format.

- [ ] **Step 4: Full verification**

```bash
pnpm build
pnpm test
pnpm --filter @pulsar/api test:e2e -- phase12-operating-workbench phase13-workforce phase14-autonomy
```
All must pass (build shared→database→api→web; all unit suites incl. the new policy/breaker/trust/autonomy specs; e2e green). If anything fails, STOP and report BLOCKED with the exact output (docs-only edits are fine; do not force code to pass).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md ROADMAP.md docs/etat-du-projet.md
git commit -m "docs(phase-14): hard rule 29 + roadmap/status — autonomy & policy engine shipped

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Unified policy engine (rules-as-data, single gate) → Tasks 1, 6, 7. ✅
- Closes rate-cap gap on auto path → Task 6 (`recentExecutionCount` feeds the gate; auto actions now persisted so they count). ✅
- Auto-approved actions persisted as EXECUTED autoApproved → Tasks 4 + 6. ✅
- Backward compatibility (dial preset + legacy autoApprove, no data migration) → Task 1 (`effectivePolicies`). ✅
- Trust score + suggested (human-confirmed) promotion → Tasks 3, 8 (`trust`), 9 (promote button). ✅
- Circuit breaker → demote to PROPOSE, reversible (auto-rearm + reset) → Tasks 2, 6 (`isBreakerTripped`/`maybeTripBreaker`), 8 (`resetBreaker`). ✅
- Hard cap never lifted (DENY above) → Task 1 (`evaluatePolicy`). ✅
- 23rd migration → Task 4. ✅
- API trust + reset-breaker, policies validation → Task 8. ✅
- UI → Task 9. Rule 29 → Task 11. ✅
- Tests: unit (policy/breaker/trust/service) + e2e 6 scenarios → Tasks 1–3, 6, 8, 10. ✅

**Placeholder scan:** Task 9 intentionally scopes the rule editor as optional (read-only summary + dial sufficient) to avoid over-building; all other steps carry complete code. Task 10 scenario 5 (breaker) carries an explicit adaptation fallback if forcing a real service failure is awkward — flagged, not a placeholder.

**Type consistency:** `evaluatePolicy(rules, ctx)`, `effectivePolicies(policies, level, autoApprove)`, `computeTrustScore(stats, level)`, `evaluateCircuitBreaker(recent, cfg)` signatures are consistent across Tasks 1–3 and their consumers in Tasks 6/8. `handleMutatingTool(principal, def, args, services)` defined in Task 6, called in Task 7. `AgentPrincipal.autonomyLevel` added in Task 5, consumed in Task 6. `ProposedActionsService` constructor gains `NotificationsService` (Task 6) — the Task 8 unit test and any existing construction must pass it (`{} as any` in unit tests; DI provides it in the app). NOTE for implementer: after Task 6, grep for existing `new ProposedActionsService(` / its test specs and update their arity (same lesson as phase-13's domain-events spec).

**Known accepted imprecision:** `breakerTrips` is passed as 0 to `computeTrustScore` (no persisted trip counter yet) — documented; the failure ratio already penalizes a misbehaving agent. A trip counter can be added in phase 15 (Control Tower) where per-agent KPIs are first-class.
```
