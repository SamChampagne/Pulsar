# UX Polish Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize Pulsar's web UX — one animated centered-modal form pattern, dedicated WMS receiving/picking detail pages, table/cards/kanban view toggles on operational lists, a complete `/apps` launcher with no orphan pages, and smooth route/loading transitions.

**Architecture:** Pure presentation work in `apps/web`. Build/upgrade three shared primitives first (`Modal`, `ViewToggle`, a single navigation catalogue), then migrate consumers onto them. No API, schema, permission, or business-logic changes.

**Tech Stack:** SvelteKit SPA (Svelte 5 runes, `ssr=false`), Tailwind (project tokens: `surface`, `ink`, `edge`, `accent`, `sidebar`, `rounded-card`, `shadow-pop`), `lucide-svelte` icons, native Svelte transitions (`svelte/transition`, `svelte/easing`).

**Verification note:** `apps/web` has **no component test runner** configured (project `pnpm test` covers state machines in `packages/shared` only). Per the spec, per-task verification is **`pnpm --filter @pulsar/web typecheck` (or `pnpm typecheck`) green** plus **manual check in the running app** (`pnpm dev`, login `admin@pulsar.dev` / `admin123`, tenant `acme`). Do not invent a test runner.

**Spec:** `docs/superpowers/specs/2026-06-17-ux-polish-pass-design.md`

---

## File Structure

**Created**
- `apps/web/src/lib/components/ui/ViewToggle.svelte` — reusable view switcher (icons + bindable `view`).
- `apps/web/src/lib/modules/navigation.ts` — single source of truth: domains → sections → page links (`{ href, label, icon?, permission?, module? }`) consumed by nav, desk, command palette.
- `apps/web/src/routes/(app)/wms/receiving/[id]/+page.svelte` — Receipt detail page.
- `apps/web/src/routes/(app)/wms/picking/[id]/+page.svelte` — PickOrder detail page.

**Modified**
- `apps/web/src/lib/components/ui/Modal.svelte` — scrim, focus trap, scroll lock, open/close animation, `size` prop, `prefers-reduced-motion`.
- `apps/web/src/lib/components/ui/index.ts` — export `ViewToggle`; drop `Panel` after migration.
- `apps/web/src/routes/(app)/+layout.svelte` — consume `navigation.ts`; add route transition.
- `apps/web/src/routes/(app)/apps/+page.svelte` — grouped launcher + search from catalogue.
- `apps/web/src/lib/components/ui/CommandPalette.svelte` — consume catalogue.
- `apps/web/src/routes/(app)/fleet/+page.svelte` — inline form → "Ajouter" button + Modal.
- `apps/web/src/routes/(app)/locations/+page.svelte` — Panel → Modal.
- `apps/web/src/routes/(app)/wms/receiving/+page.svelte` — list (table+cards), rows link to `[id]`.
- `apps/web/src/routes/(app)/wms/picking/+page.svelte` — list (table+cards), rows link to `[id]`.
- `apps/web/src/routes/(app)/{shipments,loads,transport-orders,dispatch}/+page.svelte` — use `ViewToggle`.
- `apps/web/src/routes/(app)/wms/cycle-counts/+page.svelte`, `yard/appointments/+page.svelte`, `yard/gate/+page.svelte`, fleet maintenance list — add `ViewToggle` + cards/kanban.
- Any page still importing `Panel.svelte` — migrate to Modal/page.

**Deleted**
- `apps/web/src/lib/components/ui/Panel.svelte` — after all imports removed.

---

## Phase 1 — Shared primitives

### Task 1: Enrich `Modal.svelte` into the form standard

**Files:**
- Modify: `apps/web/src/lib/components/ui/Modal.svelte`

- [ ] **Step 1: Replace the component with the enriched version**

Keep the existing prop names (`open`, `title`, `children`, `footer`) for backward compatibility. Add `size` (replacing/aliasing `maxWidth`), scroll lock, focus trap, and animation.

