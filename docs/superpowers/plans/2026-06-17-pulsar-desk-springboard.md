# Pulsar Desk Springboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/apps` into a customizable iOS-springboard launcher (module icons, quick-links, folders with open animation, drag/edit mode, right-click), persisted per-user in the backend, with a single search living in the top bar.

**Architecture:** Bottom-up. Pure layout model + builders in `@pulsar/shared` (unit-tested) → `UserPreferences` Prisma model + `me/preferences` API → web `/apps` rebuilt as a springboard that loads/saves the layout and reconciles it against the user's visible modules. Only the desk (`/apps` grid + the deskMode top bar) changes.

**Tech Stack:** NestJS (API), Prisma/Postgres, SvelteKit SPA (Svelte 5 runes, `ssr=false`), Tailwind, `lucide-svelte`, native pointer-based drag (no DnD library), Vitest for shared unit tests.

**Spec:** `docs/superpowers/specs/2026-06-17-pulsar-desk-springboard-design.md`

**Branch:** continue on `ux-polish-pass`.

**Verification reality:**
- `packages/shared` HAS a unit runner — `pnpm test` (Vitest). Task 1 is full TDD.
- `apps/web` has NO component runner — verify with `pnpm --filter @pulsar/web typecheck` (0 errors/0 warnings) + manual.
- `apps/api` e2e (`pnpm --filter @pulsar/api test:e2e`) needs a seeded DB; a tiny e2e is optional — minimum bar is `pnpm --filter @pulsar/api build`/typecheck + the unit tests staying green.

---

## File Structure

**Created**
- `packages/shared/src/desk/desk-layout.ts` — `DeskItem`/`DeskFolderChild`/`DeskLayout` types + `defaultDeskLayout()` + `reconcileDeskLayout()` (pure, browser-safe).
- `packages/shared/src/desk/desk-layout.spec.ts` — unit tests.
- `apps/api/src/core/preferences/preferences.controller.ts` — `GET`/`PUT /me/preferences`.
- `apps/api/src/core/preferences/preferences.service.ts` — upsert/read by `userId`.
- `apps/api/src/core/preferences/preferences.module.ts` — Nest module.
- `apps/api/src/core/preferences/dto/desk-layout.dto.ts` — class-validator DTO for the layout.
- `apps/web/src/lib/stores/desk.ts` — `deskSearch` store + small helpers.
- `apps/web/src/lib/api/preferences.ts` — typed `getPreferences()`/`putDeskLayout()` client.
- `apps/web/src/lib/components/desk/DeskIcon.svelte` — a single module/link tile.
- `apps/web/src/lib/components/desk/DeskFolderTile.svelte` — folder tile (4 mini-previews).
- `apps/web/src/lib/components/desk/FolderOverlay.svelte` — animated open folder panel.
- `apps/web/src/lib/components/desk/AddLinkPicker.svelte` — quick-link page picker.
- `apps/web/src/lib/components/desk/DeskContextMenu.svelte` — right-click menu.

**Modified**
- `packages/shared/src/index.ts` — `export * from './desk/desk-layout'`.
- `packages/database/prisma/schema.prisma` — `UserPreferences` model + `User.preferences` relation.
- `apps/api/src/app.module.ts` — register `PreferencesModule`.
- `apps/web/src/routes/(app)/apps/+page.svelte` — full springboard rebuild.
- `apps/web/src/routes/(app)/+layout.svelte` — deskMode top bar: search button → live input (only on `/apps`).

---

## Phase 1 — Shared layout model (TDD)

### Task 1: `desk-layout.ts` types + builders

