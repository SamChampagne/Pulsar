# Agent Governance + MCP Exposure (palier 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Pulsar's dispatch operations as scoped, authenticated MCP tools so an external agent (Hermes or any MCP client) can read live and *propose* mutating actions that a human approves in Pulsar.

**Architecture:** New `Agent` identity (cousin of `ApiKey`, with its own permission set + caps + dedicated hidden DISABLED service-user). A stateless MCP Streamable-HTTP endpoint authenticates by agent key and lists only the tools allowed by the agent's permissions ∩ the tenant's modules. READ/LOW tools execute live; MUTATING/SENSITIVE tools enqueue a `ProposedAction` (idempotent, cap-checked) instead of acting. A human approves/rejects in a new web inbox; approval re-checks caps + status and runs the real service call, attributed to the agent and audited with the approver. No LLM runs in Pulsar at this palier.

**Tech Stack:** NestJS 11 (Express), Prisma/PostgreSQL, `@modelcontextprotocol/sdk` (Streamable HTTP server transport, stateless), `zod` (tool input schemas), SvelteKit (Svelte 5 runes), Jest + supertest (e2e), Vitest (shared unit tests).

**Spec:** `docs/superpowers/specs/2026-06-13-agents-gouvernance-mcp-design.md`

**Conventions to honor (CLAUDE.md):** tenant isolation from the principal (rule 1); status changes through state machines (rule 2); enums mirrored in `packages/shared` + `schema.prisma` (rule 3); apps import Prisma via `@pulsar/database` (rule 4); every endpoint `@RequirePermissions` (rule 5); audit sensitive mutations (rule 6); rebuild shared/database after changing them (rule 7); service-account-style users never loginable (rule 13). After editing `packages/shared` or `packages/database`, run `pnpm --filter @pulsar/shared build` / `pnpm --filter @pulsar/database build` (or `pnpm setup`) before the API consumes them.

---

## File Structure

**`packages/shared/src/agents/`** (new) — source of truth for the governance vocabulary, pure & unit-tested:
- `risk.ts` — `RiskTier`, `AgentStatus`, `ProposalStatus` enums; `TOOL_TIERS`-agnostic pure helpers `evaluateAmountCap`, `evaluateRateCap`, `deriveIdempotencyKey`.
- `risk.spec.ts` — vitest unit tests.
- re-export from `packages/shared/src/index.ts`.

**`packages/shared/src/permissions.ts`** (modify) — add `AGENTS_*` keys + catalog entries.

**`packages/database/prisma/schema.prisma`** (modify) — `Agent`, `ProposedAction` models + 3 enums; new migration.

**`apps/api/src/core/agents/`** (new) — the whole backend feature, co-located by responsibility:
- `agents.service.ts` — register/list/revoke agents; per-agent service user; key validation → agent principal.
- `agent-principal.ts` — `AgentPrincipal` type + helper to build it.
- `agents.controller.ts` — REST CRUD for agent registration (human-facing, JWT-auth).
- `proposed-actions.service.ts` — enqueue (idempotent + cap-checked), list, approve (execute + audit), reject.
- `proposed-actions.controller.ts` — REST inbox (list pending / approve / reject), JWT-auth.
- `tool-registry.ts` — the 8 dispatch tools: name → {tier, permission, module, zod schema, handler, amountFrom?}.
- `mcp.controller.ts` — `POST /mcp` public route; agent-key auth; per-request stateless `McpServer`.
- `mcp-server.factory.ts` — builds an `McpServer` scoped to one agent principal.
- `agents.module.ts` — wires controllers + providers; imports the TMS services the tools reuse.

**`apps/web/src/routes/(app)/settings/agents/+page.svelte`** (new) — register/list/revoke agents, show key once, set permissions + caps.
**`apps/web/src/routes/(app)/agent-actions/+page.svelte`** (new) — pending proposals inbox, approve/reject.
**`apps/web/src/routes/(app)/+layout.svelte`** (modify) — nav entry + pending-count badge.

**`apps/api/test/phase11-agents.e2e-spec.ts`** (new) — end-to-end governance flow.

---

## Task 1: Shared governance vocabulary + pure helpers

**Files:**
- Create: `packages/shared/src/agents/risk.ts`
- Test: `packages/shared/src/agents/risk.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/agents/risk.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  RiskTier,
  isExecutableLive,
  evaluateAmountCap,
  evaluateRateCap,
  deriveIdempotencyKey,
} from './risk';

describe('risk tiers', () => {
  it('READ and LOW execute live; MUTATING and SENSITIVE do not', () => {
    expect(isExecutableLive(RiskTier.READ)).toBe(true);
    expect(isExecutableLive(RiskTier.LOW)).toBe(true);
    expect(isExecutableLive(RiskTier.MUTATING)).toBe(false);
    expect(isExecutableLive(RiskTier.SENSITIVE)).toBe(false);
  });
});

describe('evaluateAmountCap', () => {
  it('passes when no cap is set', () => {
    expect(evaluateAmountCap(5000, undefined)).toEqual({ ok: true });
  });
  it('passes when amount is within cap', () => {
    expect(evaluateAmountCap(1000, 1500)).toEqual({ ok: true });
  });
  it('passes when amount is unknown', () => {
    expect(evaluateAmountCap(undefined, 1500)).toEqual({ ok: true });
  });
  it('fails when amount exceeds cap', () => {
    const r = evaluateAmountCap(2000, 1500);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('2000');
  });
});

describe('evaluateRateCap', () => {
  it('passes when under the per-minute limit', () => {
    expect(evaluateRateCap(3, 10)).toEqual({ ok: true });
  });
  it('passes when no limit is set', () => {
    expect(evaluateRateCap(99, undefined)).toEqual({ ok: true });
  });
  it('fails at or above the limit', () => {
    expect(evaluateRateCap(10, 10).ok).toBe(false);
  });
});

describe('deriveIdempotencyKey', () => {
  it('is stable regardless of key ordering in args', () => {
    const a = deriveIdempotencyKey('tender_load', { loadId: 'L1', carrierId: 'C1' });
    const b = deriveIdempotencyKey('tender_load', { carrierId: 'C1', loadId: 'L1' });
    expect(a).toBe(b);
  });
  it('differs when tool or args differ', () => {
    const a = deriveIdempotencyKey('tender_load', { loadId: 'L1' });
    const b = deriveIdempotencyKey('tender_load', { loadId: 'L2' });
    const c = deriveIdempotencyKey('cancel_order', { loadId: 'L1' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- risk`
Expected: FAIL — `Cannot find module './risk'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/agents/risk.ts`:

```ts
import { createHash } from 'node:crypto';

/** How a tool call is governed — independent of the RBAC permission it requires. */
export enum RiskTier {
  READ = 'READ',
  LOW = 'LOW',
  MUTATING = 'MUTATING',
  SENSITIVE = 'SENSITIVE',
}

export enum AgentStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

export enum ProposalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED',
}

/** READ/LOW run immediately in the MCP handler; MUTATING/SENSITIVE go to the queue. */
export function isExecutableLive(tier: RiskTier): boolean {
  return tier === RiskTier.READ || tier === RiskTier.LOW;
}

export interface CapResult {
  ok: boolean;
  reason?: string;
}

/** Monetary ceiling per action. Unknown amount or unset cap => pass. */
export function evaluateAmountCap(amount: number | undefined, maxAmount: number | undefined): CapResult {
  if (amount === undefined || maxAmount === undefined) return { ok: true };
  if (amount > maxAmount) {
    return { ok: false, reason: `Amount ${amount} exceeds the agent cap of ${maxAmount}.` };
  }
  return { ok: true };
}

/** Throughput ceiling. `recentCount` = proposals in the trailing minute. Unset limit => pass. */
export function evaluateRateCap(recentCount: number, maxPerMinute: number | undefined): CapResult {
  if (maxPerMinute === undefined) return { ok: true };
  if (recentCount >= maxPerMinute) {
    return { ok: false, reason: `Rate limit of ${maxPerMinute} actions/minute reached.` };
  }
  return { ok: true };
}

/** Stable hash of tool + canonicalized args — the default idempotency key. */
export function deriveIdempotencyKey(tool: string, args: Record<string, unknown>): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  return createHash('sha256').update(`${tool}:${canonical}`).digest('hex').slice(0, 32);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pulsar/shared test -- risk`
Expected: PASS (all cases green).

- [ ] **Step 5: Re-export and build shared**

Add to `packages/shared/src/index.ts` (next to the other `export *` lines):

```ts
export * from './agents/risk';
```

Run: `pnpm --filter @pulsar/shared build`
Expected: build succeeds, `dist/` updated.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agents packages/shared/src/index.ts
git commit -m "feat(shared): agent risk tiers, cap evaluation, idempotency key"
```

---

## Task 2: Agent permission keys

**Files:**
- Modify: `packages/shared/src/permissions.ts`

- [ ] **Step 1: Add the permission constants**

In `packages/shared/src/permissions.ts`, inside `PERMISSIONS.CORE` (after `API_KEYS_MANAGE`):

```ts
    API_KEYS_READ: 'api-keys.read',
    API_KEYS_MANAGE: 'api-keys.manage',
    AGENTS_READ: 'agents.read',
    AGENTS_MANAGE: 'agents.manage',
    AGENTS_ACTIONS_READ: 'agents.actions.read',
    AGENTS_ACTIONS_APPROVE: 'agents.actions.approve',
```

(Keep the existing `API_KEYS_*` lines; only the four `AGENTS_*` lines are new.)

- [ ] **Step 2: Add the catalog entries**

In the `PERMISSION_CATALOG` array, after the two `API_KEYS_*` `core(...)` rows:

```ts
  core(PERMISSIONS.CORE.AGENTS_READ, 'View AI agents and their configuration'),
  core(PERMISSIONS.CORE.AGENTS_MANAGE, 'Register, configure and revoke AI agents'),
  core(PERMISSIONS.CORE.AGENTS_ACTIONS_READ, 'View agent-proposed actions'),
  core(PERMISSIONS.CORE.AGENTS_ACTIONS_APPROVE, 'Approve or reject agent-proposed actions'),
```

- [ ] **Step 3: Build shared and verify the type compiles**

Run: `pnpm --filter @pulsar/shared build`
Expected: success. `ALL_PERMISSION_KEYS` now includes the four new keys (it is derived from the catalog).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/permissions.ts
git commit -m "feat(shared): agents.* permission catalog entries"
```

---

## Task 3: Prisma models + migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: a new migration under `packages/database/prisma/migrations/`

- [ ] **Step 1: Add enums + models to the schema**

Append to `packages/database/prisma/schema.prisma` (enum value names MUST match `packages/shared` exactly — rule 3):

```prisma
enum AgentStatus {
  ACTIVE
  REVOKED
}

enum RiskTier {
  READ
  LOW
  MUTATING
  SENSITIVE
}

enum ProposalStatus {
  PENDING
  APPROVED
  REJECTED
  EXECUTED
  FAILED
}

model Agent {
  id            String      @id @default(cuid())
  tenantId      String
  name          String
  description   String?
  permissions   String[]
  caps          Json        @default("{}")
  prefix        String
  secretHash    String      @unique
  serviceUserId String
  status        AgentStatus @default(ACTIVE)
  lastUsedAt    DateTime?
  createdById   String?
  createdAt     DateTime    @default(now())
  revokedAt     DateTime?

  tenant      Tenant            @relation(fields: [tenantId], references: [id])
  serviceUser User              @relation("AgentServiceUser", fields: [serviceUserId], references: [id])
  proposals   ProposedAction[]

  @@index([tenantId])
  @@map("agents")
}

model ProposedAction {
  id             String         @id @default(cuid())
  tenantId       String
  agentId        String
  triggeredByRef String?
  tool           String
  argsJson       Json
  riskTier       RiskTier
  status         ProposalStatus @default(PENDING)
  idempotencyKey String
  decidedById    String?
  decidedAt      DateTime?
  resultJson     Json?
  proposedAt     DateTime       @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id])
  agent  Agent  @relation(fields: [agentId], references: [id])

  @@unique([agentId, idempotencyKey])
  @@index([tenantId, status])
  @@map("proposed_actions")
}
```

- [ ] **Step 2: Add the back-relations on `Tenant` and `User`**

Find `model Tenant {` and add to its relation block:

```prisma
  agents          Agent[]
  proposedActions ProposedAction[]
```

Find `model User {` and add:

```prisma
  agentServiceFor Agent[] @relation("AgentServiceUser")
```

- [ ] **Step 3: Create the migration**

In the local cloud session Postgres uses non-interactive migration generation (see migration history). Run from repo root:

```bash
pnpm --filter @pulsar/database exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > packages/database/prisma/migrations/20260613210000_phase11_agents/migration.sql
```

If your environment supports interactive dev migrations instead, use:

```bash
pnpm db:migrate   # prisma migrate dev --name phase11_agents
```

Either way the resulting SQL must create the three enums, `agents`, `proposed_actions`, the FKs, the `@@unique([agentId, idempotencyKey])` index, and `@@index([tenantId, status])`.

- [ ] **Step 4: Apply, regenerate client, rebuild database package**

```bash
pnpm db:migrate          # or: prisma migrate deploy, per environment
pnpm db:generate
pnpm --filter @pulsar/database build
```

Expected: client regenerates with `Agent`, `ProposedAction`, and the new enums available from `@pulsar/database`.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): Agent + ProposedAction models, 16th migration"
```

---

## Task 4: AgentsService — registration, key validation, per-agent service user

**Files:**
- Create: `apps/api/src/core/agents/agent-principal.ts`
- Create: `apps/api/src/core/agents/agents.service.ts`

- [ ] **Step 1: Define the agent principal type**

Create `apps/api/src/core/agents/agent-principal.ts`:

```ts
import type { AuthUser, PermissionKey } from '@pulsar/shared';

