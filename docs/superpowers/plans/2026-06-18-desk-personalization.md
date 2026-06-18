# Desk — Personnalisation & polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centrer/fiabiliser le Pulsar Desk et ajouter une couche de personnalisation (couleur d'accent globale, fond du Desk couleur/dégradé/image, taille des tuiles), persistée par utilisateur en BD.

**Architecture:** La logique pure (types, réconciliation, dérivation d'accent, catalogues) vit dans `@pulsar/shared` et est couverte par vitest. La BD étend `UserPreferences` d'un champ `appearance Json?`; l'API `PUT /me/preferences` accepte le nouveau payload. Le web applique le thème+accent au boot via un script inline (anti-flash) puis réconcilie depuis la BD; le Desk lit `deskLayout` (mode/positions/fond/tailles) et rend un board centré borné.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, SvelteKit (Svelte 5 runes), TailwindCSS v4 (tokens `--t-*`), vitest.

## Global Constraints

- Tenant/identité : `PUT /me/preferences` agit sur `user.id` du JWT (`@CurrentUser()`) — jamais d'id depuis le body (règle 1).
- DTO sous `forbidNonWhitelisted` : tout champ non déclaré dans le DTO → **400**. Tout nouveau champ accepté DOIT être ajouté au DTO (cf. commit `fix(api): allow deskLayout.mode`).
- Fichiers uniquement via `DocumentsService.upload/download` (règle 12) — jamais le FS/S3 directement.
- Après modif de `packages/shared` ou `packages/database`, **rebuild** (`pnpm --filter @pulsar/shared build`, `pnpm --filter @pulsar/database build`) — l'API/web consomment leur `dist/` (règle 7).
- Enums/valeurs partagées vivent dans `@pulsar/shared` ; ne pas réimplémenter côté web/api.
- Tuiles : tailles exactes `sm=76`, `md=96` (défaut, = `DESK_TILE` actuel), `lg=120` px.
- Thèmes valides : `warm` | `cool` | `dark`. Accent : couleur hex `#rgb` ou `#rrggbb`.
- Web : pas de harnais de tests unitaires (le `pnpm test` ne couvre que `@pulsar/shared`). Les tâches web se vérifient par `pnpm typecheck` + lancement de l'app.
- Prettier seul formateur (`pnpm format`).

---

## File Structure

**`packages/shared/src/desk/desk-layout.ts`** (modifié) — types Desk + réconciliation. Ajout : `DeskTileSize`, `TILE_SIZES`, `DeskBackground`, `DeskGradient`, `DESK_GRADIENTS`, champs `tileSize`/`background` sur `DeskLayout`, préservation dans `reconcileDeskLayout`, ré-injection du dossier Framework.

**`packages/shared/src/appearance/appearance.ts`** (créé) — apparence globale : `AppearanceTheme`, `Appearance`, `AccentVars`, `deriveAccent`, `isHexColor`. Exporté depuis `src/index.ts`.

**`packages/database/prisma/schema.prisma`** (modifié) — `UserPreferences.appearance Json?`. + migration.

**`apps/api/src/core/preferences/dto/desk-layout.dto.ts`** (modifié) — whitelist `appearance`, `deskLayout.background`, `deskLayout.tileSize`.
**`apps/api/src/core/preferences/preferences.service.ts`** (modifié) — get/update incluent `appearance`.
**`apps/api/src/core/preferences/preferences.controller.ts`** (modifié) — passe `appearance`.

**`apps/web/src/app.html`** (modifié) — script boot applique aussi l'accent caché.
**`apps/web/src/lib/stores/appearance.ts`** (créé) — store thème+accent, application DOM, cache localStorage, persistance BD.
**`apps/web/src/lib/api/preferences.ts`** (modifié) — `getPreferences`/`putPreferences` incluent `appearance` ; helpers blob + upload.
**`apps/web/src/lib/api/files.ts`** (créé) — `uploadDocument`, `fetchDocumentObjectUrl` (fetch authentifié → objectURL).
**`apps/web/src/routes/(app)/+layout.svelte`** (modifié) — charge l'apparence depuis les prefs au montage.
**`apps/web/src/routes/(app)/settings/appearance/+page.svelte`** (modifié) — sélecteur d'accent (+ reset) + fond du Desk + upload.
**`apps/web/src/lib/components/desk/DeskIcon.svelte`**, **`DeskFolderTile.svelte`** (modifiés) — prop `size`.
**`apps/web/src/routes/(app)/apps/+page.svelte`** (modifié) — board centré, fix reset, menu vide, fond, tileSize, action « Personnaliser » dans Framework.

---

## Task 1: Shared — tailles de tuiles, fond, ré-injection Framework

**Files:**
- Modify: `packages/shared/src/desk/desk-layout.ts`
- Test: `packages/shared/src/desk/desk-layout.spec.ts`

**Interfaces:**
- Produces:
  - `type DeskTileSize = 'sm' | 'md' | 'lg'`
  - `const TILE_SIZES: Record<DeskTileSize, number>` = `{ sm: 76, md: 96, lg: 120 }`
  - `type DeskBackground = { type: 'color'; value: string } | { type: 'gradient'; value: string } | { type: 'image'; value: string }`
  - `interface DeskGradient { id: string; label: string; css: string }`
  - `const DESK_GRADIENTS: DeskGradient[]`
  - `interface DeskLayout { version; mode; items; tileSize?: DeskTileSize; background?: DeskBackground }`
  - `reconcileDeskLayout` préserve `tileSize`/`background` et ré-injecte le dossier Framework s'il manque.

- [ ] **Step 1: Write the failing tests**

Ajouter à la fin de `packages/shared/src/desk/desk-layout.spec.ts` :

```ts
import {
  TILE_SIZES,
  DESK_GRADIENTS,
  FRAMEWORK_FOLDER_ID,
  type DeskTileSize,
} from './desk-layout';

describe('tile sizes & background', () => {
  it('TILE_SIZES maps sm/md/lg to 76/96/120', () => {
    expect(TILE_SIZES).toEqual({ sm: 76, md: 96, lg: 120 });
  });

  it('DESK_GRADIENTS entries have unique ids and a css string', () => {
    expect(DESK_GRADIENTS.length).toBeGreaterThan(0);
    const ids = DESK_GRADIENTS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DESK_GRADIENTS.every((g) => typeof g.css === 'string' && g.css.length > 0)).toBe(true);
  });

  it('reconcileDeskLayout preserves tileSize and background', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      mode: 'free',
      items: [{ type: 'module', moduleKey: 'transport' }],
      tileSize: 'lg' as DeskTileSize,
      background: { type: 'color', value: '#101010' },
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }]);
    expect(out.tileSize).toBe('lg');
    expect(out.background).toEqual({ type: 'color', value: '#101010' });
  });

  it('reconcileDeskLayout re-injects the Framework folder when missing', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      mode: 'auto',
      items: [{ type: 'module', moduleKey: 'transport' }],
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }]);
    const fw = out.items.find((i) => i.type === 'folder' && (i as any).id === FRAMEWORK_FOLDER_ID);
    expect(fw).toBeTruthy();
  });

  it('reconcileDeskLayout does not duplicate an existing Framework folder', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      mode: 'auto',
      items: [{ type: 'folder', id: FRAMEWORK_FOLDER_ID, name: 'Framework', items: [] }],
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }]);
    const fws = out.items.filter((i) => i.type === 'folder' && (i as any).id === FRAMEWORK_FOLDER_ID);
    expect(fws.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pulsar/shared test`
Expected: FAIL (`TILE_SIZES`/`DESK_GRADIENTS` undefined; tileSize/background not preserved; framework not re-injected).

- [ ] **Step 3: Implement in `desk-layout.ts`**

Après `export const DESK_CANVAS_W = ...` (ligne ~14), ajouter :

```ts
export type DeskTileSize = 'sm' | 'md' | 'lg';
export const TILE_SIZES: Record<DeskTileSize, number> = { sm: 76, md: 96, lg: 120 };

export type DeskBackground =
  | { type: 'color'; value: string }
  | { type: 'gradient'; value: string } // value = DeskGradient.id
  | { type: 'image'; value: string }; // value = Document id

export interface DeskGradient {
  id: string;
  label: string;
  css: string;
}

export const DESK_GRADIENTS: DeskGradient[] = [
  { id: 'aurora', label: 'Aurore', css: 'linear-gradient(135deg,#1e3a8a 0%,#7e22ce 100%)' },
  { id: 'sunset', label: 'Coucher', css: 'linear-gradient(135deg,#f1700f 0%,#be123c 100%)' },
  { id: 'mint', label: 'Menthe', css: 'linear-gradient(135deg,#0f766e 0%,#22c55e 100%)' },
  { id: 'slate', label: 'Ardoise', css: 'linear-gradient(135deg,#0f172a 0%,#334155 100%)' },
  { id: 'sand', label: 'Sable', css: 'linear-gradient(135deg,#fdf2e9 0%,#e7d3b3 100%)' },
];
```

Modifier l'interface `DeskLayout` :

```ts
export interface DeskLayout {
  version: number;
  mode: DeskMode;
  items: DeskItem[];
  tileSize?: DeskTileSize;
  background?: DeskBackground;
}
```

Dans `reconcileDeskLayout`, juste avant le `return { version, mode, items: positioned }` final :

```ts
  // Re-inject the Framework folder if the saved layout lost it (symmetric to re-adding modules).
  const hasFramework = positioned.some(
    (it) => it.type === 'folder' && it.id === FRAMEWORK_FOLDER_ID,
  );
  const finalItems = hasFramework
    ? positioned
    : [
        ...positioned,
        {
          type: 'folder' as const,
          id: FRAMEWORK_FOLDER_ID,
          name: 'Framework',
          items: [...FRAMEWORK_LINKS],
          pos: defaultPosition(positioned.length),
        },
      ];

  const tileSize: DeskTileSize | undefined =
    s.tileSize === 'sm' || s.tileSize === 'md' || s.tileSize === 'lg' ? s.tileSize : undefined;
  const bg = isDeskBackground(s.background) ? s.background : undefined;

  return {
    version: DESK_LAYOUT_VERSION,
    mode,
    items: finalItems,
    ...(tileSize ? { tileSize } : {}),
    ...(bg ? { background: bg } : {}),
  };
```

Remplacer la signature de `reconcileDeskLayout` pour typer `s` avec les nouveaux champs optionnels :

```ts
  const s = saved as (DeskLayout & { tileSize?: unknown; background?: unknown }) | null | undefined;
```

Ajouter en bas du fichier le garde de type :

```ts
function isDeskBackground(x: unknown): x is DeskBackground {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    (o.type === 'color' || o.type === 'gradient' || o.type === 'image') &&
    typeof o.value === 'string'
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pulsar/shared test`
Expected: PASS (tous, y compris les tests existants — `defaultDeskLayout` contient déjà Framework donc le test `reconcileDeskLayout(null) toEqual defaultDeskLayout` reste vert).

- [ ] **Step 5: Build shared & commit**

```bash
pnpm --filter @pulsar/shared build
git add packages/shared/src/desk/desk-layout.ts packages/shared/src/desk/desk-layout.spec.ts
git commit -m "feat(shared): desk tileSize, background, gradients + Framework re-injection (tested)"
```

---

## Task 2: Shared — apparence globale (thème + accent dérivé)

**Files:**
- Create: `packages/shared/src/appearance/appearance.ts`
- Create (test): `packages/shared/src/appearance/appearance.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `type AppearanceTheme = 'warm' | 'cool' | 'dark'`
  - `const APPEARANCE_THEMES: AppearanceTheme[]`
  - `interface Appearance { theme?: AppearanceTheme; accent?: string }`
  - `interface AccentVars { accent: string; hover: string; soft: string }`
  - `function isHexColor(s: string): boolean`
  - `function deriveAccent(hex: string): AccentVars` — `hover` ≈ −12 % luminosité, `soft` ≈ mélange 88 % blanc.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/appearance/appearance.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveAccent, isHexColor, APPEARANCE_THEMES } from './appearance';

describe('isHexColor', () => {
  it('accepts #rgb and #rrggbb', () => {
    expect(isHexColor('#f1700f')).toBe(true);
    expect(isHexColor('#abc')).toBe(true);
  });
  it('rejects junk', () => {
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#12')).toBe(false);
    expect(isHexColor('#gggggg')).toBe(false);
    expect(isHexColor('')).toBe(false);
  });
});

describe('deriveAccent', () => {
  it('returns three valid hex colors', () => {
    const v = deriveAccent('#f1700f');
    expect(v.accent.toLowerCase()).toBe('#f1700f');
    expect(isHexColor(v.hover)).toBe(true);
    expect(isHexColor(v.soft)).toBe(true);
  });
  it('hover is darker than accent and soft is lighter', () => {
    const lum = (h: string) => {
      const n = h.replace('#', '');
      return parseInt(n.slice(0, 2), 16) + parseInt(n.slice(2, 4), 16) + parseInt(n.slice(4, 6), 16);
    };
    const v = deriveAccent('#3366cc');
    expect(lum(v.hover)).toBeLessThan(lum('#3366cc'));
    expect(lum(v.soft)).toBeGreaterThan(lum('#3366cc'));
  });
  it('normalizes #rgb to #rrggbb', () => {
    expect(deriveAccent('#abc').accent).toBe('#aabbcc');
  });
});

describe('APPEARANCE_THEMES', () => {
  it('lists warm/cool/dark', () => {
    expect(APPEARANCE_THEMES).toEqual(['warm', 'cool', 'dark']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pulsar/shared test`
Expected: FAIL (`./appearance` introuvable).

- [ ] **Step 3: Implement `packages/shared/src/appearance/appearance.ts`**

```ts
export type AppearanceTheme = 'warm' | 'cool' | 'dark';
export const APPEARANCE_THEMES: AppearanceTheme[] = ['warm', 'cool', 'dark'];

export interface Appearance {
  theme?: AppearanceTheme;
  accent?: string; // hex
}

export interface AccentVars {
  accent: string;
  hover: string;
  soft: string;
}

export function isHexColor(s: string): boolean {
  return typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

function normalize(hex: string): string {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  return '#' + full.toLowerCase();
}

function toRgb(hex: string): [number, number, number] {
  const n = normalize(hex).slice(1);
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Accent override: hover ≈ 12% darker, soft ≈ 88% white tint. */
export function deriveAccent(hex: string): AccentVars {
  const [r, g, b] = toRgb(hex);
  const hover = toHex(r * 0.88, g * 0.88, b * 0.88);
  const mix = 0.88; // share of white
  const soft = toHex(
    r * (1 - mix) + 255 * mix,
    g * (1 - mix) + 255 * mix,
    b * (1 - mix) + 255 * mix,
  );
  return { accent: normalize(hex), hover, soft };
}
```

- [ ] **Step 4: Export from `packages/shared/src/index.ts`**

Ajouter après la ligne `export * from './desk/desk-layout';` :

```ts
export * from './appearance/appearance';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @pulsar/shared test`
Expected: PASS.

- [ ] **Step 6: Build shared & commit**

```bash
pnpm --filter @pulsar/shared build
git add packages/shared/src/appearance packages/shared/src/index.ts
git commit -m "feat(shared): appearance model — theme + deriveAccent helper (tested)"
```

---

## Task 3: BD + API — champ `appearance` sur les préférences

**Files:**
- Modify: `packages/database/prisma/schema.prisma:146-155`
- Modify: `apps/api/src/core/preferences/dto/desk-layout.dto.ts`
- Modify: `apps/api/src/core/preferences/preferences.service.ts`
- Modify: `apps/api/src/core/preferences/preferences.controller.ts`

**Interfaces:**
- Consumes: `Appearance`, `DeskBackground`, `DeskTileSize` (Task 1/2).
- Produces:
  - `PreferencesService.get(userId): Promise<{ deskLayout: unknown; appearance: unknown }>`
  - `PreferencesService.update(userId, { deskLayout?, appearance? }): Promise<{ deskLayout; appearance }>`
  - `UpdatePreferencesDto { deskLayout?: DeskLayoutDto; appearance?: AppearanceDto }`

- [ ] **Step 1: Add the Prisma column**

Dans `packages/database/prisma/schema.prisma`, modèle `UserPreferences`, après `deskLayout Json @default("{}")` :

```prisma
  appearance Json?
```

- [ ] **Step 2: Migrate & regenerate**

Run (postgres doit tourner : `pnpm db:up`) :
```bash
pnpm db:migrate --name user_preferences_appearance
pnpm --filter @pulsar/database build
```
Expected: nouvelle migration créée et appliquée, client régénéré.

- [ ] **Step 3: Extend the DTO**

Remplacer `apps/api/src/core/preferences/dto/desk-layout.dto.ts` par :

```ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsHexColor,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class DeskBackgroundDto {
  @IsIn(['color', 'gradient', 'image'])
  type!: string;

  @IsString()
  value!: string;
}

export class DeskLayoutDto {
  @IsInt()
  version!: number;

  @IsOptional()
  @IsIn(['auto', 'free', 'reorder'])
  mode?: string;

  @IsArray()
  items!: Record<string, unknown>[];

  @IsOptional()
  @IsIn(['sm', 'md', 'lg'])
  tileSize?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeskBackgroundDto)
  background?: DeskBackgroundDto;
}

export class AppearanceDto {
  @IsOptional()
  @IsIn(['warm', 'cool', 'dark'])
  theme?: string;

  @IsOptional()
  @IsHexColor()
  accent?: string;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeskLayoutDto)
  deskLayout?: DeskLayoutDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AppearanceDto)
  appearance?: AppearanceDto;
}
```

> Note: `@IsObject` importé pour cohérence si besoin futur ; retirer s'il déclenche un lint d'import inutilisé.
> Retirer `IsObject` de l'import s'il n'est pas utilisé (il ne l'est pas ici).

