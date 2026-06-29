# CRM Intelligence — Kanban + Coach de deals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un kanban de pipeline riche avec drag-drop + un coach de deals (agent Hermes) qui analyse les deals et propose comment les gagner.

**Architecture:** Backend minimal — un preset de rôle `deal-coach` (pure data), un outil agent READ `crm_get_deal`, et l'enrichissement de `GET /crm/pipeline` (ageDays/stale via un helper pur partagé). Front — kanban refait (drag-drop HTML5 natif → `advance`) + page `/crm/coach` qui provisionne l'agent coach via les endpoints `agents` existants et chatte via `agent-conversations` (SSE). Aucun nouveau endpoint CRM (évite le cycle de module CrmModule↔AgentsModule).

**Tech Stack:** NestJS (API), Prisma/Postgres, SvelteKit (Svelte 5 runes, ssr=false), Vitest (shared unit), Jest+supertest (e2e). Aucune nouvelle dépendance.

## Global Constraints

- **R1 tenant isolation:** tout query filtre `tenantId` du JWT (`@CurrentUser()`).
- **R2 state machine:** l'avancement de stage passe TOUJOURS par `DealsService.advance` → `canTransitionDeal` (jamais d'`update({ stage })`). WON/LOST terminaux.
- **R21 agent tools via le registre** (`core/agents/tool-registry.ts`) ; tier READ = exécution directe.
- **R22/R29 gouvernance:** toute mutation proposée par l'agent → file `ProposedAction` ; rien de neuf à implémenter, c'est le tier qui le pilote.
- **R26 projection agent:** ne jamais exposer `secretHash`/`serviceUserId` (l'`agentSelect` existant s'en charge ; le web ne lit que la projection publique).
- **Pas de cycle de module:** ne PAS importer `AgentsModule` dans `CrmModule`. La provision de l'agent coach se fait côté web via `POST /agents` / `GET /agents`.
- **Presets pure data:** `AGENT_ROLE_PRESETS` reste browser-safe (aucun import Node).
- **Web:** pattern existant — `$state` + `$effect` load(), client `api<T>()` de `$lib/api/client`, erreur locale. Réutiliser les idiomes des pages CRM/agents existantes, ne pas inventer.
- **Runtime Hermes best-effort:** indisponible ⇒ l'API renvoie 503, jamais de crash (rule 24) ; le web affiche un message clair.

---

### Task 1: Preset de rôle `deal-coach` (`@pulsar/shared`)

**Files:**
- Modify: `packages/shared/src/agents/role-presets.ts`
- Modify: `packages/shared/src/agents/role-presets.spec.ts`

**Interfaces:**
- Produces: une entrée `AgentRolePreset` `{ id: 'deal-coach', label, persona, suggestedPermissions: ['crm.read','crm.manage'], suggestedAutonomy: AgentAutonomy.PROPOSE, alwaysOn: false }` dans `AGENT_ROLE_PRESETS`.

- [ ] **Step 1: Write the failing test**

Append to `role-presets.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AGENT_ROLE_PRESETS } from './role-presets';
import { AgentAutonomy } from './autonomy';

describe('deal-coach preset', () => {
  const coach = AGENT_ROLE_PRESETS.find((p) => p.id === 'deal-coach');

  it('exists with CRM permissions and is interactive (not always-on, PROPOSE)', () => {
    expect(coach).toBeDefined();
    expect(coach!.suggestedPermissions).toEqual(
      expect.arrayContaining(['crm.read', 'crm.manage']),
    );
    expect(coach!.alwaysOn ?? false).toBe(false);
    expect(coach!.suggestedAutonomy).toBe(AgentAutonomy.PROPOSE);
    expect(coach!.persona.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- role-presets`
Expected: FAIL — `coach` is `undefined`.

- [ ] **Step 3: Add the preset**

In `role-presets.ts`, add this object to the `AGENT_ROLE_PRESETS` array (after `crm-sdr` for cohesion):

```ts
  {
    id: 'deal-coach',
    label: 'Coach commercial',
    persona:
      "Je suis le coach commercial. À la demande, j'analyse un deal ou le pipeline : " +
      "je consulte le deal, sa company, ses contacts et son historique d'activités, " +
      "j'identifie les risques et les leviers, et je propose un plan concret pour le gagner " +
      "(prochaine meilleure action, message à envoyer, relance à planifier). " +
      "Quand j'agis (journaliser une note, planifier une relance, faire avancer le stage), " +
      "je le propose via les outils CRM — l'humain approuve.",
    suggestedPermissions: ['crm.read', 'crm.manage'],
    suggestedAutonomy: AgentAutonomy.PROPOSE,
    alwaysOn: false,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pulsar/shared test -- role-presets`
