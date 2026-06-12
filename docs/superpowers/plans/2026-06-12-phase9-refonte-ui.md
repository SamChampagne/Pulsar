# Phase 9 — Refonte UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the entire Pulsar SPA UI (28 pages) on a custom design system — "console hybride" direction — without touching any API contract.

**Architecture:** Tailwind CSS 4 (CSS-first config, tokens as CSS variables) + ~15 hand-written Svelte 5 components in `apps/web/src/lib/components/ui/`. New collapsible dark sidebar layout with a ⌘K command palette (navigation only — AI slot reserved). Legacy global CSS kept alongside during migration, deleted at the end. Pages migrate in 7 lots; the app stays functional after every lot.

**Tech Stack:** Svelte 5 (runes), SvelteKit SPA (`ssr=false`), Tailwind CSS 4 + `@tailwindcss/vite`, `lucide-svelte` (icons), `@fontsource-variable/inter` (font), `leaflet` (map, internal load detail only).

**Verification model:** the web app has no unit-test infra and this phase adds none (pure presentation; the 249 existing tests are API/shared). Per-task gate = `pnpm --filter @pulsar/web typecheck`. Per-lot gate = `pnpm --filter @pulsar/web build` + manual visual pass with `pnpm dev`. Final gate = `pnpm typecheck && pnpm build && pnpm test && pnpm test:e2e`.

**Constraints (hard):**
- ZERO change under `apps/api/`, `packages/` — git diff must only touch `apps/web/` and docs.
- Public pages expose no extra data (no coordinates on public tracking — verified: payload has none).
- All auth/module-gating logic in layouts is preserved as-is (copy, restyle, don't rewrite).

---

## Reference — current state (verified 2026-06-12)

- 28 pages under `apps/web/src/routes/` (18 app, 5 public-token, login/reset/oidc, 2 platform).
- Shared components today: `StatusBadge.svelte`, `Toasts.svelte`, `TrackingTimeline.svelte` only.
- Global CSS: `apps/web/src/app.css` (176 lines: `.shell`, `.sidebar`, `.card`, `.btn`, `.page-header`, table styles…), imported by `src/routes/+layout.svelte`.
- API client: `api<T>(path, { method, body, query })` from `$lib/api/client` — unchanged.
- Page pattern: `$state` + `$effect`-triggered `load()`, errors in local `error` string — unchanged.
- Useful read-only endpoints for the map: `GET /transportation/locations?search=&page=` (lat/long nullable), `GET /transportation/tracking/events?loadId=` (lat/long on POSITION_UPDATE), load detail `route.stops[]` carries `locationId` (location NOT included server-side → resolve client-side).
- Master-data lists support `?search=` (customers, carriers, locations, vehicles, trailers); loads/transport-orders do NOT → palette = navigation + actions only.

---

## Lot 0 — Socle (Tasks 1–9)

### Task 1: Dependencies + Tailwind 4 wiring

**Files:**
- Modify: `apps/web/package.json` (via pnpm)
- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/src/lib/styles/legacy.css` (move of current `app.css` content)
- Modify: `apps/web/src/app.css` (becomes tokens + base)
- Modify: `apps/web/src/app.html` (lang, title)

- [ ] **Step 1: Install dependencies**

```bash
pnpm --filter @pulsar/web add -D tailwindcss @tailwindcss/vite @types/leaflet
pnpm --filter @pulsar/web add lucide-svelte leaflet @fontsource-variable/inter
```

Expected: lockfile updated, no peer-dep errors.

- [ ] **Step 2: Register the Tailwind Vite plugin**

In `apps/web/vite.config.ts`, add the import and plugin (keep everything else):

```ts
import tailwindcss from '@tailwindcss/vite';
// ...
  plugins: [tailwindcss(), sveltekit()],
```

- [ ] **Step 3: Move legacy CSS aside**

Copy the entire current content of `apps/web/src/app.css` into a new file
`apps/web/src/lib/styles/legacy.css` unchanged. (Old pages keep rendering until each
lot migrates them; this file is deleted in Task 29.)

- [ ] **Step 4: Rewrite `apps/web/src/app.css` as the design system entry**

```css
@import 'tailwindcss';
@import '@fontsource-variable/inter';
@import './lib/styles/legacy.css';

@theme {
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;

  /* Brand */
  --color-sidebar: #0f172a;
  --color-sidebar-hover: #1e293b;
  --color-sidebar-border: #1e293b;
  --color-accent: #1d4ed8;
  --color-accent-hover: #1e40af;
  --color-accent-soft: #eff6ff;

  /* Surfaces (light theme; a dark theme later only re-maps these) */
  --color-canvas: #f1f5f9;
  --color-surface: #ffffff;
  --color-surface-muted: #f8fafc;
  --color-edge: #e2e8f0;
  --color-edge-soft: #f1f5f9;

  /* Text */
  --color-ink: #0f172a;
  --color-ink-muted: #64748b;
  --color-ink-faint: #94a3b8;

  /* Status tones (badges, dots) */
  --color-ok: #15803d;
  --color-ok-soft: #dcfce7;
  --color-warn: #a16207;
  --color-warn-soft: #fef9c3;
  --color-danger: #b91c1c;
  --color-danger-soft: #fee2e2;
  --color-info: #1d4ed8;
  --color-info-soft: #dbeafe;
  --color-neutral: #475569;
  --color-neutral-soft: #f1f5f9;

  --radius-card: 0.5rem;
  --shadow-pop: 0 4px 24px rgb(15 23 42 / 0.12);
}

body {
  font-family: var(--font-sans);
  background: var(--color-canvas);
  color: var(--color-ink);
}
```

Note: `@theme` makes utilities like `bg-surface`, `text-ink-muted`, `border-edge`,
`bg-ok-soft` available everywhere. Never hardcode a hex in components.

- [ ] **Step 5: app.html touch-up**

In `apps/web/src/app.html`: `lang="en"` → `lang="fr"` is NOT done (UI copy stays
English as today — i18n is out of scope). Only verify the title is `Pulsar`. No change
expected; skip the edit if identical.

- [ ] **Step 6: Verify**

```bash
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/web build
```

Expected: both PASS; existing pages still render via legacy.css (spot-check `pnpm dev` → /login).

- [ ] **Step 7: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): tailwind 4 + design tokens, legacy css quarantined"
```

### Task 2: Status mapping + Badge

**Files:**
- Create: `apps/web/src/lib/components/ui/status.ts`
- Create: `apps/web/src/lib/components/ui/Badge.svelte`

- [ ] **Step 1: Write the status→tone catalog** (`status.ts`)

```ts
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

/** Single source of truth: workflow status → visual tone. Keys are the enum
 *  values from @pulsar/shared (TransportOrderStatus, ShipmentStatus, LoadStatus,
 *  TenderStatus, InvoiceStatus, CustomerInvoiceStatus, StopStatus). */
const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'neutral', CONFIRMED: 'info', PLANNED: 'warn', OPEN: 'neutral',
  DISPATCHED: 'ok', IN_TRANSIT: 'info', PICKED_UP: 'info',
  DELIVERED: 'ok', COMPLETED: 'ok', PAID: 'ok', APPROVED: 'ok', ACCEPTED: 'ok',
  SENT: 'info', PENDING: 'warn', ARRIVED: 'info', DEPARTED: 'info',
  CANCELLED: 'neutral', DECLINED: 'danger', EXPIRED: 'danger', FAILED: 'danger',
  DISPUTED: 'danger', DELAYED: 'danger',
};

export function toneFor(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}

export function labelFor(status: string): string {
  return status.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
```

- [ ] **Step 2: Badge component** (`Badge.svelte`)

```svelte
<script lang="ts">
  import type { Tone } from './status';
  let { tone = 'neutral' as Tone, children } = $props();
  const tones: Record<Tone, string> = {
    ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info',
    neutral: 'bg-neutral-soft text-neutral',
  };
</script>

<span class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
  <span class="text-[8px] leading-none">●</span>{@render children()}
</span>
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck
git add apps/web/src/lib/components/ui
git commit -m "feat(web): ui Badge + status tone catalog"
```

### Task 3: Button, Card, PageHeader, EmptyState, Skeleton

**Files:** Create all under `apps/web/src/lib/components/ui/`:
`Button.svelte`, `Card.svelte`, `PageHeader.svelte`, `EmptyState.svelte`, `Skeleton.svelte`

- [ ] **Step 1: Button.svelte**

```svelte
<script lang="ts">
  let {
    variant = 'primary' as 'primary' | 'secondary' | 'danger' | 'ghost',
    type = 'button' as 'button' | 'submit',
    disabled = false,
    loading = false,
    onclick = undefined as (() => void | Promise<void>) | undefined,
    children,
  } = $props();
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'border border-edge bg-surface text-ink hover:bg-surface-muted',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  };
</script>

<button
  {type}
  class={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]}`}
  disabled={disabled || loading}
  {onclick}