- [ ] **Step 4: Update the service**

Remplacer `apps/api/src/core/preferences/preferences.service.ts` par :

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<{ deskLayout: unknown; appearance: unknown }> {
    const row = await this.prisma.userPreferences.findUnique({ where: { userId } });
    return { deskLayout: row?.deskLayout ?? {}, appearance: row?.appearance ?? {} };
  }

  async update(
    userId: string,
    patch: { deskLayout?: unknown; appearance?: unknown },
  ): Promise<{ deskLayout: unknown; appearance: unknown }> {
    const data: Prisma.UserPreferencesUpdateInput = {};
    if (patch.deskLayout !== undefined) data.deskLayout = patch.deskLayout as Prisma.InputJsonValue;
    if (patch.appearance !== undefined) data.appearance = patch.appearance as Prisma.InputJsonValue;

    const row = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        deskLayout: (patch.deskLayout ?? {}) as Prisma.InputJsonValue,
        appearance: (patch.appearance ?? {}) as Prisma.InputJsonValue,
      },
      update: data,
    });
    return { deskLayout: row.deskLayout, appearance: row.appearance ?? {} };
  }
}
```

- [ ] **Step 5: Update the controller**

Dans `apps/api/src/core/preferences/preferences.controller.ts`, remplacer la méthode `update` :

```ts
  @Put()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return this.preferences.update(user.id, {
      deskLayout: dto.deskLayout,
      appearance: dto.appearance,
    });
  }
