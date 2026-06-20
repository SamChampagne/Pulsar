# Module Configuration Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn hardcoded/ambiguous per-tenant behaviors into declarative, per-module configurable settings via a generic framework.

**Architecture:** A pure-data settings catalog + pure `resolveSettings`/`validateSettings` in `@pulsar/shared`; a `ModuleSettingsService` that reads/writes the existing `TenantModule.settings` JSON (no migration) with a short-TTL cache; two endpoints on the module-registry controller; one generic Svelte panel on a single route; then each business service reads its knob at the point of application with a safe default.

**Tech Stack:** NestJS + Prisma (`@pulsar/database`), SvelteKit (Svelte 5 runes), Vitest (shared), Jest + supertest (api e2e).

## Global Constraints

- Apps import Prisma via `@pulsar/database`, never `@prisma/client`. (verbatim from CLAUDE.md rule 4)
- Every tenant-scoped query MUST filter by `tenantId` from the JWT (`@CurrentUser()`), never the body. (rule 1)
- Sensitive mutations call `AuditLogsService.log()` or carry `@Audit`. (rule 6)
- Catalog + resolvers live in `@pulsar/shared` and MUST be pure / browser-safe (no Node imports). (mirrors RUNTIME_PROVIDERS)
- After changing `packages/shared`, rebuild it (`pnpm --filter @pulsar/shared build`) — the API consumes its `dist/`. (rule 7)
- Defaults in the catalog MUST equal current behavior, so an unconfigured tenant sees no change.
- New permission keys are NOT required: read uses `core.modules.read`, write uses `core.modules.manage`.
- No database migration in this plan (`portalLinkTtlDays` deferred to v1.1).

---

### Task 1: Settings catalog + pure resolvers (`@pulsar/shared`)

**Files:**
- Create: `packages/shared/src/config/module-settings.ts`
- Test: `packages/shared/src/config/module-settings.spec.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './config/module-settings';`)

**Interfaces:**
- Produces: `SettingType`, `SettingDescriptor`, `ModuleSettingsCatalog`, `MODULE_SETTINGS_CATALOG`, `catalogFor(moduleKey): ModuleSettingsCatalog | undefined`, `resolveSettings(catalog, stored): Record<string, string|number|boolean>`, `validateSettings(catalog, patch): { ok: true; value: Record<string, string|number|boolean> } | { ok: false; errors: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/config/module-settings.spec.ts
import { describe, it, expect } from 'vitest';
import {
  MODULE_SETTINGS_CATALOG,
  catalogFor,
  resolveSettings,
  validateSettings,
} from './module-settings';

const proc = catalogFor('procurement')!;

describe('catalog', () => {
  it('exposes a procurement catalog with bidUniqueness', () => {
    expect(proc).toBeDefined();
    expect(proc.settings.find((s) => s.key === 'bidUniqueness')).toBeDefined();
  });
  it('every enum descriptor has options and a default within them', () => {
    for (const cat of MODULE_SETTINGS_CATALOG) {
      for (const s of cat.settings) {
        if (s.type === 'enum') {
          expect(s.options && s.options.length).toBeTruthy();
          expect(s.options!.map((o) => o.value)).toContain(s.default);
        }
      }
    }
  });
});

describe('resolveSettings', () => {
  it('returns defaults when nothing stored', () => {
    const r = resolveSettings(proc, {});
    expect(r.bidUniqueness).toBe('MULTIPLE');
  });
  it('applies a valid stored override', () => {
    expect(resolveSettings(proc, { bidUniqueness: 'SINGLE' }).bidUniqueness).toBe('SINGLE');
  });
  it('ignores an invalid enum value and falls back to default', () => {
    expect(resolveSettings(proc, { bidUniqueness: 'NOPE' }).bidUniqueness).toBe('MULTIPLE');
  });
  it('ignores unknown stored keys', () => {
    const r = resolveSettings(proc, { evil: 'x' } as Record<string, unknown>);
    expect((r as Record<string, unknown>).evil).toBeUndefined();
  });
  it('clamps/ignores out-of-range numbers', () => {
    const tms = catalogFor('transportation')!;
    expect(resolveSettings(tms, { modeThresholdParcelMaxKg: -5 }).modeThresholdParcelMaxKg).toBe(30);
  });
});

describe('validateSettings', () => {
  it('accepts a valid patch', () => {
    const res = validateSettings(proc, { bidUniqueness: 'SINGLE' });
    expect(res.ok).toBe(true);
  });
  it('rejects an unknown key', () => {
    const res = validateSettings(proc, { evil: 1 });
    expect(res.ok).toBe(false);
  });
  it('rejects a bad enum value', () => {
    expect(validateSettings(proc, { bidUniqueness: 'NOPE' }).ok).toBe(false);
  });
  it('rejects a number below min', () => {
    const tms = catalogFor('transportation')!;
    expect(validateSettings(tms, { modeThresholdParcelMaxKg: -1 }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- module-settings`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/config/module-settings.ts
