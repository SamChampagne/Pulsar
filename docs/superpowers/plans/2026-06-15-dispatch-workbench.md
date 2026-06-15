# Dispatch Workbench v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks ALSO require a browser inspection (chrome-devtools) as part of done — not just build/typecheck.

**Goal:** Turn the separate orders/shipments/loads pages into one `/dispatch` workbench (backlog → load builder → map+rates), fix the collapsed-by-default nav that hides the app, and add the two minimal backend endpoints the workbench needs.

**Architecture:** A `/dispatch` SvelteKit page (Svelte 5 runes) holding shared state and composing three focused panel components (Backlog, LoadBuilder, SidePanel) over existing transportation endpoints, plus a `?unassigned=true` shipments filter and an atomic `POST /loads/consolidate`. Nav shell polished to open groups by default. Frontend craft via the design system but a genuinely new dense layout (not Card+Table).

**Tech Stack:** NestJS 11 + Prisma 6 (api), SvelteKit 5 runes + Tailwind design system (web), Jest e2e. Dev servers run on :5173 (web) / :3000 (api), DB seeded.

**Design spec:** `docs/superpowers/specs/2026-06-15-dispatch-workbench-design.md`

**Branch:** `dispatch-workbench` (off phase-16; design is its first commit). Do NOT switch branches. No migration.

**Conventions:** tenant isolation (rule 1); status via state machines (rule 2); `Load.estimatedCost`/`costDetail` frozen, never recompute (rule 16); assigning a shipment maintains `shipment_load_legs` in the same tx + re-checks capacity (rule 18); FK ownership checks (rule 9); load numbers via `SequencesService` (rule 8); cost recompute via `LoadCostService.recompute` (rule 11); audit sensitive mutations (rule 6); endpoints `@RequireModule(TRANSPORTATION)` + `planning.read|manage`. Reuse the design system (`$lib/components/ui`), the `api<T>()` client, `toast`. NO new permission, NO migration.

**Browser verification (every UI task):** the dev servers are up. After a UI change, use chrome-devtools: navigate `http://localhost:5173`, log in (admin@pulsar.dev / admin123 / acme) if needed, open the affected page, take a snapshot/screenshot, confirm it renders + the interaction works. A UI task is NOT done on a clean build alone.

---

## File Structure

**Create:**
- `apps/web/src/routes/(app)/dispatch/+page.svelte` — workbench container (shared state).
- `apps/web/src/lib/components/dispatch/DispatchBacklog.svelte`
- `apps/web/src/lib/components/dispatch/LoadBuilder.svelte`
- `apps/web/src/lib/components/dispatch/DispatchSidePanel.svelte`
- `apps/api/test/dispatch-workbench.e2e-spec.ts`

**Modify:**
- `apps/web/src/routes/(app)/+layout.svelte` — nav: open-by-default + persistence, Dispatch entry, drop `/settings/agents` link.
- `apps/api/src/modules/transportation/shipments/shipments.controller.ts` + `shipments.service.ts` — `unassigned` filter.
- `apps/api/src/modules/transportation/loads/loads.controller.ts` + `loads.service.ts` — `consolidate`.

---

## Task 1: Nav/shell polish (web, browser-verified)

**Files:** Modify `apps/web/src/routes/(app)/+layout.svelte`.

READ the file first (it defines `groups`, `openGroups`, the top links, `hasTransportation`/`hasBilling`).

- [ ] **Step 1: Open groups by default + persist**

Replace the `openGroups` init + its `$effect` with localStorage-backed state that defaults to OPEN:

```ts
  // Nav groups: open by default; persist the user's collapse choices.
  let openGroups = $state<Record<string, boolean>>({});
  // Hydrate from localStorage once on mount.
  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem('pulsar.nav.openGroups');
    if (saved) {
      try { openGroups = JSON.parse(saved) as Record<string, boolean>; } catch { /* ignore */ }
    }
  });
  // Default any group not yet in the map to OPEN (true), and persist.
  $effect(() => {
    let changed = false;
    for (const g of groups) {
      if (openGroups[g.label] === undefined) { openGroups[g.label] = true; changed = true; }
    }
    if (changed && typeof localStorage !== 'undefined') {
      localStorage.setItem('pulsar.nav.openGroups', JSON.stringify(openGroups));
    }
  });
```
And in the toggle handler (the group `<button onclick>`), persist after toggling:
```ts
onclick={() => { openGroups[group.label] = !openGroups[group.label]; if (typeof localStorage !== 'undefined') localStorage.setItem('pulsar.nav.openGroups', JSON.stringify(openGroups)); }}
```

