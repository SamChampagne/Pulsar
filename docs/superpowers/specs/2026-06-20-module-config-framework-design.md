# Module configuration framework — design

> Spec issue de la session de stabilisation du 2026-06-20. Transforme des comportements
> aujourd'hui codés en dur (ou ambigus) en **réglages configurables par tenant et par module**,
> via un framework générique déclaratif. Aucune migration (réutilise `TenantModule.settings`).

## Problème

Pendant la stabilisation post-merge, plusieurs comportements se sont révélés être des
**décisions produit** qu'on ne peut pas trancher en dur sans pénaliser certains tenants :
unicité des bids procurement, format des nombres CSV (EN vs FR), exigence de statut pour un POD,
fenêtre de conformité Fleet, dépassement de capacité TMS, etc. Le module Billing prouve déjà le
pattern (il lit `TenantModule.settings` pour ses tolérances de rapprochement) mais de façon
ad-hoc, sans cadre réutilisable ni UI.

## Objectif

Un **framework générique** : chaque module **déclare** ses réglages (pure data), un service les
**résout** (défauts + cache), deux endpoints les **exposent/persistent**, et un composant web
**unique** les **rend** automatiquement. Ajouter un réglage = ajouter une entrée au catalogue +
le lire au point d'application. Aucune UI ni endpoint à réécrire par module.

### Non-objectifs (YAGNI)