export type SettingType = 'enum' | 'boolean' | 'number';

export interface SettingDescriptor {
  key: string;
  label: string;
  help?: string;
  type: SettingType;
  default: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
}

export interface ModuleSettingsCatalog {
  module: string;
  settings: SettingDescriptor[];
}

export type ResolvedSettings = Record<string, string | number | boolean>;

/** v1 catalog. Defaults MUST equal current hardcoded behavior. */
export const MODULE_SETTINGS_CATALOG: ModuleSettingsCatalog[] = [
  {
    module: 'transportation',
    settings: [
      {
        key: 'capacityOverage',
        label: 'Dépassement de capacité',
        help: 'Comportement quand un load dépasse la capacité à la consolidation.',
        type: 'enum',
        default: 'WARN',
        options: [
          { value: 'WARN', label: 'Avertir (laisser passer)' },
          { value: 'BLOCK', label: 'Bloquer (refuser)' },
        ],
      },
      { key: 'modeThresholdParcelMaxKg', label: 'Seuil PARCEL max (kg)', type: 'number', default: 30, min: 0, max: 100000 },
      { key: 'modeThresholdLtlMaxKg', label: 'Seuil LTL max (kg)', type: 'number', default: 4000, min: 0, max: 100000 },
      { key: 'autoTenderOnPlan', label: 'Auto-tender à la planification', type: 'boolean', default: true },
    ],
  },
  {
    module: 'procurement',
    settings: [
      {
        key: 'bidUniqueness',
        label: 'Unicité des soumissions',
        help: 'Un transporteur peut soumettre plusieurs offres, ou une seule par voie (remplace la précédente).',
        type: 'enum',
        default: 'MULTIPLE',
        options: [
          { value: 'MULTIPLE', label: 'Plusieurs offres autorisées' },
          { value: 'SINGLE', label: 'Une offre par voie + transporteur' },
        ],
      },
      { key: 'awardCreatesRateByDefault', label: 'Attribution crée un tarif par défaut', type: 'boolean', default: false },
    ],
  },
  {
    module: 'connect',
    settings: [
      {
        key: 'csvNumberLocale',
        label: 'Format des nombres CSV',
        type: 'enum',
        default: 'EN',
        options: [
          { value: 'EN', label: 'Anglais (1,234.56)' },
          { value: 'FR', label: 'Français (1 234,56)' },
          { value: 'AUTO', label: 'Auto-détection' },
        ],
      },
    ],
  },
  {
    module: 'carrier-portal',
    settings: [
      { key: 'podRequiresDispatched', label: 'POD exige un load dispatché', type: 'boolean', default: false },
    ],
  },
  {
    module: 'billing',
    settings: [
      { key: 'tolerancePct', label: 'Tolérance rapprochement (%)', type: 'number', default: 2, min: 0, max: 100 },
      { key: 'toleranceAbsolute', label: 'Tolérance rapprochement (absolue)', type: 'number', default: 25, min: 0, max: 1000000 },
    ],
  },
  {
    module: 'fleet',
    settings: [
      { key: 'complianceExpiringWindowDays', label: 'Fenêtre « expire bientôt » (jours)', type: 'number', default: 30, min: 1, max: 365 },
    ],
  },
];

export function catalogFor(moduleKey: string): ModuleSettingsCatalog | undefined {
  return MODULE_SETTINGS_CATALOG.find((c) => c.module === moduleKey);
}

function isValid(d: SettingDescriptor, v: unknown): boolean {
  if (d.type === 'boolean') return typeof v === 'boolean';
  if (d.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    if (d.min !== undefined && v < d.min) return false;
    if (d.max !== undefined && v > d.max) return false;
    return true;
  }
  // enum
  return typeof v === 'string' && !!d.options?.some((o) => o.value === v);
}