```svelte
<script lang="ts">
  import { X } from 'lucide-svelte';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { pushOverlay, popOverlay, isTopOverlay } from '$lib/stores/overlay-stack';

  type Size = 'sm' | 'md' | 'lg' | 'xl';
  let {
    open = $bindable(false),
    title = '',
    size = 'md' as Size,
    onclose = undefined as (() => void) | undefined,
    children,
    footer = undefined,
  } = $props();

  const widths: Record<Size, string> = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dur = reduce ? 0 : 150;

  let token = $state<symbol | null>(null);
  let dialogEl = $state<HTMLElement | null>(null);
  let lastFocused: HTMLElement | null = null;

  function close() {
    open = false;
    onclose?.();
  }

  $effect(() => {
    if (open) {
      const t = pushOverlay();
      token = t;
      lastFocused = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      // focus first focusable element inside the dialog
      queueMicrotask(() => {
        const focusable = dialogEl?.querySelector<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        );
        focusable?.focus();
      });
      return () => {
        popOverlay(t);
        token = null;
        document.body.style.overflow = '';
        lastFocused?.focus?.();
      };
    }
  });

  function onkeydown(e: KeyboardEvent) {
    if (!open || !token || !isTopOverlay(token)) return;
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key === 'Tab' && dialogEl) {
      const nodes = Array.from(
        dialogEl.querySelectorAll<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((n) => !n.hasAttribute('disabled'));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-sidebar/40 p-4 backdrop-blur-[1px]"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    role="presentation"
    transition:fade={{ duration: dur }}
  >
    <div
      bind:this={dialogEl}
      class="flex max-h-[85vh] w-full {widths[size]} flex-col rounded-card bg-surface shadow-pop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      transition:scale={{ duration: dur, start: 0.96, easing: cubicOut }}
    >
      <div class="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 class="text-sm font-bold text-ink">{title}</h2>
        <button class="text-ink-faint hover:text-ink" onclick={close} aria-label="Close">
          <X class="size-4" />
        </button>
      </div>
      <div class="flex-1 overflow-y-auto p-4">{@render children()}</div>
      {#if footer}
        <div class="flex justify-end gap-2 border-t border-edge px-4 py-3">{@render footer()}</div>
      {/if}
    </div>
  </div>
{/if}
```

- [ ] **Step 2: Find every existing `Modal` usage that passes `maxWidth`**

Run: `grep -rn "maxWidth" apps/web/src/routes apps/web/src/lib`
Expected: a list of call sites (WMS picking/receiving create modals, shipments detail, transport-orders create).

- [ ] **Step 3: Migrate `maxWidth="max-w-..."` props to the `size` prop**

For each hit, map the Tailwind width to the nearest `size`: `max-w-sm→sm`, `max-w-lg`/default→`md`, `max-w-2xl→lg`, `max-w-3xl`/`max-w-4xl→xl`. Replace `maxWidth="max-w-2xl"` with `size="lg"` (etc.). Leave plain `<Modal>` (no width) untouched — `md` is the default.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: PASS (0 errors).

- [ ] **Step 5: Manual check**

In a running app, open any WMS create modal: it animates in, the page behind is grayed and not scrollable, `Esc` and scrim-click close it, focus lands in the first field, `Tab` cycles within the modal.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/ui/Modal.svelte apps/web/src/routes apps/web/src/lib
git commit -m "feat(web): standard animated modal — scrim, focus trap, scroll lock, sizes"
```

---

### Task 2: Extract `ViewToggle.svelte` and adopt it in existing list pages

**Files:**
- Create: `apps/web/src/lib/components/ui/ViewToggle.svelte`
- Modify: `apps/web/src/lib/components/ui/index.ts`
- Modify: `apps/web/src/routes/(app)/shipments/+page.svelte` (lines ~270–300)
- Modify: `apps/web/src/routes/(app)/{loads,transport-orders,dispatch}/+page.svelte`

- [ ] **Step 1: Create the component**

```svelte
<!-- apps/web/src/lib/components/ui/ViewToggle.svelte -->
<script lang="ts">
  import {
    Table as TableIcon,
    LayoutGrid,
    KanbanSquare,
    Map as MapIcon,
  } from 'lucide-svelte';

  export type ViewId = 'table' | 'cards' | 'kanban' | 'map';

  const ICONS: Record<ViewId, typeof TableIcon> = {
    table: TableIcon,
    cards: LayoutGrid,
    kanban: KanbanSquare,
    map: MapIcon,
  };
  const LABELS: Record<ViewId, string> = {
    table: 'Tableau',
    cards: 'Cartes',
    kanban: 'Kanban',
    map: 'Carte',
  };

  let {
    view = $bindable('table' as ViewId),
    views = ['table', 'cards'] as ViewId[],
  } = $props();