**Files:**
- Create: `packages/shared/src/desk/desk-layout.ts`
- Test: `packages/shared/src/desk/desk-layout.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/desk/desk-layout.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  defaultDeskLayout,
  reconcileDeskLayout,
  DESK_LAYOUT_VERSION,
  type DeskLayout,
} from './desk-layout';

const domains = [{ key: 'transport' }, { key: 'wms' }, { key: 'agents' }];

describe('defaultDeskLayout', () => {
  it('creates one module item per domain plus a framework folder', () => {
    const layout = defaultDeskLayout(domains);
    expect(layout.version).toBe(DESK_LAYOUT_VERSION);
    const modules = layout.items.filter((i) => i.type === 'module');
    expect(modules.map((m) => (m as any).moduleKey)).toEqual(['transport', 'wms', 'agents']);
    const folder = layout.items.find((i) => i.type === 'folder' && (i as any).id === 'framework');
    expect(folder).toBeTruthy();
  });
});

describe('reconcileDeskLayout', () => {
  it('falls back to default when saved is invalid', () => {
    expect(reconcileDeskLayout(null, domains)).toEqual(defaultDeskLayout(domains));
    expect(reconcileDeskLayout({ junk: true }, domains)).toEqual(defaultDeskLayout(domains));
  });

  it('removes module items whose module is no longer visible', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [
        { type: 'module', moduleKey: 'transport' },
        { type: 'module', moduleKey: 'billing' }, // not in domains anymore
      ],
    };
    const out = reconcileDeskLayout(saved, domains);
    const keys = out.items.filter((i) => i.type === 'module').map((i) => (i as any).moduleKey);
    expect(keys).toContain('transport');
    expect(keys).not.toContain('billing');
  });

  it('removes non-visible modules nested inside folders too', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [
        {
          type: 'folder',
          id: 'f1',
          name: 'Ops',
          items: [
            { type: 'module', moduleKey: 'transport' },
            { type: 'module', moduleKey: 'billing' },
          ],
        },
      ],
    };
    const out = reconcileDeskLayout(saved, domains);
    const folder = out.items.find((i) => i.type === 'folder') as any;
    const keys = folder.items.filter((i: any) => i.type === 'module').map((i: any) => i.moduleKey);
    expect(keys).toEqual(['transport']);
  });

  it('appends modules that are newly visible and not already placed (top-level or in a folder)', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [{ type: 'folder', id: 'f1', name: 'Ops', items: [{ type: 'module', moduleKey: 'transport' }] }],
    };
    const out = reconcileDeskLayout(saved, domains);
    const topKeys = out.items.filter((i) => i.type === 'module').map((i) => (i as any).moduleKey);
    // transport already lives in the folder → not duplicated at top level
    expect(topKeys).not.toContain('transport');
    // wms and agents are new → appended at top level
    expect(topKeys).toContain('wms');
    expect(topKeys).toContain('agents');
  });

  it('keeps link items as-is and dedups folder ids', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [
        { type: 'link', href: '/loads', label: 'Loads' },
        { type: 'folder', id: 'dup', name: 'A', items: [] },
        { type: 'folder', id: 'dup', name: 'B', items: [] },
      ],
    };
    const out = reconcileDeskLayout(saved, domains);
    expect(out.items.some((i) => i.type === 'link' && (i as any).href === '/loads')).toBe(true);
    const folderIds = out.items.filter((i) => i.type === 'folder').map((i) => (i as any).id);
    expect(new Set(folderIds).size).toBe(folderIds.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pulsar/shared test -- desk-layout`
Expected: FAIL — module `./desk-layout` not found.

- [ ] **Step 3: Implement `desk-layout.ts`**