```

- [ ] **Step 6: Typecheck & verify endpoint**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: PASS.

Vérification manuelle (API + DB up) — un PUT avec `appearance` ne doit plus renvoyer 400 :
```bash
# (token = un accessToken valide ; admin@pulsar.dev / admin123)
curl -s -X PUT http://localhost:3000/api/v1/me/preferences \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"appearance":{"theme":"dark","accent":"#3366cc"}}' | head
```
Expected: 200 avec `{"deskLayout":...,"appearance":{"theme":"dark","accent":"#3366cc"}}`.

- [ ] **Step 7: Commit**

```bash
git add packages/database apps/api/src/core/preferences
git commit -m "feat(api): UserPreferences.appearance (theme+accent) on GET/PUT /me/preferences"
```

---

## Task 4: Web — store apparence + boot anti-flash + chargement BD

**Files:**
- Modify: `apps/web/src/app.html`
- Create: `apps/web/src/lib/stores/appearance.ts`
- Modify: `apps/web/src/lib/api/preferences.ts`
- Modify: `apps/web/src/routes/(app)/+layout.svelte`

**Interfaces:**
- Consumes: `Appearance`, `AppearanceTheme`, `deriveAccent`, `isHexColor` (Task 2).
- Produces:
  - `apps/web/src/lib/api/preferences.ts` : `getPreferences(): Promise<{ deskLayout: unknown; appearance: unknown }>`, `putPreferences(patch: { deskLayout?: DeskLayout; appearance?: Appearance }): Promise<...>`, garde `putDeskLayout` (wrapper).
  - `apps/web/src/lib/stores/appearance.ts` : store `appearance` (`Writable<Appearance>`), `applyAppearance(a: Appearance)`, `setTheme(t)`, `setAccent(hex|null)`, `loadAppearanceFrom(a: unknown)`.

- [ ] **Step 1: Extend the boot script in `app.html`**

Remplacer le `<script>` du `<head>` par :

```html
    <script>
      // Apply saved theme + accent before first paint (no flash of the default).
      try {
        var t = localStorage.getItem('pulsar.theme');
        document.documentElement.dataset.theme = t === 'cool' || t === 'dark' ? t : 'warm';
        var a = localStorage.getItem('pulsar.accent');
        if (a && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(a)) {
          document.documentElement.style.setProperty('--t-accent', a);
        }
      } catch (e) {
        document.documentElement.dataset.theme = 'warm';
      }
    </script>
```

> Le hover/soft dérivés sont posés par le store au montage (Step 2) ; l'accent brut suffit pour éviter le flash.

- [ ] **Step 2: Create `apps/web/src/lib/stores/appearance.ts`**

```ts
import { writable } from 'svelte/store';
import {
  deriveAccent,
  isHexColor,
  type Appearance,
  type AppearanceTheme,
} from '@pulsar/shared';
import { putPreferences } from '$lib/api/preferences';

const THEME_KEY = 'pulsar.theme';
const ACCENT_KEY = 'pulsar.accent';

function readInitial(): Appearance {
  if (typeof localStorage === 'undefined') return { theme: 'warm' };
  const t = localStorage.getItem(THEME_KEY);
  const accent = localStorage.getItem(ACCENT_KEY) ?? undefined;
  const theme: AppearanceTheme = t === 'cool' || t === 'dark' ? t : 'warm';
  return { theme, ...(accent && isHexColor(accent) ? { accent } : {}) };
}

export const appearance = writable<Appearance>(readInitial());

/** Apply theme + accent vars to <html>. */
export function applyAppearance(a: Appearance) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = a.theme ?? 'warm';
  if (a.accent && isHexColor(a.accent)) {
    const v = deriveAccent(a.accent);
    root.style.setProperty('--t-accent', v.accent);
    root.style.setProperty('--t-accent-hover', v.hover);
    root.style.setProperty('--t-accent-soft', v.soft);
  } else {
    root.style.removeProperty('--t-accent');
    root.style.removeProperty('--t-accent-hover');
    root.style.removeProperty('--t-accent-soft');
  }
}