/** Merge stored values over catalog defaults, dropping invalid/unknown keys. */
export function resolveSettings(catalog: ModuleSettingsCatalog, stored: Record<string, unknown>): ResolvedSettings {
  const out: ResolvedSettings = {};
  for (const d of catalog.settings) {
    const v = stored[d.key];
    out[d.key] = v !== undefined && isValid(d, v) ? (v as string | number | boolean) : d.default;
  }
  return out;
}

/** Validate a write patch against the catalog (whitelist keys + type/range/enum). */
export function validateSettings(
  catalog: ModuleSettingsCatalog,
  patch: Record<string, unknown>,
): { ok: true; value: ResolvedSettings } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const value: ResolvedSettings = {};
  const known = new Map(catalog.settings.map((d) => [d.key, d]));
  for (const [k, v] of Object.entries(patch)) {
    const d = known.get(k);
    if (!d) {
      errors.push(`Unknown setting "${k}"`);
      continue;
    }
    if (!isValid(d, v)) {
      errors.push(`Invalid value for "${k}"`);
      continue;
    }
    value[k] = v as string | number | boolean;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/shared/src/index.ts`, add: `export * from './config/module-settings';`

- [ ] **Step 5: Run tests + build**

Run: `pnpm --filter @pulsar/shared test -- module-settings && pnpm --filter @pulsar/shared build`
Expected: tests PASS, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config/module-settings.ts packages/shared/src/config/module-settings.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): module settings catalog + pure resolve/validate"
```

---

### Task 2: `ModuleSettingsService` + cache (api)

**Files:**
- Create: `apps/api/src/core/module-registry/module-settings.service.ts`
- Modify: `apps/api/src/prisma/tenant-modules-cache.service.ts` (add a settings cache + `invalidate` already clears both)
- Modify: `apps/api/src/core/module-registry/module-registry.module.ts` (provide + export `ModuleSettingsService`)

**Interfaces:**
- Consumes: `catalogFor`, `resolveSettings`, `validateSettings`, `ResolvedSettings` from `@pulsar/shared` (Task 1).
- Produces: `ModuleSettingsService.resolve(tenantId, moduleKey): Promise<ResolvedSettings>`, `ModuleSettingsService.update(tenantId, moduleKey, patch): Promise<ResolvedSettings>` (validates; throws `BadRequestException` on invalid; persists into `TenantModule.settings`; invalidates cache). `ModuleSettingsService.descriptors(moduleKey): SettingDescriptor[]`.

- [ ] **Step 1: Add a settings cache to `TenantModulesCacheService`**

Add alongside the existing keys cache:

```ts
// in tenant-modules-cache.service.ts
private readonly settingsCache = new Map<string, { settings: Record<string, unknown>; expiresAt: number }>();

async getRawSettings(tenantId: string, moduleId: string): Promise<Record<string, unknown>> {
  const ck = `${tenantId}:${moduleId}`;
  const hit = this.settingsCache.get(ck);
  if (hit && hit.expiresAt > Date.now()) return hit.settings;
  const row = await this.prisma.tenantModule.findUnique({
    where: { tenantId_moduleId: { tenantId, moduleId } },
    select: { settings: true },
  });
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  this.settingsCache.set(ck, { settings, expiresAt: Date.now() + TTL_MS });
  return settings;
}
```

And in `invalidate(tenantId)`, also clear settings entries for that tenant:

```ts
invalidate(tenantId: string): void {
  this.cache.delete(tenantId);
  for (const k of this.settingsCache.keys()) {
    if (k.startsWith(`${tenantId}:`)) this.settingsCache.delete(k);
  }
}
```

- [ ] **Step 2: Write the service**

```ts
// apps/api/src/core/module-registry/module-settings.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  catalogFor,
  resolveSettings,
  validateSettings,
  type ResolvedSettings,
  type SettingDescriptor,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';

@Injectable()
export class ModuleSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TenantModulesCacheService,
  ) {}

  descriptors(moduleKey: string): SettingDescriptor[] {
    const cat = catalogFor(moduleKey);
    if (!cat) throw new NotFoundException(`No settings for module "${moduleKey}"`);
    return cat.settings;
  }

  private async moduleId(moduleKey: string): Promise<string> {
    const def = await this.prisma.moduleDefinition.findUnique({ where: { key: moduleKey } });
    if (!def) throw new NotFoundException(`Unknown module "${moduleKey}"`);
    return def.id;
  }

  async resolve(tenantId: string, moduleKey: string): Promise<ResolvedSettings> {
    const cat = catalogFor(moduleKey);
    if (!cat) return {};
    const id = await this.moduleId(moduleKey);
    const stored = await this.cache.getRawSettings(tenantId, id);
    return resolveSettings(cat, stored);
  }

  async update(tenantId: string, moduleKey: string, patch: Record<string, unknown>): Promise<ResolvedSettings> {
    const cat = catalogFor(moduleKey);
    if (!cat) throw new NotFoundException(`No settings for module "${moduleKey}"`);
    const res = validateSettings(cat, patch);
    if (!res.ok) throw new BadRequestException(res.errors.join('; '));
    const id = await this.moduleId(moduleKey);
    const existing = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId: id } },
      select: { settings: true },
    });
    const merged = { ...((existing?.settings ?? {}) as Record<string, unknown>), ...res.value };
    await this.prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: id } },
      update: { settings: merged as Prisma.InputJsonValue },
      create: { tenantId, moduleId: id, enabled: false, settings: merged as Prisma.InputJsonValue },
    });
    this.cache.invalidate(tenantId);
    return resolveSettings(cat, merged);
  }
}
```

- [ ] **Step 3: Register the provider**

In `module-registry.module.ts`, add `ModuleSettingsService` to `providers` and `exports`.

- [ ] **Step 4: Build the api**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/module-registry/module-settings.service.ts apps/api/src/prisma/tenant-modules-cache.service.ts apps/api/src/core/module-registry/module-registry.module.ts
git commit -m "feat(api): ModuleSettingsService over TenantModule.settings (cached)"
```

---

### Task 3: GET/PUT settings endpoints + e2e

**Files:**
- Modify: `apps/api/src/core/module-registry/module-registry.controller.ts`
- Test: `apps/api/test/module-settings.e2e-spec.ts`

**Interfaces:**
- Consumes: `ModuleSettingsService.resolve/update/descriptors` (Task 2).
- Produces: `GET /api/v1/modules/:key/settings` → `{ descriptors, values }`; `PUT /api/v1/modules/:key/settings` body `{ settings }` → `{ values }`.

- [ ] **Step 1: Write the failing e2e**

```ts
// apps/api/test/module-settings.e2e-spec.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

describe('Module settings (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.listen(0);
    http = app.getHttpServer();
    app.get(PrismaService);
    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('GET returns descriptors + resolved default values', async () => {
    const res = await request(http).get('/api/v1/modules/procurement/settings').set(auth()).expect(200);
    const body = res.body as { descriptors: Array<{ key: string }>; values: Record<string, unknown> };
    expect(body.descriptors.some((d) => d.key === 'bidUniqueness')).toBe(true);
    expect(body.values.bidUniqueness).toBe('MULTIPLE');
  });

  it('PUT persists a valid value and GET reflects it', async () => {
    await request(http).put('/api/v1/modules/procurement/settings').set(auth())
      .send({ settings: { bidUniqueness: 'SINGLE' } }).expect(200);
    const res = await request(http).get('/api/v1/modules/procurement/settings').set(auth()).expect(200);
    expect((res.body as { values: Record<string, unknown> }).values.bidUniqueness).toBe('SINGLE');
    // reset to default for other suites
    await request(http).put('/api/v1/modules/procurement/settings').set(auth())
      .send({ settings: { bidUniqueness: 'MULTIPLE' } }).expect(200);
  });

  it('PUT rejects an unknown key (400)', async () => {
    await request(http).put('/api/v1/modules/procurement/settings').set(auth())
      .send({ settings: { evil: 1 } }).expect(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pulsar/api exec jest --config test/jest-e2e.json --runInBand module-settings`
Expected: FAIL (404 on the new routes).

- [ ] **Step 3: Add the endpoints**

Append to `ModuleRegistryController` (inject `ModuleSettingsService` via the constructor, add a `SettingsDto` with `@IsObject() settings`):

```ts
// imports
import { Get, Put, Body } from '@nestjs/common';
import { IsObject } from 'class-validator';
import { ModuleSettingsService } from './module-settings.service';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuditAction } from '@pulsar/shared';

class SettingsDto {
  @IsObject()
  settings!: Record<string, unknown>;
}

// constructor: add `private readonly settings: ModuleSettingsService`

@Get(':key/settings')
@RequirePermissions(PERMISSIONS.CORE.MODULES_READ)
async getSettings(@CurrentUser() user: AuthUser, @Param('key') key: string) {
  return {
    descriptors: this.settings.descriptors(key),
    values: await this.settings.resolve(user.tenantId, key),
  };
}

@Put(':key/settings')
@Audit('tenant-module', AuditAction.UPDATE)
@RequirePermissions(PERMISSIONS.CORE.MODULES_MANAGE)
async putSettings(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() dto: SettingsDto) {
  return { values: await this.settings.update(user.tenantId, key, dto.settings) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pulsar/api exec jest --config test/jest-e2e.json --runInBand module-settings`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/module-registry/module-registry.controller.ts apps/api/test/module-settings.e2e-spec.ts
git commit -m "feat(api): GET/PUT /modules/:key/settings (validated, audited)"
```

---

### Task 4: Generic settings UI + route + nav

**Files:**
- Create: `apps/web/src/lib/components/settings/ModuleSettings.svelte`
- Create: `apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte`
- Modify: `apps/web/src/lib/modules/navigation.ts` (add a "Configuration" entry per module that has a catalog)

**Interfaces:**
- Consumes: `GET/PUT /modules/:key/settings` (Task 3), `api<T>()` from `$lib/api/client`, `Select`/`Toggle`/`Input` from `$lib/components/ui`.

- [ ] **Step 1: Write `ModuleSettings.svelte`**

```svelte
<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Select, Toggle, Button } from '$lib/components/ui';

  let { module }: { module: string } = $props();

  interface Descriptor {
    key: string; label: string; help?: string;
    type: 'enum' | 'boolean' | 'number';
    default: string | number | boolean;
    options?: { value: string; label: string }[];
    min?: number; max?: number;
  }

  let descriptors = $state<Descriptor[]>([]);
  let values = $state<Record<string, string | number | boolean>>({});
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let saved = $state(false);

  async function load() {
    loading = true; error = '';
    try {
      const res = await api<{ descriptors: Descriptor[]; values: Record<string, string | number | boolean> }>(
        `/modules/${module}/settings`,
      );
      descriptors = res.descriptors;
      values = { ...res.values };
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true; error = ''; saved = false;
    try {
      const res = await api<{ values: Record<string, string | number | boolean> }>(
        `/modules/${module}/settings`,
        { method: 'PUT', body: { settings: values } },
      );
      values = { ...res.values };
      saved = true;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec de l\'enregistrement';
    } finally {
      saving = false;
    }
  }

  $effect(() => { if (module) load(); });
</script>

{#if loading}
  <p class="text-muted">Chargement…</p>
{:else if error}
  <p class="text-danger">{error}</p>
{:else}
  <div class="space-y-4">
    {#each descriptors as d (d.key)}
      <div>
        <label class="block text-sm font-medium">{d.label}</label>
        {#if d.help}<p class="text-xs text-muted">{d.help}</p>{/if}
        {#if d.type === 'enum'}
          <Select bind:value={values[d.key]}>
            {#each d.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </Select>
        {:else if d.type === 'boolean'}
          <Toggle bind:checked={values[d.key]} />
        {:else}
          <input type="number" class="input" min={d.min} max={d.max} bind:value={values[d.key]} />
        {/if}
      </div>
    {/each}
    <div class="flex items-center gap-3">
      <Button onclick={save} disabled={saving}>Enregistrer</Button>
      {#if saved}<span class="text-success text-sm">Enregistré</span>{/if}
    </div>
  </div>
{/if}
```

Note: match the exact prop/import names of the existing `$lib/components/ui` barrel (`Select`, `Toggle`, `Button`, `Input`). If `Toggle` uses a different prop than `checked`, adapt to the existing component's API (read `apps/web/src/lib/components/ui/Toggle.svelte` first).

- [ ] **Step 2: Write the route**

```svelte
<!-- apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte -->
<script lang="ts">
  import { page } from '$app/state';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  const key = $derived(page.params.key as string);
</script>

<h1 class="text-xl font-semibold mb-4">Configuration</h1>
<ModuleSettings module={key} />
```

- [ ] **Step 3: Add nav entries**

In `apps/web/src/lib/modules/navigation.ts`, add a "Configuration" link (`/settings/modules/<key>`) to each module group that has a catalog (transportation, procurement, connect, carrier-portal, billing, fleet), gated like other manage-only entries (follow the file's existing permission-gating pattern; the catalog modules are: transportation, procurement, connect, carrier-portal, billing, fleet).

- [ ] **Step 4: Verify typecheck + manual smoke**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: 0 errors. Then `pnpm dev`, open `/settings/modules/procurement`, confirm the form renders and saving `bidUniqueness` persists.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/settings/ModuleSettings.svelte "apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte" apps/web/src/lib/modules/navigation.ts
git commit -m "feat(web): generic module settings panel + per-module Configuration nav"
```

---

### Task 5: Wire procurement `bidUniqueness` (proves the framework end-to-end)

**Files:**
- Modify: `apps/api/src/modules/procurement/procurement.service.ts` (`submitBidByToken`)
- Modify: `apps/api/src/modules/procurement/procurement.module.ts` (import the module-registry module / inject `ModuleSettingsService`)
- Test: extend `apps/api/test/module-settings.e2e-spec.ts` with a behavior case.

**Interfaces:**
- Consumes: `ModuleSettingsService.resolve(tenantId, 'procurement')` → `{ bidUniqueness: 'MULTIPLE' | 'SINGLE' }`.

- [ ] **Step 1: Write the failing behavior e2e**

Add to `module-settings.e2e-spec.ts` (after a helper that creates an RFP, lane, invite, opens it — reuse the pattern from `procurement.e2e-spec.ts`): with `bidUniqueness=SINGLE`, submitting two bids for the same `(rfpLane, carrier)` leaves exactly ONE non-terminal bid (the second replaces the first). Assert via `prisma.bid.count({ where: { rfpLaneId, status: { in: ['SUBMITTED','SHORTLISTED'] } } })` === 1.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pulsar/api exec jest --config test/jest-e2e.json --runInBand module-settings`
Expected: FAIL (count === 2 with default create behavior).

- [ ] **Step 3: Inject the service + branch in `submitBidByToken`**

Inject `ModuleSettingsService` into `ProcurementService` (add `ProcurementModule` import of the module-registry module that exports it). Before `this.prisma.bid.create(...)`:

```ts
const settings = await this.moduleSettings.resolve(invite.tenantId, 'procurement');
if (settings.bidUniqueness === 'SINGLE') {
  // Replace any existing non-terminal bid for this (lane, carrier).
  await this.prisma.bid.deleteMany({
    where: {
      rfpLaneId: dto.rfpLaneId,
      carrierId: invite.carrierId,
      tenantId: invite.tenantId,
      status: { in: [BidStatus.SUBMITTED, BidStatus.SHORTLISTED] },
    },
  });
}
// existing create(...) unchanged
```

- [ ] **Step 4: Also wire `awardCreatesRateByDefault`**

In `award()`, when the request omits `createRate`, fall back to the setting so a tenant can default award→rate on. Replace the `if (dto.createRate)` guard with:

```ts
const procSettings = await this.moduleSettings.resolve(tenantId, 'procurement');
const shouldCreateRate = dto.createRate ?? (procSettings.awardCreatesRateByDefault as boolean);
if (shouldCreateRate) {
  // ...existing rate-creation block unchanged...
}
```

(`AwardDto.createRate` is already optional; resolve once at the top of `award()` and reuse.)

- [ ] **Step 5: Run to verify it passes + the existing procurement e2e still passes**

Run: `pnpm --filter @pulsar/api exec jest --config test/jest-e2e.json --runInBand "module-settings|procurement"`
Expected: all PASS (defaults — MULTIPLE + awardCreatesRateByDefault=false — leave procurement.e2e unaffected).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/procurement/procurement.service.ts apps/api/src/modules/procurement/procurement.module.ts apps/api/test/module-settings.e2e-spec.ts
git commit -m "feat(procurement): honor bidUniqueness + awardCreatesRateByDefault settings"
```

---

### Task 6: Wire connect `csvNumberLocale`

**Files:**
- Modify: `packages/shared/src/connect/connect.ts` (`coerceTypes` gains a locale arg) + its spec
- Modify: `apps/api/src/core/connect/imports.service.ts` (resolve setting, pass locale)

**Interfaces:**
- Consumes: `ModuleSettingsService.resolve(tenantId, 'connect')` → `{ csvNumberLocale: 'EN'|'FR'|'AUTO' }`.

- [ ] **Step 1: Add a parse-number helper + test (shared)**

In `connect.spec.ts` add cases: `parseNumber('1 234,56','FR')===1234.56`, `parseNumber('1,234.56','EN')===1234.56`, `parseNumber('1234.56','AUTO')===1234.56`, `parseNumber('1 234,56','AUTO')===1234.56`.

- [ ] **Step 2: Implement + thread through `coerceTypes`**

```ts
export type CsvLocale = 'EN' | 'FR' | 'AUTO';
export function parseCsvNumber(raw: string, locale: CsvLocale): number {
  let s = raw.trim();
  if (locale === 'FR' || (locale === 'AUTO' && /\d,\d/.test(s) && !/\d\.\d/.test(s))) {
    s = s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/[\s,]/g, '');
  }
  return Number(s);
}
```

`coerceTypes(record, target, locale: CsvLocale = 'EN')` uses `parseCsvNumber(value, locale)` for `NUMERIC_FIELDS` instead of `Number(value)`.

- [ ] **Step 3: Resolve + pass in `imports.service.ts`**

In `runImport`, resolve `const { csvNumberLocale } = await this.moduleSettings.resolve(tenantId, 'connect');` and pass it into `coerceTypes(mapped, target, csvNumberLocale as CsvLocale)`. Inject `ModuleSettingsService` into `ImportsService`.

- [ ] **Step 4: Build shared + run tests**

Run: `pnpm --filter @pulsar/shared test -- connect && pnpm --filter @pulsar/shared build && pnpm --filter @pulsar/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/connect/connect.ts packages/shared/src/connect/connect.spec.ts apps/api/src/core/connect/imports.service.ts
git commit -m "feat(connect): honor csvNumberLocale setting in CSV number parsing"
```

---

### Task 7: Wire carrier-portal `podRequiresDispatched`

**Files:**
- Modify: `apps/api/src/modules/carrier-portal/carrier-portal.service.ts` (`uploadPod`)
- Modify: `apps/api/src/modules/carrier-portal/carrier-portal.module.ts` (inject `ModuleSettingsService`)

**Interfaces:**
- Consumes: `ModuleSettingsService.resolve(tenantId, 'carrier-portal')` → `{ podRequiresDispatched: boolean }`.

- [ ] **Step 1: Branch in `uploadPod`**

After resolving the load (which already checks tenant + carrier ownership), before storing:

```ts
const settings = await this.moduleSettings.resolve(carrier.tenantId, 'carrier-portal');
if (settings.podRequiresDispatched) {
  const fresh = await this.prisma.load.findFirst({
    where: { id: loadId, tenantId: carrier.tenantId },
    select: { status: true },
  });
  const ok = fresh && ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(fresh.status);
  if (!ok) throw new BadRequestException('POD requires the load to be dispatched');
}
```

Use the actual `LoadStatus` enum values from `@pulsar/shared` (read the enum first; the list above is illustrative — replace with the real dispatched-or-later set).

- [ ] **Step 2: Inject + typecheck**

Inject `ModuleSettingsService`. Run `pnpm --filter @pulsar/api typecheck`. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/carrier-portal/carrier-portal.service.ts apps/api/src/modules/carrier-portal/carrier-portal.module.ts
git commit -m "feat(carrier-portal): honor podRequiresDispatched setting"
```

---

### Task 8: Wire billing tolerances through the framework (retro-compat)

**Files:**
- Modify: `apps/api/src/modules/billing/freight-audit/freight-audit.service.ts` (`tolerances`)
- Modify: `apps/api/src/modules/billing/invoices.service.ts` (the settings read at ~line 143)
- Modify: `apps/api/src/modules/billing/billing.module.ts` (inject `ModuleSettingsService`)

**Interfaces:**
- Consumes: `ModuleSettingsService.resolve(tenantId, 'billing')` → `{ tolerancePct: number; toleranceAbsolute: number }`.

- [ ] **Step 1: Replace ad-hoc reads with the resolver**

In `FreightAuditService.tolerances`, replace the manual `tm.settings` parse with:

```ts
const s = await this.moduleSettings.resolve(tenantId, 'billing');
return { tolerancePct: s.tolerancePct as number, toleranceAbsolute: s.toleranceAbsolute as number };
```

Apply the same swap in `invoices.service.ts`. Keys are unchanged (`tolerancePct`/`toleranceAbsolute`), so previously stored values keep working (retro-compat).

- [ ] **Step 2: Inject + run billing tests**

Inject `ModuleSettingsService`. Run `pnpm --filter @pulsar/api typecheck` and `pnpm --filter @pulsar/api exec jest --config test/jest-e2e.json --runInBand phase16-freight-audit` (and any billing unit spec). Expected: PASS. Update the freight-audit unit spec's mock if it constructs the service directly (add a `moduleSettings` mock returning `{ tolerancePct: 2, toleranceAbsolute: 25 }`).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/billing/
git commit -m "refactor(billing): read reconciliation tolerances via the settings framework"
```

---

### Task 9: Wire fleet `complianceExpiringWindowDays`

**Files:**
- Modify: `apps/api/src/modules/fleet/compliance/compliance.service.ts` (pass the window into `computeComplianceStatus`)
- Modify: `apps/api/src/modules/fleet/fleet.module.ts` (inject `ModuleSettingsService`)

**Interfaces:**
- Consumes: `ModuleSettingsService.resolve(tenantId, 'fleet')` → `{ complianceExpiringWindowDays: number }`. `computeComplianceStatus(expiresAt, now, warnDays)` already accepts `warnDays`.

- [ ] **Step 1: Resolve + pass**

Wherever `computeComplianceStatus(doc.expiresAt, Date.now())` is called, resolve `const { complianceExpiringWindowDays } = await this.moduleSettings.resolve(tenantId, 'fleet');` once and pass it as the third arg: `computeComplianceStatus(doc.expiresAt, Date.now(), complianceExpiringWindowDays as number)`.

- [ ] **Step 2: Inject + typecheck + fleet e2e**

Run `pnpm --filter @pulsar/api typecheck` and `pnpm --filter @pulsar/api exec jest --config test/jest-e2e.json --runInBand fleet-module`. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/fleet/
git commit -m "feat(fleet): honor complianceExpiringWindowDays setting"
```

---

### Task 10: Wire transportation (capacity overage + mode thresholds + auto-tender)

**Files:**
- Modify: `packages/shared/src/planning/mode.ts` (`suggestMode` gains optional thresholds) + its spec
- Modify: the TMS service(s) doing capacity checks on consolidate/assign (read `capacityOverage`), `suggestMode` callers (pass thresholds), and the auto-tender entry point (skip when `autoTenderOnPlan` is false)
- Modify: `apps/api/src/modules/transportation/transportation.module.ts` (inject `ModuleSettingsService`)

**Interfaces:**
- Consumes: `ModuleSettingsService.resolve(tenantId, 'transportation')` → `{ capacityOverage: 'WARN'|'BLOCK'; modeThresholdParcelMaxKg: number; modeThresholdLtlMaxKg: number; autoTenderOnPlan: boolean }`.

- [ ] **Step 1: Make `suggestMode` configurable + test**

```ts
export function suggestMode(totalWeightKg: number | null | undefined, parcelMaxKg = PARCEL_MAX_KG, ltlMaxKg = LTL_MAX_KG): TransportMode | null {
  if (totalWeightKg == null) return null;
  if (totalWeightKg <= parcelMaxKg) return TransportMode.PARCEL;
  if (totalWeightKg <= ltlMaxKg) return TransportMode.LTL;
  return TransportMode.FTL;
}
```

Add a `mode.spec.ts` case: custom thresholds reclassify (`suggestMode(50, 100, 4000) === 'PARCEL'`). Build shared.

- [ ] **Step 2: Capacity overage `BLOCK`**

In the consolidate/assign path that currently warns on capacity overage (search `checkCapacity` usage in the transportation services), resolve `capacityOverage`; when `'BLOCK'` and capacity is exceeded, throw `ConflictException` (409) instead of recording a warning. Keep `'WARN'` as the unchanged default path.

- [ ] **Step 3: Auto-tender toggle**

At the auto-tender trigger (the best-effort chain advanced on plan), resolve `autoTenderOnPlan`; when false, skip the auto-tender step (log + leave the load PLANNED, identical to a tender that didn't advance).

- [ ] **Step 4: Inject + typecheck + TMS e2e**

Run `pnpm --filter @pulsar/api typecheck`, `pnpm --filter @pulsar/shared test -- mode`, and `pnpm --filter @pulsar/api exec jest --config test/jest-e2e.json --runInBand "dispatch-workbench|tender-automation|phase7-2-integrity"`. Expected: PASS (defaults preserve current behavior).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/planning/mode.ts packages/shared/src/planning/__tests__/mode.spec.ts apps/api/src/modules/transportation/
git commit -m "feat(transportation): configurable capacity overage, mode thresholds, auto-tender"
```

---

### Task 11: Final verification

- [ ] **Step 1: Full suites**

Run: `pnpm typecheck && pnpm test && pnpm test:e2e`
Expected: all green (unit includes new shared specs; e2e includes `module-settings`).

- [ ] **Step 2: Update the status doc**

Add a one-line entry to `docs/etat-du-projet.md` noting the module configuration framework + v1 catalog.

- [ ] **Step 3: Commit**

```bash
git add docs/etat-du-projet.md
git commit -m "docs: note module configuration framework"
```