```ts
// packages/shared/src/desk/desk-layout.ts
export const DESK_LAYOUT_VERSION = 1;

export type DeskFolderChild =
  | { type: 'module'; moduleKey: string }
  | { type: 'link'; href: string; label: string; icon?: string };

export type DeskItem =
  | { type: 'module'; moduleKey: string }
  | { type: 'link'; href: string; label: string; icon?: string }
  | { type: 'folder'; id: string; name: string; items: DeskFolderChild[] };

export interface DeskLayout {
  version: number;
  items: DeskItem[];
}

/** System shortcuts living in the default Framework folder. */
export const FRAMEWORK_LINKS: DeskFolderChild[] = [
  { type: 'link', href: '/settings/users', label: 'Réglages' },
  { type: 'link', href: '/settings/modules', label: 'Modules' },
  { type: 'link', href: '/settings/users', label: 'Utilisateurs' },
  { type: 'link', href: '/settings/agent-runtime', label: 'Automation' },
];

export const FRAMEWORK_FOLDER_ID = 'framework';

export function defaultDeskLayout(domains: { key: string }[]): DeskLayout {
  const moduleItems: DeskItem[] = domains
    .filter((d) => d.key !== 'dashboard')
    .map((d) => ({ type: 'module', moduleKey: d.key }));
  return {
    version: DESK_LAYOUT_VERSION,
    items: [
      ...moduleItems,
      { type: 'folder', id: FRAMEWORK_FOLDER_ID, name: 'Framework', items: [...FRAMEWORK_LINKS] },
    ],
  };
}

function isChild(x: unknown): x is DeskFolderChild {
  if (!x || typeof x !== 'object') return false;
  const t = (x as any).type;
  if (t === 'module') return typeof (x as any).moduleKey === 'string';
  if (t === 'link') return typeof (x as any).href === 'string' && typeof (x as any).label === 'string';
  return false;
}

function isItem(x: unknown): x is DeskItem {
  if (isChild(x)) return true;
  if (!x || typeof x !== 'object') return false;
  if ((x as any).type !== 'folder') return false;
  return typeof (x as any).id === 'string' && typeof (x as any).name === 'string' && Array.isArray((x as any).items);
}

/**
 * Returns a valid DeskLayout for the user:
 * - invalid input → default
 * - drops module items (top-level and in folders) whose key is not in `domains` (SECURITY)
 * - appends newly-visible modules not already placed anywhere
 * - keeps links, dedups folder ids
 */
export function reconcileDeskLayout(saved: unknown, domains: { key: string }[]): DeskLayout {
  const visible = new Set(domains.filter((d) => d.key !== 'dashboard').map((d) => d.key));
  const s = saved as DeskLayout | null | undefined;
  if (!s || typeof s !== 'object' || !Array.isArray(s.items)) {
    return defaultDeskLayout(domains);
  }

  const placed = new Set<string>();
  const seenFolderIds = new Set<string>();

  const cleanChildren = (children: unknown[]): DeskFolderChild[] =>
    children.filter(isChild).filter((c) => {
      if (c.type === 'module') {
        if (!visible.has(c.moduleKey)) return false;
        placed.add(c.moduleKey);
      }
      return true;
    });

  const items: DeskItem[] = [];
  for (const raw of s.items) {
    if (!isItem(raw)) continue;
    if (raw.type === 'module') {
      if (!visible.has(raw.moduleKey)) continue;
      placed.add(raw.moduleKey);
      items.push(raw);
    } else if (raw.type === 'link') {
      items.push(raw);
    } else {
      let id = raw.id;
      while (seenFolderIds.has(id)) id = `${id}-${Math.round((items.length + 1) * 7)}`;
      seenFolderIds.add(id);
      items.push({ type: 'folder', id, name: raw.name, items: cleanChildren(raw.items) });
    }
  }

  // append newly-visible modules not placed anywhere
  for (const d of domains) {
    if (d.key === 'dashboard') continue;
    if (!placed.has(d.key)) {
      items.push({ type: 'module', moduleKey: d.key });
      placed.add(d.key);
    }
  }

  return { version: DESK_LAYOUT_VERSION, items };
}
```

(Note: `reconcileDeskLayout` avoids `Math.random()`/`Date.now()` for id dedup so output is deterministic and the spec's `toEqual(defaultDeskLayout(...))` holds.)

- [ ] **Step 4: Export from the shared index**

In `packages/shared/src/index.ts` add (after the other exports):

```ts
export * from './desk/desk-layout';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @pulsar/shared test -- desk-layout`
Expected: PASS (all cases).

- [ ] **Step 6: Rebuild shared (the API/web consume its dist)**

Run: `pnpm --filter @pulsar/shared build`
Expected: success, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/desk packages/shared/src/index.ts
git commit -m "feat(shared): desk layout model + default/reconcile builders (tested)"
```

---

## Phase 2 — Backend

### Task 2: `UserPreferences` Prisma model + migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add the model + relation**

In `schema.prisma`, add the relation field to the `User` model (inside the existing `User` block, with the other relations):

```prisma
  preferences  UserPreferences?
```

Then add the model near the other core models:

```prisma
model UserPreferences {
  id         String   @id @default(cuid())
  userId     String   @unique
  deskLayout Json     @default("{}")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}
```

- [ ] **Step 2: Migrate + regenerate + rebuild database package**

Run (from repo root, DB must be up — `pnpm db:up`):
```bash
pnpm db:migrate
```
When prompted for a name, use: `user_preferences`.
Then: `pnpm --filter @pulsar/database build`
Expected: migration applied, Prisma client regenerated, `@prisma/client` knows `userPreferences`.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): UserPreferences model (per-user deskLayout)"
```

### Task 3: `me/preferences` endpoints

**Files:**
- Create: `apps/api/src/core/preferences/preferences.service.ts`
- Create: `apps/api/src/core/preferences/preferences.controller.ts`
- Create: `apps/api/src/core/preferences/preferences.module.ts`
- Create: `apps/api/src/core/preferences/dto/desk-layout.dto.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: DTO (validates layout shape, not business hrefs)**

```ts
// apps/api/src/core/preferences/dto/desk-layout.dto.ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/** The deskLayout is a structured JSON object. We validate the envelope; the
 * web only ever sends catalogue-derived items and the read path re-reconciles,
 * so we keep item validation shallow (objects with a string `type`). */
export class DeskLayoutDto {
  @IsInt()
  version!: number;

  @IsArray()
  items!: Record<string, unknown>[];
}

export class UpdatePreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeskLayoutDto)
  deskLayout?: DeskLayoutDto;
}
```

- [ ] **Step 2: Service (read/upsert by userId)**

Mirror how an existing core service injects `PrismaService` (see e.g. `apps/api/src/core/audit-logs/audit-logs.service.ts` or another core service — import path is the same).

```ts
// apps/api/src/core/preferences/preferences.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<{ deskLayout: unknown }> {
    const row = await this.prisma.userPreferences.findUnique({ where: { userId } });
    return { deskLayout: row?.deskLayout ?? {} };
  }

  async update(userId: string, deskLayout: unknown): Promise<{ deskLayout: unknown }> {
    const row = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, deskLayout: deskLayout as object },
      update: { deskLayout: deskLayout as object },
    });
    return { deskLayout: row.deskLayout };
  }
}
```

(Confirm the real `PrismaService` import path by opening an existing core service; adjust if different.)

- [ ] **Step 3: Controller (self-service, JWT only, no RBAC permission)**

```ts
// apps/api/src/core/preferences/preferences.controller.ts
import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdatePreferencesDto } from './dto/desk-layout.dto';
import { PreferencesService } from './preferences.service';