>
  {#if loading}<span class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"></span>{/if}
  {@render children()}
</button>
```

- [ ] **Step 2: Card.svelte**

```svelte
<script lang="ts">
  let { padded = true, children } = $props();
</script>

<div class={`rounded-card border border-edge bg-surface ${padded ? 'p-4' : ''}`}>
  {@render children()}
</div>
```

- [ ] **Step 3: PageHeader.svelte**

```svelte
<script lang="ts">
  let { title, count = undefined as number | undefined, actions = undefined, children = undefined } = $props();
</script>

<div class="mb-4 flex items-center justify-between gap-3">
  <div class="flex items-baseline gap-2">
    <h1 class="text-xl font-bold text-ink">{title}</h1>
    {#if count !== undefined}<span class="text-sm text-ink-muted">{count} résultats</span>{/if}
  </div>
  {#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}
</div>
{#if children}{@render children()}{/if}
```

- [ ] **Step 4: EmptyState.svelte**

```svelte
<script lang="ts">
  let { message = 'Nothing here yet.', children = undefined } = $props();
</script>

<div class="flex flex-col items-center gap-2 py-10 text-center">
  <p class="text-sm text-ink-faint">{message}</p>
  {#if children}{@render children()}{/if}
</div>
```

- [ ] **Step 5: Skeleton.svelte**

```svelte
<script lang="ts">
  let { rows = 3 } = $props();
</script>

<div class="animate-pulse space-y-2 p-4">
  {#each Array(rows) as _, i (i)}
    <div class="h-4 rounded bg-edge-soft"></div>
  {/each}
</div>
```

- [ ] **Step 6: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck
git add apps/web/src/lib/components/ui
git commit -m "feat(web): ui Button, Card, PageHeader, EmptyState, Skeleton"
```

### Task 4: Form controls — Field, Input, Select, Textarea

**Files:** Create under `apps/web/src/lib/components/ui/`:
`Field.svelte`, `Input.svelte`, `Select.svelte`, `Textarea.svelte`

- [ ] **Step 1: Field.svelte** (label + slot + error line)

```svelte
<script lang="ts">
  let { label, error = '', children } = $props();
</script>

<label class="block">
  <span class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</span>
  {@render children()}
  {#if error}<span class="mt-1 block text-xs text-danger">{error}</span>{/if}
</label>
```

- [ ] **Step 2: Input.svelte / Textarea.svelte / Select.svelte**

`Input.svelte`:

```svelte
<script lang="ts">
  let { value = $bindable(''), type = 'text', placeholder = '', disabled = false } = $props();
</script>

<input
  {type} {placeholder} {disabled}
  bind:value
  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
/>
```

`Textarea.svelte`: same classes on a `<textarea bind:value rows={rows}>` with `rows = 3` prop.

`Select.svelte` (options rendered by caller):

```svelte
<script lang="ts">
  let { value = $bindable(''), disabled = false, children } = $props();
</script>

<select
  bind:value {disabled}
  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
>
  {@render children()}
</select>
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck
git add apps/web/src/lib/components/ui
git commit -m "feat(web): ui form controls (Field, Input, Select, Textarea)"
```

### Task 5: Table system + density store + FilterBar

**Files:**
- Create: `apps/web/src/lib/stores/density.ts`
- Create: `apps/web/src/lib/components/ui/Table.svelte`
- Create: `apps/web/src/lib/components/ui/FilterBar.svelte`

- [ ] **Step 1: density store** (`density.ts`)

```ts
import { writable } from 'svelte/store';

const KEY = 'pulsar:table-density';
type Density = 'comfortable' | 'compact';

function initial(): Density {
  if (typeof localStorage === 'undefined') return 'comfortable';
  return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable';
}

export const density = writable<Density>(initial());
density.subscribe((v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v);
});

export function toggleDensity() {
  density.update((v) => (v === 'compact' ? 'comfortable' : 'compact'));
}
```

- [ ] **Step 2: Table.svelte** — styled shell; pages provide `head` and `body` snippets.
Density is applied via a CSS class on the wrapper that retargets cell padding.

```svelte
<script lang="ts">
  import { density } from '$lib/stores/density';
  let { head, body } = $props();
</script>

<div class={`overflow-x-auto rounded-card border border-edge bg-surface ${$density === 'compact' ? 'tbl-compact' : ''}`}>
  <table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b border-edge bg-surface-muted text-left text-[11px] tracking-wide text-ink-muted uppercase">
        {@render head()}
      </tr>
    </thead>
    <tbody>{@render body()}</tbody>
  </table>
</div>

<style>
  table :global(th) { padding: 0.5rem 0.75rem; font-weight: 600; }
  table :global(td) { padding: 0.625rem 0.75rem; border-bottom: 1px solid var(--color-edge-soft); }
  table :global(tbody tr:last-child td) { border-bottom: none; }
  table :global(tbody tr:hover) { background: var(--color-surface-muted); }
  .tbl-compact table :global(td) { padding: 0.25rem 0.75rem; }
</style>
```

Caveat: `<style>` in Svelte scopes to the component; the `:global()` wrappers above are
required because th/td come from snippets. The `.tbl-compact` selector lives on the
wrapper div, so the rule reads `.tbl-compact table :global(td)`.

- [ ] **Step 3: FilterBar.svelte** (toolbar row + density toggle built in)

```svelte
<script lang="ts">
  import { Rows3 } from 'lucide-svelte';
  import { toggleDensity } from '$lib/stores/density';
  let { children = undefined } = $props();
</script>

<div class="mb-3 flex flex-wrap items-center gap-2">
  {#if children}{@render children()}{/if}
  <button
    class="ml-auto inline-flex items-center gap-1 rounded-md border border-edge bg-surface px-2 py-1 text-xs text-ink-muted hover:text-ink"
    onclick={toggleDensity}
    title="Basculer la densité du tableau"
  >
    <Rows3 class="size-3.5" /> Densité
  </button>
</div>
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck
git add apps/web/src/lib
git commit -m "feat(web): ui Table with switchable density, FilterBar"
```

### Task 6: Modal + Tabs

**Files:** Create `apps/web/src/lib/components/ui/Modal.svelte`, `Tabs.svelte`

- [ ] **Step 1: Modal.svelte**

```svelte
<script lang="ts">
  import { X } from 'lucide-svelte';
  let { open = $bindable(false), title = '', children, footer = undefined } = $props();
  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-sidebar/40 p-4"
       onclick={(e) => { if (e.target === e.currentTarget) open = false; }}
       role="presentation">
    <div class="w-full max-w-lg rounded-card bg-surface shadow-pop" role="dialog" aria-modal="true">
      <div class="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 class="text-sm font-bold text-ink">{title}</h2>
        <button class="text-ink-faint hover:text-ink" onclick={() => (open = false)} aria-label="Fermer">
          <X class="size-4" />
        </button>
      </div>
      <div class="max-h-[70vh] overflow-y-auto p-4">{@render children()}</div>
      {#if footer}<div class="flex justify-end gap-2 border-t border-edge px-4 py-3">{@render footer()}</div>{/if}
    </div>
  </div>
{/if}
```

- [ ] **Step 2: Tabs.svelte**

```svelte
<script lang="ts">
  let { tabs = [] as { id: string; label: string }[], active = $bindable(''), children } = $props();
</script>

<div class="mb-4 flex gap-1 border-b border-edge">
  {#each tabs as t (t.id)}
    <button
      class={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${active === t.id ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink'}`}
      onclick={() => (active = t.id)}
    >{t.label}</button>
  {/each}
</div>
{@render children()}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck
git add apps/web/src/lib/components/ui
git commit -m "feat(web): ui Modal + Tabs"
```

### Task 7: Panel (slide-over)

**Files:** Create `apps/web/src/lib/components/ui/Panel.svelte`

- [ ] **Step 1: Panel.svelte** — right slide-over, used by list pages for row preview.

```svelte
<script lang="ts">
  import { X, ExternalLink } from 'lucide-svelte';
  let {
    open = $bindable(false),
    title = '',
    href = undefined as string | undefined, // « Ouvrir ↗ » target
    children,
    footer = undefined,
  } = $props();
  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <aside class="fixed top-0 right-0 z-40 flex h-full w-[360px] flex-col border-l border-edge bg-surface shadow-pop"
         aria-label={title}>
    <div class="flex items-center justify-between border-b border-edge px-4 py-3">
      <h2 class="truncate text-sm font-bold text-ink">{title}</h2>
      <div class="flex items-center gap-2">
        {#if href}
          <a {href} class="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            Ouvrir <ExternalLink class="size-3" />
          </a>
        {/if}
        <button class="text-ink-faint hover:text-ink" onclick={() => (open = false)} aria-label="Fermer">
          <X class="size-4" />
        </button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-4">{@render children()}</div>
    {#if footer}<div class="flex gap-2 border-t border-edge px-4 py-3">{@render footer()}</div>{/if}
  </aside>
{/if}
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck
git add apps/web/src/lib/components/ui
git commit -m "feat(web): ui Panel slide-over"
```

### Task 8: CommandPalette (⌘K — navigation + actions, AI slot reserved)

**Files:** Create `apps/web/src/lib/components/ui/CommandPalette.svelte`

- [ ] **Step 1: CommandPalette.svelte**

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { Search } from 'lucide-svelte';

  interface Command { label: string; hint?: string; run: () => void }
  let { open = $bindable(false), commands = [] as Command[] } = $props();
  let query = $state('');
  let selected = $state(0);

  const filtered = $derived(
    commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),
  );

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open = !open;
      query = '';
      selected = 0;
    }
    if (!open) return;
    if (e.key === 'Escape') open = false;
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, filtered.length - 1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); }
    if (e.key === 'Enter' && filtered[selected]) { filtered[selected].run(); open = false; }
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-sidebar/40 pt-[15vh]"
       onclick={(e) => { if (e.target === e.currentTarget) open = false; }} role="presentation">
    <div class="w-full max-w-md overflow-hidden rounded-card bg-surface shadow-pop">
      <div class="flex items-center gap-2 border-b border-edge px-3">
        <Search class="size-4 text-ink-faint" />
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="w-full bg-transparent py-3 text-sm outline-none placeholder:text-ink-faint"
          placeholder="Aller à… (l'assistant IA arrive ici)"
          bind:value={query}
          oninput={() => (selected = 0)}
          autofocus
        />
        <kbd class="rounded border border-edge px-1.5 text-[10px] text-ink-faint">esc</kbd>
      </div>
      <ul class="max-h-72 overflow-y-auto py-1">
        {#each filtered as cmd, i (cmd.label)}
          <li>
            <button
              class={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${i === selected ? 'bg-accent-soft text-accent' : 'text-ink'}`}
              onmouseenter={() => (selected = i)}
              onclick={() => { cmd.run(); open = false; }}
            >
              {cmd.label}
              {#if cmd.hint}<span class="text-xs text-ink-faint">{cmd.hint}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="px-3 py-4 text-center text-xs text-ink-faint">Aucun résultat</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}
```

Note: the command list is passed by the layout (Task 9) — navigation entries filtered by
enabled modules + "New load" / "New transport order" actions via `goto`.

- [ ] **Step 2: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck
git add apps/web/src/lib/components/ui
git commit -m "feat(web): ui CommandPalette (nav + actions, AI slot reserved)"
```

### Task 9: New app layout — collapsible dark sidebar, ⌘K, bell, user menu

**Files:**
- Modify: `apps/web/src/routes/(app)/+layout.svelte` (full rewrite of markup/styles; KEEP script logic: auth guard, notifications polling, module gating, logout — copy them verbatim)

- [ ] **Step 1: Rewrite the layout**

Keep from the current file, unchanged: the `Notification` interface, `notifications`/
`notifOpen` state, `loadNotifications()`, `markRead()`, both `$effect` blocks, module
`$derived` flags, `logout()`. Replace the nav data + markup with:

```svelte
<script lang="ts">
  // … existing imports + logic kept verbatim …
  import { ChevronDown, ChevronRight, Bell, Settings, LogOut, Search } from 'lucide-svelte';
  import CommandPalette from '$lib/components/ui/CommandPalette.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';

  interface NavGroup { label: string; items: { href: string; label: string }[]; visible: boolean }

  const groups = $derived<NavGroup[]>([
    {
      label: 'Opérations', visible: hasTransportation,
      items: [
        { href: '/transport-orders', label: 'Transport Orders' },
        { href: '/shipments', label: 'Shipments' },
        { href: '/loads', label: 'Loads' },
      ],
    },
    {
      label: 'Tarification', visible: hasTransportation,
      items: [
        { href: '/lanes', label: 'Lanes' },
        { href: '/rates', label: 'Rates' },
        { href: '/accessorials', label: 'Accessorials' },
        { href: '/fuel-tables', label: 'Fuel tables' },
      ],
    },
    {
      label: 'Partenaires', visible: hasTransportation,
      items: [
        { href: '/customers', label: 'Customers' },
        { href: '/carriers', label: 'Carriers' },
      ],
    },
    { label: 'Facturation', visible: hasBilling, items: [{ href: '/invoices', label: 'Invoices' }] },
    { label: 'Analytics', visible: hasTransportation, items: [{ href: '/analytics', label: 'Analytics' }] },
    {
      label: 'Réglages', visible: true,
      items: [
        { href: '/settings/users', label: 'Users' },
        { href: '/settings/api-keys', label: 'API keys' },
        { href: '/settings/modules', label: 'Modules' },
        { href: '/settings/sso', label: 'SSO' },
      ],
    },
  ]);

  // Collapsible state: the group containing the active route starts open.
  let openGroups = $state<Record<string, boolean>>({});
  $effect(() => {
    for (const g of groups) {
      if (g.items.some((i) => isActive(i.href))) openGroups[g.label] = true;
    }
  });

  let paletteOpen = $state(false);
  const paletteCommands = $derived([
    { label: 'Dashboard', hint: 'page', run: () => goto('/dashboard') },
    ...groups.filter((g) => g.visible).flatMap((g) =>
      g.items.map((i) => ({ label: i.label, hint: g.label, run: () => goto(i.href) })),
    ),
    ...(hasTransportation
      ? [
          { label: 'New transport order', hint: 'action', run: () => goto('/transport-orders') },
          { label: 'New load', hint: 'action', run: () => goto('/loads') },
        ]
      : []),
  ]);
</script>
```

Markup skeleton (full styling per the validated mockup):

```svelte
{#if $auth}
  <div class="flex min-h-screen">
    <aside class="flex w-56 flex-col bg-sidebar px-3 py-4 text-sm">
      <div class="px-2 font-bold text-white">⬢ PULSAR</div>
      <div class="mb-3 px-2 text-xs text-ink-faint">{$auth.tenant.name}</div>

      <button
        class="mb-3 flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-hover px-2 py-1.5 text-xs text-ink-faint"
        onclick={() => (paletteOpen = true)}
      >
        <Search class="size-3.5" /> Rechercher…
        <kbd class="ml-auto rounded border border-sidebar-border px-1 text-[10px]">⌘K</kbd>
      </button>

      <nav class="flex-1 space-y-0.5 overflow-y-auto">
        <a href="/dashboard"
           class={`block rounded-md px-2 py-1.5 ${isActive('/dashboard') ? 'bg-accent text-white' : 'text-ink-faint hover:bg-sidebar-hover hover:text-white'}`}>
          Dashboard
        </a>
        {#each groups.filter((g) => g.visible) as group (group.label)}
          <button
            class="flex w-full items-center gap-1 rounded-md px-2 py-1.5 font-semibold text-slate-200 hover:bg-sidebar-hover"
            onclick={() => (openGroups[group.label] = !openGroups[group.label])}
          >
            {#if openGroups[group.label]}<ChevronDown class="size-3.5" />{:else}<ChevronRight class="size-3.5" />{/if}
            {group.label}
          </button>
          {#if openGroups[group.label]}
            {#each group.items as item (item.href)}
              <a href={item.href}
                 class={`block rounded-md py-1.5 pr-2 pl-7 ${isActive(item.href) ? 'bg-accent text-white' : 'text-ink-faint hover:bg-sidebar-hover hover:text-white'}`}>
                {item.label}
              </a>
            {/each}
          {/if}
        {/each}
      </nav>

      <div class="border-t border-sidebar-border pt-3">
        <!-- bell: keep existing notifOpen dropdown logic, restyled; unread badge -->
        <!-- user row: email + logout button (LogOut icon) -->
      </div>
    </aside>

    <main class="min-w-0 flex-1 p-6">{@render children()}</main>
  </div>
  <CommandPalette bind:open={paletteOpen} commands={paletteCommands} />
{/if}
```

The bell dropdown keeps the exact same data flow (poll 60 s, markRead) — restyle the
list as a `shadow-pop` card anchored above the bell row; unread count in a small red
`bg-danger` dot. Keep ALL existing logic lines.

- [ ] **Step 2: Verify**

```bash
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/web build
```

Then `pnpm dev` → login → check: sidebar groups collapse, ⌘K opens/navigates,
bell works, logout works, module gating (acme has all modules → all groups visible).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes
git commit -m "feat(web): new app shell - collapsible dark sidebar, cmd-k palette, bell"
```

---

## Lot 1 — Opérations (Tasks 10–14)

### Task 10: Loads list (exemplar page — the pattern all list pages follow)

**Files:**
- Modify: `apps/web/src/routes/(app)/loads/+page.svelte` (full rewrite)

- [ ] **Step 1: Rewrite the page.** Keep interface `LoadRow`, `load()`, `createLoad()`
and the `$effect` exactly as today (data layer untouched). Replace all markup:

```svelte
<PageHeader title="Loads" count={total}>
  {#snippet actions()}
    <Button onclick={createLoad}>New load</Button>
  {/snippet}
</PageHeader>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

<FilterBar>
  <Select bind:value={statusFilter}>
    <option value="">All statuses</option>
    {#each ['OPEN', 'PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'] as s (s)}
      <option value={s}>{s.replaceAll('_', ' ')}</option>
    {/each}
  </Select>
</FilterBar>

<Table>
  {#snippet head()}
    <th>Load #</th><th>Carrier</th><th>Driver</th><th>Shipments</th>
    <th>Dispatched</th><th>Mode</th><th>Status</th>
  {/snippet}
  {#snippet body()}
    {#each loads as row (row.id)}
      <tr class="cursor-pointer" onclick={() => (selected = row)}>
        <td class="font-semibold text-accent">{row.loadNumber}</td>
        <td>{row.carrier?.name ?? '—'}</td>
        <td>{row.driver ? `${row.driver.firstName} ${row.driver.lastName}` : '—'}</td>
        <td>{row.shipments.length}</td>
        <td>{row.dispatchedAt ? new Date(row.dispatchedAt).toLocaleString() : '—'}</td>
        <td>{#if row.mode}<span class="rounded border border-edge px-1.5 text-xs text-neutral">{row.mode}</span>{:else}—{/if}</td>
        <td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td>
      </tr>
    {:else}
      <tr><td colspan="7"><EmptyState message="No loads yet." /></td></tr>
    {/each}
  {/snippet}
</Table>

<Panel open={selected !== null} title={selected?.loadNumber ?? ''} href={selected ? `/loads/${selected.id}` : undefined}
       onclose={() => (selected = null)}>
  <!-- summary rows: carrier, driver, shipments count, dispatched, mode, status badge -->
</Panel>
```

Add `let selected = $state<LoadRow | null>(null);` to the script. The Panel `open`
prop binds via `open={selected !== null}` — adapt Panel usage: simplest is
`{#if selected}<Panel open={true} …>` with close setting `selected = null`; wire the
Panel's `open = $bindable` accordingly (pass `bind:open` on a derived boolean is not
bindable — use the `{#if selected}` form and have the X button call a `onclose` prop:
ADD `onclose = undefined as (() => void) | undefined` to Panel.svelte and call it in
the close button alongside `open = false`).

Also: replace navigation-on-click with panel-on-click; the load number cell keeps an
explicit `<a href={`/loads/${row.id}`}>` for direct open (stopPropagation).
Delete the old `<style>` block entirely.

- [ ] **Step 2: Verify**

```bash
pnpm --filter @pulsar/web typecheck
```

`pnpm dev`: list renders, filter works, row click opens panel, « Ouvrir ↗ » navigates,
density toggle visibly changes row padding and persists after refresh.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): loads list on new design system (panel preview, density)"
```

### Task 11: LoadMap component (Leaflet, read-only)

**Files:**
- Create: `apps/web/src/lib/components/LoadMap.svelte`

- [ ] **Step 1: LoadMap.svelte**

Props: `stops: { sequence: number; locationId: string; type: string }[]`, `loadId: string`.
Behaviour: resolve locations + last position client-side from existing endpoints,
render markers + naive polyline. Hide entirely when no stop has coordinates.

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import 'leaflet/dist/leaflet.css';

  interface StopIn { sequence: number; locationId: string; type: string }
  let { stops = [] as StopIn[], loadId } = $props();

  let el: HTMLDivElement;
  let hasPoints = $state(false);

  interface Loc { id: string; latitude: number | null; longitude: number | null; name: string }
  interface TrackingEvent { type: string; latitude: number | null; longitude: number | null; occurredAt: string }

  onMount(async () => {
    const L = await import('leaflet');
    // Resolve stop locations (existing endpoint, tenant-scoped).
    const locs = await Promise.all(
      [...new Set(stops.map((s) => s.locationId))].map((id) =>
        api<Loc>(`/transportation/locations/${id}`).catch(() => null),
      ),
    );
    const byId = new Map(locs.filter(Boolean).map((l) => [l!.id, l!]));
    const points = stops
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => ({ s, loc: byId.get(s.locationId) }))
      .filter((p) => p.loc?.latitude != null && p.loc?.longitude != null);

    if (points.length === 0) return; // graceful degradation: map stays hidden
    hasPoints = true;

    const map = L.map(el, { attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);

    const latlngs = points.map((p) => [p.loc!.latitude!, p.loc!.longitude!] as [number, number]);
    points.forEach((p, i) => {
      L.marker(latlngs[i])
        .addTo(map)
        .bindTooltip(`${i + 1}. ${p.loc!.name} (${p.s.type})`);
    });
    L.polyline(latlngs, { color: '#1d4ed8', dashArray: '6 6' }).addTo(map);

    // Last known position from tracking events (existing endpoint).
    try {
      const events = await api<TrackingEvent[]>('/transportation/tracking/events', {
        query: { loadId },
      });
      const pos = events.find((e) => e.latitude != null && e.longitude != null);
      if (pos) {
        L.circleMarker([pos.latitude!, pos.longitude!], { radius: 7, color: '#15803d' })
          .addTo(map)
          .bindTooltip(`Dernière position — ${new Date(pos.occurredAt).toLocaleString()}`);
      }
    } catch {
      // tracking optional
    }

    map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
  });
</script>

<div bind:this={el} class={`h-64 w-full rounded-card border border-edge ${hasPoints ? '' : 'hidden'}`}></div>
```

Caveat to verify at implementation: the exact response shape of
`GET /transportation/tracking/events?loadId=` (array vs `Paginated`) — check
`tracking.controller.ts:18` and adapt the `api<…>` generic. If it returns `Paginated`,
use `.items`. Do NOT modify the API.

- [ ] **Step 2: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck
git add apps/web/src/lib/components/LoadMap.svelte
git commit -m "feat(web): LoadMap leaflet component (stops + last position, read-only)"
```

### Task 12: Load detail page

**Files:**
- Modify: `apps/web/src/routes/(app)/loads/[id]/+page.svelte`

- [ ] **Step 1: Rewrite markup** keeping ALL existing script logic (load fetch, actions:
assign/dispatch/transitions/BOL/rate options/documents — every `api()` call stays).
Target structure:

- `PageHeader` with load number + status `Badge` + action `Button`s (existing actions).
- Two-column grid (`lg:grid-cols-3 gap-4`): left 2/3 = `Card` Route (stops list with
  per-stop status badges + `LoadMap stops={route.stops} loadId={id}`), `Card` Shipments,
  `Card` Documents/BOL (existing list + generate button); right 1/3 = `Card` Summary
  (carrier, driver, vehicle/trailer, mode, cost detail breakdown as today),
  `Card` Tender state, `Card` capacity/window warnings (existing `windowWarnings`,
  `modeWarning` rendered as `bg-warn-soft` callouts).
- `Tabs` only if the page already has tab-like sections; otherwise stacked cards.

All existing buttons keep their handlers; restyle with `Button` variants
(`danger` for cancel, `secondary` for BOL/regenerate).

- [ ] **Step 2: Verify**

```bash
pnpm --filter @pulsar/web typecheck
```

`pnpm dev`: open a load (seeded demo) → map shows when locations have lat/long,
actions still work end-to-end (assign → dispatch on a seeded OPEN load).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): load detail on new design system with LoadMap"
```

### Task 13: Transport orders list + detail

**Files:**
- Modify: `apps/web/src/routes/(app)/transport-orders/+page.svelte`
- Modify: `apps/web/src/routes/(app)/transport-orders/[id]/+page.svelte`

- [ ] **Step 1: List page** — exact same recipe as Task 10 (PageHeader/FilterBar/
Table/Badge/Panel). Columns: Order # (accent link), Customer, Origin→Destination,
Mode, Requested pickup, Status. Panel preview: customer, route, windows, shipments
count, status. Keep existing filters (status select + any existing ones) in FilterBar.

- [ ] **Step 2: Detail page** — same recipe as Task 12: PageHeader + status badge +
action buttons (confirm/plan/split/cancel — keep all handlers), grid of Cards:
Shipments (with split UI as today), Windows (early/late fields), Customer,
`windowWarnings` callouts. No map here (orders have locations but the load is where
the route lives — YAGNI).

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck
git add apps/web/src
git commit -m "feat(web): transport orders pages on new design system"
```

### Task 14: Shipments page + lot build gate

**Files:**
- Modify: `apps/web/src/routes/(app)/shipments/+page.svelte`

- [ ] **Step 1: Same list recipe.** Columns: Shipment #, Order #, Origin→Destination,
Weight/Volume/Pallets, Load (link or —), Status. Keep existing assign-to-load controls
inside the Panel preview (the page currently has inline actions — move them to the
Panel footer with `Button`).

- [ ] **Step 2: Lot gate**

```bash
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/web build
```

Manual pass (guide-fonctionnel.md parcours): order → plan → loads list → load detail.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): shipments page on new design system"
```

---

## Lot 2 — Tarification (Task 15–16)

### Task 15: Lanes + Rates pages

**Files:**
- Modify: `apps/web/src/routes/(app)/lanes/+page.svelte`
- Modify: `apps/web/src/routes/(app)/rates/+page.svelte`

- [ ] **Step 1: Lanes** — list recipe. Columns: Lane (origin → destination, geo level
badges), Carrier prefs count, Created. Keep the existing create/edit form in a `Modal`
(today it's inline — move form fields into Modal with `Field`/`Input`/`Select`).
- [ ] **Step 2: Rates** — list recipe. Columns: Name, Type, Lane (or « tous »), Mode,
Base amount + currency, Valid from/to, Status badge (active when within validity).
Existing create/edit form → `Modal`. Weight-break table inside the modal keeps its
current field list, restyled with `Input`.
- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck
git add apps/web/src
git commit -m "feat(web): lanes + rates pages on new design system"
```

### Task 16: Accessorials + Fuel tables pages

**Files:**
- Modify: `apps/web/src/routes/(app)/accessorials/+page.svelte`
- Modify: `apps/web/src/routes/(app)/fuel-tables/+page.svelte`

- [ ] **Step 1:** Same list recipe for both. Accessorials columns: Code, Name, Unit,
Amount, Currency. Fuel tables columns: Name, Effective date, Surcharge %, rows count.
Forms → `Modal`. Keep every existing handler.
- [ ] **Step 2: Verify + commit**

```bash
pnpm --filter @pulsar/web typecheck && pnpm --filter @pulsar/web build
git add apps/web/src
git commit -m "feat(web): accessorials + fuel tables on new design system"
```

---

## Lot 3 — Partenaires, Facturation, Analytics, Dashboard (Tasks 17–19)

### Task 17: Customers + Carriers

**Files:**
- Modify: `apps/web/src/routes/(app)/customers/+page.svelte`
- Modify: `apps/web/src/routes/(app)/carriers/+page.svelte`

- [ ] **Step 1:** List recipe ×2. Customers columns: Code, Name, Email, Created.
Carriers columns: Code, Name, SCAC, MC/DOT, Scorecard link/preview if present today.
Search inputs (both endpoints support `?search=`) → `Input` in FilterBar with the
existing debounce-or-effect pattern of the page (keep as-is). Forms → `Modal`.
- [ ] **Step 2: Verify + commit** (same commands; message `feat(web): customers + carriers on new design system`)

### Task 18: Invoices (carrier + customer statements)

**Files:**
- Modify: `apps/web/src/routes/(app)/invoices/+page.svelte`

- [ ] **Step 1:** The page covers buy-side invoices and (since 7.3) customer
statements — keep whatever sections exist today (read the file first), restyle:
`Tabs` for the two invoice families if both live here, list recipe per tab, status
`Badge`, action `Button`s for transitions (approve/send/mark-paid/dispute — keep
handlers), reconciliation fields (variance, tolerance) in the Panel or detail Card
exactly as the data flows today.
- [ ] **Step 2: Verify + commit** (`feat(web): invoices on new design system`)

### Task 19: Analytics + Dashboard

**Files:**
- Modify: `apps/web/src/routes/(app)/analytics/+page.svelte`
- Modify: `apps/web/src/routes/(app)/dashboard/+page.svelte`

- [ ] **Step 1: Analytics** — scorecard table → list recipe; metric tiles → grid of
`Card`s (`grid sm:grid-cols-2 lg:grid-cols-4 gap-3`), each tile: label
(`text-xs uppercase text-ink-muted`) + value (`text-2xl font-bold`).
- [ ] **Step 2: Dashboard** — KPI tiles same Card-grid pattern + quick links to
Opérations pages; keep existing data calls. NO map this phase.
- [ ] **Step 3: Lot gate + commit**

```bash
pnpm --filter @pulsar/web typecheck && pnpm --filter @pulsar/web build
git add apps/web/src
git commit -m "feat(web): analytics + dashboard on new design system"
```

---

## Lot 4 — Réglages (Task 20)

### Task 20: Users, API keys, Modules, SSO

**Files:**
- Modify: `apps/web/src/routes/(app)/settings/users/+page.svelte`
- Modify: `apps/web/src/routes/(app)/settings/api-keys/+page.svelte`
- Modify: `apps/web/src/routes/(app)/settings/modules/+page.svelte`
- Modify: `apps/web/src/routes/(app)/settings/sso/+page.svelte`

- [ ] **Step 1:** List recipe for users (columns: Email, Name, Roles, Status,
Invited/active) and api-keys (Name, Prefix, Scopes, Last used, Revoke button —
keep reveal-once-on-create flow exactly). Modules: card grid (one `Card` per module:
name, description, enabled toggle — keep PATCH handler). SSO: single `Card` form with
`Field`/`Input` (issuer, client id…) — keep test/save handlers.
- [ ] **Step 2: Verify + commit** (`feat(web): settings pages on new design system`)

---

## Lot 5 — Public + auth pages (Tasks 21–24)

### Task 21: PublicShell + login/reset/forgot/oidc

**Files:**
- Create: `apps/web/src/lib/components/PublicShell.svelte`
- Modify: `apps/web/src/routes/login/+page.svelte`
- Modify: `apps/web/src/routes/forgot-password/+page.svelte`
- Modify: `apps/web/src/routes/reset-password/[token]/+page.svelte`
- Modify: `apps/web/src/routes/oidc/complete/+page.svelte`

- [ ] **Step 1: PublicShell.svelte** — centered card on canvas, brand header:

```svelte
<script lang="ts">
  let { title = '', subtitle = '', maxWidth = 'max-w-md', children } = $props();
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-canvas p-4">
  <div class="mb-6 flex items-center gap-2 text-xl font-bold text-ink">
    <span class="text-accent">⬢</span> PULSAR
  </div>
  <div class={`w-full ${maxWidth} rounded-card border border-edge bg-surface p-6 shadow-pop`}>
    {#if title}<h1 class="mb-1 text-lg font-bold text-ink">{title}</h1>{/if}
    {#if subtitle}<p class="mb-4 text-sm text-ink-muted">{subtitle}</p>{/if}
    {@render children()}
  </div>
</div>
```

- [ ] **Step 2:** Rebuild the 4 auth pages on PublicShell + Field/Input/Button.
Keep ALL logic (login + SSO discovery redirect, token handling). Login keeps the
SSO button if present today.
- [ ] **Step 3: Verify + commit** (`feat(web): public shell + auth pages`)

### Task 22: Tender public page

**Files:**
- Modify: `apps/web/src/routes/tender/[token]/+page.svelte`

- [ ] **Step 1:** PublicShell `maxWidth="max-w-2xl"`. Content: load summary Card
(stops, dates, weight — fields already in the payload), Accept / Decline `Button`s
(primary/danger) with existing handlers, expiry countdown line if expiresAt present.
State after action: success/declined message card (keep logic).
- [ ] **Step 2: Verify + commit** (`feat(web): tender public page`)

### Task 23: Track public page (NO map — payload has no coordinates)

**Files:**
- Modify: `apps/web/src/routes/track/[token]/+page.svelte`
- Modify: `apps/web/src/lib/components/TrackingTimeline.svelte` (restyle)

- [ ] **Step 1:** PublicShell `max-w-2xl`. Status hero (big Badge + origin → destination
city/state), planned/actual dates grid, `TrackingTimeline` restyled: vertical line
(`border-l-2 border-edge`), dots colored by event type (`toneFor`-style mapping:
DELAYED/EXCEPTION → danger, DELIVERED → ok, else info), POD block when present.
- [ ] **Step 2: Verify + commit** (`feat(web): public tracking page`)

### Task 24: Driver mobile page + Portal

**Files:**
- Modify: `apps/web/src/routes/driver/[token]/+page.svelte`
- Modify: `apps/web/src/routes/portal/[token]/+page.svelte`

- [ ] **Step 1: Driver (mobile-first):** single column, full-width tap targets
(`Button` with `class="w-full py-3"` allowance — add optional `size`/`class`
passthrough prop to Button if needed: `let { class: extra = '' } …` appended to the
class string). Stop cards in sequence with big ARRIVED/DEPARTED buttons, POD form
(signature name, photo upload, notes) as today, BOL link button (existing endpoint).
Keep every handler.
- [ ] **Step 2: Portal:** PublicShell `max-w-3xl`; order list (list recipe but inside
the shell), order creation form (DRAFT) → sectioned Card form with Field/Input/Select.
Keep logic.
- [ ] **Step 3: Lot gate + commit**

```bash
pnpm --filter @pulsar/web typecheck && pnpm --filter @pulsar/web build
git add apps/web/src
git commit -m "feat(web): driver mobile + customer portal on new design system"
```

---

## Lot 6 — Plateforme (Task 25)

### Task 25: Platform login + tenants

**Files:**
- Modify: `apps/web/src/routes/platform/login/+page.svelte`
- Modify: `apps/web/src/routes/platform/tenants/+page.svelte`

- [ ] **Step 1:** Login on PublicShell + a distinctive `Badge tone="danger"` chip
« Platform admin » under the brand (visual disambiguation per spec). Keep MFA flow
logic (TOTP step, recovery codes) — only restyle. Tenants page: list recipe
(Name, Slug, Status, Created, actions suspend/restore in row buttons) + create form
in Modal. A thin `bg-danger` top border line on the page container marks platform
context.
- [ ] **Step 2: Verify + commit** (`feat(web): platform pages on new design system, distinct visual identity`)

---

## Lot 7 — Cleanup + final gates (Tasks 26–28)

### Task 26: Remove legacy CSS + dead components

- [ ] **Step 1:** Grep for remaining legacy classes:

```bash
grep -rn "class=\"card\|class=\"btn\|page-header\|error-text\|muted" apps/web/src --include="*.svelte"
```

Expected: zero hits (every page migrated). Fix any stragglers with design-system
equivalents.
- [ ] **Step 2:** Delete `apps/web/src/lib/styles/legacy.css` and its `@import` in
`app.css`. Delete `StatusBadge.svelte` if no longer imported anywhere
(`grep -rn "StatusBadge" apps/web/src`); keep `Toasts.svelte` (restyled in place
during the lots — verify it uses tokens, restyle now if not).
- [ ] **Step 3:**

```bash
pnpm --filter @pulsar/web typecheck && pnpm --filter @pulsar/web build
git add apps/web/src && git commit -m "chore(web): drop legacy css + dead components"
```

### Task 27: Full verification

- [ ] **Step 1:**

```bash
pnpm typecheck
pnpm build
pnpm test
```

Expected: all PASS (unit tests untouched by design).
- [ ] **Step 2:** e2e (needs DB up + seeded):

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm test:e2e
```

Expected: PASS — the suites hit the API only; any failure here means an accidental
API-side change: `git diff main -- apps/api packages` MUST be empty.
- [ ] **Step 3: Constraint audit:**

```bash
git diff main --stat -- apps/api packages
```

Expected output: empty.

### Task 28: Docs + PR

- [ ] **Step 1:** Update `docs/etat-du-projet.md`: phase 9 row in the table (refonte UI
livrée — design system, sidebar repliable, ⌘K, densité commutable, LoadMap, pages
publiques + plateforme) + « Prochaine session » → phase 10 (OSRM + carte live +
décision coordonnées publiques). Update the « Chiffres » line (pages refondues).
- [ ] **Step 2:** Commit + push + PR:

```bash
git add docs
git commit -m "docs: phase 9 shipped - refonte UI complete"
git push -u origin phase-9
```

PR title: `Phase 9 — Refonte UI (design system, console hybride)`. Body: summary of
the 7 lots, the map scope note (internal only, public deferred to phase 10), the
constraint audit result (no API/packages diff), and the manual test checklist.
End body with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## Self-review notes (done at plan-writing time)

- **Spec coverage:** direction/nav/densité/⌘K/carte/public/platform/tokens → Tasks 1–25;
  contrainte API → Task 27 audit; dark-mode-ready → tokens only (Task 1), no theme.
  Spec's « carte suivi public » was corrected in the spec itself (no public coords) —
  Task 23 explicitly has NO map.
- **Type consistency:** `toneFor`/`labelFor` (Task 2) used in Tasks 10/13/18/23;
  `Panel` gets `onclose` prop added in Task 10 — implementers of later tasks must use
  the post-Task-10 Panel API.
- **Risk:** Svelte 5 snippet syntax in Table/Panel/Modal is the most error-prone part;
  the code given compiles against Svelte 5.28 idioms (`$props()`, `$bindable`,
  `{@render}`, `{#snippet}`).