function cache(a: Appearance) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(THEME_KEY, a.theme ?? 'warm');
  if (a.accent && isHexColor(a.accent)) localStorage.setItem(ACCENT_KEY, a.accent);
  else localStorage.removeItem(ACCENT_KEY);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(a: Appearance) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void putPreferences({ appearance: a }).catch(() => {});
  }, 400);
}

function commit(next: Appearance) {
  appearance.set(next);
  applyAppearance(next);
  cache(next);
  persist(next);
}

export function setTheme(theme: AppearanceTheme) {
  appearance.update((a) => {
    const next = { ...a, theme };
    applyAppearance(next);
    cache(next);
    persist(next);
    return next;
  });
}

export function setAccent(accent: string | null) {
  appearance.update((a) => {
    const next: Appearance = { ...a };
    if (accent && isHexColor(accent)) next.accent = accent;
    else delete next.accent;
    applyAppearance(next);
    cache(next);
    persist(next);
    return next;
  });
}

/** Reconcile from the DB after auth/prefs load (source of truth), refresh cache + DOM. */
export function loadAppearanceFrom(raw: unknown) {
  const r = (raw ?? {}) as Partial<Appearance>;
  const theme: AppearanceTheme =
    r.theme === 'cool' || r.theme === 'dark' || r.theme === 'warm' ? r.theme : 'warm';
  const next: Appearance = {
    theme,
    ...(r.accent && isHexColor(r.accent) ? { accent: r.accent } : {}),
  };
  appearance.set(next);
  applyAppearance(next);
  cache(next);
}
```

> `commit` n'est pas exporté ; il existe si on veut factoriser plus tard. Si le lint signale `commit` inutilisé, le supprimer.
> Supprimer la fonction `commit` (non utilisée) pour éviter l'avertissement.

- [ ] **Step 3: Update `apps/web/src/lib/api/preferences.ts`**

```ts
import { api } from '$lib/api/client';
import type { Appearance, DeskLayout } from '@pulsar/shared';

export function getPreferences() {
  return api<{ deskLayout: unknown; appearance: unknown }>('/me/preferences');
}

export function putPreferences(patch: { deskLayout?: DeskLayout; appearance?: Appearance }) {
  return api<{ deskLayout: unknown; appearance: unknown }>('/me/preferences', {
    method: 'PUT',
    body: patch,
  });
}

export function putDeskLayout(deskLayout: DeskLayout) {
  return putPreferences({ deskLayout });
}
```

- [ ] **Step 4: Load appearance from DB on app mount**

Dans `apps/web/src/routes/(app)/+layout.svelte`, ajouter dans le `<script>` (avec les autres imports) :

```ts
  import { onMount } from 'svelte';
  import { getPreferences } from '$lib/api/preferences';
  import { loadAppearanceFrom } from '$lib/stores/appearance';
```

et un effet de montage :

```ts
  onMount(() => {
    void getPreferences()
      .then((p) => loadAppearanceFrom(p.appearance))
      .catch(() => {});
  });
```

> Si `onMount` est déjà importé, ne pas le redoublonner. Le `/apps` fait son propre `getPreferences` pour le layout du Desk — deux GET légers, acceptable ; ne pas chercher à mutualiser maintenant (YAGNI).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Démarrer (`pnpm dev`), se connecter. Dans la console : `localStorage.setItem('pulsar.accent','#3366cc'); location.reload()` → l'accent bleu doit être appliqué **avant** le rendu (pas de flash orange). Retirer la clé → reload → retour à l'accent du thème.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app.html apps/web/src/lib/stores/appearance.ts apps/web/src/lib/api/preferences.ts "apps/web/src/routes/(app)/+layout.svelte"
git commit -m "feat(web): appearance store — theme+accent persisted to DB, boot anti-flash"
```

---

## Task 5: Web — Réglages › Apparence : sélecteur d'accent

**Files:**
- Modify: `apps/web/src/routes/(app)/settings/appearance/+page.svelte`

**Interfaces:**
- Consumes: `appearance` store, `setTheme`, `setAccent` (Task 4); `theme` store retiré au profit de `appearance`.

- [ ] **Step 1: Rewrite the appearance page (theme via new store + accent picker)**

Remplacer `apps/web/src/routes/(app)/settings/appearance/+page.svelte` par :

```svelte
<script lang="ts">
  import { PageHeader, Card } from '$lib/components/ui';
  import { appearance, setTheme, setAccent } from '$lib/stores/appearance';
  import { APPEARANCE_THEMES, type AppearanceTheme } from '@pulsar/shared';

  const THEME_META: Record<AppearanceTheme, { label: string; hint: string; bg: string; surface: string; accent: string; ink: string }> = {
    warm: { label: 'Chaud', hint: 'Orange & crème (défaut)', bg: '#faf6f0', surface: '#ffffff', accent: '#f1700f', ink: '#221913' },
    cool: { label: 'Ardoise', hint: 'Bleu & gris froid', bg: '#f1f5f9', surface: '#ffffff', accent: '#2150d4', ink: '#0f172a' },
    dark: { label: 'Nuit', hint: 'Sombre chaud', bg: '#17130f', surface: '#211b16', accent: '#f1700f', ink: '#f4ede4' },
  };

  const PRESET_ACCENTS = ['#f1700f', '#2150d4', '#0f766e', '#be123c', '#7e22ce', '#0ea5e9'];

  let accentInput = $state($appearance.accent ?? '#f1700f');
</script>

<PageHeader title="Apparence" />

<Card>
  <h2 class="text-sm font-bold text-ink">Thème</h2>
  <p class="mt-0.5 mb-4 text-sm text-ink-muted">Change l'apparence de toute l'interface. Enregistré sur ton compte.</p>

  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each APPEARANCE_THEMES as id (id)}
      {@const active = ($appearance.theme ?? 'warm') === id}
      {@const s = THEME_META[id]}
      <button type="button" onclick={() => setTheme(id)} aria-pressed={active}
        class={`rounded-card border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-card ${active ? 'border-accent ring-2 ring-accent/40' : 'border-edge-soft shadow-sm'}`}>
        <div class="flex h-16 overflow-hidden rounded-inner border border-edge-soft" style={`background:${s.bg}`}>
          <div class="w-1/4" style={`background:${s.accent}`}></div>
          <div class="flex-1 p-2">
            <div class="h-2 w-2/3 rounded-full" style={`background:${s.ink};opacity:.85`}></div>
            <div class="mt-1.5 h-5 rounded" style={`background:${s.surface};border:1px solid rgba(0,0,0,.06)`}></div>
          </div>
        </div>
        <div class="mt-2.5 flex items-center justify-between">
          <span class="text-sm font-semibold text-ink">{s.label}</span>
          {#if active}<span class="text-xs font-semibold text-accent">Actif</span>{/if}
        </div>
        <div class="text-xs text-ink-muted">{s.hint}</div>
      </button>
    {/each}
  </div>
</Card>

<Card class="mt-4">
  <h2 class="text-sm font-bold text-ink">Couleur d'accent</h2>
  <p class="mt-0.5 mb-4 text-sm text-ink-muted">Personnalise la couleur principale, appliquée par-dessus le thème.</p>

  <div class="flex flex-wrap items-center gap-3">
    {#each PRESET_ACCENTS as c (c)}
      <button type="button" aria-label={`Accent ${c}`} onclick={() => { accentInput = c; setAccent(c); }}
        class={`size-8 rounded-full ring-2 transition ${($appearance.accent ?? '') === c ? 'ring-ink' : 'ring-transparent hover:ring-edge'}`}
        style={`background:${c}`}></button>
    {/each}

    <label class="ml-1 inline-flex items-center gap-2 text-sm text-ink-muted">
      Perso
      <input type="color" bind:value={accentInput} onchange={() => setAccent(accentInput)}
        class="size-8 cursor-pointer rounded border border-edge bg-transparent" />
    </label>

    {#if $appearance.accent}
      <button type="button" onclick={() => setAccent(null)}
        class="rounded-full border border-edge px-3 py-1 text-sm text-ink-faint transition hover:text-ink">
        Réinitialiser
      </button>
    {/if}
  </div>
</Card>
```