@ApiTags('preferences')
@ApiBearerAuth()
@Controller('me/preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.preferences.get(user.id);
  }

  @Put()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return this.preferences.update(user.id, dto.deskLayout ?? {});
  }
}
```

(No `@Public()` → the global JWT guard protects it. No `@RequirePermissions` — self-service. `user.id` comes from the JWT, never the body → tenant isolation preserved.)

- [ ] **Step 4: Module + registration**

```ts
// apps/api/src/core/preferences/preferences.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [PrismaModule],
  controllers: [PreferencesController],
  providers: [PreferencesService],
})
export class PreferencesModule {}
```

(Confirm `PrismaModule` import path against an existing core module; if Prisma is global, drop the import.) Then add `PreferencesModule` to the `imports` array in `apps/api/src/app.module.ts`.

- [ ] **Step 5: Build/typecheck the API**

Run: `pnpm --filter @pulsar/api build`
Expected: compiles, no TS errors. (If a quick e2e is trivial to add following an existing `*.e2e-spec.ts`, assert `GET /api/v1/me/preferences` returns `{ deskLayout }` and `PUT` round-trips — optional; do not block on the seeded-DB harness.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/preferences apps/api/src/app.module.ts
git commit -m "feat(api): self-service GET/PUT /me/preferences (desk layout)"
```

---

## Phase 3 — Web springboard

### Task 4: Data plumbing + read-only springboard render

**Files:**
- Create: `apps/web/src/lib/api/preferences.ts`
- Create: `apps/web/src/lib/stores/desk.ts`
- Create: `apps/web/src/lib/components/desk/DeskIcon.svelte`
- Create: `apps/web/src/lib/components/desk/DeskFolderTile.svelte`
- Create: `apps/web/src/lib/components/desk/FolderOverlay.svelte`
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`

- [ ] **Step 1: API client**

```ts
// apps/web/src/lib/api/preferences.ts
import { api } from '$lib/api/client';
import type { DeskLayout } from '@pulsar/shared';

export function getPreferences() {
  return api<{ deskLayout: unknown }>('/me/preferences');
}

export function putDeskLayout(deskLayout: DeskLayout) {
  return api<{ deskLayout: unknown }>('/me/preferences', {
    method: 'PUT',
    body: { deskLayout },
  });
}
```

(Match the real `api()` signature/options shape used elsewhere — check `$lib/api/client`.)

- [ ] **Step 2: Desk search store**

```ts
// apps/web/src/lib/stores/desk.ts
import { writable } from 'svelte/store';