</script>

<div class="inline-flex items-center gap-1 rounded-md border border-edge bg-surface p-0.5">
  {#each views as v (v)}
    <button
      type="button"
      onclick={() => (view = v)}
      class={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors ${
        view === v ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
      }`}
      aria-pressed={view === v}
    >
      {@const Icon = ICONS[v]}
      <Icon class="size-4" />
      <span class="hidden sm:inline">{LABELS[v]}</span>
    </button>
  {/each}
</div>
```

- [ ] **Step 2: Export it**

In `apps/web/src/lib/components/ui/index.ts`, add: `export { default as ViewToggle } from './ViewToggle.svelte';` (and `export type { ViewId } from './ViewToggle.svelte';` if the file uses `lang="ts"` exports — otherwise re-declare the type where needed).

- [ ] **Step 3: Replace the inline toggle in `shipments/+page.svelte`**

Delete the local `views` array and the inline `{#each views}` button block (around lines 270–300). Keep the `view` state. Render instead:

```svelte
<ViewToggle bind:view views={['table', 'kanban', 'map']} />
```

Import: `import { ViewToggle } from '$lib/components/ui';`. Ensure the page's `View` type still matches `ViewId` (`'table' | 'kanban' | 'map'` is a subset — fine).

- [ ] **Step 4: Repeat for `loads`, `transport-orders`, `dispatch`**

Same swap. `transport-orders`: `views={['table','kanban']}`. `dispatch`: it uses `map`/`board`/`table` — map its labels to `['map','kanban','table']` (treat its "board" as `kanban`); keep dispatch's own state variable names, just feed `ViewToggle` a derived `view` or rename to the shared ids. If dispatch's wiring is non-trivial, leave dispatch on its current inline toggle and note it — do NOT break it.

- [ ] **Step 5: Typecheck + manual**

Run: `pnpm --filter @pulsar/web typecheck` → PASS. In-app: shipments/loads/transport-orders toggles still switch views identically.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/ui apps/web/src/routes/\(app\)/shipments apps/web/src/routes/\(app\)/loads apps/web/src/routes/\(app\)/transport-orders apps/web/src/routes/\(app\)/dispatch
git commit -m "refactor(web): extract reusable ViewToggle, adopt in operational lists"
```

---

### Task 3: Single navigation catalogue

**Files:**
- Create: `apps/web/src/lib/modules/navigation.ts`
- Modify: `apps/web/src/routes/(app)/+layout.svelte`

- [ ] **Step 1: Read the current nav definition**

Run: `grep -n "domains\|NavLink\|NavSection\|Domain\b" apps/web/src/routes/(app)/+layout.svelte`
Open the `domains` derived array (≈ line 130 onward). It is the de-facto catalogue: `Domain { key, label, icon, home, prefixes, sections: NavSection[] }`, `NavSection { label, links: NavLink[] }`, `NavLink { href, label }`.

- [ ] **Step 2: Move the catalogue into `navigation.ts` as data + a builder**

Create `navigation.ts` exporting the types and a pure builder that takes the permission/module flags and returns the filtered domains. Keep icons referenced by importing from `lucide-svelte` here.

```ts
// apps/web/src/lib/modules/navigation.ts
import type { ComponentType } from 'svelte';
// import the same lucide icons currently used in +layout.svelte

export interface NavLink {
  href: string;
  label: string;
  /** permission predicate key; undefined = always visible if domain visible */
  perm?: string;
}
export interface NavSection {
  label: string;
  links: NavLink[];
}
export interface NavDomain {
  key: string;
  label: string;
  icon: ComponentType;
  home: string;
  prefixes: string[];
  /** module key required to show this domain, if any */
  module?: string;
  sections: NavSection[];
}

/** Capability flags resolved in the layout from $auth. */
export interface NavCaps {
  enabledModules: string[];
  can: (perm: string) => boolean;
}

/** The full catalogue, unfiltered. Single source for nav, desk and palette. */
export function navCatalogue(): NavDomain[] {
  // Paste the existing `domains` array body here verbatim, but:
  //  - add every currently-orphan page as a link in the right section
  //    (control-tower, finance, locations, assets, settings/audit, framework, etc.)
  //  - tag links that need a permission with `perm: PERMISSIONS....` key strings
  return [/* domains... */];
}

/** Filter the catalogue by the tenant's modules and the user's permissions. */
export function visibleDomains(caps: NavCaps): NavDomain[] {
  return navCatalogue()
    .filter((d) => !d.module || caps.enabledModules.includes(d.module))
    .map((d) => ({
      ...d,
      sections: d.sections
        .map((s) => ({ ...s, links: s.links.filter((l) => !l.perm || caps.can(l.perm)) }))
        .filter((s) => s.links.length > 0),
    }))
    .filter((d) => d.sections.length > 0);
}
```

- [ ] **Step 3: Consume it in `+layout.svelte`**

Replace the inline `domains` derived with:

```svelte
import { visibleDomains } from '$lib/modules/navigation';
const domains = $derived(
  visibleDomains({
    enabledModules: $auth?.tenant?.enabledModules ?? [],
    can: (p) => $auth?.user.permissions.includes(p) ?? false,
  }),
);
```

Keep the existing active-domain / contextual-rail logic untouched — it already reads `domains`, `home`, `prefixes`, `sections`.

- [ ] **Step 4: Audit for orphan routes**

Run: `ls apps/web/src/routes/(app)` and cross-check each route directory against the hrefs in `navCatalogue()`. Every user-reachable route must appear as a link in some section OR be a detail/sub-route of one (e.g. `loads/[id]`). List any still-orphan route; add it to the catalogue. Acceptance: no top-level `(app)` route is unreachable from nav.

- [ ] **Step 5: Typecheck + manual**

Run: `pnpm --filter @pulsar/web typecheck` → PASS. In-app: sidebar nav is byte-identical to before for a full-permission user, plus previously-missing links now appear.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/modules/navigation.ts "apps/web/src/routes/(app)/+layout.svelte"
git commit -m "refactor(web): single navigation catalogue feeding the sidebar"
```

---

## Phase 2 — Form standard migration

### Task 4: Fleet roster — inline form → button + Modal

**Files:**
- Modify: `apps/web/src/routes/(app)/fleet/+page.svelte`

- [ ] **Step 1: Wrap the existing inline create form in a `Modal`**

Add `import { Modal } from '$lib/components/ui';` and a state flag `let showCreate = $state(false);`. Move the existing inline `<Card>` form (the Véhicule/Remorque/Chauffeur tab form, ≈ lines 441–547) into:

```svelte
<Modal bind:open={showCreate} title="Ajouter un asset" size="lg">
  <!-- the existing tabbed form markup, unchanged -->
  {#snippet footer()}
    <Button variant="secondary" onclick={() => (showCreate = false)}>Annuler</Button>
    <Button onclick={submit} loading={saving} disabled={!formValid}>Créer</Button>
  {/snippet}
</Modal>
```

Keep all existing form state, the tab switch, and the submit handler. On successful submit, set `showCreate = false` in addition to the existing reset.

- [ ] **Step 2: Add the opener in the `PageHeader`**

```svelte
<PageHeader title="Fleet roster" subtitle="...">
  {#snippet actions()}
    <Button onclick={() => (showCreate = true)}>Ajouter</Button>
  {/snippet}
</PageHeader>
```

(Match the page's existing `PageHeader` actions-slot convention — check whether it uses `{#snippet actions()}` or an `actions` prop, and follow it.)

- [ ] **Step 3: Do the same for the preventive-maintenance schedule form**

If the maintenance-schedule create form is also inline on this page, give it its own `showSchedule` flag + Modal + opener button, same pattern.

- [ ] **Step 4: Typecheck + manual**

Run: `pnpm --filter @pulsar/web typecheck` → PASS. In-app: Fleet page shows an "Ajouter" button; clicking opens the animated modal; creating an asset works and closes the modal; the page no longer shows a permanently-visible form.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(app)/fleet/+page.svelte"
git commit -m "feat(web): fleet roster create via modal (button-opened)"
```

---

### Task 5: Locations — Panel → Modal

**Files:**
- Modify: `apps/web/src/routes/(app)/locations/+page.svelte`

- [ ] **Step 1: Replace the `Panel` import/usage with `Modal`**

Swap `import { Panel } from ...` → `import { Modal } from '$lib/components/ui';`. Replace `<Panel bind:open={...} title=...>` with `<Modal bind:open={...} title=... size="md">`. Move the panel's `footer` slot/snippet as-is (Modal has the same `footer` snippet). Remove any `href` "Open" affordance (Modal has no `href`); if a full detail page is needed later it's out of scope here.

- [ ] **Step 2: Ensure the opener exists**

The create/edit form must be triggered by a button (e.g. "Nouveau lieu" in `PageHeader` actions, and an edit action per row). If the page already toggled the Panel from a button, keep that wiring pointed at the Modal flag.

- [ ] **Step 3: Typecheck + manual**

Run: `pnpm --filter @pulsar/web typecheck` → PASS. In-app: Lieux create/edit opens a centered animated modal (not the narrow right drawer); background grayed/non-interactive.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/locations/+page.svelte"
git commit -m "feat(web): locations form uses standard modal"
```

---

### Task 6: Migrate remaining `Panel` usages and delete `Panel`

**Files:**
- Modify: every page importing `Panel`
- Modify: `apps/web/src/lib/components/ui/index.ts`
- Delete: `apps/web/src/lib/components/ui/Panel.svelte`

- [ ] **Step 1: Find all remaining importers**

Run: `grep -rn "Panel" apps/web/src/routes apps/web/src/lib/components/ui/index.ts`
Expected after Tasks 5/7/8: only incidental usages remain (e.g. Loads detail). List them.

- [ ] **Step 2: Migrate each to `Modal`**

For each: swap component to `Modal`, pick `size` by content (`md` default, `lg`/`xl` for dense detail), keep `title`/`footer`. If a usage was a read-only detail with an `href` "Open full page", either drop the `href` (content fits the modal) or, if a dedicated page already exists, replace the Panel with a plain link/navigation to that page instead of a modal.

- [ ] **Step 3: Remove the export and delete the file**

In `index.ts` delete the `Panel` export line. Then delete `Panel.svelte`.

- [ ] **Step 4: Prove zero references**

Run: `grep -rn "Panel" apps/web/src`
Expected: no import of `./Panel` / `components/ui` `Panel` remains (matches on the word "Panel" inside unrelated strings are fine — verify none are imports).

- [ ] **Step 5: Typecheck + manual**

Run: `pnpm --filter @pulsar/web typecheck` → PASS. In-app: spot-check each migrated page opens a modal correctly.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "refactor(web): drop right-drawer Panel — modal is the form standard"
```

---

## Phase 3 — WMS master-detail → dedicated pages

### Task 7: Receiving detail page + list

**Files:**
- Create: `apps/web/src/routes/(app)/wms/receiving/[id]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/wms/receiving/+page.svelte`

- [ ] **Step 1: Identify the API calls**

Run: `grep -rn "receiving\|receipts\|/wms/receipts" apps/web/src/routes/(app)/wms/receiving/+page.svelte`
Note the list endpoint and the get-by-id endpoint used by the current Panel detail (e.g. `api('/wms/receipts')`, `api('/wms/receipts/:id')`) and the line/workflow action endpoints. Reuse them verbatim.

- [ ] **Step 2: Build the detail page**

Model it on an existing detail page (`apps/web/src/routes/(app)/loads/[id]/+page.svelte`) for structure: `$page.params.id`, `$state` + `$effect`-triggered `load()`, `Skeleton` while loading, `ErrorNotice` on error, `PageHeader` with the doc number + status `Badge`. Show: receipt header fields, line items table, workflow action buttons (gated by the same permissions the current page uses), and line create/edit in a `Modal`. Use `api<T>()` from `$lib/api/client`.

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  import { api } from '$lib/api/client';
  import { PageHeader, Badge, Skeleton, ErrorNotice, Modal, Button, Table } from '$lib/components/ui';

  let receipt = $state<any | null>(null);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    loading = true; error = '';
    try {
      receipt = await api(`/wms/receipts/${$page.params.id}`); // confirm exact path in step 1
    } catch (e) {
      error = e instanceof Error ? e.message : 'Erreur';
    } finally {
      loading = false;
    }
  }
  $effect(() => { void load(); });
</script>

{#if loading}
  <Skeleton class="h-40" />
{:else if error}
  <ErrorNotice message={error} retry={load} />
{:else if receipt}
  <PageHeader title={`Réception ${receipt.number}`} subtitle={receipt.location?.name}>
    {#snippet actions()}<Badge tone="info">{receipt.status}</Badge>{/snippet}
  </PageHeader>
  <!-- header fields, line items Table, workflow Buttons, line-edit Modal -->
{/if}
```

(Replace `any` with the existing list/detail types if the page already declares them; copy field/line rendering from the current Panel detail markup.)

- [ ] **Step 3: Convert the list to navigate to the detail page**

In `wms/receiving/+page.svelte`: remove the `Panel` and the `selected` two-column logic. Render the list as a table where each row links to `/wms/receiving/{id}` (e.g. `<a href={...}>` or row `onclick` → `goto`). Add an explicit `EmptyState` when there are no receipts. Cards/kanban views are added in Task 9.

- [ ] **Step 4: Typecheck + manual**

Run: `pnpm --filter @pulsar/web typecheck` → PASS. In-app: clicking a receipt navigates to its own page with all info up front; no empty second column; create/edit line opens a modal.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(app)/wms/receiving"
git commit -m "feat(web): dedicated WMS receiving detail page; list navigates to it"
```

---

### Task 8: Picking detail page + list

**Files:**
- Create: `apps/web/src/routes/(app)/wms/picking/[id]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/wms/picking/+page.svelte`

- [ ] **Step 1: Identify the API calls** — same approach as Task 7 Step 1 for `/wms/pick-orders` (confirm exact path).

- [ ] **Step 2: Build the PickOrder detail page** — same structure as Task 7 Step 2: header (number, status, location, linked shipment if any), line items, workflow actions, line-edit Modal.

- [ ] **Step 3: Convert the list to navigate to `/wms/picking/{id}`** — remove Panel + two-column logic; rows link out; `EmptyState` when empty.

- [ ] **Step 4: Typecheck + manual** — `pnpm --filter @pulsar/web typecheck` PASS; in-app pick order opens its own page.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(app)/wms/picking"
git commit -m "feat(web): dedicated WMS picking detail page; list navigates to it"
```

---

## Phase 4 — Operational list views

### Task 9: Add cards/kanban to operational lists

**Files:**
- Modify: `apps/web/src/routes/(app)/wms/receiving/+page.svelte`
- Modify: `apps/web/src/routes/(app)/wms/picking/+page.svelte`
- Modify: `apps/web/src/routes/(app)/wms/cycle-counts/+page.svelte`
- Modify: `apps/web/src/routes/(app)/yard/appointments/+page.svelte`
- Modify: `apps/web/src/routes/(app)/yard/gate/+page.svelte`
- Modify: fleet maintenance orders list (confirm path under `apps/web/src/routes/(app)/fleet/`)

For EACH page, repeat this pattern (do them one commit at a time):

- [ ] **Step 1: Add view state + toggle**

```svelte
import { ViewToggle } from '$lib/components/ui';
import type { ViewId } from '$lib/components/ui';
let view = $state<ViewId>('table');
```
Render `<ViewToggle bind:view views={['table','cards','kanban']} />` in the `PageHeader` actions (use `['table','cards']` for entities without a meaningful status to group by).

- [ ] **Step 2: Keep the existing table under `{#if view === 'table'}`**

- [ ] **Step 3: Add the cards view**

```svelte
{:else if view === 'cards'}
  {#if items.length === 0}
    <EmptyState title="Rien ici" />
  {:else}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each items as it (it.id)}
        <a href={detailHref(it)} class="block">
          <Card>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-ink">{it.number}</span>
              <Badge tone={toneFor(it.status)}>{labelFor(it.status)}</Badge>
            </div>
            <!-- 2–4 key fields for this entity -->
          </Card>
        </a>
      {/each}
    </div>
  {/if}
```

Use the page's existing `toneFor`/`labelFor` helpers (from `$lib/components/ui`) and the same detail href as the table rows.

- [ ] **Step 4: Add the kanban view (status-bearing entities only)**

Mirror the Shipments kanban pattern: derive columns from the entity's status enum (import from `@pulsar/shared`), bucket items by status, render one column per status with the same cards. Reuse Shipments' kanban markup as the template.

- [ ] **Step 5: Typecheck + manual + commit (per page)**

Run: `pnpm --filter @pulsar/web typecheck` → PASS. In-app: toggle switches table/cards/kanban; cards/kanban link to detail.

```bash
git add "apps/web/src/routes/(app)/<page>"
git commit -m "feat(web): <page> gets cards/kanban views"
```

---

## Phase 5 — Fluidity

### Task 10: Route transition + uniform skeletons

**Files:**
- Modify: `apps/web/src/routes/(app)/+layout.svelte`
- Modify: list/detail pages lacking a loading skeleton

- [ ] **Step 1: Add a short route transition to the content slot**

In `+layout.svelte`, wrap the page content (the `{@render children()}` / `<slot>` area, NOT the sidebar) in a keyed block transitioning on the route id:

```svelte
<script>
  import { page } from '$app/stores';
  import { fade } from 'svelte/transition';
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
</script>

{#key $page.url.pathname}
  <div in:fade={{ duration: reduce ? 0 : 120 }}>
    {@render children()}
  </div>
{/key}
```

Keep it subtle (fade only, ~120 ms). Do not transition the sidebar/contextual rail.

- [ ] **Step 2: Standardize loading skeletons**

Run: `grep -Ln "Skeleton" apps/web/src/routes/(app)/**/+page.svelte` to find list/detail pages with NO skeleton. For each, show `<Skeleton class="h-40" />` (or a few stacked skeleton rows) while the page's `loading` flag is true, instead of rendering nothing/blank. Follow the existing `Skeleton.svelte` usage pattern already present in other pages.

- [ ] **Step 3: Typecheck + manual**

Run: `pnpm --filter @pulsar/web typecheck` → PASS. In-app: navigating between modules shows a brief fade and a skeleton (never a blank flash); reduced-motion users get no animation.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)"
git commit -m "feat(web): subtle route transition + uniform loading skeletons"
```

---

## Phase 6 — Desk launcher

### Task 11: `/apps` grouped launcher + search; palette from catalogue

**Files:**
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`
- Modify: `apps/web/src/lib/components/ui/CommandPalette.svelte`

- [ ] **Step 1: Render the desk from the catalogue**

Use `visibleDomains(...)` from `navigation.ts` (same caps as the layout). Render one section per domain; each section lists its page links as cards (icon + label + the page's short purpose). Group order follows the catalogue order.

```svelte
<script lang="ts">
  import { visibleDomains } from '$lib/modules/navigation';
  import { auth } from '$lib/stores/auth';
  import { PageHeader, Card, Input } from '$lib/components/ui';

  let q = $state('');
  const domains = $derived(
    visibleDomains({
      enabledModules: $auth?.tenant?.enabledModules ?? [],
      can: (p) => $auth?.user.permissions.includes(p) ?? false,
    }),
  );
  const filtered = $derived(
    domains
      .map((d) => ({
        ...d,
        sections: d.sections
          .map((s) => ({
            ...s,
            links: s.links.filter((l) =>
              `${d.label} ${s.label} ${l.label}`.toLowerCase().includes(q.toLowerCase()),
            ),
          }))
          .filter((s) => s.links.length),
      }))
      .filter((d) => d.sections.length),
  );
</script>

<PageHeader title="Pulsar desk" subtitle="Toutes vos applications" />
<Input bind:value={q} placeholder="Rechercher une page…" />
{#each filtered as d (d.key)}
  <section class="mt-6">
    <h2 class="mb-2 text-sm font-bold text-ink">{d.label}</h2>
    {#each d.sections as s (s.label)}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {#each s.links as l (l.href)}
          <a href={l.href}><Card>{l.label}</Card></a>
        {/each}
      </div>
    {/each}
  </section>
{/each}
```

(Match `Input`/`Card` props to their real signatures.)

- [ ] **Step 2: Feed the command palette from the catalogue**

In `CommandPalette.svelte`, build the command list by flattening `visibleDomains(...)` links instead of a hand-maintained list, plus the existing special entries (`/apps`, AI assistant). Keep the Ctrl+K behavior.

- [ ] **Step 3: Verify no orphan pages**

Cross-check `ls apps/web/src/routes/(app)` against the desk output for a full-permission user. Every reachable top-level page appears on the desk. Note in the commit body any intentionally desk-hidden routes (e.g. `[id]` detail routes, `framework`).

- [ ] **Step 4: Typecheck + manual**

Run: `pnpm --filter @pulsar/web typecheck` → PASS. In-app: desk shows every domain's pages grouped; search filters live; Ctrl+K reaches the same pages.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(app)/apps/+page.svelte" apps/web/src/lib/components/ui/CommandPalette.svelte
git commit -m "feat(web): /apps is the complete grouped launcher; palette from catalogue"
```

---

## Final verification

- [ ] `pnpm --filter @pulsar/web typecheck` → 0 errors.
- [ ] `pnpm typecheck` (all workspaces) → 0 errors (confirm nothing else broke).
- [ ] `grep -rn "from '.*Panel'" apps/web/src` → no results (Panel fully removed).
- [ ] `pnpm build` → web builds clean.
- [ ] Manual pass in running app: modal standard (anim/scrim/focus/scroll-lock/Esc), Fleet "Ajouter" button, Lieux modal, receiving/picking detail pages, view toggles on operational lists, route fade + skeletons, desk lists every page with working search.
- [ ] Update `docs/etat-du-projet.md` if it tracks UI status (optional, per repo convention).

---

## Self-review notes

- **Spec coverage:** Chantier 1 → Tasks 1,4,5,6. Chantier 2 → Tasks 7,8. Chantier 3 → Tasks 2,9. Chantier 4 → Tasks 3,11. Chantier 5 → Task 10. All five covered.
- **Types:** `ViewId` defined in Task 2 and reused in Task 9. `NavDomain/NavSection/NavLink/NavCaps` defined in Task 3 and reused in Task 11. `Modal` `size` prop defined in Task 1 and used everywhere after.
- **No test runner:** verification standardized on `pnpm typecheck` + manual app check, consistent across all tasks (web has no component test harness).
- **Risk — dispatch toggle:** Task 2 Step 4 explicitly allows leaving dispatch's bespoke toggle if wiring is non-trivial, rather than breaking it.