> Le bloc « Fond du Desk + wallpaper » est ajouté à cette page en Task 11.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: PASS (plus aucune référence à `$lib/stores/theme`).

- [ ] **Step 3: Manual verification**

`/settings/appearance` : changer de thème (persiste, recharge sans flash) ; choisir un accent preset puis perso → l'UI change immédiatement (boutons, liens actifs). Reload → conservé. « Réinitialiser » → retour à l'accent du thème.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/settings/appearance/+page.svelte"
git commit -m "feat(web): appearance settings — theme via DB store + custom accent picker"
```

---

## Task 6: Web — Desk board centré borné

**Files:**
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`

**Interfaces:**
- Consumes: `DESK_CANVAS_W`, `TILE_SIZES` (Task 1).
- Produces: board `relative mx-auto` de largeur `DESK_CANVAS_W` partagé par les 3 modes ; `clampX/clampY` bornent au board.

- [ ] **Step 1: Wrap the canvas in a centered bounded board**

Dans `apps/web/src/routes/(app)/apps/+page.svelte`, le conteneur `<div class="relative w-full" bind:clientWidth=... style="min-height: calc(100vh - 7rem)">` (ligne ~448) : remplacer par un board centré de largeur fixe.

```svelte
    <div
      class="relative mx-auto"
      bind:clientWidth={canvasW}
      bind:clientHeight={canvasH}
      style={`width:min(100%, ${DESK_CANVAS_W}px); min-height: calc(100vh - 9rem)`}
    >
```

Importer `DESK_CANVAS_W` est déjà fait (ligne 9 importe `DESK_CANVAS_W`).

- [ ] **Step 2: Center the auto/reorder grid inside the board**

La grille auto+reorder (`<div class="flex flex-wrap gap-x-10 gap-y-11 px-2 py-4">`, ligne ~468) : ajouter le centrage.

```svelte
        <div class="flex flex-wrap justify-center gap-x-10 gap-y-11 px-2 py-4">
```

- [ ] **Step 3: Clamp free positions to the board width**

`clampX` utilise déjà `canvasW || DESK_CANVAS_W` ; comme le board fait désormais `min(100%, DESK_CANVAS_W)`, `canvasW` reflète la vraie largeur du board → le clamp borne au board. Aucune modif de `clampX`. Pour `clampY`, garder la borne basse à 0 (le board est déjà sous la top-bar via `py-14` de la section) :

Vérifier que `clampX`/`clampY` (lignes ~131-139) restent :

```ts
  function clampX(x: number) {
    const w = canvasW || DESK_CANVAS_W;
    return Math.max(0, Math.min(x, w - DESK_TILE));
  }
  function clampY(y: number) {
    const h = canvasH || 600;
    return Math.max(0, Math.min(y, h - DESK_TILE));
  }
```

> `DESK_TILE` sera remplacé par la taille effective en Task 10 ; ne pas y toucher ici.

- [ ] **Step 4: Typecheck & verify**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: PASS.

Manuel : `/apps` — en mode auto et réordonnable les tuiles sont centrées ; en mode libre, glisser une tuile tout à droite/haut : elle reste dans le board (largeur ≈772 px centré) et ne passe plus sous la barre.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(app)/apps/+page.svelte"
git commit -m "feat(web): desk centered bounded board across all modes (#1, #5)"
```

---

## Task 7: Web — Fix « reset au retour d'un module »

**Files:**
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte:34-59,71-77`

**Interfaces:**
- Consumes: `reconcileDeskLayout` (préserve désormais positions/fond/tailles depuis le layout courant).
- Produces: re-réconciliation idempotente qui ne détruit plus les positions live.

- [ ] **Step 1: Guard the re-reconcile effect by module-key signature, reconcile from current layout**

Remplacer les deux `$effect` (lignes ~34-59) par :

```ts
  // Fetch preferences once; reconcile against current domains.
  $effect(() => {
    if (fetchedOnce) return;
    fetchedOnce = true;
    const snap = domains;
    void (async () => {
      try {
        const res = await getPreferences();
        rawSaved = res.deskLayout;
        layout = reconcileDeskLayout(res.deskLayout, snap);
      } catch {
        layout = defaultDeskLayout(snap);
      } finally {
        loaded = true;
      }
    })();
  });

  // When the set of visible modules actually changes (module toggled / perms refreshed),
  // reconcile from the CURRENT layout so live positions/folders/background are preserved.
  let lastDomainSig = $state('');
  $effect(() => {
    if (!loaded) return;
    const sig = domains.map((d) => d.key).sort().join('|');
    if (sig === lastDomainSig) return;
    lastDomainSig = sig;
    layout = reconcileDeskLayout(layout, domains);
  });
```

- [ ] **Step 2: Keep `rawSaved` in sync on persist**

Dans `persist()` (ligne ~71), capturer le layout courant dans `rawSaved` au moment de planifier la sauvegarde :

```ts
  function persist() {
    if (!loaded) return;
    rawSaved = layout;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void putDeskLayout(layout).catch(() => toast.error('Échec de la sauvegarde du bureau'));
    }, 500);
  }
```

- [ ] **Step 3: Initialize `lastDomainSig` after first load**

Pour éviter une réconciliation superflue juste après le fetch initial, dans le bloc `finally` du premier effet, après `loaded = true;` ajouter :

```ts
        loaded = true;
        lastDomainSig = snap.map((d) => d.key).sort().join('|');
```