/** Caps stored on Agent.caps (all optional). */
export interface AgentCaps {
  maxAmountPerAction?: number;
  maxActionsPerMinute?: number;
  toolAllowlist?: string[];
  autoApprove?: string[];
}

/**
 * Resolved agent identity used by the MCP layer. `user` is the AuthUser of the
 * agent's hidden service account (for tenant isolation + FK/audit attribution).
 */
export interface AgentPrincipal {
  agentId: string;
  name: string;
  caps: AgentCaps;
  user: AuthUser; // id = service user id, permissions = agent.permissions
}

export const isAgentPermission = (p: string): p is PermissionKey => typeof p === 'string';
```

- [ ] **Step 2: Write the service (mirrors ApiKeysService, one hidden user *per agent*)**

Create `apps/api/src/core/agents/agents.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser, PermissionKey } from '@pulsar/shared';
import { ALL_PERMISSION_KEYS, AgentStatus } from '@pulsar/shared';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AgentCaps, AgentPrincipal } from './agent-principal';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const agentSelect = {
  id: true,
  name: true,
  description: true,
  permissions: true,
  caps: true,
  prefix: true,
  status: true,
  lastUsedAt: true,
  createdAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** One hidden DISABLED user PER agent — audit shows the specific agent, never loginable (rule 13). */
  private async createServiceUser(tenantId: string, name: string): Promise<string> {
    const created = await this.prisma.user.create({
      data: {
        tenantId,
        email: `agent+${randomBytes(8).toString('hex')}@pulsar.local`,
        passwordHash: sha256(randomBytes(32).toString('hex')),
        firstName: 'Agent',
        lastName: name.slice(0, 60),
        status: 'DISABLED',
      },
      select: { id: true },
    });
    return created.id;
  }

  list(tenantId: string) {
    return this.prisma.agent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: agentSelect,
    });
  }

  /** Returns the full key ONCE — only the hash is stored. */
  async create(
    tenantId: string,
    createdById: string,
    input: { name: string; description?: string; permissions: string[]; caps?: AgentCaps },
  ) {
    const valid = new Set<string>(ALL_PERMISSION_KEYS);
    for (const p of input.permissions) {
      if (!valid.has(p)) throw new BadRequestException(`Unknown permission "${p}"`);
    }
    const serviceUserId = await this.createServiceUser(tenantId, input.name);
    const rawKey = `ak_${randomBytes(24).toString('base64url')}`;
    const record = await this.prisma.agent.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description,
        permissions: input.permissions,
        caps: (input.caps ?? {}) as object,
        prefix: rawKey.slice(0, 11),
        secretHash: sha256(rawKey),
        serviceUserId,
        createdById,
      },
      select: agentSelect,
    });
    return { ...record, key: rawKey };
  }

  async revoke(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    await this.prisma.agent.update({
      where: { id },
      data: { status: AgentStatus.REVOKED, revokedAt: new Date() },
    });
    return { revoked: true };
  }

  /** Resolve a raw agent key into a full principal (service user + caps + scoped permissions). */
  async validateKey(rawKey: string): Promise<AgentPrincipal> {
    const agent = await this.prisma.agent.findUnique({ where: { secretHash: sha256(rawKey) } });
    if (!agent || agent.status === AgentStatus.REVOKED) {
      throw new UnauthorizedException('Invalid agent key');
    }
    void this.prisma.agent
      .update({ where: { id: agent.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    const user: AuthUser = {
      id: agent.serviceUserId,
      tenantId: agent.tenantId,
      email: `agent:${agent.name}`,
      firstName: 'Agent',
      lastName: agent.name,
      permissions: agent.permissions as PermissionKey[],
    };
    return { agentId: agent.id, name: agent.name, caps: (agent.caps ?? {}) as AgentCaps, user };
  }
}
```

- [ ] **Step 3: Typecheck (no test yet — covered by e2e in Task 11)**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes (module not yet registered; that is Task 10).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/core/agents/agent-principal.ts apps/api/src/core/agents/agents.service.ts
git commit -m "feat(api): AgentsService — registration + per-agent service user + key validation"
```

---

## Task 5: AgentsController — human-facing registration CRUD

**Files:**
- Create: `apps/api/src/core/agents/agents.controller.ts`

- [ ] **Step 1: Write the controller (mirrors ApiKeysController)**

Create `apps/api/src/core/agents/agents.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { ArrayMinSize, IsArray, IsObject, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentsService } from './agents.service';
import type { AgentCaps } from './agent-principal';

class CreateAgentDto {
  @IsString() name!: string;

  @IsOptional() @IsString() description?: string;

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  permissions!: string[];

  @IsOptional() @IsObject()
  caps?: AgentCaps;
}

@ApiTags('core/agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.agents.list(user.tenantId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAgentDto) {
    return this.agents.create(user.tenantId, user.id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.revoke(user.tenantId, id);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/core/agents/agents.controller.ts
git commit -m "feat(api): AgentsController — register/list/revoke agents"
```

---

## Task 6: Tool registry — the 8 dispatch tools

**Files:**
- Create: `apps/api/src/core/agents/tool-registry.ts`

This registry is the single source of truth mapping tool name → governance metadata + a handler that reuses existing TMS services. The handler is called *directly* for READ/LOW tools and *on approval* for MUTATING/SENSITIVE tools.

- [ ] **Step 1: Write the registry**

Create `apps/api/src/core/agents/tool-registry.ts`:

```ts
import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ModuleKey, PermissionKey } from '@pulsar/shared';
import type { AgentPrincipal } from './agent-principal';

/** Services the tools delegate to. Injected by the module; kept as an interface to avoid cycles. */
export interface ToolServices {
  transportOrders: { list(tenantId: string, query: object): Promise<unknown> };
  loads: {
    findOne(tenantId: string, id: string): Promise<unknown>;
    rateOptions(tenantId: string, id: string): Promise<unknown>;
    create(tenantId: string, userId: string, dto: object): Promise<unknown>;
  };
  shipments: {
    list(tenantId: string, query: object): Promise<unknown>;
    assignToLoad(tenantId: string, userId: string, id: string, loadId: string): Promise<unknown>;
  };
  tenders: {
    create(tenantId: string, userId: string, loadId: string, dto: object): Promise<unknown>;
  };
  analytics: { carrierScorecard(tenantId: string): Promise<unknown> };
}

export interface ToolContext {
  principal: AgentPrincipal;
  services: ToolServices;
}

export interface ToolDef {
  name: string;
  description: string;
  tier: RiskTier;
  permission: PermissionKey;
  module: ModuleKey;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** Executes the real operation. Live for READ/LOW; on approval for MUTATING/SENSITIVE. */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
  /** Optional monetary amount used for cap evaluation at enqueue time. */
  amountFrom?(args: Record<string, unknown>): number | undefined;
}

const T = PERMISSIONS.TRANSPORTATION;

export const TOOL_REGISTRY: ToolDef[] = [
  {
    name: 'list_transport_orders',
    description: 'List transport orders for the tenant (paginated).',
    tier: RiskTier.READ,
    permission: T.ORDERS_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().positive().optional() }),
    run: (args, ctx) => ctx.services.transportOrders.list(ctx.principal.user.tenantId, args),
  },
  {
    name: 'get_load',
    description: 'Get a single load by id, including resources and route.',
    tier: RiskTier.READ,
    permission: T.PLANNING_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({ loadId: z.string().min(1) }),
    run: (args, ctx) => ctx.services.loads.findOne(ctx.principal.user.tenantId, args.loadId as string),
  },
  {
    name: 'list_shipments',
    description: 'List shipments for the tenant (paginated).',
    tier: RiskTier.READ,
    permission: T.PLANNING_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().positive().optional() }),
    run: (args, ctx) => ctx.services.shipments.list(ctx.principal.user.tenantId, args),
  },
  {
    name: 'rate_options',
    description: 'Get ranked rate options for a load (rate shopping).',
    tier: RiskTier.READ,
    permission: T.PLANNING_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({ loadId: z.string().min(1) }),
    run: (args, ctx) => ctx.services.loads.rateOptions(ctx.principal.user.tenantId, args.loadId as string),
  },
  {
    name: 'carrier_scorecard',
    description: 'Carrier scorecard / KPIs for the tenant.',
    tier: RiskTier.READ,
    permission: T.ANALYTICS_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({}),
    run: (_args, ctx) => ctx.services.analytics.carrierScorecard(ctx.principal.user.tenantId),
  },
  {
    name: 'create_load',
    description: 'Create a new load. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: T.PLANNING_MANAGE,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({ mode: z.string().optional(), carrierId: z.string().optional() }).passthrough(),
    run: (args, ctx) => ctx.services.loads.create(ctx.principal.user.tenantId, ctx.principal.user.id, args),
  },
  {
    name: 'assign_shipment',
    description: 'Assign a shipment to a load. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: T.PLANNING_MANAGE,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({ shipmentId: z.string().min(1), loadId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.shipments.assignToLoad(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.shipmentId as string,
        args.loadId as string,
      ),
  },
  {
    name: 'tender_load',
    description: 'Tender a load to a carrier. PROPOSED — requires human approval.',
    tier: RiskTier.SENSITIVE,
    permission: T.PLANNING_MANAGE,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({
      loadId: z.string().min(1),
      carrierId: z.string().min(1),
      amount: z.number().optional(),
      expiresInHours: z.number().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.tenders.create(ctx.principal.user.tenantId, ctx.principal.user.id, args.loadId as string, args),
    amountFrom: (args) => (typeof args.amount === 'number' ? args.amount : undefined),
  },
];

export const TOOL_BY_NAME = new Map<string, ToolDef>(TOOL_REGISTRY.map((t) => [t.name, t]));
```

> NOTE for the implementer: the `ToolServices` method shapes above are the *contract* this plan assumes. In Step 2 you verify them against the real services and adjust the adapter in Task 10 (the module wires concrete services to this interface). If a real signature differs (e.g. `loads.rateOptions` is named `getRateOptions`), adapt in the module's provider, NOT here.

- [ ] **Step 2: Verify the real TMS service signatures**

Run these and reconcile the `ToolServices` interface to the actual method names/args:

Run: `grep -n "rateOption\|getRateOptions\|rate-options" apps/api/src/modules/transportation/loads/loads.service.ts`
Run: `grep -n "assignToLoad\|class ShipmentsService" apps/api/src/modules/transportation/shipments/shipments.service.ts`
Run: `grep -n "create(" apps/api/src/modules/transportation/tenders/tenders.service.ts`
Run: `grep -n "scorecard\|class.*AnalyticsService" apps/api/src/modules/transportation/analytics/*.ts`

Expected: confirm each method exists; update `ToolServices` signatures in `tool-registry.ts` if names differ.

- [ ] **Step 3: Add `zod` dependency**

Run: `pnpm --filter @pulsar/api add zod`
Expected: `zod` appears in `apps/api/package.json` dependencies.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/agents/tool-registry.ts apps/api/package.json
git commit -m "feat(api): dispatch tool registry (8 tools, tiers, permissions)"
```

---

## Task 7: ProposedActionsService — enqueue (idempotent + capped), list, approve, reject

**Files:**
- Create: `apps/api/src/core/agents/proposed-actions.service.ts`

- [ ] **Step 1: Write the service**

Create `apps/api/src/core/agents/proposed-actions.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@pulsar/shared';
import {
  ProposalStatus,
  RiskTier,
  deriveIdempotencyKey,
  evaluateAmountCap,
  evaluateRateCap,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AgentPrincipal } from './agent-principal';
import { TOOL_BY_NAME, type ToolServices } from './tool-registry';

@Injectable()
export class ProposedActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * Enqueue a mutating/sensitive tool call. Idempotent on (agentId, key); caps re-checked here.
   * Returns the (possibly pre-existing) proposal projection.
   */
  async enqueue(
    principal: AgentPrincipal,
    tool: string,
    args: Record<string, unknown>,
    opts: { idempotencyKey?: string; triggeredByRef?: string },
  ) {
    const def = TOOL_BY_NAME.get(tool);
    if (!def) throw new BadRequestException(`Unknown tool "${tool}"`);

    const key = opts.idempotencyKey ?? deriveIdempotencyKey(tool, args);
    const existing = await this.prisma.proposedAction.findUnique({
      where: { agentId_idempotencyKey: { agentId: principal.agentId, idempotencyKey: key } },
    });
    if (existing) return this.project(existing);

    // Caps (amount + rate) before creating the proposal.
    const amount = def.amountFrom?.(args);
    const amountCap = evaluateAmountCap(amount, principal.caps.maxAmountPerAction);
    if (!amountCap.ok) throw new BadRequestException(amountCap.reason);

    const since = new Date(Date.now() - 60_000);
    const recent = await this.prisma.proposedAction.count({
      where: { agentId: principal.agentId, proposedAt: { gte: since } },
    });
    const rateCap = evaluateRateCap(recent, principal.caps.maxActionsPerMinute);
    if (!rateCap.ok) throw new BadRequestException(rateCap.reason);

    const created = await this.prisma.proposedAction.create({
      data: {
        tenantId: principal.user.tenantId,
        agentId: principal.agentId,
        triggeredByRef: opts.triggeredByRef,
        tool,
        argsJson: args as object,
        riskTier: def.tier,
        idempotencyKey: key,
        status: ProposalStatus.PENDING,
      },
    });
    await this.audit.log({
      tenantId: principal.user.tenantId,
      userId: principal.user.id,
      action: AuditAction.CREATE,
      entityType: 'proposed-action',
      entityId: created.id,
      after: { tool, tier: def.tier, agent: principal.name },
    });
    return this.project(created);
  }

  listPending(tenantId: string) {
    return this.prisma.proposedAction.findMany({
      where: { tenantId, status: ProposalStatus.PENDING },
      orderBy: { proposedAt: 'asc' },
    });
  }

  /** Approve + execute. Re-checks status (race-safe) then runs the tool's real handler. */
  async approve(tenantId: string, id: string, approverId: string, services: ToolServices) {
    const proposal = await this.prisma.proposedAction.findFirst({ where: { id, tenantId } });
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException(`Proposal is ${proposal.status}, not PENDING`);
    }
    const def = TOOL_BY_NAME.get(proposal.tool);
    if (!def) throw new BadRequestException(`Unknown tool "${proposal.tool}"`);

    // Race-safe claim: only one approver moves PENDING -> APPROVED.
    const claimed = await this.prisma.proposedAction.updateMany({
      where: { id, status: ProposalStatus.PENDING },
      data: { status: ProposalStatus.APPROVED, decidedById: approverId, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw new BadRequestException('Proposal already decided');

    const agent = await this.prisma.agent.findUniqueOrThrow({ where: { id: proposal.agentId } });
    const principal: AgentPrincipal = {
      agentId: agent.id,
      name: agent.name,
      caps: (agent.caps ?? {}) as AgentPrincipal['caps'],
      user: {
        id: agent.serviceUserId,
        tenantId: agent.tenantId,
        email: `agent:${agent.name}`,
        firstName: 'Agent',
        lastName: agent.name,
        permissions: agent.permissions as AgentPrincipal['user']['permissions'],
      },
    };

    try {
      const result = await def.run(proposal.argsJson as Record<string, unknown>, { principal, services });
      const done = await this.prisma.proposedAction.update({
        where: { id },
        data: { status: ProposalStatus.EXECUTED, resultJson: (result ?? {}) as object },
      });
      await this.audit.log({
        tenantId,
        userId: principal.user.id,
        action: AuditAction.UPDATE,
        entityType: 'proposed-action',
        entityId: id,
        after: { status: 'EXECUTED', tool: proposal.tool, approvedBy: approverId },
      });
      return this.project(done);
    } catch (err) {
      const failed = await this.prisma.proposedAction.update({
        where: { id },
        data: { status: ProposalStatus.FAILED, resultJson: { error: String(err) } },
      });
      return this.project(failed);
    }
  }

  async reject(tenantId: string, id: string, approverId: string) {
    const claimed = await this.prisma.proposedAction.updateMany({
      where: { id, tenantId, status: ProposalStatus.PENDING },
      data: { status: ProposalStatus.REJECTED, decidedById: approverId, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw new BadRequestException('Proposal not pending');
    await this.audit.log({
      tenantId,
      userId: approverId,
      action: AuditAction.UPDATE,
      entityType: 'proposed-action',
      entityId: id,
      after: { status: 'REJECTED' },
    });
    return { rejected: true };
  }

  private project(p: {
    id: string; tool: string; riskTier: RiskTier; status: ProposalStatus;
    argsJson: unknown; proposedAt: Date; resultJson: unknown; triggeredByRef: string | null;
  }) {
    return {
      id: p.id,
      tool: p.tool,
      riskTier: p.riskTier,
      status: p.status,
      args: p.argsJson,
      triggeredByRef: p.triggeredByRef,
      proposedAt: p.proposedAt,
      result: p.resultJson,
    };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes (verify `AuditAction.CREATE`/`UPDATE` exist via `grep -n "enum AuditAction" packages/shared/src/**` — adjust to the real members if named differently).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/core/agents/proposed-actions.service.ts
git commit -m "feat(api): ProposedActionsService — idempotent enqueue, capped, race-safe approve/reject"
```

---

## Task 8: MCP server factory — per-agent scoped tool surface

**Files:**
- Create: `apps/api/src/core/agents/mcp-server.factory.ts`

- [ ] **Step 1: Write the factory**

Create `apps/api/src/core/agents/mcp-server.factory.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isExecutableLive } from '@pulsar/shared';
import type { AgentPrincipal } from './agent-principal';
import type { ProposedActionsService } from './proposed-actions.service';
import { TOOL_REGISTRY, type ToolServices } from './tool-registry';

/**
 * Build a fresh stateless McpServer exposing ONLY the tools this agent may use
 * (permission ∩ enabled modules ∩ optional caps.toolAllowlist). READ/LOW run live;
 * MUTATING/SENSITIVE enqueue a proposal.
 */
export function buildAgentMcpServer(
  principal: AgentPrincipal,
  enabledModules: Set<string>,
  proposals: ProposedActionsService,
  services: ToolServices,
): McpServer {
  const server = new McpServer({ name: 'pulsar', version: '1.0.0' });
  const allowlist = principal.caps.toolAllowlist;
  const granted = new Set(principal.user.permissions as string[]);

  for (const def of TOOL_REGISTRY) {
    if (!granted.has(def.permission)) continue;
    if (!enabledModules.has(def.module)) continue;
    if (allowlist && !allowlist.includes(def.name)) continue;

    server.registerTool(
      def.name,
      { title: def.name, description: def.description, inputSchema: def.inputSchema.shape },
      async (args: Record<string, unknown>) => {
        if (isExecutableLive(def.tier)) {
          const result = await def.run(args, { principal, services });
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        const auto = principal.caps.autoApprove?.includes(def.name);
        if (auto) {
          const result = await def.run(args, { principal, services });
          return { content: [{ type: 'text', text: JSON.stringify({ autoApproved: true, result }) }] };
        }
        const proposal = await proposals.enqueue(principal, def.name, args, {
          triggeredByRef: undefined,
        });
        return {
          content: [
            { type: 'text', text: JSON.stringify({ queued: true, proposalId: proposal.id, status: proposal.status }) },
          ],
        };
      },
    );
  }
  return server;
}
```

> NOTE: `registerTool`'s `inputSchema` takes a Zod *raw shape* (`.shape`), per the MCP SDK. If the installed SDK version expects a full ZodObject, pass `def.inputSchema` instead — verify in Step 3.

- [ ] **Step 2: Add the MCP SDK dependency**

Run: `pnpm --filter @pulsar/api add @modelcontextprotocol/sdk`
Expected: dependency added. Confirm the import path `@modelcontextprotocol/sdk/server/mcp.js` resolves:

Run: `node -e "require.resolve('@modelcontextprotocol/sdk/server/mcp.js')"`
Expected: prints a path (if it throws, inspect `ls node_modules/@modelcontextprotocol/sdk/dist` and use the version's actual server entrypoint).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes. If `inputSchema` typing complains, switch `.shape` ↔ full object per the SDK version and re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/core/agents/mcp-server.factory.ts apps/api/package.json
git commit -m "feat(api): MCP server factory — per-agent scoped tool surface"
```

---

## Task 9: MCP HTTP endpoint + ProposedActions controller

**Files:**
- Create: `apps/api/src/core/agents/mcp.controller.ts`
- Create: `apps/api/src/core/agents/proposed-actions.controller.ts`

- [ ] **Step 1: Write the MCP controller (public route, agent-key auth, stateless)**

Create `apps/api/src/core/agents/mcp.controller.ts`:

```ts
import { Controller, Post, Get, Delete, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { TenantModulesCacheService } from '../modules/tenant-modules-cache.service';
import { AgentsService } from './agents.service';
import { ProposedActionsService } from './proposed-actions.service';
import { buildAgentMcpServer } from './mcp-server.factory';
import { AGENT_TOOL_SERVICES, type ToolServices } from './tool-registry';

@Controller('mcp')
export class McpController {
  constructor(
    private readonly agents: AgentsService,
    private readonly proposals: ProposedActionsService,
    private readonly modulesCache: TenantModulesCacheService,
    // Concrete tool-services adapter is provided in agents.module under AGENT_TOOL_SERVICES.
    private readonly toolServices: ToolServices,
  ) {}

  @Post()
  @Public()
  async handle(@Req() req: Request, @Res() res: Response) {
    const rawKey = (req.headers['x-agent-key'] as string) ?? bearer(req.headers['authorization']);
    if (!rawKey) {
      res.status(401).json({ error: 'Missing agent key' });
      return;
    }
    let principal;
    try {
      principal = await this.agents.validateKey(rawKey);
    } catch {
      res.status(401).json({ error: 'Invalid agent key' });
      return;
    }
    const enabled = await this.modulesCache.enabledModules(principal.user.tenantId);
    const server = buildAgentMcpServer(principal, new Set(enabled), this.proposals, this.toolServices);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  // Stateless mode uses POST only.
  @Get() @Public() getMethod(@Res() res: Response) { res.status(405).json({ error: 'Use POST' }); }
  @Delete() @Public() delMethod(@Res() res: Response) { res.status(405).json({ error: 'Use POST' }); }
}

function bearer(header?: string): string | undefined {
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}
```

> NOTE: `TenantModulesCacheService` is the existing module-activation cache (rule 15). Verify its method name in Step 3: `grep -n "class TenantModulesCacheService\|enabledModules\|isEnabled" apps/api/src/core/modules/*.ts` and adapt (`enabledModules(tenantId): Promise<string[]>` is assumed; if it exposes `isEnabled(tenantId, key)`, build the set by checking each `MODULE_KEYS`).

- [ ] **Step 2: Write the ProposedActions controller**

Create `apps/api/src/core/agents/proposed-actions.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ProposedActionsService } from './proposed-actions.service';
import { AGENT_TOOL_SERVICES, type ToolServices } from './tool-registry';
import { Inject } from '@nestjs/common';

@ApiTags('core/agent-actions')
@ApiBearerAuth()
@Controller('agent-actions')
export class ProposedActionsController {
  constructor(
    private readonly proposals: ProposedActionsService,
    @Inject(AGENT_TOOL_SERVICES) private readonly toolServices: ToolServices,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_ACTIONS_READ)
  listPending(@CurrentUser() user: AuthUser) {
    return this.proposals.listPending(user.tenantId);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_ACTIONS_APPROVE)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.proposals.approve(user.tenantId, id, user.id, this.toolServices);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_ACTIONS_APPROVE)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.proposals.reject(user.tenantId, id, user.id);
  }
}
```

> Define `AGENT_TOOL_SERVICES` as an injection token in `tool-registry.ts`:
> ```ts
> export const AGENT_TOOL_SERVICES = Symbol('AGENT_TOOL_SERVICES');
> ```
> Add that line to `tool-registry.ts` now.

- [ ] **Step 3: Reconcile assumed service method names**

Run the greps from the NOTE blocks above (`TenantModulesCacheService`, loads/shipments/tenders/analytics). Fix the interface/adapter accordingly. Do not invent methods — match the codebase.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: passes once the module (Task 10) provides `AGENT_TOOL_SERVICES` and `ToolServices`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/agents/mcp.controller.ts apps/api/src/core/agents/proposed-actions.controller.ts apps/api/src/core/agents/tool-registry.ts
git commit -m "feat(api): MCP HTTP endpoint + agent-actions approval controller"
```

---

## Task 10: AgentsModule — wire everything, register in AppModule

**Files:**
- Create: `apps/api/src/core/agents/agents.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the module with the concrete tool-services adapter**

Create `apps/api/src/core/agents/agents.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ModulesModule } from '../modules/modules.module';
import { LoadsModule } from '../../modules/transportation/loads/loads.module';
import { ShipmentsModule } from '../../modules/transportation/shipments/shipments.module';
import { TendersModule } from '../../modules/transportation/tenders/tenders.module';
import { TransportOrdersModule } from '../../modules/transportation/transport-orders/transport-orders.module';
import { AnalyticsModule } from '../../modules/transportation/analytics/analytics.module';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { ProposedActionsService } from './proposed-actions.service';
import { ProposedActionsController } from './proposed-actions.controller';
import { McpController } from './mcp.controller';
import { AGENT_TOOL_SERVICES, type ToolServices } from './tool-registry';
// Import the concrete services to build the adapter:
import { LoadsService } from '../../modules/transportation/loads/loads.service';
import { ShipmentsService } from '../../modules/transportation/shipments/shipments.service';
import { TendersService } from '../../modules/transportation/tenders/tenders.service';
import { TransportOrdersService } from '../../modules/transportation/transport-orders/transport-orders.service';
import { AnalyticsService } from '../../modules/transportation/analytics/analytics.service';

@Global()
@Module({
  imports: [
    AuditLogsModule,
    ModulesModule,
    LoadsModule,
    ShipmentsModule,
    TendersModule,
    TransportOrdersModule,
    AnalyticsModule,
  ],
  controllers: [AgentsController, ProposedActionsController, McpController],
  providers: [
    AgentsService,
    ProposedActionsService,
    {
      provide: AGENT_TOOL_SERVICES,
      inject: [TransportOrdersService, LoadsService, ShipmentsService, TendersService, AnalyticsService],
      useFactory: (
        transportOrders: TransportOrdersService,
        loads: LoadsService,
        shipments: ShipmentsService,
        tenders: TendersService,
        analytics: AnalyticsService,
      ): ToolServices => ({
        transportOrders: { list: (t, q) => transportOrders.list(t, q as never) },
        loads: {
          findOne: (t, id) => loads.findOne(t, id),
          rateOptions: (t, id) => loads.rateOptions(t, id),
          create: (t, u, dto) => loads.create(t, u, dto as never),
        },
        shipments: {
          list: (t, q) => shipments.list(t, q as never),
          assignToLoad: (t, u, id, loadId) => shipments.assignToLoad(t, u, id, loadId),
        },
        tenders: { create: (t, u, loadId, dto) => tenders.create(t, u, loadId, dto as never) },
        analytics: { carrierScorecard: (t) => analytics.carrierScorecard(t) },
      }),
    },
  ],
  exports: [AgentsService],
})
export class AgentsModule {}
```

> The `useFactory` adapter is the ONE place that bridges the assumed `ToolServices` contract to real signatures. When a real method name/shape differs (discovered in Task 6/9 greps), fix it HERE.
> `McpController` also injects `ToolServices` positionally — change its constructor to `@Inject(AGENT_TOOL_SERVICES) private readonly toolServices: ToolServices` (same token as the actions controller) to resolve it.

- [ ] **Step 2: Fix McpController injection token**

In `mcp.controller.ts`, update the constructor param to use the token:

```ts
import { Inject } from '@nestjs/common';
import { AGENT_TOOL_SERVICES, type ToolServices } from './tool-registry';
// ...
    @Inject(AGENT_TOOL_SERVICES) private readonly toolServices: ToolServices,
```

- [ ] **Step 3: Register AgentsModule in AppModule**

In `apps/api/src/app.module.ts`, add `AgentsModule` to the `imports` array (near `ApiKeysModule`):

```ts
import { AgentsModule } from './core/agents/agents.module';
// ... in @Module({ imports: [ ... ApiKeysModule, AgentsModule, ... ] })
```

- [ ] **Step 4: Build + typecheck the API**

Run: `pnpm --filter @pulsar/api build`
Expected: builds. Resolve any remaining signature mismatches in the `useFactory` adapter only.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/agents/agents.module.ts apps/api/src/core/agents/mcp.controller.ts apps/api/src/app.module.ts
git commit -m "feat(api): wire AgentsModule (MCP endpoint, agents, proposed actions)"
```

---

## Task 11: End-to-end governance flow

**Files:**
- Create: `apps/api/test/phase11-agents.e2e-spec.ts`

This is the real verification of the feature. It needs a running, seeded DB (`pnpm db:up && pnpm db:migrate && pnpm db:seed`).

- [ ] **Step 1: Write the e2e spec**

Create `apps/api/test/phase11-agents.e2e-spec.ts`:

```ts
/**
 * E2E phase 11 — agent governance + MCP exposure (palier 1).
 * Verifies: agent registration, scoped tool listing, live reads, mutation
 * enqueue (no DB write), amount-cap rejection, approval execution + audit,
 * idempotency. Creates its own master data with unique codes (rerun-safe).
 *
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123' };

describe('Phase 11 — agent governance (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let agentKey = '';
  let mcpId = 0;

  const mcp = (method: string, params: unknown) =>
    request(http)
      .post('/api/v1/mcp')
      .set('X-Agent-Key', agentKey)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++mcpId, method, params });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(201);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers an agent with planning permissions + an amount cap', async () => {
    const res = await request(http)
      .post('/api/v1/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'dispatch-bot',
        permissions: [
          'transportation.orders.read',
          'transportation.planning.read',
          'transportation.planning.manage',
        ],
        caps: { maxAmountPerAction: 1500 },
      })
      .expect(201);
    expect(res.body.key).toMatch(/^ak_/);
    agentKey = res.body.key;
  });

  it('lists only the tools the agent may use (no analytics — not granted)', async () => {
    const res = await mcp('tools/list', {}).expect(200);
    const names: string[] = (res.body.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_transport_orders', 'get_load', 'create_load', 'tender_load']));
    expect(names).not.toContain('carrier_scorecard');
  });

  it('executes a read tool live', async () => {
    const res = await mcp('tools/call', { name: 'list_transport_orders', arguments: { pageSize: 5 } }).expect(200);
    const text = res.body.result?.content?.[0]?.text ?? '';
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('enqueues a mutating tool instead of executing it', async () => {
    const before = await prisma.proposedAction.count();
    const res = await mcp('tools/call', {
      name: 'create_load',
      arguments: { mode: 'FTL' },
    }).expect(200);
    const payload = JSON.parse(res.body.result.content[0].text);
    expect(payload.queued).toBe(true);
    expect(payload.status).toBe('PENDING');
    expect(await prisma.proposedAction.count()).toBe(before + 1);
  });

  it('rejects a tender above the amount cap', async () => {
    const res = await mcp('tools/call', {
      name: 'tender_load',
      arguments: { loadId: 'nonexistent', carrierId: 'x', amount: 5000 },
    }).expect(200);
    // MCP returns tool errors as isError content; assert the cap message surfaced.
    const text = JSON.stringify(res.body.result ?? res.body.error);
    expect(text).toContain('cap');
  });

  it('approving a pending proposal executes it and audits the approver', async () => {
    const pending = await request(http)
      .get('/api/v1/agent-actions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const proposal = pending.body.find((p: { tool: string }) => p.tool === 'create_load');
    expect(proposal).toBeDefined();

    const approve = await request(http)
      .post(`/api/v1/agent-actions/${proposal.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(['EXECUTED', 'FAILED']).toContain(approve.body.status);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'proposed-action', entityId: proposal.id, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('is idempotent: re-enqueuing the same call returns the same proposal', async () => {
    const args = { name: 'idem-key-test' };
    const a = await mcp('tools/call', { name: 'create_load', arguments: args }).expect(200);
    const b = await mcp('tools/call', { name: 'create_load', arguments: args }).expect(200);
    const ida = JSON.parse(a.body.result.content[0].text).proposalId;
    const idb = JSON.parse(b.body.result.content[0].text).proposalId;
    expect(ida).toBe(idb);
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Ensure DB is up + seeded, then:

Run: `pnpm --filter @pulsar/api test:e2e -- phase11-agents`
Expected: all tests PASS. If the MCP transport rejects the request shape, confirm the `Accept` header includes both `application/json` and `text/event-stream` (Streamable HTTP requires it) and that `req.body` is JSON-parsed (Nest's default body parser handles this).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/phase11-agents.e2e-spec.ts
git commit -m "test(api): phase 11 e2e — agent governance flow"
```

---

## Task 12: Web — Agents settings page

**Files:**
- Create: `apps/web/src/routes/(app)/settings/agents/+page.svelte`
- Reference (copy the structure/idioms from): the existing API-keys settings page. First run `ls apps/web/src/routes/(app)/settings` and open the `api-keys` page to mirror its `$state`/`$effect`/`api<T>()`/Modal patterns exactly.

- [ ] **Step 1: Inspect the reference page**

Run: `ls apps/web/src/routes/\(app\)/settings`
Open the API-keys `+page.svelte` to copy: how it lists, how it shows the one-time key after create, how it calls `api<T>()`, and which UI components it imports.

- [ ] **Step 2: Write the page**

Create `apps/web/src/routes/(app)/settings/agents/+page.svelte`, mirroring the API-keys page. It must:
- `load()` agents from `GET /agents` into `$state`, triggered by `$effect`.
- A "Register agent" Modal with: name, description, a multi-select of permission keys (reuse the catalog — fetch `GET /permissions` or hardcode the dispatch set), and cap inputs (`maxAmountPerAction`, `maxActionsPerMinute`).
- `POST /agents` then show the returned `key` ONCE in a copyable field with a "copy" button and a warning it won't be shown again.
- A revoke button per row → `DELETE /agents/:id` with confirm.
- Errors into a local `error` string, per the web convention.

Concrete data calls (use the project's `api` client from `$lib/api/client`):

```ts
import { api } from '$lib/api/client';
type Agent = { id: string; name: string; permissions: string[]; status: string; prefix: string; createdAt: string };
let agents = $state<Agent[]>([]);
let error = $state('');
async function load() {
  try { agents = await api<Agent[]>('/agents'); } catch (e) { error = String(e); }
}
$effect(() => { load(); });
async function create(input: { name: string; description?: string; permissions: string[]; caps: object }) {
  const created = await api<Agent & { key: string }>('/agents', { method: 'POST', body: input });
  revealedKey = created.key; // show once
  await load();
}
async function revoke(id: string) {
  await api(`/agents/${id}`, { method: 'DELETE' });
  await load();
}
```

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm --filter @pulsar/web check`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/settings/agents/+page.svelte"
git commit -m "feat(web): agents settings page (register, scopes, caps, one-time key)"
```

---

## Task 13: Web — Agent-actions inbox + nav badge

**Files:**
- Create: `apps/web/src/routes/(app)/agent-actions/+page.svelte`
- Modify: `apps/web/src/routes/(app)/+layout.svelte`

- [ ] **Step 1: Write the inbox page**

Create `apps/web/src/routes/(app)/agent-actions/+page.svelte`, following the list+Panel pattern. It must:
- `load()` from `GET /agent-actions` into `$state`.
- Render each pending proposal with a human-readable summary: `tool` + a key/value rendering of `args` + the `riskTier` badge + `triggeredByRef`.
- Approve button → `POST /agent-actions/:id/approve`; Reject → `POST /agent-actions/:id/reject`; both reload the list.
- Empty state when none pending.

```ts
import { api } from '$lib/api/client';
type Proposal = { id: string; tool: string; riskTier: string; args: Record<string, unknown>; triggeredByRef: string | null; proposedAt: string };
let pending = $state<Proposal[]>([]);
let error = $state('');
async function load() { try { pending = await api<Proposal[]>('/agent-actions'); } catch (e) { error = String(e); } }
$effect(() => { load(); });
async function approve(id: string) { await api(`/agent-actions/${id}/approve`, { method: 'POST' }); await load(); }
async function reject(id: string) { await api(`/agent-actions/${id}/reject`, { method: 'POST' }); await load(); }
```

- [ ] **Step 2: Add nav entry + pending badge**

In `apps/web/src/routes/(app)/+layout.svelte`, add an "Agent actions" nav item (gated on the user having `agents.actions.read`, following however the layout currently gates nav items). Show a count badge from `GET /agent-actions` length. Mirror the existing notification-bell pattern already in the shell (phase 9).

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm --filter @pulsar/web check`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/agent-actions/+page.svelte" "apps/web/src/routes/(app)/+layout.svelte"
git commit -m "feat(web): agent-actions inbox + nav badge"
```

---

## Task 14: Seed, full build, verification

**Files:**
- (no new files — verification + reseed)

- [ ] **Step 1: Reseed so the admin role picks up the new permissions**

The seed grants every catalog permission to the admin role automatically. Run:

Run: `pnpm db:seed`
Expected: log line reports the permission count increased by 4.

- [ ] **Step 2: Full monorepo build (order matters: shared → database → api → web)**

Run: `pnpm build`
Expected: all workspaces build.

- [ ] **Step 3: Typecheck everything**

Run: `pnpm typecheck`
Expected: passes across workspaces.

- [ ] **Step 4: Unit + e2e**

Run: `pnpm test`
Expected: shared unit tests (incl. `risk.spec.ts`) pass.

Run: `pnpm test:e2e -- phase11-agents`
Expected: phase 11 e2e passes. Then run the full `pnpm test:e2e` once to confirm no regression.

- [ ] **Step 5: Update docs (status + TODO + hard rules)**

- Add a "Hard rules (continued, phase 11)" block to `CLAUDE.md`: (1) agent tools go through the registry — never expose an operation by calling a controller directly; (2) MUTATING/SENSITIVE tools NEVER execute in the MCP handler — only `ProposedActionsService.approve` runs them, with cap + status re-checks; (3) an agent's reach = its `permissions` ∩ tenant modules ∩ `caps.toolAllowlist`, and `caps.autoApprove` is the only bypass of the queue.
- Add the phase 11 row to `docs/etat-du-projet.md` and mark the TODO items.
- Write `docs/agents.md` — the **Hermes connection guide** (spec deliverable): the
  `POST /api/v1/mcp` endpoint URL, the `X-Agent-Key` header, how to register an agent
  in Settings → Agents, and a copy-paste Hermes MCP-client config block pointing at the
  Pulsar endpoint. State explicitly that Pulsar is MCP-agnostic and Hermes is only the
  reference client.

```bash
git add CLAUDE.md docs/etat-du-projet.md TODO.md docs/agents.md
git commit -m "docs: phase 11 palier 1 shipped — agent governance + MCP + Hermes connection guide"
```

- [ ] **Step 6: Open the PR**

```bash
git push -u origin phase-11
gh pr create --base main --head phase-11 --title "Phase 11 (palier 1): agent governance + MCP exposure" --body "BYO-agent MCP layer: scoped tools, dedicated agent identity + caps, idempotent proposed-actions queue with human approval. Spec: docs/superpowers/specs/2026-06-13-agents-gouvernance-mcp-design.md"
```

> If `gh` is unavailable (it was absent during phase 9), Sam opens the PR via
> `https://github.com/SamChampagne/Pulsar/compare/main...phase-11`.

---

## Self-Review notes (for the executor)

- **Service signatures are assumed, not verified** in Tasks 6/9/10. The greps in those tasks are mandatory: reconcile `ToolServices` + the `useFactory` adapter to real method names before trusting the build. This is the single biggest risk.
- **MCP SDK import paths + `inputSchema` shape** vary by SDK version (Task 8). Verify `require.resolve` and `.shape` vs full ZodObject.
- **`TenantModulesCacheService` API** (Task 9) — confirm `enabledModules(tenantId)` vs `isEnabled`.
- **`AuditAction` members** (Task 7) — confirm `CREATE`/`UPDATE` names.
- **Module imports** (Task 10) — the transportation feature modules must `export` their services for the adapter to inject them; if they don't, add the service to the module's `exports`.
- Everything mutating stays in `PENDING` unless `caps.autoApprove` lists the tool (spec § D) — covered by the factory.
- Idempotency, amount cap, rate cap, scoped listing, live read, enqueue-not-execute, approve-executes-and-audits — each has an e2e assertion (Task 11).