- [ ] **Step 2: Add the Dispatch top entry**

In the nav, right after the `Dashboard` link and before the `agent-actions` block, add a Dispatch link gated on transportation (mirror the existing top-link markup/classes):
```svelte
        {#if hasTransportation}
          <a href="/dispatch"
             class={`block rounded-md px-2 py-1.5 ${isActive('/dispatch') ? 'bg-accent text-white' : 'text-ink-faint hover:bg-sidebar-hover hover:text-white'}`}>
            Dispatch
          </a>
        {/if}
```
Also add it to the command palette commands list (with the other transportation actions): `...(hasTransportation ? [{ label: 'Dispatch', hint: 'page', run: () => goto('/dispatch') }] : [])` — append to the existing palette array.

- [ ] **Step 3: Drop the `/settings/agents` nav link (de-dupe)**

In the `Réglages` group `items`, remove the `{ href: '/settings/agents', label: 'Agents' }` entry (the first-order `/agents` space supersedes it; the page stays reachable by URL). Keep `Runtime agents` (`/settings/agent-runtime`).

- [ ] **Step 4: Build + typecheck + BROWSER VERIFY**

Run: `pnpm --filter @pulsar/web build` (clean) + `pnpm --filter @pulsar/web typecheck` (0 errors).
Browser: chrome-devtools → navigate `http://localhost:5173/dashboard` (log in if needed) → snapshot the sidebar → CONFIRM all visible groups are expanded (Opérations/Tarification/Partenaires/Facturation/Analytics/Réglages show their links without clicking) and a `Dispatch` link is present near the top. Screenshot.

- [ ] **Step 5: Commit**
```bash
git add "apps/web/src/routes/(app)/+layout.svelte"
git commit -m "feat(web): nav groups open by default + persisted; Dispatch entry; de-dupe settings/agents

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend — shipments `unassigned` filter

**Files:** Modify `shipments.controller.ts`, `shipments.service.ts`.

READ `shipments.service.ts` `list()` to see the current `where` + which statuses exist (`ShipmentStatus`). Planifiable = not yet on a load and in a status that can be planned (e.g. CONFIRMED/PLANNED — confirm the real enum values).

- [ ] **Step 1: Add the query flag** — in `ShipmentListQueryDto` (controller), add:
```ts
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  unassigned?: boolean;
```
(import `IsBoolean` already present; add `Type` from `class-transformer` if needed for the boolean coercion — match how other boolean query DTOs coerce in this repo; if query booleans arrive as strings, use a `@Transform(({value}) => value === 'true' || value === true)` instead.)

- [ ] **Step 2: Apply it in the service** — in `ShipmentsService.list`, when `query.unassigned` is true add to the `where`:
```ts
      ...(query.unassigned ? { loadId: null } : {}),