(déclarer `lastDomainSig` avant le premier effet si l'ordre des déclarations l'exige ; en Svelte 5 `$state` est hoisté au scope du module d'instance, l'ordre n'empêche pas la compilation, mais placer la déclaration au-dessus du premier `$effect` est plus clair.)

- [ ] **Step 4: Typecheck & verify**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: PASS.

Manuel (cœur du bug #2) : `/apps`, mode **Libre**, déplacer 2-3 tuiles, attendre 1 s (sauvegarde), ouvrir un module via une tuile, revenir en arrière (← navigateur) → **les positions sont conservées**. Refaire sans attendre (navigation rapide) → conservé aussi (flush onDestroy).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(app)/apps/+page.svelte"
git commit -m "fix(web): desk free layout no longer resets on module navigation (#2)"
```

---

## Task 8: Web — « Personnaliser le bureau » dans le dossier Framework

**Files:**
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte:514-539`

**Interfaces:**
- Consumes: `editing` state, `enterEditMode()` existant, `closeFolder()`.

- [ ] **Step 1: Add the "Personnaliser le bureau" action to the Framework folder footer**

Dans le `{#snippet footer()}` du `FolderOverlay` (le bloc `{#if openFolder.id === FRAMEWORK_FOLDER_ID}`, ligne ~515), ajouter un bouton en tête des actions :

```svelte
        <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            class="rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-faint transition hover:border-accent hover:text-ink"
            onclick={() => { enterEditMode(); closeFolder(); }}
          >
            Personnaliser le bureau
          </button>
          <button
            type="button"
            class="rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-faint transition hover:border-accent hover:text-ink"
            onclick={() => { editing = true; closeFolder(); }}
          >
            Gérer les liens rapides
          </button>
          <button
            type="button"
            class="rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-faint transition hover:border-red-400 hover:text-red-600"
            onclick={() => {
              if (confirm('Réinitialiser la disposition du bureau ?')) {
                layout = defaultDeskLayout(domains);
                persist();
                closeFolder();
              }
            }}
          >
            Réinitialiser la disposition
          </button>
        </div>
```

> `enterEditMode()` réinitialise la recherche et passe `editing = true` ; « Gérer les liens rapides » reste pour entrer directement en édition orientée liens (comportement existant conservé).

- [ ] **Step 2: Typecheck & verify**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: PASS.

Manuel : ouvrir le dossier **Framework** (hors mode édition) → le bouton « Personnaliser le bureau » entre en mode édition et ferme le dossier. Si le dossier avait disparu, il est revenu (Task 1 — vérifier en réinitialisant puis en supprimant le dossier, recharger : il réapparaît).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/routes/(app)/apps/+page.svelte"
git commit -m "feat(web): 'Personnaliser le bureau' action inside Framework folder (#3)"
```

---

## Task 9: Web — menu contextuel sur l'espace vide du board

**Files:**
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`

**Interfaces:**
- Consumes: `menuOpen/menuX/menuY/menuActions`, `makeEmptyFolder()`, `addLinkOpen` (existants).
- Produces: `openCanvasMenu(e: MouseEvent)`.

- [ ] **Step 1: Add an empty-board context-menu handler**

Après `openMenu` (ligne ~313), ajouter :

```ts
  function openCanvasMenu(e: MouseEvent) {
    // Only when the click target is the board itself (not a tile).
    if ((e.target as HTMLElement)?.closest('[data-desk-id]')) return;
    e.preventDefault();
    menuX = e.clientX;
    menuY = e.clientY;
    menuActions = [
      { label: 'Nouveau dossier', run: () => makeEmptyFolder() },
      { label: 'Ajouter un lien rapide', run: () => (addLinkOpen = true) },
    ];
    menuOpen = true;
  }
```

- [ ] **Step 2: Wire it on the board container**

Sur le board (`<div class="relative mx-auto" ...>` de Task 6), ajouter `oncontextmenu={openCanvasMenu}` :

```svelte
    <div
      class="relative mx-auto"
      bind:clientWidth={canvasW}
      bind:clientHeight={canvasH}
      oncontextmenu={openCanvasMenu}
      style={`width:min(100%, ${DESK_CANVAS_W}px); min-height: calc(100vh - 9rem)`}
    >
```

> Les tuiles ont déjà `oncontextmenu` (via `DeskIcon`/`DeskFolderTile`) qui ouvre leur propre menu ; le garde `closest('[data-desk-id]')` évite le double-déclenchement. L'event des tuiles n'appelle pas `stopPropagation`, donc on s'appuie sur le garde de cible.

- [ ] **Step 3: Typecheck & verify**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: PASS.

Manuel : clic-droit sur une zone **vide** du board → menu « Nouveau dossier » / « Ajouter un lien rapide ». « Ajouter un lien rapide » ouvre le picker qui liste les **sous-pages de modules** (ex. `Transport › Expéditions`). Clic-droit sur une **tuile** → menu de la tuile (inchangé), pas de doublon.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/apps/+page.svelte"
git commit -m "feat(web): right-click empty desk board opens add-folder/add-link menu (#4)"
```

---

## Task 10: Web — taille des tuiles (S/M/L)

**Files:**
- Modify: `apps/web/src/lib/components/desk/DeskIcon.svelte`
- Modify: `apps/web/src/lib/components/desk/DeskFolderTile.svelte`
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`

**Interfaces:**
- Consumes: `TILE_SIZES`, `DeskTileSize` (Task 1).
- Produces: `DeskIcon`/`DeskFolderTile` acceptent `size?: number` (px, défaut 96) ; sélecteur de taille en mode édition ; `clampX/clampY`/`defaultPosition` utilisent la taille effective.

- [ ] **Step 1: Parametrize `DeskIcon` by size**

Remplacer `apps/web/src/lib/components/desk/DeskIcon.svelte` par :

```svelte
<script lang="ts">
  import type { ComponentType } from 'svelte';
  let {
    label, icon, accent = '#6f7480', editing = false, size = 96,
    onactivate = undefined as (() => void) | undefined,
    onremove = undefined as (() => void) | undefined,
    oncontext = undefined as ((e: MouseEvent) => void) | undefined,
  } = $props<{
    label: string; icon: ComponentType; accent?: string; editing?: boolean; size?: number;
    onactivate?: () => void; onremove?: () => void; oncontext?: (e: MouseEvent) => void;
  }>();
  const Icon = $derived(icon);
  const box = $derived(Math.round(size * 0.58)); // icon square
  const glyph = $derived(Math.round(size * 0.29));
</script>

<button
  type="button"
  class="group relative flex flex-col items-center text-center outline-none {editing ? 'animate-[wiggle_0.3s_ease-in-out_infinite] motion-reduce:animate-none' : ''}"
  style={`width:${size}px`}
  onclick={() => onactivate?.()}
  oncontextmenu={(e) => oncontext?.(e)}
  aria-label={label}
>
  {#if editing && onremove}
    <span role="button" tabindex="0"
      class="absolute -top-1 left-5 z-10 grid size-5 place-items-center rounded-full bg-ink text-xs text-white shadow"
      onclick={(e) => { e.stopPropagation(); onremove?.(); }}
      onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onremove?.(); } }}
      aria-label={`Retirer ${label}`}>×</span>
  {/if}
  <span class="grid place-items-center rounded-2xl text-white shadow-sm ring-1 ring-black/5 transition duration-150 group-hover:-translate-y-1 group-hover:shadow-md"
    style={`width:${box}px;height:${box}px;background:${accent}`}>
    <Icon style={`width:${glyph}px;height:${glyph}px`} strokeWidth={2.15} />
  </span>
  <span class="mt-3 line-clamp-2 text-sm font-semibold leading-tight text-ink group-hover:text-accent">{label}</span>
</button>
```

- [ ] **Step 2: Parametrize `DeskFolderTile` by size**

Remplacer `apps/web/src/lib/components/desk/DeskFolderTile.svelte` par :

```svelte
<script lang="ts">
  let { name, editing = false, size = 96, onopen, onremove = undefined, oncontext = undefined } =
    $props<{ name: string; editing?: boolean; size?: number; onopen: () => void; onremove?: () => void; oncontext?: (e: MouseEvent) => void }>();
  const box = $derived(Math.round(size * 0.58));
</script>

<button type="button"
  class="group relative flex flex-col items-center text-center outline-none {editing ? 'animate-[wiggle_0.3s_ease-in-out_infinite] motion-reduce:animate-none' : ''}"
  style={`width:${size}px`}
  onclick={() => onopen()} oncontextmenu={(e) => oncontext?.(e)} aria-label={`Ouvrir le dossier ${name}`}>
  {#if editing && onremove}
    <span role="button" tabindex="0" class="absolute -top-1 left-5 z-10 grid size-5 place-items-center rounded-full bg-ink text-xs text-white shadow"
      onclick={(e) => { e.stopPropagation(); onremove?.(); }} onkeydown={(e) => { if (e.key === 'Enter') onremove?.(); }} aria-label={`Retirer ${name}`}>×</span>
  {/if}
  <span class="grid place-items-center rounded-2xl bg-[#737985]/15 p-2 ring-1 ring-black/5 transition duration-150 group-hover:-translate-y-1"
    style={`width:${box}px;height:${box}px`}>
    <span class="grid size-full grid-cols-2 grid-rows-2 gap-1">
      {#each Array(4) as _, i (i)}<span class="rounded-md bg-[#737985]/50"></span>{/each}
    </span>
  </span>
  <span class="mt-3 line-clamp-2 text-sm font-semibold leading-tight text-ink group-hover:text-accent">{name}</span>
</button>
```

- [ ] **Step 3: Thread the effective tile size in `+page.svelte`**

Importer `TILE_SIZES` et `type DeskTileSize` (étendre l'import ligne 9-10) :

```ts
  import { defaultDeskLayout, reconcileDeskLayout, FRAMEWORK_FOLDER_ID, DESK_CANVAS_W, DESK_TILE, defaultPosition, DESK_MODES, TILE_SIZES } from '@pulsar/shared';
  import type { DeskLayout, DeskItem, DeskFolderChild, DeskTileSize } from '@pulsar/shared';
```

Ajouter un dérivé pour la taille effective (après la déclaration de `layout`, ~ligne 28) :

```ts
  const tilePx = $derived(TILE_SIZES[(layout.tileSize ?? 'md') as DeskTileSize]);
```

Mettre à jour `clampX`/`clampY` pour utiliser `tilePx` au lieu de `DESK_TILE` :

```ts
  function clampX(x: number) {
    const w = canvasW || DESK_CANVAS_W;
    return Math.max(0, Math.min(x, w - tilePx));
  }
  function clampY(y: number) {
    const h = canvasH || 600;
    return Math.max(0, Math.min(y, h - tilePx));
  }
```

Passer `size={tilePx}` à chaque rendu de tuile dans le `{#snippet tile(item)}` (les 3 cas `DeskIcon` module/lien et `DeskFolderTile`). Exemple module :

```svelte
      <DeskIcon label={domain.label} icon={domain.icon} accent={universe.accent} {editing} size={tilePx}
        onactivate={() => { if (!suppressClick && !editing) goto(domain.home); }}
        onremove={() => removeItem(item)} oncontext={(e) => openMenu(e, item)} />
```

(idem pour le cas `link` : `size={tilePx}` ; et `DeskFolderTile` : `size={tilePx}`.)

- [ ] **Step 4: Add the size selector in edit mode**

Dans la barre d'édition (le bloc `{#if editing}` ligne ~409, à côté du sélecteur de mode), ajouter un sélecteur S/M/L :

```svelte
          <div class="inline-flex items-center gap-1 rounded-md border border-edge bg-surface p-0.5">
            {#each (['sm','md','lg'] as DeskTileSize[]) as sz (sz)}
              <button type="button"
                class={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${(layout.tileSize ?? 'md') === sz ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}
                onclick={() => { layout = { ...layout, tileSize: sz }; persist(); }}
              >{sz === 'sm' ? 'S' : sz === 'md' ? 'M' : 'L'}</button>
            {/each}
          </div>
```

- [ ] **Step 5: Typecheck & verify**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: PASS.

Manuel : mode édition → cliquer S/M/L : les tuiles changent de taille immédiatement et la valeur persiste (reload). En mode libre, le drag reste borné au board avec la nouvelle taille.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/lib/components/desk/DeskIcon.svelte" "apps/web/src/lib/components/desk/DeskFolderTile.svelte" "apps/web/src/routes/(app)/apps/+page.svelte"
git commit -m "feat(web): desk tile size S/M/L (76/96/120) persisted"
```

---

## Task 11: Web — fond du Desk (couleur / dégradé / image uploadée)

**Files:**
- Create: `apps/web/src/lib/api/files.ts`
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`
- Modify: `apps/web/src/routes/(app)/settings/appearance/+page.svelte`

**Interfaces:**
- Consumes: `DeskBackground`, `DESK_GRADIENTS`, `getAccessToken` (auth store), `DocumentsService` upload endpoint, `putDeskLayout`.
- Produces:
  - `apps/web/src/lib/api/files.ts` : `uploadDocument(file: File, entityType: string, entityId: string): Promise<{ id: string }>`, `fetchDocumentObjectUrl(id: string): Promise<string>`.

- [ ] **Step 1: Create authenticated file helpers**

Create `apps/web/src/lib/api/files.ts`:

```ts
import { getAccessToken } from '$lib/stores/auth';

const BASE = '/api/v1';

/** Multipart upload via DocumentsService. Returns the created document. */
export async function uploadDocument(
  file: File,
  entityType: string,
  entityId: string,
): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('entityType', entityType);
  fd.append('entityId', entityId);
  const token = getAccessToken();
  const res = await fetch(`${BASE}/documents/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return (await res.json()) as { id: string };
}

/** Authenticated GET of a document's bytes → blob object URL (usable in CSS). */
export async function fetchDocumentObjectUrl(id: string): Promise<string> {
  const token = getAccessToken();
  const res = await fetch(`${BASE}/documents/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
```

- [ ] **Step 2: Render the desk background in `+page.svelte`**

Imports (étendre ligne 9) : ajouter `DESK_GRADIENTS` et `type DeskBackground`.

```ts
  import { defaultDeskLayout, reconcileDeskLayout, FRAMEWORK_FOLDER_ID, DESK_CANVAS_W, DESK_TILE, defaultPosition, DESK_MODES, TILE_SIZES, DESK_GRADIENTS } from '@pulsar/shared';
  import type { DeskLayout, DeskItem, DeskFolderChild, DeskTileSize, DeskBackground } from '@pulsar/shared';
  import { fetchDocumentObjectUrl } from '$lib/api/files';
```

Ajouter l'état + dérivé du style de fond et la gestion de l'object URL (après `tilePx`) :

```ts
  let bgImageUrl = $state<string | null>(null);
  let bgImageForId: string | null = null;

  // Resolve the desk-background CSS for the section.
  const bgStyle = $derived.by(() => {
    const bg = layout.background;
    if (!bg) return 'background:#f8f8f7';
    if (bg.type === 'color') return `background:${bg.value}`;
    if (bg.type === 'gradient') {
      const g = DESK_GRADIENTS.find((x) => x.id === bg.value);
      return g ? `background:${g.css}` : 'background:#f8f8f7';
    }
    if (bg.type === 'image' && bgImageUrl) {
      return `background-image:url('${bgImageUrl}');background-size:cover;background-position:center`;
    }
    return 'background:#f8f8f7';
  });

  // Fetch/refresh the image blob when an image background is selected.
  $effect(() => {
    const bg = layout.background;
    if (bg?.type === 'image') {
      if (bg.value !== bgImageForId) {
        bgImageForId = bg.value;
        void fetchDocumentObjectUrl(bg.value)
          .then((url) => {
            if (bgImageUrl) URL.revokeObjectURL(bgImageUrl);
            bgImageUrl = url;
          })
          .catch(() => { bgImageUrl = null; });
      }
    } else if (bgImageUrl) {
      URL.revokeObjectURL(bgImageUrl);
      bgImageUrl = null;
      bgImageForId = null;
    }
  });
```

Ajouter la révocation à `onDestroy` (le bloc existant ligne ~79) :

```ts
  onDestroy(() => {
    if (bgImageUrl) URL.revokeObjectURL(bgImageUrl);
    if (saveTimer) {
      clearTimeout(saveTimer);
      void putDeskLayout(layout).catch(() => {});
    }
  });
```

Appliquer le style sur la `<section>` (ligne ~400) — remplacer la classe de fond codée en dur par le style dynamique + un voile de lisibilité :

```svelte
<section class="relative min-h-[calc(100vh-3.5rem)] px-4 py-14 text-ink sm:px-8 lg:px-12" style={bgStyle}>
  {#if layout.background && layout.background.type !== 'color'}
    <div class="pointer-events-none absolute inset-0 bg-surface/35"></div>
  {/if}
  <div class="relative">
```

> Le `<div class="relative">` ouvre un wrapper qui passe au-dessus du voile ; il faut **fermer** ce `<div>` juste avant `</section>` (ajouter un `</div>` correspondant). Tout le contenu existant de la section (header + board) reste à l'intérieur.

- [ ] **Step 3: Add the background picker + upload to the appearance settings page**

Dans `apps/web/src/routes/(app)/settings/appearance/+page.svelte`, étendre le `<script>` :

```ts
  import { getPreferences, putDeskLayout } from '$lib/api/preferences';
  import { uploadDocument } from '$lib/api/files';
  import { reconcileDeskLayout, DESK_GRADIENTS, type DeskBackground, type DeskLayout } from '@pulsar/shared';
  import { onMount } from 'svelte';
  import { toast } from '$lib/stores/toast';

  let deskLayout = $state<DeskLayout | null>(null);
  let uploading = $state(false);

  onMount(() => {
    void getPreferences()
      .then((p) => { deskLayout = reconcileDeskLayout(p.deskLayout, []); })
      .catch(() => {});
  });

  function setBackground(bg: DeskBackground | null) {
    if (!deskLayout) return;
    const next = { ...deskLayout } as DeskLayout;
    if (bg) next.background = bg;
    else delete next.background;
    deskLayout = next;
    void putDeskLayout(next).catch(() => toast.error('Échec de la sauvegarde'));
  }

  async function onWallpaperChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Choisis une image'); return; }
    uploading = true;
    try {
      const doc = await uploadDocument(file, 'desk-wallpaper', 'self');
      setBackground({ type: 'image', value: doc.id });
    } catch {
      toast.error("Échec de l'upload");
    } finally {
      uploading = false;
      input.value = '';
    }
  }

  const BG_COLORS = ['#f8f8f7', '#0f172a', '#1e293b', '#fdf2e9', '#ecfeff', '#241c15'];
```

> `reconcileDeskLayout(p.deskLayout, [])` avec `[]` ne sert qu'à parser/normaliser le layout existant pour en lire/écrire `background` ; comme on renvoie le layout entier au PUT, les modules/positions ne sont pas perdus (reconcile préserve tout et ré-injecte Framework — sans domaines, les modules déjà présents restent, aucun n'est retiré car `visible` ne filtre que les modules **listés absents**… attention : voir garde ci-dessous).

> **Garde importante** : `reconcileDeskLayout(saved, [])` retirerait les items `module` (aucun module “visible”). Pour la page Apparence, **ne pas reconcilier** — lire le layout brut et n'écrire que `background`. Remplacer le `onMount` et `setBackground` par une version qui conserve le brut :

```ts
  let rawDesk = $state<DeskLayout | null>(null);

  onMount(() => {
    void getPreferences()
      .then((p) => { rawDesk = (p.deskLayout ?? { version: 1, mode: 'auto', items: [] }) as DeskLayout; })
      .catch(() => {});
  });

  function setBackground(bg: DeskBackground | null) {
    if (!rawDesk) return;
    const next = { ...rawDesk } as DeskLayout;
    if (bg) next.background = bg; else delete next.background;
    rawDesk = next;
    void putDeskLayout(next).catch(() => toast.error('Échec de la sauvegarde'));
  }
```

(supprimer les références à `deskLayout`/`reconcileDeskLayout` dans cette page ; garder `DESK_GRADIENTS`, `DeskBackground`, `DeskLayout`.)

Ajouter le bloc UI après la `Card` « Couleur d'accent » :

```svelte
<Card class="mt-4">
  <h2 class="text-sm font-bold text-ink">Fond du bureau</h2>
  <p class="mt-0.5 mb-4 text-sm text-ink-muted">Couleur, dégradé ou image. Visible sur la page « Toutes les pages ».</p>

  <div class="space-y-4">
    <div>
      <p class="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Couleur</p>
      <div class="flex flex-wrap items-center gap-2">
        {#each BG_COLORS as c (c)}
          <button type="button" aria-label={`Fond ${c}`} onclick={() => setBackground({ type: 'color', value: c })}
            class="size-8 rounded-lg ring-1 ring-edge transition hover:ring-ink" style={`background:${c}`}></button>
        {/each}
      </div>
    </div>

    <div>
      <p class="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Dégradé</p>
      <div class="flex flex-wrap items-center gap-2">
        {#each DESK_GRADIENTS as g (g.id)}
          <button type="button" aria-label={g.label} onclick={() => setBackground({ type: 'gradient', value: g.id })}
            class="h-8 w-14 rounded-lg ring-1 ring-edge transition hover:ring-ink" style={`background:${g.css}`}></button>
        {/each}
      </div>
    </div>

    <div>
      <p class="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Image</p>
      <label class="inline-flex cursor-pointer items-center gap-2 rounded-full border border-edge px-3 py-1 text-sm text-ink-faint transition hover:text-ink">
        {uploading ? 'Téléversement…' : 'Téléverser une image'}
        <input type="file" accept="image/*" class="hidden" onchange={onWallpaperChange} disabled={uploading} />
      </label>
    </div>

    <button type="button" onclick={() => setBackground(null)}
      class="rounded-full border border-edge px-3 py-1 text-sm text-ink-faint transition hover:text-ink">
      Réinitialiser le fond
    </button>
  </div>
</Card>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: PASS.

- [ ] **Step 5: Manual verification (image works with the local storage driver in dev)**

`/settings/appearance` → choisir une couleur de fond, puis un dégradé : `/apps` reflète le changement. Téléverser une image → `/apps` affiche le wallpaper (driver local en dev), avec le voile assurant la lisibilité des labels. « Réinitialiser le fond » → fond neutre. Recharger → fond conservé.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api/files.ts "apps/web/src/routes/(app)/apps/+page.svelte" "apps/web/src/routes/(app)/settings/appearance/+page.svelte"
git commit -m "feat(web): desk background — color/gradient/uploaded wallpaper (DocumentsService)"
```

---

## Task 12: Vérification finale & rebuild

**Files:** aucun (build/test transverses).

- [ ] **Step 1: Rebuild shared/database (dist consommés par api/web)**

```bash
pnpm --filter @pulsar/shared build
pnpm --filter @pulsar/database build
```

- [ ] **Step 2: Full typecheck + shared tests**

```bash
pnpm typecheck
pnpm --filter @pulsar/shared test
```
Expected: tout vert.

- [ ] **Step 3: Smoke test manuel (critères de succès de la spec)**

Parcourir les 7 critères : centrage 3 modes, pas de tuile sous la barre, pas de reset au retour de module, Framework réapparait + « Personnaliser » dedans, menu clic-droit sur le vide, accent global persistant sans flash, fond couleur/dégradé/image lisible, tailles S/M/L.

- [ ] **Step 4: Commit (si ajustements) / fin**

```bash
git add -A && git commit -m "chore(desk): final verification — typecheck + shared tests green" || echo "rien à committer"
```

---

## Self-Review

**Spec coverage :**
- §1.1 board centré borné → Task 6. §1.2 reset → Task 7. §1.3 Framework re-inject → Task 1 ; action « Personnaliser » → Task 8. §1.4 menu vide → Task 9 (picker sous-pages déjà couvert).
- §2 accent → Task 2 (deriveAccent) + Task 4 (store/boot) + Task 5 (UI).
- §3 fond → Task 1 (types/gradients) + Task 11 (rendu + upload + UI).
- §4 tailles → Task 1 (TILE_SIZES) + Task 10 (composants + sélecteur).
- §5 persistance BD → Task 3 (Prisma+API) + Task 4 (web store/boot). DTO whitelist → Task 3.
- Critères de succès 1-8 → couverts ; vérif finale Task 12.

**Placeholder scan :** aucun TBD/TODO ; chaque step de code montre le code. Les deux notes « supprimer si inutilisé » (Task 3 `IsObject`, Task 4 `commit`) sont des instructions explicites, pas des placeholders.

**Type consistency :** `DeskTileSize`/`TILE_SIZES`/`DeskBackground`/`DESK_GRADIENTS` définis Task 1 et consommés Tasks 10/11. `Appearance`/`deriveAccent`/`isHexColor` définis Task 2, consommés Tasks 3/4/5. `getPreferences`/`putPreferences`/`putDeskLayout` (Task 4) cohérents avec usages Tasks 5/11 et l'existant `/apps`. `uploadDocument`/`fetchDocumentObjectUrl` (Task 11) cohérents. `PreferencesService.update` signature changée en `(userId, { deskLayout?, appearance? })` — contrôleur mis à jour même task.

**Risque identifié & traité :** `reconcileDeskLayout(saved, [])` sur la page Apparence supprimerait les modules → Task 11 corrige en lisant le layout brut (pas de reconcile) côté Réglages.