/** Live search text driven by the desk top bar; consumed by /apps. */
export const deskSearch = writable('');
```

- [ ] **Step 3: `DeskIcon.svelte` (module or link tile)**

```svelte
<!-- apps/web/src/lib/components/desk/DeskIcon.svelte -->
<script lang="ts">
  import type { ComponentType } from 'svelte';
  let {
    label,
    icon,
    accent = '#6f7480',
    href = undefined as string | undefined,
    editing = false,
    onactivate = undefined as (() => void) | undefined,
    onremove = undefined as (() => void) | undefined,
  } = $props<{
    label: string;
    icon: ComponentType;
    accent?: string;
    href?: string;
    editing?: boolean;
    onactivate?: () => void;
    onremove?: () => void;
  }>();
  const Icon = icon;
</script>

<button
  type="button"
  class="group relative flex w-24 flex-col items-center text-center outline-none {editing ? 'animate-[wiggle_0.3s_ease-in-out_infinite] motion-reduce:animate-none' : ''}"
  onclick={() => onactivate?.()}
  aria-label={label}
>
  {#if editing && onremove}
    <span
      role="button"
      tabindex="0"
      class="absolute -top-1 left-5 z-10 grid size-5 place-items-center rounded-full bg-ink text-xs text-white shadow"
      onclick={(e) => { e.stopPropagation(); onremove?.(); }}
      onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onremove?.(); } }}
      aria-label={`Retirer ${label}`}>×</span
    >
  {/if}
  <span
    class="grid size-14 place-items-center rounded-2xl text-white shadow-sm ring-1 ring-black/5 transition duration-150 group-hover:-translate-y-1 group-hover:shadow-md"
    style={`background: ${accent}`}
  >
    <Icon class="size-7" strokeWidth={2.15} />
  </span>
  <span class="mt-3 line-clamp-2 text-sm font-semibold leading-tight text-ink group-hover:text-accent">{label}</span>
</button>
```

Add the `wiggle` keyframes once in the global stylesheet (`apps/web/src/app.css` or the existing global css — find it): `@keyframes wiggle { 0%,100%{transform:rotate(-1.2deg)} 50%{transform:rotate(1.2deg)} }`.

- [ ] **Step 4: `DeskFolderTile.svelte` (folder preview)**

```svelte
<!-- apps/web/src/lib/components/desk/DeskFolderTile.svelte -->
<script lang="ts">
  let { name, count = 0, editing = false, onopen, onremove = undefined } =
    $props<{ name: string; count?: number; editing?: boolean; onopen: () => void; onremove?: () => void }>();
</script>