Expected: PASS (existing presets tests + the new one).

- [ ] **Step 5: Rebuild shared**

Run: `pnpm --filter @pulsar/shared build`
Expected: build OK.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agents/role-presets.ts packages/shared/src/agents/role-presets.spec.ts
git commit -m "feat(crm): deal-coach agent role preset"
```

---

### Task 2: Helper `isDealStale` pur + enrichissement `GET /crm/pipeline` (ageDays/stale)

**Files:**
- Create: `packages/shared/src/crm/deal-signals.ts`
- Create: `packages/shared/src/crm/deal-signals.spec.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Modify: `apps/api/src/modules/crm/deals.service.ts` (`pipeline` map + reuse helper)
- Modify: `apps/api/src/modules/crm/overview.service.ts` (reuse helper for `staleDealCount`)

**Interfaces:**
- Consumes: `CrmDealStage`/`isDealOpen` (existing in `@pulsar/shared/crm`).
- Produces:
  - `isDealStale(input: { stage: CrmDealStage; lastActivityAt: Date | null; createdAt: Date; now: Date; thresholdDays?: number }): boolean`
  - `dealAgeDays(createdAt: Date, now: Date): number`
  - `pipeline()` items gain `ageDays: number` and `stale: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/crm/deal-signals.spec.ts
import { describe, it, expect } from 'vitest';
import { isDealStale, dealAgeDays } from './deal-signals';
import { CrmDealStage } from './crm.workflow';

const now = new Date('2026-06-24T00:00:00Z');
const old = new Date('2026-06-10T00:00:00Z'); // 14 days before now
const recent = new Date('2026-06-22T00:00:00Z'); // 2 days before now

describe('dealAgeDays', () => {
  it('counts whole days since creation', () => {
    expect(dealAgeDays(old, now)).toBe(14);
    expect(dealAgeDays(now, now)).toBe(0);
  });
});

describe('isDealStale', () => {
  it('open deal with no activity older than threshold is stale', () => {
    expect(isDealStale({ stage: CrmDealStage.LEAD, lastActivityAt: null, createdAt: old, now })).toBe(true);
  });
  it('open deal with recent activity is not stale', () => {
    expect(isDealStale({ stage: CrmDealStage.QUALIFIED, lastActivityAt: recent, createdAt: old, now })).toBe(false);
  });
  it('closed deals are never stale', () => {
    expect(isDealStale({ stage: CrmDealStage.WON, lastActivityAt: null, createdAt: old, now })).toBe(false);
    expect(isDealStale({ stage: CrmDealStage.LOST, lastActivityAt: null, createdAt: old, now })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- deal-signals`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// packages/shared/src/crm/deal-signals.ts
import { CrmDealStage, isDealOpen } from './crm.workflow';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_DAYS = 7;

/** Whole days between creation and `now` (floor, never negative). */
export function dealAgeDays(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS));
}

/**
 * A deal is stale when it is still open and its last touch (activity, else creation)
 * is older than `thresholdDays`. Mirrors OverviewService.staleDealCount logic — the
 * single source of truth so the kanban and the overview never diverge.
 */
