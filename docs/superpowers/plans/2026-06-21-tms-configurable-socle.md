# TMS configurable v1 (socle) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le TMS adaptable par tenant via des règles de processus configurables (tendering/POD/BOL/fenêtres/préfixes de numéro) et des champs personnalisés sur les 3 entités cœur (ordre/shipment/load), sans changer le comportement par défaut.

**Architecture:** On étend le framework de configuration mergé le 2026-06-20 (catalogue déclaratif pur dans `@pulsar/shared`, stocké sur `TenantModule.settings`, lu via `ModuleSettingsService.resolve`) avec un type `string` et de nouveaux descripteurs `transportation`. En parallèle, un nouveau sous-système de champs personnalisés : table `CustomFieldDefinition` + colonnes `customData Json?`, validation pure dans `@pulsar/shared`, rendu dynamique côté web.

**Tech Stack:** NestJS + Prisma (PostgreSQL) ; SvelteKit (Svelte 5 runes) ; `@pulsar/shared` (TS pur, browser-safe) ; class-validator ; Jest (unit + e2e HTTP).

## Global Constraints

- **Défauts = comportement actuel exact.** Tout descripteur ajouté a un défaut identique au comportement codé en dur aujourd'hui ; aucun champ personnalisé n'existe par défaut. (spec §0)
- **Règle 1 — Tenant isolation :** toute requête sur les définitions ET les valeurs filtre par `tenantId` issu du JWT (`@CurrentUser()`).
- **Règle 2 — State machines :** aucun nouveau statut, aucune modification des transitions. Les gates lisent un settings résolu et lèvent 400, jamais un nouvel état.
- **Règle 3 — Enums :** `CustomFieldEntity`/`CustomFieldType` vivent dans `packages/shared` ET sont mirorés à l'identique dans `schema.prisma`.
- **Règle 6/14 — Audit :** les mutations de config (réglages, définitions de champs) sont auditées.
- **Règle 8 — Numéros :** les numéros de documents continuent de passer exclusivement par `SequencesService` ; le compteur reste indexé sur la clé de séquence, pas sur le préfixe.
- **Règle 7 — Rebuild :** après toute modif de `packages/shared` ou `packages/database`, rebuild (`pnpm --filter @pulsar/shared build`, `pnpm --filter @pulsar/database build`) avant de lancer l'API.
- **`@pulsar/shared` reste browser-safe :** aucun import Node dans les fichiers ajoutés (pure data + fonctions pures).
- **Pas de nouvelle permission :** config sous `core.modules.manage` ; valeurs sous les permissions `transportation.*` existantes.

---

## File Structure

**Créés :**
- `packages/shared/src/config/custom-fields.ts` — enums `CustomFieldEntity`/`CustomFieldType`, types `CustomFieldDefinition`/`CustomFieldDefinitionInput`, `validateCustomFields`.
- `packages/shared/src/config/custom-fields.spec.ts` — tests unitaires de `validateCustomFields`.
- `apps/api/src/modules/transportation/custom-fields/custom-fields.service.ts` — CRUD des définitions + helper de validation des valeurs.
- `apps/api/src/modules/transportation/custom-fields/custom-fields.controller.ts` — `GET/PUT /transportation/custom-fields`.
- `apps/api/src/modules/transportation/custom-fields/dto/custom-field.dto.ts` — DTO d'écriture des définitions.
- `apps/web/src/lib/components/CustomFieldInputs.svelte` — rendu dynamique des champs (formulaires).
- `apps/web/src/lib/components/settings/CustomFieldsEditor.svelte` — éditeur de définitions.
- `apps/api/test/tms-configurable.e2e-spec.ts` — e2e du socle.