<button type="button" class="group relative flex w-24 flex-col items-center text-center outline-none {editing ? 'animate-[wiggle_0.3s_ease-in-out_infinite] motion-reduce:animate-none' : ''}" onclick={() => onopen()} aria-label={`Ouvrir le dossier ${name}`}>
  {#if editing && onremove}
    <span role="button" tabindex="0" class="absolute -top-1 left-5 z-10 grid size-5 place-items-center rounded-full bg-ink text-xs text-white shadow" onclick={(e) => { e.stopPropagation(); onremove?.(); }} onkeydown={(e) => { if (e.key === 'Enter') onremove?.(); }} aria-label={`Retirer ${name}`}>×</span>
  {/if}
  <span class="grid size-14 place-items-center rounded-2xl bg-[#737985]/15 p-2 ring-1 ring-black/5 transition duration-150 group-hover:-translate-y-1">
    <span class="grid size-full grid-cols-2 grid-rows-2 gap-1">
      {#each Array(4) as _, i (i)}<span class="rounded-md bg-[#737985]/50"></span>{/each}
    </span>
  </span>
  <span class="mt-3 line-clamp-2 text-sm font-semibold leading-tight text-ink group-hover:text-accent">{name}</span>
</button>
```

- [ ] **Step 5: `FolderOverlay.svelte` (animated open)**

```svelte
<!-- apps/web/src/lib/components/desk/FolderOverlay.svelte -->
<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { pushOverlay, popOverlay, isTopOverlay } from '$lib/stores/overlay-stack';
  let { open = $bindable(false), name = '', onclose = undefined as (() => void) | undefined, children, footer = undefined } = $props();
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dur = reduce ? 0 : 220;
  let token = $state<symbol | null>(null);
  function close() { open = false; onclose?.(); }
  $effect(() => { if (open) { const t = pushOverlay(); token = t; return () => { popOverlay(t); token = null; }; } });
  function onkeydown(e: KeyboardEvent) { if (open && token && isTopOverlay(token) && e.key === 'Escape') close(); }
</script>
<svelte:window {onkeydown} />
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-md" onclick={(e) => { if (e.target === e.currentTarget) close(); }} role="presentation" transition:fade={{ duration: dur }}>
    <div class="w-[min(560px,calc(100vw-2rem))] rounded-[30px] border border-edge bg-white/95 p-6 shadow-pop" role="dialog" aria-modal="true" aria-label={name} transition:scale={{ duration: dur, start: 0.4, easing: cubicOut }}>
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-base font-semibold text-ink">{name}</h2>
        <button class="rounded-full bg-surface-muted px-2 py-1 text-xs font-semibold text-ink-muted hover:text-ink" onclick={close}>Fermer</button>
      </div>
      <div class="grid grid-cols-3 justify-items-center gap-x-6 gap-y-8 sm:grid-cols-4">{@render children()}</div>
      {#if footer}<div class="mt-5 border-t border-edge pt-4">{@render footer()}</div>{/if}
    </div>
  </div>
{/if}
```

- [ ] **Step 6: Rebuild `/apps` as a read-only springboard**

Rewrite `apps/web/src/routes/(app)/apps/+page.svelte` to: build `domains = visibleDomains(caps)` (as today); `onMount`/`$effect` load `getPreferences()`, then `layout = reconcileDeskLayout(res.deskLayout, domains)` (fallback to `defaultDeskLayout(domains)` on error). Render `layout.items`:
- `module` → `DeskIcon` using the domain's `MODULE_UNIVERSES[moduleKey]` accent + the domain's `icon` (look the domain up by key from `domains`); `onactivate = () => goto(domainHome)`.
- `link` → `DeskIcon` (neutral accent or a generic icon) `onactivate = () => goto(href)`.
- `folder` → `DeskFolderTile` with `onopen` setting `openFolderId = folder.id`; render one `FolderOverlay` bound to the open folder, listing its children as `DeskIcon`s.
- **Remove the page's own search `<input>`** (the block currently around lines 61–80). Filter `layout.items` by `deskSearch` store value (a folder matches if its name or any child label matches). Import `deskSearch` from `$lib/stores/desk` and read `$deskSearch`.
- Keep the existing page chrome/title and the `min-h`/background.

Persisting is added in later tasks; this task is read + render + folder open animation + search-from-store, no editing yet.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @pulsar/web typecheck` → 0 errors, 0 warnings.
Manual: `/apps` shows one icon per module + a Framework folder; clicking a module navigates to its home; opening a folder plays the zoom/blur animation; the page no longer has its own search input.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/api/preferences.ts apps/web/src/lib/stores/desk.ts apps/web/src/lib/components/desk "apps/web/src/routes/(app)/apps/+page.svelte"
git commit -m "feat(web): desk renders springboard from saved layout (read-only) + animated folders"
```

### Task 5: Top-bar search (single search)

**Files:**
- Modify: `apps/web/src/routes/(app)/+layout.svelte`

- [ ] **Step 1: Replace the deskMode Search button with a live input on `/apps`**

In the `{#if deskMode}` header (around lines 186–196), replace the `<button ... aria-label="Rechercher (Ctrl+K)">` with: when `page.url.pathname === '/apps'`, render an `<input>` bound to the `deskSearch` store (`import { deskSearch } from '$lib/stores/desk'`); otherwise keep the existing Ctrl+K button (so `/framework` etc. still work). Example:

```svelte
{#if page.url.pathname === '/apps'}
  <div class="mx-auto flex h-9 w-full max-w-sm items-center gap-2 rounded-lg bg-surface-muted px-3 ring-1 ring-edge-soft focus-within:ring-accent">
    <Search class="size-4 shrink-0 text-ink-faint" />
    <input class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint" placeholder="Rechercher une app…" bind:value={$deskSearch} aria-label="Rechercher une app" />
  </div>
{:else}
  <!-- existing Ctrl+K button unchanged -->
{/if}
```

Keep the global Ctrl+K palette handler intact (do not remove the keyboard shortcut).

- [ ] **Step 2: Verify**

Run: `pnpm --filter @pulsar/web typecheck` → 0/0.
Manual: on `/apps`, typing in the TOP bar filters the springboard; there is no second search box; Ctrl+K still opens the palette.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/routes/(app)/+layout.svelte"
git commit -m "feat(web): single desk search lives in the top bar (filters springboard)"
```

### Task 6: Edit mode — jiggle, drag-reorder, create folder, remove

**Files:**
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`
- Create: `apps/web/src/lib/actions/dnd.ts` (tiny pointer-based drag helper)

- [ ] **Step 1: Pointer-drag action**

Create a minimal Svelte action for pointer-based dragging that reports drag-start, drag-over-target index, and drop. Keep it small (no library). Interface:

```ts
// apps/web/src/lib/actions/dnd.ts
export interface DragHandlers {
  onpick: (index: number) => void;
  onhover: (index: number) => void;
  ondrop: () => void;
}
/** use:gridDrag={{ index, handlers, enabled }} — pointerdown starts a drag after a small
 * threshold; pointermove finds the tile under the pointer and calls onhover with its index;
 * pointerup calls ondrop. Tiles are matched via a shared [data-desk-index] attribute. */
export function gridDrag(node: HTMLElement, params: { index: number; handlers: DragHandlers; enabled: boolean }) {
  // implement with pointer events + document.elementFromPoint, reading data-desk-index
  // return { update(p){...}, destroy(){...} }
}
```

Implement it concretely (pointerdown→threshold→pointermove tracking `document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-desk-index]')`→pointerup). Set `touch-action: none` on draggable tiles while editing.

- [ ] **Step 2: Wire edit mode in `/apps`**

Add `let editing = $state(false)` and a "Personnaliser"/"OK" button in the page header. When editing: tiles wiggle (pass `editing` to `DeskIcon`/`DeskFolderTile`), each tile wrapper gets `data-desk-index={i}` and `use:gridDrag={{ index:i, handlers, enabled: editing }}`. Implement handlers that mutate `layout.items`:
- reorder: move dragged index to hovered index.
- **create folder**: if a tile is dropped directly onto another tile (hover target held > a beat, or dropped while hovering a different index with a modifier — simplest: dropping a module/link onto another module/link merges them into a new `folder` with `id` = a deterministic new id like `folder-${Date.now in args}`… since `Date.now` is fine in the browser here, use `crypto.randomUUID()`), containing both children; replace the two items with the folder.
- remove (`onremove`): drop the item from `layout.items` (or from a folder's children).
Editing mutations call a shared `persist()` (Task 8 wires the debounce; for now `persist()` can be a no-op stub to be filled in Task 8, OR implement the debounce now — see Task 8).

- [ ] **Step 3: Verify**

Run: `pnpm --filter @pulsar/web typecheck` → 0/0.
Manual: "Personnaliser" makes icons wiggle; drag reorders; dropping one icon on another creates a folder containing both; (×) removes an icon; "OK" exits edit mode.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/apps/+page.svelte" apps/web/src/lib/actions/dnd.ts
git commit -m "feat(web): desk edit mode — jiggle, drag-reorder, drop-to-folder, remove"
```

### Task 7: Quick-link picker + rename + right-click menu

**Files:**
- Create: `apps/web/src/lib/components/desk/AddLinkPicker.svelte`
- Create: `apps/web/src/lib/components/desk/DeskContextMenu.svelte`
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`

- [ ] **Step 1: `AddLinkPicker.svelte`**

A `Modal` (reuse `$lib/components/ui` Modal) listing every page from `visibleDomains(caps)` flattened to `{ href, label, domainLabel }`, with a search field; selecting one calls `onpick({ href, label })`. Props: `open` (bindable), `domains`, `onpick`.

- [ ] **Step 2: `DeskContextMenu.svelte`**

A small absolutely-positioned menu (reuse the overlay-stack for Esc/outside-click close) rendering action buttons passed in via a `actions: { label: string; run: () => void }[]` prop at `{ x, y }`. Closes on select/outside/Esc.

- [ ] **Step 3: Wire into `/apps`**

- Add an "Ajouter un lien" affordance (a `+` tile shown in edit mode, and a context-menu action) that opens `AddLinkPicker`; on pick, push a `{ type:'link', href, label }` into `layout.items` and `persist()`.
- Rename: for folders and links, an inline editable name (double-click in edit mode, or a context-menu "Renommer" that swaps the label to an `<input>`); commit on blur/Enter → `persist()`.
- Right-click: on a tile, `oncontextmenu={(e)=>{ e.preventDefault(); open DeskContextMenu at e.clientX/clientY with actions: Renommer, Retirer, Nouveau dossier, Ajouter un lien rapide }}`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @pulsar/web typecheck` → 0/0.
Manual: `+` opens the page picker and adds a quick-link icon; renaming a folder/link works; right-click shows the menu with all four actions; each persists.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/desk "apps/web/src/routes/(app)/apps/+page.svelte"
git commit -m "feat(web): desk quick-link picker, rename, right-click context menu"
```

### Task 8: Persistence (debounced PUT) + Framework hub + polish

**Files:**
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`

- [ ] **Step 1: Debounced persistence**

Implement `persist()`: it serializes the current `layout` and PUTs it via `putDeskLayout(layout)`, debounced ~500 ms (clear a `setTimeout` and reset it on each call). On error → a discreet `toast.error` (non-blocking), keep the in-memory layout. Call `persist()` after every mutation (reorder, folder create, remove, add-link, rename). Guard against persisting before the initial load completes (a `loaded` flag).

- [ ] **Step 2: Framework hub content**

In the Framework folder's `FolderOverlay`, in addition to its system-shortcut children, render a footer section with two actions:
- "Réinitialiser la disposition" → `layout = defaultDeskLayout(domains); persist();` (with a `confirm()`).
- "Gérer les liens rapides" → sets `editing = true` and closes the overlay.

The Framework folder is just the layout item with `id === 'framework'`; do not special-case its position (it can be moved/renamed like any folder). Detect it by id only to attach the footer.

- [ ] **Step 3: Reduced-motion + final polish**

Confirm wiggle animation has `motion-reduce:animate-none`; the FolderOverlay already zeroes duration under reduced motion. Ensure dragging is disabled when not editing, and that clicking a module while NOT editing navigates (no accidental drag). Ensure search (`$deskSearch`) and edit mode coexist sensibly (hide `+`/drag while a search filter is active, or simply clear search on entering edit mode — pick one and keep it simple).

- [ ] **Step 4: Verify**

Run: `pnpm --filter @pulsar/web typecheck` → 0/0. Then `pnpm --filter @pulsar/web build` → OK.
Manual end-to-end: rearrange + create folder + add quick-link + rename → reload the page → layout persisted (came back from backend); "Réinitialiser" restores defaults; reduced-motion disables animations.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(app)/apps/+page.svelte"
git commit -m "feat(web): persist desk layout (debounced) + Framework hub + reduced-motion polish"
```

---

## Final verification

- [ ] `pnpm test` — shared unit tests pass (incl. `desk-layout.spec.ts`); confirm no NEW failures vs the pre-existing 4 API suites broken by PR #33 (those are unrelated/inherited).
- [ ] `pnpm typecheck` (all workspaces) → 0 errors.
- [ ] `pnpm --filter @pulsar/web build` → clean.
- [ ] Manual: springboard shows modules (not every page); single top-bar search filters it; create/open animated folders; drag-rearrange; add quick-link; rename; right-click menu; reload persists via backend; a tenant-disabled module disappears from the desk on next load (reconcile security).

---

## Self-review notes

- **Spec coverage:** Backend model+endpoints → Tasks 2,3. Shared model/builders → Task 1. Springboard render + folders animation → Task 4. Single top-bar search → Task 5. Edit/jiggle/drag/folder/remove → Task 6. Quick-link/rename/right-click → Task 7. Persistence + Framework hub + reduced-motion → Task 8. All spec sections covered.
- **Types consistency:** `DeskItem`/`DeskFolderChild`/`DeskLayout`/`DESK_LAYOUT_VERSION`/`FRAMEWORK_FOLDER_ID` defined in Task 1 and reused in Tasks 4/6/7/8. `defaultDeskLayout`/`reconcileDeskLayout` signatures `( … , domains: {key}[] )` consistent across web usage. `deskSearch` store defined in Task 4, consumed in Tasks 4/5.
- **Security:** `reconcileDeskLayout` strips non-visible modules (Task 1 tested); the web always reconciles against `visibleDomains(caps)` on load (Task 4).
- **Determinism:** `reconcileDeskLayout` id-dedup avoids `Math.random`/`Date.now` so the unit test `toEqual(default…)` holds; runtime folder creation in the browser may use `crypto.randomUUID()` (Task 6) — that's web-only, not in the pure shared fn.
- **No test runner for web:** verification is typecheck + manual, consistent across web tasks; shared layer is real TDD.
- **Open risk flagged in plan:** pointer DnD is the fiddliest piece (Task 6) — kept library-free per YAGNI; acceptable to iterate.