export function isDealStale(input: {
  stage: CrmDealStage;
  lastActivityAt: Date | null;
  createdAt: Date;
  now: Date;
  thresholdDays?: number;
}): boolean {
  if (!isDealOpen(input.stage)) return false;
  const threshold = new Date(input.now.getTime() - (input.thresholdDays ?? DEFAULT_STALE_DAYS) * DAY_MS);
  const lastAt = input.lastActivityAt ?? input.createdAt;
  return lastAt < threshold;
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, after `export * from './crm/email-thread';` add:

```ts
export * from './crm/deal-signals';
```

- [ ] **Step 5: Run test + rebuild shared**

Run: `pnpm --filter @pulsar/shared test -- deal-signals && pnpm --filter @pulsar/shared build`
Expected: PASS, build OK.

- [ ] **Step 6: Enrich `pipeline()` in deals.service.ts**

The current `pipeline()` (lines ~206-243) maps each deal. Add `createdAt: true` to the deal fields fetched (it's already a full `findMany`, so `d.createdAt` is available). Add `now` and map `ageDays`/`stale`. Update the import line to include the helpers from `@pulsar/shared`. Replace the `.map((d) => ({ ... }))` item shape with:

```ts
    const now = new Date();
    return stageOrder.map((stage) => ({
      stage,
      deals: (byStage.get(stage) ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        companyName: d.company.name,
        amount: d.amount,
        currency: d.currency,
        ownerUserId: d.ownerUserId,
        lastActivityAt: d.lastActivityAt,
        expectedCloseDate: d.expectedCloseDate,
        ageDays: dealAgeDays(d.createdAt, now),
        stale: isDealStale({
          stage: d.stage as CrmDealStage,
          lastActivityAt: d.lastActivityAt,
          createdAt: d.createdAt,
          now,
        }),
      })),
    }));
```

Ensure the file imports `dealAgeDays, isDealStale` (and already has `CrmDealStage`) from `@pulsar/shared`.

- [ ] **Step 7: Reuse the helper in overview.service.ts**

In `overview.service.ts`, the stale loop (around lines 84-94) computes `staleDealCount` inline. Replace the inline comparison with `isDealStale({ stage: deal.stage as CrmDealStage, lastActivityAt: deal.lastActivityAt, createdAt: deal.createdAt, now })` so both code paths share one definition. Keep the rest of the loop identical. Import `isDealStale` + `CrmDealStage` from `@pulsar/shared` if not already imported.

- [ ] **Step 8: Typecheck the API**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/crm/deal-signals.ts packages/shared/src/crm/deal-signals.spec.ts packages/shared/src/index.ts apps/api/src/modules/crm/deals.service.ts apps/api/src/modules/crm/overview.service.ts
git commit -m "feat(crm): pipeline ageDays/stale signals via shared isDealStale helper"
```

---

### Task 3: Outil agent `crm_get_deal` (READ) + `DealsService.getWithContext`

**Files:**
- Modify: `apps/api/src/modules/crm/deals.service.ts` (add `getWithContext`)
- Modify: `apps/api/src/core/agents/tools/crm.tools.ts` (add tool)
- Modify: `apps/api/src/core/agents/tool-types.ts` (add `crm.getDeal`)
- Modify: `apps/api/src/core/agents/agents.module.ts` (adapter)
- Test: `apps/api/test/crm-module.e2e-spec.ts` is NOT touched; add a focused e2e in a new file (Step below).

**Interfaces:**
- Consumes: `PrismaService`.
- Produces:
  - `DealsService.getWithContext(tenantId: string, id: string): Promise<{ deal, company, contacts, activities }>`
  - tool `crm_get_deal` (READ, `PERMISSIONS.CRM.READ`, `MODULE_KEYS.CRM`), input `{ dealId: string }`.
  - `ToolServices.crm.getDeal(tenantId, id)`.

- [ ] **Step 1: Add `getWithContext` to deals.service.ts**

```ts
  /**
   * Full context for a single deal — used by the coach agent (crm_get_deal).
   * Returns the deal, its company, the company's contacts, and the deal's recent activities.
   */
  async getWithContext(tenantId: string, id: string) {
    const deal = await this.prisma.crmDeal.findFirst({
      where: { id, tenantId },
      include: { company: { select: { id: true, name: true, domain: true, industry: true, status: true } } },
    });
    if (!deal) throw new NotFoundException('CRM deal not found');
    const [contacts, activities] = await Promise.all([
      this.prisma.crmContact.findMany({
        where: { tenantId, companyId: deal.companyId },
        select: { id: true, name: true, title: true, email: true, phone: true },
      }),
      this.prisma.crmActivity.findMany({
        where: { tenantId, dealId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);
    return { deal, company: deal.company, contacts, activities };
  }
```

(`NotFoundException` is already imported in this file.)

- [ ] **Step 2: Add `getDeal` to the `crm` service interface in tool-types.ts**

In the `crm: { ... }` block, add:

```ts
    getDeal(tenantId: string, id: string): Promise<unknown>;
```

- [ ] **Step 3: Add the tool in crm.tools.ts**

Append to the READ section of `crmTools`:

```ts
  {
    name: 'crm_get_deal',
    description: 'Get a single CRM deal with its company, contacts and recent activities — for deal analysis.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CRM.READ,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({ dealId: z.string().min(1) }),
    run: (args, ctx) => ctx.services.crm.getDeal(ctx.principal.user.tenantId, args.dealId as string),
  },
```

- [ ] **Step 4: Wire the adapter in agents.module.ts**

In the `crm: { ... }` adapter object (the factory already injects `deals`), add:

```ts
          getDeal: (tenantId, id) => deals.getWithContext(tenantId, id),
```

- [ ] **Step 5: Write a focused e2e**

```ts
// apps/api/test/crm-get-deal.e2e-spec.ts
/**
 * E2E crm_get_deal context getter — proves DealsService.getWithContext over the API
 * by creating a deal + contact and asserting the coach's data shape, tenant-scoped.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DealsService } from '../src/modules/crm/deals.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('crm_get_deal context (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaService;
  let deals: DealsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    deals = app.get(DealsService);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;
    const tenant = await prisma.tenant.findFirst({ where: { slug: 'acme' } });
    const mod = await prisma.module.findFirst({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: tenant!.id, moduleId: mod!.id } },
      update: { enabled: true },
      create: { tenantId: tenant!.id, moduleId: mod!.id, enabled: true, enabledAt: new Date() },
    });
  });

  afterAll(async () => { await app.close(); });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('returns the deal with company, contacts and activities', async () => {
    const srv = app.getHttpServer();
    const company = (await request(srv).post('/api/v1/crm/companies').set(auth()).send({ name: `Coach Co ${uniq()}` }).expect(201)).body;
    await request(srv).post('/api/v1/crm/contacts').set(auth()).send({ name: 'Bob', email: `bob.${uniq()}@x.test`, companyId: company.id }).expect(201);
    const deal = (await request(srv).post('/api/v1/crm/deals').set(auth()).send({ title: `Coach deal ${uniq()}`, companyId: company.id }).expect(201)).body;
    await request(srv).post('/api/v1/crm/activities').set(auth()).send({ type: 'NOTE', body: 'first call', dealId: deal.id }).expect(201);

    const tenant = await prisma.tenant.findFirst({ where: { slug: 'acme' } });
    const ctx = await deals.getWithContext(tenant!.id, deal.id);
    expect(ctx.deal.id).toBe(deal.id);
    expect(ctx.company.name).toContain('Coach Co');
    expect(ctx.contacts.length).toBeGreaterThanOrEqual(1);
    expect(ctx.activities.length).toBeGreaterThanOrEqual(1);

    // Tenant isolation: a foreign tenant id must not resolve this deal.
    await expect(deals.getWithContext('tenant_nonexistent', deal.id)).rejects.toThrow();
  });
});
```

(Verify `prisma.tenant` uses `slug` — match the field used by `crm-module.e2e-spec.ts`; adjust if it queries by a different field.)

- [ ] **Step 6: Run e2e + typecheck**

Run: `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api test:e2e -- crm-get-deal`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/crm/deals.service.ts apps/api/src/core/agents/tools/crm.tools.ts apps/api/src/core/agents/tool-types.ts apps/api/src/core/agents/agents.module.ts apps/api/test/crm-get-deal.e2e-spec.ts
git commit -m "feat(crm): crm_get_deal agent tool + DealsService.getWithContext + e2e"
```

---

### Task 4: Web — Kanban refait (`/crm/pipeline`)

**Files:**
- Rewrite: `apps/web/src/routes/(app)/crm/pipeline/+page.svelte`

**Interfaces:**
- Consumes: `GET /crm/pipeline` → `Array<{ stage, deals: Array<{ id, title, companyName, amount, currency, ownerUserId, lastActivityAt, expectedCloseDate, ageDays, stale }> }>`; `POST /crm/deals/:id/advance { stage }`.

- [ ] **Step 1: Read the current page + a reference for idioms**

Read `apps/web/src/routes/(app)/crm/pipeline/+page.svelte` (current kanban) and `apps/web/src/routes/(app)/crm/campaigns/+page.svelte` (for the `api()` call shape and `$state`/`$effect` idiom). Reuse those idioms; do not invent a new data pattern.

- [ ] **Step 2: Build the rich board with drag-drop**

Rewrite the page to render the 5 stage columns from the `GET /crm/pipeline` response. Requirements:
- Column header: stage label + deal count + Σ amount (sum of `amount`, formatted with the deal `currency`; treat null amount as 0).
- Card: `title`, `companyName`, formatted `amount`, `ageDays` ("Xj"), a **⚠ stale** badge when `stale`, owner (show `ownerUserId` or "—"), a **🧠** button linking to `/crm/coach?dealId=<id>`, and clicking the card body navigates to the deal (use the existing deals route; if a deal detail route exists use it, else `/crm/deals`).
- **Drag-drop (HTML5 native):** each card is `draggable="true"` with `ondragstart` storing the deal id + source stage; each column is a drop target (`ondragover|preventDefault`, `ondrop`). On drop into a different stage:
  - Optimistically move the card in local `$state`.
  - Call `api('/crm/deals/' + id + '/advance', { method: 'POST', body: { stage: targetStage } })`.
  - On error (e.g. terminal-stage 400): revert the local move and show the error in the local `error` string (toast/inline).
  - Skip the call entirely if `targetStage === sourceStage`.
- Loading + error states; French labels. Horizontal scroll for the columns on narrow screens.

Minimal state skeleton (adapt `api()` signature to the campaigns page):

```ts
type Deal = { id: string; title: string; companyName: string; amount: number | null; currency: string; ownerUserId: string | null; lastActivityAt: string | null; ageDays: number; stale: boolean };
type Column = { stage: string; deals: Deal[] };

let columns = $state<Column[]>([]);
let error = $state('');
let dragging = $state<{ id: string; from: string } | null>(null);

async function load() {
  try { columns = await api<Column[]>('/crm/pipeline'); }
  catch (e) { error = String(e); }
}

async function drop(toStage: string) {
  if (!dragging || dragging.from === toStage) { dragging = null; return; }
  const { id, from } = dragging; dragging = null;
  // optimistic move
  const src = columns.find(c => c.stage === from); const dst = columns.find(c => c.stage === toStage);
  const card = src?.deals.find(d => d.id === id);
  if (!src || !dst || !card) return;
  src.deals = src.deals.filter(d => d.id !== id); dst.deals = [card, ...dst.deals];
  try { await api(`/crm/deals/${id}/advance`, { method: 'POST', body: { stage: toStage } }); }
  catch (e) { error = String(e); await load(); } // revert by reloading authoritative state
}

$effect(() => { load(); });
```

- [ ] **Step 3: Build the web app**

Run: `pnpm --filter @pulsar/web build`
Expected: build OK (no svelte/type errors; a11y warnings consistent with other pages are acceptable).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/\(app\)/crm/pipeline/+page.svelte
git commit -m "feat(web): rich CRM kanban — totals, signals, drag-drop advance"
```

---

### Task 5: Web — Coach page (`/crm/coach`) + nav

**Files:**
- Create: `apps/web/src/routes/(app)/crm/coach/+page.svelte`
- Modify: `apps/web/src/lib/modules/navigation.ts` (CRM nav: add "Coach")

**Interfaces:**
- Consumes: `GET /agents`, `POST /agents`, `POST /agent-conversations { agentId }`, `POST /agent-conversations/:id/messages { text }` (SSE), `GET /proposed-actions`, `POST /proposed-actions/:id/approve`, `POST /proposed-actions/:id/reject`; the `deal-coach` preset from `@pulsar/shared` (`AGENT_ROLE_PRESETS`).

- [ ] **Step 1: Read the reference chat page + agents create shape**

Read `apps/web/src/routes/(app)/agents/[id]/+page.svelte` to reuse its **SSE consumption** of `POST /agent-conversations/:id/messages` (event names, streaming text, tool-call rendering, done handling). Read `apps/web/src/lib/components/agents/` if a chat component exists — reuse it rather than reimplementing the SSE parser. Read the `CreateAgentDto` accepted fields in `apps/api/src/core/agents/agents.controller.ts` (around the `@Post()`), so the provisioning body matches (name, persona, role, permissions, autonomyLevel — send exactly what the DTO accepts).

- [ ] **Step 2: Turnkey coach-agent resolution**

On load:
- `GET /agents` → find an agent whose `role === 'deal-coach'`. Keep it as `coachAgent`.
- If none: show an "Activer le coach" button. On click, read the `deal-coach` preset from `AGENT_ROLE_PRESETS` (`import { AGENT_ROLE_PRESETS } from '@pulsar/shared'`) and `POST /agents` with `{ name: preset.label, persona: preset.persona, role: preset.id, permissions: preset.suggestedPermissions, autonomyLevel: preset.suggestedAutonomy }` (drop any field the DTO rejects). Set `coachAgent` from the response.

- [ ] **Step 3: Chat (deal mode + pipeline mode)**

- Read `?dealId=` from the page URL (`$page.url.searchParams`). When present, **deal mode**: after the conversation is started, automatically send the first turn `Analyse le deal <dealId> et explique comment le gagner : risques, leviers, et la prochaine meilleure action.` When absent, **pipeline mode**: render suggested-prompt buttons ("Quels deals sont à risque ?", "Où concentrer mes efforts ce mois-ci ?", "Donne-moi un plan pour la semaine").
- Start conversation: `POST /agent-conversations { agentId: coachAgent.id }` → conversation id. Then per user message, `POST /agent-conversations/:id/messages { text }` and stream the SSE response, reusing the agents page's SSE handling. Render streamed assistant text + a compact line for tool calls ("a consulté le deal …").
- Free-text input + send button; suggested prompts fill/submit the input.

- [ ] **Step 4: Proposed actions inline**

After each turn completes, `GET /proposed-actions` (the existing endpoint returns the tenant's pending actions; filter to PENDING) and render any pending ones as cards with **Approuver** (`POST /proposed-actions/:id/approve`) and **Rejeter** (`POST /proposed-actions/:id/reject`) buttons. Refresh the list after approve/reject. (This is how the coach's `crm_log_activity`/`crm_advance_deal`/`crm_create_followup` proposals get executed — governance unchanged.)

- [ ] **Step 5: Runtime-unavailable handling**

If starting a conversation or a turn returns 503 (Hermes runtime not configured), show a friendly inline message: "Le runtime d'agent n'est pas configuré pour ce tenant — configure-le dans /agents." Do not crash the page.

- [ ] **Step 6: Navigation**

In `apps/web/src/lib/modules/navigation.ts`, add a "Coach" entry pointing to `/crm/coach` in the CRM section, gated on `PERMISSIONS.CRM.READ` (mirror how the inbox/"Boîte de réception" entry was added).

- [ ] **Step 7: Build the web app**

Run: `pnpm --filter @pulsar/web build`
Expected: build OK.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/\(app\)/crm/coach/+page.svelte apps/web/src/lib/modules/navigation.ts
git commit -m "feat(web): CRM deal coach page — turnkey agent, chat, inline proposed actions"
```

---

### Task 6: Vérification + docs

**Files:**
- Modify: `docs/etat-du-projet.md` (note CRM intelligence)

- [ ] **Step 1: Full verification**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all PASS (shared unit incl. `deal-signals.spec.ts` + `role-presets.spec.ts`; build order shared→database→api→web).

- [ ] **Step 2: e2e (seeded DB up)**

Run: `pnpm test:e2e`
Expected: existing suites + `crm-get-deal` PASS (1 pre-existing skip acceptable).

- [ ] **Step 3: Note the capability**

Add a short line under the CRM section of `docs/etat-du-projet.md` (French) describing the rich kanban (drag-drop/signals) + the deal coach agent.

- [ ] **Step 4: Commit**

```bash
git add docs/etat-du-projet.md
git commit -m "docs(crm): note kanban refait + coach de deals"
```

---

## Self-Review

**Spec coverage:**
- Kanban riche + drag-drop + signaux → Tasks 2 (signals) + 4 (board). ✓
- Coach: preset `deal-coach` → Task 1; outil `crm_get_deal` → Task 3; page turnkey + chat + actions inline → Task 5. ✓
- Provisioning sans cycle de module (via web `POST /agents`) → Task 5. ✓
- Gouvernance inchangée (ProposedAction via tier) → Tasks 3/5 (rien à coder côté moteur). ✓
- Runtime Hermes best-effort (503 → message) → Task 5 step 5. ✓
- Tests : preset + helper stale (unit), `crm_get_deal` (e2e) → Tasks 1/2/3 ; boucle LLM hors CI. ✓
- Docs/vérif → Task 6. ✓

**Placeholder scan:** No TODO/TBD. Web tasks (4/5) defer the exact `api()`/SSE idiom to the named existing pages (campaigns, agents/[id]) — acceptable: matching established patterns, with the exact endpoints/state/body spelled out.

**Type consistency:** `isDealStale`/`dealAgeDays` signatures match between Task 2's definition and its callers (pipeline, overview). `crm.getDeal` (tool-types) ↔ `deals.getWithContext` (Task 3). The pipeline item fields (`ageDays`/`stale`) added in Task 2 match the `Deal` type consumed in Task 4. The `deal-coach` preset fields (Task 1) match the `POST /agents` body built in Task 5.