```
(Keep tenant scoping + existing status filter. `loadId` is the FK column on Shipment — confirm the exact field name in the Prisma `Shipment` model; it may be `loadId`.)

- [ ] **Step 3: Test (e2e in Task 8's suite or a quick unit)** — add a unit test in `shipments.service.spec.ts` if one exists, asserting the `where` includes `loadId: null` when `unassigned` is set; otherwise rely on the Task 8 e2e. Build: `pnpm --filter @pulsar/api build` clean.

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/modules/transportation/shipments/shipments.controller.ts apps/api/src/modules/transportation/shipments/shipments.service.ts
git commit -m "feat(api): GET /shipments?unassigned=true filter (backlog query)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Backend — `POST /loads/consolidate` (atomic)

**Files:** Modify `loads.controller.ts`, `loads.service.ts`; Test: `apps/api/test/dispatch-workbench.e2e-spec.ts` (created in Task 8 — or add a focused service spec here).

READ `loads.service.ts` `create()` + how shipment assignment + cost recompute + `shipment_load_legs` are done today (the `ShipmentsService.assignToLoad` path), and `SequencesService.nextNumber`. The consolidate method must reuse those building blocks inside ONE transaction.

- [ ] **Step 1: Add `consolidate` to `LoadsService`** — signature `consolidate(tenantId, userId, shipmentIds: string[])`:
  - Validate `shipmentIds` non-empty; `assertOwned` each shipment (rule 9), and that each is currently unassigned (`loadId === null`) and planifiable — else `BadRequestException`.
  - In a `prisma.$transaction`: create the load (number via `SequencesService.nextNumber(tenantId, 'load')`, rule 8, minimal fields matching `create()`), set each shipment's `loadId` + insert `shipment_load_legs` rows (rule 18), then recompute cost (`LoadCostService.recompute`, rule 11) — capacity is checked at warning level (don't hard-block consolidation; surface warnings in the response like `assignToLoad` does).
  - Audit (rule 6). Return the full load (same shape as `GET /loads/:id`).
  > If `LoadCostService.recompute` / capacity must run outside the tx (they may open their own), mirror exactly how `assignToLoad` sequences them; keep the load+legs write atomic and recompute right after. Do NOT reimplement costing/capacity — call the existing services.

- [ ] **Step 2: Controller route** — in `loads.controller.ts`, add (place BEFORE `@Get(':id')`/param routes so the literal `consolidate` isn't captured — it's a `@Post` so it only collides with other POSTs; still, declare it near the top of the POST routes):
```ts
  @Post('consolidate')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  consolidate(@CurrentUser() user: AuthUser, @Body() dto: ConsolidateDto) {
    return this.loads.consolidate(user.tenantId, user.id, dto.shipmentIds);
  }
```
with a DTO:
```ts
class ConsolidateDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  shipmentIds!: string[];
}
```
(import `IsArray`, `ArrayMinSize`, `IsString` from class-validator.)

- [ ] **Step 3: Build** — `pnpm --filter @pulsar/api build` clean. (e2e in Task 8.)

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/modules/transportation/loads/loads.controller.ts apps/api/src/modules/transportation/loads/loads.service.ts
git commit -m "feat(api): POST /loads/consolidate — atomic create-load-from-shipments

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Web — `/dispatch` shell + state container

**Files:** Create `apps/web/src/routes/(app)/dispatch/+page.svelte` + the three component files as MINIMAL stubs (filled in Tasks 5-7).

READ an existing rich page (e.g. `loads/[id]/+page.svelte` or `shipments/+page.svelte`) for the `api()` signature, `toast`, types, and design-system imports.

- [ ] **Step 1: Create stub components** so the container compiles:
`DispatchBacklog.svelte`, `LoadBuilder.svelte`, `DispatchSidePanel.svelte` — each:
```svelte
<script lang="ts">
  let props = $props();