**Modifiés :**
- `packages/shared/src/config/module-settings.ts` — type `string` + descripteurs `transportation`.
- `packages/shared/src/config/module-settings.spec.ts` — tests du type `string` + défauts.
- `packages/shared/src/index.ts` — export de `custom-fields`.
- `packages/database/prisma/schema.prisma` — enums + `CustomFieldDefinition` + colonnes `customData`.
- `apps/api/src/prisma/sequences.service.ts` — préfixes configurables.
- `apps/api/src/prisma/prisma.module.ts` (ou le module qui fournit `SequencesService`) — injection de `ModuleSettingsService`.
- `apps/api/src/modules/transportation/loads/loads.service.ts` — gates tendering/BOL/POD.
- `apps/api/src/modules/transportation/tenders/tenders.service.ts` — gate `DISABLED`.
- `apps/api/src/modules/transportation/transport-orders/transport-orders.service.ts` — `windowCoherence` LENIENT + `customData`.
- `apps/api/src/modules/transportation/planning/window-validation.ts` — pas de changement de signature (le choix strict/lenient est fait par l'appelant).
- `apps/api/src/modules/transportation/transport-orders/dto/transport-order.dto.ts` — `customData`.
- `apps/api/src/modules/transportation/loads/dto/load.dto.ts` — `customData`.
- `apps/api/src/modules/transportation/transportation.module.ts` — déclare `CustomFieldsService`/controller.
- `apps/web/src/lib/components/settings/ModuleSettings.svelte` — type `string`.
- `apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte` — monte l'éditeur de champs pour `transportation`.
- Pages web `transport-orders`, `shipments`, `loads` — intègrent `<CustomFieldInputs>` + affichage.

---

## Task 1: Settings framework — type `string` + descripteurs de processus TMS

**Files:**
- Modify: `packages/shared/src/config/module-settings.ts`
- Test: `packages/shared/src/config/module-settings.spec.ts`

**Interfaces:**
- Produces: `SettingType` inclut `'string'` ; `SettingDescriptor` gagne `pattern?: string`, `maxLength?: number`. Nouveaux descripteurs `transportation` : `requireTendering` (enum DISABLED/OPTIONAL/REQUIRED, défaut OPTIONAL), `podRequiredBeforeCompletion` (boolean false), `bolRequiredBeforeDispatch` (boolean false), `windowCoherence` (enum STRICT/LENIENT, défaut STRICT), `documentPrefixTransportOrder`/`documentPrefixShipment`/`documentPrefixLoad` (string, défauts `TO`/`SH`/`LD`).

- [ ] **Step 1: Write the failing tests**

Ajouter dans `packages/shared/src/config/module-settings.spec.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  catalogFor,
  resolveSettings,
  validateSettings,
  type ModuleSettingsCatalog,
} from './module-settings';

describe('string setting type', () => {
  const cat: ModuleSettingsCatalog = {
    module: 'test',
    settings: [{ key: 'p', label: 'P', type: 'string', default: 'TO', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 }],
  };

  it('accepts a valid string and rejects pattern/length violations', () => {
    expect(validateSettings(cat, { p: 'ORD' })).toEqual({ ok: true, value: { p: 'ORD' } });
    expect(validateSettings(cat, { p: 'lower' }).ok).toBe(false);
    expect(validateSettings(cat, { p: 'TOOLONG' }).ok).toBe(false);
    expect(validateSettings(cat, { p: 42 }).ok).toBe(false);
  });

  it('falls back to default for an invalid stored string', () => {
    expect(resolveSettings(cat, { p: 'bad value' })).toEqual({ p: 'TO' });
  });
});

describe('transportation process descriptors', () => {
  it('defaults equal current hardcoded behavior', () => {
    const cat = catalogFor('transportation')!;
    const d = resolveSettings(cat, {});
    expect(d.requireTendering).toBe('OPTIONAL');
    expect(d.podRequiredBeforeCompletion).toBe(false);
    expect(d.bolRequiredBeforeDispatch).toBe(false);
    expect(d.windowCoherence).toBe('STRICT');
    expect(d.documentPrefixTransportOrder).toBe('TO');
    expect(d.documentPrefixShipment).toBe('SH');
    expect(d.documentPrefixLoad).toBe('LD');
  });
});
```

> Note: le repo utilise le runner de `packages/shared` (vérifier l'import de test existant en tête de `module-settings.spec.ts` et s'aligner dessus — `vitest` ou `node:test`). Reprendre exactement le style d'import déjà présent dans ce fichier.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @pulsar/shared test`
Expected: FAIL (descripteurs absents, type `string` non validé).

- [ ] **Step 3: Add the `string` type and validation**

Dans `packages/shared/src/config/module-settings.ts` :

```ts
export type SettingType = 'enum' | 'boolean' | 'number' | 'string';

export interface SettingDescriptor {
  key: string;
  label: string;
  help?: string;
  type: SettingType;
  default: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  pattern?: string;   // string only
  maxLength?: number; // string only
}
```

Étendre `isValid` (avant le `// enum` final) :

```ts
  if (d.type === 'string') {
    if (typeof v !== 'string') return false;
    if (d.maxLength !== undefined && v.length > d.maxLength) return false;
    if (d.pattern !== undefined && !new RegExp(d.pattern).test(v)) return false;
    return true;
  }
```

- [ ] **Step 4: Add the transportation descriptors**

Dans le bloc `module: 'transportation'` de `MODULE_SETTINGS_CATALOG`, après `autoTenderOnPlan` :

```ts
      {
        key: 'requireTendering',
        label: 'Exigence de tendering',
        help: 'OPTIONAL = libre (tender, auto-tender ou assignation directe). REQUIRED = un tender accepté est obligatoire avant le dispatch. DISABLED = assignation directe seulement.',
        type: 'enum',
        default: 'OPTIONAL',
        options: [
          { value: 'OPTIONAL', label: 'Optionnel (défaut)' },
          { value: 'REQUIRED', label: 'Tender accepté obligatoire' },
          { value: 'DISABLED', label: 'Désactivé (assignation directe)' },
        ],
      },
      { key: 'podRequiredBeforeCompletion', label: 'POD requis avant complétion', type: 'boolean', default: false },
      { key: 'bolRequiredBeforeDispatch', label: 'BOL requis avant dispatch', type: 'boolean', default: false },
      {
        key: 'windowCoherence',
        label: 'Cohérence des fenêtres',
        help: 'STRICT = rejette (400) les fenêtres incohérentes. LENIENT = avertit sans bloquer.',
        type: 'enum',
        default: 'STRICT',
        options: [
          { value: 'STRICT', label: 'Stricte (rejet)' },
          { value: 'LENIENT', label: 'Souple (avertissement)' },
        ],
      },
      { key: 'documentPrefixTransportOrder', label: 'Préfixe n° ordre', type: 'string', default: 'TO', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      { key: 'documentPrefixShipment', label: 'Préfixe n° shipment', type: 'string', default: 'SH', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      { key: 'documentPrefixLoad', label: 'Préfixe n° load', type: 'string', default: 'LD', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @pulsar/shared test`
Expected: PASS.

- [ ] **Step 6: Rebuild shared (règle 7) and commit**

```bash
pnpm --filter @pulsar/shared build
git add packages/shared/src/config/module-settings.ts packages/shared/src/config/module-settings.spec.ts
git commit -m "feat(shared): string setting type + transportation process descriptors"
```

---

## Task 2: Champs personnalisés — enums, types et `validateCustomFields` purs

**Files:**
- Create: `packages/shared/src/config/custom-fields.ts`
- Create: `packages/shared/src/config/custom-fields.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `enum CustomFieldEntity { TRANSPORT_ORDER, SHIPMENT, LOAD }`
  - `enum CustomFieldType { TEXT, NUMBER, DATE, BOOLEAN, SELECT }`
  - `interface CustomFieldDefinition { key: string; label: string; type: CustomFieldType; options?: { value: string; label: string }[]; required: boolean; showInList: boolean; sortOrder: number }`
  - `type CustomFieldValues = Record<string, string | number | boolean | null>`
  - `validateCustomFields(defs: CustomFieldDefinition[], data: unknown, opts?: { partial?: boolean }): { ok: true; value: CustomFieldValues } | { ok: false; errors: string[] }`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/config/custom-fields.spec.ts` (aligner l'import de test sur le style du repo) :

```ts
import { describe, it, expect } from 'vitest';
import { CustomFieldType, validateCustomFields, type CustomFieldDefinition } from './custom-fields';

const defs: CustomFieldDefinition[] = [
  { key: 'poRef', label: 'PO', type: CustomFieldType.TEXT, required: true, showInList: true, sortOrder: 0 },
  { key: 'temp', label: 'Temp', type: CustomFieldType.NUMBER, required: false, showInList: false, sortOrder: 1 },
  { key: 'svc', label: 'Service', type: CustomFieldType.SELECT, options: [{ value: 'STD', label: 'Std' }], required: false, showInList: false, sortOrder: 2 },
];

describe('validateCustomFields', () => {
  it('accepts valid values', () => {
    const r = validateCustomFields(defs, { poRef: 'PO-1', temp: 4, svc: 'STD' });
    expect(r).toEqual({ ok: true, value: { poRef: 'PO-1', temp: 4, svc: 'STD' } });
  });
  it('rejects unknown keys', () => {
    expect(validateCustomFields(defs, { nope: 1 }).ok).toBe(false);
  });
  it('enforces required on full create', () => {
    expect(validateCustomFields(defs, { temp: 4 }).ok).toBe(false); // poRef manquant
  });
  it('skips required check when partial', () => {
    expect(validateCustomFields(defs, { temp: 4 }, { partial: true }).ok).toBe(true);
  });
  it('type-checks each kind', () => {
    expect(validateCustomFields(defs, { poRef: 5 }).ok).toBe(false);
    expect(validateCustomFields(defs, { poRef: 'x', temp: 'no' }).ok).toBe(false);
    expect(validateCustomFields(defs, { poRef: 'x', svc: 'NOPE' }).ok).toBe(false);
  });
  it('treats empty/null on a non-required field as null', () => {
    const r = validateCustomFields(defs, { poRef: 'x', temp: null });
    expect(r).toEqual({ ok: true, value: { poRef: 'x', temp: null } });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @pulsar/shared test`
Expected: FAIL (module inexistant).

- [ ] **Step 3: Implement `custom-fields.ts`**

```ts
export enum CustomFieldEntity {
  TRANSPORT_ORDER = 'TRANSPORT_ORDER',
  SHIPMENT = 'SHIPMENT',
  LOAD = 'LOAD',
}

export enum CustomFieldType {
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  DATE = 'DATE',
  BOOLEAN = 'BOOLEAN',
  SELECT = 'SELECT',
}

export interface CustomFieldDefinition {
  key: string;
  label: string;
  type: CustomFieldType;
  options?: { value: string; label: string }[];
  required: boolean;
  showInList: boolean;
  sortOrder: number;
}

export type CustomFieldValues = Record<string, string | number | boolean | null>;

const KEY_RE = /^[a-z][a-zA-Z0-9_]{0,39}$/;

/** Validates a custom-field definition list for shape/uniqueness (used by the write endpoint). */
export function validateDefinitions(
  defs: CustomFieldDefinition[],
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (!KEY_RE.test(d.key)) errors.push(`Invalid key "${d.key}"`);
    if (seen.has(d.key)) errors.push(`Duplicate key "${d.key}"`);
    seen.add(d.key);
    if (d.type === CustomFieldType.SELECT && (!d.options || d.options.length === 0)) {
      errors.push(`SELECT field "${d.key}" needs options`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function isIsoDate(v: unknown): boolean {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/** Validates a values payload against the tenant's definitions. */
export function validateCustomFields(
  defs: CustomFieldDefinition[],
  data: unknown,
  opts: { partial?: boolean } = {},
): { ok: true; value: CustomFieldValues } | { ok: false; errors: string[] } {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['customData must be an object'] };
  }
  const input = data as Record<string, unknown>;
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const errors: string[] = [];
  const value: CustomFieldValues = {};

  for (const [k, raw] of Object.entries(input)) {
    const d = byKey.get(k);
    if (!d) {
      errors.push(`Unknown field "${k}"`);
      continue;
    }
    if (raw === null || raw === '') {
      value[k] = null;
      continue;
    }
    switch (d.type) {
      case CustomFieldType.TEXT:
        if (typeof raw !== 'string') errors.push(`Field "${k}" must be text`);
        else value[k] = raw;
        break;
      case CustomFieldType.NUMBER:
        if (typeof raw !== 'number' || !Number.isFinite(raw)) errors.push(`Field "${k}" must be a number`);
        else value[k] = raw;
        break;
      case CustomFieldType.DATE:
        if (!isIsoDate(raw)) errors.push(`Field "${k}" must be a date`);
        else value[k] = raw as string;
        break;
      case CustomFieldType.BOOLEAN:
        if (typeof raw !== 'boolean') errors.push(`Field "${k}" must be a boolean`);
        else value[k] = raw;
        break;
      case CustomFieldType.SELECT:
        if (typeof raw !== 'string' || !d.options?.some((o) => o.value === raw)) {
          errors.push(`Field "${k}" must be one of the allowed options`);
        } else value[k] = raw;
        break;
    }
  }

  if (!opts.partial) {
    for (const d of defs) {
      if (d.required) {
        const v = value[d.key];
        if (v === undefined || v === null) errors.push(`Field "${d.label}" is required`);
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}
```

- [ ] **Step 4: Export from the barrel**

Dans `packages/shared/src/index.ts`, ajouter après la ligne `export * from './config/module-settings';` :

```ts
export * from './config/custom-fields';
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @pulsar/shared test`
Expected: PASS.

- [ ] **Step 6: Rebuild + commit**

```bash
pnpm --filter @pulsar/shared build
git add packages/shared/src/config/custom-fields.ts packages/shared/src/config/custom-fields.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): custom-fields enums + pure validateCustomFields"
```

---

## Task 3: Schéma & migration (CustomFieldDefinition + customData)

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces: modèle Prisma `CustomFieldDefinition` (champs alignés sur la table du spec §B.1) + enums `CustomFieldEntity`/`CustomFieldType` + colonnes `customData Json?` sur `TransportOrder`, `Shipment`, `Load`.

- [ ] **Step 1: Add enums (mirror @pulsar/shared, règle 3)**

Dans `schema.prisma`, à côté des autres enums :

```prisma
enum CustomFieldEntity {
  TRANSPORT_ORDER
  SHIPMENT
  LOAD
}

enum CustomFieldType {
  TEXT
  NUMBER
  DATE
  BOOLEAN
  SELECT
}
```

- [ ] **Step 2: Add the CustomFieldDefinition model**

```prisma
model CustomFieldDefinition {
  id         String            @id @default(cuid())
  tenantId   String
  module     String
  entityType CustomFieldEntity
  key        String
  label      String
  type       CustomFieldType
  options    Json?
  required   Boolean           @default(false)
  showInList Boolean           @default(false)
  sortOrder  Int               @default(0)
  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt

  @@unique([tenantId, module, entityType, key])
  @@index([tenantId, module, entityType])
  @@map("custom_field_definitions")
}
```

- [ ] **Step 3: Add customData columns**

Dans les modèles `TransportOrder`, `Shipment`, `Load`, ajouter :

```prisma
  customData Json?
```

- [ ] **Step 4: Generate + apply the migration**

Run:
```bash
pnpm db:migrate   # prisma migrate dev --name tms_custom_fields (lancer depuis la racine)
```
Expected: migration créée, appliquée, client régénéré. (Si crash « URL must start with prisma:// » au prochain démarrage API : `pnpm db:generate` après avoir tué le dev — voir mémoire `pulsar-prisma-no-engine-gotcha`.)

- [ ] **Step 5: Build database package + reseed**

```bash
pnpm --filter @pulsar/database build
pnpm db:seed
```
Expected: seed OK.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): CustomFieldDefinition + customData columns (migration)"
```

---

## Task 4: SequencesService — préfixes configurables par tenant

**Files:**
- Modify: `apps/api/src/prisma/sequences.service.ts`
- Modify: le module NestJS qui déclare `SequencesService` (probablement `apps/api/src/prisma/prisma.module.ts` — vérifier où `SequencesService` est `provider`) pour qu'il puisse injecter `ModuleSettingsService`.
- Test: `apps/api/test/tms-configurable.e2e-spec.ts` (créé en Task 8 ; cette tâche y ajoute le cas préfixe — ou un test ciblé temporaire).

**Interfaces:**
- Consumes: `ModuleSettingsService.resolve(tenantId, 'transportation')` (Task 1 descripteurs).
- Produces: `nextNumber` utilise le préfixe résolu pour `transport-order`/`shipment`/`load` ; fallback statique sinon.

- [ ] **Step 1: Map the configurable keys**

Dans `sequences.service.ts`, ajouter après `PREFIXES` :

```ts
/** Sequence keys whose prefix is overridable by a transportation tenant setting. */
const PREFIX_SETTING: Partial<Record<SequenceKey, string>> = {
  'transport-order': 'documentPrefixTransportOrder',
  shipment: 'documentPrefixShipment',
  load: 'documentPrefixLoad',
};
```

- [ ] **Step 2: Inject ModuleSettingsService and resolve the prefix**

Modifier le constructeur et `nextNumber` :

```ts
import { ModuleSettingsService } from '../core/module-registry/module-settings.service';
// ...
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleSettings: ModuleSettingsService,
  ) {}

  private async prefixFor(tenantId: string, key: SequenceKey): Promise<string> {
    const settingKey = PREFIX_SETTING[key];
    if (!settingKey) return PREFIXES[key];
    const settings = await this.moduleSettings.resolve(tenantId, 'transportation');
    const v = settings[settingKey];
    return typeof v === 'string' && v.length > 0 ? v : PREFIXES[key];
  }

  async nextNumber(tenantId: string, key: SequenceKey): Promise<string> {
    const value = await this.next(tenantId, key); // counter is keyed on `key`, never the prefix
    const prefix = await this.prefixFor(tenantId, key);
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
```

> Vérifier qu'il n'y a pas de cycle de dépendance (SequencesService ↔ ModuleSettingsService). `ModuleSettingsService` dépend de `PrismaService` + `TenantModulesCacheService`, pas de `SequencesService` → pas de cycle. Si le `SequencesService` est dans un module importé par tout le monde, exposer `ModuleSettingsService` via le `ModuleRegistryModule` exporté (vérifier les `exports`). En dernier recours, lire directement via `TenantModulesCacheService` + `resolveSettings(catalogFor('transportation'), raw)`.

- [ ] **Step 3: Wire the provider module**

S'assurer que le module fournissant `SequencesService` importe le module qui exporte `ModuleSettingsService` (`ModuleRegistryModule`). Ajouter l'import si absent.

- [ ] **Step 4: Verify build/typecheck**

Run: `pnpm --filter @pulsar/api build` (ou `pnpm typecheck`)
Expected: pas d'erreur de DI/typage.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/prisma/sequences.service.ts apps/api/src/prisma/prisma.module.ts
git commit -m "feat(api): per-tenant configurable document prefixes (rule 8 preserved)"
```

> Le test e2e du préfixe est ajouté en Task 8 (« préfixe custom appliqué, compteur non réinitialisé »).

---

## Task 5: Gates de processus configurables (tendering / BOL / POD / fenêtres)

**Files:**
- Modify: `apps/api/src/modules/transportation/loads/loads.service.ts`
- Modify: `apps/api/src/modules/transportation/tenders/tenders.service.ts`
- Modify: `apps/api/src/modules/transportation/transport-orders/transport-orders.service.ts`
- Test: `apps/api/test/tms-configurable.e2e-spec.ts` (créé en Task 8 ; gates couverts là).

**Interfaces:**
- Consumes: `this.moduleSettings.resolve(tenantId, 'transportation')` (déjà injecté dans `loads.service` et `tenders.service`).
- Produces: gates 400 conditionnés par réglage ; aucun changement de transition (règle 2).

- [ ] **Step 1: `requireTendering` REQUIRED — gate dispatch**

Dans `loads.service.ts` `dispatch()`, après le bloc `if (load.status === LoadStatus.TENDERED) {...}` (vers la ligne 441), ajouter :

```ts
    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    if (tms['requireTendering'] === 'REQUIRED' && load.status !== LoadStatus.TENDERED) {
      const accepted = await this.prisma.tender.findFirst({
        where: { tenantId, loadId: id, status: TenderStatus.ACCEPTED },
      });
      if (!accepted) {
        throw new BadRequestException('Tenant policy requires an accepted tender before dispatch');
      }
    }
```

> Le bloc TENDERED existant gère déjà le cas « status==TENDERED sans tender accepté » ; ce nouveau bloc couvre le dispatch direct depuis PLANNED quand le tenant l'exige.

- [ ] **Step 2: `bolRequiredBeforeDispatch` — gate dispatch**

Toujours dans `dispatch()`, juste après le bloc Step 1 :

```ts
    if (tms['bolRequiredBeforeDispatch'] === true) {
      const bol = await this.prisma.document.findFirst({
        where: { tenantId, entityType: 'bill-of-lading', entityId: id },
      });
      if (!bol) {
        throw new BadRequestException('Tenant policy requires a generated BOL before dispatch');
      }
    }
```

> Vérifier le nom exact du modèle/table des documents (BOL généré) et des colonnes `entityType`/`entityId` via `BolService.generate` (le BOL est journalisé en document — confirmer le modèle réel ; adapter le `where` si nécessaire). Si le BOL est tracé via `AuditLog` plutôt qu'un `Document`, gater sur la présence d'un document `bill-of-lading` retourné par `GET /loads/:id/documents`.

- [ ] **Step 3: `podRequiredBeforeCompletion` — gate complete**

Dans `loads.service.ts` `complete()`, après `this.assertTransition(...)` (vers la ligne 507) :

```ts
    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    if (tms['podRequiredBeforeCompletion'] === true) {
      const shipmentsWithoutPod = await this.prisma.shipment.count({
        where: { tenantId, loadId: id, proofOfDelivery: null },
      });
      if (shipmentsWithoutPod > 0) {
        throw new BadRequestException('Tenant policy requires a POD on every shipment before completion');
      }
    }
```

- [ ] **Step 4: `requireTendering` DISABLED — refuse tender creation**

Dans `tenders.service.ts` `create()`, après le check `if (load.status !== LoadStatus.PLANNED)` (vers la ligne 60) :

```ts
    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    if (tms['requireTendering'] === 'DISABLED') {
      throw new BadRequestException('Tendering is disabled by tenant policy (direct assignment only)');
    }
```

> `autoTender()` appelle `create()`, donc il est couvert. (En `DISABLED`, l'auto-tender lèvera 400 ; c'est le comportement voulu — assignation directe seulement.)

- [ ] **Step 5: `windowCoherence` LENIENT — skip the hard assert on write**

Dans `transport-orders.service.ts`, localiser chaque appel à `assertWindowCoherence(...)` (create/update/plan/addShipment). L'envelopper d'une lecture de réglage :

```ts
    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    if (tms['windowCoherence'] !== 'LENIENT') {
      assertWindowCoherence({ /* mêmes arguments qu'aujourd'hui */ });
    }
```

> Pour `resolveSplitWindows` (qui appelle `assertWindowCoherence` en interne, dans `window-validation.ts`) : ajouter un paramètre optionnel `strict = true` à `resolveSplitWindows` et ne lever que si `strict`. L'appelant passe `strict = tms['windowCoherence'] !== 'LENIENT'`. Ne pas changer la signature de `assertWindowCoherence` elle-même. Les `windowWarnings` déjà calculés sur GET continuent de surfacer l'incohérence à titre consultatif. Vérifier que `transport-orders.service` injecte bien `ModuleSettingsService` (l'ajouter au constructeur si absent, comme dans `loads.service`).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: pas d'erreur. (Les comportements sont validés par l'e2e en Task 8.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/transportation/loads/loads.service.ts apps/api/src/modules/transportation/tenders/tenders.service.ts apps/api/src/modules/transportation/transport-orders/transport-orders.service.ts apps/api/src/modules/transportation/planning/window-validation.ts
git commit -m "feat(api): configurable TMS process gates (tendering/BOL/POD/windows)"
```

---

## Task 6: API champs personnalisés (définitions + valeurs)

**Files:**
- Create: `apps/api/src/modules/transportation/custom-fields/custom-fields.service.ts`
- Create: `apps/api/src/modules/transportation/custom-fields/custom-fields.controller.ts`
- Create: `apps/api/src/modules/transportation/custom-fields/dto/custom-field.dto.ts`
- Modify: `apps/api/src/modules/transportation/transportation.module.ts`
- Modify: `apps/api/src/modules/transportation/transport-orders/dto/transport-order.dto.ts`
- Modify: `apps/api/src/modules/transportation/loads/dto/load.dto.ts`
- Modify: `transport-orders.service.ts`, `loads.service.ts` (persister + valider + projeter `customData`)

**Interfaces:**
- Consumes: `validateCustomFields`, `validateDefinitions`, `CustomFieldEntity`, `CustomFieldType` (Task 2) ; modèle `CustomFieldDefinition` (Task 3).
- Produces:
  - `CustomFieldsService.listDefinitions(tenantId, entityType): Promise<CustomFieldDefinition[]>`
  - `CustomFieldsService.replaceDefinitions(tenantId, userId, entityType, defs): Promise<CustomFieldDefinition[]>`
  - `CustomFieldsService.validateValues(tenantId, entityType, data, opts): Promise<CustomFieldValues>` (lève `BadRequestException` si invalide)
  - `GET /transportation/custom-fields?entityType=...`, `PUT /transportation/custom-fields`

- [ ] **Step 1: Write the DTO**

`dto/custom-field.dto.ts` :

```ts
import { CustomFieldEntity, CustomFieldType } from '@pulsar/shared';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, ValidateNested,
} from 'class-validator';

class CustomFieldOptionDto {
  @IsString() value!: string;
  @IsString() label!: string;
}

export class CustomFieldDefinitionDto {
  @IsString() key!: string;
  @IsString() label!: string;
  @IsEnum(CustomFieldType) type!: CustomFieldType;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CustomFieldOptionDto)
  options?: CustomFieldOptionDto[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() showInList?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class ReplaceCustomFieldsDto {
  @IsEnum(CustomFieldEntity) entityType!: CustomFieldEntity;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CustomFieldDefinitionDto)
  definitions!: CustomFieldDefinitionDto[];
}
```

- [ ] **Step 2: Write the service**

`custom-fields.service.ts` :

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CustomFieldEntity, CustomFieldType, validateCustomFields, validateDefinitions,
  type CustomFieldDefinition, type CustomFieldValues,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';

const MODULE = 'transportation';

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async listDefinitions(tenantId: string, entityType: CustomFieldEntity): Promise<CustomFieldDefinition[]> {
    const rows = await this.prisma.customFieldDefinition.findMany({
      where: { tenantId, module: MODULE, entityType },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => ({
      key: r.key, label: r.label, type: r.type as CustomFieldType,
      options: (r.options as { value: string; label: string }[] | null) ?? undefined,
      required: r.required, showInList: r.showInList, sortOrder: r.sortOrder,
    }));
  }

  async replaceDefinitions(
    tenantId: string, userId: string, entityType: CustomFieldEntity,
    defs: CustomFieldDefinition[],
  ): Promise<CustomFieldDefinition[]> {
    const check = validateDefinitions(defs);
    if (!check.ok) throw new BadRequestException(check.errors.join('; '));
    await this.prisma.$transaction([
      this.prisma.customFieldDefinition.deleteMany({ where: { tenantId, module: MODULE, entityType } }),
      this.prisma.customFieldDefinition.createMany({
        data: defs.map((d, i) => ({
          tenantId, module: MODULE, entityType,
          key: d.key, label: d.label, type: d.type,
          options: (d.options ?? null) as Prisma.InputJsonValue,
          required: d.required ?? false, showInList: d.showInList ?? false,
          sortOrder: d.sortOrder ?? i,
        })),
      }),
    ]);
    await this.audit.log({
      tenantId, userId, action: 'UPDATE' as never,
      entityType: 'custom-field-definition', entityId: `${MODULE}:${entityType}`,
      after: { count: defs.length },
    });
    return this.listDefinitions(tenantId, entityType);
  }

  /** Validates a values payload; throws 400 on any error. Returns the cleaned values (or undefined if no data). */
  async validateValues(
    tenantId: string, entityType: CustomFieldEntity, data: unknown, opts: { partial?: boolean } = {},
  ): Promise<CustomFieldValues | undefined> {
    const defs = await this.listDefinitions(tenantId, entityType);
    if (defs.length === 0 && (data === undefined || data === null)) return undefined;
    const res = validateCustomFields(defs, data ?? {}, opts);
    if (!res.ok) throw new BadRequestException(res.errors.join('; '));
    return res.value;
  }
}
```

> Vérifier la signature exacte de `AuditLogsService.log` et de `AuditAction` (importer `AuditAction.UPDATE` au lieu du cast `as never` — s'aligner sur l'usage dans `loads.service.ts`).

- [ ] **Step 3: Write the controller**

`custom-fields.controller.ts` (s'aligner sur les décorateurs d'un controller transportation existant — `@RequireModule(MODULE_KEYS.TRANSPORTATION)` au niveau classe, `@RequirePermissions(...)`, `@CurrentUser()`) :

```ts
import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { CustomFieldEntity, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../core/auth/current-user.decorator';
import { RequireModule } from '../../../core/module-registry/require-module.decorator';
import { RequirePermissions } from '../../../core/auth/require-permissions.decorator';
import { CustomFieldsService } from './custom-fields.service';
import { ReplaceCustomFieldsDto } from './dto/custom-field.dto';

@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/custom-fields')
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.MODULES_MANAGE)
  list(@CurrentUser() user: { tenantId: string }, @Query('entityType') entityType: CustomFieldEntity) {
    return this.service.listDefinitions(user.tenantId, entityType);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.CORE.MODULES_MANAGE)
  replace(@CurrentUser() user: { tenantId: string; userId: string }, @Body() dto: ReplaceCustomFieldsDto) {
    return this.service.replaceDefinitions(user.tenantId, user.userId, dto.entityType, dto.definitions as never);
  }
}
```

> Vérifier les chemins/d'import réels des décorateurs (`CurrentUser`, `RequireModule`, `RequirePermissions`) et la clé de permission exacte (`PERMISSIONS.CORE.MODULES_MANAGE`) dans `permissions.ts` — reprendre exactement ce qu'utilise `module-registry.controller.ts`. Le shape de `@CurrentUser()` (champs `tenantId`/`userId`/`id`) doit matcher celui des autres controllers.

- [ ] **Step 4: Register in the module**

Dans `transportation.module.ts`, ajouter `CustomFieldsService` aux `providers`, `CustomFieldsController` aux `controllers`, et exporter `CustomFieldsService` (consommé par les services entités).

- [ ] **Step 5: Accept `customData` in entity DTOs**

Dans `transport-order.dto.ts`, ajouter à `CreateTransportOrderDto` (hérité par `UpdateTransportOrderDto`) et à `ShipmentSplitDto` :

```ts
  @IsOptional()
  @IsObject()
  customData?: Record<string, unknown>;
```
(importer `IsObject` de class-validator). Idem dans `load.dto.ts` (`CreateLoadDto` et/ou `AssignLoadResourcesDto` selon où le load reçoit ses champs — au minimum sur la création/maj du load).

- [ ] **Step 6: Validate + persist + project in services**

Dans `transport-orders.service.ts` `create()`/`update()` : avant le `prisma.transportOrder.create/update`, valider et inclure `customData` :

```ts
    const customData = await this.customFields.validateValues(
      tenantId, CustomFieldEntity.TRANSPORT_ORDER, dto.customData,
      { partial: false }, // update(): { partial: true }
    );
    // ... data: { ..., ...(customData !== undefined ? { customData } : {}) }
```
Injecter `CustomFieldsService` dans le constructeur. Pour les shipments créés au `plan()`, valider `split.customData` avec `CustomFieldEntity.SHIPMENT`. Pour les loads, idem avec `CustomFieldEntity.LOAD` dans `loads.service`.
`customData` est déjà retourné par les `findMany`/`findFirst` sans `select` restrictif → vérifier que les projections list/detail n'excluent pas la colonne (sinon l'ajouter au `select`).

- [ ] **Step 7: Typecheck + build**

Run: `pnpm typecheck`
Expected: pas d'erreur.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/transportation
git commit -m "feat(api): custom-field definitions CRUD + customData on TMS entities"
```

---

## Task 7: Web — type `string`, éditeur de définitions, rendu dynamique

**Files:**
- Modify: `apps/web/src/lib/components/settings/ModuleSettings.svelte`
- Create: `apps/web/src/lib/components/settings/CustomFieldsEditor.svelte`
- Create: `apps/web/src/lib/components/CustomFieldInputs.svelte`
- Modify: `apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/transport-orders/+page.svelte`, `.../transport-orders/[id]/+page.svelte`, `.../shipments/+page.svelte`, `.../loads/+page.svelte` (+ detail si pertinent)

**Interfaces:**
- Consumes: `GET/PUT /transportation/custom-fields` (Task 6) ; `GET/PUT /modules/transportation/settings`.
- Produces: composant réutilisable `<CustomFieldInputs definitions data />` (bind `data`).

- [ ] **Step 1: Support `string` in ModuleSettings.svelte**

Étendre l'interface `SettingDescriptor` locale (`type: 'enum' | 'boolean' | 'number' | 'string'`, + `pattern?`, `maxLength?`) et ajouter une branche de rendu avant le `{:else}` (number) :

```svelte
        {:else if d.type === 'string'}
          <Input type="text" bind:value={values[d.key] as string} maxlength={d.maxLength} />
```

- [ ] **Step 2: Build CustomFieldInputs.svelte**

```svelte
<script lang="ts">
  import { Field, Input, Select } from '$lib/components/ui';

  interface Def {
    key: string; label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
  }
  let { definitions, data = $bindable() }: { definitions: Def[]; data: Record<string, unknown> } = $props();
</script>

{#each definitions as d (d.key)}
  <Field label={d.label}>
    {#if d.type === 'BOOLEAN'}
      <input type="checkbox" bind:checked={data[d.key] as boolean} class="h-4 w-4 rounded border-edge accent-accent" />
    {:else if d.type === 'SELECT'}
      <Select bind:value={data[d.key] as string} required={d.required}>
        <option value="">—</option>
        {#each d.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
      </Select>
    {:else if d.type === 'NUMBER'}
      <Input type="number" bind:value={data[d.key] as string | number} required={d.required} />
    {:else if d.type === 'DATE'}
      <Input type="date" bind:value={data[d.key] as string} required={d.required} />
    {:else}
      <Input type="text" bind:value={data[d.key] as string} required={d.required} />
    {/if}
  </Field>
{/each}
```

- [ ] **Step 3: Build CustomFieldsEditor.svelte**

Éditeur de définitions par `entityType` (sélecteur d'entité + lignes dynamiques add/remove avec key/label/type/required/showInList, et options pour SELECT), chargeant `GET /transportation/custom-fields?entityType=` et sauvant via `PUT /transportation/custom-fields` (body `{ entityType, definitions }`). Réutiliser le pattern de lignes dynamiques de `transport-orders/[id]/+page.svelte` (splitRows) et les composants `Field/Input/Select/Button`. Afficher les erreurs `ApiError` dans une string locale.

- [ ] **Step 4: Mount the editor on the transportation config page**

Dans `settings/modules/[key]/+page.svelte`, sous `<ModuleSettings module={key} />`, ajouter (conditionné `key === 'transportation'`) un bloc « Champs personnalisés » montant `<CustomFieldsEditor />`.

- [ ] **Step 5: Wire CustomFieldInputs into the order create form**

Dans `transport-orders/+page.svelte` : charger les définitions (`GET /transportation/custom-fields?entityType=TRANSPORT_ORDER`) à l'ouverture du formulaire ; initialiser `let customData = $state<Record<string, unknown>>({})` ; insérer `<CustomFieldInputs definitions={orderFieldDefs} bind:data={customData} />` après la grille de champs natifs ; inclure `customData` dans le body du POST ; reset à la fermeture. Répéter le branchement pour shipment (split, entityType SHIPMENT) et load (entityType LOAD) dans leurs pages respectives.

- [ ] **Step 6: Display custom values**

Sur les pages détail (cartes résumé DL/DD) et, pour les définitions `showInList=true`, en colonnes de liste : afficher `entity.customData?.[def.key]`. Helper minimal de formatage (BOOLEAN → Oui/Non, DATE → date locale).

- [ ] **Step 7: Build the web app**

Run: `pnpm --filter @pulsar/web build`
Expected: build OK (pas d'erreur de type Svelte).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): string setting + custom-field editor and dynamic inputs"
```

---

## Task 8: e2e `tms-configurable` + vérification navigateur + docs

**Files:**
- Create: `apps/api/test/tms-configurable.e2e-spec.ts`
- Modify: `docs/etat-du-projet.md` (ligne de session), `CLAUDE.md` (nouvelle règle si pertinent)

**Interfaces:**
- Consumes: tout ce qui précède, via HTTP. S'aligner sur le harnais d'un e2e existant (ex. `dispatch-workbench.e2e-spec.ts` ou `module-settings.e2e-spec.ts`) : bootstrap app, login admin, création de master data avec codes uniques (réexécutable).

- [ ] **Step 1: Write the e2e (rules)**

Cas (chacun : régler via `PUT /modules/transportation/settings`, puis exercer le parcours) :
- `requireTendering=REQUIRED` → dispatch d'un load PLANNED sans tender accepté = 400 ; après création + acceptation d'un tender = 200.
- `requireTendering=DISABLED` → `POST /transportation/loads/:id/tenders` = 400.
- `podRequiredBeforeCompletion=true` → `complete` sans POD = 400.
- `bolRequiredBeforeDispatch=true` → `dispatch` sans BOL = 400 ; après `POST :id/bol` = 200.
- `windowCoherence=LENIENT` → création d'un ordre avec `requestedPickupEarly > requestedDeliveryLate` = 201 (au lieu de 400) ; `STRICT` (défaut) = 400.
- Préfixe : `documentPrefixTransportOrder='ORD'` → le prochain `orderNumber` commence par `ORD-` ; le compteur n'est pas réinitialisé (numéro strictement croissant vs avant).

- [ ] **Step 2: Write the e2e (custom fields)**

- `PUT /transportation/custom-fields` avec un champ SELECT requis (`poRef`? non — SELECT `svc` requis) pour TRANSPORT_ORDER.
- `POST /transportation/transport-orders` sans la valeur requise = 400 ; avec valeur hors options = 400 ; avec valeur valide = 201 et `GET` renvoie `customData.svc`.
- Isolation : un second tenant ne voit pas les définitions du premier (`GET` renvoie []).

- [ ] **Step 3: Run the e2e**

Run: `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm test:e2e -- tms-configurable`
Expected: tous verts. (Lancer aussi la suite complète `pnpm test:e2e` pour confirmer zéro régression sur les parcours par défaut.)

- [ ] **Step 4: Verify in the browser**

`pnpm dev`, login `admin@pulsar.dev / admin123` (tenant acme) :
- Réglages → Transport → Configuration : changer un préfixe, basculer `requireTendering`, définir un champ personnalisé sur l'ordre.
- Créer un ordre : le champ personnalisé apparaît, est validé, et s'affiche en détail.
- Confirmer qu'un parcours sans réglage modifié est inchangé.

- [ ] **Step 5: Update docs**

Ajouter une ligne de session dans `docs/etat-du-projet.md` (TMS configurable v1 livré : règles + custom fields). Si une nouvelle invariant mérite une règle CLAUDE.md (ex. « les valeurs `customData` passent toujours par `validateCustomFields`, jamais persistées sans validation ; définitions et valeurs tenant-scopées »), l'ajouter à la section « Hard rules ».

- [ ] **Step 6: Commit**

```bash
git add apps/api/test/tms-configurable.e2e-spec.ts docs/etat-du-projet.md CLAUDE.md
git commit -m "test(api): tms-configurable e2e + docs"
```

---

## Self-review notes (résolu)

- **Couverture spec :** A (5 réglages : Task 1 descripteurs + Task 4 préfixes + Task 5 gates) ; B (custom fields : Task 2 pur + Task 3 schéma + Task 6 API + Task 7 web) ; migration unique (Task 3) ; tests (Tasks 1/2 unit + Task 8 e2e). ✔
- **Points à confirmer au fil de l'eau (signalés dans les steps) :** runner de test de `@pulsar/shared` (vitest vs node:test), modèle exact du BOL généré (Document vs AuditLog) pour le gate `bolRequiredBeforeDispatch`, chemins d'import des décorateurs auth/module, signature `AuditLogsService.log`/`AuditAction`, et absence de cycle DI `SequencesService`↔`ModuleSettingsService`.
- **Type consistency :** `validateCustomFields`/`validateDefinitions`/`CustomFieldValues`/`CustomFieldDefinition` cohérents entre Task 2 (déf.) et Tasks 6/7 (conso.). `customData` typé `Json?` (Prisma) ↔ `Record<string, unknown>` (DTO) ↔ `CustomFieldValues` (validé). ✔