- Pas de réglages « inventés » : seuls les knobs avec un besoin réel identifié entrent en v1.
- Pas de réglages par utilisateur (c'est par tenant × module).
- Pas de versioning/historique des réglages au-delà de l'`AuditLog` déjà émis.
- Pas de migration Redis du cache (la dette mono-process existante est assumée, comme pour
  l'activation des modules).

## Architecture

### 1. Catalogue déclaratif — `packages/shared/src/config/module-settings.ts` (pure data)

```ts
export type SettingType = 'enum' | 'boolean' | 'number';

export interface SettingDescriptor {
  key: string;                 // ex. 'bidUniqueness'
  label: string;
  help?: string;
  type: SettingType;
  default: string | number | boolean;
  options?: { value: string; label: string }[]; // requis si type === 'enum'
  min?: number;                // bornes si type === 'number'
  max?: number;
}

export interface ModuleSettingsCatalog {
  module: string;              // une valeur de MODULE_KEYS
  settings: SettingDescriptor[];
}

export const MODULE_SETTINGS_CATALOG: ModuleSettingsCatalog[];
```

Deux fonctions **pures** (testées) :

- `resolveSettings(catalog, stored)` → `Record<string, string|number|boolean>` : pour chaque
  descripteur, prend `stored[key]` s'il est présent **et valide** (bon type, enum connu, dans les
  bornes), sinon le `default`. Ignore les clés stockées inconnues.
- `validateSettings(catalog, patch)` → `{ ok: true, value } | { ok: false, errors }` : whitelist
  des clés contre le catalogue (rejette toute clé hors catalogue — même discipline que le fix
  d'import connect), vérifie type/enum/bornes. Utilisé par le `PUT`.

Browser-safe, aucun import Node (comme `RUNTIME_PROVIDERS`, `AUTOMATION_EVENT_CATALOG`).
Export depuis `packages/shared/src/index.ts`.

### 2. Stockage

`TenantModule.settings : Json @default("{}")` — **existant, aucune migration**. Les réglages d'un
module vivent à plat dans ce JSON, keyés par `SettingDescriptor.key`. Rétro-compat : Billing
conserve ses clés `tolerancePct` / `toleranceAbsolute` (déclarées au catalogue à l'identique), donc
les valeurs déjà stockées restent lues sans changement.

### 3. Service de lecture — `apps/api/src/core/module-registry/module-settings.service.ts`

- `resolve(tenantId, moduleKey): Promise<ResolvedSettings>` : charge `TenantModule.settings`
  (1 requête indexée `(tenantId, moduleId)`), applique `resolveSettings(catalog, stored)`.
- **Cache** : intégré au `TenantModulesCacheService` existant (même TTL 30 s, même portée
  mono-process). Invalidation sur `PUT` (vide l'entrée du tenant).
- Helper typé optionnel par usage : les services métier appellent `resolve` puis lisent leur clé
  avec le bon type (le défaut du catalogue garantit une valeur).

### 4. Endpoints — `module-registry.controller.ts`

- `GET /api/v1/modules/:key/settings`
  - Renvoie `{ descriptors: SettingDescriptor[], values: ResolvedSettings }`.
  - Permission : `core.modules.read` + module activé pour le tenant (404 si module inconnu/inactif).
- `PUT /api/v1/modules/:key/settings`
  - Body : `{ settings: Record<string, unknown> }`. `validateSettings` → 400 si clé inconnue /
    type / borne invalide. Persiste le patch fusionné dans `TenantModule.settings`. Invalide le cache.
  - Permission : `core.modules.manage`. **Audité** (`@Audit('tenant-module', UPDATE)` / `AuditLogsService.log`, before/after).
- Tenant-scopé via `@CurrentUser()` (règle 1). `:key` validé contre `MODULE_KEYS` (400 sinon).

### 5. UI — composant générique + route unique

- `apps/web/src/lib/components/settings/ModuleSettings.svelte` : prend `module: string`, charge
  `GET /modules/:key/settings`, rend chaque descripteur par type (`Select` pour enum, `Toggle` pour
  booléen, input numérique borné), bouton **Enregistrer** → `PUT`. États `loading`/`error`/`saved`
  selon le pattern web existant.
- Route unique `apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte` qui rend
  `<ModuleSettings module={params.key} />`.
- Chaque module gagne une entrée **« Configuration »** dans sa sous-nav
  (`apps/web/src/lib/modules/navigation.ts`), pointant vers `/settings/modules/<sa-clé>`, **gated**
  sur `core.modules.manage` et l'activation du module.

### 6. Câblage métier (points d'application)

| Module | Réglage (clé) | Type / défaut | Point d'application |
| --- | --- | --- | --- |
| transportation | `capacityOverage` | enum `WARN`(défaut)/`BLOCK` | `checkCapacity` / consolidate : `BLOCK` ⇒ 409 au lieu d'avertissement |
| transportation | `modeThresholdParcelMaxKg` | number, défaut 30 | `suggestMode` |
| transportation | `modeThresholdLtlMaxKg` | number, défaut 4000 | `suggestMode` |
| transportation | `autoTenderOnPlan` | boolean, défaut true | chaîne d'auto-tender |
| procurement | `bidUniqueness` | enum `MULTIPLE`(défaut)/`SINGLE` | `submitBidByToken` : `SINGLE` ⇒ upsert (remplace le bid existant `(rfpLane, carrier)` non terminal) |
| procurement | `awardCreatesRateByDefault` | boolean, défaut false | défaut du flag `createRate` à l'award |
| connect | `csvNumberLocale` | enum `EN`(défaut)/`FR`/`AUTO` | parsing numérique de `coerceTypes` |
| carrier-portal | `podRequiresDispatched` | boolean, défaut false | `uploadPod` : si true, exige load DISPATCHED+ |
| billing | `tolerancePct` | number, défaut 2 | rapprochement (clé existante, rétro-compat) |
| billing | `toleranceAbsolute` | number, défaut 25 | rapprochement (clé existante, rétro-compat) |
| fleet | `complianceExpiringWindowDays` | number, défaut 30 | `computeComplianceStatus` (fenêtre passée en paramètre) |

Chaque point d'application lit via `ModuleSettingsService.resolve` ; le défaut du catalogue =
comportement actuel ⇒ **aucun changement de comportement tant qu'un tenant ne configure rien**.

Note câblage : `computeComplianceStatus` (`@pulsar/shared`, pur) prend déjà ses entrées en
paramètre — on lui passe la fenêtre résolue ; le réglage n'introduit pas d'I/O dans shared.

**Différé v1.1** : `portalLinkTtlDays` (expiration du lien carrier-portal). Une TTL fiable exige
un horodatage d'émission du token (`Carrier.portalTokenIssuedAt`), donc **une petite migration** —
hors du périmètre « aucune migration » de cette v1. À traiter dans un incrément séparé, idéalement
au niveau plateforme (customer-portal partage le même pattern de token).

### 7. Validation, défauts, sécurité

- `validateSettings` whiteliste les clés (rejette l'inconnu) → pas d'injection de champ arbitraire
  dans le JSON.
- Défauts dans le catalogue ; non configuré ⇒ défaut ⇒ comportement actuel.
- Tenant-scopé (règle 1) ; écriture auditée (règle 6) ; lecture gated module activé (cohérent règle 15).

### 8. Tests

- **Unit (shared)** : `resolveSettings` (défaut, override valide, override invalide ignoré, clé
  inconnue ignorée) + `validateSettings` (ok, clé inconnue, mauvais type, hors bornes, enum inconnu).
- **e2e** : `GET` renvoie descripteurs + valeurs ; `PUT` valide/rejette ; **un comportement réel
  basculé** — `bidUniqueness=SINGLE` ⇒ une 2ᵉ soumission `(lane, carrier)` remplace la 1ʳᵉ
  (étend `procurement.e2e-spec.ts` ou nouveau `module-settings.e2e-spec.ts`) ; rétro-compat billing
  (valeur `tolerancePct` stockée lue par le framework).

## Découpage / ordre d'implémentation

1. **Fondation** : catalogue + `resolveSettings`/`validateSettings` (shared, tests) → `ModuleSettingsService` + endpoints `GET`/`PUT` + cache → composant `ModuleSettings.svelte` + route + nav. Validé bout-en-bout avec **un seul** réglage (`procurement.bidUniqueness`).
2. **Câblage par module** : ajouter les réglages restants au catalogue + leur lecture au point d'application, module par module (transportation, connect, carrier-portal, billing rétro-compat, fleet). Chaque ajout est petit et isolé.

## Invariants respectés

Règle 1 (tenant scope), règle 6 (audit), pure data dans `@pulsar/shared` (catalogue + résolveurs),
défauts sûrs (rétro-compat comportementale), whitelist des clés (anti-injection). Aucune migration.