</script>
<div class="text-sm text-ink-faint">…</div>
```

- [ ] **Step 2: Container `dispatch/+page.svelte`** — the shared-state owner + 3-column layout:
```svelte
<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { PageHeader } from '$lib/components/ui';
  import DispatchBacklog from '$lib/components/dispatch/DispatchBacklog.svelte';
  import LoadBuilder from '$lib/components/dispatch/LoadBuilder.svelte';
  import DispatchSidePanel from '$lib/components/dispatch/DispatchSidePanel.svelte';

  type ShipmentRow = {
    id: string; shipmentNumber: string; status: string;
    plannedPickupEarly: string | null; plannedDeliveryEarly: string | null;
    transportOrder: { id: string; orderNumber: string };
    originLocation: { name: string; city: string }; destinationLocation: { name: string; city: string };
    totalWeightKg?: number | null; totalVolumeM3?: number | null; palletCount?: number | null;
  };
  type LoadOption = { id: string; loadNumber: string; status: string };
  type LoadDetail = Record<string, unknown> & { id: string; loadNumber: string; status: string };

  let backlog = $state<ShipmentRow[]>([]);
  let backlogLoading = $state(true);
  let selectedIds = $state<Set<string>>(new Set());
  let openLoads = $state<LoadOption[]>([]);
  let selectedLoadId = $state<string | null>(null);
  let selectedLoad = $state<LoadDetail | null>(null);
  let busy = $state(false);

  const hasSelection = $derived(selectedIds.size > 0);

  async function loadBacklog() {
    backlogLoading = true;
    try {
      const res = await api<{ items: ShipmentRow[] }>('/transportation/shipments', { query: { unassigned: 'true', pageSize: 100 } });
      backlog = res.items;
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Backlog'); }
    finally { backlogLoading = false; }
  }
  async function loadOpenLoads() {
    try {
      const res = await api<{ items: LoadOption[] }>('/transportation/loads', { query: { pageSize: 100 } });
      openLoads = res.items.filter((l) => l.status === 'OPEN' || l.status === 'PLANNED');
    } catch { openLoads = []; }
  }
  async function selectLoad(id: string) {
    selectedLoadId = id;
    try { selectedLoad = await api<LoadDetail>(`/transportation/loads/${id}`); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Load'); selectedLoad = null; }
  }
  function toggle(id: string) {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    selectedIds = next;
  }
  async function consolidate() {
    if (!hasSelection) return;
    busy = true;
    try {
      const load = await api<LoadDetail>('/transportation/loads/consolidate', { method: 'POST', body: { shipmentIds: [...selectedIds] } });
      toast.success(`Load ${load.loadNumber} créé`);
      selectedIds = new Set();
      await Promise.all([loadBacklog(), loadOpenLoads()]);
      await selectLoad(load.id);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Consolidation'); }
    finally { busy = false; }
  }
  async function addSelectionToLoad() {
    if (!hasSelection || !selectedLoadId) return;
    busy = true;
    try {
      for (const sid of selectedIds) {
        await api(`/transportation/shipments/${sid}/assign-load`, { method: 'POST', body: { loadId: selectedLoadId } });
      }
      toast.success('Shipments ajoutés');
      selectedIds = new Set();
      await Promise.all([loadBacklog(), selectLoad(selectedLoadId)]);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Assignation (capacité ?)'); await loadBacklog(); }
    finally { busy = false; }
  }
  async function removeShipment(sid: string) {
    if (!selectedLoadId) return;
    busy = true;
    try {
      await api(`/transportation/shipments/${sid}/remove-load`, { method: 'POST' });
      await Promise.all([loadBacklog(), selectLoad(selectedLoadId)]);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Retrait'); }
    finally { busy = false; }
  }

  $effect(() => { void loadBacklog(); void loadOpenLoads(); });
</script>

<PageHeader title="Dispatch" />
<div class="grid h-[calc(100vh-9rem)] grid-cols-1 gap-3 lg:grid-cols-[26%_minmax(0,1fr)_30%]">
  <DispatchBacklog {backlog} {backlogLoading} {selectedIds} onToggle={toggle} />
  <LoadBuilder {selectedLoad} {openLoads} {selectedLoadId} {hasSelection} {busy}
    onSelectLoad={selectLoad} onConsolidate={consolidate} onAddSelection={addSelectionToLoad} onRemoveShipment={removeShipment} />
  <DispatchSidePanel {selectedLoad} onChanged={() => selectedLoadId && selectLoad(selectedLoadId)} />
</div>
```
> Verify the real shipments/loads list response is `{ items, total, ... }` (the `Paginated<T>` shape) and the field names against `shipments/+page.svelte`/`loads/+page.svelte`; adjust the row types to match. Verify `api()` accepts `{ query }` with string values.

- [ ] **Step 3: Build + typecheck + BROWSER VERIFY** — build/typecheck clean; chrome-devtools: open `/dispatch`, confirm the 3-column shell renders with the backlog populated (or an empty state) and no console errors. Screenshot.

- [ ] **Step 4: Commit**
```bash
git add "apps/web/src/routes/(app)/dispatch/+page.svelte" apps/web/src/lib/components/dispatch/
git commit -m "feat(web): /dispatch workbench shell + shared-state container (3-column layout)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Web — DispatchBacklog panel

**Files:** Modify `apps/web/src/lib/components/dispatch/DispatchBacklog.svelte`.

- [ ] **Step 1: Implement** the backlog list with multi-select. Props: `backlog`, `backlogLoading`, `selectedIds: Set<string>`, `onToggle(id)`. Render a scrollable column of selectable shipment cards (n°, order, O→D city pair, pickup/delivery window, kg/m³/pal, a red dot if the pickup window is past). Use design-system `Card`/`Badge`; selected state = accent ring. Empty state when no backlog. Match the `shipments/+page.svelte` row formatting helpers (`fmtWindow`).

```svelte
<script lang="ts">
  import { Badge } from '$lib/components/ui';
  let { backlog, backlogLoading, selectedIds, onToggle } = $props();
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
</script>
<div class="flex flex-col overflow-hidden rounded-card border border-edge bg-surface">
  <div class="border-b border-edge px-3 py-2 text-sm font-semibold text-ink">Backlog ({backlog.length})</div>
  <div class="flex-1 space-y-1.5 overflow-y-auto p-2">
    {#if backlogLoading}
      <p class="p-3 text-center text-xs text-ink-faint">Chargement…</p>
    {:else if backlog.length === 0}
      <p class="p-3 text-center text-xs text-ink-faint">Aucun shipment non planifié.</p>
    {:else}
      {#each backlog as s (s.id)}
        <button
          type="button"
          onclick={() => onToggle(s.id)}
          class={`w-full rounded-md border p-2 text-left text-xs transition ${selectedIds.has(s.id) ? 'border-accent ring-1 ring-accent bg-accent-soft' : 'border-edge hover:border-accent'}`}
        >
          <div class="flex items-center justify-between">
            <span class="font-semibold text-ink">{s.shipmentNumber}</span>
            <span class="text-ink-faint">{s.transportOrder.orderNumber}</span>
          </div>
          <div class="mt-1 text-ink-muted">{s.originLocation.city} → {s.destinationLocation.city}</div>
          <div class="mt-1 flex flex-wrap gap-1">
            <Badge tone="neutral">{fmt(s.plannedPickupEarly)} → {fmt(s.plannedDeliveryEarly)}</Badge>
            {#if s.totalWeightKg}<Badge tone="neutral">{s.totalWeightKg} kg</Badge>{/if}
            {#if s.palletCount}<Badge tone="neutral">{s.palletCount} pal</Badge>{/if}
          </div>
        </button>
      {/each}
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Build + typecheck + BROWSER VERIFY** — open `/dispatch`, confirm the backlog renders cards, clicking toggles the accent ring (selection). Screenshot.

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/lib/components/dispatch/DispatchBacklog.svelte
git commit -m "feat(web): dispatch backlog panel (selectable unplanned shipments)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Web — LoadBuilder panel

**Files:** Modify `apps/web/src/lib/components/dispatch/LoadBuilder.svelte`.

- [ ] **Step 1: Implement.** Props: `selectedLoad`, `openLoads`, `selectedLoadId`, `hasSelection`, `busy`, `onSelectLoad(id)`, `onConsolidate()`, `onAddSelection()`, `onRemoveShipment(id)`.
  - Top bar: a load picker (`<select>` over `openLoads`, bound to `selectedLoadId` via `onSelectLoad`) + a "Consolider en load" button (enabled when `hasSelection`, calls `onConsolidate`).
  - When `selectedLoad`: show **capacity bars** (weight/volume/pallets — derive used vs capacity from the load detail; if the load detail exposes capacity/used per axis use it, else show the totals; turn the bar red when used > capacity), the **stops timeline** (the load's stops in order with planned times), the **estimated cost** (`selectedLoad.estimatedCost` + currency, read-only), and the **assigned shipments** list with a remove (×) per shipment. An "Ajouter la sélection" button (enabled when `hasSelection`, calls `onAddSelection`).
  - Empty state when no load: "Sélectionnez un load ou consolidez des shipments."
  > READ `loads/[id]/+page.svelte` to get the EXACT field names for the load's stops, capacity, cost, and assigned shipments, and reuse its formatting. Match those names in the markup. Use design-system `Button`/`Badge`/`Card`; capacity bars are simple `<div>` proportions with `bg-danger` when over.

Provide a complete component (the implementer fills the exact field paths from the load detail page, but the structure + the capacity-bar/timeline/cost/shipments sections + the two action buttons are all present). Use `loading={busy} disabled={busy}` on the buttons.

- [ ] **Step 2: Build + typecheck + BROWSER VERIFY** — select shipments in the backlog → click "Consolider" → confirm a load is created and shown in the builder with its shipments/capacity/cost; then select shipments + "Ajouter la sélection" to an existing load → confirm capacity bars update; remove a shipment → confirm it returns to the backlog. Screenshot the populated builder.

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/lib/components/dispatch/LoadBuilder.svelte
git commit -m "feat(web): load builder panel (consolidate, capacity bars, stops, cost, assign/remove)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Web — DispatchSidePanel (map + rates + tender)

**Files:** Modify `apps/web/src/lib/components/dispatch/DispatchSidePanel.svelte`.

READ `loads/[id]/+page.svelte` FIRST to find: (a) the **map component** it uses for a load's route/stops (reuse that exact component with the same props), (b) how it calls **rate options** (`GET /transportation/loads/:id/rate-options`), and (c) the **tender** flow (`POST /transportation/loads/:id/tender` body shape). Reuse them.

- [ ] **Step 1: Implement.** Props: `selectedLoad`, `onChanged()`. When no load → empty state. When a load:
  - **Map**: render the existing route-map component for `selectedLoad` (same props as the load detail page passes it).
  - **Rate options**: on load change, fetch `GET /transportation/loads/{id}/rate-options`; list ranked options (carrier, rate, why-it-wins/specificity, fuel/accessorials). A "Tender" button per option (or a select + tender button).
  - **Carrier scorecard**: optionally show the candidate carrier's scorecard (`GET /transportation/analytics/...` as the existing page does, if cheap; else skip in v1 — note it).
  - **Tender action**: `POST /transportation/loads/{id}/tender` with the chosen carrier; on success `toast` + call `onChanged()` to refresh the load.
  > Match the load detail page's exact endpoints/props. Use `$effect` keyed on `selectedLoad?.id` to (re)fetch rate options. `loading`/`disabled` while tendering.

- [ ] **Step 2: Build + typecheck + BROWSER VERIFY** — select a load with a route → confirm the map renders the route/stops, rate options list, and a tender action; tender → confirm the load status flips to TENDERED (refresh). Screenshot.

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/lib/components/dispatch/DispatchSidePanel.svelte
git commit -m "feat(web): dispatch side panel — route map + rate options + tender

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Backend e2e + full-flow browser verification

**Files:** Create `apps/api/test/dispatch-workbench.e2e-spec.ts`.

Reuse a prior e2e bootstrap (e.g. `phase16-freight-audit.e2e-spec.ts` for app/login/prisma seeding patterns). Seed a carrier + an unassigned shipment (or several) with weight/pallets, tenant acme, BILLING not required (transportation).

- [ ] **Step 1: e2e scenarios**
1. `GET /api/v1/transportation/shipments?unassigned=true` → returns only shipments with `loadId === null` for the tenant; an assigned shipment is excluded.
2. `POST /api/v1/transportation/loads/consolidate { shipmentIds: [s1, s2] }` → 201, returns a load with a loadNumber; both shipments now have that `loadId`; `shipment_load_legs` rows exist; the load has a recomputed `estimatedCost`. Re-`GET ?unassigned=true` → s1/s2 no longer in the backlog.
3. Ownership/isolation: `consolidate` with a shipment from another tenant → rejected (not found / 400); no load created.
4. Atomicity: `consolidate` with one valid + one already-assigned shipment → rejected, NO partial load created (re-query: no new load, the valid shipment still unassigned).

- [ ] **Step 2: Run** — `pnpm db:migrate && pnpm db:seed` if needed; `pnpm --filter @pulsar/api test:e2e -- dispatch-workbench` → all pass (run 2×). Regression: `pnpm --filter @pulsar/api test:e2e -- phase16-freight-audit dispatch-workbench`.

- [ ] **Step 3: Full-flow BROWSER VERIFICATION** — chrome-devtools, the whole workbench: login → `/dispatch` → select 2 backlog shipments → Consolider → builder shows the new load with capacity bars + cost → side panel shows the map + rate options → tender → status TENDERED. Capture a screenshot of the populated 3-panel workbench. This is the phase's headline proof.

- [ ] **Step 4: Commit**
```bash
git add apps/api/test/dispatch-workbench.e2e-spec.ts
git commit -m "test(api): dispatch-workbench e2e — unassigned filter + atomic consolidate (ownership/atomicity)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Docs + full verification

**Files:** `docs/etat-du-projet.md`, `ROADMAP.md`.

- [ ] **Step 1: Status docs** — in `docs/etat-du-projet.md`, note the product pivot + Dispatch Workbench v1 shipped (first operational workbench; nav polish; `unassigned` filter + `consolidate` endpoint; no migration). In `ROADMAP.md`, add a short "Operational Workbenches" track note (Dispatch Workbench v1 done; Load Control Room / Agent Operations Center / Exception Desk / Rate Explorer / Workflow Config Designer to come; agent panel + drag/drop = workbench v2). No new hard rule (no new invariant — reuses existing rules).

- [ ] **Step 2: Full verification**
```bash
pnpm build
pnpm test
pnpm --filter @pulsar/api test:e2e -- phase16-freight-audit dispatch-workbench
```
All pass (build shared→database→api→web; unit; e2e). Plus a final browser pass of `/dispatch`. If anything fails, STOP and report BLOCKED with output (docs-only edits fine).

- [ ] **Step 3: Commit**
```bash
git add docs/etat-du-projet.md ROADMAP.md
git commit -m "docs(dispatch-workbench): status + roadmap — first operational workbench shipped

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Nav polish (open-by-default + persist, Dispatch entry, de-dupe settings/agents) → Task 1. ✅
- `unassigned` filter → Task 2. Atomic `consolidate` → Task 3. ✅
- `/dispatch` shell + shared state → Task 4. Backlog → Task 5. LoadBuilder (capacity/stops/cost/assign/remove/consolidate) → Task 6. SidePanel (map/rates/tender) → Task 7. ✅
- Browser-verification DoD → every UI task (1,4,5,6,7) + the full-flow pass in Task 8. ✅
- Backend e2e (filter, consolidate atomicity/ownership) → Task 8. ✅
- Docs → Task 9. ✅
- Frozen cost (rule 16), `shipment_load_legs` (rule 18), sequences (rule 8), ownership (rule 9), cost recompute (rule 11) → Task 3 reuses existing services, not reimplemented. ✅

**Placeholder scan:** Tasks 6/7 instruct the implementer to read `loads/[id]/+page.svelte` for EXACT field names and the map component — this is "reuse the existing component/fields," not a vague placeholder; the component structure + logic are fully specified. The carrier scorecard in Task 7 is explicitly optional-for-v1 (noted). No "TBD"/"handle edge cases" left.

**Type/contract consistency:** the container (Task 4) defines the prop contract each panel consumes (Tasks 5-7): Backlog `{backlog, backlogLoading, selectedIds, onToggle}`; LoadBuilder `{selectedLoad, openLoads, selectedLoadId, hasSelection, busy, onSelectLoad, onConsolidate, onAddSelection, onRemoveShipment}`; SidePanel `{selectedLoad, onChanged}`. Endpoints used match the controllers (`/transportation/shipments` + `?unassigned`, `/assign-load`, `/remove-load`, `/transportation/loads` + `/consolidate` + `/:id` + `/:id/rate-options` + `/:id/tender`). `consolidate` signature consistent between Task 3 (service/controller) and Task 4 (client call) and Task 8 (e2e).

**Known/flagged:** capacity "used vs capacity per axis" rendering depends on what the load detail exposes — Task 6 instructs reading the load detail page to get the real shape (the data exists: `checkCapacity` powers the assign warnings). Frontend has no unit-test harness in this repo, so UI confidence comes from browser verification + the backend e2e — explicit in the DoD.
